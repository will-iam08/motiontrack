# MotionTrack firmware (ESP32)

The `MotionTrack/` sketch runs on an ESP32 DOIT DevKit V1 with an MPU6050 motion sensor, a MAX30102 pulse
sensor and a 128x64 SSD1306 OLED. It polls the MotionTrack backend over Wi-Fi for the exercise the patient
started on the website, takes a heart-rate check-in before and after the exercise, counts repetitions up to
the target and uploads every step.

## Bluetooth build in one file (`MotionTrackSingle/`)

[`MotionTrackSingle/MotionTrackSingle.ino`](MotionTrackSingle/MotionTrackSingle.ino) is the Bluetooth firmware
for the Motion Track iPhone app as a single sketch, so it opens in the Arduino IDE without any companion files.
It is generated from [`mobile/Firmware/MotionTrack`](../mobile/Firmware/MotionTrack): edit those files, then run
`python3 firmware/tools/make_single_sketch.py` to rebuild it. Use ESP32 Arduino core 2.0.17, board **DOIT ESP32
DEVKIT V1**, partition scheme **Huge APP**, and the SparkFun MAX3010x, Adafruit SSD1306, SoftWire and AsyncDelay
libraries listed below. The pulse sensor is switched off (`HEART_SENSOR_INSTALLED = false`), so heart-rate checks
are skipped until it is set to `true`.

**Wrist placement.** Strap the MPU6050 snugly to the working forearm just above the wrist.

- **Arm curl:** Tilt at least 45° from the bottom of the rep and lower back to within 20° of the starting
  pose. The first completed rep sets the lifting direction.
- **Shoulder press:** Hold the wrist still at shoulder level when counting starts. Press up and return
  to shoulder level.
- **Back row:** With your torso steady and working arm hanging, hold the wrist still when counting starts.
  Pull toward your hip, then lower to the starting position.

For presses and rows, hold the starting position until **Hold wrist still** clears. Use a smooth lift and
return. The wrist detector uses vertical acceleration with gravity removed and tracks direction changes
through continuous reps and pauses. Its filtered travel scores are used to screen out small motions.
`mobile/tests/run.sh` tests tilted curls and wrist swings with noise, including back-to-back reps at
different tempos. Verify the press and row counts with the sensor strapped on.

For battery use, power the ESP32 through **VIN** at 5 V (for example a 9 V battery into a breadboard supply set
to 5 V) and run the OLED and motion sensor from the ESP32's **3V3** pin. A weak battery browns the board out when
Bluetooth starts; the OLED then reports "Power too weak".

## Website (Wi-Fi) build (`MotionTrack/`)

> **Still to be tested on the mounted sensor.** The rep-counting thresholds (especially Shoulder Press and
> Back Row) and the BPM check-in (finger threshold, interval agreement, timeouts) have only been checked with
> host tests and synthetic data. Expect to tune the values in `config.h` and the counter headers after
> trying them on a real arm and finger.

## Wiring

Same pins as the v6 exercise monitor. Each sensor has its own I2C bus.

| Part | Signal | ESP32 pin | Notes |
| --- | --- | --- | --- |
| SSD1306 OLED (0x3C or 0x3D) | SDA | GPIO21 | hardware I2C (`Wire`), 400 kHz |
| | SCL | GPIO22 | |
| MAX30102 pulse sensor (0x57) | SDA | GPIO25 | hardware I2C (`Wire1`), 100 kHz |
| | SCL | GPIO26 | |
| MPU6050 (0x68) | SDA | GPIO32 | software I2C (SoftWire), 50 kHz, internal pull-ups |
| | SCL | GPIO33 | |
| All parts | VCC / GND | 3V3 / GND | |

GPIO34/35 are input-only and cannot be used for I2C.

## Board and libraries

