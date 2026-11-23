#pragma once

#include <cmath>
#include <stdint.h>

// shortcut: learns direction from the first swing. Reselect the exercise after remounting.
//
// Tuned to be forgiving for older patients and people with limited mobility:
// slow, small or slightly shaky reps still count, as long as the arm really
// goes up and comes back down.
class TiltRepCounter {
 public:
  static constexpr float kStartSpeed = 10.0f;     // deg/s that starts a lift (slow lifts count)
  static constexpr float kReverseSpeed = 10.0f;   // deg/s downward that ends the lift
  static constexpr float kAxisLearnSpeed = 10.0f; // deg/s needed to learn the swing axis
  static constexpr float kDeadband = 5.0f;         // deg/s treated as holding still
  static constexpr float kMinSwing = 10.0f;       // degrees each way, from the gyro
  static constexpr float kTremorSpeed = 45.0f;    // upward jerks below this while lowering are ignored
  static constexpr uint32_t kMaxRepMs = 15000;    // a single rep may take up to 15 s

  TiltRepCounter(float minimumTilt, float returnTilt) : minimumTilt_(minimumTilt), returnTilt_(returnTilt) {}

  bool update(float gx, float gy, float gz, const float accel[3], uint32_t nowMs) {
    shallowAttempt_ = false;
    const uint32_t dt = nowMs - lastMs_;
    lastMs_ = nowMs;
    if (!hasLast_) {
      hasLast_ = true;
      return false;
    }
    if (dt > 200 || !std::isfinite(gx) || !std::isfinite(gy) || !std::isfinite(gz)) {
      discardMovement();
      hasTilt_ = false;
      return false;
    }
    if (dt == 0) return false;
    const float accelSquared = accel[0] * accel[0] + accel[1] * accel[1] + accel[2] * accel[2];
    const bool tiltUsable = accelSquared >= 0.75f * 0.75f && accelSquared <= 1.25f * 1.25f;
    if (tiltUsable) {
      const float weight = hasTilt_ ? dt / (60.0f + dt) : 1.0f;
      for (int i = 0; i < 3; ++i) tilt_[i] += weight * (accel[i] - tilt_[i]);
      hasTilt_ = true;
    }
    const float gyro[] = {gx, gy, gz};
    if (axis_ < 0) {
      int strongest = 0;
      for (int i = 1; i < 3; ++i) {
        if (std::fabs(gyro[i]) > std::fabs(gyro[strongest])) strongest = i;
      }
      if (!tiltUsable || std::fabs(gyro[strongest]) < kAxisLearnSpeed) return false;
      axis_ = strongest;
      sign_ = gyro[axis_] > 0.0f ? 1.0f : -1.0f;
    }
    float speed = gyro[axis_] * sign_;
    if (std::fabs(speed) < kDeadband) speed = 0.0f;
    if (phase_ == Idle) {
      if (tiltUsable && speed >= kStartSpeed) {
        for (int i = 0; i < 3; ++i) startTilt_[i] = tilt_[i];
        phase_ = Rising;
        cycleStartMs_ = phaseStartMs_ = nowMs;
      }
      return false;
    }
    if (nowMs - cycleStartMs_ > kMaxRepMs) {
      discardMovement();
      return false;
    }
    const float degrees = speed * static_cast<float>(dt) / 1000.0f;
    const float tiltDelta = tiltUsable ? angleFromStart() : -1.0f;
    if (phase_ == Rising) {
      if (tiltDelta >= minimumTilt_) reachedTilt_ = true;
      if (speed <= -kReverseSpeed) {
        const bool liftQualified = upDegrees_ >= kMinSwing && nowMs - phaseStartMs_ >= 100;
        shallowAttempt_ = liftQualified && !reachedTilt_ && tiltDelta >= 0.0f;
        if (!liftQualified || !reachedTilt_) {
          discardMovement();
        } else {
          phase_ = Falling;
          phaseStartMs_ = nowMs;
        }
      } else {
        upDegrees_ += degrees;
        if (upDegrees_ < 0.0f) upDegrees_ = 0.0f;
      }
      return false;
    }
    if (speed >= kTremorSpeed) {
      discardMovement();
      return false;
    }
    downDegrees_ -= degrees;
    if (downDegrees_ < 0.0f) downDegrees_ = 0.0f;
    // The return must qualify while moving, even if the tilt estimate settles later.
    if (speed < 0.0f && downDegrees_ >= kMinSwing && nowMs - phaseStartMs_ >= 100 &&
        nowMs - cycleStartMs_ >= 500) {
      returnQualified_ = true;
    }
    if (returnQualified_ && tiltDelta >= 0.0f && tiltDelta <= returnTilt_) {
      ++count_;
      discardMovement();
      return true;
    }
    return false;
  }

  void resetMotion(bool relearnAxis = false) {
    discardMovement();
    shallowAttempt_ = false;
    hasLast_ = false;
    hasTilt_ = false;
    if (relearnAxis) axis_ = -1;
  }

  uint32_t count() const { return count_; }
  bool shallowAttempt() const { return shallowAttempt_; }

 private:
  enum Phase { Idle, Rising, Falling };

  float angleFromStart() const {
    const float x = startTilt_[1] * tilt_[2] - startTilt_[2] * tilt_[1];
    const float y = startTilt_[2] * tilt_[0] - startTilt_[0] * tilt_[2];
    const float z = startTilt_[0] * tilt_[1] - startTilt_[1] * tilt_[0];
    const float dot = startTilt_[0] * tilt_[0] + startTilt_[1] * tilt_[1] + startTilt_[2] * tilt_[2];
    if (x == 0.0f && y == 0.0f && z == 0.0f && dot == 0.0f) return -1.0f;
    return std::atan2(std::sqrt(x * x + y * y + z * z), dot) * 57.29578f;
  }

  void discardMovement() {
    phase_ = Idle;
    upDegrees_ = downDegrees_ = 0.0f;
    reachedTilt_ = returnQualified_ = false;
  }

  Phase phase_ = Idle;
  int axis_ = -1;
  float sign_ = 1.0f;
  float upDegrees_ = 0.0f, downDegrees_ = 0.0f;
  const float minimumTilt_;
  const float returnTilt_;
  float tilt_[3] = {}, startTilt_[3] = {};
  uint32_t count_ = 0, lastMs_ = 0, cycleStartMs_ = 0, phaseStartMs_ = 0;
  bool hasLast_ = false, hasTilt_ = false;
  bool reachedTilt_ = false, returnQualified_ = false;
  bool shallowAttempt_ = false;
};
