export const SIM_EXERCISES = [
  {
    id: 'arm_curl',
    name: 'Bicep curl',
    mode: 'angle',
    unit: '°',
    placement: 'Just above the wrist',
    startPosition: 'Arm lowered with your elbow by your side.',
    repRule:
      'Curl up until your forearm tilts at least 45° from the bottom of the rep. Lower it to within 20° of the resting angle.',
    holdStillRequired: false,
    minValue: 0,
    maxValue: 115,
    restValue: 0,
    liftDetectValue: 18,
    thresholdValue: 45,
    returnValue: 20,
    fullSimPeak: 88,
    shallowSimPeak: 34,
    targetReps: 5,
    restBpm: 72,
    peakBpm: 94,
    firmwareChecks: [
      '≥ 45° tilt from bottom, return ≤ 20° of rest',
      '≥ 0.5 s total (≥ 0.1 s between 45° and return)',
      'First completed rep sets the lift direction',
    ],
  },
  {
    id: 'shoulder_press',
    name: 'Shoulder press',
    mode: 'displacement',
    unit: 'cm',
    placement: 'Just above the wrist',
    startPosition:
      'Hand at shoulder height. Hold still until "Hold wrist still" clears on the OLED.',
    repRule: 'Press overhead, then lower your hand back to shoulder height.',
    holdStillRequired: true,
    minValue: 0,
    maxValue: 32,
    restValue: 0,
    liftDetectValue: 4,
    minLiftCm: 12,
    minReturnCm: 10.2,
    minCombinedCm: 30,
    returnMarginCm: 2,
    minRatio: 0.42,
    maxRatio: 3.8,
    fullSimPeak: 24,
    shallowSimPeak: 11,
    targetReps: 5,
    restBpm: 75,
    peakBpm: 102,
    firmwareChecks: [
      '≥ 12 cm lift, ≥ 10.2 cm return, ≥ 30 cm combined',
      '≥ 0.22 s each direction · return 42%–380% of lift',
      'Hold start until "Hold wrist still" clears on OLED',
    ],
  },
  {
    id: 'back_row',
    name: 'Back row',
    mode: 'displacement',
    unit: 'cm',
    placement: 'Just above the wrist',
    startPosition:
      'Lean forward with your working arm hanging. Hold still until "Hold wrist still" clears on the OLED.',
    repRule:
      'Pull your hand toward your hip, then lower it until your arm hangs again.',
    holdStillRequired: true,
    minValue: 0,
    maxValue: 26,
    restValue: 0,
    liftDetectValue: 4,
    minLiftCm: 10,
    minReturnCm: 8.5,
    minCombinedCm: 25,
    returnMarginCm: 2,
    minRatio: 0.42,
    maxRatio: 3.8,
    fullSimPeak: 18,
    shallowSimPeak: 9,
    targetReps: 5,
    restBpm: 74,
    peakBpm: 98,
    firmwareChecks: [
      '≥ 10 cm lift, ≥ 8.5 cm return, ≥ 25 cm combined',
      '≥ 0.22 s each direction · return 42%–380% of lift',
      'Hold start until "Hold wrist still" clears on OLED',
    ],
  },
];

export function getSimExercise(exerciseId) {
  return SIM_EXERCISES.find((ex) => ex.id === exerciseId) ?? SIM_EXERCISES[0];
}

export function createSimState(exerciseId = 'arm_curl') {
  const ex = getSimExercise(exerciseId);
  return {
    exerciseId: ex.id,
    value: ex.restValue,
    stage: 'ready',
    reachedThreshold: false,
    peakCm: 0,
    combinedCm: 0,
    reps: 0,
    partialAttempts: 0,
    lastEvent: ex.holdStillRequired
      ? 'Ready — hold wrist still at start, then begin'
      : 'Ready — curl forearm to begin',
    bpm: ex.restBpm,
    completed: false,
  };
}

function clampSimValue(ex, nextValue) {
  const raw = Number(nextValue);
  const finite = Number.isFinite(raw) ? raw : ex.restValue;
  const clamped = Math.max(ex.minValue, Math.min(ex.maxValue, finite));
  return ex.mode === 'angle' ? Math.round(clamped) : Number(clamped.toFixed(1));
}

function computeNextBpm(ex, reps) {
  const frac = Math.min(1, reps / ex.targetReps);
  return Math.round(ex.restBpm + (ex.peakBpm - ex.restBpm) * frac);
}

