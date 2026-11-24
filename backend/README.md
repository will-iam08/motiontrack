# MotionTrack backend

Local Node.js 24 + Express 5 + SQLite backend for MotionTrack. Patients record workouts on the ESP32 over Bluetooth
using the **Motion Log** iPhone app (`mobile/`) and sync completed or stopped sets over HTTPS to this server.
Supported exercises are Arm Curl (wire code `1`, `arm_curl`), Shoulder Press (wire code `3`, `shoulder_press`) and
Back Row (wire code `4`, `back_row`) with a target of `1–50` reps (wire code `2` / Lateral raise is unused and rejected).
Legacy direct Wi-Fi ESP32 routes (`/api/device/*`, `/api/devices`) remain active for backward compatibility and
preserving existing data while the patient website now acts as a synced dashboard. An assigned doctor reviews the
patient's sessions, sets a care plan and answers questions; an admin manages doctor accounts and assignments.

The website says "patient", "doctor" and "admin". In the API, CLI and database those accounts have the roles
`participant`, `staff` and `admin`; this document uses the API names where it describes routes and fields.

Contents: [1 API](#1-api-endpoints) · [2 Device protocol](#2-device-protocol) · [3 Database schema and migration](#3-database-schema-and-migration) · [4 Setup](#4-setup)

## 1) API endpoints

Base URL: `http://127.0.0.1:3000`. Requests and responses are JSON, except successful logout and device
revocation (204, no body). Send `Content-Type: application/json` with JSON bodies (at most 16 kB). Timestamps are
server-generated UTC ISO 8601 strings. Unknown body fields and unknown query parameters are rejected with 400.

Credentials:

- **Public:** none.
- **User:** `Authorization: Bearer <token>` returned by registration or login. Tokens expire after 24 hours.
- **Participant:** a user token whose account role is `participant` (a patient).
- **Staff:** a user token whose role is `staff` (a doctor). Reading a participant's records also needs an assignment; without one the route answers **404**, the same as for a record that does not exist.
- **Admin:** a user token whose role is `admin`. Admins can read every participant's records without an assignment.
- **Bot:** `BOT_WEBHOOK_SECRET`, only on `POST /api/bot/inbound-email`, checked in this order: the header `X-Bot-Secret: <secret>`, then `Authorization: Bearer <secret>`, then the query parameter `?secret=<secret>` (for mail services that only keep the target URL; a repeated `secret` is refused). A header that is present wins, even if it is wrong. Prefer a header: query strings can appear in proxy and tunnel logs. The backend logs only which kind of credential a refused call carried and its length, never the value.
- **Device:** `Authorization: Bearer <device_token>`, returned once when a participant adds a device. It works only on the two `/api/device/...` routes.

### Objects

User `U` (the password hash is never returned):

```json
{"id":"user-uuid","name":"Demo patient","email":"patient@example.com","role":"participant","created_at":"2026-11-18T15:00:00.000Z"}
```

Device `D`:

```json
{"id":"device-uuid","name":"Wrist ESP32","created_at":"2026-11-18T15:01:00.000Z","last_seen_at":null}
```

Session `S`: `workouts` lists only the session's rep exercises, oldest first.

```json
{"id":"session-uuid","participant_id":"user-uuid","device_id":"device-uuid","status":"active",
 "created_at":"2026-11-18T15:02:00.000Z","ended_at":null,"updated_at":"2026-11-18T15:02:00.000Z","workouts":[W]}
```

Exercise (workout) `W`. This is a finished Arm Curl; every column of the `workouts` table is returned:

```json
{
  "id":"workout-uuid","participant_id":"user-uuid","device_id":"device-uuid",
  "exercise_name":"Arm Curl","kind":"reps","target_duration_seconds":null,
  "session_id":"session-uuid","exercise_id":"arm_curl","target_reps":10,"phase":"done","status":"completed",
  "repetitions":10,"elapsed_seconds":0,"heart_rate_bpm":null,
  "before_bpm":78,"before_bpm_at":"2026-11-18T15:02:12.000Z","after_bpm":104,"after_bpm_at":"2026-11-18T15:02:30.000Z",
  "before_skipped":0,"after_skipped":0,"device_status":"counting","device_seen_at":"2026-11-18T15:02:30.000Z",
  "last_sequence":15,"created_at":"2026-11-18T15:02:05.000Z","started_at":"2026-11-18T15:02:12.000Z",
  "ended_at":"2026-11-18T15:02:30.000Z","updated_at":"2026-11-18T15:02:30.000Z"
}
```

A missing check-in is `null`, never 0. `*_skipped` is 0 or 1. Old workouts from before MotionTrack have
`kind:"timed"`, a `target_duration_seconds` and null rep fields (`session_id`, `exercise_id`, `target_reps`, `phase`).

Progress `P`, calculated from `completed` workouts only:

```json
{
  "completed_workouts": 2,
  "total_repetitions": 20,
  "total_duration_seconds": 80,
  "daily": [
    {
      "date": "2026-11-18",
      "exercise_name": "Arm Curl",
      "workouts": 2,
      "repetitions": 20,
      "duration_seconds": 80,
      "avg_before_bpm": 74,
      "avg_after_bpm": 106
    }
  ],
  "heart_rate": [
    {
      "id": "workout-uuid",
      "date": "2026-11-18",
      "recorded_at": "2026-11-18T15:02:12.000Z",
      "exercise_name": "Arm Curl",
      "repetitions": 10,
      "target_reps": 10,
      "elapsed_seconds": 40,
      "before_bpm": 74,
      "after_bpm": 106
    }
  ]
}
```

Dates are the UTC date of `started_at` (or `created_at` when there is none). `daily` includes rounded daily average
`avg_before_bpm` and `avg_after_bpm`, and `heart_rate` returns up to the 40 most recent completed workouts with a
`before_bpm` or `after_bpm` reading ordered chronologically. In the tables below, `S`, `W`, `U`, `D` and `P` stand
for these objects.

### Health, exercises and accounts

| Method and route | Access | Request | Response |
| --- | --- | --- | --- |
| `GET /api/health` | Public | none | 200 `{"status":"ok"}` |
| `GET /api/exercises` | Public | none | 200 `{"exercises":[{"id":"arm_curl","name":"Arm Curl","placement":"forearm"},{"id":"shoulder_press","name":"Shoulder Press","placement":"upper arm"},{"id":"back_row","name":"Back Row","placement":"upper arm"}]}` |
| `POST /api/auth/register` | Public | `{"name","email","password"}` | 201 `{"token","expires_at","user":U}`. Always creates a `participant`. A duplicate email is 409. |
| `POST /api/auth/login` | Public | `{"email","password"}` plus optional `"portal"`: `"patient"`, `"doctor"` or `"admin"` | 200 `{"token","expires_at","user":U}` |
| `POST /api/auth/logout` | User | none | 204 |
| `GET /api/me` | User | none | 200 `{"user":U}` |

`portal` is the website entry point the person signed in on, and each one accepts only its own role (`patient` →
`participant`, `doctor` → `staff`, `admin` → `admin`). On a mismatch the server answers **403** with a message naming
the account's own sign-in, exactly one of "This is a patient account. Use the patient sign-in.", "This is a doctor
account. Use the doctor sign-in." or "This is an admin account. Use the admin sign-in.", and creates no session.
A wrong password is still 401 on every portal. Any other `portal` value is 400. Omitting `portal` skips
the check. Wrong email or password is 401, with the same cost for unknown emails. Names are 1-80 characters;
emails are lowercased and unique; passwords are 12-128 characters. Registration and login share a limit of 20
attempts per IP per 15 minutes (429 with `Retry-After`).

### Devices (participant)

| Method and route | Request | Response |
| --- | --- | --- |
| `POST /api/devices` | `{"name":"Wrist ESP32"}` | 201 `{"device":D,"device_token":"d_<random>"}`. The token is shown only this once. |
| `GET /api/devices` | none | 200 `{"devices":[D]}` (not revoked) |
| `DELETE /api/devices/:id` | none | 204. Revokes the token. In one transaction its open rep exercise becomes `incomplete` (phase `done`), its open timed workout becomes `cancelled`, and its active session ends. History is kept. Unknown, someone else's or already revoked device: 404. |

### Sessions and exercises (participant)

A participant has at most one active session at a time. A session is tied to the device chosen when it starts.

| Method and route | Request | Response |
| --- | --- | --- |
| `POST /api/sessions` | `{"device_id"}` | 201 `{"session":S}`. Unknown, foreign or revoked device: 404. A session is already active: 409 with `error.session_id`. |
| `GET /api/sessions` | optional `limit` (default 10, 1-50), `offset`, `status` (`active` or `ended`) | 200 `{"sessions":[S],"limit","offset","total","server_time"}`, newest first |
| `GET /api/sessions/:id` | none (owner, assigned staff or admin) | 200 `{"session":S,"server_time"}` |
| `POST /api/sessions/:id/exercises` | `{"exercise_id":"arm_curl","target_reps":10}` | 201 `{"workout":W}` with `status:"pending"`, `phase:"before_bpm"`. `exercise_id` is one of `arm_curl`, `shoulder_press`, `back_row`; `target_reps` is an integer 1-50. 409 if the session has ended, if it has an unfinished exercise ("Finish or stop the current exercise first"), or if the device has any unfinished workout. |
| `POST /api/workouts/:id/skip-reading` | none | 200 `{"workout":W}`. In phase `before_bpm` it sets `before_skipped` and moves to `counting` (the exercise can no longer complete). In phase `after_bpm` it sets `after_skipped`, ends the exercise as `incomplete` (phase `done`). Any other phase, or a timed workout: 409 with `error.phase`. |
| `POST /api/workouts/:id/cancel` | none | 200 `{"workout":W}`. This is "Stop exercise". A rep exercise becomes `incomplete`, phase `done`, keeping the data recorded so far; a legacy timed workout becomes `cancelled`. Idempotent. A `completed` workout is 409. |
| `POST /api/sessions/:id/end` | none | 200 `{"session":S}`. Ends the session; an unfinished exercise becomes `incomplete`. Idempotent. |

`skip-reading`, `cancel` and `end` work only on the caller's own records (other participants' and unknown ids are 404).

