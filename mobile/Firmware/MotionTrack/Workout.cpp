#include <Arduino.h>
// MotionTrack: phone-controlled BLE mode or the original website workflow.
// Hardware setup (OLED, MPU6050 on software I2C, MAX30102) follows the v6 exercise monitor.
// loop() never touches the network: DeviceLink runs Wi-Fi/HTTP in its own task on core 0.

#include <Wire.h>
#include <SoftWire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <math.h>
#include "config.h"
#include "ArmCurlCounter.h"
#include "ShoulderPressCounter.h"
#include "BackRowCounter.h"
#include "HeartCheckIn.h"
#include "ExerciseFlow.h"
#include "EventOutbox.h"
#include "BuildMode.h"
#if MOTIONTRACK_WEBSITE
#include "DeviceLink.h"
#else
#include "Radio.h"
#include "LocalSession.h"
LocalSession session;
constexpr int BUTTON_PIN = 27; // momentary switch to GND
#endif

// Capture statuses reported to the website (EventOutbox status codes).
const uint8_t STATUS_WAITING_FINGER = 0;
const uint8_t STATUS_READING = 1;
const uint8_t STATUS_WEAK_SIGNAL = 2;
const uint8_t STATUS_COUNTING = 3;

Adafruit_SSD1306 display(128, 64, &Wire, -1);
MAX30105 heart;
// The OLED and heart sensor already use both hardware I2C controllers.
SoftWire mpuWire(MPU_SDA, MPU_SCL);
uint8_t mpuTxBuffer[2];
uint8_t mpuRxBuffer[14];
ArmCurlCounter armCurl;
ShoulderPressCounter shoulderPress;
BackRowCounter backRow;

struct Exercise {
  const char *name;
  const char *startPrompt;
  TiltRepCounter &counter;
};

// Index order matches the website ids: arm_curl, shoulder_press, back_row.
const Exercise exercises[] = {
  {"Arm Curl", "Mount on the forearm. Start with the arm lowered, then curl and lower.", armCurl},
  {"Shoulder Press", "Mount on the upper arm. Start at shoulder level, press up, then lower.", shoulderPress},
  {"Back Row", "Mount on the upper arm. Start with the arm hanging, pull back, then lower.", backRow},
};
const Exercise *exercise = &exercises[0];

#if MOTIONTRACK_WEBSITE
DeviceLink deviceLink;
#endif
ExerciseFlow flow;
HeartCheckIn checkIn(checkInConfig());
CheckIn checkInState = CheckIn::WaitingFinger;

bool displayReady = false;
bool motionOK = false;
bool heartReady = false;
unsigned long lastHeartProbe = 0;
float gyroBias[3] = {0, 0, 0};
float acceleration[3] = {0, 0, 0};
long latestIR = 0;
unsigned long lastDisplay = 0;
unsigned long lastMotion = 0;

// Screen state.
bool benchMode = false;          // exercise chosen over Serial with no website workout
uint16_t currentTarget = 0;      // target reps of the website workout
bool oldTimedWorkout = false;    // server has a leftover timed workout for this device
bool unknownExercise = false;    // server sent an exercise this firmware does not know
bool showShallowWarning = false;
unsigned long lastShallowAttempt = 0;
bool endedRecently = false;      // show "Done"/"Session ended" for a moment after the workout closes
bool endedAfterDone = false;
unsigned long endedAt = 0;

// `detail` is an optional second line (at most 21 characters) with the value
// that failed, so the screen shows why the tracker stopped.
void fatal(const char *message, const char *detail = nullptr) {
  Serial.println(message);
  if (detail) Serial.println(detail);
  if (displayReady) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println(message);
    if (detail) display.println(detail);
    display.println("Check wiring/power");
    display.display();
  }
  while (true) {
#if !MOTIONTRACK_WEBSITE
    radio::publish(workout::packet(workout::Fault,0,0,0,0,0,0,0,0));
    workout::Command ignored;
    while (radio::next(ignored)) {}
#endif
    delay(100);
  }
}

