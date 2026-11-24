// Search and filter chips for the patient, message and session lists.

// "  José " -> "jose". Safe on null, undefined and numbers.
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

// Every word of the query must appear in at least one field, so
// "ana gmail" finds Ana whose address is at gmail.com.
export function matchesQuery(query, ...fields) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields.map(normalizeText);
  return terms.every(term => haystack.some(field => field.includes(term)));
}

const list = items => (Array.isArray(items) ? items : []);

// Patients from GET /api/participants (doctor) or GET /api/admin/overview
// (admin). "Unassigned" needs `doctorsByPatient` from assignmentMaps() in
// admin.js, because overview patients do not carry their doctors.
const PATIENT_CHIPS = {
  all: () => true,
  live: patient => Boolean(patient.active_session_id),
  unassigned: (patient, doctorsByPatient) => (doctorsByPatient?.get(patient.id) ?? []).length === 0,
  attention: patient => (patient.incomplete_workouts ?? 0) > 0 || (patient.out_of_range_bpm_count ?? 0) > 0,
  unread: patient => (patient.unread_messages ?? 0) > 0,
  inactive: (patient, _doctorsByPatient, now = Date.now()) => {
    if (patient.active_session_id) return false;
    if (!patient.last_session_at) return true;
    const ms = Date.parse(patient.last_session_at);
    return Number.isFinite(ms) ? (now - ms) > 7 * 86400000 : true;
  },
};

export function filterPatients(patients, { chip = 'all', query = '', doctorsByPatient, now = Date.now() } = {}) {
  const keep = PATIENT_CHIPS[chip] ?? PATIENT_CHIPS.all;
  return list(patients).filter(patient => keep(patient, doctorsByPatient, now) && matchesQuery(query, patient.name, patient.email));
}

export function filterDoctors(doctors, { query = '' } = {}) {
  return list(doctors).filter(doctor => matchesQuery(query, doctor.name, doctor.email));
}

// Messages from GET /api/doctor/messages.
const MESSAGE_CHIPS = {
  all: () => true,
  unread: message => !message.is_read,
  email: message => message.source === 'email_bot',
  portal: message => message.source === 'portal',
};

export function filterMessages(messages, { chip = 'all', query = '' } = {}) {
  const keep = MESSAGE_CHIPS[chip] ?? MESSAGE_CHIPS.all;
  return list(messages).filter(message => keep(message) && matchesQuery(
    query,
    message.subject,
    message.body,
    message.participant_name,
    message.participant_email,
    message.sender_email,
  ));
}

const SESSION_CHIPS = {
  all: () => true,
  active: session => session.status === 'active',
  ended: session => session.status === 'ended',
};

export function filterSessions(sessions, { chip = 'all' } = {}) {
  const keep = SESSION_CHIPS[chip] ?? SESSION_CHIPS.all;
  return list(sessions).filter(keep);
}

// chipCounts(messages, ['all', 'unread'], (items, chip) => filterMessages(items, { chip }))
//   -> { all: 12, unread: 3 }
export function chipCounts(items, chips, filterFn) {
  return Object.fromEntries(list(chips).map(chip => [chip, filterFn(list(items), chip).length]));
}
