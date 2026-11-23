import Foundation

enum AppExercise: UInt8, CaseIterable, Codable {
    case armCurl = 1
    case shoulderPress = 3
    case backRow = 4

    init?(wireCode: UInt8) {
        self.init(rawValue: wireCode)
    }

    init?(movement: Movement) {
        switch movement {
        case .curl: self = .armCurl
        case .shoulderPress: self = .shoulderPress
        case .backRow: self = .backRow
        default: return nil
        }
    }

    init?(apiID: String) {
        switch apiID {
        case "arm_curl": self = .armCurl
        case "shoulder_press": self = .shoulderPress
        case "back_row": self = .backRow
        default: return nil
        }
    }

    var apiID: String {
        switch self {
        case .armCurl: return "arm_curl"
        case .shoulderPress: return "shoulder_press"
        case .backRow: return "back_row"
        }
    }

    var title: String {
        switch self {
        case .armCurl: return "Biceps curl"
        case .shoulderPress: return "Shoulder press"
        case .backRow: return "Back row"
        }
    }
}

enum AppISO8601 {
    private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let basic: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func format(_ date: Date) -> String {
        withFraction.string(from: date)
    }

    static func parse(_ string: String) -> Date? {
        withFraction.date(from: string) ?? basic.date(from: string)
    }
}

enum AppServerURL {
    static func normalize(_ raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let stripped = trimmed.hasSuffix("/") ? String(trimmed.dropLast()) : trimmed
        guard let components = URLComponents(string: stripped),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else {
            return nil
        }
        return components.url
    }
}

struct WorkoutSetPayload: Codable, Equatable {
    var clientId: String
    var exercise: Int
    var targetReps: Int
    var repetitions: Int
    var elapsedSeconds: Int
    var beforeBpm: Int?
    var afterBpm: Int?
    var beforeSkipped: Bool
    var afterSkipped: Bool
    var startedAt: String
    var endedAt: String

    enum CodingKeys: String, CodingKey {
        case clientId = "client_id"
        case exercise
        case targetReps = "target_reps"
        case repetitions
        case elapsedSeconds = "elapsed_seconds"
        case beforeBpm = "before_bpm"
        case afterBpm = "after_bpm"
        case beforeSkipped = "before_skipped"
        case afterSkipped = "after_skipped"
        case startedAt = "started_at"
        case endedAt = "ended_at"
    }

    init(
        clientId: String,
        exercise: AppExercise,
        targetReps: Int,
        repetitions: Int,
        elapsedSeconds: Int,
        beforeBpm: Int?,
        afterBpm: Int?,
        beforeSkipped: Bool,
        afterSkipped: Bool,
        startedAt: String,
        endedAt: String
    ) {
        let clampedTarget = min(50, max(1, targetReps))
        let cleanBefore = (beforeSkipped || beforeBpm == 0) ? nil : beforeBpm.map { min(300, max(1, $0)) }
        let cleanAfter = (afterSkipped || afterBpm == 0) ? nil : afterBpm.map { min(300, max(1, $0)) }
        self.clientId = clientId.lowercased()
        self.exercise = Int(exercise.rawValue)
        self.targetReps = clampedTarget
        self.repetitions = min(clampedTarget, max(0, repetitions))
        self.elapsedSeconds = min(86400, max(0, elapsedSeconds))
        self.beforeBpm = cleanBefore
        self.afterBpm = cleanAfter
        self.beforeSkipped = beforeSkipped
        self.afterSkipped = afterSkipped
        self.startedAt = startedAt
        self.endedAt = endedAt
    }

