#pragma once

#include "TiltRepCounter.h"

class BackRowCounter : public TiltRepCounter {
 public:
  // shortcut: upper-arm tilt targets are provisional until tested with the mounted sensor.
  // Pull back at least 20 degrees, then return to within 12 degrees of the start.
  BackRowCounter() : TiltRepCounter(20.0f, 12.0f) {}
};