### Workout history and progress

| Method and route | Access | Response |
| --- | --- | --- |
| `GET /api/workouts` | Participant | 200 `{"workouts":[W],"limit","offset","total"}`, newest first. Optional `limit` (default 20, 1-100), `offset`, `status` (`pending`, `active`, `completed`, `cancelled`, `incomplete`), `kind` (`timed` or `reps`), `exercise_name` (exact, case-insensitive). |
| `GET /api/workouts/:id` | Owner, assigned staff or admin | 200 `{"workout":W}` |
| `GET /api/workouts/:id/readings` | Owner, assigned staff or admin | Legacy timed workouts only hold readings (`workout_readings`); rep exercises return an empty list. Optional `limit` (default 100, 1-1000), `offset`. 200 `{"readings":[...],"limit","offset","total"}` |
| `GET /api/progress` | Participant | 200 `P`. Optional `exercise_name` and `kind`. |

### Doctor (staff) and admin read routes

| Method and route | Access | Response |
| --- | --- | --- |
| `GET /api/participants` | Staff | 200 `{"participants":[U + "active_session_id","session_count","last_session_at","workout_count","incomplete_workouts","unread_messages","out_of_range_bpm_count"]}`: only assigned patients. `active_session_id` is the id of the patient's active session, or `null`. |
| `GET /api/participants/:id/sessions` | Staff or admin | 200 like `GET /api/sessions` (same `limit`, `offset`, `status`). An unassigned participant (for staff) or an id that is not a participant: 404. |
| `GET /api/participants/:id/workouts` | Staff or admin | 200 like `GET /api/workouts` (same filters incl. `kind`). Unassigned: 404. |
| `GET /api/participants/:id/progress` | Staff or admin | 200 `P` (optional `exercise_name`, `kind`). Unassigned: 404. |

