import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashPassword, verifyPassword, hashToken, newToken, publicUser } from './security.js';
import { EXERCISES } from './exercises.js';
import { registerSessionRoutes } from './sessions.js';
import { registerAdminRoutes } from './admin.js';
import { registerPlanRoutes } from './plans.js';
import { registerAppSyncRoutes } from './appSync.js';
import { registerMessageRoutes } from './messages.js';
import { registerBotRoutes } from './emailBot.js';
import { DEFAULT_CORS_ORIGINS, parseCorsOrigins } from './config.js';
import { applyDeviceEvent } from './deviceEvents.js';
import { bodyFields, email, fail, integer, password, queryFields, queryInteger, text } from './validate.js';

const legacyExercises = ['Bicep curls', 'Squats', 'Arm raises'];
const statuses = ['pending', 'active', 'completed', 'cancelled', 'incomplete'];
const kinds = ['timed', 'reps'];
const deviceFields = 'id, name, created_at, last_seen_at';

const portalRoles = { patient: 'participant', doctor: 'staff', admin: 'admin' };
const wrongPortal = {
  participant: 'This is a patient account. Use the patient sign-in.',
  staff: 'This is a doctor account. Use the doctor sign-in.',
  admin: 'This is an admin account. Use the admin sign-in.',
};