- Board: ESP32 Arduino core 3.x by Espressif (built here with 3.3.13), board **DOIT ESP32 DEVKIT V1**,
  FQBN `esp32:esp32:esp32doit-devkit-v1`. Board manager URL:
  `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
- Libraries (Library Manager names, versions used for the build):
  - SparkFun MAX3010x Pulse and Proximity Sensor Library 1.1.2
  - Adafruit SSD1306 2.5.17 (installs Adafruit GFX Library 1.13.0 and Adafruit BusIO)
  - SoftWire 2.0.10 by Steve Marple, plus AsyncDelay 1.1.2
  - ArduinoJson 7.4.3
- WiFi, HTTPClient and FreeRTOS come with the ESP32 core.

## Configure `secrets.h`

The sketch will not compile without `MotionTrack/secrets.h`. It is ignored by git, so your Wi-Fi password and
device token are never committed.

1. Copy `MotionTrack/secrets.example.h` to `MotionTrack/secrets.h`.
2. Set `WIFI_SSID` and `WIFI_PASSWORD` (a 2.4 GHz network; the ESP32 has no 5 GHz radio).
3. Sign in on the website, open **My devices**, add the device and copy its token into `DEVICE_TOKEN`. The
   token is shown only once; if you lose it, add the device again.
4. Set `API_BASE_URL` to the laptop running the backend, as seen from the ESP32, with no trailing slash, for
   example `http://192.168.1.10:3000`.

The backend must listen on the network, not only on localhost: set `HOST=0.0.0.0` in `backend/.env`,
restart it, and use the laptop's LAN IP address (`ipconfig` on Windows, `ipconfig getifaddr en0` on macOS,
`hostname -I` on Linux). `localhost` on the ESP32 means the ESP32 itself. The laptop and the ESP32 must be on
the same network, and the laptop firewall must allow the backend port.

The sketch never prints the device token or the Wi-Fi password to Serial.

## Compile and upload

### Arduino IDE

1. Install the ESP32 core (Boards Manager, "esp32" by Espressif) and the libraries above (Library Manager).
2. Open `firmware/MotionTrack/MotionTrack.ino`. The IDE opens all files in the folder as tabs.
3. Tools > Board > esp32 > **DOIT ESP32 DEVKIT V1**; Tools > Port > your ESP32's port.
4. Create `secrets.h` as above, then Upload. Open the Serial Monitor at **115200 baud**.

### arduino-cli

