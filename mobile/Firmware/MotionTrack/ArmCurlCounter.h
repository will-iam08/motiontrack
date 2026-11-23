#pragma once

#include "TiltRepCounter.h"

class ArmCurlCounter : public TiltRepCounter {
 public:
  // Lift at least 35 degrees, then lower to within 20 degrees of the start.
  ArmCurlCounter() : TiltRepCounter(35.0f, 20.0f) {}
};
