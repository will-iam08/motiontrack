#pragma once

#include "TiltRepCounter.h"

class ShoulderPressCounter : public TiltRepCounter {
 public:
  // shortcut: upper-arm tilt targets are provisional until tested with the mounted sensor.
  // Raise at least 60 degrees from rest, then lower to within 20 degrees of it.
  ShoulderPressCounter() : TiltRepCounter(60.0f, 20.0f) {}
};