function stepAngleExercise(state, ex, value) {
  let { reachedThreshold, reps, partialAttempts, stage, lastEvent, bpm, completed } = state;

  if (reachedThreshold) {
    if (value <= ex.returnValue) {
      reps = state.reps + 1;
      completed = reps >= ex.targetReps;
      bpm = computeNextBpm(ex, reps);
      stage = 'counted';
      reachedThreshold = false;
      lastEvent = completed
        ? 'Set complete — synced to Motion Track'
        : 'Rep counted on return';
    } else {
      stage = 'threshold';
      lastEvent = `Range reached — lower within ${ex.returnValue}° to count rep`;
    }
  } else if (value >= ex.thresholdValue) {
    reachedThreshold = true;
    stage = 'threshold';
    lastEvent = `Range reached — lower within ${ex.returnValue}° to count rep`;
  } else if (value >= ex.liftDetectValue) {
    stage = 'lifting';
    lastEvent = `Curl detected — tilt ≥ ${ex.thresholdValue}° before lowering`;
  } else if (value <= ex.returnValue && state.stage === 'lifting') {
    partialAttempts = state.partialAttempts + 1;
    stage = 'partial';
    lastEvent = 'Partial curl — tilt ≥ 45° before lowering';
  }

  return {
    ...state,
    value,
    stage,
    reachedThreshold,
    reps,
    partialAttempts,
    lastEvent,
    bpm,
    completed,
  };
}

function stepDisplacementExercise(state, ex, value) {
  let {
    reachedThreshold,
    peakCm,
    combinedCm,
    reps,
    partialAttempts,
    stage,
    lastEvent,
    bpm,
    completed,
  } = state;

  if (value >= ex.liftDetectValue) {
    peakCm = Math.max(peakCm, value);
    combinedCm =
      value < peakCm
        ? Number((peakCm + (peakCm - value)).toFixed(1))
        : value;

    if (value >= ex.minLiftCm) {
      reachedThreshold = true;
      stage = 'threshold';
      lastEvent =
        peakCm * 2 < ex.minCombinedCm
          ? `Keep lifting — need ≥ ${ex.minCombinedCm} cm combined`
          : 'Range reached — lower to starting position';
    } else if (!reachedThreshold) {
      stage = 'lifting';
      lastEvent = `Lift detected — reach ≥ ${ex.minLiftCm} cm`;
    } else {
      stage = 'threshold';
      lastEvent =
        peakCm * 2 < ex.minCombinedCm
          ? `Keep lifting — need ≥ ${ex.minCombinedCm} cm combined`
          : 'Range reached — lower to starting position';
    }
  } else if (value <= ex.returnMarginCm) {
    if (peakCm >= ex.liftDetectValue) {
      const returnCm = Math.max(0, peakCm - value);
      const totalCm = peakCm + returnCm;
      const ratio = peakCm > 0 ? returnCm / peakCm : 0;
      const roundedTotal = Number(totalCm.toFixed(1));

      const isValid =
        peakCm >= ex.minLiftCm &&
        returnCm >= ex.minReturnCm &&
        totalCm >= ex.minCombinedCm &&
        ratio >= ex.minRatio &&
        ratio <= ex.maxRatio;

      if (isValid) {
        reps = state.reps + 1;
        completed = reps >= ex.targetReps;
        bpm = computeNextBpm(ex, reps);
        stage = 'counted';
        lastEvent = completed
          ? 'Set complete — synced to Motion Track'
          : 'Rep counted on return';
      } else {
        partialAttempts = state.partialAttempts + 1;
        stage = 'partial';
        if (peakCm < ex.minLiftCm) {
          lastEvent = `Partial lift — reached ${peakCm} cm (< ${ex.minLiftCm} cm min)`;
        } else if (totalCm < ex.minCombinedCm) {
          lastEvent = `Partial rep — ${roundedTotal} cm combined (< ${ex.minCombinedCm} cm combined)`;
        } else if (returnCm < ex.minReturnCm) {
          lastEvent = `Partial return — ${Number(returnCm.toFixed(1))} cm (< ${ex.minReturnCm} cm min)`;
        } else {
          lastEvent = 'Partial rep — return outside 42%–380% of lift';
        }
      }

      combinedCm = roundedTotal;
      peakCm = 0;
      reachedThreshold = false;
    }
  } else if (peakCm >= ex.liftDetectValue) {
    combinedCm = Number((peakCm + (peakCm - value)).toFixed(1));
  }

  return {
    ...state,
    value,
    stage,
    reachedThreshold,
    peakCm,
    combinedCm,
    reps,
    partialAttempts,
    lastEvent,
    bpm,
    completed,
  };
}

export function stepSimValue(state, nextValue) {
  const ex = getSimExercise(state.exerciseId);
  const value = clampSimValue(ex, nextValue);
  if (ex.mode === 'angle') {
    return stepAngleExercise(state, ex, value);
  }
  return stepDisplacementExercise(state, ex, value);
}

export const stepSimAngle = stepSimValue;
