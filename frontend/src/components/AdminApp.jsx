import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { assignmentMaps, isAssigned, parseDoctorForm } from '../lib/admin.js';
import { chipCounts, filterDoctors, filterPatients, matchesQuery } from '../lib/filters.js';
import { formatDateTime } from '../lib/format.js';
import { AnimatedNumber } from './AnimatedNumber.jsx';
import { Avatar, ErrorMessage, FilterChips, Icon, LiveBadge, Loading, ScreenHeading, SearchField, TabNav } from './common.jsx';
import { PatientDetail } from './PatientDetail.jsx';

const REFRESH_MS = 10000;

const VIEWS = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'patients', label: 'All patients', icon: 'users' },
  { id: 'assignments', label: 'Assignments', icon: 'link' },
  { id: 'doctors', label: 'Doctor accounts', icon: 'shield' },
];

// GET /api/admin/overview, refreshed every 10 seconds. The last result stays
// on screen if a refresh fails.
function useOverview(api) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer;
    (async () => {
      while (!stopped) {
        try {
          const data = await api('/api/admin/overview', { signal: controller.signal });
          if (stopped) return;
          setOverview(data);
          setError(null);
        } catch (failure) {
          if (stopped || failure?.name === 'AbortError' || failure?.status === 401) return;
          setError(failure);
          if (failure.status !== 0 && failure.status !== 429 && failure.status < 500) return;
        }
        await new Promise(resolve => { timer = setTimeout(resolve, REFRESH_MS); });
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, tick]);

  return { overview, error, reload: useCallback(() => setTick(n => n + 1), []) };
}

function Tile({ icon, label, value, note }) {
  return (
    <div className="tile">
      <p className="tile-label"><Icon name={icon} />{label}</p>
      <p className="tile-value">
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </p>
      {note && <p className="tile-note">{note}</p>}
    </div>
  );
}

