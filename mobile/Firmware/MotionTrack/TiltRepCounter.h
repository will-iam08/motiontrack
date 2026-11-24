#pragma once

#include "GravityEstimate.h"
#include "RepCounter.h"

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
// Measure each lift from its own lowest angle. Count after a return near rest
// and use the first completed rep to learn the lift direction.
class TiltRepCounter : public RepCounter {
 public:
  static constexpr float kAttemptTilt = 12.0f;     // degrees from the bottom that start an attempt
  static constexpr float kShallowFloor = 15.0f;    // an attempt this high but under the minimum is "shallow"
  static constexpr float kRestTilt = 6.0f;         // degrees from the bottom that end an attempt
  static constexpr float kStillStep = 2.0f;        // degrees per 250 ms window that still counts as still
  static constexpr uint32_t kMinRepMs = 500;
  static constexpr uint32_t kMinReturnMs = 100;
  static constexpr uint32_t kReanchorMs = 3000;    // still this long below the minimum: new resting position
  static constexpr uint32_t kGiveUpMs = 20000;     // held up this long without returning: new resting position
  static constexpr float kFilterSeconds = 0.4f;    // accelerometer correction time constant

  TiltRepCounter(float minimumTilt, float returnTilt) : minimumTilt_(minimumTilt), returnTilt_(returnTilt) {}

  // Gyro in deg/s (bias already removed), accel in g, time in ms. Returns true
  // on the sample where a rep is counted.
  bool update(float gx, float gy, float gz, const float accel[3], uint32_t nowMs) override {
    shallowAttempt_ = false;
    const uint32_t dt = nowMs - lastMs_;
    lastMs_ = nowMs;
    if (!hasLast_) {
      hasLast_ = true;
      return false;
    }
    if (dt > 200 || !validSample(gx, gy, gz, accel)) {
      // A gap in the data: the orientation can no longer be trusted.
      resetMotion(false);
      hasLast_ = true;
      return false;
    }
    if (dt == 0) return false;
    const float seconds = dt / 1000.0f;

    // 1. Orientation.
    const bool hadUp = gravity_.initialized();
    if (!gravity_.update(gx, gy, gz, accel, seconds)) return false;
    if (!hadUp) {
      setRest(nowMs);
      return false;
    }
    const float *up = gravity_.up();

    // 2. Stillness, judged by how far "up" moved over the last 250 ms, which
    //    ignores the gyro's tremor and noise.
    if (nowMs - windowStartMs_ >= 250) {
      const bool stillWindow = angleBetween(up, windowUp_) <= kStillStep;
      if (stillWindow) {
        if (!still_) stillSinceMs_ = windowStartMs_;
        still_ = true;
      } else {
        still_ = false;
      }
      for (int i = 0; i < 3; ++i) windowUp_[i] = up[i];
      windowStartMs_ = nowMs;
    }
    // Still only if the last full window was still AND the limb has not moved
    // since it ended (otherwise the first moments of a slow lift would still
    // look still for up to 250 ms).
    const bool stillNow = still_ && angleBetween(up, windowUp_) <= kStillStep;
    const uint32_t stillMs = stillNow ? nowMs - stillSinceMs_ : 0;

    // 3. Measure travel from the bottom of this rep, with a return near rest.
    const float tilt = angleBetween(up, rest_);

    if (phase_ == Idle) {
      if (!attempting_ && tilt < bottomTilt_) bottomTilt_ = tilt;
      const float travel = tilt - bottomTilt_;
      if (!attempting_ && travel >= kAttemptTilt) {
        attempting_ = true;
        attemptStartMs_ = nowMs;
        attemptPeak_ = travel;
      }
      if (attempting_) {
        if (travel > attemptPeak_) attemptPeak_ = travel;
        if (travel >= minimumTilt_ && inLiftDirection() && (hasDirection_ || tiltAxis(direction_))) {
          phase_ = Raised;
          raisedSinceMs_ = nowMs;
        } else if (travel <= kRestTilt) {
          shallowAttempt_ = attemptPeak_ >= kShallowFloor && attemptPeak_ < minimumTilt_ && inLiftDirection();
          attempting_ = false;
          if (tilt < bottomTilt_) bottomTilt_ = tilt;
        }
      }
      // Follow slow posture changes while resting, and adopt a new resting
      // position after holding still elsewhere for a few seconds.
      if (phase_ == Idle && stillNow) {
        if (tilt < kAttemptTilt && stillMs >= 500) {
          const float w = seconds / (2.0f + seconds);
          for (int i = 0; i < 3; ++i) rest_[i] += w * (up[i] - rest_[i]);
          GravityEstimate::normalize(rest_);
        } else if (stillMs >= kReanchorMs) {
          setRest(nowMs);
        }
      }
      return false;
    }

    // Raised: wait for the return.
    if (tilt <= returnTilt_) {
      const bool longEnough = nowMs - attemptStartMs_ >= kMinRepMs && nowMs - raisedSinceMs_ >= kMinReturnMs;
      phase_ = Idle;
      attempting_ = false;
      bottomTilt_ = tilt;
      if (longEnough) {
        hasDirection_ = true;
        ++count_;
        return true;
      }
      return false;
    }
    if (stillNow && stillMs >= kGiveUpMs) setRest(nowMs);  // never came back: this is the new rest
    return false;
  }

  void resetMotion(bool relearnAxis = false) override {
    phase_ = Idle;
    attempting_ = false;
    shallowAttempt_ = false;
    hasLast_ = false;
    gravity_.reset();
    still_ = false;
    if (relearnAxis) hasDirection_ = false;
  }

 private:
  enum Phase { Idle, Raised };

  static float angleBetween(const float a[3], const float b[3]) {
    const float cx = a[1] * b[2] - a[2] * b[1];
    const float cy = a[2] * b[0] - a[0] * b[2];
    const float cz = a[0] * b[1] - a[1] * b[0];
    const float d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return std::atan2(std::sqrt(cx * cx + cy * cy + cz * cz), d) * 57.29578f;
  }

  // The axis the limb turns about while leaving rest, as a unit vector.
  bool tiltAxis(float out[3]) const {
    const float *up = gravity_.up();
    out[0] = rest_[1] * up[2] - rest_[2] * up[1];
    out[1] = rest_[2] * up[0] - rest_[0] * up[2];
    out[2] = rest_[0] * up[1] - rest_[1] * up[0];
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
    return axis[0] * direction_[0] + axis[1] * direction_[1] + axis[2] * direction_[2] > 0.6f;  // within about 50 degrees of the learned axis
  }

  void setRest(uint32_t nowMs) {
    const float *up = gravity_.up();
    for (int i = 0; i < 3; ++i) rest_[i] = windowUp_[i] = up[i];
    windowStartMs_ = nowMs;
    phase_ = Idle;
    attempting_ = false;
    bottomTilt_ = 0.0f;
  }

  Phase phase_ = Idle;
  const float minimumTilt_;
  const float returnTilt_;
  GravityEstimate gravity_{kFilterSeconds};
  float rest_[3] = {0, 0, 1}, windowUp_[3] = {0, 0, 1}, direction_[3] = {0, 0, 0};
  uint32_t lastMs_ = 0, windowStartMs_ = 0, stillSinceMs_ = 0, attemptStartMs_ = 0, raisedSinceMs_ = 0;
  float bottomTilt_ = 0.0f, attemptPeak_ = 0.0f;
  bool hasLast_ = false, hasDirection_ = false, still_ = false, attempting_ = false;
};
