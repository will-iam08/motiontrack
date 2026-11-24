import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { formatClock, formatDateTime } from '../lib/format.js';
import { ErrorMessage, Loading, Pager, StatusBadge } from './common.jsx';

const PAGE_SIZE = 10;

// Workouts recorded before sessions existed. Read-only, static historical data.
export function TimedHistory({ path = '/api/workouts', refreshKey, headingLevel = 3 }) {
  const { api } = useAuth();
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api(path, {
      query: { kind: 'timed', limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      signal: controller.signal,
    })
      .then(result => {
        if (result.workouts.length === 0 && result.total > 0 && page > 0) {
          setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1));
          return;
        }
        setData(result);
      })
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setError(failure);
      });
    return () => controller.abort();
  }, [api, path, page, refreshKey, attempt]);

  if (data && data.total === 0) return null;
  if (!data && !error) return null;
  const Heading = `h${headingLevel}`;

  return (
    <>
      <Heading>Earlier timed workouts</Heading>
      <p className="hint">Workouts from before workout sessions were added. They are read-only and cannot be changed.</p>
      {error && <ErrorMessage error={error} onRetry={() => setAttempt(n => n + 1)} />}
      {!data && !error && <Loading label="Loading earlier workouts…" />}
      {data && data.total > 0 && (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Earlier timed workouts">
            <table className="table-stack">
              <thead>
                <tr>
                  <th scope="col">Date</th><th scope="col">Exercise</th><th scope="col">Status</th>
                  <th scope="col">Repetitions</th><th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.workouts.map(workout => (
                  <tr key={workout.id}>
                    <td data-label="Date">{formatDateTime(workout.started_at ?? workout.created_at)}</td>
                    <td data-label="Exercise">{workout.exercise_name}</td>
                    <td data-label="Status"><StatusBadge status={workout.status} /></td>
                    <td data-label="Repetitions">{workout.repetitions}</td>
                    <td data-label="Time">
                      {formatClock(workout.elapsed_seconds)}
                      {workout.target_duration_seconds != null && <span className="hint"> of {formatClock(workout.target_duration_seconds)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager data={data} page={page} pageSize={PAGE_SIZE} itemCount={data.workouts.length} onPage={setPage} label="Earlier workout pages" />
        </>
      )}
    </>
  );
}