// corsOrigin: one origin, a comma-separated list, or an array of origins.
// bot: { webhookSecret, address } for the email bot (both optional).
// staticDir: optional directory of a built frontend (serves SPA routes when present).
export function createApp({ db, corsOrigin = DEFAULT_CORS_ORIGINS, bot = {}, staticDir = null, appSync = {} }) {
  const allowedOrigins = new Set(parseCorsOrigins(corsOrigin));
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.headers.origin) {
      res.vary('Origin');
      const host = req.get('host');
      const sameOrigin = Boolean(host) && (
        req.headers.origin === `${req.protocol}://${host}` || req.headers.origin === `https://${host}`
      );
      if (!allowedOrigins.has(req.headers.origin) && !sameOrigin) {
        return res.status(403).json({ error: { message: 'Origin is not allowed' } });
      }
      res.set('Access-Control-Allow-Origin', req.headers.origin);
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  // Forwarded emails can be longer than any form on the site; the bot trims them on ingest.
  // CloudMailin's free plan allows 512 KB emails; as JSON (with the HTML part
  // and Base64 attachments) one can approach 700 KB.
  app.use('/api/bot/inbound-email', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '16kb' }));

  const transaction = fn => db.transaction(fn);

  function bearer(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || '');
    if (!match) fail(401, 'A valid Bearer token is required');
    return hashToken(match[1]);
  }

  async function userAuth(req, res, next) {
    req.tokenHash = bearer(req);
    req.user = await db.get(`SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`, req.tokenHash, new Date().toISOString());
    if (!req.user) fail(401, 'Session is invalid or expired');
    return next();
  }

  function participant(req, res, next) {
    if (req.user.role !== 'participant') fail(403, 'Participant access required');
    next();
  }

  function staff(req, res, next) {
    if (req.user.role !== 'staff') fail(403, 'Staff access required');
    next();
  }

  function admin(req, res, next) {
    if (req.user.role !== 'admin') fail(403, 'Admin access required');
    next();
  }

  // Doctors read their assigned patients; admins read everyone.
  function staffOrAdmin(req, res, next) {
    if (req.user.role !== 'staff' && req.user.role !== 'admin') fail(403, 'Staff access required');
    next();
  }

  async function deviceAuth(req, res, next) {
    req.device = await db.get('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL', bearer(req));
    if (!req.device) fail(401, 'Device token is invalid or revoked');
    await db.run('UPDATE devices SET last_seen_at = ? WHERE id = ?', new Date().toISOString(), req.device.id);
    return next();
  }

  // shortcut: login throttling is per process, use a shared limiter if running multiple servers.
  const authAttempts = new Map();
  function authLimit(req, res, next) {
    const now = Date.now();
    for (const [key, value] of authAttempts) if (value.until <= now) authAttempts.delete(key);
    const entry = authAttempts.get(req.ip) || { count: 0, until: now + 15 * 60 * 1000 };
    authAttempts.set(req.ip, entry);
    if (++entry.count > 20) {
      res.set('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
      fail(429, 'Too many authentication attempts; try again later');
    }
    next();
  }

  async function session(user) {
    const token = newToken('u_');
    const now = new Date().toISOString();
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await db.run('DELETE FROM auth_sessions WHERE expires_at <= ?', now);
    await db.run('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      hashToken(token), user.id, now, expires_at);
    return { token, expires_at, user: publicUser(user) };
  }

  async function assigned(staffId, participantId) {
    return db.get('SELECT 1 FROM staff_participants WHERE staff_id = ? AND participant_id = ?', staffId, participantId);
  }

  // Whether `user` may read another person's records: an assigned doctor, or an admin.
  async function canView(user, participantId) {
    if (user.role === 'staff') return Boolean(await assigned(user.id, participantId));
    if (user.role === 'admin') {
      return Boolean(await db.get("SELECT 1 FROM users WHERE id = ? AND role = 'participant'", participantId));
    }
    return false;
  }

  async function readableWorkout(req) {
    const workout = await db.get('SELECT * FROM workouts WHERE id = ?', req.params.id);
    if (!workout || !(workout.participant_id === req.user.id || await canView(req.user, workout.participant_id))) {
      fail(404, 'Workout not found');
    }
    return workout;
  }

  async function assignedParticipant(req, res, next) {
    if (!await canView(req.user, req.params.id)) fail(404, 'Participant not found');
    return next();
  }

  async function workoutList(participantId, query) {
    queryFields(query, ['limit', 'offset', 'status', 'exercise_name', 'kind']);
    const limit = queryInteger(query.limit, 'limit', 20, 1, 100);
    const offset = queryInteger(query.offset, 'offset', 0, 0, 1_000_000_000);
    const conditions = ['participant_id = ?'];
    const params = [participantId];
    if (query.status !== undefined) {
      if (!statuses.includes(query.status)) fail(400, 'Invalid status');
      conditions.push('status = ?');
      params.push(query.status);
    }
    if (query.exercise_name !== undefined) {
      conditions.push('exercise_name = ? COLLATE NOCASE');
      params.push(text(query.exercise_name, 'exercise_name'));
    }
    if (query.kind !== undefined) {
      if (!kinds.includes(query.kind)) fail(400, 'Invalid kind');
      conditions.push('kind = ?');
      params.push(query.kind);
    }
    const where = conditions.join(' AND ');
    const { total } = await db.get(`SELECT COUNT(*) AS total FROM workouts WHERE ${where}`, ...params);
    const workouts = await db.all(`SELECT * FROM workouts WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset);
    return { workouts, limit, offset, total };
  }

  async function progress(participantId, query) {
    queryFields(query, ['exercise_name', 'kind']);
    let where = "participant_id = ? AND status = 'completed'";
    const params = [participantId];
    if (query.exercise_name !== undefined) {
      where += ' AND exercise_name = ? COLLATE NOCASE';
      params.push(text(query.exercise_name, 'exercise_name'));
    }
    if (query.kind !== undefined) {
      if (!kinds.includes(query.kind)) fail(400, 'Invalid kind');
      where += ' AND kind = ?';
      params.push(query.kind);
    }
    const totals = await db.get(`SELECT COUNT(*) AS completed_workouts, COALESCE(SUM(repetitions), 0) AS total_repetitions,
      COALESCE(SUM(elapsed_seconds), 0) AS total_duration_seconds FROM workouts WHERE ${where}`, ...params);
    const daily = await db.all(`SELECT substr(COALESCE(started_at, created_at), 1, 10) AS date, exercise_name, COUNT(*) AS workouts,
      SUM(repetitions) AS repetitions, SUM(elapsed_seconds) AS duration_seconds,
      ROUND(AVG(before_bpm)) AS avg_before_bpm, ROUND(AVG(after_bpm)) AS avg_after_bpm
      FROM workouts WHERE ${where}
      GROUP BY date, exercise_name COLLATE NOCASE ORDER BY date, exercise_name`, ...params);
    const heart_rate = await db.all(`SELECT id, date, recorded_at, exercise_name, repetitions, target_reps, elapsed_seconds, before_bpm, after_bpm
      FROM (
        SELECT id,
          substr(COALESCE(started_at, created_at), 1, 10) AS date,
          COALESCE(started_at, created_at) AS recorded_at,
          exercise_name, repetitions, target_reps, elapsed_seconds, before_bpm, after_bpm
        FROM workouts
        WHERE ${where} AND (before_bpm IS NOT NULL OR after_bpm IS NOT NULL)
        ORDER BY COALESCE(started_at, created_at) DESC, id DESC
        LIMIT 40
      ) recent
      ORDER BY recorded_at ASC, id ASC`, ...params);
    return { ...totals, daily, heart_rate };
  }

  app.get('/api/health', async (req, res) => {
    await db.get('SELECT 1 AS ok');
    res.json({ status: 'ok' });
  });

  app.get('/api/exercises', (req, res) => res.json({ exercises: EXERCISES }));

  app.post('/api/auth/register', authLimit, async (req, res) => {
    bodyFields(req.body, ['name', 'email', 'password']);
    const name = text(req.body.name, 'name');
    const userEmail = email(req.body.email);
    const userPassword = password(req.body.password);
    const passwordHash = await hashPassword(userPassword);
    const id = randomUUID();
    await db.run(`INSERT INTO users (id, name, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, 'participant', ?)`, id, name, userEmail, passwordHash, new Date().toISOString());
    res.status(201).json(await session(await db.get('SELECT * FROM users WHERE id = ?', id)));
  });

  // A dummy hash keeps unknown-email and incorrect-password checks on the same slow path.
  const dummyHash = hashPassword(newToken('dummy_'));
  app.post('/api/auth/login', authLimit, async (req, res) => {
    bodyFields(req.body, ['email', 'password'], ['portal']);
    const userEmail = email(req.body.email);
    const userPassword = password(req.body.password);
    const portal = req.body.portal;
    if (portal !== undefined && !Object.hasOwn(portalRoles, portal)) fail(400, 'portal must be patient, doctor or admin');
    const user = await db.get('SELECT * FROM users WHERE email = ?', userEmail);
    const valid = await verifyPassword(userPassword, user ? user.password_hash : await dummyHash);
    if (!user || !valid) fail(401, 'Invalid email or password');
    // Each sign-in page accepts only its own account type; no session is created otherwise.
    if (portal !== undefined && user.role !== portalRoles[portal]) {
      fail(403, wrongPortal[user.role] ?? 'This account cannot sign in here.');
    }
    res.json(await session(user));
  });

  app.post('/api/auth/logout', userAuth, async (req, res) => {
    await db.run('DELETE FROM auth_sessions WHERE token_hash = ?', req.tokenHash);
    res.sendStatus(204);
  });
  app.get('/api/me', userAuth, (req, res) => res.json({ user: publicUser(req.user) }));

  app.get('/api/devices', userAuth, participant, async (req, res) => {
    const devices = await db.all(`SELECT ${deviceFields} FROM devices WHERE participant_id = ? AND revoked_at IS NULL ORDER BY created_at, id`, req.user.id);
    res.json({ devices });
  });

  app.post('/api/devices', userAuth, participant, async (req, res) => {
    bodyFields(req.body, ['name']);
    const name = text(req.body.name, 'name');
    const id = randomUUID();
    const token = newToken('d_');
    await db.run('INSERT INTO devices (id, participant_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      id, req.user.id, name, hashToken(token), new Date().toISOString());
    res.status(201).json({ device: await db.get(`SELECT ${deviceFields} FROM devices WHERE id = ?`, id), device_token: token });
  });

  app.delete('/api/devices/:id', userAuth, participant, async (req, res) => {
    const device = await db.get('SELECT id FROM devices WHERE id = ? AND participant_id = ? AND revoked_at IS NULL', req.params.id, req.user.id);
    if (!device) fail(404, 'Device not found');
    const now = new Date().toISOString();
    await transaction(async tx => {
      await tx.run('UPDATE devices SET revoked_at = ? WHERE id = ?', now, device.id);
      await tx.run(`UPDATE workouts SET status = CASE kind WHEN 'reps' THEN 'incomplete' ELSE 'cancelled' END,
        phase = CASE kind WHEN 'reps' THEN 'done' ELSE phase END, ended_at = ?, updated_at = ?
        WHERE device_id = ? AND status IN ('pending', 'active')`, now, now, device.id);
      await tx.run("UPDATE exercise_sessions SET status = 'ended', ended_at = ?, updated_at = ? WHERE device_id = ? AND status = 'active'",
        now, now, device.id);
    });
    res.sendStatus(204);
  });

  app.post('/api/workouts', userAuth, participant, async (req, res) => {
    bodyFields(req.body, ['device_id', 'exercise_name', 'target_duration_seconds']);
    const deviceId = text(req.body.device_id, 'device_id');
    const name = text(req.body.exercise_name, 'exercise_name');
    const exerciseName = legacyExercises.find(item => item.toLowerCase() === name.toLowerCase()) || name;
    const target = integer(req.body.target_duration_seconds, 'target_duration_seconds', 1, 86400);
    const device = await db.get('SELECT id FROM devices WHERE id = ? AND participant_id = ? AND revoked_at IS NULL', deviceId, req.user.id);
    if (!device) fail(404, 'Device not found');
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.run(`INSERT INTO workouts (id, participant_id, device_id, exercise_name, kind, target_duration_seconds, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'timed', ?, 'pending', ?, ?)`, id, req.user.id, deviceId, exerciseName, target, now, now);
    res.status(201).json({ workout: await db.get('SELECT * FROM workouts WHERE id = ?', id) });
  });

  app.get('/api/workouts', userAuth, participant, async (req, res) => res.json(await workoutList(req.user.id, req.query)));
  app.get('/api/progress', userAuth, participant, async (req, res) => res.json(await progress(req.user.id, req.query)));
  app.get('/api/workouts/:id', userAuth, async (req, res) => res.json({ workout: await readableWorkout(req) }));

  app.get('/api/workouts/:id/readings', userAuth, async (req, res) => {
    const workout = await readableWorkout(req);
    queryFields(req.query, ['limit', 'offset']);
    const limit = queryInteger(req.query.limit, 'limit', 100, 1, 1000);
    const offset = queryInteger(req.query.offset, 'offset', 0, 0, 1_000_000_000);
    const readings = await db.all('SELECT * FROM workout_readings WHERE workout_id = ? ORDER BY sequence LIMIT ? OFFSET ?', workout.id, limit, offset);
    const { total } = await db.get('SELECT COUNT(*) AS total FROM workout_readings WHERE workout_id = ?', workout.id);
    res.json({ readings, limit, offset, total });
  });

  app.post('/api/workouts/:id/cancel', userAuth, participant, async (req, res) => {
    const workout = await readableWorkout(req);
    if (workout.status === 'completed') fail(409, 'A completed workout cannot be cancelled');
    if (workout.kind === 'reps') {
      if (workout.status !== 'incomplete') {
        const now = new Date().toISOString();
        await db.run("UPDATE workouts SET status = 'incomplete', phase = 'done', ended_at = ?, updated_at = ? WHERE id = ?", now, now, workout.id);
      }
    } else if (workout.status !== 'cancelled') {
      const now = new Date().toISOString();
      await db.run("UPDATE workouts SET status = 'cancelled', ended_at = ?, updated_at = ? WHERE id = ?", now, now, workout.id);
    }
    res.json({ workout: await db.get('SELECT * FROM workouts WHERE id = ?', workout.id) });
  });

  app.get('/api/participants', userAuth, staff, async (req, res) => {
    const rows = await db.all(`SELECT u.*,
        (SELECT s.id FROM exercise_sessions s WHERE s.participant_id = u.id AND s.status = 'active') AS active_session_id,
        (SELECT COUNT(*) FROM exercise_sessions s WHERE s.participant_id = u.id) AS session_count,
        (SELECT MAX(s.created_at) FROM exercise_sessions s WHERE s.participant_id = u.id) AS last_session_at,
        (SELECT COUNT(*) FROM workouts w WHERE w.participant_id = u.id) AS workout_count,
        (SELECT COUNT(*) FROM workouts w WHERE w.participant_id = u.id AND w.status = 'incomplete') AS incomplete_workouts,
        (SELECT COUNT(*) FROM patient_messages m WHERE m.participant_id = u.id AND m.is_read = 0) AS unread_messages,
        (SELECT COUNT(*) FROM workouts w
          JOIN patient_plans pp ON pp.participant_id = w.participant_id
          WHERE w.participant_id = u.id AND w.after_bpm IS NOT NULL
            AND ((pp.target_bpm_max IS NOT NULL AND w.after_bpm > pp.target_bpm_max)
              OR (pp.target_bpm_min IS NOT NULL AND w.after_bpm < pp.target_bpm_min))) AS out_of_range_bpm_count
      FROM users u JOIN staff_participants sp ON sp.participant_id = u.id
      WHERE sp.staff_id = ? ORDER BY u.name, u.id`, req.user.id);
    res.json({
      participants: rows.map(row => ({
        ...publicUser(row),
        active_session_id: row.active_session_id,
        session_count: row.session_count,
        last_session_at: row.last_session_at,
        workout_count: row.workout_count,
        incomplete_workouts: row.incomplete_workouts,
        unread_messages: row.unread_messages,
        out_of_range_bpm_count: row.out_of_range_bpm_count,
      })),
    });
  });
  app.get('/api/participants/:id/workouts', userAuth, staffOrAdmin, assignedParticipant,
    async (req, res) => res.json(await workoutList(req.params.id, req.query)));
  app.get('/api/participants/:id/progress', userAuth, staffOrAdmin, assignedParticipant,
    async (req, res) => res.json(await progress(req.params.id, req.query)));

  const shared = { db, transaction, userAuth, participant, staff, admin, staffOrAdmin, assigned, canView, assignedParticipant };
  registerSessionRoutes(app, shared);
  registerAppSyncRoutes(app, shared, appSync);
  registerAdminRoutes(app, shared);
  registerPlanRoutes(app, shared);
  registerMessageRoutes(app, { ...shared, botAddress: bot.address || null });
  registerBotRoutes(app, { db, webhookSecret: bot.webhookSecret });

  app.get('/api/device/workout', deviceAuth, async (req, res) => {
    const workout = await db.get("SELECT * FROM workouts WHERE device_id = ? AND status IN ('pending', 'active')", req.device.id);
    if (workout) {
      workout.device_seen_at = new Date().toISOString();
      await db.run('UPDATE workouts SET device_seen_at = ? WHERE id = ?', workout.device_seen_at, workout.id);
    }
    res.json({ workout: workout || null });
  });

  app.post('/api/device/workouts/:id/updates', deviceAuth, async (req, res) => {
    const target = await db.get('SELECT kind FROM workouts WHERE id = ? AND device_id = ?', req.params.id, req.device.id);
    if (!target) fail(404, 'Workout not found');
    if (target.kind === 'reps') {
      res.json(await transaction(async tx => {
        const workout = await tx.get('SELECT * FROM workouts WHERE id = ? AND device_id = ?', req.params.id, req.device.id);
        if (!workout) fail(404, 'Workout not found');
        return applyDeviceEvent(tx, workout, req.body, new Date().toISOString());
      }));
      return;
    }
    bodyFields(req.body, ['sequence', 'repetitions', 'elapsed_seconds'], ['heart_rate_bpm', 'completed']);
    const sequence = integer(req.body.sequence, 'sequence', 1, 2_147_483_647);
    const repetitions = integer(req.body.repetitions, 'repetitions', 0, 1_000_000);
    const elapsed = integer(req.body.elapsed_seconds, 'elapsed_seconds', 0, 86400);
    const heartRate = req.body.heart_rate_bpm == null ? null : integer(req.body.heart_rate_bpm, 'heart_rate_bpm', 1, 300);
    if (req.body.completed !== undefined && typeof req.body.completed !== 'boolean') fail(400, 'completed must be a boolean');
    const completed = req.body.completed === true ? 1 : 0;
    const result = await transaction(async tx => {
      const workout = await tx.get('SELECT * FROM workouts WHERE id = ? AND device_id = ?', req.params.id, req.device.id);
      if (!workout) fail(404, 'Workout not found');
      const existing = await tx.get('SELECT * FROM workout_readings WHERE workout_id = ? AND sequence = ?', workout.id, sequence);
      if (existing) {
        if (existing.repetitions !== repetitions || existing.elapsed_seconds !== elapsed || existing.heart_rate_bpm !== heartRate || existing.completed !== completed) {
          fail(409, 'Sequence already exists with different data');
        }
        return { workout, duplicate: true };
      }
      if (!['pending', 'active'].includes(workout.status)) fail(409, 'Workout has ended');
      if (sequence <= workout.last_sequence) fail(409, 'Sequence must increase');
      if (repetitions < workout.repetitions || elapsed < workout.elapsed_seconds) fail(409, 'Cumulative repetitions and elapsed time cannot decrease');
      const now = new Date().toISOString();
      await tx.run(`INSERT INTO workout_readings (workout_id, sequence, repetitions, elapsed_seconds, heart_rate_bpm, completed, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, workout.id, sequence, repetitions, elapsed, heartRate, completed, now);
      await tx.run(`UPDATE workouts SET status = ?, repetitions = ?, elapsed_seconds = ?, heart_rate_bpm = COALESCE(?, heart_rate_bpm),
        last_sequence = ?, started_at = COALESCE(started_at, ?), ended_at = ?, updated_at = ? WHERE id = ?`,
        completed ? 'completed' : 'active', repetitions, elapsed, heartRate, sequence, now, completed ? now : null, now, workout.id);
      return { workout: await tx.get('SELECT * FROM workouts WHERE id = ?', workout.id), duplicate: false };
    });
    res.json(result);
  });

  const resolvedStatic = staticDir ? resolve(staticDir) : null;
  if (resolvedStatic && existsSync(join(resolvedStatic, 'index.html'))) {
    app.use(express.static(resolvedStatic));
    app.use((req, res, next) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api/') && req.path !== '/api') {
        return res.sendFile(join(resolvedStatic, 'index.html'));
      }
      next();
    });
  }

  app.use((req, res) => res.status(404).json({ error: { message: 'Route not found' } }));
  app.use((error, req, res, next) => {
    let status = error.status || 500;
    let message = error.message;
    if (error.type === 'entity.parse.failed') message = 'Malformed JSON body';
    if (error.type === 'entity.too.large') message = 'JSON body exceeds 16kb';
    if ([1555, 2067].includes(error.errcode) || [1555, 2067].includes(error.rawCode)
      || ['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(error.code)
      || (error.code === 'SQLITE_CONSTRAINT' && /UNIQUE|PRIMARY KEY/i.test(error.message ?? ''))) {
      status = 409;
      message = 'Record already exists, or this device already has an unfinished workout';
    }
    if (status >= 500) {
      console.error('Request failed:', error.code || error.name);
      message = 'Internal server error';
    }
    res.status(status).json({ error: { message, ...(status < 500 ? error.extra : {}) } });
  });
  return app;
}
