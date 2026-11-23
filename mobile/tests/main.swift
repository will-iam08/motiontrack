import Foundation

let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let expected: [Movement] = [.curl, .shoulderPress, .backRow]
for (index, movement) in expected.enumerated() {
    let offset = index * 17
    let packet = data.subdata(in: offset..<offset+17)
    let value = Reading(packet: packet)!
    precondition(value.stage == .complete && value.movement == movement)
    precondition(value.target == 2 && value.reps == 2 && value.seconds == 7)
    precondition(value.beforeBPM == 76 && value.afterBPM == 98)
    precondition(Reading(packet: packet.dropLast()) == nil)
}
print("All three device workout snapshots decoded by iOS.")

// 1. Exercise mapping accepts only wire codes 1, 3, 4 (code 2 is unused and rejected).
precondition(AppExercise(wireCode: 1) == .armCurl)
precondition(AppExercise(wireCode: 3) == .shoulderPress)
precondition(AppExercise(wireCode: 4) == .backRow)
precondition(AppExercise(wireCode: 2) == nil)
precondition(AppExercise(wireCode: 0) == nil)
precondition(AppExercise(wireCode: 5) == nil)
precondition(AppExercise(movement: .lateralRaise) == nil)
precondition(AppExercise(apiID: "lateral_raise") == nil)
precondition(AppExercise(apiID: "arm_curl") == .armCurl)
precondition(AppExercise(apiID: "shoulder_press") == .shoulderPress)
precondition(AppExercise(apiID: "back_row") == .backRow)

// 2. Payload encoding keeps explicit null for nil/zero BPM and enforces 1...50 target clamp.
let skippedPayload = WorkoutSetPayload(
    clientId: "A1B2C3D4-E5F6-4789-ABCD-0123456789EF",
    exercise: .armCurl,
    targetReps: 99,
    repetitions: 60,
    elapsedSeconds: 45,
    beforeBpm: 0,
    afterBpm: nil,
    beforeSkipped: true,
    afterSkipped: false,
    startedAt: "2026-11-18T12:00:00.000Z",
    endedAt: "2026-11-18T12:00:45.000Z"
)
precondition(skippedPayload.targetReps == 50)
precondition(skippedPayload.repetitions == 50)
precondition(skippedPayload.beforeBpm == nil)
precondition(skippedPayload.afterBpm == nil)
let encoded = try JSONEncoder().encode(skippedPayload)
let decodedJSON = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
precondition(decodedJSON["client_id"] as? String == "a1b2c3d4-e5f6-4789-abcd-0123456789ef")
precondition(decodedJSON["exercise"] as? Int == 1)
precondition(decodedJSON["before_bpm"] is NSNull)
precondition(decodedJSON["after_bpm"] is NSNull)
precondition(decodedJSON["before_skipped"] as? Bool == true)
precondition(decodedJSON["after_skipped"] as? Bool == false)

// 3. Server URL normalization & Care Plan target lookup.
precondition(AppServerURL.normalize("https://motiontrack.onrender.com/")?.absoluteString == "https://motiontrack.onrender.com")
precondition(AppServerURL.normalize("ftp://example.com") == nil)
let plan = CarePlan(
    armCurlReps: 14,
    shoulderPressReps: 12,
    backRowReps: 16,
    targetBpmMin: 80,
    targetBpmMax: 130,
    notes: "Steady pace",
    doctorName: "Dr. Chen",
    updatedAt: "2026-11-18T12:00:00.000Z"
)
precondition(plan.prescribedReps(for: .armCurl) == 14)
precondition(plan.prescribedReps(for: .shoulderPress) == 12)
precondition(plan.prescribedReps(for: .backRow) == 16)

// 4. SetRecorder: cold-connect terminal state is ignored; active->complete records once; skips & stops work.
let recorder = SetRecorder()
var restingComplete = Reading()
restingComplete.stage = .complete
restingComplete.movement = .curl
restingComplete.target = 10
restingComplete.reps = 10
restingComplete.beforeBPM = 75
restingComplete.afterBPM = 102
precondition(recorder.observe(reading: restingComplete).finished == nil)

