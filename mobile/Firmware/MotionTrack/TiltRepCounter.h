#pragma once

#include <cmath>
#include <stdint.h>

// Counts reps by how far the limb tilts away from its resting position and
// back, not by how fast it moves, so slow, careful reps from older patients
// count while half reps, tremor, arm swing and strap adjustments do not.
//
// Orientation: a complementary filter. The gyro rotates the estimated "up"
// direction every sample (smooth, no lag during a lift); the accelerometer
// pulls it back toward gravity over about half a second (no long-term drift).
// Samples where the limb's own acceleration distorts gravity (outside
// 0.75-1.25 g) only use the gyro.
//
// A rep: the tilt from rest reaches the exercise's minimum angle in the lift
// direction (learned from the first rep), then comes back to within the return
// angle of rest, taking at least 0.6 s. A lift that stops short of the minimum
// is reported as a shallow attempt instead.
class TiltRepCounter {
 public:
  static constexpr float kAttemptTilt = 12.0f;     // degrees from rest that start an attempt
  static constexpr float kShallowFloor = 15.0f;    // an attempt this high but under the minimum is "shallow"
  static constexpr float kRestTilt = 6.0f;         // degrees from rest that end an attempt
  static constexpr float kStillStep = 2.0f;        // degrees per 250 ms window that still counts as still
  static constexpr uint32_t kMinRepMs = 600;       // faster than this is a bounce, not a rep
  static constexpr uint32_t kReanchorMs = 3000;    // still this long below the minimum: new resting position
  static constexpr uint32_t kGiveUpMs = 20000;     // held up this long without returning: new resting position
  static constexpr float kFilterSeconds = 0.4f;    // accelerometer correction time constant

  TiltRepCounter(float minimumTilt, float returnTilt) : minimumTilt_(minimumTilt), returnTilt_(returnTilt) {}

  // Gyro in deg/s (bias already removed), accel in g, time in ms. Returns true
  // on the sample where a rep is counted.
  bool update(float gx, float gy, float gz, const float accel[3], uint32_t nowMs) {
    shallowAttempt_ = false;
    const uint32_t dt = nowMs - lastMs_;
    lastMs_ = nowMs;
    if (!hasLast_) {
      hasLast_ = true;
      return false;
    }
    if (dt > 200 || !std::isfinite(gx) || !std::isfinite(gy) || !std::isfinite(gz) ||
        !std::isfinite(accel[0]) || !std::isfinite(accel[1]) || !std::isfinite(accel[2])) {
      // A gap in the data: the orientation can no longer be trusted.
      resetMotion(false);
      hasLast_ = true;
      return false;
    }
    if (dt == 0) return false;
    const float seconds = dt / 1000.0f;

    // 1. Orientation.
    const float norm = std::sqrt(accel[0] * accel[0] + accel[1] * accel[1] + accel[2] * accel[2]);
    const bool accelUsable = norm >= 0.75f && norm <= 1.25f;
    const float speed = std::sqrt(gx * gx + gy * gy + gz * gz);  // deg/s
    if (hasUp_) {
      // "Up" is fixed in the world, so in the sensor frame it turns by -omega.
      const float k = 0.0174533f * seconds;
      const float wx = gx * k, wy = gy * k, wz = gz * k;
      const float ux = up_[0] - (wy * up_[2] - wz * up_[1]);
      const float uy = up_[1] - (wz * up_[0] - wx * up_[2]);
      const float uz = up_[2] - (wx * up_[1] - wy * up_[0]);
      up_[0] = ux; up_[1] = uy; up_[2] = uz;
      if (accelUsable) {
        // Trust the accelerometer less while the limb is moving fast.
        const float weight = seconds / (kFilterSeconds + seconds) / (1.0f + speed / 90.0f);
        for (int i = 0; i < 3; ++i) up_[i] += weight * (accel[i] / norm - up_[i]);
      }
      normalize(up_);
    } else {
      if (!accelUsable) return false;
      for (int i = 0; i < 3; ++i) up_[i] = accel[i] / norm;
      hasUp_ = true;
      setRest(nowMs);
      return false;
    }

    // 2. Stillness, judged by how far "up" moved over the last 250 ms, which
    //    ignores the gyro's tremor and noise.
    if (nowMs - windowStartMs_ >= 250) {
      const bool stillWindow = angleBetween(up_, windowUp_) <= kStillStep;
      if (stillWindow) {
        if (!still_) stillSinceMs_ = windowStartMs_;
        still_ = true;
      } else {
        still_ = false;
      }
      for (int i = 0; i < 3; ++i) windowUp_[i] = up_[i];
      windowStartMs_ = nowMs;
    }
    // Still only if the last full window was still AND the limb has not moved
    // since it ended (otherwise the first moments of a slow lift would still
    // look still for up to 250 ms).
    const bool stillNow = still_ && angleBetween(up_, windowUp_) <= kStillStep;
    const uint32_t stillMs = stillNow ? nowMs - stillSinceMs_ : 0;

    // 3. Tilt from the resting position, in the lift direction.
    const float tilt = angleBetween(up_, rest_);
    const bool liftDirection = inLiftDirection();

    if (phase_ == Idle) {
      if (!attempting_ && tilt >= kAttemptTilt) {
        attempting_ = true;
        attemptStartMs_ = nowMs;
        attemptPeak_ = tilt;
      }
      if (attempting_) {
        if (tilt > attemptPeak_) attemptPeak_ = tilt;
        if (tilt >= minimumTilt_ && liftDirection) {
          learnDirection();
          phase_ = Raised;
          raisedSinceMs_ = nowMs;
        } else if (tilt <= kRestTilt) {
          shallowAttempt_ = attemptPeak_ >= kShallowFloor && liftDirection;
          attempting_ = false;
        }
      }
      // Follow slow posture changes while resting, and adopt a new resting
      // position after holding still elsewhere for a few seconds.
      if (phase_ == Idle && stillNow) {
        if (tilt < kAttemptTilt && stillMs >= 500) {
          const float w = seconds / (2.0f + seconds);
          for (int i = 0; i < 3; ++i) rest_[i] += w * (up_[i] - rest_[i]);
          normalize(rest_);
        } else if (stillMs >= kReanchorMs) {
          setRest(nowMs);
        }
      }
      return false;
    }

    // Raised: wait for the return.
    if (tilt <= returnTilt_) {
      const bool longEnough = nowMs - attemptStartMs_ >= kMinRepMs;
      phase_ = Idle;
      attempting_ = tilt > kRestTilt;
      attemptStartMs_ = nowMs;
      attemptPeak_ = tilt;
      if (longEnough) {
        ++count_;
        return true;
      }
      return false;
    }
    if (stillNow && stillMs >= kGiveUpMs) setRest(nowMs);  // never came back: this is the new rest
    return false;
  }

