#pragma once

#include "TiltRepCounter.h"

class ShoulderPressCounter : public TiltRepCounter {
 public:
  // shortcut: upper-arm tilt targets are provisional until tested with the mounted sensor.
  // Raise at least 35 degrees, then lower to within 20 degrees of the start.
  ShoulderPressCounter() : TiltRepCounter(35.0f, 20.0f) {}
};