recorder.markWorkoutStarted(at: Date(timeIntervalSince1970: 1000))
precondition(recorder.observe(reading: restingComplete).finished == nil)
var step1 = Reading()
step1.stage = .before
step1.movement = .shoulderPress
step1.target = 12
step1.seconds = 2
let live1 = recorder.observe(reading: step1, now: Date(timeIntervalSince1970: 1002)).live!
precondition(live1.phase == "before_bpm" && live1.exercise == 3)

recorder.markSkipTapped(for: .before)
var step2 = Reading()
step2.stage = .counting
step2.movement = .shoulderPress
step2.target = 12
step2.reps = 6
step2.seconds = 14
let live2 = recorder.observe(reading: step2, now: Date(timeIntervalSince1970: 1014)).live!
precondition(live2.beforeSkipped && live2.beforeBpm == nil && live2.repetitions == 6)

var stopped = Reading()
stopped.stage = .stopped
stopped.movement = .shoulderPress
stopped.target = 12
stopped.reps = 6
stopped.seconds = 16
let finishedStop = recorder.observe(reading: stopped, now: Date(timeIntervalSince1970: 1016)).finished!
precondition(finishedStop.repetitions == 6)
precondition(finishedStop.beforeSkipped == true && finishedStop.afterSkipped == false)
precondition(finishedStop.beforeBpm == nil && finishedStop.afterBpm == nil)
precondition(recorder.observe(reading: stopped, now: Date(timeIntervalSince1970: 1017)).finished == nil)