    // Encode explicit null values for before_bpm / after_bpm because the backend checks own keys.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(clientId, forKey: .clientId)
        try container.encode(exercise, forKey: .exercise)
        try container.encode(targetReps, forKey: .targetReps)
        try container.encode(repetitions, forKey: .repetitions)
        try container.encode(elapsedSeconds, forKey: .elapsedSeconds)
        if let beforeBpm {
            try container.encode(beforeBpm, forKey: .beforeBpm)
        } else {
            try container.encodeNil(forKey: .beforeBpm)
        }
        if let afterBpm {
            try container.encode(afterBpm, forKey: .afterBpm)
        } else {
            try container.encodeNil(forKey: .afterBpm)
        }
        try container.encode(beforeSkipped, forKey: .beforeSkipped)
        try container.encode(afterSkipped, forKey: .afterSkipped)
        try container.encode(startedAt, forKey: .startedAt)
        try container.encode(endedAt, forKey: .endedAt)
    }
}

struct LiveWorkoutPayload: Codable, Equatable {
    var clientId: String
    var exercise: Int
    var targetReps: Int
    var repetitions: Int
    var elapsedSeconds: Int
    var phase: String
    var beforeBpm: Int?
    var beforeSkipped: Bool
    var deviceStatus: String?

    enum CodingKeys: String, CodingKey {
        case clientId = "client_id"
        case exercise
        case targetReps = "target_reps"
        case repetitions
        case elapsedSeconds = "elapsed_seconds"
        case phase
        case beforeBpm = "before_bpm"
        case beforeSkipped = "before_skipped"
        case deviceStatus = "device_status"
    }
}

struct CarePlan: Codable, Equatable {
    var armCurlReps: Int?
    var shoulderPressReps: Int?
    var backRowReps: Int?
    var targetBpmMin: Int?
    var targetBpmMax: Int?
    var notes: String
    var doctorName: String?
    var updatedAt: String

    enum CodingKeys: String, CodingKey {
        case armCurlReps = "arm_curl_reps"
        case shoulderPressReps = "shoulder_press_reps"
        case backRowReps = "back_row_reps"
        case targetBpmMin = "target_bpm_min"
        case targetBpmMax = "target_bpm_max"
        case notes
        case doctorName = "doctor_name"
        case updatedAt = "updated_at"
    }

    func prescribedReps(for exercise: AppExercise) -> Int? {
        let raw: Int?
        switch exercise {
        case .armCurl: raw = armCurlReps
        case .shoulderPress: raw = shoulderPressReps
        case .backRow: raw = backRowReps
        }
        guard let raw else { return nil }
        return min(50, max(1, raw))
    }
}

struct AuthUser: Codable, Equatable {
    var id: String
    var name: String
    var email: String
    var role: String
}

struct AuthSession: Codable, Equatable {
    var serverURL: String
    var token: String
    var expiresAt: Date
    var user: AuthUser

    func isExpired(at now: Date = Date()) -> Bool {
        now >= expiresAt
    }
}

struct LoginResponse: Decodable {
    var token: String
    var expiresAt: String
    var user: AuthUser

    enum CodingKeys: String, CodingKey {
        case token
        case expiresAt = "expires_at"
        case user
    }
}

struct PlanEnvelope: Decodable {
    var plan: CarePlan?
}

struct PendingUpload: Codable, Equatable, Identifiable {
    var id: String
    var payload: WorkoutSetPayload
    var attempts: Int
    var nextAttemptAt: Date
    var lastError: String?
    var createdAt: Date
}

protocol UploadQueueStore {
    func load() -> [PendingUpload]
    func save(_ items: [PendingUpload])
}

final class MemoryUploadQueueStore: UploadQueueStore {
    var items: [PendingUpload] = []
    func load() -> [PendingUpload] { items }
    func save(_ items: [PendingUpload]) { self.items = items }
}

final class FileUploadQueueStore: UploadQueueStore {
    private let fileURL: URL

    init(fileURL: URL = FileUploadQueueStore.defaultURL()) {
        self.fileURL = fileURL
    }

    static func defaultURL() -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("MotionLog", isDirectory: true)
            .appendingPathComponent("upload-queue.json")
    }

    func load() -> [PendingUpload] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([PendingUpload].self, from: data)) ?? []
    }

    func save(_ items: [PendingUpload]) {
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(items)
            #if os(iOS)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            #else
            try data.write(to: fileURL, options: [.atomic])
            #endif
        } catch {
            // Keep running cleanly if storage is constrained.
        }
    }
}