function Overview({ overview, onOpenPatient, onAssignPatient }) {
  const { stats } = overview;
  const live = overview.patients.filter(patient => patient.active_session_id);
  const { doctorsByPatient } = assignmentMaps(overview);
  const unassigned = overview.patients.filter(patient => doctorsByPatient.get(patient.id).length === 0);
  return (
    <section aria-labelledby="overview-heading">
      <div id="overview-heading"><ScreenHeading>Overview</ScreenHeading></div>
      <p>Everything recorded on this Motion Track server, across all patients and doctors.</p>
      <div className="stat-strip admin-stats" role="group" aria-label="Summary">
        <Tile icon="users" label="Patients" value={stats.patients} note={`${unassigned.length} without a doctor`} />
        <Tile icon="shield" label="Doctors" value={stats.doctors} note={`${stats.assignments} assignment${stats.assignments === 1 ? '' : 's'}`} />
        <Tile icon="history" label="Workout sessions" value={stats.sessions} note={`${stats.active_sessions} running now`} />
        <Tile icon="dumbbell" label="Exercises recorded" value={stats.workouts} note={`${stats.completed_workouts} completed`} />
        <Tile icon="device" label="Legacy Wi-Fi devices" value={stats.devices} note="Active, not removed" />
        <Tile icon="mail" label="Unread messages" value={stats.unread_messages} note={`${stats.messages} in total`} />
      </div>
      <h3>Exercising now</h3>
      {live.length === 0
        ? <p className="empty">No patient has a workout session running.</p>
        : <PatientRows patients={live} doctorsByPatient={doctorsByPatient} onOpenPatient={onOpenPatient} label="Patients exercising now" />}
      {unassigned.length > 0 && (
        <>
          <h3>Patients without a doctor</h3>
          <div className="alert alert-warning">
            <p>
              <span aria-hidden="true">⚠ </span>
              {unassigned.length === 1 ? 'One patient has' : `${unassigned.length} patients have`} no doctor:{' '}
              {unassigned.map(patient => patient.name).join(', ')}.
            </p>
            <div className="button-row">
              {unassigned.length === 1 ? (
                <button type="button" className="button button-small" onClick={() => onAssignPatient(unassigned[0].id)}>
                  <Icon name="link" />Assign {unassigned[0].name}
                </button>
              ) : (
                <button type="button" className="button button-small" onClick={() => onAssignPatient('')}>
                  <Icon name="link" />Assign patients
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function PatientRows({ patients, doctorsByPatient, onOpenPatient, label }) {
  return (
    <ul className="list roster roster-admin" aria-label={label}>
      <li className="roster-head" aria-hidden="true"><span>Patient</span><span>Doctors</span><span>Sessions</span><span /></li>
      {patients.map(patient => {
        const doctors = doctorsByPatient.get(patient.id) ?? [];
        return (
          <li key={patient.id} className={patient.active_session_id ? 'roster-row roster-row-live' : 'roster-row'}>
            <span className="person">
              <Avatar name={patient.name} />
              <span className="person-text">
                <strong className="block">{patient.name}</strong>
                <span className="hint block">{patient.email}</span>
              </span>
            </span>
            <span className="roster-cell">
              <span className="roster-cell-label">Doctors: </span>
              {doctors.length ? doctors.map(doctor => doctor.name).join(', ') : <em>None assigned</em>}
            </span>
            <span className="roster-cell">
              <span className="roster-cell-label">Sessions: </span>
              {patient.active_session_id ? <LiveBadge /> : null}
              <span className="block">{patient.session_count} session{patient.session_count === 1 ? '' : 's'}</span>
              <span className="hint block">{patient.last_session_at ? `Last ${formatDateTime(patient.last_session_at)}` : 'None yet'}</span>
              {patient.unread_messages > 0 && (
                <span className="hint block"><Icon name="mail" /> {patient.unread_messages} unread message{patient.unread_messages === 1 ? '' : 's'}</span>
              )}
            </span>
            <button type="button" className="button button-primary" onClick={() => onOpenPatient(patient.id)}
              aria-label={`View sessions and care plan for ${patient.name}`}>
              View sessions
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AllPatients({ overview, onOpenPatient }) {
  const [filter, setFilter] = useState('');
  const [chip, setChip] = useState('all');
  const { doctorsByPatient } = assignmentMaps(overview);
  const searched = filterPatients(overview.patients, { query: filter, doctorsByPatient });
  const patients = filterPatients(searched, { chip, doctorsByPatient });
  const counts = chipCounts(searched, ['all', 'live', 'unassigned'], (items, id) => filterPatients(items, { chip: id, doctorsByPatient }));
  return (
    <section aria-labelledby="all-patients-heading">
      <div id="all-patients-heading"><ScreenHeading>All patients</ScreenHeading></div>
      <p>Every patient account, with their doctors and sessions. Open a patient to see their sessions and care plan.</p>
      <div className="field">
        <label htmlFor="patient-filter">Find a patient by name or email</label>
        <div className="toolbar">
          <div className="search-field">
            <Icon name="search" />
            <input id="patient-filter" type="search" placeholder="Search by name or email" autoComplete="off" value={filter} onChange={e => setFilter(e.target.value)} aria-describedby="patient-filter-count" />
          </div>
          <FilterChips
            label="Show patients"
            value={chip}
            onChange={setChip}
            counts={counts}
            options={[
              { id: 'all', label: 'All' },
              { id: 'live', label: 'Exercising now', icon: 'pulse' },
              { id: 'unassigned', label: 'No doctor' },
            ]}
          />
        </div>
        <p className="hint" id="patient-filter-count" role="status">Showing {patients.length} of {overview.patients.length} patients.</p>
      </div>
      {overview.patients.length === 0 && <p className="empty">No patients have created an account yet.</p>}
      {overview.patients.length > 0 && patients.length === 0 && (
        <p className="empty">
          No patients match. <button type="button" className="button button-link" onClick={() => { setChip('all'); setFilter(''); }}>Clear search and filters</button>
        </p>
      )}
      {patients.length > 0 && <PatientRows patients={patients} doctorsByPatient={doctorsByPatient} onOpenPatient={onOpenPatient} label="All patients" />}
    </section>
  );
}

function Assignments({ overview, reload, initialPatientId = '', onClearInitialPatient }) {
  const { api } = useAuth();
  const [doctorId, setDoctorId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const { patientsByDoctor, doctorsByPatient } = assignmentMaps(overview);
  const nameOf = (list, id) => list.find(item => item.id === id)?.name ?? 'this account';

  useEffect(() => {
    if (!initialPatientId) return;
    setPatientId(initialPatientId);
    onClearInitialPatient?.();
  }, [initialPatientId, onClearInitialPatient]);

  async function change(method, staffId, participantId) {
    const key = `${method}:${staffId}:${participantId}`;
    setBusy(key);
    setError('');
    setStatus('');
    try {
      await api('/api/admin/assignments', { method, body: { staff_id: staffId, participant_id: participantId } });
      const patient = nameOf(overview.patients, participantId);
      const doctor = nameOf(overview.doctors, staffId);
      setStatus(method === 'POST' ? `${patient} is now assigned to ${doctor}.` : `${patient} is no longer assigned to ${doctor}.`);
      reload();
    } catch (failure) {
      if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy('');
    }
  }

  function onAssign(event) {
    event.preventDefault();
    if (!doctorId || !patientId) return setError('Choose a doctor and a patient first.');
    if (isAssigned(overview, doctorId, patientId)) {
      return setError(`${nameOf(overview.patients, patientId)} is already assigned to ${nameOf(overview.doctors, doctorId)}.`);
    }
    change('POST', doctorId, patientId);
    return undefined;
  }

  const unassigned = overview.patients.filter(patient => doctorsByPatient.get(patient.id).length === 0);
  const matchingDoctors = overview.doctors.filter(doctor => {
    if (!searchQuery.trim()) return true;
    const assigned = patientsByDoctor.get(doctor.id) ?? [];
    return matchesQuery(searchQuery, doctor.name, doctor.email)
      || assigned.some(patient => matchesQuery(searchQuery, patient.name, patient.email));
  });

  return (
    <section aria-labelledby="assignments-heading">
      <div id="assignments-heading"><ScreenHeading>Assignments</ScreenHeading></div>
      <p>A doctor sees only the patients assigned to them. A patient can have more than one doctor.</p>
      {overview.doctors.length === 0 || overview.patients.length === 0 ? (
        <p className="empty">
          {overview.doctors.length === 0 ? 'Create a doctor account first (Doctor accounts tab).' : 'No patients have created an account yet.'}
        </p>
      ) : (
        <form onSubmit={onAssign} noValidate className="assign-form">
          <fieldset>
            <legend>Assign a patient to a doctor</legend>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="assign-doctor">Doctor</label>
                <select id="assign-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                  <option value="">Choose a doctor…</option>
                  {overview.doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name} ({doctor.email})</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="assign-patient">Patient</label>
                <select id="assign-patient" value={patientId} onChange={e => setPatientId(e.target.value)}>
                  <option value="">Choose a patient…</option>
                  {overview.patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} ({patient.email})</option>)}
                </select>
              </div>
            </div>
            <button type="submit" className="button button-primary" disabled={Boolean(busy)}>
              <Icon name="plus" />{busy.startsWith('POST') ? 'Assigning…' : 'Assign patient'}
            </button>
          </fieldset>
        </form>
      )}
      <div aria-live="polite">
        {status && <p className="alert alert-success"><span aria-hidden="true">✓ </span>{status}</p>}
      </div>
      {error && <ErrorMessage error={error} />}
      {unassigned.length > 0 && (
        <div className="alert alert-warning">
          <p><span aria-hidden="true">⚠ </span><strong>No doctor yet:</strong> select a patient to pre-fill the assignment form.</p>
          <div className="button-row">
            {unassigned.map(patient => (
              <button
                key={patient.id}
                type="button"
                className="button button-small"
                onClick={() => setPatientId(patient.id)}
              >
                <Icon name="user" />{patient.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <h3>Current assignments by doctor</h3>
      {overview.doctors.length > 0 && (
        <div className="toolbar">
          <SearchField
            id="assignment-search"
            label="Search doctors or assigned patients"
            placeholder="Search doctors or assigned patients"
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </div>
      )}
      {overview.doctors.length === 0 && <p className="empty">There are no doctor accounts yet.</p>}
      {overview.doctors.length > 0 && matchingDoctors.length === 0 && (
        <p className="empty">
          No doctors or assigned patients match.{' '}
          <button type="button" className="button button-link" onClick={() => setSearchQuery('')}>Clear search</button>
        </p>
      )}
      {matchingDoctors.length > 0 && (
        <ul className="list doctor-list">
          {matchingDoctors.map(doctor => {
            const patients = patientsByDoctor.get(doctor.id) ?? [];
            return (
              <li key={doctor.id} className="doctor-group">
                <div className="person">
                  <Avatar name={doctor.name} />
                  <span className="person-text">
                    <strong className="block">{doctor.name}</strong>
                    <span className="hint block">{doctor.email} · {patients.length} patient{patients.length === 1 ? '' : 's'}</span>
                  </span>
                </div>
                {patients.length === 0 ? (
                  <p className="hint">No patients assigned.</p>
                ) : (
                  <ul className="list assignment-list" aria-label={`Patients assigned to ${doctor.name}`}>
                    {patients.map(patient => {
                      const key = `DELETE:${doctor.id}:${patient.id}`;
                      return (
                        <li key={patient.id} className="list-item">
                          <span>
                            <strong className="block">{patient.name}</strong>
                            <span className="hint block">{patient.email}</span>
                          </span>
                          <button type="button" className="button button-quiet" disabled={Boolean(busy)}
                            onClick={() => change('DELETE', doctor.id, patient.id)}
                            aria-label={`Unassign ${patient.name} from ${doctor.name}`}>
                            <Icon name="minus" />{busy === key ? 'Unassigning…' : 'Unassign'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DoctorAccounts({ overview, reload }) {
  const { api } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [doctorQuery, setDoctorQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return undefined;
    const parsed = parseDoctorForm({ name, email, password });
    if (parsed.error) return setError(parsed.error);
    setBusy(true);
    setError('');
    setCreated('');
    try {
      const data = await api('/api/admin/doctors', { method: 'POST', body: parsed.body });
      setCreated(`Doctor account created for ${data.user.name} (${data.user.email}). They sign in at /doctor.`);
      setName('');
      setEmail('');
      setPassword('');
      setShowPassword(false);
      reload();
    } catch (failure) {
      if (failure.status === 409) setError('An account with this email already exists.');
      else if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  const invalidName = Boolean(error && /doctor[’']s name/i.test(error));
  const invalidEmail = Boolean(error && /email/i.test(error));
  const invalidPassword = Boolean(error && /password/i.test(error));
  const matchingDoctors = filterDoctors(overview.doctors, { query: doctorQuery });

  return (
    <section aria-labelledby="doctors-heading">
      <div id="doctors-heading"><ScreenHeading>Doctor accounts</ScreenHeading></div>
      <form onSubmit={onSubmit} noValidate>
        <fieldset>
          <legend>Create doctor account</legend>
          <div className="field">
            <label htmlFor="doctor-name">Doctor’s name</label>
            <input
              id="doctor-name"
              type="text"
              autoComplete="off"
              maxLength={80}
              value={name}
              onChange={e => { setName(e.target.value); if (error) setError(''); }}
              aria-invalid={invalidName ? true : undefined}
              aria-describedby={invalidName ? 'doctor-form-error' : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="doctor-email">Email address</label>
            <input
              id="doctor-email"
              type="email"
              autoComplete="off"
              maxLength={254}
              value={email}
              onChange={e => { setEmail(e.target.value); if (error) setError(''); }}
              aria-invalid={invalidEmail ? true : undefined}
              aria-describedby={invalidEmail ? 'doctor-form-error' : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="doctor-password">Temporary password</label>
            <div className="password-row">
              <input
                id="doctor-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                maxLength={128}
                value={password}
                onChange={e => { setPassword(e.target.value); if (error) setError(''); }}
                aria-invalid={invalidPassword ? true : undefined}
                aria-describedby={invalidPassword ? 'doctor-password-hint doctor-form-error' : 'doctor-password-hint'}
              />
              <button
                type="button"
                className="button button-small password-toggle"
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(visible => !visible)}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} />
                <span>{showPassword ? 'Hide' : 'Show'}</span>
              </button>
            </div>
            <p className="hint" id="doctor-password-hint">12 to 128 characters. Give it to the doctor in person, not by email.</p>
          </div>
          {error && <div id="doctor-form-error"><ErrorMessage error={error} /></div>}
          <div aria-live="polite">
            {created && <p className="alert alert-success"><span aria-hidden="true">✓ </span>{created}</p>}
          </div>
          <button type="submit" className="button button-primary" disabled={busy}>
            <Icon name="plus" />{busy ? 'Creating…' : 'Create doctor account'}
          </button>
        </fieldset>
      </form>
      <h3>Doctors</h3>
      {overview.doctors.length > 0 && (
        <div className="toolbar">
          <SearchField
            id="doctor-search"
            label="Search doctors"
            placeholder="Search doctors by name or email"
            value={doctorQuery}
            onChange={setDoctorQuery}
          />
        </div>
      )}
      {overview.doctors.length === 0 ? (
        <p className="empty">There are no doctor accounts yet.</p>
      ) : matchingDoctors.length === 0 ? (
        <p className="empty">
          No doctors match.{' '}
          <button type="button" className="button button-link" onClick={() => setDoctorQuery('')}>Clear search</button>
        </p>
      ) : (
        <ul className="list">
          {matchingDoctors.map(doctor => (
            <li key={doctor.id} className="list-item">
              <span className="person">
                <Avatar name={doctor.name} />
                <span className="person-text">
                  <strong className="block">{doctor.name}</strong>
                  <span className="hint block">{doctor.email}</span>
                </span>
              </span>
              <span className="hint">{doctor.patient_count} patient{doctor.patient_count === 1 ? '' : 's'} · since {formatDateTime(doctor.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The admin portal: overview metrics, every patient's sessions, patient–doctor
// assignments and doctor accounts.
export function AdminApp() {
  const { api } = useAuth();
  const { overview, error, reload } = useOverview(api);
  const [view, setView] = useState('overview');
  const [tabDir, setTabDir] = useState('none');
  const [selectedId, setSelectedId] = useState(null);
  const [navDir, setNavDir] = useState('none');
  const [quickAssignPatientId, setQuickAssignPatientId] = useState('');

  const openPatient = useCallback(id => {
    window.scrollTo(0, 0);
    setNavDir('push');
    setSelectedId(id);
  }, []);

  const closePatient = useCallback(() => {
    window.scrollTo(0, 0);
    setNavDir('pop');
    setSelectedId(null);
  }, []);

  const switchView = useCallback(next => {
    if (next === view) return;
    window.scrollTo(0, 0);
    const prevIdx = VIEWS.findIndex(item => item.id === view);
    const nextIdx = VIEWS.findIndex(item => item.id === next);
    setTabDir(nextIdx > prevIdx ? 'forward' : 'backward');
    setView(next);
  }, [view]);

  const openAssign = useCallback((patientId = '') => {
    setQuickAssignPatientId(patientId);
    switchView('assignments');
  }, [switchView]);

  if (selectedId) {
    return (
      <div key={`detail-${selectedId}`} className="screen-push">
        <PatientDetail
          patient={overview?.patients.find(patient => patient.id === selectedId) ?? null}
          listError={error}
          onRetry={reload}
          onBack={closePatient}
          missingText="This patient account no longer exists."
        />
      </div>
    );
  }

  const panelClass = tabDir === 'forward' ? 'tab-panel-forward' : tabDir === 'backward' ? 'tab-panel-backward' : undefined;

  return (
    <div key="admin-shell" className={navDir === 'pop' ? 'screen-pop' : undefined}>
      <TabNav views={VIEWS} current={view} onChange={switchView} label="Admin sections" />
      <div className="card">
        {error && overview && (
          <p className="alert alert-warning" role="status">
            <span aria-hidden="true">⚠ </span><strong>Could not refresh.</strong> Trying again automatically. What you see may be out of date.
          </p>
        )}
        {error && !overview && <ErrorMessage error={error} onRetry={reload} />}
        {!overview && !error && <Loading label="Loading the overview…" />}
        {overview && (
          <div key={view} className={panelClass}>
            {view === 'overview' && <Overview overview={overview} onOpenPatient={openPatient} onAssignPatient={openAssign} />}
            {view === 'patients' && <AllPatients overview={overview} onOpenPatient={openPatient} />}
            {view === 'assignments' && (
              <Assignments
                overview={overview}
                reload={reload}
                initialPatientId={quickAssignPatientId}
                onClearInitialPatient={() => setQuickAssignPatientId('')}
              />
            )}
            {view === 'doctors' && <DoctorAccounts overview={overview} reload={reload} />}
          </div>
        )}
      </div>
    </div>
  );
}