  void resetMotion(bool relearnAxis = false) {
    phase_ = Idle;
    attempting_ = false;
    shallowAttempt_ = false;
    hasLast_ = false;
    hasUp_ = false;
    still_ = false;
    if (relearnAxis) hasDirection_ = false;
  }

  uint32_t count() const { return count_; }
  bool shallowAttempt() const { return shallowAttempt_; }

 private:
  enum Phase { Idle, Raised };

  static void normalize(float v[3]) {
    const float n = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (n > 1e-6f) for (int i = 0; i < 3; ++i) v[i] /= n;
  }

  static float angleBetween(const float a[3], const float b[3]) {
    const float cx = a[1] * b[2] - a[2] * b[1];
    const float cy = a[2] * b[0] - a[0] * b[2];
    const float cz = a[0] * b[1] - a[1] * b[0];
    const float d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return std::atan2(std::sqrt(cx * cx + cy * cy + cz * cz), d) * 57.29578f;
  }

  // The axis the limb turns about while leaving rest, as a unit vector.
  bool tiltAxis(float out[3]) const {
    out[0] = rest_[1] * up_[2] - rest_[2] * up_[1];
    out[1] = rest_[2] * up_[0] - rest_[0] * up_[2];
    out[2] = rest_[0] * up_[1] - rest_[1] * up_[0];
    const float n = std::sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
    if (n < 1e-4f) return false;
    for (int i = 0; i < 3; ++i) out[i] /= n;
    return true;
  }

  // Lifts go one way about the joint; moving the other way from rest (for
  // example lowering from a raised resting position) is not a rep.
  bool inLiftDirection() const {
    if (!hasDirection_) return true;
    float axis[3];
    if (!tiltAxis(axis)) return false;
    return axis[0] * direction_[0] + axis[1] * direction_[1] + axis[2] * direction_[2] > 0.3f;
  }

  void learnDirection() {
    if (hasDirection_) return;
    if (tiltAxis(direction_)) hasDirection_ = true;
  }

  void setRest(uint32_t nowMs) {
    for (int i = 0; i < 3; ++i) rest_[i] = windowUp_[i] = up_[i];
    windowStartMs_ = nowMs;
    phase_ = Idle;
    attempting_ = false;
  }

  Phase phase_ = Idle;
  const float minimumTilt_;
  const float returnTilt_;
  float up_[3] = {0, 0, 1}, rest_[3] = {0, 0, 1}, windowUp_[3] = {0, 0, 1}, direction_[3] = {0, 0, 0};
  uint32_t count_ = 0, lastMs_ = 0, windowStartMs_ = 0, stillSinceMs_ = 0, attemptStartMs_ = 0, raisedSinceMs_ = 0;
  float attemptPeak_ = 0.0f;
  bool hasLast_ = false, hasUp_ = false, hasDirection_ = false, still_ = false, attempting_ = false;
  bool shallowAttempt_ = false;
};
