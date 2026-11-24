import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useSession } from '../hooks/useSession.js';
import { isOpen } from '../lib/exerciseStatus.js';
import { formatDateTime } from '../lib/format.js';
import { CarePlanForm } from './CarePlan.jsx';
import { Avatar, ErrorMessage, Icon, LiveBadge, Loading, ScreenHeading } from './common.jsx';
import { LiveWorkoutHud } from './LiveWorkoutHud.jsx';
import { InboxMessage } from './MessageInbox.jsx';
import { RepProgress } from './RepProgress.jsx';
import { PrintHeader, SessionHistory } from './SessionHistory.jsx';
import { SessionTable } from './SessionTable.jsx';

const RECHECK_MS = 5000;

// The session the patient is doing now. It refreshes every second while an
// exercise is open, and every 5 seconds between exercises so the next one
// appears. Read-only: no buttons that change anything.
function LiveSession({ sessionId, patientName, plan }) {
  const { api } = useAuth();
  const { session, serverTime, loading, disconnected, error, reload } = useSession(api, sessionId, { live: true });
  const openWorkout = session?.workouts.find(isOpen) ?? null;
  const waiting = session?.status === 'active' && !openWorkout && !disconnected;

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => reload(), RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  return (
    <section aria-labelledby="live-heading" className="live-block">
      <h3 id="live-heading">Live session <LiveBadge /></h3>
      {loading && <Loading label="Loading the live session…" />}
      {disconnected && (
        <p className="alert alert-warning" role="status">
          <span aria-hidden="true">⚠ </span><strong>Lost connection to the server.</strong> Trying again automatically.
          The numbers below are the last ones received and may be out of date.
        </p>
      )}
      {!disconnected && error && <ErrorMessage error={error} onRetry={() => reload()} />}
      {session && (
        <>
          <p className="context-line">Started {formatDateTime(session.created_at)}.</p>
          {openWorkout ? (
            <LiveWorkoutHud
              workout={openWorkout}
              serverTime={serverTime}
              disconnected={disconnected}
              perspective="doctor"
            />
          ) : (
            session.status === 'active' && <p className="idle-text"><Icon name="clock" />No exercise is running at the moment.</p>
          )}
          <SessionTable session={session} serverTime={serverTime} plan={plan} caption={`Live exercises for ${patientName}`} />
        </>
      )}
    </section>
  );
}

function PatientMessagesPanel({ patient }) {
  const { api } = useAuth();
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api('/api/doctor/messages', { query: { unread_only: 0 }, signal: controller.signal })
      .then(data => setMessages((data.messages ?? []).filter(item => item.participant_id === patient.id)))
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setError(failure);
      });
    return () => controller.abort();
  }, [api, patient.id, attempt]);

  const handleChanged = useCallback(updated => {
    setMessages(previous => previous?.map(item => (item.id === updated.id ? { ...item, ...updated } : item)) ?? previous);
  }, []);

  return (
    <section className="detail-section" aria-labelledby="patient-messages-heading">
      <h3 id="patient-messages-heading">
        <Icon name="mail" /> Messages with {patient.name}
        {messages?.length > 0 && ` (${messages.length})`}
      </h3>
      {error && <ErrorMessage error={error} onRetry={() => setAttempt(n => n + 1)} />}
      {!messages && !error && <Loading label="Loading patient messages…" />}
      {messages?.length === 0 && <p className="empty">No messages from {patient.name} yet.</p>}
      {messages?.length > 0 && (
        <ul className="list message-list" aria-label={`Messages from ${patient.name}`}>
          {messages.map(message => (
            <InboxMessage key={message.id} message={message} onChanged={handleChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

// One patient's record for a doctor or an admin. Exercise records are read
// only; the care plan can be edited. `missingText` is shown when the patient
// is no longer in the list (for a doctor: no longer assigned).
export function PatientDetail({
  patient,
  listError,
  onRetry,
  onBack,
  missingText = 'This patient is no longer assigned to you.',
  showMessages = false,
}) {
  const [plan, setPlan] = useState(null);
  const [carePlanDirty, setCarePlanDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!carePlanDirty && confirmLeave) setConfirmLeave(false);
  }, [carePlanDirty, confirmLeave]);

  function handleBack() {
    if (carePlanDirty) {
      setConfirmLeave(true);
      return;
    }
    onBack();
  }

  const back = (
    <>
      <div className="context-bar">
        <button type="button" className="button button-quiet" onClick={handleBack}>← All patients</button>
        {patient && <p>Viewing <strong>{patient.name}</strong> ({patient.email})</p>}
      </div>
      {confirmLeave && (
        <div className="alert alert-warning" role="alert">
          <p><strong>You have unsaved care plan changes.</strong> Leave without saving?</p>
          <div className="button-row">
            <button type="button" className="button button-danger button-small" onClick={onBack}>Leave without saving</button>
            <button type="button" className="button button-small" onClick={() => setConfirmLeave(false)}>Stay on page</button>
          </div>
        </div>
      )}
    </>
  );

  if (!patient) {
    return (
      <>
        {back}
        <div className="card">
          {listError
            ? <ErrorMessage error={listError} onRetry={onRetry} />
            : <p className="empty">{missingText}</p>}
        </div>
      </>
    );
  }

  const base = `/api/participants/${patient.id}`;
  return (
    <>
      {back}
      <div className="card">
        <PrintHeader printContext={{ patientName: patient.name, patientEmail: patient.email }} plan={plan} />
        <div className="patient-header">
          <span className="person">
            <Avatar name={patient.name} />
            <span className="person-text">
              <span className="eyebrow block">Patient</span>
              <ScreenHeading level={2}>{patient.name}</ScreenHeading>
              <span className="hint block">{patient.email}</span>
            </span>
          </span>
          {patient.active_session_id
            ? <LiveBadge />
            : <span className="badge badge-readonly"><Icon name="lock" />Records read only</span>}
        </div>
        {listError && (
          <p className="alert alert-warning" role="status">
            <span aria-hidden="true">⚠ </span><strong>Could not check for a live session.</strong> Trying again automatically.
          </p>
        )}
        {patient.active_session_id && (
          <LiveSession key={patient.active_session_id} sessionId={patient.active_session_id} patientName={patient.name} plan={plan} />
        )}
        <CarePlanForm key={patient.id} patient={patient} onSaved={setPlan} onDirtyChange={setCarePlanDirty} />
        <div className="detail-section">
          <RepProgress
            key={patient.id}
            path={`${base}/progress`}
            plan={plan}
            heading="Progress & heart rate"
            headingLevel={3}
            autoFocusHeading={false}
          />
        </div>
        {showMessages && <PatientMessagesPanel key={patient.id} patient={patient} />}
        <div className="detail-section">
          <SessionHistory
            key={patient.id}
            path={`${base}/sessions`}
            timedPath={`${base}/workouts`}
            owner="This patient has"
            heading={`Workouts for ${patient.name}`}
            headingLevel={3}
            autoFocusHeading={false}
            plan={plan}
          />
        </div>
      </div>
    </>
  );
}