enum UploadResult: Equatable {
    case uploaded
    case unauthorized
    case retryableError(String)
    case rejected(String)
}

struct FlushSummary: Equatable {
    var uploadedCount = 0
    var droppedCount = 0
    var unauthorized = false
    var deferred = false
}

final class UploadQueueEngine {
    private let store: UploadQueueStore
    private(set) var items: [PendingUpload]

    init(store: UploadQueueStore = MemoryUploadQueueStore()) {
        self.store = store
        self.items = store.load()
    }

    static func retryDelay(forAttempt attempt: Int) -> TimeInterval {
        switch max(1, attempt) {
        case 1: return 5
        case 2: return 15
        case 3: return 45
        case 4: return 120
        default: return 300
        }
    }

    @discardableResult
    func enqueue(_ payload: WorkoutSetPayload, at now: Date = Date()) -> Bool {
        if items.contains(where: { $0.id == payload.clientId }) {
            return false
        }
        items.append(PendingUpload(
            id: payload.clientId,
            payload: payload,
            attempts: 0,
            nextAttemptAt: now,
            lastError: nil,
            createdAt: now
        ))
        store.save(items)
        return true
    }

    func pendingCount() -> Int {
        items.count
    }

    func clearAll() {
        items = []
        store.save(items)
    }

    func flushReady(
        now: Date = Date(),
        send: (WorkoutSetPayload) async -> UploadResult
    ) async -> FlushSummary {
        var summary = FlushSummary()
        var index = 0
        while index < items.count {
            let item = items[index]
            if item.nextAttemptAt > now {
                summary.deferred = true
                index += 1
                continue
            }
            let outcome = await send(item.payload)
            switch outcome {
            case .uploaded:
                items.remove(at: index)
                store.save(items)
                summary.uploadedCount += 1
            case .unauthorized:
                summary.unauthorized = true
                return summary
            case .retryableError(let message):
                let nextAttempts = item.attempts + 1
                items[index].attempts = nextAttempts
                items[index].nextAttemptAt = now.addingTimeInterval(Self.retryDelay(forAttempt: nextAttempts))
                items[index].lastError = message
                store.save(items)
                summary.deferred = true
                index += 1
            case .rejected:
                // Remove permanently invalid payloads so they do not stall subsequent sets.
                items.remove(at: index)
                store.save(items)
                summary.droppedCount += 1
            }
        }
        return summary
    }

    static func statusMessage(
        isSignedIn: Bool,
        isSessionExpired: Bool,
        isSyncing: Bool,
        pendingCount: Int,
        syncedCount: Int,
        lastError: String?
    ) -> String {
        if isSessionExpired {
            return pendingCount > 0
                ? "Session expired — sign in to upload (\(pendingCount))"
                : "Session expired — sign in again"
        }
        if !isSignedIn {
            return pendingCount > 0
                ? "Waiting to upload (\(pendingCount)) — sign in"
                : "Offline mode — workouts queue locally"
        }
        if isSyncing && pendingCount > 0 {
            return "Uploading (\(pendingCount))…"
        }
        if pendingCount > 0 {
            if let lastError, !lastError.isEmpty {
                return "Waiting to upload (\(pendingCount)) — retrying"
            }
            return "Waiting to upload (\(pendingCount))"
        }
        if syncedCount > 0 {
            return "Saved to your record"
        }
        return "Connected — ready to save workouts"
    }
}

final class SetRecorder {
    struct ActiveSet {
        var clientId: String
        var startedAt: Date
        var previousStage: WorkoutStage?
        var beforeSkipped = false
        var afterSkipped = false
    }

    private(set) var active: ActiveSet?
    private var waitingForActive = false
    private var terminalStageRecorded = false

    func reset() {
        active = nil
        waitingForActive = false
        terminalStageRecorded = false
    }

