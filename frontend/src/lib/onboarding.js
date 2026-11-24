// Steps shown on the patient Overview until all three are done or dismissed.
// Progress is stored on the server, never in browser storage.
export function onboardingSteps({ hasAccount = true, syncedSets = 0, completedExercises = 0 } = {}) {
  const synced = Number.isFinite(syncedSets) && syncedSets > 0;
  const exercised = Number.isFinite(completedExercises) && completedExercises > 0;
  return [
    {
      id: 'account',
      title: 'Create your account',
      done: Boolean(hasAccount),
      detail: 'Your web dashboard and patient record are ready.',
    },
    {
      id: 'app',
      title: 'Sign in on the Motion Track app',
      done: synced,
      detail: 'Connect your tracker over Bluetooth on your iPhone and upload your first set.',
    },
    {
      id: 'exercise',
      title: 'Finish your first complete exercise',
      done: exercised,
      detail: 'Reach all target reps with heart rate measured before and after.',
    },
  ];
}

export function onboardingProgress(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { done: 0, total: 0, complete: true, nextStepId: null };
  }
  const done = steps.filter(step => Boolean(step.done)).length;
  const next = steps.find(step => !step.done) ?? null;
  return {
    done,
    total: steps.length,
    complete: done === steps.length,
    nextStepId: next ? next.id : null,
  };
}

export function shouldShowOnboarding({ steps, dismissed = false } = {}) {
  if (dismissed || !Array.isArray(steps) || steps.length === 0) return false;
  return steps.some(step => !step.done);
}
