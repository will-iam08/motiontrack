#pragma once

#include "WristRepCounter.h"

class BackRowCounter : public WristRepCounter {
 public:
  // shortcut: verify the filtered range threshold against manual counts on the worn tracker.
  BackRowCounter() : WristRepCounter(0.125f) {}
};