bool readMpuRegisters(uint8_t reg, uint8_t *data, uint8_t count) {
  mpuWire.beginTransmission(MPU_ADDRESS);
  mpuWire.write(reg);
  // Finish selecting the register before starting the software I2C read.
  if (mpuWire.endTransmission() != 0) return false;
  if (mpuWire.requestFrom(MPU_ADDRESS, count) != count) return false;
  for (uint8_t i = 0; i < count; ++i) data[i] = mpuWire.read();
  return true;
}

bool writeMpuRegister(uint8_t reg, uint8_t value) {
  mpuWire.beginTransmission(MPU_ADDRESS);
  mpuWire.write(reg);
  mpuWire.write(value);
  return mpuWire.endTransmission() == 0;
}

int16_t signedWord(const uint8_t *data) {
  return static_cast<int16_t>((static_cast<uint16_t>(data[0]) << 8) | data[1]);
}

bool readMotion(float accel[3], float gyro[3]) {
  uint8_t data[14];
  if (!readMpuRegisters(0x3B, data, sizeof(data))) return false;
  for (uint8_t i = 0; i < 3; ++i) {
    accel[i] = signedWord(data + 2 * i) / 16384.0f; // +/-2g, output in g.
    gyro[i] = signedWord(data + 8 + 2 * i) / 131.0f; // +/-250 degrees/second.
  }
  return true;
}

void beginMpu() {
  Serial.printf("MPU bus idle: SDA=%d SCL=%d (both should be 1)\n",
    digitalRead(MPU_SDA), digitalRead(MPU_SCL));
  mpuWire.beginTransmission(MPU_ADDRESS);
  const uint8_t error = mpuWire.endTransmission();
  Serial.printf("MPU address 0x%02X: ACK code=%u (0 means response)\n", MPU_ADDRESS, error);
  if (error != 0) fatal("MPU 0x68 not found");
  uint8_t identity = 0;
  if (!readMpuRegisters(0x75, &identity, 1)) fatal("WHO_AM_I read failed");
  Serial.printf("WHO_AM_I=0x%02X\n", identity);
  if (identity != 0x68 && identity != 0x72) fatal("MPU ID mismatch");
  if (identity == 0x68) {
    if (!writeMpuRegister(0x6B, 0x80)) fatal("MPU reset failed");
    delay(100);
  } else {
    // shortcut: 0x72 uses the verified XYZ register layout, verify gyro behavior on the mounted sensor.
    Serial.println("Using MPU-compatible settings for observed chip ID 0x72.");
  }
  if (!writeMpuRegister(0x6B, 0x01) || // Wake, X gyro PLL clock.
      !writeMpuRegister(0x6C, 0x00) || // Enable all accel/gyro axes.
      !writeMpuRegister(0x1A, 0x04) || // 20 Hz gyro low-pass filter.
      !writeMpuRegister(0x19, 19) ||   // 1 kHz / (1 + 19) = 50 Hz.
      !writeMpuRegister(0x1B, 0x00) || // +/-250 degrees/second.
      !writeMpuRegister(0x1C, 0x00)) { // +/-2g.
    fatal("MPU setup failed");
  }
  delay(100);
  if (identity == 0x72) {
    uint8_t range[2];
    if (!readMpuRegisters(0x1B, range, sizeof(range)) ||
        ((range[0] | range[1]) & 0x18) != 0) fatal("MPU range mismatch");
  }
}

