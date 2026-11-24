// Simulated arm movements through the rep counters: real reps count, while
// wobbles, half movements and drift-speed motion do not.
#include <math.h>
#include <stdio.h>
#include "ArmCurlCounter.h"
#include "BackRowCounter.h"
#include "ShoulderPressCounter.h"

static int failures = 0;
#define CHECK(name, cond) do { if (cond) printf("ok   %s\n", name); else { printf("FAIL %s\n", name); ++failures; } } while (0)

// Feeds one movement: rotate about X up to `peak` degrees over `upMs`, hold,
// then back down to `endAngle` over `downMs`. `tremor` adds a shake in deg/s.
// Returns how many reps it added.
static uint32_t rep(TiltRepCounter &counter, uint32_t &now, float peak, uint32_t upMs, uint32_t downMs,
                    float endAngle = 0.0f, float tremor = 0.0f) {
  const uint32_t before = counter.count();
  const uint32_t dt = 20;  // 50 Hz, as on the tracker
  float angle = 0.0f;
  auto sample = [&](float speed) {
    angle += speed * dt / 1000.0f;
    const float rad = angle * 3.14159265f / 180.0f;
    const float accel[3] = {0.0f, sinf(rad), cosf(rad)};
    counter.update(speed + tremor * sinf(now * 0.06f), 0.0f, 0.0f, accel, now);
    now += dt;
  };
  for (int i = 0; i < 25; ++i) sample(0.0f);
  for (uint32_t t = 0; t < upMs; t += dt) sample(peak * 1000.0f / upMs);
  for (int i = 0; i < 10; ++i) sample(0.0f);
  for (uint32_t t = 0; t < downMs; t += dt) sample(-(peak - endAngle) * 1000.0f / downMs);
  for (int i = 0; i < 25; ++i) sample(0.0f);
  return counter.count() - before;
}

int main() {
  {
    ArmCurlCounter curl;
    uint32_t now = 1000;
    CHECK("curl: full rep counts", rep(curl, now, 90.0f, 1000, 1000) == 1);
    CHECK("curl: steady 55-degree rep counts", rep(curl, now, 55.0f, 1200, 1200) == 1);
    CHECK("curl: slow 4-second curl counts", rep(curl, now, 60.0f, 4000, 4000) == 1);
    CHECK("curl: 40-degree near miss does not count", rep(curl, now, 40.0f, 1200, 1200) == 0);
    CHECK("curl: slightly shaky rep counts", rep(curl, now, 60.0f, 1200, 1200, 0.0f, 8.0f) == 1);
    CHECK("curl: lowered to within 15 degrees counts", rep(curl, now, 60.0f, 1200, 1200, 15.0f) == 1);
    CHECK("curl: 25-degree half curl does not count", rep(curl, now, 25.0f, 600, 600) == 0);
    CHECK("curl: 8-degree wobble does not count", rep(curl, now, 8.0f, 200, 200) == 0);
    CHECK("curl: drift-speed creep does not count", rep(curl, now, 40.0f, 6000, 6000) == 0);
    // Last, because it leaves the simulated arm raised.
    CHECK("curl: arm left raised does not count", rep(curl, now, 70.0f, 1200, 800, 40.0f) == 0);
  }
  {
    ShoulderPressCounter press;
    uint32_t now = 1000;
    CHECK("press: 70-degree raise counts", rep(press, now, 70.0f, 1500, 1500) == 1);
    CHECK("press: 30-degree shrug does not count", rep(press, now, 30.0f, 700, 700) == 0);
  }
  {
    BackRowCounter row;
    uint32_t now = 1000;
    CHECK("row: 45-degree pull counts", rep(row, now, 45.0f, 1000, 1000) == 1);
    CHECK("row: wobble does not count", rep(row, now, 8.0f, 200, 200) == 0);
  }
  if (failures) {
    printf("%d motion test(s) failed\n", failures);
    return 1;
  }
  printf("all motion tests passed\n");
  return 0;
}
