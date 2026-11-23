import Foundation

@main struct PulseAttemptCheck {
    static func main() {
        var attempt = PulseAttempt()
        var signal = PulseSignal()
        precondition(attempt.summary == nil && attempt.csv(front: true) == nil)
        var timer = PulseAttempt()
        precondition(!timer.extendForContact(cameraElapsed: 5, contactElapsed: 2))
        precondition(!timer.extendForContact(cameraElapsed: 35, contactElapsed: 0.5))
        precondition(timer.extendForContact(cameraElapsed: 37, contactElapsed: 2))
        precondition(timer.timeout >= 35 + PulseSignal.duration)
        precondition(!timer.extendForContact(cameraElapsed: 38, contactElapsed: 3))
        precondition(timer.extendForContact(cameraElapsed: 69, contactElapsed: 2))
        precondition(timer.timeout == PulseAttempt.maximumTimeout)
        // The finger is stationary for 28 seconds with no pulse variation, then
        // lifts immediately before timeout. The result must retain the earlier evidence.
        for index in 0...900 {
            let time = Double(index) / 30
            let contact = time <= 28
            let red = contact ? 119.0 : 97.0
            signal.add(time: time, red: red, green: 105, blue: 98, screenLit: true, evenCoverage: contact)
            attempt.record(time: time, red: red, green: 105, blue: 98, even: contact, signal: signal)
        }
        precondition(attempt.summary == "Longest contact: 28 s · Camera: 30 fps")
        precondition(attempt.timeoutMessage.contains("too small"))
        let rows = attempt.csv(front: true)!.split(separator: "\n")
        precondition(rows.count == 902)
        precondition(rows[1].contains(",front,1,1,119.0,105.0,98.0,"))
        precondition(rows.last!.contains(",front,0,0,,,,"))
        print("Timeout preserves the longest contact, the failure reason, and an export without uncovered colors.")
    }
}