void calibrateMotion() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Keep sensor still");
  display.println("Calibrating...");
  display.display();
  Serial.println("Keep the MPU6050 completely still for 2 seconds.");
  float sum[3] = {0, 0, 0};
  float sumSquares[3] = {0, 0, 0};
  const unsigned int samples = 100;
  for (unsigned int sample = 0; sample < samples; ++sample) {
    float accel[3], gyro[3];
    if (!readMotion(accel, gyro)) fatal("MPU read failed");
    const float gravity = sqrtf(accel[0] * accel[0] + accel[1] * accel[1] + accel[2] * accel[2]);
    if (gravity < 0.75f || gravity > 1.25f) {
      char detail[24];
      snprintf(detail, sizeof(detail), "Accel %.2fg, need ~1", gravity);
      fatal("Hold still, reset", detail);
    }
    for (uint8_t axis = 0; axis < 3; ++axis) {
      sum[axis] += gyro[axis];
      sumSquares[axis] += gyro[axis] * gyro[axis];
    }
    delay(MOTION_MS);
  }
  for (uint8_t axis = 0; axis < 3; ++axis) {
    gyroBias[axis] = sum[axis] / samples;
    const float variance = sumSquares[axis] / samples - gyroBias[axis] * gyroBias[axis];
    if (fabsf(gyroBias[axis]) > 10.0f || variance > 4.0f) {
      char detail[24];
      if (fabsf(gyroBias[axis]) > 10.0f) {
        snprintf(detail, sizeof(detail), "Gyro %c drift %.1f>10", "XYZ"[axis], fabsf(gyroBias[axis]));
      } else {
        snprintf(detail, sizeof(detail), "Gyro %c noise %.1f>4", "XYZ"[axis], variance);
      }
      fatal("Hold still, reset", detail);
    }
  }
  motionOK = true;
}

bool beginHeart() {
  if (!Wire1.begin(HEART_SDA, HEART_SCL, I2C_SPEED_STANDARD)) {
    Serial.println("MAX30102 bus setup failed on SDA25/SCL26");
    return false;
  }
  Wire1.setTimeOut(25);
  Wire1.beginTransmission(HEART_ADDRESS);
  const uint8_t error = Wire1.endTransmission();
  if (error != 0) {
    Serial.printf("MAX30102: no response at 0x57 on SDA25/SCL26 (I2C code %u)\n", error);
    return false;
  }
  Wire1.beginTransmission(HEART_ADDRESS);
  Wire1.write(0xFF); // PART_ID register.
  if (Wire1.endTransmission() != 0 || Wire1.requestFrom(HEART_ADDRESS, uint8_t(1)) != 1) {
    Serial.println("MAX30102: 0x57 responds, but PART_ID read failed");
    return false;
  }
  const uint8_t partId = Wire1.read();
  if (partId != 0x15) {
    Serial.printf("MAX30102: 0x57 responds with unexpected PART_ID 0x%02X (expected 0x15)\n", partId);
    return false;
  }
  if (!heart.begin(Wire1, I2C_SPEED_STANDARD, HEART_ADDRESS)) {
    Serial.println("MAX30102: PART_ID verified, but library initialization failed");
    return false;
  }
  heart.setup(0x1F, 4, 2, 400, 411, 4096);
  heart.setPulseAmplitudeGreen(0);
  Serial.println("MAX30102 ready at 0x57 (PART_ID 0x15)");
  return true;
}

// v6 heart polling: re-probe when offline, detect a disconnected sensor.
void serviceHeart() {
  if (!HEART_SENSOR_INSTALLED) return;
  if (!heartReady && millis() - lastHeartProbe >= HEART_RETRY_MS) {
    lastHeartProbe = millis();
    heartReady = beginHeart();
  }
}

long readHeartIR() {
  long ir = heartReady ? static_cast<long>(heart.getIR()) : 0;
  if (heartReady && ir == 0) {
    Wire1.beginTransmission(HEART_ADDRESS);
    if (Wire1.endTransmission() != 0) {
      heartReady = false;
      lastHeartProbe = millis();
      Serial.println("MAX30102 disconnected. Retrying.");
    }
  }
  return ir;
}

uint8_t checkInStatus(CheckIn state) {
  switch (state) {
    case CheckIn::Reading: return STATUS_READING;
    case CheckIn::TryAgain: return STATUS_WEAK_SIGNAL;
    default: return STATUS_WAITING_FINGER;
  }
}

