#pragma once

#include <cmath>

// A gyro-driven estimate of world up in the sensor's coordinate frame.
class GravityEstimate {
 public:
  explicit GravityEstimate(float correctionSeconds) : correctionSeconds_(correctionSeconds) {}

  bool update(float gx, float gy, float gz, const float accel[3], float seconds) {
    magnitude_ = magnitude(accel);
    speed_ = std::sqrt(gx * gx + gy * gy + gz * gz);
    const bool accelUsable = magnitude_ >= 0.75f && magnitude_ <= 1.25f;
    if (!initialized_) {
      if (!accelUsable) return false;
      for (int i = 0; i < 3; ++i) up_[i] = accel[i] / magnitude_;
      initialized_ = true;
      return true;
    }

    // The world frame rotates by -omega as seen by the sensor.
    const float k = 0.0174533f * seconds;
    const float wx = gx * k, wy = gy * k, wz = gz * k;
    const float ux = up_[0] - (wy * up_[2] - wz * up_[1]);
    const float uy = up_[1] - (wz * up_[0] - wx * up_[2]);
    const float uz = up_[2] - (wx * up_[1] - wy * up_[0]);
    up_[0] = ux; up_[1] = uy; up_[2] = uz;
    if (accelUsable) {
      const float weight = seconds / (correctionSeconds_ + seconds) / (1.0f + speed_ / 90.0f);
      for (int i = 0; i < 3; ++i) up_[i] += weight * (accel[i] / magnitude_ - up_[i]);
    }
    normalize(up_);
    return true;
  }

  bool initialized() const { return initialized_; }
  void reset() { initialized_ = false; }
  const float* up() const { return up_; }
  float accelMagnitude() const { return magnitude_; }
  float gyroSpeed() const { return speed_; }

  static void normalize(float v[3]) {
    const float n = magnitude(v);
    if (n > 1e-6f) for (int i = 0; i < 3; ++i) v[i] /= n;
  }

 private:
  static float magnitude(const float v[3]) {
    return std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  }

  const float correctionSeconds_;
  float up_[3] = {0, 0, 1};
  float magnitude_ = 0.0f, speed_ = 0.0f;
  bool initialized_ = false;
};
