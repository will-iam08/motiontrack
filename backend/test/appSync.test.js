import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, password } from './fixture.js';

function sampleSet(overrides = {}) {
  return {
    client_id: randomUUID(),
    exercise: 1,
    target_reps: 12,
    repetitions: 12,
    elapsed_seconds: 42,
    before_bpm: 74,
    after_bpm: 108,
    before_skipped: false,
    after_skipped: false,
    started_at: '2026-11-18T10:00:00.000Z',
    ended_at: '2026-11-18T10:00:42.000Z',
    ...overrides,
  };
}

test('app upload maps exercises 1/3/4, applies completeness rules and is idempotent', async t => {
  const f = await fixture(t);
  const patient = await f.register('app-patient@example.com');
  const otherPatient = await f.register('other-patient@example.com');
  const doc = await f.staff('app-doc@example.com', [patient.user.id]);
  const strangerDoc = await f.staff('other-doc@example.com');
  const admin = await f.admin('app-admin@example.com');

  const postSet = (token, body, status = 201) =>
    f.request('/api/app/sets', { method: 'POST', token, body, status });

  // Codes 1, 3 and 4 map to arm_curl, shoulder_press and back_row.
  const firstBody = sampleSet({ exercise: 1 });
  const created = (await postSet(patient.token, firstBody, 201)).data;
  assert.equal(created.duplicate, false);
  assert.equal(created.workout.source, 'app');
  assert.equal(created.workout.device_id, null);
  assert.equal(created.workout.exercise_id, 'arm_curl');
  assert.equal(created.workout.exercise_name, 'Arm Curl');
  assert.equal(created.workout.status, 'completed');
  assert.equal(created.workout.phase, 'done');
  assert.equal(created.session.source, 'app');
  assert.equal(created.session.status, 'ended');

  // Re-sending the exact same client_id is a no-op 200 duplicate.
  const retry = (await postSet(patient.token, firstBody, 200)).data;
  assert.equal(retry.duplicate, true);
  assert.equal(retry.workout.id, created.workout.id);
  assert.equal(retry.session.id, created.session.id);

  // Re-using the same client_id with changed metrics conflicts (409).
  await postSet(patient.token, { ...firstBody, repetitions: 10 }, 409);

  // Another participant using the same client_id stores their own isolated workout.
  const otherCopy = (await postSet(otherPatient.token, firstBody, 201)).data;
  assert.notEqual(otherCopy.workout.id, created.workout.id);

  // Wire code 3 and 4 plus string ids.
  const press = (await postSet(patient.token, sampleSet({ exercise: 3, target_reps: 50, repetitions: 50 }), 201)).data;
  assert.equal(press.workout.exercise_id, 'shoulder_press');
  assert.equal(press.workout.status, 'completed');

  const row = (await postSet(patient.token, sampleSet({ exercise: 4 }), 201)).data;
  assert.equal(row.workout.exercise_id, 'back_row');

  // Partial reps or skipped BPM marks the set incomplete; BPM is null when skipped.
  const skippedAfter = (await postSet(patient.token, sampleSet({
    exercise: 'arm_curl',
    after_bpm: null,
    after_skipped: true,
  }), 201)).data;
  assert.equal(skippedAfter.workout.status, 'incomplete');
  assert.equal(skippedAfter.workout.after_skipped, 1);
  assert.equal(skippedAfter.workout.after_bpm, null);

  const partialReps = (await postSet(patient.token, sampleSet({
    target_reps: 10,
    repetitions: 6,
  }), 201)).data;
  assert.equal(partialReps.workout.status, 'incomplete');

  const count = (await f.db.get('SELECT COUNT(*) AS n FROM workouts WHERE participant_id = ?', patient.user.id)).n;
  assert.equal(count, 5);

  // Assigned doctor, admin, and progress/sessions APIs read app-synced sets cleanly.
  const patSessions = (await f.request('/api/sessions', { token: patient.token })).data;
  assert.equal(patSessions.total, 5);
  const docSessions = (await f.request(`/api/participants/${patient.user.id}/sessions`, { token: doc.token })).data;
  assert.equal(docSessions.total, 5);
  const progress = (await f.request(`/api/participants/${patient.user.id}/progress?kind=reps`, { token: doc.token })).data;
  assert.equal(progress.completed_workouts, 3);
  assert.equal(progress.total_repetitions, 74);

  const overview = (await f.request('/api/admin/overview', { token: admin.token })).data;
  const patientSummary = overview.patients.find(p => p.id === patient.user.id);
  assert.equal(patientSummary.workout_count, 5);

  // Unassigned doctor, other doctor, and admin cannot view or upload as another patient.
  await f.request(`/api/participants/${patient.user.id}/sessions`, { token: strangerDoc.token, status: 404 });
  await postSet(doc.token, sampleSet(), 403);
  await postSet(admin.token, sampleSet(), 403);
  await f.request('/api/app/sets', { method: 'POST', body: sampleSet(), status: 401 });

  // Care plan + patient portal login work together for the app.
  const login = (await f.request('/api/auth/login', {
    method: 'POST',
    body: { email: 'app-patient@example.com', password, portal: 'patient' },
  })).data;
  assert.ok(login.token);
  await f.request(`/api/participants/${patient.user.id}/plan`, {
    method: 'PUT',
    token: doc.token,
    body: { arm_curl_reps: 15, shoulder_press_reps: 12, back_row_reps: 18, notes: 'Steady pace' },
  });
  const plan = (await f.request('/api/plan', { token: login.token })).data.plan;
  assert.equal(plan.arm_curl_reps, 15);
  assert.equal(plan.shoulder_press_reps, 12);
  assert.equal(plan.back_row_reps, 18);
});

