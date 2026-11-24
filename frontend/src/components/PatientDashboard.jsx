import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { API_BASE_URL } from '../api.js';
import { bpmCheck, hasTargets, repsCheck } from '../lib/carePlan.js';
import { bpmLabel, isOpen, statusLabel } from '../lib/exerciseStatus.js';
import { formatClock, formatDateTime } from '../lib/format.js';
import { CarePlanCard } from './CarePlan.jsx';
import { CopyButton, ErrorMessage, Icon, LiveBadge, Loading, PlanCheck, ScreenHeading, StatusBadge } from './common.jsx';
import { LiveWorkoutHud } from './LiveWorkoutHud.jsx';
import { Onboarding } from './Onboarding.jsx';
import { SessionTable } from './SessionTable.jsx';

const LIVE_POLL_MS = 3000;
const IDLE_POLL_MS = 10000;
const MAX_BACKOFF_MS = 30000;

function serverOriginUrl() {
  if (API_BASE_URL) return API_BASE_URL;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

function LiveAppBanner({ plan }) {
  const { api } = useAuth();
  const [live, setLive] = useState({ session: null, serverTime: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer;
    let failCount = 0;

    (async () => {
      while (!stopped) {
        let waitMs = IDLE_POLL_MS;
        try {
          const data = await api('/api/sessions', { query: { status: 'active', limit: 1 }, signal: controller.signal });
          if (stopped) return;
          failCount = 0;
          const session = data.sessions?.[0] ?? null;
          const hasActive = Boolean(session?.workouts?.some(isOpen));
          waitMs = hasActive ? LIVE_POLL_MS : IDLE_POLL_MS;
          setLive({ session, serverTime: data.server_time, error: null });
        } catch (failure) {
          if (stopped || failure?.name === 'AbortError' || failure?.status === 401) return;
          setLive(previous => ({ ...previous, error: failure }));
          if (failure.status !== 0 && failure.status !== 429 && failure.status < 500) return;
          failCount += 1;
          waitMs = Math.min(MAX_BACKOFF_MS, LIVE_POLL_MS * (2 ** Math.min(failCount, 4)));
        }
        await new Promise(resolve => { timer = setTimeout(resolve, waitMs); });
      }
    })();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api]);

  if (!live.session) return null;
  const openWorkout = live.session.workouts?.find(isOpen) ?? null;

  return (
    <section aria-labelledby="patient-live-heading" className="live-block">
      <h3 id="patient-live-heading">Live from Motion Log <LiveBadge /></h3>
      <p className="context-line">Started {formatDateTime(live.session.created_at)}.</p>
      {live.error && (
        <p className="alert alert-warning" role="status">
          <span aria-hidden="true">⚠ </span><strong>Lost connection to the server.</strong> Trying again automatically.
          The live numbers below may be out of date.
        </p>
      )}
      {openWorkout && (
        <LiveWorkoutHud
          workout={openWorkout}
          serverTime={live.serverTime}
          disconnected={Boolean(live.error)}
          perspective="patient"
        />
      )}
      <SessionTable session={live.session} serverTime={live.serverTime} plan={plan} caption="Current exercise from Motion Log" />
    </section>
  );
}

function SetupCard({ serverUrl, collapsed }) {
  const instructions = (
    <>
      <ol className="app-steps">
        <li>Open <strong>Motion Log</strong> on your iPhone, pick <strong>My tracker</strong> and connect your tracker over Bluetooth.</li>
        <li>Tap <strong>Sign in</strong> (or <strong>Account</strong>), enter the server URL below and sign in with this patient email and password.</li>
        <li>Pick Arm Curl, Shoulder Press, or Back Row (1–50 reps). Finished and stopped sets queue offline and sync here automatically.</li>
      </ol>
      {serverUrl && (
        <div className="field app-url-field">
          <label htmlFor="app-server-url">Server URL for the Motion Log app</label>
          <div className="app-url-row">
            <input id="app-server-url" type="text" readOnly value={serverUrl} onFocus={event => event.target.select()} />
            <CopyButton text={serverUrl} label="Copy server URL" copiedLabel="Copied server URL" />
          </div>
        </div>
      )}
    </>
  );

  if (collapsed) {
    return (
      <section className="app-sync-card app-sync-compact" aria-labelledby="app-guide-heading">
        <div className="app-sync-head">
          <div className="plan-card-head">
            <span className="feature-icon"><Icon name="device" /></span>
            <div>
              <h3 id="app-guide-heading">Motion Log iPhone setup &amp; Server URL</h3>
              <p className="hint">Connect your Bluetooth wrist tracker in the Motion Log app to sync sets here.</p>
            </div>
          </div>
          {serverUrl && <CopyButton text={serverUrl} label="Copy server URL" copiedLabel="Copied server URL" />}
        </div>
        <details className="details app-sync-details">
          <summary>Show iPhone setup steps &amp; Server URL</summary>
          {instructions}
        </details>
      </section>
    );
  }

  return (
    <section className="app-sync-card" aria-labelledby="app-guide-heading">
      <div className="plan-card-head">
        <span className="feature-icon"><Icon name="device" /></span>
        <div>
          <h3 id="app-guide-heading">Record exercises with the Motion Log app</h3>
          <p className="hint">Your tracker connects over Bluetooth to Motion Log on your iPhone, then syncs every set here.</p>
        </div>
      </div>
      {instructions}
    </section>
  );
}

export function PatientDashboard({
  plan,
  planError,
  onRetryPlan,
  progress,
  progressError,
  onRetryProgress,
  recentSessions,
  sessionsError,
  onRetrySessions,
  totalSessions,
  completedExercises,
  onboardingDismissed,
  onDismissOnboarding,
  onOpenTab,
}) {
  const serverUrl = serverOriginUrl();
  const hasSyncedSets = totalSessions > 0;
  const latestWorkouts = (recentSessions ?? []).flatMap(session =>
    (session.workouts ?? []).map(workout => ({ ...workout, session_source: session.source })),
  ).slice(0, 5);
  const showPlan = hasTargets(plan);

  const summaryAndRecent = (
    <>
      {progressError && <ErrorMessage error={progressError} onRetry={onRetryProgress} />}
      {!progress && !progressError && <Loading label="Loading exercise summary…" />}
      {progress && (
        <div className="tiles" role="group" aria-label="Synced workout totals">
          <div className="tile">
            <p className="tile-label"><Icon name="check" />Completed exercises</p>
            <p className="tile-value">{progress.completed_workouts ?? 0}</p>
          </div>
          <div className="tile">
            <p className="tile-label"><Icon name="dumbbell" />Total repetitions</p>
            <p className="tile-value">{progress.total_repetitions ?? 0}</p>
          </div>
          <div className="tile">
            <p className="tile-label"><Icon name="history" />Synced sessions</p>
            <p className="tile-value">{totalSessions}</p>
          </div>
        </div>
      )}

      <div className="recent-head">
        <h3>Recent synced sets</h3>
        <div className="button-row">
          <button type="button" className="button" onClick={() => onOpenTab('history')}>
            <Icon name="history" />Full history
          </button>
          <button type="button" className="button" onClick={() => onOpenTab('progress')}>
            <Icon name="chart" />Progress charts
          </button>
        </div>
      </div>

      {sessionsError && <ErrorMessage error={sessionsError} onRetry={onRetrySessions} />}
      {recentSessions === null && !sessionsError && <Loading label="Loading recent sets…" />}
      {!sessionsError && recentSessions !== null && latestWorkouts.length === 0 && (
        <p className="empty">No sets synced yet. Record an exercise in the Motion Log iPhone app and it will appear here.</p>
      )}
      {latestWorkouts.length > 0 && (
        <ul className="list">
          {latestWorkouts.map(workout => {
            const reps = showPlan ? repsCheck(workout, plan) : null;
            const bpm = showPlan ? bpmCheck(workout, plan) : null;
            return (
              <li key={workout.id} className="list-item">
                <div className="session-row-main">
                  <strong>{workout.exercise_name}</strong>
                  <span className="session-meta">
                    <StatusBadge status={workout.status} label={statusLabel(workout)} />
                    <span>{workout.repetitions} of {workout.target_reps} reps</span>
                    {workout.elapsed_seconds > 0 && <span>{formatClock(workout.elapsed_seconds)}</span>}
                    <span>Before: {bpmLabel(workout, 'before')}</span>
                    <span>After: {bpmLabel(workout, 'after')}</span>
                    <span>{formatDateTime(workout.started_at ?? workout.created_at)}</span>
                  </span>
                  {(reps || bpm) && (
                    <span className="session-meta">
                      {reps && <PlanCheck check={reps} />}
                      {bpm && <PlanCheck check={bpm} />}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  return (
    <section aria-labelledby="dashboard-heading">
      <div id="dashboard-heading"><ScreenHeading>Overview</ScreenHeading></div>
      <Onboarding
        syncedSets={totalSessions}
        completedExercises={completedExercises}
        dismissed={onboardingDismissed}
        onDismiss={onDismissOnboarding}
      />

      <LiveAppBanner plan={plan} />

      <CarePlanCard plan={plan} error={planError} onRetry={onRetryPlan} />

      {hasSyncedSets ? (
        <>
          {summaryAndRecent}
          <SetupCard serverUrl={serverUrl} collapsed />
        </>
      ) : (
        <>
          <SetupCard serverUrl={serverUrl} collapsed={false} />
          {summaryAndRecent}
        </>
      )}
    </section>
  );
}
