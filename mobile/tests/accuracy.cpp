// Accuracy benchmark for the rep counters, using simulated IMU data.
//
// Simulates the MPU6050 at 50 Hz on a rotating limb: random mounting angle,
// gyro and accelerometer noise, leftover gyro bias, the limb's own
// acceleration (tangential + centripetal), and, for older users, slower and
// smaller reps, pauses, incomplete lowering and hand tremor. Movements that
// must NOT count (half reps, wobble, tremor at rest, strap adjustments, arm
// swing, a slow change of resting position) are scored separately.
//
// This measures the algorithm against a model of movement. It is not a
// substitute for comparing the tracker with manual counts on real people.
//
// Usage: accuracy [--compare]   (--compare also scores the previous counter)
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <random>
#include <vector>
#include "ArmCurlCounter.h"
#include "BackRowCounter.h"
#include "ShoulderPressCounter.h"
#include "legacy/TiltRepCounterV5.h"

namespace {

struct Vec { double x, y, z; };
Vec add(Vec a, Vec b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec scale(Vec a, double s) { return {a.x * s, a.y * s, a.z * s}; }
Vec cross(Vec a, Vec b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
double dot(Vec a, Vec b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec unit(Vec a) { const double n = sqrt(dot(a, a)); return scale(a, 1.0 / n); }

// Rotation of v about unit axis k by angle a (Rodrigues).
Vec rotate(Vec v, Vec k, double a) {
  return add(add(scale(v, cos(a)), scale(cross(k, v), sin(a))), scale(k, dot(k, v) * (1 - cos(a))));
}

struct Mount { Vec ex, ey, ez; };  // sensor axes expressed in the limb frame
Vec toSensor(const Mount &m, Vec v) { return {dot(v, m.ex), dot(v, m.ey), dot(v, m.ez)}; }

Mount randomMount(std::mt19937 &rng) {
  std::uniform_real_distribution<double> u(-1, 1);
  Vec axis = unit({u(rng), u(rng), u(rng)});
  const double angle = 3.14159265 * u(rng);
  return {rotate({1, 0, 0}, axis, angle), rotate({0, 1, 0}, axis, angle), rotate({0, 0, 1}, axis, angle)};
}

// One continuous recording. angle(t) is the limb's rotation about the limb x
// axis in degrees; the simulator differentiates it.
struct Recording {
  std::vector<double> angle;  // degrees, one per 20 ms sample
  std::vector<double> tremor; // extra angular speed, deg/s
};

const double DT = 0.02;

// Sensor imperfections. The stress run doubles them; the counter was not tuned on it.
struct SensorModel { double bias, gyroNoise, accelNoise, wobble; };
SensorModel gSensor = {1.5, 0.4, 0.012, 0.15};

// Smooth 0→1 step (minimum-jerk profile), as real reps look.
double ease(double s) { s = s < 0 ? 0 : s > 1 ? 1 : s; return s * s * s * (10 - 15 * s + 6 * s * s); }

void hold(Recording &r, double deg, double seconds) {
  for (int i = 0; i < int(seconds / DT); ++i) r.angle.push_back(deg);
}
void move(Recording &r, double from, double to, double seconds) {
  const int n = int(seconds / DT);
  for (int i = 1; i <= n; ++i) r.angle.push_back(from + (to - from) * ease(double(i) / n));
}

template <class Counter>
uint32_t play(Counter &counter, const Recording &rec, std::mt19937 &rng, double tremorAmp, double tremorHz) {
  std::normal_distribution<double> gyroNoise(0, gSensor.gyroNoise), accelNoise(0, gSensor.accelNoise);
  std::uniform_real_distribution<double> u(-1, 1);
  const Mount mount = randomMount(rng);
  // Resting "up" direction in the limb frame: mostly perpendicular to the
  // rotation axis, with a small random lean.
  const Vec up0 = unit({0.25 * u(rng), 0.3 * u(rng), 1.0});
  const Vec radius = unit({0, 0.2 * u(rng), -1.0});       // elbow → sensor, limb frame
  const double r = 0.18 + 0.1 * (u(rng) + 1) / 2;         // metres
  const Vec bias = scale({u(rng), u(rng), u(rng)}, gSensor.bias);  // leftover deg/s after calibration
  const Vec wobbleAxis = unit({0, u(rng), u(rng)});
  const double phase = 6.28 * (u(rng) + 1);
  uint32_t now = 1000 + uint32_t(500 * (u(rng) + 1));
  double prevRate = 0;
  for (size_t i = 0; i < rec.angle.size(); ++i) {
    const double a = rec.angle[i];
    const double prev = i ? rec.angle[i - 1] : a;
    double rate = (a - prev) / DT;                                     // deg/s
    const double t = i * DT;
    const double trem = tremorAmp * sin(6.2832 * tremorHz * t + phase);
    rate += trem;
    const double accelRad = (rate - prevRate) / DT * 3.14159265 / 180;  // rad/s²
    prevRate = rate;
    const double rateRad = rate * 3.14159265 / 180;
    // Gravity seen by the limb: "up" rotates opposite to the limb's rotation.
    const Vec up = rotate(up0, {1, 0, 0}, -a * 3.14159265 / 180);
    const Vec tangential = scale(cross({1, 0, 0}, radius), accelRad * r / 9.81);
    const Vec centripetal = scale(radius, -rateRad * rateRad * r / 9.81);
    Vec specific = add(add(up, tangential), centripetal);
    Vec omega = add(scale({1, 0, 0}, rate), scale(wobbleAxis, gSensor.wobble * rate * sin(t * 2.1)));
    const Vec gs = toSensor(mount, omega);
    const Vec as = toSensor(mount, specific);
    const float accel[3] = {float(as.x + accelNoise(rng)), float(as.y + accelNoise(rng)), float(as.z + accelNoise(rng))};
    counter.update(float(gs.x + bias.x + gyroNoise(rng)), float(gs.y + bias.y + gyroNoise(rng)),
                   float(gs.z + bias.z + gyroNoise(rng)), accel, now);
    now += 20;
  }
  return counter.count();
}

struct Range { double lo, hi; };
double pick(std::mt19937 &rng, Range r) { return std::uniform_real_distribution<double>(r.lo, r.hi)(rng); }

struct Population {
  const char *name;
  Range peakOver;   // degrees ABOVE the exercise's minimum tilt
  Range upSec, downSec, holdSec, restSec;
  Range endShortOf; // degrees short of the start when lowered
  Range tremor;     // deg/s amplitude at 4–6 Hz
};

struct Exercise { const char *name; float minTilt, returnTilt; };
const Exercise EXERCISES[] = {{"Biceps curl", 35, 20}, {"Shoulder press", 50, 20}, {"Back row", 30, 12}};

template <class Counter>
struct Score { long expected = 0, counted = 0, overCount = 0, underCount = 0, sessions = 0, perfect = 0; };

template <class Counter>
Score<Counter> scorePositives(const Exercise &ex, const Population &pop, int sessions, unsigned seed) {
  Score<Counter> s;
  std::mt19937 rng(seed);
  for (int k = 0; k < sessions; ++k) {
    Recording rec;
    hold(rec, 0, pick(rng, {1.0, 2.0}));
    const int reps = 10;
    for (int i = 0; i < reps; ++i) {
      const double peak = ex.minTilt + pick(rng, pop.peakOver);
      const double end = std::min(pick(rng, pop.endShortOf), double(ex.returnTilt) - 4);
      move(rec, 0, peak, pick(rng, pop.upSec));
      hold(rec, peak, pick(rng, pop.holdSec));
      move(rec, peak, end, pick(rng, pop.downSec));
      move(rec, end, 0, 0.6);  // settle back to rest
      hold(rec, 0, pick(rng, pop.restSec));
    }
    Counter c(ex.minTilt, ex.returnTilt);
    const uint32_t got = play(c, rec, rng, pick(rng, pop.tremor), 4 + 2 * pick(rng, {0, 1}));
    s.expected += reps;
    s.counted += std::min<long>(got, reps);
    if (long(got) > reps) s.overCount += got - reps;
    if (long(got) < reps) s.underCount += reps - got;
    s.sessions++;
    if (long(got) == reps) s.perfect++;
  }
  return s;
}

// Movements that must not count. Returns false counts over all sessions.
template <class Counter>
long scoreNegative(const Exercise &ex, int kind, int sessions, unsigned seed) {
  std::mt19937 rng(seed);
  long falseReps = 0;
  for (int k = 0; k < sessions; ++k) {
    Recording rec;
    double tremor = 0, hz = 5;
    hold(rec, 0, 1.5);
    switch (kind) {
      case 0:  // half reps: lift to well under the minimum, lower again
        for (int i = 0; i < 10; ++i) {
          const double peak = pick(rng, {8, ex.minTilt - 12});
          move(rec, 0, peak, pick(rng, {0.6, 2.5}));
          hold(rec, peak, pick(rng, {0, 1}));
          move(rec, peak, 0, pick(rng, {0.6, 2.5}));
          hold(rec, 0, pick(rng, {0.3, 1.5}));
        }
        break;
      case 1:  // tremor at rest
        hold(rec, 0, 30);
        tremor = pick(rng, {8, 20});
        break;
      case 2:  // strap adjustments: quick small jerks either way
        for (int i = 0; i < 15; ++i) {
          const double peak = pick(rng, {-15, 15});
          move(rec, 0, peak, 0.15);
          move(rec, peak, 0, 0.2);
          hold(rec, 0, pick(rng, {0.5, 2}));
        }
        break;
      case 3:  // walking arm swing, ±(10–22)° at about 1 Hz
        {
          const double amp = pick(rng, {10, 22});
          for (int i = 0; i < 20; ++i) { move(rec, 0, amp, 0.25); move(rec, amp, -amp, 0.5); move(rec, -amp, 0, 0.25); }
        }
        break;
      case 4:  // changes resting position and stays there (no return)
        {
          const double to = ex.minTilt + pick(rng, {5, 30});
          move(rec, 0, to, pick(rng, {1.5, 4}));
          hold(rec, to, 40);
        }
        break;
    }
    Counter c(ex.minTilt, ex.returnTilt);
    falseReps += play(c, rec, rng, tremor, hz);
  }
  return falseReps;
}

const Population POPULATIONS[] = {
  // name, peak over min, up s, down s, hold s, rest s, end short of start, tremor
  {"Typical adult", {20, 60}, {0.6, 1.4}, {0.6, 1.4}, {0.0, 0.5}, {0.3, 1.5}, {0, 6}, {0, 3}},
  {"Older adult, slow", {10, 45}, {1.5, 4.0}, {1.5, 4.0}, {0.0, 2.0}, {0.5, 3.0}, {0, 12}, {0, 6}},
  {"Older adult, small range", {3, 15}, {1.0, 3.0}, {1.0, 3.0}, {0.0, 1.5}, {0.5, 3.0}, {0, 12}, {0, 6}},
  {"Older adult, tremor", {10, 45}, {1.2, 3.5}, {1.2, 3.5}, {0.0, 1.5}, {0.5, 3.0}, {0, 10}, {6, 14}},
  {"Very slow (6–8 s per lift)", {10, 40}, {6.0, 8.0}, {5.0, 8.0}, {0.0, 3.0}, {1.0, 3.0}, {0, 10}, {0, 5}},
};
const char *NEGATIVES[] = {"Half reps", "Tremor at rest", "Strap adjustments", "Walking arm swing", "New resting position"};

const Population STRESS[] = {
  {"Back-to-back, no pause", {8, 50}, {0.8, 3.0}, {0.8, 3.0}, {0.0, 1.0}, {0.0, 0.2}, {0, 12}, {0, 10}},
  {"Mixed older adults", {5, 45}, {1.0, 6.0}, {1.0, 6.0}, {0.0, 3.0}, {0.2, 3.0}, {0, 14}, {0, 14}},
};

template <class Counter>
bool report(const char *label, bool strict, bool stress = false) {
  printf("\n== %s ==\n", label);
  bool ok = true;
  for (const Exercise &ex : EXERCISES) {
    printf("%s\n", ex.name);
    long totalExp = 0, totalGot = 0, totalOver = 0;
    unsigned seed = stress ? 9001 : 7;
    const Population *pops = stress ? STRESS : POPULATIONS;
    const int popCount = stress ? 2 : 5;
    for (int pi = 0; pi < popCount; ++pi) {
      const Population &pop = pops[pi];
      Score<Counter> s = scorePositives<Counter>(ex, pop, 200, seed++);
      totalExp += s.expected; totalGot += s.counted; totalOver += s.overCount;
      printf("  %-30s %6.2f%% counted  %3ld extra  %5.1f%% sets exact\n", pop.name,
             100.0 * s.counted / s.expected, s.overCount, 100.0 * s.perfect / s.sessions);
    }
    long falseTotal = 0;
    for (int kind = 0; kind < 5; ++kind) {
      const long f = scoreNegative<Counter>(ex, kind, 200, (stress ? 9100 : 100) + kind);
      falseTotal += f;
      printf("  %-30s %4ld false reps in 200 sessions\n", NEGATIVES[kind], f);
    }
    const double recall = 100.0 * totalGot / totalExp;
    printf("  -> overall %.2f%% of %ld reps counted, %ld extra, %ld false\n", recall, totalExp, totalOver, falseTotal);
    if (strict && (recall < 99.0 || totalOver + falseTotal > totalExp / 200)) ok = false;
  }
  return ok;
}

}  // namespace

int main(int argc, char **argv) {
  const bool compare = argc > 1 && strcmp(argv[1], "--compare") == 0;
  if (compare) report<TiltRepCounterV5>("Previous counter (v5 thresholds)", false);
  bool ok = report<TiltRepCounter>("Current counter", true);
  gSensor = {3.0, 0.8, 0.025, 0.3};
  if (compare) report<TiltRepCounterV5>("Previous counter, stress (2x noise and bias, unseen seeds)", false, true);
  ok = report<TiltRepCounter>("Current counter, stress (2x noise and bias, unseen seeds)", true, true) && ok;
  printf(ok ? "\naccuracy benchmark passed (>= 99%% counted, <= 0.5%% extra or false)\n"
            : "\naccuracy benchmark FAILED (needs >= 99%% counted, <= 0.5%% extra or false)\n");
  return ok ? 0 : 1;
}