```sh
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32
arduino-cli lib install "SparkFun MAX3010x Pulse and Proximity Sensor Library" "Adafruit SSD1306" SoftWire AsyncDelay ArduinoJson

cp firmware/MotionTrack/secrets.example.h firmware/MotionTrack/secrets.h   # then edit it
arduino-cli compile --fqbn esp32:esp32:esp32doit-devkit-v1 firmware/MotionTrack
arduino-cli upload --fqbn esp32:esp32:esp32doit-devkit-v1 -p /dev/ttyUSB0 firmware/MotionTrack   # your port
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

### Host tests

The check-in, exercise-flow and upload-queue logic has no Arduino dependencies and is tested with g++:

```sh
bash firmware/tests/run.sh
```

## Start-up

On power-up the device checks the MPU6050, then shows **Keep sensor still / Calibrating...** for about two
seconds: keep it still on the table. It then connects to Wi-Fi in the background and polls the website once
a second. Sensors missing at start-up stop with a message on the OLED and Serial (as in v6); the pulse sensor
is retried every 2 seconds instead.

## Serial commands (115200 baud)

| Send | Effect |
| --- | --- |
| `1` / `2` / `3` | Bench mode: count Arm Curl / Shoulder Press / Back Row locally and print counts as in v6. Only works when no website workout is open; nothing is uploaded. |
| `r` | Resend the last upload the server acknowledged, byte for byte, to the same workout. Prints e.g. `Retry seq 7 -> HTTP 200 duplicate:true`. The website's count does not change. |

Serial also logs Wi-Fi and server status changes, each rep, each accepted BPM and any refused upload.

## OLED screens

| Screen | Meaning |
| --- | --- |
| Keep sensor still / Calibrating... | Start-up gyro calibration. |
| MotionTrack / Waiting for website | Idle. The bottom line shows Wi-Fi and server status. Start an exercise on the website. |
| PLACE YOUR FINGER (Before / After exercise) | Heart-rate check-in: put a fingertip on the pulse sensor. |
| Hold still / Reading pulse... | A finger is on the sensor and beats are being collected. |
| Try again | The reading stopped making progress or the finger stayed off the sensor (see `CHECKIN_RETRY_AFTER_MS` and `CHECKIN_FINGER_LOST_MS`). It starts again by itself; the website can skip the reading. |
| Pulse sensor offline | The MAX30102 is not responding; it is retried every 2 s. |
| `Arm Curl` + `7 / 10` | Counting reps towards the target. Counting starts only after the before-reading is saved or skipped. |
| FIX YOUR FORM / FOR BETTER RESULTS | A movement started but did not go far enough to count (shown for 5 s). |
| MPU disconnected | The motion sensor stopped answering during counting. |
| Done | Target reached and after-reading saved. Choose the next exercise or end the session on the website. |
| Session ended | The exercise was stopped, skipped to the end or the session ended on the website. |
| Device not registered | The server rejected the device token (HTTP 401). Add the device under My devices and update `secrets.h`. |
| Old workout - cancel it on the website | An unfinished timed workout from before MotionTrack is open for this device. Cancel it on the website. |
| Bench mode / Reps: N | Local counting started with Serial `1`/`2`/`3`. |

## How it works

- `loop()` (core 1) reads the sensors, runs the check-in and rep counting, and draws the OLED every 250 ms.
  It never makes network calls.
- `DeviceLink` runs Wi-Fi and HTTP in a FreeRTOS task pinned to core 0. It polls
  `GET /api/device/workout` every second and posts events to `POST /api/device/workouts/:id/updates`. The two
  sides share only the last polled workout and the outgoing event queue, behind a mutex. Every request times
  out after 3 s.
- Each event gets its sequence number when first sent and is resent with the same bytes until the server
  answers: 2xx removes it, 409 (the website moved on, for example a skipped reading) discards it and polls
  again at once, a network error or 5xx retries after 1, 2, 4, then 8 s.
- After a reboot, or when the website starts a new exercise, the device continues from the server's phase,
  repetitions and last sequence number.

## Settings in `config.h`

| Setting | Default | Meaning |
| --- | --- | --- |
| `FINGER_THRESHOLD` | 10000 | IR level that counts as a finger on the sensor. |
| `CHECKIN_INTERVALS` | 6 | Beat intervals that must agree before a BPM is accepted. |
| `CHECKIN_TOLERANCE` | 0.15 | Each of those intervals must be within ±15% of their median. |
| `CHECKIN_MIN_BPM` / `CHECKIN_MAX_BPM` | 30 / 220 | Accepted BPM range. |
| `CHECKIN_RETRY_AFTER_MS` | 15000 | The reading makes no progress (no two beat intervals in a row agree) for this long: "Try again". The timer restarts each time two intervals agree, so one missed or extra beat does not end the attempt. |
| `CHECKIN_FINGER_LOST_MS` | 750 | The finger is off the sensor for this long: "Try again". Shorter dips in the IR level are ignored. |
| `CHECKIN_TRY_AGAIN_MS` | 1500 | How long "Try again" stays up before the next attempt. |
| `POLL_MS` | 1000 | How often the device asks the website for the current exercise. |
| `HTTP_TIMEOUT_MS` | 3000 | Connect and response timeout per request. |
| `WIFI_RETRY_MS` | 20000 | The Wi-Fi join is restarted only after the link has shown no change for this long. Between restarts the ESP32 reconnects by itself. |
| `UPLOAD_BACKOFF_MIN_MS` / `UPLOAD_BACKOFF_MAX_MS` | 1000 / 8000 | Resend delay after a failed upload. |
| `WARNING_MS` | 5000 | How long FIX YOUR FORM stays up. |

Pins and loop timings are also in `config.h`. The rep thresholds live in `ArmCurlCounter.h`,
`ShoulderPressCounter.h` and `BackRowCounter.h`.