test('app upload validation rejects code 2, out-of-range targets, 0 bpm, and inconsistent fields', async t => {
  const f = await fixture(t);
  const patient = await f.register('val-patient@example.com');
  const bad = (body) => f.request('/api/app/sets', { method: 'POST', token: patient.token, body, status: 400 });

  // Unused wire code 2 ("Lateral raise") and unknown exercises must fail.
  await bad(sampleSet({ exercise: 2 }));
  await bad(sampleSet({ exercise: 0 }));
  await bad(sampleSet({ exercise: 'lateral_raise' }));
  await bad(sampleSet({ target_reps: 0 }));
  await bad(sampleSet({ target_reps: 51 }));
  await bad(sampleSet({ target_reps: 10, repetitions: 11 }));
  await bad(sampleSet({ before_bpm: 0 }));
  await bad(sampleSet({ after_bpm: 0 }));
  await bad(sampleSet({ before_bpm: 70, before_skipped: true }));
  await bad(sampleSet({ after_bpm: 90, after_skipped: true }));
  await bad(sampleSet({ client_id: 'not-a-uuid' }));
  await bad(sampleSet({ started_at: '2026-11-18T10:01:00.000Z', ended_at: '2026-11-18T10:00:00.000Z' }));
  await bad(sampleSet({ extra: 1 }));
});

test('app live streaming supports live view, rate limiting, and seamless completion', async t => {
  const f = await fixture(t, ':memory:', { appSync: { liveLimitMax: 3, liveLimitWindowMs: 10_000 } });
  const patient = await f.register('live-patient@example.com');
  const doc = await f.staff('live-doc@example.com', [patient.user.id]);
  const cid = randomUUID();

  const putLive = (body, status = 200) =>
    f.request('/api/app/live', { method: 'PUT', token: patient.token, body, status });

  const step1 = (await putLive({
    client_id: cid,
    exercise: 1,
    target_reps: 10,
    repetitions: 0,
    elapsed_seconds: 2,
    phase: 'before_bpm',
    before_bpm: null,
    before_skipped: false,
    device_status: 'waiting_finger',
  })).data;
  assert.ok(Date.parse(step1.workout.device_seen_at));
  assert.ok(Date.parse(step1.server_time));

  const people = (await f.request('/api/participants', { token: doc.token })).data.participants;
  assert.equal(people[0].active_session_id, step1.session.id);

  await putLive({
    client_id: cid,
    exercise: 1,
    target_reps: 10,
    repetitions: 4,
    elapsed_seconds: 15,
    phase: 'counting',
    before_bpm: 72,
    before_skipped: false,
    device_status: 'counting',
  });

  await putLive({
    client_id: cid,
    exercise: 1,
    target_reps: 10,
    repetitions: 10,
    elapsed_seconds: 29,
    phase: 'after_bpm',
    before_bpm: 72,
    before_skipped: false,
    device_status: 'reading',
  });

  // 4th update inside the test window triggers 429 rate limit.
  const limited = await putLive({
    client_id: cid,
    exercise: 1,
    target_reps: 10,
    repetitions: 10,
    elapsed_seconds: 30,
    phase: 'after_bpm',
  }, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);

  // Finalizing via POST /api/app/sets converts the active live workout into the permanent set without duplicating.
  const finalized = (await f.request('/api/app/sets', {
    method: 'POST',
    token: patient.token,
    body: sampleSet({ client_id: cid, target_reps: 10, repetitions: 10, elapsed_seconds: 33, before_bpm: 72, after_bpm: 104 }),
    status: 201,
  })).data;
  assert.equal(finalized.workout.id, step1.workout.id);
  assert.equal(finalized.session.id, step1.session.id);
  assert.equal(finalized.session.status, 'ended');
  assert.equal(finalized.workout.status, 'completed');

  const peopleAfter = (await f.request('/api/participants', { token: doc.token })).data.participants;
  assert.equal(peopleAfter[0].active_session_id, null);

  // Stopping / cancelling live preview removes unfinalized placeholder cleanly.
  await f.request('/api/app/live', { method: 'DELETE', token: patient.token, status: 204 });
});