// Reacts to the phase ExerciseFlow just entered: every entry sends a fresh status.
void handleEnteredPhase() {
  const Phase entered = flow.takeEntered();
  const unsigned long now = millis();
  switch (entered) {
    case Phase::BeforeBpm:
    case Phase::AfterBpm:
      checkIn.start(now);
      checkInState = CheckIn::WaitingFinger;
      showShallowWarning = false;
#if MOTIONTRACK_WEBSITE
      deviceLink.push(EventType::Status, 0, STATUS_WAITING_FINGER, true);
#endif
      Serial.printf("%s: place your finger on the pulse sensor (%s reading)\n", exercise->name,
                    entered == Phase::BeforeBpm ? "before" : "after");
      break;
    case Phase::Counting:
#if MOTIONTRACK_WEBSITE
      deviceLink.push(EventType::Status, 0, STATUS_COUNTING, true);
#endif
      lastMotion = now;
      Serial.printf("%s: counting %u / %u. %s\n", exercise->name, (unsigned)flow.reps(), (unsigned)currentTarget,
                    exercise->startPrompt);
      break;
    default:
      break;
  }
}

// Applies the last polled workout to ExerciseFlow. Never blocks.
#if MOTIONTRACK_WEBSITE
void syncWithServer() {
  ServerWorkout s;
  uint32_t ageMs = 0;
  if (!deviceLink.snapshot(s, ageMs)) return;  // no server answer yet: keep current state

  oldTimedWorkout = s.present && !s.reps;
  unknownExercise = s.present && s.reps && s.exercise >= 3;
  if (oldTimedWorkout || unknownExercise) {
    s.present = false;  // do not run it
    benchMode = false;
  }

  const bool wasActive = flow.phase() != Phase::None;
  const bool wasDone = flow.phase() == Phase::Done;
  const Exercise *selected = s.present ? &exercises[s.exercise] : exercise;
  const ExerciseFlow::Action action = flow.sync(s, selected->counter.count());

  switch (action) {
    case ExerciseFlow::Action::Reset:
      exercise = selected;
      exercise->counter.resetMotion(true);
      deviceLink.startWorkout(s.id, s.lastSequence);
      currentTarget = s.target;
      benchMode = false;
      endedRecently = false;
      showShallowWarning = false;
      Serial.printf("Website workout: %s, target %u, resuming at %u reps (last sequence %lu)\n",
                    exercise->name, (unsigned)s.target, (unsigned)flow.reps(), (unsigned long)s.lastSequence);
      break;
    case ExerciseFlow::Action::Ended:
      if (wasActive) {
        endedRecently = true;
        endedAfterDone = wasDone;
        endedAt = millis();
        showShallowWarning = false;
        Serial.println(wasDone ? "Exercise done." : "Session ended on the website.");
      }
      break;
    case ExerciseFlow::Action::Follow:
      Serial.println("Following the website (phase changed there).");
      break;
    default:
      break;
  }
  if (s.present) currentTarget = s.target;
  handleEnteredPhase();
}

#endif

void runCheckIn() {
  latestIR = readHeartIR();  // waits for the next sample (about 10 ms), as in v6
  const bool beat = heartReady && latestIR > 0 && checkForBeat(latestIR);
  const CheckIn state = checkIn.update(latestIR, beat, millis());  // time of this sample
  if (state == checkInState) return;
  checkInState = state;
  if (state != CheckIn::Done) {
#if MOTIONTRACK_WEBSITE
    deviceLink.push(EventType::Status, 0, checkInStatus(state));
#endif
    return;
  }
  const int bpm = checkIn.bpm();
  if (flow.phase() == Phase::BeforeBpm) {
#if MOTIONTRACK_WEBSITE
    deviceLink.push(EventType::BeforeBpm, bpm);
#else
    session.before = bpm;
#endif
    flow.onBeforeBpmSaved(exercise->counter.count());
    Serial.printf("Before BPM: %d\n", bpm);
  } else {
#if MOTIONTRACK_WEBSITE
    deviceLink.push(EventType::AfterBpm, bpm);
#else
    session.after = bpm;
#endif
    flow.onAfterBpmSaved();
    Serial.printf("After BPM: %d\n", bpm);
  }
  handleEnteredPhase();
}

