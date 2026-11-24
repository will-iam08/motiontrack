#pragma once

#include "TiltRepCounter.h"

class BackRowCounter : public TiltRepCounter {
 public:
  // shortcut: upper-arm tilt targets are provisional until tested with the mounted sensor.
  // Pull back at least 40 degrees from rest, then return to within 12 degrees of it.
  BackRowCounter() : TiltRepCounter(40.0f, 12.0f) {}
};
