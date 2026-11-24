import { useEffect, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { usePagedList } from '../hooks/usePagedList.js';
import { bpmRangeLabel, EXERCISE_NAMES, hasPlan, prescribedReps, REP_FIELDS } from '../lib/carePlan.js';
import { csvFilename, downloadCsv, SESSION_CSV_COLUMNS, sessionsToRows, toCsv } from '../lib/exportCsv.js';
import { formatDateTime } from '../lib/format.js';
import { ErrorMessage, FilterChips, Icon, Loading, Pager, ScreenHeading, StatusBadge } from './common.jsx';
import { SessionTable } from './SessionTable.jsx';
import { TimedHistory } from './TimedHistory.jsx';

const PAGE_SIZE = 10;
const EXPORT_PAGE = 50; // the most the sessions endpoint returns per request
const STATUS_QUERY = { all: {}, active: { status: 'active' }, ended: { status: 'ended' } };
const EMPTY_FILTERED = { active: 'No sessions are in progress.', ended: 'No ended sessions yet.' };

// Every session that matches the filter, fetched page by page for the export.
async function fetchAllSessions(api, path, query) {
  const sessions = [];
  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const page = await api(path, { query: { ...query, limit: EXPORT_PAGE, offset } });
    sessions.push(...page.sessions);
    if (page.sessions.length < EXPORT_PAGE || sessions.length >= page.total) return sessions;
  }
}

function summary(session) {
  const total = session.workouts.length;
  const complete = session.workouts.filter(workout => workout.status === 'completed').length;
  if (total === 0) return 'No exercises';
  return `${total} exercise${total === 1 ? '' : 's'}, ${complete} complete`;
}

function planPrintSummary(plan) {
  if (!hasPlan(plan)) return '';
  const parts = Object.keys(REP_FIELDS)
    .map(id => {
      const reps = prescribedReps(plan, id);
      return reps === null ? null : `${EXERCISE_NAMES[id]}: ${reps} reps`;
    })
    .filter(Boolean);
  const bpm = bpmRangeLabel(plan);
  if (bpm) parts.push(`Target heart rate: ${bpm}`);
  return parts.join(' · ');
}

export function PrintHeader({ printContext, heading, plan }) {
  if (!printContext) return null;
  const planSummary = planPrintSummary(plan);
  return (
    <div className="print-only print-header">
      <p className="eyebrow">Motion Track Clinical Report</p>
      {printContext.patientName ? (
        <p>
          <strong>Patient:</strong> {printContext.patientName}
          {printContext.patientEmail ? ` (${printContext.patientEmail})` : ''}
        </p>
      ) : (
        heading && <p><strong>{heading}</strong></p>
      )}
      <p><strong>Printed:</strong> {formatDateTime(new Date().toISOString())}</p>
      {planSummary && <p><strong>Care plan:</strong> {planSummary}</p>}
      {plan?.notes?.trim() && <p><strong>Care notes:</strong> {plan.notes.trim()}</p>}
    </div>
  );
}

