# MotionTrack

MotionTrack is a rep-counting exercise tracker for a course demo (ECE 198). An ESP32 with a motion sensor, pulse sensor
and small OLED communicates over Bluetooth Low Energy with the **Motion Log** iPhone app (`mobile/`). The patient picks
an exercise (Biceps curl / Arm Curl, Shoulder press, Back row) and a target of 1 to 50 reps in the app; the tracker
checks heart rate before and after the set, counts reps, and syncs completed or stopped sets over HTTPS to the website
dashboard (queuing offline if signal drops). A doctor signs in separately to review assigned patients' synced sets,
optional live workout streams, care plans (notes, target reps, heart-rate range), and messages. An admin creates doctor
accounts and assigns patients to doctors.
An exercise is **Complete** only when every rep was counted and both heart-rate readings exist; otherwise it is
**Incomplete**. Retried uploads from the phone are idempotent (`client_id`) and never counted twice.

Motion Log can also measure fingertip pulse with the iPhone camera. On iPhone 17 Pro and Pro Max it uses the front camera and screen light. Accepted before- and after-workout readings sync with the set. [iPhone camera pulse instructions](mobile/README.md#iphone-camera-pulse)

The website says "patient", "doctor" and "admin"; the API, CLI and database call those roles `participant`, `staff`
and `admin`.

The database defaults to local SQLite (`backend/data/ece198.sqlite`) and optionally connects to a hosted Turso
libSQL database when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set (used on Render's free plan to keep
synced workouts across deploys).

Note on legacy Wi-Fi firmware: direct ESP32-to-server Wi-Fi device tokens and `firmware/` are kept in the repository
for backward compatibility and preserving historical device records, while the patient website now acts as a synced
dashboard for Motion Log (`mobile/`). [Mobile wiring and setup guide](mobile/setup-guide.md)

## Layout

```text
backend/    Node 24 + Express + SQLite API, device protocol, account CLI, email bot, tests
frontend/   React + Vite website: patient at /, doctor at /doctor, admin at /admin; synthetic test device script
firmware/   ESP32 sketches: MotionTrackSingle/ (Bluetooth app build, one file), MotionTrack/ (Wi-Fi), host tests
mobile/     SwiftUI iPhone app, Bluetooth-enabled ESP32 firmware, wiring guide and protocol tests
docs/       user-guide.md (using the website), demo.md (setup and demo script), design/ (the approved design)
```

## Quick start (no hardware)

Needs Node.js 24+ and npm. Terminal 1:

```bash
cd backend
npm ci
test -f .env || cp .env.example .env
npm start
```

Terminal 2:

```bash
cd frontend
npm ci
test -f .env.local || cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173/` (patient), `http://localhost:5173/doctor` (doctor) or `http://localhost:5173/admin`
(admin). The
[user guide](docs/user-guide.md) explains each screen; to try it without hardware, use the synthetic test device as
described in [docs/demo.md](docs/demo.md). Run the checks with `cd backend && npm test`,
`cd frontend && npm test && npm run build` and `bash firmware/tests/run.sh`.

## Documentation

- [Using the website](docs/user-guide.md): patients, doctors, admins, and setting up accounts
- [Demo setup and script](docs/demo.md): exact steps, with the test device or the real ESP32; LAN and live-domain
  access; the email bot
- [Backend: API, device protocol, schema, migration, CLI](backend/README.md)
- [Demo accounts and Render deployment](backend/README.md#demo-accounts-and-render): the demo seed needs
  `DEMO_ADMIN_PASSWORD`, `DEMO_DOCTOR_PASSWORD` and `DEMO_PATIENT_PASSWORD` and creates nothing without them
- [Frontend: website setup, test device, behaviour](frontend/README.md)
- [Firmware: wiring, libraries, flashing, Serial commands](firmware/README.md)
- [Approved design](docs/design/2026-11-18-motiontrack-design.md)

## Status

The backend, website and test device are implemented and tested together. The firmware has been checked with host
tests on synthetic data; real Wi-Fi, rep-counting thresholds and the heart-rate check-in still need to be tested
on the hardware (see the notes in docs/demo.md).
