import { useEffect, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  BPM_MAX, BPM_MIN, EXERCISE_NAMES, NOTES_MAX, REP_FIELDS, REPS_MAX, REPS_MIN,
  bpmRangeLabel, hasPlan, parsePlanForm, planFormValues, prescribedReps,
} from '../lib/carePlan.js';
import { formatDateTime } from '../lib/format.js';
import { ErrorMessage, Icon, Loading } from './common.jsx';

// The targets of a plan as a definition list (shared by the patient card and
// the doctor's saved-plan summary).
function PlanFacts({ plan }) {
  return (
    <dl className="facts plan-facts">
      {Object.keys(REP_FIELDS).map(id => {
        const reps = prescribedReps(plan, id);
        return (
          <div key={id}>
            <dt>{EXERCISE_NAMES[id]}</dt>
            <dd>{reps === null ? 'No set number' : `${reps} reps`}</dd>
          </div>
        );
      })}
      <div>
        <dt>Heart rate after exercise</dt>
        <dd>{bpmRangeLabel(plan) ?? 'No target range'}</dd>
      </div>
    </dl>
  );
}

// "From Your Doctor": what the patient's doctor has asked for.
export function CarePlanCard({ plan, error, onRetry }) {
  if (error) return <ErrorMessage error={error} onRetry={onRetry} />;
  if (!hasPlan(plan)) return null;
  return (
    <section className="plan-card" aria-labelledby="plan-card-heading">
      <div className="plan-card-head">
        <span className="feature-icon"><Icon name="clipboard" /></span>
        <div>
          <h3 id="plan-card-heading">From Your Doctor</h3>
          <p className="hint">
            {plan.doctor_name ? `Set by ${plan.doctor_name}` : 'Set by your care team'}, updated {formatDateTime(plan.updated_at)}.
          </p>
        </div>
      </div>
      {plan.notes?.trim() && <p className="plan-notes">{plan.notes}</p>}
      <PlanFacts plan={plan} />
    </section>
  );
}

function PlanNumber({ id, label, hint, value, error, onChange, min, max }) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className="input-short"
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        aria-invalid={error ? true : undefined}
      />
      <p className="hint" id={hintId}>{hint ?? `${min} to ${max}, or leave empty.`}</p>
      {error && <p className="field-error" id={errorId}><span aria-hidden="true">⚠ </span>{error}</p>}
    </div>
  );
}

const PLAN_PRESETS = [
  {
    id: 'beginner',
    label: 'Beginner (8 reps · 60–110 bpm)',
    values: { arm_curl_reps: '8', shoulder_press_reps: '8', back_row_reps: '8', target_bpm_min: '60', target_bpm_max: '110' },
  },
  {
    id: 'standard',
    label: 'Standard (12 reps · 60–120 bpm)',
    values: { arm_curl_reps: '12', shoulder_press_reps: '12', back_row_reps: '12', target_bpm_min: '60', target_bpm_max: '120' },
  },
  {
    id: 'progressive',
    label: 'Progressive (15 reps · 65–130 bpm)',
    values: { arm_curl_reps: '15', shoulder_press_reps: '15', back_row_reps: '15', target_bpm_min: '65', target_bpm_max: '130' },
  },
];

