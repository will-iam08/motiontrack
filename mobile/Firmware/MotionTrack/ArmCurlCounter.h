#pragma once

#include "TiltRepCounter.h"

class ArmCurlCounter : public TiltRepCounter {
 public:
  // Lift at least 25 degrees, then lower to within 15 degrees of the start.
  ArmCurlCounter() : TiltRepCounter(25.0f, 15.0f) {}
};