void runMotion(unsigned long now) {
  if (now - lastMotion < MOTION_MS) return;
  lastMotion = now;
  float gyro[3];
  motionOK = readMotion(acceleration, gyro);
  if (!motionOK) {
    exercise->counter.resetMotion();
    showShallowWarning = false;
    return;
  }
  TiltRepCounter &counter = exercise->counter;
  if (counter.update(gyro[0] - gyroBias[0], gyro[1] - gyroBias[1], gyro[2] - gyroBias[2], acceleration, now)) {
    if (benchMode) {
      Serial.printf("%s counted: %lu\n", exercise->name, static_cast<unsigned long>(counter.count()));
      return;
    }
    const uint16_t before = flow.reps();
    const uint16_t reps = flow.onRep(counter.count());
    if (reps != before) {
#if MOTIONTRACK_WEBSITE
      deviceLink.push(EventType::Progress, reps);
#endif
      Serial.printf("%s counted: %u / %u\n", exercise->name, (unsigned)reps, (unsigned)currentTarget);
    }
    if (flow.phase() == Phase::AfterBpm) showShallowWarning = false;
    handleEnteredPhase();
  } else if (counter.shallowAttempt()) {
    lastShallowAttempt = now;
    showShallowWarning = true;
    Serial.printf("%s: Fix your form for better results.\n", exercise->name);
  }
}

#if MOTIONTRACK_WEBSITE
void handleSerial() {
  while (Serial.available()) {
    const int command = Serial.read();
    if (command == 'r' || command == 'R') {
      deviceLink.requestRetryLast();
      continue;
    }
    if (command < '1' || command > '3') continue;
    if (flow.phase() != Phase::None || oldTimedWorkout || unknownExercise) {
      Serial.println("A website workout is open; the exercise is set on the website.");
      continue;
    }
    exercise = &exercises[command - '1'];
    exercise->counter.resetMotion(true);
    benchMode = true;
    showShallowWarning = false;
    lastMotion = millis();
    Serial.printf("Bench mode: %s. %s\n", exercise->name, exercise->startPrompt);
  }
}

#endif

// Centered text helper for the large screens.
void centered(const char *text, uint8_t size, int16_t y) {
  int16_t x1, y1;
  uint16_t w, h;
  display.setTextSize(size);
  display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  display.setCursor(w < 128 ? (128 - w) / 2 : 0, y);
  display.print(text);
}

void drawFixYourForm() {
  display.setTextSize(2);
  display.setCursor(16, 4);
  display.print("FIX YOUR");
  display.setCursor(40, 22);
  display.print("FORM");
  display.setTextSize(1);
  display.setCursor(10, 50);
  display.print("FOR BETTER RESULTS");
}

void drawIdle() {
#if MOTIONTRACK_WEBSITE
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("MotionTrack");
  display.setCursor(0, 20);
  display.print("Waiting for website");
  display.setCursor(0, 48);
  if (!deviceLink.wifiUp()) display.print("Wi-Fi: connecting...");
  else if (!deviceLink.serverOk()) display.print("Wi-Fi OK, no server");
  else display.print("Wi-Fi OK, server OK");
#else
  centered("Motion Log", 2, 8);
  centered("Ready for iPhone", 1, 44);
#endif
}

void drawCheckIn(Phase phase) {
  const char *when = phase == Phase::BeforeBpm ? "Before exercise" : "After exercise";
  if (!heartReady) {
    centered("Pulse sensor", 1, 16);
    centered("offline", 1, 28);
    centered(when, 1, 52);
    return;
  }
  switch (checkInState) {
    case CheckIn::Reading:
      centered("Hold still", 2, 12);
      centered("Reading pulse...", 1, 36);
      break;
    case CheckIn::TryAgain:
      centered("Try again", 2, 12);
      centered("Keep finger still", 1, 36);
      break;
    default:
      centered("PLACE YOUR", 2, 4);
      centered("FINGER", 2, 24);
      break;
  }
  centered(when, 1, 54);
}

