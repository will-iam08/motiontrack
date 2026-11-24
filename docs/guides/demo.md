# Motion Track demo: setup and script

This is the exact local setup and the course demo, in two versions: **A** with the synthetic test device (no
hardware) and **B** with the real ESP32. Run all commands from the repository root unless a step says otherwise.
Each step lists what must be visible for it to pass.

The website says "patient", "doctor" and "admin"; the CLI and API call those roles `participant`, `staff` and
`admin`.

## What has and has not been tested

Tested with the **synthetic test device** (`frontend/scripts/fake-device.mjs`, made-up numbers), the backend tests,
the website tests and the host-side firmware tests:

- the whole flow below on the website, the backend and the doctor view;
- retry safety (a repeated upload returns `duplicate:true` and changes nothing), phases, skip and stop rules;
- the firmware's check-in, exercise-flow and upload-queue logic with synthetic data on a PC.

**Not tested on hardware** (expect to verify on a physical device):

- real Bluetooth Low Energy link between the ESP32 and a physical iPhone running the Motion Track app;
- real HTTPS uploads from the physical Motion Track iPhone app to the backend;
- the MPU6050 rep counting thresholds and MAX30102 heart-rate check-in on the sensor;
- the OLED screens and the sensor mounting.

**Not tested against real services:** the IMAP poller of the email bot (its logic is tested with a stand-in
mailbox), a real mail service calling the webhook, and a Cloudflare Tunnel. LAN access was checked by sending
requests with a LAN address to the dev server, not from a phone.

Nothing here has been tried with real patients; use made-up accounts.

## 1) One-time setup

Needs Node.js 24+ and npm. (Part B also needs the Arduino IDE or `arduino-cli`.)

```bash
cd backend
npm ci
test -f .env || cp .env.example .env
cd ../frontend
npm ci
test -f .env.local || cp .env.example .env.local
cd ..
```

Pass: both `npm ci` commands finish without errors.

Start from a clean database for the demo (stop the backend first if it is running; this deletes only the local demo data):

```bash
rm -f backend/data/ece198.sqlite backend/data/ece198.sqlite-wal backend/data/ece198.sqlite-shm
```

## 2) Start the servers

Terminal 1, backend:

```bash
cd backend
npm start
```

Pass: it prints `ECE 198 backend listening on http://127.0.0.1:3000`.

Check it from another terminal:

```bash
curl http://127.0.0.1:3000/api/health
```

Pass: `{"status":"ok"}`.

Terminal 2, website:

```bash
cd frontend
npm run dev
```

Pass: it shows `http://localhost:5173/`. Open that address in a browser (use `localhost`, not `127.0.0.1`).

## 3) Demo script

The numbers (targets 5 and 4 reps) keep the demo short; any target from 1 to 50 works.

### Step 1: register a patient

Open `http://localhost:5173/`, choose **Create an account**, and register `patient@example.com` with a password of
12 or more characters.

Pass: you are signed in and see the four tabs: **Overview**, **History**, **Progress** and **Messages** (the Overview tab shows the **Record exercises with the Motion Track app** card with your copyable server URL).

### Step 2: sync from the Motion Track app (or simulate an app upload)

In the **Motion Track** iPhone app (`mobile/`):

1. Open **My tracker** and tap **Sign in**, then enter the server URL from your **Overview** card along with your patient email and password (stored in the iPhone Keychain for 24 hours; Bluetooth workouts also work offline and queue locally).
2. Connect your ESP32 over Bluetooth (`Scan for tracker`).
3. Choose **Biceps curl** (`1`), **Shoulder press** (`3`), or **Back row** (`4`), set **Target** (`1–50`, pre-filled from your care plan), and tap **Start workout**.
4. Complete the before/after heart-rate check-ins and reps (or **Skip heart-rate check** / **End workout**), and see the set upload to **Overview** and **History**.

Pass (simulated HTTP without an iPhone): signing in via `POST /api/auth/login` (`portal: "patient"`) and posting to `POST /api/app/sets` with a UUID `client_id` returns `201`, and re-sending the exact same `client_id` returns `200 {"duplicate": true}` without creating a second workout row. (The legacy Wi-Fi `fake-device` CLI helper in `frontend/` also still works directly against the legacy `/api/device/*` routes if you need a Wi-Fi device simulation.)

