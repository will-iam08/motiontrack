import { describe, expect, it } from 'vitest';
import { assignmentMaps } from './admin.js';
import { chipCounts, filterDoctors, filterMessages, filterPatients, filterSessions, matchesQuery, normalizeText } from './filters.js';

describe('text matching', () => {
  it('normalizes case, spaces and accents', () => {
    expect(normalizeText('  José Ångström ')).toBe('jose angstrom');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(42)).toBe('42');
    expect(normalizeText(0)).toBe('0');
  });

  it('needs every query word in some field', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
    expect(matchesQuery('   ', null)).toBe(true);
    expect(matchesQuery(undefined)).toBe(true);
    expect(matchesQuery('jose', 'José Pérez')).toBe(true);
    expect(matchesQuery('PÉREZ', 'jose perez')).toBe(true);
    expect(matchesQuery('ana gmail', 'Ana Lima', 'ana@gmail.com')).toBe(true);
    expect(matchesQuery('ana  yahoo', 'Ana Lima', 'ana@gmail.com')).toBe(false);
    expect(matchesQuery('ana', null, undefined)).toBe(false);
    expect(matchesQuery('ana')).toBe(false);
  });
});

const overview = {
  patients: [
    { id: 'p1', name: 'José Pérez', email: 'jose@example.com', active_session_id: 's1' },
    { id: 'p2', name: 'Ana Lima', email: 'ana@gmail.com', active_session_id: null },
    { id: 'p3', name: 'Sam Chen', email: 'sam@example.com', active_session_id: null },
  ],
  doctors: [{ id: 'd1', name: 'Dr Rao', email: 'rao@clinic.org' }],
  assignments: [{ staff_id: 'd1', participant_id: 'p1' }, { staff_id: 'd1', participant_id: 'p2' }],
};
const ids = items => items.map(item => item.id);

describe('patient filters', () => {
  const { doctorsByPatient } = assignmentMaps(overview);

  it('filters by chip', () => {
    expect(ids(filterPatients(overview.patients))).toEqual(['p1', 'p2', 'p3']);
    expect(ids(filterPatients(overview.patients, { chip: 'live' }))).toEqual(['p1']);
    expect(ids(filterPatients(overview.patients, { chip: 'unassigned', doctorsByPatient }))).toEqual(['p3']);
    expect(ids(filterPatients(overview.patients, { chip: 'nonsense' }))).toEqual(['p1', 'p2', 'p3']);
  });

  it('searches name and email together with the chip', () => {
    expect(ids(filterPatients(overview.patients, { query: 'jose' }))).toEqual(['p1']);
    expect(ids(filterPatients(overview.patients, { query: 'GMAIL' }))).toEqual(['p2']);
    expect(ids(filterPatients(overview.patients, { query: 'example', chip: 'live' }))).toEqual(['p1']);
    expect(ids(filterPatients(overview.patients, { query: 'nobody' }))).toEqual([]);
  });

  it('handles empty input', () => {
    expect(filterPatients(null)).toEqual([]);
    expect(filterPatients([], { chip: 'live' })).toEqual([]);
  });

  it('filters by attention, unread, and inactive chips', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    const patients = [
      { id: 'a1', name: 'Live User', email: 'a1@x.com', active_session_id: 's1', last_session_at: '2026-11-01T00:00:00Z', incomplete_workouts: 0, out_of_range_bpm_count: 0, unread_messages: 0 },
      { id: 'a2', name: 'Incomplete User', email: 'a2@x.com', active_session_id: null, last_session_at: '2026-11-23T00:00:00Z', incomplete_workouts: 1, out_of_range_bpm_count: 0, unread_messages: 2 },
      { id: 'a3', name: 'BPM Alert User', email: 'a3@x.com', active_session_id: null, last_session_at: '2026-11-10T00:00:00Z', incomplete_workouts: 0, out_of_range_bpm_count: 1, unread_messages: 0 },
      { id: 'a4', name: 'Never Active', email: 'a4@x.com', active_session_id: null, last_session_at: null, incomplete_workouts: 0, out_of_range_bpm_count: 0, unread_messages: 1 },
    ];
    expect(ids(filterPatients(patients, { chip: 'attention' }))).toEqual(['a2', 'a3']);
    expect(ids(filterPatients(patients, { chip: 'unread' }))).toEqual(['a2', 'a4']);
    expect(ids(filterPatients(patients, { chip: 'inactive', now }))).toEqual(['a3', 'a4']);
  });
});