Staff can also read `GET /api/sessions/:id`, `GET /api/workouts/:id` and its `/readings` for assigned patients; for
anyone else those answer 404. Admins can read them for every participant. Neither can change exercise records:
participant-only routes return 403 for them. Staff write only care plans and message replies (below).

### Care plans

Plan `C`: `{"participant_id","staff_id","notes","arm_curl_reps","shoulder_press_reps","back_row_reps","target_bpm_min","target_bpm_max","updated_at","doctor_name"}`.
`staff_id` and `doctor_name` are whoever saved it last (a doctor or an admin); the reps are integers 1-50 or `null`,
the heart-rate range (after exercise) is 30-220 bpm or `null`, with min ≤ max; notes are at most 1000 characters.

| Method and route | Access | Request | Response |
| --- | --- | --- | --- |
| `GET /api/participants/:id/plan` | Assigned staff or admin | none | 200 `{"plan":C}` or `{"plan":null}` |
| `PUT /api/participants/:id/plan` | Assigned staff or admin | any of `notes`, the three `*_reps`, `target_bpm_min`, `target_bpm_max` | 200 `{"plan":C}`. Replaces the whole plan: fields left out are cleared. Invalid values are 400. |
| `GET /api/plan` | Participant | none | 200 `{"plan":C}` (own plan) or `{"plan":null}` |

