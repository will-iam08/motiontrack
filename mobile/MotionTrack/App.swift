import SwiftUI
import CoreBluetooth

@main struct MotionTrackApp: App {
    var body: some Scene { WindowGroup { Dashboard() } }
}

private let forest = Color(red: 0.07, green: 0.19, blue: 0.16)
private let lime = Color(red: 0.79, green: 0.96, blue: 0.57)

private extension Movement {
    var title: String {
        switch self {
        case .backRow: return "Back row"
        case .curl: return "Biceps curl"
        case .lateralRaise: return "Lateral raise"
        case .shoulderPress: return "Shoulder press"
        case .detecting: return "Detecting movement…"
        case .unrecognized: return "Movement unrecognized"
        case .unavailable: return "Movement unavailable"
        case .unmapped(let code): return "Unknown exercise (\(code))"
        }
    }
}

// Scripted telemetry for the Demo tab. All live values come from the peripheral.
private func demoReading(seconds: Int, phase: Reading.Phase) -> Reading {
    var value = Reading()
    value.phase = phase
    value.seconds = seconds
    value.reps = seconds / 3
    let movements: [Movement] = [.curl, .shoulderPress, .backRow]
    let offset = seconds % 12
    if offset < 2 {
        value.movement = .detecting
    } else if offset == 11 {
        value.movement = .unrecognized
    } else {
        value.movement = movements[(seconds / 12) % movements.count]
    }
    value.bpm = seconds < 2 ? nil : 80 + min(seconds / 2, 18)
    return value
}

private enum CameraCheck: String, Identifiable {
    case before, after, standalone
    var id: String { rawValue }
}

struct Dashboard: View {
    @StateObject private var tracker = Tracker()
    @StateObject private var cloudSync = CloudSync()
    @State private var demo = true
    @State private var exerciseCode: UInt8 = 1
    @State private var target = 10
    @State private var started: Date?
    @State private var finalDemo: Reading?
    @State private var showingAccount = false

