#pragma once

// MotionTrack tunables. Pins match the v6 exercise monitor wiring.

#include <stdint.h>
#include "HeartCheckIn.h"

// ESP32-S / DOIT ESP32 DEVKIT V1. GPIO34/35 cannot drive I2C.
const int OLED_SDA = 21;
const int OLED_SCL = 22;
const int HEART_SDA = 25;
const int HEART_SCL = 26;
const uint8_t HEART_ADDRESS = 0x57;
// Set to false when the MAX30102 is missing or damaged. The tracker then never
// starts the pulse sensor and skips both heart-rate checks on its own.
const bool HEART_SENSOR_INSTALLED = false;
const int MPU_SDA = 32;
const int MPU_SCL = 33;
const uint8_t MPU_ADDRESS = 0x68;

// Loop timing (ms).
const uint32_t DISPLAY_MS = 250;      // OLED refresh
const uint32_t MOTION_MS = 20;        // MPU sample period while counting (50 Hz)
const uint32_t WARNING_MS = 5000;     // how long "FIX YOUR FORM" stays up
const uint32_t HEART_RETRY_MS = 2000; // MAX30102 re-probe period when offline
const uint32_t ENDED_SHOW_MS = 3000;  // "Done" / "Session ended" after the website closes the exercise

// Network (ms).
const uint32_t POLL_MS = 1000;          // GET /api/device/workout period
const uint32_t HTTP_TIMEOUT_MS = 3000;  // connect and read timeout per request
const uint32_t WIFI_RETRY_MS = 20000;   // restart a join only after the link has shown no change for this long
const uint32_t UPLOAD_BACKOFF_MIN_MS = 1000;  // retry delay after a network error or 5xx...
const uint32_t UPLOAD_BACKOFF_MAX_MS = 8000;  // ...doubling up to this

// Heart-rate check-in (before and after each exercise).
const long FINGER_THRESHOLD = 10000;          // IR level that counts as a finger on the sensor
const uint8_t CHECKIN_INTERVALS = 6;          // beat intervals that must agree
const float CHECKIN_TOLERANCE = 0.15f;        // each interval within +/-15% of their median
const float CHECKIN_MIN_BPM = 30;             // accepted BPM range
const float CHECKIN_MAX_BPM = 220;
const uint32_t CHECKIN_RETRY_AFTER_MS = 15000; // no two agreeing beat intervals in a row for this long -> "Try again"
const uint32_t CHECKIN_FINGER_LOST_MS = 750;   // finger off the sensor this long -> "Try again"; shorter dips are ignored
const uint32_t CHECKIN_TRY_AGAIN_MS = 1500;    // how long "Try again" is shown

inline HeartCheckInConfig checkInConfig() {
  HeartCheckInConfig c;
  c.fingerThreshold = FINGER_THRESHOLD;
  c.requiredIntervals = CHECKIN_INTERVALS;
  c.tolerance = CHECKIN_TOLERANCE;
  c.minBpm = CHECKIN_MIN_BPM;
  c.maxBpm = CHECKIN_MAX_BPM;
  c.retryAfterMs = CHECKIN_RETRY_AFTER_MS;
  c.fingerLostMs = CHECKIN_FINGER_LOST_MS;
  c.tryAgainShowMs = CHECKIN_TRY_AGAIN_MS;
  return c;
}
