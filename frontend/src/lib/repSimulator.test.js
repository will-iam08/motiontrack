import { describe, expect, it } from 'vitest';
import {
  SIM_EXERCISES,
  createSimState,
  getSimExercise,
  stepSimAngle,
  stepSimValue,
} from './repSimulator.js';

function runValues(initialState, values) {
  return values.reduce((state, val) => stepSimValue(state, val), initialState);
}

describe('repSimulator', () => {
  it('defaults unknown exercise ids to the first exercise and aliases stepSimAngle', () => {
    expect(getSimExercise('unknown_id')).toEqual(SIM_EXERCISES[0]);
    expect(stepSimAngle).toBe(stepSimValue);
    expect(SIM_EXERCISES.every((ex) => ex.placement === 'Just above the wrist')).toBe(true);
  });

  describe('arm_curl (angle mode)', () => {
    it('rejects partial curl (0 -> 34 -> 5) without counting a rep', () => {
      const start = createSimState('arm_curl');
      const lifting = stepSimValue(start, 34);
      expect(lifting.stage).toBe('lifting');
      expect(lifting.reachedThreshold).toBe(false);

      const returned = stepSimValue(lifting, 5);
      expect(returned.stage).toBe('partial');
      expect(returned.partialAttempts).toBe(1);
      expect(returned.reps).toBe(0);
      expect(returned.bpm).toBe(72);
    });

    it('counts 1 rep on return (0 -> 50 -> 15) and elevates BPM', () => {
      const ex = getSimExercise('arm_curl');
      const start = createSimState('arm_curl');

      const threshold = stepSimValue(start, 50);
      expect(threshold.stage).toBe('threshold');
      expect(threshold.reachedThreshold).toBe(true);
      expect(threshold.reps).toBe(0);

      const counted = stepSimValue(threshold, 15);
      expect(counted.stage).toBe('counted');
      expect(counted.reachedThreshold).toBe(false);
      expect(counted.reps).toBe(1);
      expect(counted.bpm).toBeGreaterThan(ex.restBpm);
      expect(counted.completed).toBe(false);
    });

    it('marks set completed and synced to Motion Track after 5 full reps', () => {
      const ex = getSimExercise('arm_curl');
      let state = createSimState('arm_curl');
      for (let i = 0; i < ex.targetReps; i += 1) {
        state = runValues(state, [50, 15]);
      }

      expect(state.reps).toBe(5);
      expect(state.completed).toBe(true);
      expect(state.bpm).toBe(ex.peakBpm);
      expect(state.lastEvent).toContain('Motion Track');
      expect(state.lastEvent.toLowerCase()).toContain('complete');
    });
  });

  describe('shoulder_press (displacement mode)', () => {
    it('rejects partial lift below 12 cm (0 -> 11 -> 0)', () => {
      const ex = getSimExercise('shoulder_press');
      const result = runValues(createSimState('shoulder_press'), [0, 11, 0]);
      expect(result.stage).toBe('partial');
      expect(result.partialAttempts).toBe(1);
      expect(result.reps).toBe(0);
      expect(result.bpm).toBe(ex.restBpm);
    });

    it('rejects lift below 30 cm combined even if >= 12 cm (0 -> 13 -> 0)', () => {
      const ex = getSimExercise('shoulder_press');
      const result = runValues(createSimState('shoulder_press'), [0, 13, 0]);
      expect(result.stage).toBe('partial');
      expect(result.partialAttempts).toBe(1);
      expect(result.reps).toBe(0);
      expect(result.combinedCm).toBe(26);
      expect(result.bpm).toBe(ex.restBpm);
    });

    it('counts 1 rep on return (0 -> 18 -> 0, 36 cm combined) and completes 5 reps', () => {
      const ex = getSimExercise('shoulder_press');
      const first = runValues(createSimState('shoulder_press'), [0, 18, 0]);
      expect(first.stage).toBe('counted');
      expect(first.reps).toBe(1);
      expect(first.combinedCm).toBe(36);
      expect(first.bpm).toBeGreaterThan(ex.restBpm);
      expect(first.completed).toBe(false);

      let state = first;
      for (let i = 1; i < ex.targetReps; i += 1) {
        state = runValues(state, [18, 0]);
      }
      expect(state.reps).toBe(5);
      expect(state.completed).toBe(true);
      expect(state.bpm).toBe(ex.peakBpm);
      expect(state.lastEvent).toContain('Motion Track');
    });
  });

  describe('back_row (displacement mode)', () => {
    it('rejects partial pull below 10 cm (0 -> 9 -> 0)', () => {
      const ex = getSimExercise('back_row');
      const result = runValues(createSimState('back_row'), [0, 9, 0]);
      expect(result.stage).toBe('partial');
      expect(result.partialAttempts).toBe(1);
      expect(result.reps).toBe(0);
      expect(result.bpm).toBe(ex.restBpm);
    });

    it('rejects pull below 25 cm combined even if >= 10 cm (0 -> 11 -> 0)', () => {
      const ex = getSimExercise('back_row');
      const result = runValues(createSimState('back_row'), [0, 11, 0]);
      expect(result.stage).toBe('partial');
      expect(result.partialAttempts).toBe(1);
      expect(result.reps).toBe(0);
      expect(result.combinedCm).toBe(22);
      expect(result.bpm).toBe(ex.restBpm);
    });

    it('counts 1 rep on return (0 -> 15 -> 0, 30 cm combined) and completes 5 reps', () => {
      const ex = getSimExercise('back_row');
      const first = runValues(createSimState('back_row'), [0, 15, 0]);
      expect(first.stage).toBe('counted');
      expect(first.reps).toBe(1);
      expect(first.combinedCm).toBe(30);
      expect(first.bpm).toBeGreaterThan(ex.restBpm);
      expect(first.completed).toBe(false);

      let state = first;
      for (let i = 1; i < ex.targetReps; i += 1) {
        state = runValues(state, [15, 0]);
      }
      expect(state.reps).toBe(5);
      expect(state.completed).toBe(true);
      expect(state.bpm).toBe(ex.peakBpm);
      expect(state.lastEvent).toContain('Motion Track');
    });
  });
});