// The doctor's (or admin's) editor for one patient's care plan. Calls
// onSaved(plan) after loading and after each save so the session tables use
// the current targets; pass a stable function such as a state setter.
export function CarePlanForm({ patient, onSaved, onDirtyChange }) {
  const { api } = useAuth();
  const path = `/api/participants/${patient.id}/plan`;
  const [plan, setPlan] = useState(undefined);
  const [values, setValues] = useState(planFormValues(null));
  const [loadError, setLoadError] = useState(null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    api(path, { signal: controller.signal })
      .then(data => {
        setPlan(data.plan);
        setValues(planFormValues(data.plan));
        onSaved?.(data.plan);
      })
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setLoadError(failure);
      });
    return () => controller.abort();
  }, [api, path, attempt, onSaved]);

  const baseline = plan === undefined ? null : planFormValues(plan);
  const isDirty = Boolean(baseline && Object.keys(baseline).some(key => values[key] !== baseline[key]));

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const set = field => value => {
    setValues(previous => ({ ...previous, [field]: value }));
    setErrors(previous => (previous[field] ? { ...previous, [field]: undefined } : previous));
    setSaved('');
  };

  function applyPreset(presetValues) {
    setValues(previous => ({ ...previous, ...presetValues }));
    setErrors({});
    setSaveError('');
    setSaved('');
  }

  function clearTargets() {
    applyPreset({
      arm_curl_reps: '',
      shoulder_press_reps: '',
      back_row_reps: '',
      target_bpm_min: '',
      target_bpm_max: '',
    });
  }

  function discardChanges() {
    setValues(planFormValues(plan));
    setErrors({});
    setSaveError('');
    setSaved('');
  }

  async function onSubmit(event) {
    event.preventDefault();
    const parsed = parsePlanForm(values);
    if (parsed.errors) {
      setErrors(parsed.errors);
      setSaveError('Please correct the fields marked below.');
      return;
    }
    setErrors({});
    setSaveError('');
    setBusy(true);
    try {
      const data = await api(path, { method: 'PUT', body: parsed.body });
      setPlan(data.plan);
      setValues(planFormValues(data.plan));
      setSaved(`Care plan saved ${formatDateTime(data.plan.updated_at)}.`);
      onSaved?.(data.plan);
    } catch (failure) {
      if (failure.status !== 401) setSaveError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="plan-editor" aria-labelledby="plan-editor-heading">
      <div className="heading-row">
        <h3 id="plan-editor-heading"><Icon name="clipboard" />Care Plan: Notes, Target Reps &amp; Heart Rate</h3>
        {isDirty && <span className="badge badge-pending"><Icon name="clock" />Unsaved changes</span>}
      </div>
      <p>
        {patient.name} sees these notes and targets on their Overview screen, and each completed set is compared with these targets.
      </p>
      {loadError && <ErrorMessage error={loadError} onRetry={() => setAttempt(n => n + 1)} />}
      {plan === undefined && !loadError && <Loading label="Loading the care plan…" />}
      {plan !== undefined && (
        <form onSubmit={onSubmit} noValidate aria-describedby="plan-editor-status">
          {plan && (
            <p className="hint">
              Last saved {formatDateTime(plan.updated_at)}{plan.doctor_name ? ` by ${plan.doctor_name}` : ''}.
            </p>
          )}
          {!plan && <p className="hint">No care plan has been saved for {patient.name} yet.</p>}
          <div className="field">
            <label htmlFor="plan-notes">Notes for the patient</label>
            <textarea
              id="plan-notes"
              rows={4}
              maxLength={NOTES_MAX}
              value={values.notes}
              onChange={event => set('notes')(event.target.value)}
              aria-describedby={errors.notes ? 'plan-notes-hint plan-notes-error' : 'plan-notes-hint'}
              aria-invalid={errors.notes ? true : undefined}
            />
            <p className="hint" id="plan-notes-hint">Up to {NOTES_MAX} characters ({values.notes.length} used).</p>
            {errors.notes && <p className="field-error" id="plan-notes-error"><span aria-hidden="true">⚠ </span>{errors.notes}</p>}
          </div>
          <div className="preset-row" role="group" aria-label="Care plan target presets">
            <span className="preset-label">Quick target presets:</span>
            {PLAN_PRESETS.map(preset => (
              <button key={preset.id} type="button" className="button button-small" onClick={() => applyPreset(preset.values)}>
                {preset.label}
              </button>
            ))}
            <button type="button" className="button button-small button-quiet" onClick={clearTargets}>
              Clear targets
            </button>
          </div>
          <fieldset>
            <legend>Target reps per exercise</legend>
            <div className="field-grid">
              {Object.entries(REP_FIELDS).map(([exerciseId, field]) => (
                <PlanNumber
                  key={field}
                  id={`plan-${field}`}
                  label={EXERCISE_NAMES[exerciseId]}
                  value={values[field]}
                  error={errors[field]}
                  onChange={set(field)}
                  min={REPS_MIN}
                  max={REPS_MAX}
                />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Target heart rate after exercise (bpm)</legend>
            <div className="field-grid">
              <PlanNumber id="plan-bpm-min" label="Lowest" value={values.target_bpm_min} error={errors.target_bpm_min}
                onChange={set('target_bpm_min')} min={BPM_MIN} max={BPM_MAX} />
              <PlanNumber id="plan-bpm-max" label="Highest" value={values.target_bpm_max} error={errors.target_bpm_max}
                onChange={set('target_bpm_max')} min={BPM_MIN} max={BPM_MAX} />
            </div>
          </fieldset>
          <div id="plan-editor-status">
            {saveError && <ErrorMessage error={saveError} />}
            {saved && <p className="alert alert-success" role="status"><span aria-hidden="true">✓ </span>{saved}</p>}
          </div>
          <div className="button-row">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save care plan'}
            </button>
            {isDirty && (
              <button type="button" className="button button-quiet" disabled={busy} onClick={discardChanges}>
                Discard changes
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
