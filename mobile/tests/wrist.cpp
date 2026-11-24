#include <cassert>
#include <cmath>
#include <cstdio>
#include <random>
#include "BackRowCounter.h"
#include "ShoulderPressCounter.h"

// Feed gravity, vertical and horizontal motion, wrist rotation, and sensor noise
// together. An upright wrist can translate through an entire lift with zero tilt.
class WristTrace {
 public:
  WristTrace(RepCounter &counter, float pitch, unsigned seed)
      : counter_(counter), random_(seed), pitch_(pitch) {}

  void move(float rise, uint32_t ms, float turn = 0.0f, float horizontal = 0.0f) {
    const float seconds = ms / 1000.0f;
    for (uint32_t t = 20; t <= ms; t += 20) {
      const float u = static_cast<float>(t) / ms;
      const float ease = u*u*u*(10.0f + u*(-15.0f + 6.0f*u));
      const float angularSpeed = turn * 30.0f*u*u*(1-u)*(1-u) / seconds;
      const float curvature = 60.0f*u*(1-u)*(1-2*u) / (seconds*seconds);
      const float verticalG = 1.0f + rise * curvature / 9.80665f;
      const float horizontalG = horizontal * curvature / 9.80665f;
      const float angle = (pitch_ + turn * ease) * 0.01745329252f;
      const float s = std::sin(angle), c = std::cos(angle);
      const float accel[] = {noise_(random_), s*verticalG + c*horizontalG + noise_(random_),
                             c*verticalG - s*horizontalG + 0.003f + noise_(random_)};
      counter_.update(angularSpeed + 0.4f, 0.0f, 0.0f, accel, now_);
      warned |= counter_.shallowAttempt();
      now_ += 20;
    }
    pitch_ += turn;
  }

  void pause(uint32_t ms = 600) { move(0.0f, ms); }
  void gap() { now_ += 320; }

  void rep(float rise, uint32_t ms, float turn, float horizontal) {
    move(rise, ms, turn, horizontal);
    pause();
    move(-rise, ms, -turn, -horizontal);
    pause();
  }

  bool warned = false;

 private:
  RepCounter &counter_;
  std::mt19937 random_;
  std::normal_distribution<float> noise_{0.0f, 0.008f};
  float pitch_;
  uint32_t now_ = 1000;
};

int main() {
  unsigned valid = 0;
  for (uint32_t pace : {800u, 1400u, 2000u}) {
    for (unsigned mount = 0; mount < 8; ++mount) {
      ShoulderPressCounter press;
      BackRowCounter row;
      WristTrace p(press, mount * 45.0f, mount);
      WristTrace r(row, mount * 45.0f, mount + 40);
      assert(!press.ready() && !row.ready());
      p.pause();
      r.pause();
      assert(press.ready() && row.ready());
      for (unsigned rep = 1; rep <= 3; ++rep) {
        p.rep(0.31f, pace, 0.0f, 0.03f);
        r.rep(0.25f, pace, 12.0f, 0.16f);
        assert(press.count() == rep && row.count() == rep);
        valid += 2;
      }
    }
  }
  {
    ShoulderPressCounter press;
    WristTrace t(press, -65.0f, 71);
    t.pause();
    t.rep(0.075f, 900, 0.0f, 0.0f);
    assert(press.count() == 0 && t.warned);
    t.rep(0.0f, 1000, 30.0f, 0.26f);
    t.pause(5000);
    assert(press.count() == 0);
    t.move(0.31f, 1200);
    t.pause(2500);
    assert(press.count() == 0);
    t.move(-0.31f, 1200);
    t.pause();
    assert(press.count() == 1);
    t.move(0.31f, 1200);
    t.pause();
    t.gap();
    t.pause();
    t.move(-0.31f, 1200);
    t.pause();
    assert(press.count() == 1);
    press.resetMotion(true);
    assert(!press.ready() && press.count() == 1);
  }
  {
    BackRowCounter row;
    WristTrace t(row, 130.0f, 91);
    t.pause();
    t.move(0.25f, 1000, 15.0f, 0.16f);
    t.pause();
    t.move(-0.08f, 1000, -5.0f, -0.05f);
    t.pause();
    assert(row.count() == 0);
  }

  for (unsigned mount = 0; mount < 8; ++mount) {
    ShoulderPressCounter press;
    BackRowCounter row;
    WristTrace p(press, mount * 45.0f, mount + 102);
    WristTrace r(row, mount * 45.0f, mount + 244);
    p.pause();
    r.pause();
    for (unsigned rep = 0; rep < 5; ++rep) {
      const unsigned liftMs = 900 + rep * 140;
      const unsigned lowerMs = 1360 - rep * 80;
      p.move(0.30f, liftMs, 8.0f, 0.04f);
      p.move(-0.30f, lowerMs, -8.0f, -0.04f);
      r.move(0.24f, liftMs, 14.0f, 0.15f);
      r.move(-0.24f, lowerMs, -14.0f, -0.15f);
    }
    p.pause(850);
    r.pause(850);
    assert(press.count() == 5 && row.count() == 5);
    valid += 10;
  }
  printf("Wrist counts matched all %u simulated full press/row reps. Short lifts, incomplete returns, sideways motion, holds and dropouts passed.\n", valid);
}