An unassigned doctor gets 404 and a participant gets 403 on the `/api/participants/:id/plan` routes.

### Messages and the email bot

Message `M`: `{"id","participant_id","sender_email","subject","body","source","is_read","doctor_reply","replied_at","received_at","replied_by_name"}`.
`source` is `portal` (sent from the website) or `email_bot`; `is_read` is a boolean.

| Method and route | Access | Request | Response |
| --- | --- | --- | --- |
| `GET /api/bot/info` | Participant | none | 200 `{"address","email"}`: the bot address (`BOT_EMAIL_ADDRESS`, else `BOT_IMAP_USER`, else `null`) and the participant's own email, the only one the bot accepts from them. |
| `POST /api/messages` | Participant | `{"body"}` plus optional `"subject"` (≤ 200) | 201 `{"message":M}` with `source:"portal"`. `body` is 1-4000 characters after trimming. |
| `GET /api/messages` | Participant | none | 200 `{"messages":[M]}`, own messages with replies, newest first (up to 100). |
| `GET /api/doctor/messages` | Staff | optional `unread_only` (`0` or `1`) | 200 `{"messages":[M + "participant_name","participant_email","active_session_id"],"unread_count"}`: only messages from patients assigned to this doctor, newest first (up to 200). |
| `PATCH /api/doctor/messages/:id` | Staff | `{"is_read"?: bool, "doctor_reply"?: "1-4000 characters"}` (at least one) | 200 `{"message":M}`. A reply also marks the message read. A message from a patient who is not assigned to this doctor: 404. |
| `POST /api/bot/inbound-email` | Bot | `{"from","text"}` plus optional `"subject"` | 201 `{"stored":true,"message_id"}`; 202 `{"stored":false}` for a sender who is not a registered participant (nothing is stored); 401 for a missing or wrong secret; 404 when `BOT_WEBHOOK_SECRET` is not set. |