### Step 3: start a session

Open **Session** and press **Start workout session**.

Pass: the session opens and offers the three exercises, each with its mounting hint (Arm Curl: forearm; Shoulder
Press and Back Row: upper arm).

### Step 4: Arm Curl (forearm) with a target

Choose **Arm Curl**, target **5**, press **Start exercise**.

Pass: the exercise shows three steps (Heart rate before, Reps, Heart rate after) with Heart rate before highlighted
and the device status waiting for the device.

**Part A (fake device).** In a third terminal:

```bash
cd frontend
DEVICE_TOKEN='<token from step 2>' npm run fake-device -- --rep-ms 1000 --retry-last
```

**Part B (real ESP32).** Set the device up first (section 4), then wait for it to pick up the exercise.

Pass, in both parts, in this order:

1. **Before-BPM prompt.** The OLED (part B) shows `PLACE YOUR FINGER`, then `Hold still`; the website shows "Place your
   finger on the sensor", then "Hold still — reading". Part A prints `Step 1: heart rate before exercise`. After the reading the
   website shows the before BPM (part A: 78) with a time, and the Reps step is highlighted.
2. **Counting to the target.** The OLED shows `Arm Curl` and `1 / 5` up to `5 / 5`; the website shows the same count
   once a second. At 5 / 5 the count **freezes**: more motion does not change it.
3. **After BPM.** The device asks for the finger again; the website's third step is highlighted. The reading is saved
   (part A: 104) and the exercise shows **Complete** with reps 5 / 5, before BPM and after BPM.
4. Part A only: the script printed `Server reply: duplicate` after the first rep, and the count on the website did not
   change (see step 11).

### Step 5: Back Row (upper arm) in the same session

Under **Choose next exercise**, choose **Back Row**, enter target **4** and press **Start exercise**.

Part A:

```bash
cd frontend
DEVICE_TOKEN='<token from step 2>' npm run fake-device -- --rep-ms 1000 --bpm-before 82 --bpm-after 110
```

Part B: attach the sensor to the upper arm as shown on the website, then follow the device.

Pass: the same sequence happens with a **fresh** before-BPM (part A: 82), counting that stops at `4 / 4`, and its own
after-BPM (part A: 110). The session table now lists two exercises, Arm Curl and Back Row, both Complete.

### Step 6: end the session

Press **End session**.

Pass: the session shows as ended and the table keeps both exercises.

### Step 7: create a doctor and assign the patient (CLI)

```bash
cd backend
export STAFF_PASSWORD='demo-doctor-password-1'
npm run manage -- create-staff doctor@example.com "Dr Demo"
unset STAFF_PASSWORD
npm run manage -- assign doctor@example.com patient@example.com
```

Pass: each command prints JSON; the first shows the new user with `"role": "staff"`, the second shows
`"assigned": true`.

The same can be done on the website from the admin portal instead (step 12).

### Step 8: the assigned doctor sees both exercises

Open `http://localhost:5173/doctor` (sign out of the patient first, or use a private window) and sign in as
`doctor@example.com`.

Pass: the dashboard lists the patient. Press **View workouts** next to the patient, then **Show exercises** on the
session: a table shows **Arm Curl** and **Back Row**, each with target reps, reps done, heart rate before with its time,
heart rate after with its time, start and end times and status Complete.

Check the sign-in entry points as well. Signing in at `/doctor` with the **patient** account, or at `/` with the
**doctor** account, must be refused with "This is a patient account. Use the patient sign-in." (or the doctor
equivalent).

### Step 9: an unassigned doctor sees nothing

Create a second doctor who is not assigned:

```bash
cd backend
export STAFF_PASSWORD='demo-doctor-password-2'
npm run manage -- create-staff other@example.com "Dr Other"
unset STAFF_PASSWORD
```

Sign in at `/doctor` as `other@example.com`.

