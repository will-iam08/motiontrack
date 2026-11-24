#pragma once

#include "TiltRepCounter.h"

class ArmCurlCounter : public TiltRepCounter {
 public:
  // Lift at least 45 degrees from rest, then lower to within 20 degrees of it.
  ArmCurlCounter() : TiltRepCounter(45.0f, 20.0f) {}
};