describe('doctor filters', () => {
  const doctors = [
    { id: 'd1', name: 'Dr. Priya Rao', email: 'rao@clinic.org' },
    { id: 'd2', name: 'Dr. Luis Vega', email: 'vega@hospital.net' },
  ];

  it('filters doctors by name and email', () => {
    expect(ids(filterDoctors(doctors))).toEqual(['d1', 'd2']);
    expect(ids(filterDoctors(doctors, { query: 'priya' }))).toEqual(['d1']);
    expect(ids(filterDoctors(doctors, { query: 'hospital' }))).toEqual(['d2']);
    expect(filterDoctors(null, { query: 'rao' })).toEqual([]);
  });
});

describe('message filters', () => {
  const messages = [
    { id: 'm1', subject: 'Sore shoulder', body: 'It hurts after presses.', source: 'portal', is_read: false,
      participant_name: 'José Pérez', participant_email: 'jose@example.com', sender_email: 'jose@example.com' },
    { id: 'm2', subject: 'Question', body: 'How many reps?', source: 'email_bot', is_read: true,
      participant_name: 'Ana Lima', participant_email: 'ana@gmail.com', sender_email: 'ana.home@mail.net' },
    { id: 'm3', subject: '(no subject)', body: 'Thanks!', source: 'email_bot', is_read: false,
      participant_name: 'Sam Chen', participant_email: 'sam@example.com', sender_email: 'sam@example.com' },
  ];

  it('filters by chip', () => {
    expect(ids(filterMessages(messages, { chip: 'unread' }))).toEqual(['m1', 'm3']);
    expect(ids(filterMessages(messages, { chip: 'email' }))).toEqual(['m2', 'm3']);
    expect(ids(filterMessages(messages, { chip: 'portal' }))).toEqual(['m1']);
    expect(ids(filterMessages(messages, { chip: 'starred' }))).toEqual(['m1', 'm2', 'm3']);
    expect(filterMessages(undefined)).toEqual([]);
  });

  it('searches subject, body, patient and sender', () => {
    expect(ids(filterMessages(messages, { query: 'shoulder' }))).toEqual(['m1']);
    expect(ids(filterMessages(messages, { query: 'reps' }))).toEqual(['m2']);
    expect(ids(filterMessages(messages, { query: 'perez' }))).toEqual(['m1']);
    expect(ids(filterMessages(messages, { query: 'mail.net' }))).toEqual(['m2']);
    expect(ids(filterMessages(messages, { query: 'example', chip: 'email' }))).toEqual(['m3']);
  });
});

describe('session filters and counts', () => {
  const sessions = [{ id: 's1', status: 'active' }, { id: 's2', status: 'ended' }, { id: 's3', status: 'ended' }];

  it('filters by status', () => {
    expect(ids(filterSessions(sessions))).toEqual(['s1', 's2', 's3']);
    expect(ids(filterSessions(sessions, { chip: 'active' }))).toEqual(['s1']);
    expect(ids(filterSessions(sessions, { chip: 'ended' }))).toEqual(['s2', 's3']);
    expect(ids(filterSessions(sessions, { chip: 'other' }))).toEqual(['s1', 's2', 's3']);
    expect(filterSessions(null)).toEqual([]);
  });

  it('counts each chip', () => {
    const count = (items, chip) => filterSessions(items, { chip });
    expect(chipCounts(sessions, ['all', 'active', 'ended'], count)).toEqual({ all: 3, active: 1, ended: 2 });
    expect(chipCounts(null, ['all', 'active'], count)).toEqual({ all: 0, active: 0 });
    expect(chipCounts(sessions, [], count)).toEqual({});
  });
});