Pass: the page says "No patients are assigned to you yet." The API agrees. Get a token and ask for the patient's
sessions. First get the patient's id: sign in as the patient through the API and read `user.id` from the reply
(`"user":{"id":"..."}`):

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"patient@example.com","password":"<the patient password from step 1>","portal":"patient"}'
```

Then get the other doctor's token:

```bash
curl -s -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"other@example.com","password":"demo-doctor-password-2","portal":"doctor"}'
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer <token from the previous command>' \
  http://127.0.0.1:3000/api/participants/<patient id>/sessions
```

Pass: `404`. The same request with the assigned doctor's token returns `200`.

Remove and restore the assignment to see access follow it (optional):

```bash
cd backend
npm run manage -- unassign doctor@example.com patient@example.com
```

Pass: the first doctor's patient list becomes empty after the page refreshes (the doctor's patient list refreshes every 5 seconds, so within about 5 seconds). Re-run `assign` from
step 7 to restore it.

### Step 10: a skipped or missing BPM leaves an exercise Incomplete

Sign in as the patient again, start a session if none is active, and start **Arm Curl** with target **3**.

Part A, device that never completes the after reading:

```bash
cd frontend
DEVICE_TOKEN='<token from step 2>' npm run fake-device -- --rep-ms 800 --no-after-bpm
```

Wait until the reps reach `3 / 3` and the device keeps reporting "waiting for finger" or "weak signal" for the after
reading, then press **Skip reading** on the website.

Part B: take the first reading, count to the target, then do not put a finger on the sensor and press **Skip
reading** on the website.

Pass: the exercise shows status **Incomplete**; the after BPM shows "Skipped" (not 0); reps 3 / 3 and the before BPM are
kept. Skipping the **before** reading also works: counting then starts, but the exercise can only end Incomplete.
Ending the session while an exercise is still unfinished does the same. A stopped exercise (**Stop exercise**) is
Incomplete and keeps what was recorded.

### Step 11: a retried upload is not counted twice (`duplicate:true`)

This is the demo of retry safety: the same upload sent twice is stored once.

**Part A.** Start a new exercise (under **Choose next exercise**, pick any exercise, enter target **5** and press
**Start exercise**) and run the fake device with `--retry-last`:

```bash
cd frontend
DEVICE_TOKEN='<token from step 2>' npm run fake-device -- --rep-ms 1000 --retry-last
```

Pass: after the first counted rep the script prints `Retry test: sending upload #N again, byte for byte...` and then
`Server reply: duplicate (#N was already saved; nothing changed, still 1 / 5 reps)`. The website's count does not jump.

**Part B.** With the ESP32 connected to the laptop's Serial Monitor (115200 baud), after the first rep type `r` and
press Enter.

Pass: Serial prints a line like `Retry seq 7 -> HTTP 200 duplicate:true`, and the website's count does not change.

### Step 12: the admin portal

Create an admin account (once):

```bash
cd backend
export ADMIN_PASSWORD='demo-admin-password-1'
npm run manage -- create-admin admin@example.com "Demo Admin"
unset ADMIN_PASSWORD
```

`create-admin` reads `ADMIN_PASSWORD`, or `STAFF_PASSWORD` if that is not set (12 to 128 characters). Open
`http://localhost:5173/admin` and sign in as `admin@example.com`.

Pass:

- **Overview** shows tiles for patients, doctors, workout sessions, exercises recorded, devices and unread messages,
  and lists any patient exercising now and any patient without a doctor.
- **Doctor accounts**: fill in **Create doctor account** (name, email, a 12-character password) and press the button.
  The new doctor appears in the list and can sign in at `/doctor`.
- **Assignments**: choose a doctor and a patient and press **Assign patient**; the patient appears under that doctor
  with an **Unassign** button. The doctor's dashboard follows within about 5 seconds.
- **All patients** → **View sessions** opens any patient's sessions and care plan, assigned or not.
- Signing in at `/admin` with a patient or doctor account, or at `/` or `/doctor` with the admin account, is refused
  with "This is an admin account. Use the admin sign-in." (or the patient/doctor equivalent).

