import Foundation

@main struct CameraWorkoutCheck {
    @MainActor static func main() {
        let name = "MotionTrackTest-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let queue = UploadQueueEngine()
        let model = CloudSync(queue: queue, defaults: defaults, loadedSession: nil)

        for before in [72, nil] as [Int?] {
            model.markWorkoutStarted(cameraMode: true, before: before)
            var reading = Reading()
            reading.stage = .idle
            model.handleReading(reading)
            reading.stage = .counting
            reading.movement = .backRow
            reading.target = 2
            model.handleReading(reading)
            reading.stage = .complete
            reading.seconds = 9
            reading.reps = 2
            model.handleReading(reading)
            guard let draft = model.pendingCameraSet else { fatalError("Missing camera draft") }
            precondition(draft.repetitions == 2 && draft.beforeBpm == before)
            precondition(draft.beforeSkipped == (before == nil))
            let reopened = CloudSync(queue: queue, defaults: defaults, loadedSession: nil)
            precondition(reopened.pendingCameraSet == draft)
            reopened.finishCameraSet(after: before == nil ? nil : 96)
            let saved = queue.items.last!.payload
            precondition(saved.clientId == draft.clientId)
            precondition(saved.afterBpm == (before == nil ? nil : 96))
            precondition(saved.afterSkipped == (before == nil))
            model.finishCameraSet(after: nil) // Duplicate client ID never enqueues a second copy.
        }
        precondition(queue.pendingCount() == 2)
        print("Camera workout, offline queue and relaunch checks passed.")
    }
}