The bot reads `from` as `"Name <address>"` or a bare address and matches the address to a participant's email
without regard to case. A missing subject becomes `(no subject)`; text longer than 4000 characters is cut. Its JSON
body may be up to 256 kB. The secret is compared in constant time. The optional IMAP poller (see
[environment variables](#environment-variables)) passes each unread email through the same code and then marks it
read.

### Admin routes

| Method and route | Request | Response |
| --- | --- | --- |
| `GET /api/admin/overview` | none | 200 `{"patients":[U + "active_session_id","session_count","last_session_at","workout_count","unread_messages"],"doctors":[U + "patient_count"],"assignments":[{"staff_id","participant_id"}],"stats":{"patients","doctors","assignments","sessions","active_sessions","workouts","completed_workouts","devices","messages","unread_messages"}}` |
| `POST /api/admin/doctors` | `{"name","email","password"}` | 201 `{"user":U}` with role `staff`. A used email is 409. |
| `POST /api/admin/assignments` | `{"staff_id","participant_id"}` | 201 `{"assignment","created":true}`, or 200 with `created:false` if it already existed. An id that is not a staff or participant account: 404. |
| `DELETE /api/admin/assignments` | `{"staff_id","participant_id"}` | 204. Not assigned: 404. |

Every admin route answers 403 to participants and staff.

### Legacy timed workouts

Before MotionTrack the API recorded fixed-duration workouts. Those routes remain so old data stays readable and the
old tests stay valid; the website no longer offers them (it only lists old workouts and lets a patient cancel one that
is still open, because an open workout blocks the device).

### Motion Log iPhone app sync (participant)

Authenticated with a patient bearer token (`Authorization: Bearer <token>` from `POST /api/auth/login` with
`"portal": "patient"`):

| Method and route | Access | Request | Response |
| --- | --- | --- | --- |
| `POST /api/app/sets` | Participant | `{"client_id","exercise","target_reps","repetitions","elapsed_seconds","before_bpm","after_bpm","before_skipped","after_skipped","started_at","ended_at"}` | `201` on new insert or finalizing an open live preview; `200 {"workout":W,"session":S,"duplicate":true}` when re-sent identically; `409` if `client_id` is reused with different values. |
| `PUT /api/app/live` | Participant | `{"client_id","exercise","target_reps","repetitions","elapsed_seconds","phase"}` plus optional `"before_bpm"`, `"before_skipped"`, `"device_status"` | `200 {"workout":W,"session":S,"server_time"}`. Rate-limited per user (`429` with `Retry-After`). Updates `device_seen_at` for `"last update N s ago"`. Returns `409` if an active Wi-Fi session is open or the `client_id` already finished. |
| `DELETE /api/app/live` | Participant | none | `204`. Discards any unfinalized app live preview cleanly. |

Validation and completeness rules for `POST /api/app/sets`:

- `client_id` must be a valid UUID string; stored per `(participant_id, client_id)`.
- `exercise` accepts integer wire codes `1`, `3`, `4` or IDs `arm_curl`, `shoulder_press`, `back_row` (wire code `2` and all other values return `400`).
- `target_reps` is standardized at `1–50`; `repetitions` is `0–50` (`<= target_reps`); `elapsed_seconds` is `0–86400`.
- `before_bpm` and `after_bpm` accept `null` or `1–300` (never `0`). When `before_skipped` or `after_skipped` is `true`, the corresponding BPM must be `null`.
- Status is `completed` **only** when `repetitions == target_reps` and both `before_bpm` and `after_bpm` are non-null; otherwise `incomplete`.
- Care plan targets and heart-rate bounds are fetched by the app via `GET /api/plan`.

| Method and route | Notes |
| --- | --- |
| `POST /api/workouts` | Participant. `{"device_id","exercise_name","target_duration_seconds"}` (1-86400) creates a `kind:"timed"` workout (`pending`). 409 if the device already has an unfinished workout. |
| `POST /api/device/workouts/:id/updates` for a timed workout | Original body `{"sequence","repetitions","elapsed_seconds","heart_rate_bpm"?,"completed"?}`; response `{"workout":W,"duplicate":bool}`; stored in `workout_readings`. Cumulative values cannot decrease. The firmware does not run timed workouts. |

### Errors

All errors look like `{"error":{"message":"Workout not found"}}`. Some 409s add fields such as `phase` or `session_id`.

| Status | Meaning |
| --- | --- |
| 400 | Invalid, missing or unknown input; malformed JSON; invalid query |
| 401 | Missing, expired or revoked token; wrong email or password |
| 401 | (also) Missing or wrong `X-Bot-Secret` |
| 403 | Wrong role, wrong sign-in entry point (`portal`), or browser origin not allowed |
| 404 | Route, record or participant missing or not accessible to the caller |
| 409 | Duplicate email; state conflict (active session, unfinished exercise or device workout, ended record, wrong phase); upload conflict |
| 413 | JSON body over 16 kB |
| 429 | Authentication throttle |
| 500 | Unexpected error (details are not returned) |

## 2) Device protocol

Routes use the device token. Every authenticated request also updates the device's `last_seen_at`.

**Poll.** `GET /api/device/workout` returns `{"workout":W}` for the device's single pending/active workout, or
`{"workout":null}`. The firmware polls about once a second. Each poll sets that workout's `device_seen_at`. The
fields the device uses are `id`, `kind`, `exercise_id`, `exercise_name`, `target_reps`, `phase`, `repetitions`,
`last_sequence` and `status`. A `kind:"timed"` workout is left over from before MotionTrack and is not run.

**Upload.** `POST /api/device/workouts/:id/updates` with one of four bodies. `sequence` is an integer 1 to
2147483647 that must be larger than the workout's `last_sequence`.

```json
{"sequence":1,"event":"status","capture_status":"waiting_finger"}
{"sequence":2,"event":"before_bpm","bpm":78}
{"sequence":3,"event":"progress","repetitions":1}
{"sequence":14,"event":"after_bpm","bpm":104}
```

`capture_status` is one of `waiting_finger`, `reading`, `weak_signal`, `counting`. `repetitions` is the cumulative
count (0-1000000), `bpm` an integer 1-300. Each body must contain exactly its fields.

Success is `200 {"workout":W,"duplicate":false}`. Any accepted event sets `status:"active"` and the workout's
`last_sequence`, `device_seen_at` and `updated_at`.

| Event | Allowed in phase | Effect |
| --- | --- | --- |
| `status` | `before_bpm`, `counting`, `after_bpm` | Sets `device_status` only; no phase change. |
| `before_bpm` | `before_bpm` | Saves `before_bpm` and `before_bpm_at`; phase becomes `counting`. |
| `progress` | `counting` | Saves the cumulative `repetitions` (cannot decrease or exceed `target_reps`). Reaching `target_reps` freezes the count: phase becomes `after_bpm`. |
| `after_bpm` | `after_bpm` | Saves `after_bpm` and `after_bpm_at`; phase becomes `done`; `ended_at` is set. Status is `completed` if `repetitions == target_reps` and a before reading exists (any BPM values, lower or equal is fine), otherwise `incomplete` (for example the before reading was skipped). |

Phases run `before_bpm` → `counting` → `after_bpm` → `done`. The website's skip and stop actions move the phase on
without the device, so the device must follow `phase` from its poll.

Duplicate and conflict rules:

1. An upload whose `sequence` already exists is checked first, even after the exercise has ended. Identical content
   returns **200 `duplicate:true`** and changes nothing except `device_seen_at`: the count and BPM are not saved again.
   The same sequence with different content is 409.
2. A new event on an ended workout is 409 ("Workout has ended").
3. A new `sequence` not greater than `last_sequence` is 409.
4. An event not allowed in the current phase (for example `progress` after the website skipped the reading) is 409
   with `error.phase`; the device should poll again.
5. `repetitions` above the target is 400; below the stored count is 409.
6. Malformed bodies, unknown events or fields are 400; an unknown workout id, or one on another device, is 404.

Every accepted event is stored in `workout_events`, in the same transaction as the workout update. The device
resends the same bytes until it receives a 2xx or a 409.

## 3) Database schema and migration

SQLite file, `STRICT` tables, foreign keys on. Source: [`schema.sql`](./schema.sql) (version 1 base, run on every
start with `IF NOT EXISTS`) and [`migrations.js`](./migrations.js) (versions 2, 3 and 4).

**Versioning.** Schema versions are recorded in the `schema_migrations` table (and also `PRAGMA user_version` when
running on local SQLite, now version 4; `PRAGMA user_version` is left untouched on remote Turso databases). A new
local database initializes straight to v4 (or runs v2 → v3 → v4 incrementally on existing v1–v3 files). Migrations run
in a transaction, check foreign keys, and roll back completely if anything fails.

**What version 2 does.** It creates `exercise_sessions` and `workout_events`, and rebuilds `workouts` with new
columns by copying every row. Every existing workout is kept with `kind='timed'`; its readings in
`workout_readings` are untouched. Nothing is deleted.

**What version 3 does.** It rebuilds `users` so `role` may also be `admin`, copying every row with the same ids (all
foreign keys to `users(id)` keep pointing at the same people), and creates `patient_plans` and `patient_messages`.

**What version 4 does.** It rebuilds `exercise_sessions` and `workouts` (preserving every existing row) so
`device_id` is nullable for app-synced workouts, adds `source` (`'device'` or `'app'`, existing rows default to
`'device'`), adds `client_id TEXT` on `workouts` with unique partial index `idx_workouts_participant_client` on
`(participant_id, client_id) WHERE client_id IS NOT NULL`, and scopes `idx_workouts_device_open` to `WHERE device_id IS NOT NULL AND status IN ('pending', 'active')`.

| Table | Purpose |
| --- | --- |
| `users` | Accounts; `role` is `participant`, `staff` or `admin`. Passwords are scrypt hashes. |
| `auth_sessions` | Hashed user tokens with expiry. (Not exercise sessions.) |
| `staff_participants` | Doctor-to-patient assignments (many to many). |
| `devices` | One row per ESP32 per participant; only a SHA-256 hash of the device token; `revoked_at` keeps history. |
| `exercise_sessions` | `id`, `participant_id`, nullable `device_id`, `source` (`device`/`app`), `status` (`active`/`ended`), `created_at`, `ended_at`, `updated_at`. A partial unique index allows one `active` session per participant. |
| `workouts` | One row per exercise (and per legacy timed workout). Columns below. |
| `workout_events` | Upload log for rep exercises: `workout_id`, `sequence`, `type` (`status`/`before_bpm`/`progress`/`after_bpm`), `repetitions`, `bpm`, `capture_status`, `received_at`; primary key (`workout_id`, `sequence`), which enforces the duplicate rule. |
| `workout_readings` | Legacy per-upload log for timed workouts. |
| `patient_plans` | One care plan per participant (primary key `participant_id`, deleted with the participant): `staff_id` (who saved it; set to NULL if that account is deleted), `notes` (≤ 1000), `arm_curl_reps`, `shoulder_press_reps`, `back_row_reps` (1-50 or NULL), `target_bpm_min`, `target_bpm_max` (30-220 or NULL, min ≤ max), `updated_at`. |
| `patient_messages` | Patient questions: `id`, `participant_id`, `sender_email`, `subject` (≤ 200), `body` (1-4000 after trimming), `source` (`email_bot`/`portal`), `is_read` (0/1), `doctor_reply` (≤ 4000), `replied_by`, `replied_at`, `received_at`. |

`workouts` columns: the original `id`, `participant_id`, `device_id`, `exercise_name`, `status`, `repetitions`,
`elapsed_seconds`, `heart_rate_bpm`, `last_sequence`, `created_at`, `started_at`, `ended_at`, `updated_at`, and the
version 2 additions `kind` (`timed`/`reps`), `target_duration_seconds` (now nullable), `session_id`, `exercise_id`,
`target_reps` (1-50), `phase`, `before_bpm`, `before_bpm_at`, `after_bpm`, `after_bpm_at`, `before_skipped`,
`after_skipped`, `device_status`, `device_seen_at`. `status` allows `pending`, `active`, `completed`,
`cancelled` (legacy) and `incomplete`. A CHECK requires timed rows to have a duration and rep rows to have a session,
an exercise, a target and a phase. the partial unique index on `device_id` (`WHERE device_id IS NOT NULL AND status IN ('pending', 'active')`) allows one pending/active workout per
device, and `idx_workouts_participant_client` enforces unique `(participant_id, client_id)` for idempotent app uploads.
No raw sensor data is stored, and no API deletes accounts or workouts.

## 4) Setup

Requires **Node.js 24 or newer** and npm. Express is the only required dependency; `imapflow` is an optional one,
loaded only when the email bot's IMAP poller is configured. SQLite, hashing and the test runner are built into Node. Node may print an experimental-SQLite warning; it is harmless.

```bash
cd backend
npm ci
cp .env.example .env
npm start
```

In another terminal:

```bash
curl http://127.0.0.1:3000/api/health
```

The database and its folder are created on first start and survive restarts. Local data, `.env` and `node_modules`
are git-ignored.

### Tests

```bash
cd backend
npm test
```

The tests use real HTTP requests against temporary servers and databases (including migration of version 1 and
version 2 databases); they never touch your own database and need no network (the IMAP poller is tested with a
stand-in mailbox).

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface to listen on. Use `0.0.0.0` so an ESP32 (or a mail service) on the same network can reach it. Phones and laptops use the website, which forwards `/api`, so they do not need this. |
| `PORT` | `3000` | TCP port, 1-65535. |
| `DATABASE_PATH` | `./data/ece198.sqlite` | Local SQLite file when `TURSO_DATABASE_URL` is unset. Use the same value for the server and the CLI. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | none | Optional Turso (libSQL) URL (`libsql://…` or `https://…`) and token. Enables persistent hosted storage on Render's free tier; omit both locally to keep using `DATABASE_PATH`. |
| `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated list of exact browser origins, each without a path or trailing slash. Other browser origins get 403. Requests with no `Origin` header (ESP32, curl, the website's dev-server proxy for its own address) are unaffected. |
| `STAFF_PASSWORD` | none | Used by `create-staff`, and by `create-admin` when `ADMIN_PASSWORD` is not set (12-128 characters). Do not store it in `.env`. |
| `ADMIN_PASSWORD` | none | Used by `create-admin` (12-128 characters). Do not store it in `.env`. |
| `DEMO_ADMIN_PASSWORD`, `DEMO_DOCTOR_PASSWORD`, `DEMO_PATIENT_PASSWORD` | none | Used only by `seed-demo.js` for the demo admin, doctor and patient accounts. All three are required, 12-128 characters each and different from each other; without them no demo accounts are created. See [Demo accounts](#demo-accounts-and-render). |
| `BOT_EMAIL_ADDRESS` | `BOT_IMAP_USER` | The address patients email; shown on their Messages tab. |
| `BOT_WEBHOOK_SECRET` | none | Enables `POST /api/bot/inbound-email`; at least 16 characters. Without it the route is off (404). |
| `BOT_IMAP_HOST`, `BOT_IMAP_USER`, `BOT_IMAP_PASS` | none | When all three are set, the server checks that mailbox for unread mail. Off by default. |
| `BOT_IMAP_PORT`, `BOT_IMAP_TLS`, `BOT_IMAP_MAILBOX`, `BOT_IMAP_POLL_SECONDS` | `993`, `true`, `INBOX`, `60` | IMAP connection details; the poll interval is 15-3600 seconds. |

`npm start` and `npm run manage` read `.env` if it exists.

### Admin and doctor accounts, and assignments

There is no doctor or admin registration on the website. Create the first admin from `backend/`; that admin can
then create doctors and assignments on the website at `/admin`:

```bash
export ADMIN_PASSWORD='choose-a-long-password'
npm run manage -- create-admin admin@example.com "Admin Name"
unset ADMIN_PASSWORD
```

The same can be done from the CLI. A patient registers on the website first; then, from `backend/`:

```bash
export STAFF_PASSWORD='choose-a-long-password'
npm run manage -- create-staff doctor@example.com "Dr Demo"
unset STAFF_PASSWORD
npm run manage -- assign doctor@example.com patient@example.com
```

Remove an assignment:

```bash
npm run manage -- unassign doctor@example.com patient@example.com
```

The commands work while the server is running and print JSON. `create-staff` refuses an email that already has an
account (it never promotes one), and so does `create-admin`; `assign` and `unassign` require an existing `staff`
email and an existing `participant` email, and are idempotent. Command usage: `create-staff EMAIL NAME`,
`create-admin EMAIL NAME`, `assign STAFF_EMAIL PARTICIPANT_EMAIL`, `unassign STAFF_EMAIL PARTICIPANT_EMAIL`.

### Demo accounts and Render

`node seed-demo.js` creates a fixed set of demo accounts: four admins (`admin1@motiontrack.org` to
`admin4@motiontrack.org`), two doctors (`dr.chen@motiontrack.org`, `dr.morgan@motiontrack.org`) and two patients
(`maya.patel@motiontrack.org`, `liam.park@motiontrack.org`), and assigns each patient to one doctor. It has no
built-in passwords. It reads one password per role from `DEMO_ADMIN_PASSWORD`, `DEMO_DOCTOR_PASSWORD` and
`DEMO_PATIENT_PASSWORD`; each must contain 12-128 characters and the three must differ. Passwords that earlier
versions of this repository published as defaults are refused.

If the variables are missing or invalid, the script creates nothing, prints one line naming the variable to fix
(never a password) and exits with code 0, so `node seed-demo.js && npm start` still starts the server, just without
demo accounts. Running it again only adds accounts that do not exist yet: it never changes the password of an
existing account.

To try it locally, from `backend/` (choose your own values; do not store them in `.env`):

```bash
printf 'Demo admin password: '; read -rs DEMO_ADMIN_PASSWORD; echo; export DEMO_ADMIN_PASSWORD
printf 'Demo doctor password: '; read -rs DEMO_DOCTOR_PASSWORD; echo; export DEMO_DOCTOR_PASSWORD
printf 'Demo patient password: '; read -rs DEMO_PATIENT_PASSWORD; echo; export DEMO_PATIENT_PASSWORD
node seed-demo.js
unset DEMO_ADMIN_PASSWORD DEMO_DOCTOR_PASSWORD DEMO_PATIENT_PASSWORD
```

`../render.yaml` runs the seed before each start and declares the three variables with `generateValue: true`, so
Render creates a random value for each one that does not exist yet (on the first Blueprint deploy and on later
Blueprint syncs). `../render.yaml` also declares optional `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (`sync: false`):
set both in Render **Environment** to persist data across free-tier deploys and restarts, or leave them unset to fall
back to local SQLite. To sign in as a demo user, open the service in the Render Dashboard, go to **Environment**, and
reveal the value of the variable for that role. To use your own value instead, edit it there and redeploy; this
only affects accounts that do not exist yet.

There is no command to change an existing account's password. A database that was seeded before the passwords
became required still has the old published passwords on those accounts; delete that database file (this removes
all its data) and seed again, or do not expose it.

LAN access, a live domain through Cloudflare Tunnel and the email bot are set up in
[../docs/guides/demo.md](../docs/guides/demo.md) sections 6 and 7.

### Real ESP32

Set `HOST=0.0.0.0` in `.env`, restart, and point the firmware's `API_BASE_URL` at `http://<laptop LAN IP>:3000`
(`localhost` on the ESP32 is the ESP32). The laptop firewall must allow the port. See [../firmware/README.md](../firmware/README.md)
and [../docs/guides/demo.md](../docs/guides/demo.md).

### Scope

HTTP with a single SQLite process, for a local course prototype. Deployment, TLS, password recovery, sensor
calibration, medical interpretation of BPM and a real data-retention policy are out of scope. Use synthetic data.
