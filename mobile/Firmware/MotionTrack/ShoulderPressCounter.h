#pragma once

#include "WristRepCounter.h"

class ShoulderPressCounter : public WristRepCounter {
 public:
  // shortcut: verify the filtered range threshold against manual counts on the worn tracker.
  ShoulderPressCounter() : WristRepCounter(0.15f) {}
};