// 5. UploadQueueEngine: file persistence, deduplication, backoff retries, 401 session pause, and upload cleanup.
let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("motionlog-queue-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: tempDir) }
let queueFile = tempDir.appendingPathComponent("queue.json")

let engine = UploadQueueEngine(store: FileUploadQueueStore(fileURL: queueFile))
precondition(engine.enqueue(finishedStop, at: Date(timeIntervalSince1970: 2000)) == true)
precondition(engine.enqueue(finishedStop, at: Date(timeIntervalSince1970: 2001)) == false)
precondition(engine.pendingCount() == 1)

// Reload from disk verifies offline durability.
let reloaded = UploadQueueEngine(store: FileUploadQueueStore(fileURL: queueFile))
precondition(reloaded.pendingCount() == 1)

let semaphore = DispatchSemaphore(value: 0)
Task {
    let failSummary = await reloaded.flushReady(now: Date(timeIntervalSince1970: 2002)) { _ in
        .retryableError("Offline")
    }
    precondition(failSummary.deferred && reloaded.pendingCount() == 1)
    precondition(reloaded.items[0].attempts == 1)
    precondition(UploadQueueEngine.retryDelay(forAttempt: 1) == 5)
    precondition(UploadQueueEngine.retryDelay(forAttempt: 5) == 300)

    // Before backoff expires (2004 < 2007), item stays deferred without calling send.
    let early = await reloaded.flushReady(now: Date(timeIntervalSince1970: 2004)) { _ in
        fatalError("Should not retry before backoff expires")
    }
    precondition(early.deferred)

    // After backoff expires, 401 pauses flush without dropping queued sets.
    let unauth = await reloaded.flushReady(now: Date(timeIntervalSince1970: 2010)) { _ in
        .unauthorized
    }
    precondition(unauth.unauthorized && reloaded.pendingCount() == 1)

    // Once re-authenticated, item uploads and is cleared from disk.
    let ok = await reloaded.flushReady(now: Date(timeIntervalSince1970: 2015)) { _ in
        .uploaded
    }
    precondition(ok.uploadedCount == 1 && reloaded.pendingCount() == 0)
    semaphore.signal()
}
semaphore.wait()

let diskCheck = UploadQueueEngine(store: FileUploadQueueStore(fileURL: queueFile))
precondition(diskCheck.pendingCount() == 0)
print("All Motion Log sync, mapping, queue and recorder tests passed.")

// Synthetic optical samples check estimator behavior, not clinical accuracy.
func pulseTrace(_ bpm: Double?, _ hz: Double, _ offset: Double = 0) -> PulseSignal {
    var signal = PulseSignal()
    for i in 0...Int(25 * hz) {
        let t = Double(i) / hz
        let value = bpm.map { 2 * sin(2 * .pi * $0 * t / 60 + offset) } ?? 0
        signal.add(time: t, red: 210, green: 75 + value, blue: 45)
        if t < 25 { precondition(signal.estimate == nil) }
    }
    return signal
}
for hz in [24.0, 30.0, 60.0] {
    for bpm in [54.0, 72.0, 115.0, 150.0] {
        let value = pulseTrace(bpm, hz).estimate
        precondition(value.map { abs(Double($0) - bpm) <= 5 } == true, "Unexpected estimate for \(bpm) at \(hz) Hz: \(String(describing: value))")
    }
}
precondition(pulseTrace(nil, 30).estimate == nil)
var interrupted = pulseTrace(72, 30)
interrupted.add(time: 26, red: 90, green: 90, blue: 90)
precondition(!interrupted.covered && interrupted.estimate == nil && interrupted.elapsed == 0)
var uneven = PulseSignal()
var phase = 0.0
for i in 0...750 {
    let t = Double(i) / 30
    phase += 2 * .pi * (i / 35 % 2 == 0 ? 0.8 : 2.5) / 30
    uneven.add(time: t, red: 200, green: 75 + 3 * sin(phase), blue: 42)
}
precondition(uneven.estimate == nil)
print("Camera pulse signal checks passed.")

// A weak green channel must not hide a clear pulse in unsaturated red.
// A window that was unusable at the old 25s deadline may still recover.
var latePulse = PulseSignal()
for i in 0...1200 {
    let t = Double(i) / 30
    let red = 170 + (t > 25 ? 2 * sin(2 * .pi * 1.2 * t) : 0)
    latePulse.add(time: t, red: red, green: 50, blue: 35)
    if t <= 25 { precondition(latePulse.estimate == nil) }
}
precondition(latePulse.estimate == 72)
var conflicting = PulseSignal()
for i in 0...900 {
    let t = Double(i) / 30
    conflicting.add(time: t, red: 185 + 2 * sin(2 * .pi * 1.2 * t),
                    green: 60 + 2 * sin(2 * .pi * 1.8 * t), blue: 25)
    precondition(conflicting.estimate == nil)
}
conflicting.add(time: 31, red: 12, green: 4, blue: 3)
precondition(!conflicting.covered && conflicting.quality.contains("Too dark"))
print("Extended measurement, red channel recovery and conflicting-channel rejection passed.")

// A screen-lit fingertip can be only slightly warmer than neutral. Exercise the
// actual front-camera path, including exposure changes and occasional patchy frames.
var frontPulse = PulseSignal()
var flicker = PulseSignal()
var uncovered = PulseSignal()
var noPulse = PulseSignal()
for i in 0...840 {
    let t = Double(i) / 30
    let beat = sin(2 * .pi * 1.4 * t)
    let strength = 0.9 + 0.35 * sin(2 * .pi * 0.09 * t)
    frontPulse.add(time: t, red: 119 + beat * strength * 0.55,
                   green: 105 + beat * strength, blue: 98,
                   screenLit: true, evenCoverage: i % 111 != 60)
    if t < PulseSignal.duration { precondition(frontPulse.estimate == nil) }
    let light = 1 + 0.015 * beat
    flicker.add(time: t, red: 119 * light, green: 105 * light, blue: 98 * light,
                screenLit: true, evenCoverage: true)
    uncovered.add(time: t, red: 119, green: 105 + beat, blue: 98,
                  screenLit: true, evenCoverage: false)
    noPulse.add(time: t, red: 119, green: 105, blue: 98,
                screenLit: true, evenCoverage: true)
    precondition(flicker.estimate == nil && uncovered.estimate == nil && noPulse.estimate == nil)
}
precondition(frontPulse.estimate.map { abs($0 - 84) <= 2 } == true)
for i in 841...850 {
    frontPulse.add(time: Double(i) / 30, red: 119, green: 105, blue: 98,
                   screenLit: true, evenCoverage: false)
    precondition(frontPulse.estimate == nil)
}
precondition(!frontPulse.covered && frontPulse.elapsed == 0)
frontPulse.add(time: 29, red: 119, green: 105, blue: 98, screenLit: true, evenCoverage: true)
precondition(frontPulse.covered && frontPulse.elapsed == 0 && frontPulse.estimate == nil)
print("Front camera checks passed for a weak pulse, missing contact, flat signal and brightness flicker.")

// Reproduce a covered front lens whose beat is weaker than the frame-to-frame noise.
// A repeatable noise sequence keeps the same waveform across runs and build machines.
struct OpticalTestNoise {
    var state: UInt64 = 47
    mutating func next() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return 2 * Double(state >> 32) / Double(UInt32.max) - 1
    }
}

