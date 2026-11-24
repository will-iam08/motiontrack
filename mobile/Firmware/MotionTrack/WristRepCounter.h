#pragma once

#include "GravityEstimate.h"
#include "RepCounter.h"

// Track consecutive upward and downward strokes from the vertical acceleration.
class WristRepCounter : public RepCounter {
 public:
  explicit WristRepCounter(float minimumTravel) : minimumTravel_(minimumTravel) {}

  bool update(float gx, float gy, float gz, const float accel[3], uint32_t nowMs) override {
    shallowAttempt_ = false;
    const uint32_t dt = nowMs - lastMs_;
    lastMs_ = nowMs;
    if (!hasLast_) {
      hasLast_ = true;
      return false;
    }
    if (dt > 200 || !validSample(gx, gy, gz, accel)) {
      resetMotion();
      return false;
    }
    if (dt == 0) return false;
    const float seconds = dt / 1000.0f;
    if (!gravity_.update(gx, gy, gz, accel, seconds)) return false;
    const float *up = gravity_.up();
    const float verticalG = up[0] * accel[0] + up[1] * accel[1] + up[2] * accel[2];

    if (!ready_) {
      captureRest(verticalG, dt);
      return false;
    }

    // Follow slow bias changes without requiring a pause between strokes.
    restG_ += seconds / (4.0f + seconds) * (verticalG - restG_);
    const float acceleration = (verticalG - restG_) * 9.80665f;
    filteredAcceleration_ += seconds / (0.04f + seconds) * (acceleration - filteredAcceleration_);
    const float a = filteredAcceleration_;
    velocity_ = (velocity_ + a * seconds) / (1.0f + seconds / kVelocitySeconds);

    const bool quiet = std::fabs(a) < kQuietAccel && gravity_.gyroSpeed() < 22.0f;
    quietMs_ = quiet ? quietMs_ + dt : 0;

    if (lift_ > 0.0f && nowMs - raisedAtMs_ > kMaxTopPauseMs) lift_ = 0.0f;
    if (direction_ == 0) {
      if (quietMs_ >= kStopMs) velocity_ = 0.0f;
      const float absVelocity = std::fabs(velocity_);
      if (absVelocity < kStartSpeed || (a * velocity_) < 0.0f) return false;
      direction_ = velocity_ > 0.0f ? 1 : -1;
    }

    const float signedSpeed = velocity_ * direction_;
    const float signedAcceleration = a * direction_;
    strokeMs_ += dt;
    if (strokeMs_ > kMaxStrokeMs) {
      clearStroke();
      lift_ = velocity_ = 0.0f;
      return false;
    }

    if (signedSpeed > 0.0f) travel_ += signedSpeed * seconds;
    if (signedSpeed > peakSpeed_) peakSpeed_ = signedSpeed;
    accelerated_ |= signedAcceleration > kProofAccel && signedSpeed > 0.0f;
    braked_ |= signedAcceleration < -kProofAccel && peakSpeed_ >= kStartSpeed;

    const bool reversed = signedSpeed <= -kTurnSpeed;
    const bool stopped = quietMs_ >= kStopMs && (signedSpeed < peakSpeed_ * 0.55f || quietMs_ >= kLongPauseMs);
    if (!reversed && !stopped) return false;

    const uint32_t movingMs = strokeMs_ - (stopped && strokeMs_ >= quietMs_ ? quietMs_ : 0U);
    // Offset some of the damping on longer strokes before checking their range.
    const float range = travel_ * (1.0f + movingMs / (2000.0f * kVelocitySeconds));
    const int8_t direction = direction_;
    const bool valid = accelerated_ && braked_ && movingMs >= kMinStrokeMs && range >= kShallowFloor;
    clearStroke();
    if (reversed) {
      direction_ = -direction;
      accelerated_ = signedAcceleration < -kProofAccel;
    } else {
      velocity_ = 0.0f;
    }
    if (!valid) return false;

    if (direction > 0) {
      lift_ = range;
      raisedAtMs_ = nowMs;
      return false;
    }

    const float lift = lift_;
    if (lift < kShallowFloor || range < lift * 0.42f) return false;
    lift_ = 0.0f;
    if (range > lift * 3.8f) return false;
    if (lift < minimumTravel_ * 0.8f || range < minimumTravel_ * 0.68f ||
        lift + range < 2.0f * minimumTravel_) {
      shallowAttempt_ = true;
      return false;
    }
    ++count_;
    return true;
  }

  bool ready() const override { return ready_; }

  void resetMotion(bool = false) override {
    gravity_.reset();
    hasLast_ = ready_ = shallowAttempt_ = false;
    restMs_ = quietMs_ = 0;
    lift_ = filteredAcceleration_ = velocity_ = 0.0f;
    clearStroke();
  }

 private:
  static constexpr float kVelocitySeconds = 1.6f;
  static constexpr float kStartSpeed = 0.027f;       // m/s
  static constexpr float kTurnSpeed = 0.016f;
  static constexpr float kProofAccel = 0.085f;       // m/s²
  static constexpr float kQuietAccel = 0.135f;
  static constexpr float kShallowFloor = 0.027f;     // m
  static constexpr uint32_t kRestMs = 300;
  static constexpr uint32_t kStopMs = 190;
  static constexpr uint32_t kLongPauseMs = 480;
  static constexpr uint32_t kMinStrokeMs = 220;
  static constexpr uint32_t kMaxStrokeMs = 5500;
  static constexpr uint32_t kMaxTopPauseMs = 8000;

  void captureRest(float verticalG, uint32_t dt) {
    if (gravity_.gyroSpeed() > 20.0f || std::fabs(gravity_.accelMagnitude() - 1.0f) > 0.15f) {
      restMs_ = 0;
      return;
    }
    if (restMs_ == 0 || std::fabs(verticalG - restG_) > 0.035f) {
      restG_ = verticalG;
      restMs_ = dt;
      return;
    }
    restMs_ += dt;
    restG_ += static_cast<float>(dt) / restMs_ * (verticalG - restG_);
    ready_ = restMs_ >= kRestMs;
  }

  void clearStroke() {
    direction_ = 0;
    strokeMs_ = 0;
    travel_ = peakSpeed_ = 0.0f;
    accelerated_ = braked_ = false;
  }

  const float minimumTravel_;
  GravityEstimate gravity_{1.0f};
  uint32_t lastMs_ = 0, restMs_ = 0, strokeMs_ = 0, quietMs_ = 0, raisedAtMs_ = 0;
  float restG_ = 1.0f, filteredAcceleration_ = 0.0f, velocity_ = 0.0f;
  float travel_ = 0.0f, peakSpeed_ = 0.0f, lift_ = 0.0f;
  int8_t direction_ = 0;
  bool hasLast_ = false, ready_ = false, accelerated_ = false, braked_ = false;
};