### Step 13: a care plan from the doctor

Sign in at `/doctor` as `doctor@example.com`, press **View workouts** next to the patient and fill in **Care Plan:
Notes, Target Reps & Heart Rate**: a note, for example **Arm Curl 5** and **Back Row 4**, and a heart-rate range
such as **60** to **120**. Press **Save care plan**.

Pass: "Care plan saved …" appears. Values outside 1–50 reps or 30–220 bpm, or a lowest value above the highest,
are refused with a message next to the field. The session tables gain a **Care plan** column that says, with a
badge and words, whether each exercise **Met** the prescribed reps (or was **Below**) and whether the heart rate
after was **In range**, **Above** or **Below** the target.

Sign in as the patient. Pass: the **Overview** tab shows a **From Your Doctor** card with the note, the reps per exercise
and the target range, and synced rows in **History** include the Care plan badges (**Met**/**Below**, **In range**/**Above**/**Below**). Signing in inside the Motion Track iPhone app loads that same care plan via `GET /api/plan` and pre-fills the rep target stepper (1–50).

### Step 14: a patient question in the doctor's inbox

As the patient, open **Messages**, type a question and press **Send question**.

Pass: as the doctor, **Patient Message Inbox** at the top of the dashboard shows "1 unread message", the patient's
name and email, the subject, the question and when it arrived, marked **New**. **Mark as read** changes it to
**Read**; typing a reply and pressing **Send reply** shows the reply under the question, and the patient sees it on
their Messages tab within about 15 seconds. **Open patient record** opens that patient's page. A doctor who is not
assigned to the patient does not see the message. To send the question by email instead, see section 7.

## 4) Demo with the real ESP32 (part B): setup

1. Make the backend reachable from the Wi-Fi: in `backend/.env` set `HOST=0.0.0.0`, then restart `npm start`.
   Find the laptop's LAN IP address with one of these:

   ```bash
   hostname -I
   ```

   ```bash
   ipconfig getifaddr en0
   ```

   (the first on Linux, the second on macOS; on Windows use `ipconfig`.) Check from another device on the same
   network that `http://<laptop IP>:3000/api/health` returns `{"status":"ok"}`. If not, allow port 3000 in the laptop
   firewall. The website still runs at `http://localhost:5173` on the laptop.
2. Add the device on the website (step 2) and copy the token: it is shown once.
3. Configure and flash the firmware by following [../firmware/README.md](../firmware/README.md): copy
   `secrets.example.h` to `secrets.h`, set `WIFI_SSID`, `WIFI_PASSWORD`, `DEVICE_TOKEN` and
   `API_BASE_URL=http://<laptop IP>:3000`, then compile and upload for **DOIT ESP32 DEVKIT V1**. Open the Serial
   Monitor at 115200 baud.
4. Keep the sensor still for the start-up calibration.

Pass: the OLED shows `MotionTrack` / `Waiting for website` and the bottom line shows Wi-Fi and server status
connected. `Device not registered` means the token is wrong or the device was removed; add the device again and
update `secrets.h`. Then run the demo script from step 3 and ignore the "Part A" commands.

## 5) Automated checks (no demo needed)

```bash
cd backend && npm test
```

```bash
cd frontend && npm test && npm run build
```

```bash
bash firmware/tests/run.sh
```

Pass: each command finishes with all tests passing (the build prints a completed bundle).

## 6) Other devices: the LAN and a live domain

The website calls the API at `/api` on its own address, and the Vite server forwards those calls to the backend
(`VITE_API_TARGET`, default `http://127.0.0.1:3000`). So a phone or another laptop only needs to reach the website;
the backend can stay on `127.0.0.1` unless the ESP32 needs it (section 4).

**Same Wi-Fi (LAN).** On the laptop:

```bash
cd frontend
npm run dev:lan
```

Vite prints a `Network:` address such as `http://192.168.1.10:5173/`. Open it on the phone (`/doctor` and `/admin`
work too). If it does not load, allow port 5173 in the laptop firewall. `npm run build` followed by
`npm run preview:lan` serves the built site the same way.

**A live domain with Cloudflare Tunnel.** Install `cloudflared`, keep `npm run dev` running, and in another
terminal:

```bash
cloudflared tunnel --url http://localhost:5173
```

It prints an `https://<random words>.trycloudflare.com` address. Vite only answers to host names it knows, so allow
the tunnel's domain in `frontend/.env.local` and restart `npm run dev`:

```bash
VITE_ALLOWED_HOSTS=.trycloudflare.com
```

For a named tunnel on your own domain, list that host instead (for example `VITE_ALLOWED_HOSTS=motiontrack.example.org`).
Anyone with the address can reach the sign-in pages, so use made-up accounts and strong passwords, and stop the
tunnel after the demo.

**Why no CORS change is needed.** A browser sends an `Origin` header with sign-in and save requests. The Vite
server removes it when it is the site's own address (LAN or tunnel), and passes any other origin on for the backend
to check. If the website is served from somewhere that calls the backend directly instead (with `VITE_API_ORIGIN`
set), add that site's origin to `CORS_ORIGIN` in `backend/.env`; it takes a comma-separated list, and
`http://localhost:5173,http://127.0.0.1:5173` is the default.

## 7) The email bot

Patients can email a question to a bot address; it lands in their doctors' **Patient Message Inbox** like a question
sent from the website. Only emails **from the address a patient signed up with** are stored (matched without regard to
upper/lower case); everything else is ignored. Long emails are cut to 4000 characters.

Set the address patients should write to in `backend/.env`, so the patient's Messages tab can show it:

```bash
BOT_EMAIL_ADDRESS=ask@motiontrack.example.org
```

Then choose one way for mail to reach the backend.

**A. Webhook (any mail service that can POST JSON).** Set a long random secret in `backend/.env` and restart:

```bash
BOT_WEBHOOK_SECRET=<at least 16 random characters, for example from: openssl rand -hex 24>
```

The service must send `POST /api/bot/inbound-email` with the header `X-Bot-Secret: <the secret>` and a JSON body
`{"from": "Name <patient@example.com>", "subject": "...", "text": "..."}`. Try it with curl:

```bash
curl -s -X POST http://127.0.0.1:3000/api/bot/inbound-email -H 'Content-Type: application/json' \
  -H 'X-Bot-Secret: <the secret>' \
  -d '{"from":"Demo Patient <PATIENT@example.com>","subject":"Question","text":"Is 120 bpm after the row okay?"}'
```

Pass: `201` with `{"stored":true,...}` and the question appears in the doctor's inbox marked **By email**. An
unknown sender gets `202` with `{"stored":false}` and nothing is stored; a missing or wrong secret gets `401`. Without
`BOT_WEBHOOK_SECRET` the route does not exist (`404`). The mail service must reach the backend: through a tunnel to
port 3000, or by running the backend with `HOST=0.0.0.0` on a network the service can reach.

**A with CloudMailin (no domain or mailbox of your own needed).** CloudMailin's free plan (10,000 emails a month,
up to 512 KB each, no card) gives you an address such as `abc123@cloudmailin.net` and posts every email to a URL.
The webhook reads CloudMailin's **JSON (Normalized)** format directly and accepts the secret as
`Authorization: Bearer <secret>` (CloudMailin can only set the Authorization header) or, if CloudMailin will not keep
that setting, as `?secret=<secret>` on the Target URL.

1. Set `BOT_WEBHOOK_SECRET` as above, and `BOT_EMAIL_ADDRESS` to your CloudMailin address, in `backend/.env`. Restart
   the backend. Use a hex secret (`openssl rand -hex 24`) so it can go in a URL unchanged.
2. Make the website reachable with a Cloudflare Tunnel (section 6). The Vite server forwards `/api` to the backend,
   so the one tunnel serves both.
3. In CloudMailin, edit the address:
   - **Target URL**: `https://<your tunnel>.trycloudflare.com/api/bot/inbound-email`
   - **Format**: JSON (Normalized)
   - **Authorization Settings**: `Bearer <the BOT_WEBHOOK_SECRET value>`

   **If the Authorization setting does not stay saved** (emails get `401` and the backend prints
   `Email bot webhook rejected: no X-Bot-Secret header, Authorization header or secret query parameter`), put the
   secret in the Target URL instead and leave Authorization empty:
   - **Target URL**: `https://<your tunnel>.trycloudflare.com/api/bot/inbound-email?secret=<BOT_WEBHOOK_SECRET>`

   CloudMailin no longer accepts `user:pass@` in the URL, so this query parameter is the way to do it. If both are
   sent, the header wins: a wrong `X-Bot-Secret` or `Bearer` value is refused even when `?secret=` is right.
4. Email the CloudMailin address from the address a patient signed up with.

Pass: CloudMailin's message log shows status `201`, and the question appears in the doctor's inbox marked
**By email**. A quick tunnel gets a new address every time it starts, so update the Target URL whenever you restart
`cloudflared`. CloudMailin can only deliver while your laptop, the servers and the tunnel are running.

You can check the Target URL yourself before emailing (replace both placeholders; a registered patient's address
gives `201`, anything else `202`, a wrong secret `401`):

```bash
curl -s -X POST 'https://<your tunnel>.trycloudflare.com/api/bot/inbound-email?secret=<the secret>' \
  -H 'Content-Type: application/json' \
  -d '{"from":"Demo Patient <PATIENT@example.com>","subject":"Question","text":"Is 120 bpm after the row okay?"}'
```

The backend never prints the secret: a refused call is logged as, for example,
`Email bot webhook rejected: secret query parameter (48 characters)`. But a query string is part of the URL, and
URLs can end up where headers do not: CloudMailin's own message log, the Vite dev server's `http proxy error` lines
(printed when the backend is not running), and logs of any proxy or tunnel in between. So prefer the Authorization
header whenever CloudMailin keeps it, and if the URL with the secret has been shared or logged somewhere you do not
control, change `BOT_WEBHOOK_SECRET`, restart the backend and update the Target URL.

**B. IMAP mailbox (the backend reads a mailbox itself).** Use a dedicated mailbox for the bot, ideally with an app
password. In `backend/.env`:

```bash
BOT_IMAP_HOST=imap.example.org
BOT_IMAP_USER=ask@motiontrack.example.org
BOT_IMAP_PASS=<the mailbox or app password>
# Optional: BOT_IMAP_PORT=993, BOT_IMAP_TLS=true, BOT_IMAP_MAILBOX=INBOX, BOT_IMAP_POLL_SECONDS=60
```

The poller starts only when host, user and password are all set; it uses the `imapflow` package, which `npm ci`
installs as an optional dependency. Every minute it reads unread mail, stores emails from patients and marks every
email it read as read. Pass: on start the backend prints `Email bot checking ask@… on imap.example.org every 60 s`,
and an email sent from the patient's address appears in the inbox within a minute. Errors are printed as
`Email bot: could not check …` (the password is never printed). Never commit `.env`.

## 8) Troubleshooting

- **Browser shows a network or origin error.** Open the site through the Vite server (`npm run dev`), at
  `http://localhost:5173` or `http://127.0.0.1:5173`, or the LAN or tunnel address from section 6.
- **`Blocked request. This host is not allowed.`** Add the host name to `VITE_ALLOWED_HOSTS` (section 6) and restart
  the dev server.
- **`Too many authentication attempts`.** Sign-in is limited to 20 attempts per 15 minutes per address; wait, or
  restart the backend during testing.
- **Port already in use.** Stop the earlier backend or `npm run dev`; the dev server refuses to change ports.
- **`409 A session is already active`.** End the active session on the website first.
- **The fake device says `The server refused the device token (401)`.** Add the device again and use the new token.
- **Nothing happens on the device.** Start an exercise on the website first. The device only runs the exercise
  the website has started for it.
- **Start over.** Stop the backend first, then run the `rm -f` command from section 1 and start it again.

More detail: [backend README](../backend/README.md) (API and protocol), [frontend README](../frontend/README.md),
[firmware README](../firmware/README.md) and the [design record](design/2026-11-18-motiontrack-design.md).
