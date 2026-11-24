import { useId } from 'react';
import { bpmLabel, deviceLine, isStale, notRespondingText } from '../lib/exerciseStatus.js';
import { formatClock } from '../lib/format.js';
import { Icon, LiveBadge } from './common.jsx';

const STEP_INDEX = { before_bpm: 0, counting: 1, after_bpm: 2, done: 3 };

function Steps({ workout }) {
  const current = STEP_INDEX[workout.phase] ?? 0;
  const reps = workout.repetitions ?? 0;
  const target = workout.target_reps ?? 0;
  const steps = [
    { label: 'Before BPM', detail: bpmLabel(workout, 'before') },
    { label: 'Counting', detail: `${reps} of ${target} reps` },
    { label: 'After BPM', detail: bpmLabel(workout, 'after') },
    { label: 'Done', detail: current === 3 ? 'Saved' : 'Not yet' },
  ];

  return (
    <ol className="steps" aria-label="Steps of this exercise">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'now' : 'next';
        const word = { done: 'Done', now: 'Now', next: 'Next' }[state];
        return (
          <li key={step.label} className={`step step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="step-state">
              {state === 'done' && <Icon name="check" />}
              {state === 'now' && <Icon name="play" />}
              {word}
            </span>
            <span className="step-label">{step.label}</span>
            <span className="step-detail">{step.detail}</span>
          </li>
        );
      })}
    </ol>
  );
}

const PHASE_HELP = {
  patient: {
    before_bpm: 'Put your finger on the heart-rate sensor and keep still. Counting starts after the reading.',
    counting: 'Do your repetitions. Your tracker counts them and stops at your target.',
    after_bpm: 'Target reached. Put your finger on the sensor again for the reading after exercise.',
    done: 'Exercise finished and saved.',
  },
  doctor: {
    before_bpm: 'Patient is taking the resting heart-rate reading before repetitions begin.',
    counting: 'Patient is actively performing repetitions toward the target.',
    after_bpm: 'Target reached. Patient is taking the post-exercise heart-rate reading.',
    done: 'Exercise finished and saved.',
  },
};

// Read-only live workout HUD shared by patient dashboard and doctor live views.
export function LiveWorkoutHud({ workout, serverTime, disconnected = false, perspective = 'patient' }) {
  const headingId = useId();
  if (!workout) return null;

  const isApp = workout.source === 'app' || !workout.device_id;
  const stale = !disconnected && isStale(workout, serverTime);
  const sensor = disconnected ? 'offline' : stale ? 'stale' : 'ok';
  const reps = workout.repetitions ?? 0;
  const target = workout.target_reps ?? 0;
  const percent = target > 0 ? Math.min(100, (reps / target) * 100) : 0;
  const helpMap = PHASE_HELP[perspective === 'doctor' ? 'doctor' : 'patient'];
  const helpText = helpMap[workout.phase];

  const staleGuidance = isApp
    ? (perspective === 'doctor'
      ? 'The Motion Track app has not sent an update recently. Finished sets sync automatically once the phone is back online.'
      : 'Check the Motion Track app on your phone. Finished sets queue offline and sync when reconnected.')
    : (perspective === 'doctor'
      ? 'The patient may need to check that the device is switched on and connected to Wi-Fi.'
      : 'Check that the device is switched on and connected to Wi-Fi.');

  return (
    <section className={stale ? 'live live-stale' : 'live'} aria-labelledby={headingId}>
      <div className="hud-head">
        <div>
          <p className="eyebrow">{isApp ? 'Live from Motion Track' : 'Current exercise'}</p>
          <h4 id={headingId} className="live-heading">{workout.exercise_name}</h4>
        </div>
        <div className="hud-tools">
          {workout.elapsed_seconds > 0 && (
            <span className="badge badge-readonly">
              <Icon name="clock" />
              {formatClock(workout.elapsed_seconds)}
            </span>
          )}
          {sensor === 'ok' && <LiveBadge label="Live" />}
          {sensor === 'stale' && <span className="badge badge-stale"><Icon name="alert" />Not responding</span>}
          {sensor === 'offline' && <span className="badge badge-pending"><Icon name="wifiOff" />Offline</span>}
        </div>
      </div>

      <Steps workout={workout} />

      <div className="hud-grid">
        <div className="hud-reps">
          <p className="rep-count">
            <span className="rep-now" aria-hidden="true">
              <span className="rep-digits" key={reps}>{reps}</span>
            </span>
            <span className="rep-of" aria-hidden="true">/ {target}</span>
            <span className="visually-hidden">{reps} of {target} reps</span>
          </p>
          <p className="rep-count-label" aria-hidden="true">reps</p>
          <div className="rep-bar" aria-hidden="true">
            <div
              className="rep-bar-fill"
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
        </div>

        <div className="hud-side">
          <div className={`sensor-banner sensor-${sensor}`}>
            <Icon name={sensor === 'offline' ? 'wifiOff' : sensor === 'stale' ? 'alert' : 'signal'} />
            <p className="device-line" aria-live="polite">
              <strong>{isApp ? 'Motion Track:' : 'Device:'}</strong> {deviceLine(workout)}
            </p>
          </div>
          <p className="visually-hidden" aria-live="polite">{stale ? 'Device not responding.' : ''}</p>
          {stale && (
            <p className="alert alert-warning stale-callout">
              <span aria-hidden="true">⚠ </span><strong>{notRespondingText(workout, serverTime)}.</strong>{' '}
              {staleGuidance}
            </p>
          )}
          {helpText && (
            <p className="phase-help"><Icon name="info" /><span>{helpText}</span></p>
          )}
        </div>
      </div>
    </section>
  );
}
