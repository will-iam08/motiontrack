import { useEffect, useId, useMemo, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { bpmCheck, hasBpmTarget } from '../lib/carePlan.js';
import { formatDateTime, formatDurationWords } from '../lib/format.js';
import { buildBuckets, filterDaily, filterHeartRate, METRICS, RANGES, sumRows } from '../lib/progress.js';
import { HeartRateChart, ProgressBarChart } from './Charts.jsx';
import { ErrorMessage, Icon, Loading, PlanCheck, ScreenHeading } from './common.jsx';

const EXERCISE_NAMES = ['Arm Curl', 'Shoulder Press', 'Back Row'];

function bpmDeltaText(point) {
  if (point.before_bpm == null || point.after_bpm == null) return '—';
  const diff = point.after_bpm - point.before_bpm;
  return `${diff > 0 ? `+${diff}` : diff} bpm`;
}

// Completed rep exercises, repetitions, active time, and before/after heart rate,
// selectable by time range and exercise. Shared across Patient and Doctor portals.
export function RepProgress({
  refreshKey = 0,
  path = '/api/progress',
  plan = null,
  heading = 'My progress',
  headingLevel = 2,
  autoFocusHeading = true,
}) {
  const { api } = useAuth();
  const uid = useId();
  const [exercise, setExercise] = useState('');
  const [range, setRange] = useState('30');
  const [metric, setMetric] = useState('workouts');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api(path, { query: { kind: 'reps', exercise_name: exercise }, signal: controller.signal })
      .then(setData)
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setError(failure);
      });
    return () => controller.abort();
  }, [api, path, exercise, refreshKey, attempt]);

  const days = RANGES.find(option => option.value === range).days;
  const view = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const rows = filterDaily(data.daily, days, now);
    const totals = days
      ? sumRows(rows)
      : {
          workouts: data.completed_workouts,
          repetitions: data.total_repetitions,
          duration_seconds: data.total_duration_seconds ?? 0,
        };
    const heartRatePoints = filterHeartRate(data.heart_rate, days, now);
    return {
      rows: [...rows].reverse(),
      totals,
      heartRatePoints,
      ...buildBuckets(data.daily, days, now),
    };
  }, [data, days]);

  const metricLabel = METRICS.find(option => option.value === metric).label;
  const rangeLabel = RANGES.find(option => option.value === range).label.toLowerCase();
  const SubHeading = `h${Math.min(6, headingLevel + 1)}`;
  const headingId = `${uid}-heading`;
  const rangeId = `${uid}-range`;
  const exerciseId = `${uid}-exercise`;
  const metricId = `${uid}-metric`;
  const hasAvgBpm = Boolean(view?.rows.some(row => row.avg_before_bpm != null || row.avg_after_bpm != null));
  const showBpmTarget = hasBpmTarget(plan);

  return (
    <section aria-labelledby={headingId}>
      <div id={headingId}>
        <ScreenHeading level={headingLevel} autoFocus={autoFocusHeading}>{heading}</ScreenHeading>
      </div>
      <p>Progress counts complete exercises only: all target reps done, with heart rate taken before and after. Incomplete exercises are not included.</p>
      <div className="filters">
        <div className="field">
          <label htmlFor={rangeId}>Time range</label>
          <select id={rangeId} value={range} onChange={e => setRange(e.target.value)}>
            {RANGES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={exerciseId}>Exercise</label>
          <select id={exerciseId} value={exercise} onChange={e => { setExercise(e.target.value); setData(null); }}>
            <option value="">All exercises</option>
            {EXERCISE_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={metricId}>Show on chart</label>
          <select id={metricId} value={metric} onChange={e => setMetric(e.target.value)}>
            {METRICS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorMessage error={error} onRetry={() => setAttempt(n => n + 1)} />}
      {!view && !error && <Loading label="Loading progress…" />}
      {view && (
        <>
          <div className="tiles" role="group" aria-label={`Totals for ${rangeLabel}`}>
            <div className="tile"><p className="tile-label"><Icon name="check" />Completed exercises</p><p className="tile-value">{view.totals.workouts}</p></div>
            <div className="tile"><p className="tile-label"><Icon name="dumbbell" />Total repetitions</p><p className="tile-value">{view.totals.repetitions}</p></div>
            <div className="tile"><p className="tile-label"><Icon name="clock" />Active time</p><p className="tile-value">{formatDurationWords(view.totals.duration_seconds ?? 0)}</p></div>
          </div>
          {view.totals.workouts === 0 ? (
            <p className="empty">No completed exercises in this time range{exercise ? ` for ${exercise}` : ''} yet.</p>
          ) : (
            <>
              <SubHeading>{metricLabel} per {view.monthly ? 'month' : 'day'}, {rangeLabel}</SubHeading>
              <ProgressBarChart buckets={view.buckets} metric={metric} metricLabel={metricLabel} />
              <p className="hint">Days are counted in UTC (Coordinated Universal Time), so an exercise late in the evening may appear under the next day.</p>
              <details className="details">
                <summary>Show these numbers as a table</summary>
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Progress table">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Date (UTC)</th>
                        <th scope="col">Exercise</th>
                        <th scope="col">Completed exercises</th>
                        <th scope="col">Repetitions</th>
                        <th scope="col">Active time</th>
                        {hasAvgBpm && <th scope="col">Avg before BPM</th>}
                        {hasAvgBpm && <th scope="col">Avg after BPM</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {view.rows.map(row => (
                        <tr key={`${row.date}-${row.exercise_name}`}>
                          <td>{row.date}</td>
                          <td>{row.exercise_name}</td>
                          <td>{row.workouts}</td>
                          <td>{row.repetitions}</td>
                          <td>{formatDurationWords(row.duration_seconds ?? 0)}</td>
                          {hasAvgBpm && <td>{row.avg_before_bpm != null ? `${row.avg_before_bpm} bpm` : '—'}</td>}
                          {hasAvgBpm && <td>{row.avg_after_bpm != null ? `${row.avg_after_bpm} bpm` : '—'}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              {view.heartRatePoints.length > 0 && (
                <>
                  <SubHeading>Heart rate before &amp; after</SubHeading>
                  <HeartRateChart points={view.heartRatePoints} plan={plan} />
                  <details className="details">
                    <summary>Show heart-rate readings as a table</summary>
                    <div className="table-wrap" tabIndex={0} role="region" aria-label="Heart-rate readings table">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Recorded</th>
                            <th scope="col">Exercise</th>
                            <th scope="col">Before</th>
                            <th scope="col">After</th>
                            <th scope="col">Change</th>
                            {showBpmTarget && <th scope="col">Care plan</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {view.heartRatePoints.map(point => (
                            <tr key={point.id}>
                              <td>{formatDateTime(point.recorded_at)}</td>
                              <td>{point.exercise_name}</td>
                              <td>{point.before_bpm != null ? `${point.before_bpm} bpm` : '—'}</td>
                              <td>{point.after_bpm != null ? `${point.after_bpm} bpm` : '—'}</td>
                              <td>{bpmDeltaText(point)}</td>
                              {showBpmTarget && (
                                <td><PlanCheck check={bpmCheck({ after_bpm: point.after_bpm }, plan)} /></td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