test('app live endpoint conflicts with an open Wi-Fi device session but still accepts finished set uploads', async t => {
  const f = await fixture(t);
  const patient = await f.register('mix-patient@example.com');
  const dev = await f.device(patient.token);
  await f.request('/api/sessions', { method: 'POST', token: patient.token, body: { device_id: dev.device.id }, status: 201 });

  await f.request('/api/app/live', {
    method: 'PUT',
    token: patient.token,
    body: {
      client_id: randomUUID(),
      exercise: 3,
      target_reps: 8,
      repetitions: 1,
      elapsed_seconds: 5,
      phase: 'counting',
    },
    status: 409,
  });

  // Historical finished sets do not claim the active slot, so they still upload cleanly.
  const uploaded = (await f.request('/api/app/sets', {
    method: 'POST',
    token: patient.token,
    body: sampleSet({ exercise: 3 }),
    status: 201,
  })).data;
  assert.equal(uploaded.workout.exercise_id, 'shoulder_press');
});

test('participants summary counts and progress heart_rate / daily BPM averages are accurate', async t => {
  const f = await fixture(t);
  const patient = await f.register('summary-patient@example.com');
  const doc = await f.staff('summary-doc@example.com', [patient.user.id]);

  await f.request(`/api/participants/${patient.user.id}/plan`, {
    method: 'PUT',
    token: doc.token,
    body: { target_bpm_min: 70, target_bpm_max: 115 },
  });

  const postSet = (body) => f.request('/api/app/sets', { method: 'POST', token: patient.token, body, status: 201 });

  // Completed in-range set on Nov 18
  await postSet(sampleSet({
    exercise: 1,
    before_bpm: 70,
    after_bpm: 100,
    started_at: '2026-11-18T09:00:00.000Z',
    ended_at: '2026-11-18T09:00:42.000Z',
  }));
  // Completed out-of-range (above max) set on Nov 19
  await postSet(sampleSet({
    exercise: 1,
    before_bpm: 80,
    after_bpm: 130,
    started_at: '2026-11-19T10:00:00.000Z',
    ended_at: '2026-11-19T10:00:42.000Z',
  }));
  // Completed out-of-range (below min) set on Nov 19
  await postSet(sampleSet({
    exercise: 1,
    before_bpm: 64,
    after_bpm: 65,
    started_at: '2026-11-19T12:00:00.000Z',
    ended_at: '2026-11-19T12:00:42.000Z',
  }));
  // Incomplete set (skipped after_bpm so it doesn't add to out_of_range_bpm_count)
  await postSet(sampleSet({
    exercise: 3,
    target_reps: 10,
    repetitions: 6,
    after_bpm: null,
    after_skipped: true,
    started_at: '2026-11-20T08:00:00.000Z',
    ended_at: '2026-11-20T08:00:30.000Z',
  }));

  await f.request('/api/messages', {
    method: 'POST',
    token: patient.token,
    body: { subject: 'Follow-up', body: 'Felt dizzy after the second set.' },
    status: 201,
  });

  const { participants } = (await f.request('/api/participants', { token: doc.token })).data;
  assert.equal(participants.length, 1);
  assert.equal(participants[0].session_count, 4);
  assert.ok(Date.parse(participants[0].last_session_at));
  assert.equal(participants[0].workout_count, 4);
  assert.equal(participants[0].incomplete_workouts, 1);
  assert.equal(participants[0].unread_messages, 1);
  assert.equal(participants[0].out_of_range_bpm_count, 2);

  for (const path of ['/api/progress?kind=reps', `/api/participants/${patient.user.id}/progress?kind=reps`]) {
    const token = path.startsWith('/api/participants') ? doc.token : patient.token;
    const progress = (await f.request(path, { token })).data;
    assert.equal(progress.completed_workouts, 3);
    assert.equal(progress.daily.length, 2);
    assert.equal(progress.daily[0].date, '2026-11-18');
    assert.equal(progress.daily[0].avg_before_bpm, 70);
    assert.equal(progress.daily[0].avg_after_bpm, 100);
    assert.equal(progress.daily[1].date, '2026-11-19');
    assert.equal(progress.daily[1].avg_before_bpm, 72);
    assert.equal(progress.daily[1].avg_after_bpm, 98);
    assert.equal(progress.heart_rate.length, 3);
    assert.deepEqual(
      progress.heart_rate.map(point => point.recorded_at),
      ['2026-11-18T09:00:00.000Z', '2026-11-19T10:00:00.000Z', '2026-11-19T12:00:00.000Z'],
    );
    assert.equal(progress.heart_rate[1].after_bpm, 130);
  }
});
