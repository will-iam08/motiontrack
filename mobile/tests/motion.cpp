// Simulated arm movements through the rep counters, checking that slow, small
// and slightly shaky reps (older patients, limited mobility) still count, while
// tiny wobbles and half movements do not.
#include <math.h>
#include <stdio.h>
#include "ArmCurlCounter.h"
#include "BackRowCounter.h"
#include "ShoulderPressCounter.h"

static int failures = 0;
#define CHECK(name, cond) do { if (cond) printf("ok   %s\n", name); else { printf("FAIL %s\n", name); ++failures; } } while (0)

// Feeds one rep: rotate about X up to `peak` degrees over `upMs`, pause, then
// back down to `endAngle` over `downMs`. `tremor` adds a small shake in deg/s.
static uint32_t rep(TiltRepCounter &counter, uint32_t now, float peak, uint32_t upMs, uint32_t downMs,
                    float endAngle = 0.0f, float tremor = 0.0f) {
  const uint32_t dt = 20;  // 50 Hz, as on the tracker
  float angle = 0.0f;
  auto sample = [&](float speed) {
    angle += speed * dt / 1000.0f;
    const float rad = angle * 3.14159265f / 180.0f;
    const float accel[3] = {0.0f, sinf(rad), cosf(rad)};
    const float shake = tremor * sinf(now * 0.06f);
    counter.update(speed + shake, 0.0f, 0.0f, accel, now);
    now += dt;
  };
  for (int i = 0; i < 25; ++i) sample(0.0f);  // rest
  const float upSpeed = peak * 1000.0f / upMs;
  for (uint32_t t = 0; t < upMs; t += dt) sample(upSpeed);
  for (int i = 0; i < 10; ++i) sample(0.0f);  // brief hold at the top
  const float downSpeed = (peak - endAngle) * 1000.0f / downMs;
  for (uint32_t t = 0; t < downMs; t += dt) sample(-downSpeed);
  for (int i = 0; i < 25; ++i) sample(0.0f);  // settle so the tilt estimate catches up
  return now;
}

int main() {
  {
    ArmCurlCounter curl;
    uint32_t now = 1000;
    { const uint32_t before = curl.count();
      now = rep(curl, now, 90.0f, 1000, 1000);
      CHECK("curl: full, normal-speed rep counts", curl.count() - before == 1u); }
    { const uint32_t before = curl.count();
      now = rep(curl, now, 30.0f, 2500, 2500);
      CHECK("curl: small 30-degree rep counts", curl.count() - before == 1u); }
    { const uint32_t before = curl.count();
      now = rep(curl, now, 45.0f, 4000, 4000);
      CHECK("curl: very slow rep (4 s up, 4 s down) counts", curl.count() - before == 1u); }
    { const uint32_t before = curl.count();
      now = rep(curl, now, 50.0f, 1500, 1500, 0.0f, 12.0f);
      CHECK("curl: slightly shaky rep counts", curl.count() - before == 1u); }
    { const uint32_t before = curl.count();
      now = rep(curl, now, 50.0f, 1500, 1500, 12.0f);
      CHECK("curl: lowered most of the way (12 degrees short) counts", curl.count() - before == 1u); }
    { const uint32_t before = curl.count();
      now = rep(curl, now, 8.0f, 800, 800);
      CHECK("curl: tiny 8-degree wobble does not count", curl.count() - before == 0u); }
    { const uint32_t before = curl.count();
      now = rep(curl, now, 60.0f, 1500, 1200, 40.0f);
      CHECK("curl: arm not lowered (stops 40 degrees up) does not count", curl.count() - before == 0u); }
  }
  {
    ShoulderPressCounter press;
    uint32_t now = 1000;
    { const uint32_t before = press.count();
      now = rep(press, now, 40.0f, 3000, 3000);
      CHECK("press: gentle 40-degree raise counts", press.count() - before == 1u); }
    { const uint32_t before = press.count();
      now = rep(press, now, 15.0f, 1500, 1500);
      CHECK("press: 15-degree shrug does not count", press.count() - before == 0u); }
  }
  {
    BackRowCounter row;
    uint32_t now = 1000;
    { const uint32_t before = row.count();
      now = rep(row, now, 25.0f, 2500, 2500);
      CHECK("row: short 25-degree pull counts", row.count() - before == 1u); }
    { const uint32_t before = row.count();
      now = rep(row, now, 8.0f, 800, 800);
      CHECK("row: tiny wobble does not count", row.count() - before == 0u); }
  }
  if (failures) {
    printf("%d motion test(s) failed\n", failures);
    return 1;
  }
  printf("all motion tests passed\n");
  return 0;
}