    @State private var cameraCheck: CameraCheck?
    @AppStorage("motionlog.useCameraPulse") private var useCamera = true
    @State private var standaloneBPM: Int?
    @State private var measuringSetID: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    syncCard
                    if let pending = cloudSync.pendingCameraSet {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("After-workout pulse").font(.headline)
                            Text("\(pending.repetitions) of \(pending.targetReps) reps saved on this iPhone.")
                            if let ended = AppISO8601.parse(pending.endedAt), Date().timeIntervalSince(ended) < 180 {
                                Button("Measure after workout") { beginAfterCheck(pending) }
                            }
                            Button("Skip and sync set") { cloudSync.finishCameraSet(after: nil) }
                        }.padding()
                    }

                    Picker("Data source", selection: Binding(get: { demo }, set: selectSource)) {
                        Text("Demo").tag(true)
                        Text("My tracker").tag(false)
                    }.pickerStyle(.segmented)

                    if demo, let started {
                        TimelineView(.periodic(from: .now, by: 1)) { tick in
                            WorkoutPanel(reading: demoReading(seconds: elapsed(since: started, at: tick.date), phase: .active))
                        }
                    } else {
                        WorkoutPanel(reading: demo ? finalDemo ?? Reading() : displayReading)
                    }
                    if demo {
                        Text("Demo cycles through a biceps curl, shoulder press and back row using simulated readings.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        action(started == nil ? (finalDemo == nil ? "Start demo session" : "New demo session") : "Finish demo session",
                               icon: started == nil ? "play.fill" : "stop.fill") {
                            if let start = started {
                                finalDemo = demoReading(seconds: elapsed(since: start, at: .now), phase: .finished)
                                started = nil
                            } else {
                                finalDemo = nil
                                started = .now
                            }
                        }
                    } else {
                        if let plan = cloudSync.carePlan {
                            carePlanCard(plan)
                        }
                        connection
                        if !tracker.connected || tracker.reading?.stage?.canStart == true {
                            Button("Check pulse with iPhone camera") { cameraCheck = .standalone }
                            if let standaloneBPM { Text("Last camera estimate: \(standaloneBPM) BPM") }
                        }
                    }
                }.padding(.horizontal, 20).padding(.vertical, 12)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("MotionTrack")
            .sheet(isPresented: $showingAccount) {
                AccountSheet(cloudSync: cloudSync)
            }
            .fullScreenCover(item: $cameraCheck) { check in
                CameraPulseView(title: check == .before ? "Before workout" : check == .after ? "After workout" : "Camera pulse",
                                useTitle: check == .before ? "Use BPM and start" : check == .after ? "Save BPM and sync" : "Done",
                                accept: { resolveCamera(check, bpm: $0) },
                                skip: { resolveCamera(check, bpm: nil) },
                                skipTitle: check == .before ? "Skip pulse and start" : check == .after ? "Skip and sync set" : "Close")
            }
            .onChange(of: cloudSync.pendingCameraSet?.clientId) { id in
                if id != nil, cameraCheck == nil, !showingAccount, let draft = cloudSync.pendingCameraSet { beginAfterCheck(draft) }
            }
            .onReceive(tracker.$reading) { reading in
                if !demo {
                    cloudSync.handleReading(reading)
                }
            }
            .onReceive(cloudSync.$carePlan) { plan in
                applyPrescribedTarget(from: plan, for: exerciseCode)
            }
            .onChange(of: exerciseCode) { nextCode in
                applyPrescribedTarget(from: cloudSync.carePlan, for: nextCode)
            }
        }
    }

    private var displayReading: Reading? {
        guard var reading = tracker.reading else { return nil }
        if reading.stage != .idle {
            reading.beforeBPM = reading.beforeBPM ?? cloudSync.cameraBefore
            if reading.stage?.canStart == true { reading.afterBPM = reading.afterBPM ?? cloudSync.lastCameraAfter }
        }
        return reading
    }

    private func beginAfterCheck(_ draft: WorkoutSetPayload) {
        guard let ended = AppISO8601.parse(draft.endedAt), Date().timeIntervalSince(ended) < 180 else { return }
        measuringSetID = draft.clientId
        cameraCheck = .after
    }

    private func resolveCamera(_ check: CameraCheck, bpm: Int?) {
        cameraCheck = nil
        switch check {
        case .standalone: standaloneBPM = bpm
        case .after:
            guard let id = measuringSetID, cloudSync.pendingCameraSet?.clientId == id else { return }
            measuringSetID = nil
            cloudSync.finishCameraSet(after: bpm)
        case .before:
            guard !demo, tracker.connected, tracker.hasControls, tracker.reading?.stage?.canStart == true else { return }
            cloudSync.markWorkoutStarted(cameraMode: true, before: bpm)
            tracker.send(1, movement: exerciseCode, target: UInt8(target))
        }
    }

    private func applyPrescribedTarget(from plan: CarePlan?, for code: UInt8) {
        let canEdit = tracker.reading?.stage?.canStart ?? true
        guard canEdit,
              let exercise = AppExercise(wireCode: code),
              let prescribed = plan?.prescribedReps(for: exercise) else {
            return
        }
        target = prescribed
    }

    private func elapsed(since start: Date, at end: Date) -> Int {
        max(0, Int(end.timeIntervalSince(start)))
    }

    private func selectSource(_ usingDemo: Bool) {
        guard usingDemo != demo else { return }
        demo = usingDemo
        started = nil
        finalDemo = nil
        if usingDemo {
            cloudSync.clearLivePreview()
            cloudSync.resetTracking()
            tracker.disconnect()
        }
    }

    private var syncCard: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: cloudSync.session != nil && !cloudSync.sessionExpired ? "icloud.and.arrow.up" : "person.crop.circle")
                .font(.title3)
                .foregroundStyle(forest)
            VStack(alignment: .leading, spacing: 4) {
                Text(cloudSync.syncStatusMessage)
                    .font(.subheadline.weight(.semibold))
                if let user = cloudSync.session?.user {
                    Text(user.email)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if cloudSync.pendingCount > 0, cloudSync.session != nil, !cloudSync.sessionExpired, !cloudSync.isSyncing {
                Button("Retry") {
                    Task { await cloudSync.flushNow() }
                }
                .font(.subheadline.weight(.semibold))
            }
            Button(cloudSync.session == nil ? "Sign in" : (cloudSync.sessionExpired ? "Sign in again" : "Account")) {
                showingAccount = true
            }
            .buttonStyle(.bordered)
            .tint(forest)
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func carePlanCard(_ plan: CarePlan) -> some View {
        let goals = [
            plan.armCurlReps.map { "Biceps curl: \($0) reps" },
            plan.shoulderPressReps.map { "Shoulder press: \($0) reps" },
            plan.backRowReps.map { "Back row: \($0) reps" },
        ].compactMap { $0 }
        return Group {
            if !goals.isEmpty || plan.targetBpmMin != nil || plan.targetBpmMax != nil || !plan.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("From your doctor", systemImage: "list.clipboard")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(forest)
                    if let doctor = plan.doctorName {
                        Text("Prescribed by \(doctor)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !goals.isEmpty {
                        Text(goals.joined(separator: " · "))
                            .font(.subheadline)
                    }
                    if plan.targetBpmMin != nil || plan.targetBpmMax != nil {
                        let minText = plan.targetBpmMin.map(String.init) ?? "—"
                        let maxText = plan.targetBpmMax.map(String.init) ?? "—"
                        Text("Target heart rate after exercise: \(minText)–\(maxText) bpm")
                            .font(.subheadline)
                    }
                    if !plan.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(plan.notes)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private var connection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(tracker.status, systemImage: tracker.connected ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right")
                .font(.headline)
            ForEach(tracker.devices, id: \.identifier) { device in
                Button { tracker.connect(device) } label: {
                    HStack {
                        Text(device.name ?? "Tracker")
                        Spacer()
                        Text(String(device.identifier.uuidString.suffix(4))).monospaced()
                        Image(systemName: "chevron.right")
                    }.padding(.vertical, 8)
                }
            }
            if tracker.connected, let stage = tracker.reading?.stage, tracker.hasControls {
                VStack(alignment: .leading, spacing: 12) {
                    if stage.canStart {
                        Picker("Exercise", selection: $exerciseCode) {
                            Text("Biceps curl").tag(UInt8(1))
                            Text("Shoulder press").tag(UInt8(3))
                            Text("Back row").tag(UInt8(4))
                        }.pickerStyle(.menu)
                        Stepper("Target: \(target) reps", value: $target, in: 1...50)
                        Toggle("Use iPhone camera for pulse", isOn: $useCamera)
                        action("Start workout", icon: "play.fill") {
                            if useCamera { cameraCheck = .before }
                            else {
                                cloudSync.markWorkoutStarted()
                                tracker.send(1, movement: exerciseCode, target: UInt8(target))
                            }
                        }.disabled(cloudSync.pendingCameraSet != nil)
                    } else if stage.active {
                        if stage == .before || stage == .after {
                            Text(((tracker.reading?.flags ?? 0) & 2) != 0 ? "Pulse sensor offline. You can skip this reading." :
                                "Place a fingertip on the heart sensor and hold still.")
                            Button("Skip heart-rate check") {
                                cloudSync.markSkipTapped(stage: stage)
                                tracker.send(3)
                            }
                        }
                        action("End workout", icon: "stop.fill") { tracker.send(2) }
                    } else {
                        Text(stage == .fault ? "Check the OLED or USB serial message and fix the wiring. The tracker restarts on its own." :
                            "Keep the sensor still while the tracker calibrates.")
                    }
                }.disabled(tracker.sending)
            } else if tracker.connected && tracker.reading != nil {
                Text("Install the MotionTrack firmware to control workouts from this phone.")
            }
            if tracker.busy || tracker.connected {
                action(tracker.connected ? "Disconnect" : "Cancel", icon: "xmark") {
                    cloudSync.clearLivePreview()
                    cloudSync.resetTracking()
                    tracker.disconnect()
                }
            } else {
                action("Scan for tracker", icon: "magnifyingglass") { tracker.scan() }
            }
        }.padding(.top, 4)
    }

    private func action(_ label: String, icon: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Label(label, systemImage: icon).font(.headline).frame(maxWidth: .infinity)
                .padding(.vertical, 16).foregroundStyle(forest)
                .background(lime, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

private struct AccountSheet: View {
    @ObservedObject var cloudSync: CloudSync
    @Environment(\.dismiss) private var dismiss
    @State private var serverURL = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var errorMessage = ""

    var body: some View {
        NavigationStack {
            Form {
                if let session = cloudSync.session, !cloudSync.sessionExpired {
                    Section("Signed in") {
                        LabeledContent("Patient", value: session.user.name)
                        LabeledContent("Email", value: session.user.email)
                        LabeledContent("Server", value: session.serverURL)
                        LabeledContent("Queue", value: cloudSync.syncStatusMessage)
                    }
                    Section {
                        Button("Refresh care plan & sync") {
                            Task {
                                await cloudSync.refreshCarePlan()
                                await cloudSync.flushNow()
                            }
                        }
                        Button("Sign out", role: .destructive) {
                            Task {
                                await cloudSync.signOut()
                                dismiss()
                            }
                        }
                    }
                } else {
                    Section(cloudSync.sessionExpired ? "Session expired — sign in again" : "MotionTrack account") {
                        TextField("Server URL (e.g. https://motiontrack.onrender.com)", text: $serverURL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Patient email", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                    }
                    if !errorMessage.isEmpty {
                        Section {
                            Text(errorMessage).foregroundStyle(.red)
                        }
                    }
                    Section {
                        Button(busy ? "Signing in…" : "Sign in") {
                            submitSignIn()
                        }
                        .disabled(busy || serverURL.isEmpty || email.isEmpty || password.isEmpty)
                    } footer: {
                        Text("Your token is stored securely in the iOS Keychain for 24 hours. Workouts recorded over Bluetooth still save locally if you are offline or signed out.")
                    }
                    if cloudSync.session != nil {
                        Section {
                            Button("Clear expired account", role: .destructive) {
                                Task { await cloudSync.signOut() }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Account")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                if serverURL.isEmpty { serverURL = cloudSync.savedServerURL }
                if email.isEmpty { email = cloudSync.savedEmail }
            }
        }
    }

    private func submitSignIn() {
        busy = true
        errorMessage = ""
        Task {
            do {
                try await cloudSync.signIn(serverURL: serverURL, email: email, password: password)
                password = ""
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}

private struct WorkoutPanel: View {
    let reading: Reading?
    @Environment(\.dynamicTypeSize) private var textSize
    @ScaledMetric(relativeTo: .largeTitle) private var countSize = 66.0
    private var sessionLabel: String {
        if let stage = reading?.stage {
            switch stage {
            case .starting: return "Calibrating"
            case .idle: return "Ready to start"
            case .before: return "Before-workout pulse"
            case .counting: return "Counting · target \(reading?.target ?? 0)"
            case .after: return "After-workout pulse"
            case .complete: return "Target complete"
            case .stopped: return "Workout ended"
            case .fault: return "Hardware setup required"
            }
        }
        switch reading?.phase {
        case .active: return "Session in progress"
        case .finished: return "Session complete"
        case .ready: return "Ready to start"
        case nil: return "Awaiting tracker data"
        }
    }
    private var movement: String {
        guard let reading else { return "Waiting for device" }
        if reading.stage == .fault { return "Check tracker wiring" }
        if reading.stage == .starting { return "Keep the sensor still" }
        return reading.phase == .ready ? "Ready for movement" : reading.movement.title
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                Label(sessionLabel, systemImage: reading?.phase == .active ? "waveform" : "circle.dotted")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(lime)
                Text(movement).font(.system(.largeTitle, design: .rounded).weight(.bold))
                Rectangle().fill(Color.white.opacity(0.22)).frame(height: 1).padding(.vertical, 3)
                Text(reading.map { String($0.reps) } ?? "—")
                    .font(.system(size: countSize, weight: .semibold, design: .rounded)).monospacedDigit()
                Text("Session repetitions").font(.headline).foregroundStyle(.white.opacity(0.85))
            }
            .padding(22).frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(.white).background(forest, in: RoundedRectangle(cornerRadius: 24))

            if let r = reading, r.stage == .counting {
                if r.flags & 1 != 0 { Text("Motion sensor disconnected").foregroundStyle(.orange) }
                else if r.flags & 4 != 0 { Text("Almost there. Lift a little higher to count the rep.") }
            }
            let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
            layout {
                metric("Duration", icon: "timer", value: reading.map { String(format: "%02d:%02d", $0.seconds / 60, $0.seconds % 60) } ?? "—")
                if reading?.stage != nil {
                    metric("Before", icon: "heart", value: reading?.beforeBPM.map { "\($0) bpm" } ?? "—")
                } else {
                    metric("Heart rate", icon: "heart", value: reading?.bpm.map { "\($0) bpm" } ?? "—")
                }
            }
            if reading?.stage != nil {
                metric("After workout", icon: "heart", value: reading?.afterBPM.map { "\($0) bpm" } ?? "—")
            }
        }
    }

    private func metric(_ title: String, icon: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon).font(.subheadline).foregroundStyle(.secondary)
            Text(value).font(.system(.title2, design: .rounded).bold()).monospacedDigit()
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
    }
}