func firstFrontEstimate(_ colors: (Double) -> (red: Double, green: Double, blue: Double)) -> Int? {
    var signal = PulseSignal()
    for i in 0...1050 {
        let t = Double(i) / 30 + 0.002 * sin(Double(i))
        let color = colors(t)
        signal.add(time: t, red: color.red, green: color.green, blue: color.blue,
                   screenLit: true, evenCoverage: true)
        if let estimate = signal.estimate {
            precondition(t >= PulseSignal.duration)
            return estimate
        }
    }
    return nil
}

var sensorNoise = OpticalTestNoise()
let weakNoisyRate = firstFrontEstimate { t in
    let beat = 0.4 * sin(2 * .pi * 78 / 60 * t)
    return (118 + 0.55 * beat + sensorNoise.next(),
            102 + beat + sensorNoise.next(),
            92 + 0.25 * sensorNoise.next())
}
precondition(weakNoisyRate.map { abs($0 - 78) <= 3 } == true,
             "Noisy front camera trace, expected 78 BPM, got \(String(describing: weakNoisyRate))")

var wanderingNoise = OpticalTestNoise()
var drift = 0.0
let noiseOnly = firstFrontEstimate { _ in
    drift = 0.88 * drift + wanderingNoise.next()
    return (118 + drift, 102 + 0.8 * drift + wanderingNoise.next(), 92 + wanderingNoise.next())
}
precondition(noiseOnly == nil, "Reported a pulse from coloured noise")

let incompatibleRates = firstFrontEstimate { t in
    (118 + sin(2 * .pi * 1.2 * t), 102 + sin(2 * .pi * 1.8 * t), 92)
}
precondition(incompatibleRates == nil, "Accepted unrelated red and green rhythms")

let rapidOpticalFlicker = firstFrontEstimate { t in
    // At 12 samples/s, 10.6 Hz could be mistaken for a 1.4 Hz pulse.
    let flicker = sin(2 * .pi * 10.6 * t)
    return (119 + 1.3 * flicker, 105 + 2 * flicker, 98)
}
precondition(rapidOpticalFlicker == nil, "High-frequency flicker aliased to a heart rate")
print("Noisy front-camera recovery and interference checks passed.")

var reacquired = PulseSignal()
reacquired.add(time: 0, red: 120, green: 105, blue: 98, screenLit: true, evenCoverage: true)
reacquired.add(time: 0.03, red: 120, green: 105, blue: 98, screenLit: true, evenCoverage: false)
precondition(!reacquired.covered && reacquired.issue == .seekingContact)
reacquired.add(time: 0.06, red: 120, green: 105, blue: 98, screenLit: true, evenCoverage: true)
precondition(reacquired.covered && reacquired.elapsed == 0.06 && reacquired.issue == .collecting)
precondition(reacquired.quality.contains("Finger detected") && reacquired.estimate == nil)

// Recover a pulse despite slow, channel-dependent exposure drift. Also test a
// common light source with the same drift and no pulse.
for bpm in [66.0, 108.0] {
    var noise = OpticalTestNoise()
    let rate = firstFrontEstimate { t in
        let baseline = 4 * sin(2 * .pi * 0.16 * t)
        let beat = 0.50 * sin(2 * .pi * bpm / 60 * t)
        let r = 124 + 0.7 * baseline + 0.55 * beat + 0.65 * noise.next()
        let g = 103 - baseline + beat + 0.65 * noise.next()
        let b = 94 + 0.3 * baseline + 0.2 * noise.next()
        return (r, g, b)
    }
    precondition(rate.map { abs(Double($0) - bpm) <= 3 } == true)
}
let driftingLight = firstFrontEstimate { t in
    let common = 1 + 0.015 * sin(2 * .pi * 1.4 * t)
    let baseline = sin(2 * .pi * 0.14 * t)
    return ((120 + baseline) * common, (103 - 0.65 * baseline) * common, (92 + 0.3 * baseline) * common)
}
precondition(driftingLight == nil, "Shared lighting with a drifting baseline looked like a pulse")
print("Front-camera reacquisition, pulse recovery with slow drift, and shared-light rejection passed.")
