# MotionTrack website

React + Vite frontend for the [MotionTrack backend](../backend/README.md). It has three entry points:

- **Patient:** `http://localhost:5173/` — register or sign in, view the **Overview** dashboard fed by the Motion Log
  iPhone app (setup instructions with copyable server URL, doctor's care plan, synced totals, recent sets and optional
  live stream during active app workouts), browse **History** (CSV export and print), inspect **Progress** charts, and
  ask the doctor questions on the **Messages** tab. (Legacy **My devices** and Wi-Fi device tokens are retired from the UI.)
- **Doctor:** `http://localhost:5173/doctor` — sign in with a doctor account, read and answer questions in the
  Patient Message Inbox, see assigned patients (with a "Live now" badge), open each patient's sessions and
  exercises (read-only), and set each patient's care plan.
- **Admin:** `http://localhost:5173/admin` — overview metrics, every patient's sessions, patient–doctor
  assignments and doctor accounts.

Signing in on the wrong entry point is refused by the server ("This is a patient account. Use the patient
sign-in.", or the doctor or admin version). Internally the roles are `participant` (patient), `staff` (doctor) and
`admin`; that is what the API and CLI call them.

## Requirements

- Node.js 24 or newer for the backend (the frontend itself builds on Node 22+) and npm.
- The backend running at `http://127.0.0.1:3000` (the dev server forwards `/api` there).

## Run it locally

Terminal 1, backend:

```bash
cd backend
npm ci
test -f .env || cp .env.example .env
npm start
```

Terminal 2, frontend:

```bash
cd frontend
npm ci
test -f .env.local || cp .env.example .env.local
npm run dev
```

Open **http://localhost:5173**. The dev server is pinned to port 5173 and fails rather than moving to another port.
The website calls the API at `/api` on its own address and the dev (and preview) server forwards those calls to the
backend, so the same build works on `localhost`, on the LAN and through a tunnel. `npm run dev:lan` (or
`npm run preview:lan` after a build) listens on every network interface so phones on the same Wi-Fi can open it; see
[../docs/guides/demo.md](../docs/guides/demo.md) section 6 for the LAN and a Cloudflare Tunnel.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_TARGET` | `http://127.0.0.1:3000` | Where the dev/preview server forwards `/api`. |
| `VITE_ALLOWED_HOSTS` | none | Extra host names the dev/preview server answers to, comma-separated (for example `.trycloudflare.com`). |
| `VITE_API_ORIGIN` | none | Only for a website hosted apart from the API: the API origin the browser calls directly (that site's origin must then be in the backend's `CORS_ORIGIN`). `VITE_API_BASE_URL` is accepted as an older name. |

The dev server removes a browser `Origin` header that names the site's own address before forwarding, because the
backend's `CORS_ORIGIN` list does not know LAN or tunnel addresses; any other origin is passed on and checked by the
backend. Vite variables are public and end up in the browser bundle. Never put passwords or tokens in them.

### Tests and build

```bash
cd frontend
npm test
npm run build
```

`npm test` runs the unit tests (exercise status and BPM display rules, progress ranges, route detection, care-plan
checks and form validation, message and admin helpers, and the dev-server origin rule).
`npm run build` writes the production build to `dist/`. `npm run preview` serves it at `http://localhost:5173`.

## Admin and doctor accounts

There is no doctor or admin registration on the website. Create an admin with the backend CLI
(`ADMIN_PASSWORD=… npm run manage -- create-admin admin@example.com "Admin Name"`); the admin can then create
doctor accounts and assignments at `/admin`. The same can be done from the CLI. The patient must have registered
first:

```bash
cd backend
export STAFF_PASSWORD='choose-a-long-password'
npm run manage -- create-staff doctor@example.com "Dr Demo"
unset STAFF_PASSWORD
npm run manage -- assign doctor@example.com patient@example.com
```

## Trying it without hardware: the fake device

`scripts/fake-device.mjs` pretends to be the ESP32 and sends **made-up** heart rates and reps to the real backend
device routes, using the same protocol as the firmware. It is a test tool only and says nothing about the real
device, its sensors or its firmware.

It works on **one exercise per run**: start the exercise on the website, then run the script with the device token
the website showed once when you added the device. It prints each step, runs before-check-in, reps, and
after-check-in, and exits when the exercise is closed (done, stopped or session ended). Run it again for the next
exercise. The token is never printed.

```bash
cd frontend
DEVICE_TOKEN='<token from My devices>' npm run fake-device -- --help
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--bpm-before N` | 78 | Heart rate sent for the check-in before the exercise (1-300). |
| `--bpm-after N` | 104 | Heart rate sent for the check-in after the exercise (1-300). |
| `--rep-ms N` | 800 | Milliseconds per repetition (50-60000). |
| `--weak-ms N` | 0 | Report "weak signal" for N ms in each check-in before it succeeds. |
| `--no-after-bpm` | off | Never finish the after-check-in: keep reporting "waiting for finger" / "weak signal" until the website's Skip reading is used (the exercise ends Incomplete). |
| `--retry-last` | off | After the first counted rep, resend that upload byte for byte and print the server's reply (`duplicate`); the count does not change. |

`API_BASE_URL` (environment variable) overrides the backend address (default `http://127.0.0.1:3000`).

Example runs, one per exercise. Start the matching exercise on the website first (with a target of 5 reps, say):

```bash
# Arm Curl: normal run
DEVICE_TOKEN='<token>' npm run fake-device -- --rep-ms 600
```

```bash
# Shoulder Press: first check-in is weak for 3 s before it succeeds
DEVICE_TOKEN='<token>' npm run fake-device -- --weak-ms 3000 --bpm-before 82 --bpm-after 110
```

```bash
# Back Row: demonstrate a retried upload that must not double-count
DEVICE_TOKEN='<token>' npm run fake-device -- --retry-last
```

```bash
# Any exercise: never take the after reading; press "Skip reading" on the website to end it Incomplete
DEVICE_TOKEN='<token>' npm run fake-device -- --no-after-bpm
```

The full course demo is in [../docs/guides/demo.md](../docs/guides/demo.md).

## How the website behaves

- **Sign-in.** The account token is kept in memory only; reloading signs you out. Sign-out revokes the session on
  the server and any 401 returns to the sign-in screen.
- **Device tokens** are shown once, kept only while that panel is open, and never stored or logged by the site.
- **Live exercise.** The open exercise is refreshed about once a second in a single awaited loop (never
  overlapping); lists refresh about every 5 seconds. Failures back off (1, 2, 4, 8, then 10 s) and the page marks
  itself as disconnected from the server while it keeps the last data. If the device has not contacted the server for more than
  5 seconds while an exercise is open, the page shows "Device not responding".
- **Heart rate** is only the before and after check-in values with their capture times. A missing value shows as
  "No reading" (or "Skipped" when the patient skipped it), never as 0 and never estimated.
- **Status.** An exercise is **Complete** only when all target reps were counted and both check-ins exist.
  Otherwise it ends **Incomplete** (skipped or missing reading, stopped exercise, or session ended early).
- **Progress** counts completed exercises and reps only, over a selectable range.
- **Doctor view** uses the same polling for a live session; exercise records are read-only, and an unassigned
  patient is not reachable (the API answers 404). The message inbox refreshes every 10 seconds.
- **Care plans.** The Care plan column compares each exercise with the patient's current plan and always says the
  result in words next to the badge (Met / Below, In range / Above / Below / No reading).
- **Admin view** refreshes the overview every 10 seconds and opens any patient with the same page a doctor sees.
