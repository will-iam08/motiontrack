# Motion Log wiring and setup guide

This guide covers the classic USB-C ESP32 DOIT DevKit V1 with 4 MB of flash, an MPU6050 motion sensor, a MAX30102 heart-rate sensor and a 128 × 64 SSD1306 OLED. In the default Bluetooth Low Energy (BLE) mode, the iPhone sends workout commands and the ESP32 returns sensor readings. Powering the board starts Bluetooth advertising. You can connect without a network account, a device token or a serial command.

## Wire the tracker

Disconnect power before wiring. Use the GPIO numbers printed on the board. Check that each breakout accepts 3.3 V at its power input before connecting it to the ESP32's 3V3 pin. Connect all module grounds to ESP32 GND.

| Component | SDA | SCL | Power, address or switch wiring |
| --- | --- | --- | --- |
| SSD1306 OLED | GPIO21 | GPIO22 | VCC to 3V3. The firmware checks addresses 0x3C and 0x3D. |
| MAX30102 | GPIO25 | GPIO26 | Connect its 3.3 V-compatible power input to 3V3. Address 0x57. |
| MPU6050 | GPIO32 | GPIO33 | VCC to 3V3. Keep AD0 low for address 0x68. |
| Optional push button | | | Connect GPIO27 to GND through the button. An internal pull-up holds the input high until pressed. |

A USB data cable between the ESP32 and Mac supplies power, uploads firmware and carries serial diagnostics at 115200 baud. Keep the ESP32 powered when using Bluetooth away from the Mac. The iPhone can control workouts without the physical button.

## Upload the ESP32 firmware

Uploading replaces the program on the board. Keep a copy of its source if you need it later.

- **PlatformIO.** Open the [Firmware directory](Firmware/), select the default `doit` environment, connect the board and choose **Upload**. From that directory, the equivalent command is `pio run -e doit -t upload`. If several ports appear, add `--upload-port` followed by the board's port. The [build configuration](Firmware/platformio.ini) pins the platform and main sensor library versions.
- **Arduino IDE.** Open [MotionTrack.ino](Firmware/MotionTrack/MotionTrack.ino) with the complete sketch folder. Select Espressif's Arduino ESP32 core **2.0.17**, board **DOIT ESP32 DEVKIT V1**, **4 MB** flash and the **Huge APP** partition scheme where available. Install SparkFun MAX3010x Pulse and Proximity Sensor Library **1.1.2**, Adafruit SSD1306 **2.5.17** with its GFX and BusIO dependencies, SoftWire **2.0.10** and AsyncDelay **1.1.2**. Select the USB serial port and click **Upload**. The BLE build does not require a secrets file.

## Install the iPhone app and run a workout

1. Open `MotionLog.xcodeproj` in Xcode. Connect your iPhone, select it as the run destination, choose your development team under **Signing & Capabilities**, and press **Command-R**. If the bundle identifier is already taken, use a unique identifier. This build adds phone control for anyone using an earlier read-only version.
2. Power the ESP32 and hold the MPU6050 still for about two seconds. In the app, select **My tracker → Scan for tracker → Motion Log**. Allow Bluetooth access if prompted.
3. Choose **Biceps curl**, **Shoulder press** or **Back row**, set a target of 1–99 reps and tap **Start workout**. The board uses the counter for the exercise you select. Mount the motion sensor on the forearm for curls, or on the upper arm for shoulder presses and back rows.
4. Rest a fingertip steadily on the MAX30102. A valid reading moves the device into rep counting. You can also tap **Skip heart-rate check**. Reaching the rep target starts the second heart-rate check, which you can take or skip. The app displays available before- and after-workout readings separately in beats per minute. Elapsed time includes both checks.
5. Tap **End workout** to finish early. If the phone disconnects, the board continues the workout. Scan and reconnect to retrieve its current state. The optional button can also start or end a workout. Its initial setting is 10 biceps curls. Later presses reuse the most recently started exercise and target. Powering down the board clears the current session.

For pulse checks with the phone, enable **Use iPhone camera for pulse** in **My tracker**. On the iPhone 17 Pro Max, lightly cover the selfie lens at the top of the screen. You can practice with **Check pulse with iPhone camera** while the tracker is disconnected. See the [camera measurement instructions](README.md#iphone-camera-pulse).

If the app displays **Hardware setup required**, read the OLED or open the 115200-baud serial monitor for details. Correct the wiring; the board restarts itself after 5 seconds. If calibration fails because the sensor moved, set it down flat and it tries again on its own. You can skip the heart-rate check when the pulse sensor is offline. **My tracker** displays device data. **Demo** displays simulated readings.

## Bluetooth interface and website mode

| Bluetooth item | UUID | Operation |
| --- | --- | --- |
| Workout service | `45583198-0001-4BAD-9000-000000000065` | Discover the tracker |
| Workout state | `45583198-0002-4BAD-9000-000000000065` | Read or subscribe to notifications |
| Workout control | `45583198-0003-4BAD-9000-000000000065` | Write with response |

Each notification contains a complete 17-byte version 3 snapshot with the workout stage, count, elapsed time, exercise, target, hardware status and available before/after heart rates. A command contains its version, operation (1 to start, 2 to stop, 3 to skip the current heart-rate check), exercise, target and expected stage. The stage check prevents delayed commands from advancing the wrong phase. The phone updates its workout view from the state the board reports. See the [firmware packet definitions](Firmware/MotionTrack/WorkoutWire.h) and [iOS Bluetooth client](MotionLog/Tracker.swift).

The optional `website` build runs the original website-controlled Wi-Fi/HTTP workflow. Copy [secrets.example.h](Firmware/MotionTrack/secrets.example.h) to `secrets.h` in the same directory and fill in your server address and credentials locally. Each firmware build uses one control mode. BLE workouts stay local to the tracker and phone. The integrated firmware draws on the [original sensor and website implementation](https://github.com/will-iam08/motiontrack-esp32/tree/cd07592a45e699d91b4bc5cfe206dcfe0179d262).

## Verify the setup

The BLE and website firmware configurations have been compiled for the DOIT board, and the app has been built for an iPhone target. The 27 host tests cover sensor and workout logic. Additional checks exercise repeated start commands, stale commands, skipping, stopping, final readings and decoding snapshots for all three exercises in Swift. On a Mac with Xcode, run `bash tests/run.sh` from the `mobile` directory.

For an on-device check, set a two-rep target for each exercise and compare a manual count with the OLED and the iPhone. Check both heart-rate readings, end a set early, and disconnect and reconnect mid-set. Physical wiring, power, the Bluetooth link and rep accuracy while worn still need verification on the assembled tracker. Use those trials to adjust sensor placement and counting thresholds.