// Workout sessions, newest first, each expandable to its exercise table; then
// the read-only list of earlier timed workouts.
export function SessionHistory({
  devices,
  refreshKey,
  path = '/api/sessions',
  timedPath,
  owner = 'You have',
  heading = 'History',
  headingLevel = 2,
  autoFocusHeading = true,
  plan,
  printContext = null,
}) {
  const { api } = useAuth();
  const [chip, setChip] = useState('all');
  const { data, error, page, setPage, retry } = usePagedList(api, path, STATUS_QUERY[chip], PAGE_SIZE, refreshKey);
  const [expanded, setExpanded] = useState(() => new Set());
  const [pendingPrint, setPendingPrint] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    if (!pendingPrint) return undefined;
    const raf = requestAnimationFrame(() => {
      window.print();
      setPendingPrint(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingPrint, expanded]);

  function pickChip(next) {
    setChip(next);
    setPage(0);
  }

  async function exportCsv() {
    setExporting(true);
    setExportNote('');
    setExportError('');
    try {
      const sessions = await fetchAllSessions(api, path, STATUS_QUERY[chip]);
      const filename = csvFilename('motiontrack-sessions');
      downloadCsv(filename, toCsv(SESSION_CSV_COLUMNS, sessionsToRows(sessions)));
      setExportNote(`Exported ${sessions.length} session${sessions.length === 1 ? '' : 's'} as ${filename}.`);
    } catch (failure) {
      if (failure?.status !== 401) setExportError(describeError(failure));
    } finally {
      setExporting(false);
    }
  }

  // The printed report shows every session on this page with its exercises.
  function printReport() {
    setExpanded(new Set(data?.sessions.map(session => session.id) ?? []));
    setPendingPrint(true);
  }
  const sourceText = session => {
    if (session.source === 'app' || !session.device_id) return ' · Motion Track app';
    if (devices) return ` · ${devices.find(device => device.id === session.device_id)?.name ?? 'Wi-Fi device'}`;
    return ' · Wi-Fi device';
  };

  function toggle(id) {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const subHeadingLevel = Math.min(6, headingLevel + 1);
  const SubHeading = `h${subHeadingLevel}`;

  return (
    <section aria-labelledby="history-heading">
      <PrintHeader printContext={printContext} heading={heading} plan={plan} />
      <div id="history-heading"><ScreenHeading level={headingLevel} autoFocus={autoFocusHeading}>{heading}</ScreenHeading></div>
      <SubHeading>Workout sessions</SubHeading>
      <div className="toolbar">
        <FilterChips
          label="Show sessions"
          value={chip}
          onChange={pickChip}
          options={[
            { id: 'all', label: 'All sessions' },
            { id: 'active', label: 'In progress', icon: 'play' },
            { id: 'ended', label: 'Ended', icon: 'check' },
          ]}
        />
        {data && data.total > 0 && (
          <div className="export-actions">
            <button type="button" className="button button-small" onClick={exportCsv} disabled={exporting}>
              <Icon name="download" />{exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button type="button" className="button button-small" onClick={printReport}><Icon name="printer" />Print report</button>
          </div>
        )}
      </div>
      <p className="hint copy-done" role="status">{exportNote}</p>
      {exportError && <ErrorMessage error={exportError} />}
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {!data && !error && <Loading label="Loading sessions…" />}
      {data && data.total === 0 && chip !== 'all' && (
        <p className="empty">
          {EMPTY_FILTERED[chip]} <button type="button" className="button button-link" onClick={() => pickChip('all')}>Show all sessions</button>
        </p>
      )}
      {data && data.total === 0 && chip === 'all' && <p className="empty">
          {owner === 'You have' ? 'You have no workout sessions yet. Record your first set in the Motion Track iPhone app.' : `${owner} no workout sessions yet.`}
        </p>}
      {data && data.total > 0 && (
        <>
          <ul className="list">
            {data.sessions.map(session => {
              const open = expanded.has(session.id);
              const tableId = `session-${session.id}`;
              const when = formatDateTime(session.created_at);
              return (
                <li key={session.id} className="list-item session-item">
                  <span className="session-row-main">
                    <strong className="block">{when}</strong>
                    <span className="session-meta">
                      {session.status === 'active'
                        ? <StatusBadge status="active" label="In progress" />
                        : <StatusBadge status="completed" label="Ended" />}
                      <span>{summary(session)}{sourceText(session)}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="button button-small"
                    aria-expanded={open}
                    aria-controls={tableId}
                    aria-label={`${open ? 'Hide' : 'Show'} exercises for the session of ${when}`}
                    onClick={() => toggle(session.id)}
                  >
                    {open ? 'Hide exercises' : 'Show exercises'}
                  </button>
                  {open && (
                    <div id={tableId} className="session-detail">
                      <SessionTable session={session} plan={plan} caption={`Exercises in the session of ${when}`} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager data={data} page={page} pageSize={PAGE_SIZE} itemCount={data.sessions.length} onPage={setPage} label="Session pages" />
        </>
      )}
      <TimedHistory path={timedPath} refreshKey={refreshKey} headingLevel={subHeadingLevel} />
    </section>
  );
}
