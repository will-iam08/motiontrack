export const SIM_EXERCISES = [
  {
    id: 'arm_curl',
    name: 'Arm Curl',
    placement: 'Forearm strap',
    thresholdDeg: 75,
    returnDeg: 25,
    maxDeg: 125,
    restBpm: 72,
    peakBpm: 104,
    targetReps: 5,
  },
  {
    id: 'shoulder_press',
    name: 'Shoulder Press',
    placement: 'Upper arm',
    thresholdDeg: 85,
    returnDeg: 25,
    maxDeg: 135,
    restBpm: 74,
    peakBpm: 112,
    targetReps: 5,
  },
  {
    id: 'back_row',
    name: 'Back Row',
    placement: 'Upper arm',
    thresholdDeg: 65,
    returnDeg: 20,
    maxDeg: 115,
    restBpm: 70,
    peakBpm: 106,
    targetReps: 5,
  },
];

export function getSimExercise(exerciseId) {
  return SIM_EXERCISES.find((ex) => ex.id === exerciseId) ?? SIM_EXERCISES[0];
}

export function createSimState(exerciseId = 'arm_curl') {
  const ex = getSimExercise(exerciseId);
  return {
    exerciseId: ex.id,
    angle: 12,
    stage: 'ready',
    reachedThreshold: false,
    reps: 0,
    partialAttempts: 0,
    lastEvent: 'Ready — lift arm to begin',
    bpm: ex.restBpm,
    completed: false,
  };
}

export function stepSimAngle(state, nextAngle) {
  const ex = getSimExercise(state.exerciseId);
  const angle = Math.max(0, Math.min(ex.maxDeg, Math.round(Number(nextAngle) || 0)));

  let { reachedThreshold, reps, partialAttempts, stage, lastEvent, bpm, completed } = state;

  if (reachedThreshold) {
    if (angle < ex.returnDeg) {
      reps = state.reps + 1;
      completed = reps >= ex.targetReps;
      const frac = Math.min(1, reps / ex.targetReps);
      bpm = Math.round(ex.restBpm + (ex.peakBpm - ex.restBpm) * frac);
      stage = 'counted';
      reachedThreshold = false;
      lastEvent = completed
        ? 'Set complete — synced to Motion Track'
        : 'Rep counted on return';
    } else {
      stage = 'threshold';
      lastEvent = 'Range reached — lower arm to count rep';
    }
  } else if (angle >= ex.thresholdDeg) {
    reachedThreshold = true;
    stage = 'threshold';
    lastEvent = 'Range reached — lower arm to count rep';
  } else if (angle >= ex.returnDeg + 10) {
    stage = 'lifting';
    lastEvent = 'Lift detected — keep going past threshold';
  } else if (angle < ex.returnDeg && state.stage === 'lifting') {
    partialAttempts = state.partialAttempts + 1;
    stage = 'partial';
    lastEvent = 'Partial lift — below angle threshold (not counted)';
  }

  return {
    ...state,
    angle,
    stage,
    reachedThreshold,
    reps,
    partialAttempts,
    lastEvent,
    bpm,
    completed,
  };
}
