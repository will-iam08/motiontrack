import Foundation
import Security
import Combine

enum KeychainSessionStore {
    private static let service = "edu.ece198.group65.MotionLog"
    private static let account = "patient_session"

    static func load() -> AuthSession? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(AuthSession.self, from: data)
    }

    static func save(_ session: AuthSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        delete()
        let attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum CloudSyncError: LocalizedError {
    case invalidServerURL
    case badStatus(String)

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: return "Enter a valid server URL starting with http:// or https://."
        case .badStatus(let message): return message
        }
    }
}

@MainActor
final class CloudSync: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var carePlan: CarePlan?
    @Published private(set) var pendingCount = 0
    @Published private(set) var syncedCount = 0
    @Published private(set) var isSyncing = false
    @Published private(set) var sessionExpired = false
    @Published private(set) var lastError: String?

    @Published private(set) var pendingCameraSet: WorkoutSetPayload?
    @Published private(set) var lastCameraAfter: Int?
    @Published private(set) var cameraBefore: Int?
    private let draftKey = "motionlog.camera.finishedSet"
    private var cameraSetID: String?
    private let queue: UploadQueueEngine
    private let defaults: UserDefaults
    private let recorder = SetRecorder()
    private let urlSession: URLSession
    private var retryTask: Task<Void, Never>?
    private var lastLivePayload: LiveWorkoutPayload?
    private var lastLiveSentAt = Date.distantPast
    private var liveBlockedUntil = Date.distantPast

    init(urlSession: URLSession = .shared,
         queue: UploadQueueEngine = UploadQueueEngine(store: FileUploadQueueStore()),
         defaults: UserDefaults = .standard, loadedSession: AuthSession? = KeychainSessionStore.load()) {
        self.urlSession = urlSession
        self.queue = queue
        self.defaults = defaults
        let loaded = loadedSession
        if let loaded, !loaded.isExpired() {
            self.session = loaded
        } else if let loaded {
            self.session = loaded
            self.sessionExpired = true
        }
        self.pendingCount = queue.pendingCount()
        if let data = defaults.data(forKey: draftKey) {
            pendingCameraSet = try? JSONDecoder().decode(WorkoutSetPayload.self, from: data)
        }
        startRetryLoop()
        if session != nil && !sessionExpired {
            Task { [weak self] in
                await self?.refreshCarePlan()
                await self?.flushNow()
            }
        }
    }

    deinit {
        retryTask?.cancel()
    }

    var syncStatusMessage: String {
        UploadQueueEngine.statusMessage(
            isSignedIn: session != nil,
            isSessionExpired: sessionExpired,
            isSyncing: isSyncing,
            pendingCount: pendingCount,
            syncedCount: syncedCount,
            lastError: lastError
        )
    }

    var savedServerURL: String {
        session?.serverURL ?? ""
    }

    var savedEmail: String {
        session?.user.email ?? ""
    }

    func signIn(serverURL rawURL: String, email: String, password: String) async throws {
        guard let baseURL = AppServerURL.normalize(rawURL) else {
            throw CloudSyncError.invalidServerURL
        }
        let body = [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password,
            "portal": "patient",
        ]
        var request = URLRequest(url: baseURL.appendingPathComponent("api/auth/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CloudSyncError.badStatus("Unexpected response from server.")
        }
        guard (200...299).contains(http.statusCode) else {
            throw CloudSyncError.badStatus(Self.errorMessage(from: data) ?? "Sign-in failed (HTTP \(http.statusCode)).")
        }

        let login = try JSONDecoder().decode(LoginResponse.self, from: data)
        guard let expires = AppISO8601.parse(login.expiresAt) else {
            throw CloudSyncError.badStatus("Server returned an invalid session expiry.")
        }
        let newSession = AuthSession(
            serverURL: baseURL.absoluteString,
            token: login.token,
            expiresAt: expires,
            user: login.user
        )
        KeychainSessionStore.save(newSession)
        session = newSession
        sessionExpired = false
        lastError = nil

        await refreshCarePlan()
        await flushNow()
    }

    func signOut() async {
        if let active = session, !sessionExpired, let baseURL = URL(string: active.serverURL) {
            var request = URLRequest(url: baseURL.appendingPathComponent("api/auth/logout"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(active.token)", forHTTPHeaderField: "Authorization")
            request.timeoutInterval = 8
            _ = try? await urlSession.data(for: request)
        }
        KeychainSessionStore.delete()
        session = nil
        sessionExpired = false
        carePlan = nil
        lastError = nil
    }

    func markWorkoutStarted(cameraMode: Bool = false, before: Int? = nil) {
        recorder.markWorkoutStarted()
        cameraSetID = cameraMode ? recorder.active?.clientId : nil
        cameraBefore = before
        lastCameraAfter = nil
        lastLivePayload = nil
    }

    func markSkipTapped(stage: WorkoutStage) {
        if stage == .before, cameraSetID != nil, cameraBefore != nil { return }
        recorder.markSkipTapped(for: stage)
    }

    func resetTracking() {
        cameraSetID = nil
        cameraBefore = nil
        lastCameraAfter = nil
        recorder.reset()
        lastLivePayload = nil
    }

    func clearLivePreview() {
        guard lastLivePayload != nil else { return }
        lastLivePayload = nil
        guard let active = currentValidSession(),
              let baseURL = URL(string: active.serverURL) else { return }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/app/live"))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(active.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 8
        Task {
            _ = try? await urlSession.data(for: request)
        }
    }

    func handleReading(_ reading: Reading?) {
        guard var reading else { return }
        if cameraSetID != nil && cameraSetID == recorder.active?.clientId, let cameraBefore {
            reading.beforeBPM = cameraBefore
        }
        let (finished, live) = recorder.observe(reading: reading)
        if let live {
            Task { [weak self] in
                await self?.sendLiveIfNeeded(live)
            }
        }
        if let finished {
            lastLivePayload = nil
            if cameraSetID == finished.clientId {
                cameraSetID = nil
                if finished.afterBpm == nil {
                    if pendingCameraSet != nil { finishCameraSet(after: nil) }
                    defaults.set(try? JSONEncoder().encode(finished), forKey: draftKey)
                    pendingCameraSet = finished
                    return
                }
            }
            if queue.enqueue(finished) {
                pendingCount = queue.pendingCount()
            }
            Task { [weak self] in
                await self?.flushNow()
            }
        }
    }

    func finishCameraSet(after: Int?) {
        guard var set = pendingCameraSet else { return }
        set.afterBpm = after
        set.afterSkipped = after == nil
        queue.enqueue(set)
        lastCameraAfter = after
        pendingCount = queue.pendingCount()
        pendingCameraSet = nil
        defaults.removeObject(forKey: draftKey)
        Task { await flushNow() }
    }

    func refreshCarePlan() async {
        guard let active = currentValidSession(),
              let baseURL = URL(string: active.serverURL) else { return }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/plan"))
        request.setValue("Bearer \(active.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10
        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { return }
            if http.statusCode == 401 {
                markSessionExpired()
                return
            }
            if (200...299).contains(http.statusCode) {
                let envelope = try JSONDecoder().decode(PlanEnvelope.self, from: data)
                carePlan = envelope.plan
            }
        } catch {
            // Keep existing cached plan if offline.
        }
    }

    func flushNow() async {
        guard !isSyncing, queue.pendingCount() > 0 else {
            pendingCount = queue.pendingCount()
            return
        }
        guard let active = currentValidSession(),
              let baseURL = URL(string: active.serverURL) else { return }

        isSyncing = true
        defer {
            isSyncing = false
            pendingCount = queue.pendingCount()
        }

        let summary = await queue.flushReady { [weak self] payload in
            guard let self else { return .retryableError("Unavailable") }
            return await self.uploadSet(payload, baseURL: baseURL, token: active.token)
        }
        syncedCount += summary.uploadedCount
        if summary.unauthorized {
            markSessionExpired()
        } else if summary.uploadedCount > 0 {
            lastError = nil
        }
    }

    private func currentValidSession() -> AuthSession? {
        guard let session else { return nil }
        if session.isExpired() {
            markSessionExpired()
            return nil
        }
        return session
    }

    private func markSessionExpired() {
        sessionExpired = true
        lastError = nil
    }

    private func startRetryLoop() {
        retryTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                await self?.flushNow()
            }
        }
    }

    private func uploadSet(_ payload: WorkoutSetPayload, baseURL: URL, token: String) async -> UploadResult {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/app/sets"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15
        guard let body = try? JSONEncoder().encode(payload) else {
            return .rejected("Unable to encode workout payload.")
        }
        request.httpBody = body

        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .retryableError("Network unavailable")
            }
            if http.statusCode == 200 || http.statusCode == 201 {
                return .uploaded
            }
            if http.statusCode == 401 {
                return .unauthorized
            }
            if http.statusCode == 400 || http.statusCode == 409 {
                let message = Self.errorMessage(from: data) ?? "Server rejected workout."
                lastError = message
                return .rejected(message)
            }
            let message = Self.errorMessage(from: data) ?? "Server unavailable (HTTP \(http.statusCode))"
            lastError = message
            return .retryableError(message)
        } catch {
            let message = "Offline"
            lastError = message
            return .retryableError(message)
        }
    }

    private func sendLiveIfNeeded(_ payload: LiveWorkoutPayload) async {
        guard let active = currentValidSession(),
              let baseURL = URL(string: active.serverURL) else { return }
        let now = Date()
        guard now >= liveBlockedUntil else { return }

        let phaseOrRepChanged = lastLivePayload?.phase != payload.phase
            || lastLivePayload?.repetitions != payload.repetitions
            || lastLivePayload?.clientId != payload.clientId
        if !phaseOrRepChanged && now.timeIntervalSince(lastLiveSentAt) < 2.0 {
            return
        }
        lastLivePayload = payload
        lastLiveSentAt = now

        var request = URLRequest(url: baseURL.appendingPathComponent("api/app/live"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(active.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 8
        request.httpBody = try? JSONEncoder().encode(payload)

        do {
            let (_, response) = try await urlSession.data(for: request)
            if let http = response as? HTTPURLResponse {
                if http.statusCode == 401 {
                    markSessionExpired()
                } else if http.statusCode == 429 {
                    let retryAfter = TimeInterval(http.value(forHTTPHeaderField: "Retry-After") ?? "5") ?? 5
                    liveBlockedUntil = Date().addingTimeInterval(max(2, retryAfter))
                }
            }
        } catch {
            // Optional live view ignores transient network failures.
        }
    }

    private static func errorMessage(from data: Data) -> String? {
        struct ErrorEnvelope: Decodable {
            struct Inner: Decodable { var message: String }
            var error: Inner
        }
        return (try? JSONDecoder().decode(ErrorEnvelope.self, from: data))?.error.message
    }
}
