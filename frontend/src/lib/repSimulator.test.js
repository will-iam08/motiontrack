import { describe, expect, it } from 'vitest';
import {
  SIM_EXERCISES,
  createSimState,
  getSimExercise,
  stepSimAngle,
} from './repSimulator.js';

function runAngles(initialState, angles) {
  return angles.reduce((state, angle) => stepSimAngle(state, angle), initialState);
}

describe('repSimulator', () => {
  it('defaults unknown exercise ids to the first exercise', () => {
    expect(getSimExercise('unknown_id')).toEqual(SIM_EXERCISES[0]);
  });

  it.each(SIM_EXERCISES)('rejects partial lifts without counting reps for $id', (exercise) => {
    const start = createSimState(exercise.id);
    const lifting = stepSimAngle(start, 50);
    expect(lifting.stage).toBe('lifting');
    expect(lifting.reachedThreshold).toBe(false);

    const returned = stepSimAngle(lifting, 15);
    expect(returned.stage).toBe('partial');
    expect(returned.partialAttempts).toBe(1);
    expect(returned.reps).toBe(0);
    expect(returned.bpm).toBe(exercise.restBpm);
  });

  it.each(SIM_EXERCISES)('completes a 3-stage rep and elevates BPM for $id', (exercise) => {
    const start = createSimState(exercise.id);

    const lifting = stepSimAngle(start, 45);
    expect(lifting.stage).toBe('lifting');

    const threshold = stepSimAngle(lifting, 90);
    expect(threshold.stage).toBe('threshold');
    expect(threshold.reachedThreshold).toBe(true);
    expect(threshold.reps).toBe(0);

    const counted = stepSimAngle(threshold, 18);
    expect(counted.stage).toBe('counted');
    expect(counted.reachedThreshold).toBe(false);
    expect(counted.reps).toBe(1);
    expect(counted.bpm).toBeGreaterThan(exercise.restBpm);
    expect(counted.completed).toBe(false);
  });

  it.each(SIM_EXERCISES)('marks set completed and synced after 5 full reps for $id', (exercise) => {
    let state = createSimState(exercise.id);
    for (let i = 0; i < exercise.targetReps; i += 1) {
      state = runAngles(state, [45, 90, 18]);
    }

    expect(state.reps).toBe(5);
    expect(state.completed).toBe(true);
    expect(state.bpm).toBe(exercise.peakBpm);
    expect(state.lastEvent.toLowerCase()).toContain('complete');
    expect(state.lastEvent.toLowerCase()).toContain('synced');
  });
});
