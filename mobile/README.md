# MotionTrack for iPhone and ESP32

Use an iPhone to select a biceps curl, shoulder press or back row, choose a target of 1–99 reps, and start or end a set. The ESP32 counts the selected movement, tracks elapsed time, checks heart rate before and after the set, and sends readings to the phone over Bluetooth Low Energy. The OLED and optional physical button also work with this firmware. [Wiring, installation and workout guide](setup-guide.md)

## iPhone camera pulse

In **My tracker**, leave **Use iPhone camera for pulse** on. Before pressing Start, attach the tracker and select the exercise. On iPhone 17 Pro and 17 Pro Max, MotionTrack selects the front camera. Place the phone face up on a table and rest the pad of one finger over the selfie lens at the top of the screen. A small live preview helps you locate the lens. Once the app detects contact, the countdown and pulse waveform take over. The screen provides light during capture and restores its previous brightness afterwards. Other iPhones start with the rear camera. You can switch cameras on the measurement screen. A reading needs at least 25 seconds of contact. The camera normally stops after 55 seconds. If you find or regain fingertip contact late in the measurement, the app gives that placement time to collect a fresh sample, up to 80 seconds total. Follow the waveform and signal indicator, then tap **Use BPM and start**. After the set, repeat the measurement and tap **Save BPM and sync**. You can retry a weak signal or skip either check. Skipping records a missing reading. If you dismiss the after-workout check, the set stays on this phone until you measure or choose **Skip and sync set**. The tracker continues counting and timing over BLE. No ESP32 firmware update is required for the sensor-disabled build.

To try a standalone measurement while the tracker is idle or disconnected, open **My tracker → Check pulse with iPhone camera**. Standalone readings are displayed locally. After a timeout, the result shows the longest contact time and why a reading could not be confirmed. To inspect a failed attempt, choose **Troubleshooting → Save signal sample…**. This exports relative times, coverage, measurement states and average fingertip colors as a CSV. The file contains no images or account identifiers. The app processes frames on the phone and sends only the accepted BPM with the workout. Camera estimates are for fitness use. For hardware validation, compare several steady measurements at rest and after activity against simultaneous readings from a reference pulse oximeter, and record unsuccessful attempts as well as differences in BPM.

## Install the matching app and firmware

1. Wire the unpowered classic ESP32 DOIT DevKit V1 (4 MB). Use 3.3 V-compatible modules and tie their grounds together. Check the board's GPIO labels.

   | Module | SDA | SCL | Other connection |
   | --- | --- | --- | --- |
   | SSD1306 128×64 OLED | GPIO21 | GPIO22 | Address 0x3C or 0x3D |
   | MAX30102 pulse sensor | GPIO25 | GPIO26 | Address 0x57 |
   | MPU6050 motion sensor | GPIO32 | GPIO33 | AD0 low, address 0x68 |
   | Optional push button | | | GPIO27 to GND, internal pull-up |

2. Plug the ESP32 into a computer with a USB data cable. From this directory, use PlatformIO to build and upload the default Bluetooth firmware. Select the board's port with `--upload-port` if several devices are attached.

   ```sh
   cd Firmware
   pio run -e doit -t upload
   pio device monitor -b 115200
   ```

   Arduino IDE users can open [MotionTrack.ino](Firmware/MotionTrack/MotionTrack.ino) with the entire sketch directory. Board, partition and library versions are in [platformio.ini](Firmware/platformio.ini).

3. On a Mac, open `MotionTrack.xcodeproj` in Xcode. In the MotionTrack target's **Signing & Capabilities**, select your Apple development team. Use a unique bundle identifier if Xcode requests one. Select your iPhone as the destination and press **Run**. Allow Bluetooth access when prompted. Install this version if your phone has an earlier, read-only build.
4. Power the tracker and hold it still for about two seconds during calibration. On the phone, open **My tracker → Scan for tracker → Motion Track**. On older firmware, select the name the tracker advertises. Select a movement, set a target of two reps for the first check and tap **Start workout**. Rest a finger on the pulse sensor or tap **Skip heart-rate check**. Compare the physical reps with the OLED and phone, then repeat the pulse check after reaching the target.
5. To try wireless operation, keep the ESP32 powered when you disconnect its USB cable. A phone disconnect during a workout leaves the set running on the board. Reconnect to read the current snapshot. Powering down the board clears its current session.

## Communication and verification

The default firmware runs locally without a Wi-Fi account or server. The phone selects the movement. The firmware applies the associated rep counter. The Demo tab generates simulated readings. The website workflow uses its own Wi-Fi firmware configuration and backend. See the [website firmware guide](../firmware/README.md) for credentials and deployment.

For Bluetooth diagnostics, compare the [packet definitions](Firmware/MotionTrack/WorkoutWire.h), [ESP32 Bluetooth service](Firmware/MotionTrack/Radio.cpp) and [iOS Bluetooth client](MotionTrack/Tracker.swift). The app subscribes to full 17-byte v3 status snapshots and writes commands with a response. A completed workout includes elapsed seconds, reps, movement, target and available before/after BPM. The device checks the expected workout phase on incoming commands.

On macOS with Xcode installed, run `bash tests/run.sh` from this directory. It runs the sensor/flow checks against the integrated headers, exercises the device control flow and decodes its output with the app's Swift parser. For hardware acceptance, try each movement, skip a heart-rate check, end a set early, and reconnect mid-set. Check rep accuracy with the sensors in their intended wearing position. The automated checks do not measure physical rep accuracy or test the radio link.


## Cloud sync & care plan (iPhone -> Backend)

- **Account sign-in:** Tap **Sign in** in MotionTrack, enter your MotionTrack server URL (for example `http://localhost:3000` on a local LAN or your deployed HTTPS domain) and your patient email/password (`POST /api/auth/login` with `portal: "patient"`). The 24-hour bearer token is saved in the iOS Keychain (`KeychainSessionStore`), never `UserDefaults`.
- **Care plan pre-fill:** After sign-in, MotionTrack fetches `GET /api/plan`, displays your doctor's prescribed reps, target heart-rate range, and notes, and pre-fills the **Target** stepper (`1–50` reps) for Biceps curl (`1`), Shoulder press (`3`), and Back row (`4`). Code `2` (Lateral raise) is unused and excluded.
- **Offline upload queue:** Finished or stopped sets receive a `client_id` UUID and save locally in Application Support (`upload-queue.json`). Online uploads go to `POST /api/app/sets` (`201` on creation, `200 duplicate:true` on retry); offline or failed attempts retry automatically with exponential backoff (5 s, 15 s, 45 s, 120 s, 300 s max). If the 24-hour session expires (`401`), queued sets remain safe on disk until you sign in again. Bluetooth workouts continue working even with no account and no internet connection.
- **Optional live preview:** While connected and signed in, active workout stage/rep updates stream throttled updates to `PUT /api/app/live` (`DELETE /api/app/live` on cancel/disconnect) so doctors can follow live progress and the website shows `"last update N s ago"` if updates pause.