void drawCounting() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(exercise->name);
  char text[16];
  snprintf(text, sizeof(text), "%u / %u", (unsigned)flow.reps(), (unsigned)currentTarget);
  centered(text, 3, 22);
  if (!motionOK) {
    display.setTextSize(1);
    display.setCursor(0, 56);
    display.print("MPU disconnected");
  }
}

void drawBench() {
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(exercise->name);
  display.setCursor(0, 18);
  display.print(motionOK ? "Bench mode" : "MPU disconnected");
  display.setTextSize(2);
  display.setCursor(0, 40);
  display.print("Reps: ");
  display.print(exercise->counter.count());
}

void updateDisplay(unsigned long now) {
  if (now - lastDisplay < DISPLAY_MS) return;
  lastDisplay = now;
  if (now - lastShallowAttempt >= WARNING_MS) showShallowWarning = false;
  if (endedRecently && now - endedAt >= ENDED_SHOW_MS) endedRecently = false;

  display.clearDisplay();
  display.setTextWrap(false);
  const Phase phase = flow.phase();
#if !MOTIONTRACK_WEBSITE
  if (!session.timing) {
    if (session.resting == workout::Idle) drawIdle();
    else {
      centered(session.resting == workout::Complete ? "Done" : "Stopped", 2, 8);
      char text[24]; snprintf(text,sizeof(text),"%u reps / %lu s",flow.reps(),(unsigned long)session.elapsed);
      centered(text,1,44);
    }
    display.display();
    return;
  }
#endif
  if (phase == Phase::BeforeBpm || phase == Phase::AfterBpm) {
    drawCheckIn(phase);
  } else if (phase == Phase::Counting) {
    if (showShallowWarning) drawFixYourForm();
    else drawCounting();
  } else if (phase == Phase::Done || (endedRecently && endedAfterDone)) {
    centered("Done", 3, 14);
    centered("Check the website", 1, 50);
  }
#if MOTIONTRACK_WEBSITE
  else if (deviceLink.notRegistered()) {
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.print("Device not");
    display.setCursor(0, 12);
    display.print("registered");
    display.setCursor(0, 36);
    display.print("Add under My devices");
    display.setCursor(0, 48);
    display.print("and update secrets.h");
  } else if (endedRecently) {
    centered("Session", 2, 12);
    centered("ended", 2, 32);
  } else if (oldTimedWorkout) {
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.print("Old workout -");
    display.setCursor(0, 16);
    display.print("cancel it on the");
    display.setCursor(0, 28);
    display.print("website");
  } else if (unknownExercise) {
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.print("Unknown exercise -");
    display.setCursor(0, 16);
    display.print("update the firmware");
  }
#endif
  else if (benchMode) {
    if (showShallowWarning) drawFixYourForm();
    else drawBench();
  } else {
    drawIdle();
  }
  display.display();

  if (benchMode && phase == Phase::None) {
    Serial.printf("IR: %ld | Mode: %s | Arm Curl: %lu | Shoulder Press: %lu | Back Row: %lu | Accel(g): %.3f,%.3f,%.3f | MPU: %s | Pulse: %s\n",
      latestIR, exercise->name, static_cast<unsigned long>(armCurl.count()),
      static_cast<unsigned long>(shoulderPress.count()), static_cast<unsigned long>(backRow.count()),
      acceleration[0], acceleration[1], acceleration[2], motionOK ? "OK" : "ERROR", heartReady ? "OK" : "OFFLINE");
  }
}

#if !MOTIONTRACK_WEBSITE
bool buttonPressed() {
  static bool previous = HIGH, stable = HIGH;
  static uint32_t changed = 0;
  bool raw = digitalRead(BUTTON_PIN);
  if (raw != previous) { previous = raw; changed = millis(); }
  if (raw == stable || millis()-changed < 35) return false;
  stable = raw;
  return stable == LOW;
}
void applyControl(const workout::Command& c) {
  if (session.start(flow,c,millis())) {
    exercise = &exercises[c.movement==1 ? 0 : c.movement==3 ? 1 : 2];
    currentTarget=c.target;
    exercise->counter.resetMotion(true);
    showShallowWarning=false;
  } else {
    session.command(flow,c,exercise->counter.count(),millis());
  }
  handleEnteredPhase();
}
#endif