    func markWorkoutStarted(at now: Date = Date()) {
        waitingForActive = true
        terminalStageRecorded = false
        active = ActiveSet(
            clientId: UUID().uuidString.lowercased(),
            startedAt: now,
            previousStage: .before
        )
    }

    func markSkipTapped(for stage: WorkoutStage) {
        if stage == .before {
            active?.beforeSkipped = true
        } else if stage == .after {
            active?.afterSkipped = true
        }
    }

    func observe(reading: Reading, now: Date = Date()) -> (finished: WorkoutSetPayload?, live: LiveWorkoutPayload?) {
        guard let stage = reading.stage else { return (nil, nil) }

        // The old idle or finished packet can repeat until the ESP32 acknowledges Start.
        if waitingForActive {
            guard stage.active else { return (nil, nil) }
            waitingForActive = false
        }
        if stage == .idle || stage == .fault || stage == .starting {
            if stage == .idle {
                terminalStageRecorded = false
                active = nil
            }
            return (nil, nil)
        }

        if stage.active {
            terminalStageRecorded = false
            if active == nil {
                active = ActiveSet(
                    clientId: UUID().uuidString.lowercased(),
                    startedAt: now,
                    previousStage: stage
                )
            } else {
                if active?.previousStage == .before && (stage == .counting || stage == .after) && reading.beforeBPM == nil {
                    active?.beforeSkipped = true
                }
                active?.previousStage = stage
            }

            if let exercise = AppExercise(movement: reading.movement),
               let current = active,
               reading.target >= 1 && reading.target <= 50 {
                let phaseName: String
                let deviceStatus: String
                switch stage {
                case .before:
                    phaseName = "before_bpm"
                    deviceStatus = (reading.flags & 2) != 0 ? "weak_signal" : "reading"
                case .counting:
                    phaseName = "counting"
                    deviceStatus = "counting"
                case .after:
                    phaseName = "after_bpm"
                    deviceStatus = (reading.flags & 2) != 0 ? "weak_signal" : "reading"
                default:
                    phaseName = "counting"
                    deviceStatus = "counting"
                }
                let livePayload = LiveWorkoutPayload(
                    clientId: current.clientId,
                    exercise: Int(exercise.rawValue),
                    targetReps: reading.target,
                    repetitions: min(reading.target, max(0, reading.reps)),
                    elapsedSeconds: min(86400, max(0, reading.seconds)),
                    phase: phaseName,
                    beforeBpm: current.beforeSkipped ? nil : reading.beforeBPM,
                    beforeSkipped: current.beforeSkipped,
                    deviceStatus: deviceStatus
                )
                return (nil, livePayload)
            }
            return (nil, nil)
        }

        if stage == .complete || stage == .stopped {
            guard !terminalStageRecorded,
                  let current = active,
                  let exercise = AppExercise(movement: reading.movement),
                  reading.target >= 1 && reading.target <= 50 else {
                return (nil, nil)
            }
            terminalStageRecorded = true
            active = nil

            let endedAt = now
            let elapsed = min(86400, max(0, reading.seconds))
            let startedAt = current.startedAt

            let beforeBPM = (reading.beforeBPM ?? 0) > 0 ? reading.beforeBPM : nil
            let afterBPM = (reading.afterBPM ?? 0) > 0 ? reading.afterBPM : nil
            let beforeSkipped = current.beforeSkipped || (beforeBPM == nil && (reading.reps > 0 || stage == .complete))
            let afterSkipped = stage == .complete && afterBPM == nil

            let payload = WorkoutSetPayload(
                clientId: current.clientId,
                exercise: exercise,
                targetReps: reading.target,
                repetitions: reading.reps,
                elapsedSeconds: elapsed,
                beforeBpm: beforeSkipped ? nil : beforeBPM,
                afterBpm: afterSkipped ? nil : afterBPM,
                beforeSkipped: beforeSkipped,
                afterSkipped: afterSkipped,
                startedAt: AppISO8601.format(startedAt),
                endedAt: AppISO8601.format(max(startedAt, endedAt))
            )
            return (payload, nil)
        }

        return (nil, nil)
    }
}
