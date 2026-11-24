// Simulated arm movements through the rep counters: real reps count, while
// wobbles, half movements and drift-speed motion do not.
#include <math.h>
#include <stdio.h>
#include "ArmCurlCounter.h"

static int failures = 0;
#define CHECK(name, cond) do { if (cond) printf("ok   %s\n", name); else { printf("FAIL %s\n", name); ++failures; } } while (0)

// Play a continuous piece of a movement at the firmware's 50 Hz sample rate.
static void move(TiltRepCounter &counter, uint32_t &now, float start, float end, uint32_t ms,
                 float tremor = 0.0f, bool sideways = false) {
  const uint32_t dt = 20;
  const float speed = (end - start) * 1000.0f / ms;
  for (uint32_t t = dt; t <= ms; t += dt) {
    const float angle = start + (end - start) * t / ms;
    const float rad = angle * 3.14159265f / 180.0f;
    const float accel[3] = {sideways ? -sinf(rad) : 0.0f, sideways ? 0.0f : sinf(rad), cosf(rad)};
    const float rate = speed + tremor * sinf(now * 0.06f);
    counter.update(sideways ? 0.0f : rate, sideways ? rate : 0.0f, 0.0f, accel, now);
    now += dt;
  }
}

// Feeds one movement: rotate about X up to `peak` degrees over `upMs`, hold,
// then back down to `endAngle` over `downMs`. `tremor` adds a shake in deg/s.
// Returns how many reps it added.
static uint32_t rep(TiltRepCounter &counter, uint32_t &now, float peak, uint32_t upMs, uint32_t downMs,
                    float endAngle = 0.0f, float tremor = 0.0f) {
  const uint32_t before = counter.count();
  move(counter, now, 0.0f, 0.0f, 500, tremor);
  move(counter, now, 0.0f, peak, upMs, tremor);
  move(counter, now, peak, peak, 200, tremor);
  move(counter, now, peak, endAngle, downMs, tremor);
  move(counter, now, endAngle, endAngle, 500, tremor);
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
    ArmCurlCounter curl;
    uint32_t now = 1000;
    move(curl, now, 0.0f, 0.0f, 600);
    move(curl, now, 0.0f, 50.0f, 220, 0.0f, true);
    move(curl, now, 50.0f, 0.0f, 220, 0.0f, true);
    move(curl, now, 0.0f, 0.0f, 500);
    CHECK("curl: fast sideways flick does not count", curl.count() == 0);
    move(curl, now, 0.0f, 72.0f, 360);
    move(curl, now, 72.0f, 0.0f, 360);
    CHECK("curl: quick full rep counts after a rejected motion in another direction", curl.count() == 1);
  }
  {
    ArmCurlCounter curl;
    uint32_t now = 1000;
    CHECK("curl: full rep with a slightly raised return counts", rep(curl, now, 75.0f, 1000, 1000, 18.0f) == 1);
    for (int i = 0; i < 2; ++i) {
      move(curl, now, 18.0f, 51.0f, 800);
      move(curl, now, 51.0f, 18.0f, 800);
      move(curl, now, 18.0f, 18.0f, 400);
    }
    CHECK("curl: two short lifts from a raised bottom do not add reps", curl.count() == 1);
  }
  if (failures) {
    printf("%d motion test(s) failed\n", failures);
    return 1;
  }
  printf("all motion tests passed\n");
  return 0;
}
