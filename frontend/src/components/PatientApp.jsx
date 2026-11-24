import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ErrorMessage, TabNav } from './common.jsx';
import { PatientDashboard } from './PatientDashboard.jsx';
import { PatientMessages } from './PatientMessages.jsx';
import { RepProgress } from './RepProgress.jsx';
import { SessionHistory } from './SessionHistory.jsx';

export function PatientApp() {
  const { api, user } = useAuth();
  const [view, setView] = useState('dashboard');
  const [tabDir, setTabDir] = useState('none');
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [planAttempt, setPlanAttempt] = useState(0);
  const [progress, setProgress] = useState(null);
  const [progressError, setProgressError] = useState(null);
  const [recentSessions, setRecentSessions] = useState(null);
  const [totalSessions, setTotalSessions] = useState(0);
  const [sessionsError, setSessionsError] = useState(null);
  const [messagesSummary, setMessagesSummary] = useState([]);
  const [seenRepliesAt, setSeenRepliesAt] = useState(null);
  const [overviewTick, setOverviewTick] = useState(0);
  const [tabTick, setTabTick] = useState(0);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const loadPlan = useCallback(() => {
    const controller = new AbortController();
    setPlanError(null);
    api('/api/plan', { signal: controller.signal })
      .then(data => setPlan(data.plan ?? null))
      .catch(failure => { if (failure?.name !== 'AbortError' && failure?.status !== 401) setPlanError(failure); });
    return () => controller.abort();
  }, [api]);

  useEffect(() => loadPlan(), [loadPlan, planAttempt, overviewTick]);

  useEffect(() => {
    const controller = new AbortController();
    setProgressError(null);
    api('/api/progress', { query: { kind: 'reps' }, signal: controller.signal })
      .then(setProgress)
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setProgressError(failure);
      });
    return () => controller.abort();
  }, [api, overviewTick]);

  useEffect(() => {
    const controller = new AbortController();
    setSessionsError(null);
    api('/api/sessions', { query: { limit: 5 }, signal: controller.signal })
      .then(data => {
        setRecentSessions(data.sessions ?? []);
        setTotalSessions(data.total ?? 0);
      })
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setSessionsError(failure);
      });
    return () => controller.abort();
  }, [api, overviewTick]);

  useEffect(() => {
    const controller = new AbortController();
    api('/api/messages', { signal: controller.signal })
      .then(data => setMessagesSummary(data.messages ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [api, overviewTick]);

  const latestReplyAt = useMemo(() => (
    messagesSummary.reduce((latest, item) => {
      if (!item.doctor_reply || !item.replied_at) return latest;
      return !latest || item.replied_at > latest ? item.replied_at : latest;
    }, '')
  ), [messagesSummary]);

  const newReplies = useMemo(() => (
    messagesSummary.filter(item => (
      Boolean(item.doctor_reply)
      && (!seenRepliesAt || (item.replied_at && item.replied_at > seenRepliesAt))
    )).length
  ), [messagesSummary, seenRepliesAt]);

  useEffect(() => {
    if (view === 'messages' && latestReplyAt && (!seenRepliesAt || latestReplyAt > seenRepliesAt)) {
      setSeenRepliesAt(latestReplyAt);
    }
  }, [view, latestReplyAt, seenRepliesAt]);

  function reloadDashboard() {
    setOverviewTick(n => n + 1);
  }

  const views = [
    { id: 'dashboard', label: 'Overview', icon: 'pulse' },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'progress', label: 'Progress', icon: 'chart' },
    {
      id: 'messages',
      label: 'Messages',
      icon: 'mail',
      badge: newReplies,
      badgeLabel: newReplies === 1 ? '1 doctor reply' : `${newReplies} doctor replies`,
    },
  ];

  function changeView(next) {
    if (next === view) return;
    const prevIdx = views.findIndex(item => item.id === view);
    const nextIdx = views.findIndex(item => item.id === next);
    setTabDir(nextIdx > prevIdx ? 'forward' : 'backward');
    setView(next);
    if (next === 'dashboard') {
      setOverviewTick(n => n + 1);
    } else if (next === 'history' || next === 'progress') {
      setTabTick(n => n + 1);
    } else if (next === 'messages') {
      setSeenRepliesAt(latestReplyAt || new Date().toISOString());
    }
  }

  const panelClass = tabDir === 'forward' ? 'tab-panel-forward' : tabDir === 'backward' ? 'tab-panel-backward' : undefined;

  return (
    <>
      <TabNav views={views} current={view} onChange={changeView} label="Patient sections" />
      <div className="card">
        {planError && view !== 'dashboard' && <ErrorMessage error={planError} onRetry={() => setPlanAttempt(n => n + 1)} />}
        <div key={view} className={panelClass}>
          {view === 'dashboard' && (
            <PatientDashboard
              plan={plan}
              planError={planError}
              onRetryPlan={() => setPlanAttempt(n => n + 1)}
              progress={progress}
              progressError={progressError}
              onRetryProgress={reloadDashboard}
              recentSessions={recentSessions}
              sessionsError={sessionsError}
              onRetrySessions={reloadDashboard}
              totalSessions={totalSessions}
              completedExercises={progress?.completed_workouts ?? 0}
              onboardingDismissed={onboardingDismissed}
              onDismissOnboarding={() => setOnboardingDismissed(true)}
              onOpenTab={changeView}
            />
          )}
          {view === 'history' && (
            <SessionHistory
              refreshKey={tabTick}
              plan={plan}
              printContext={{ patientName: user?.name, patientEmail: user?.email, plan }}
            />
          )}
          {view === 'progress' && <RepProgress refreshKey={tabTick} plan={plan} />}
          {view === 'messages' && <PatientMessages />}
        </div>
      </div>
    </>
  );
}