void setupTracker() {
  Serial.begin(115200);
  delay(500);
#if !MOTIONTRACK_WEBSITE
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  radio::begin();
#endif
  Serial.println("MotionTrack: MPU address 0x68 only");
  Serial.println("MPU SDA32/SCL33; OLED SDA21/SCL22; heart SDA25/SCL26");
  if (!Wire.begin(OLED_SDA, OLED_SCL, 400000)) fatal("OLED I2C setup failed");
  Wire.setTimeOut(50);
  mpuWire.setTxBuffer(mpuTxBuffer, sizeof(mpuTxBuffer));
  mpuWire.setRxBuffer(mpuRxBuffer, sizeof(mpuRxBuffer));
  mpuWire.enablePullups(true);
  pinMode(MPU_SDA, INPUT_PULLUP);
  pinMode(MPU_SCL, INPUT_PULLUP);
  mpuWire.setClock(50000);
  mpuWire.setTimeout_ms(50);
  mpuWire.begin();

  uint8_t oledAddress = 0;
  for (uint8_t address = 0x3C; address <= 0x3D; ++address) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      oledAddress = address;
      break;
    }
  }
  if (!oledAddress || !display.begin(SSD1306_SWITCHCAPVCC, oledAddress, false, false)) fatal("OLED not found");
  displayReady = true;
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(true);
  beginMpu();
  calibrateMotion();

  if (HEART_SENSOR_INSTALLED) {
    heartReady = beginHeart();
  } else {
    Serial.println("Pulse sensor turned off in config.h: heart-rate checks are skipped.");
  }
  lastHeartProbe = millis();
  lastMotion = millis();

#if MOTIONTRACK_WEBSITE
  deviceLink.begin();
  Serial.println("Start an exercise on the website, or (no website workout) send 1 for Arm Curl,");
  Serial.println("2 for Shoulder Press or 3 for Back Row to test counting. Send r to resend the last upload.");

#endif
}

void updateTracker() {
#if MOTIONTRACK_WEBSITE
  handleSerial();
  // Re-probing an offline pulse sensor can stall I2C briefly, so not while counting reps.
  if (flow.phase() != Phase::Counting) serviceHeart();
  syncWithServer();
#else
  workout::Command c;
  if (buttonPressed()) {
    c = {uint8_t(session.timing ? 2 : 1), uint8_t(session.movement ? session.movement : 1),
         uint8_t(session.target ? session.target : 10), uint8_t(session.stage(flow))};
    applyControl(c);
  }
  while (radio::next(c)) applyControl(c);
  if (!session.timing || flow.phase()!=Phase::Counting) serviceHeart();
  // Without a pulse sensor, skip each heart-rate check as soon as it starts,
  // exactly as if the patient had tapped "Skip heart-rate check".
  if (!HEART_SENSOR_INSTALLED && session.timing &&
      (flow.phase() == Phase::BeforeBpm || flow.phase() == Phase::AfterBpm)) {
    applyControl({3, 0, 0, uint8_t(session.stage(flow))});
  }
  if (session.timing) {
#endif

  const unsigned long now = millis();
  const Phase phase = flow.phase();
  if (phase == Phase::BeforeBpm || phase == Phase::AfterBpm) {
    runCheckIn();
  } else if (phase == Phase::Counting) {
    runMotion(now);
  } else if (phase == Phase::None && benchMode) {
    latestIR = readHeartIR();
    runMotion(now);
  }
#if !MOTIONTRACK_WEBSITE
  }
  if (session.timing && flow.phase()==Phase::Done) session.finish(millis(),true);
  const uint8_t flags = (!motionOK ? 1 : 0) | (!heartReady ? 2 : 0) |
      (showShallowWarning && millis()-lastShallowAttempt < WARNING_MS ? 4 : 0);
  radio::publish(session.snapshot(flow,millis(),flags,checkInStatus(checkInState)));
#endif
  updateDisplay(millis());
}
