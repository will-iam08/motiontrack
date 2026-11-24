#pragma once

#include <cmath>
#include <stdint.h>

class RepCounter {
 public:
  virtual ~RepCounter() = default;
  virtual bool update(float gx, float gy, float gz, const float accel[3], uint32_t nowMs) = 0;
  virtual void resetMotion(bool relearnAxis = false) = 0;
  virtual bool ready() const { return true; }

  uint32_t count() const { return count_; }
  bool shallowAttempt() const { return shallowAttempt_; }

 protected:
  static bool validSample(float gx, float gy, float gz, const float accel[3]) {
    return std::isfinite(gx) && std::isfinite(gy) && std::isfinite(gz) &&
           std::isfinite(accel[0]) && std::isfinite(accel[1]) && std::isfinite(accel[2]);
  }

  uint32_t count_ = 0;
  bool shallowAttempt_ = false;
};
