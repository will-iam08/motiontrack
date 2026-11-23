import Foundation

/// A single camera attempt. The samples live in memory until the measurement closes.
struct PulseAttempt {
    static let initialTimeout = 55.0
    static let maximumTimeout = 80.0
    private(set) var timeout = initialTimeout
    private struct Row {
        var seconds: Double
        var red: Double?
        var green: Double?
        var blue: Double?
        var even: Bool
        var issue: PulseSignalIssue
    }

    private var rows: [Row] = []
    private var start: Double?
    private var secondsByIssue: [PulseSignalIssue: Double] = [:]
    private(set) var longestContact = 0.0

    /// A new placement can begin late even after a previous placement qualified for analysis.
    mutating func extendForContact(cameraElapsed: Double, contactElapsed: Double) -> Bool {
        guard contactElapsed >= 2, contactElapsed < PulseSignal.duration else { return false }
        let timeToConfirm = PulseSignal.duration - contactElapsed + 8
        let proposed = min(Self.maximumTimeout, cameraElapsed + timeToConfirm)
        guard proposed > timeout + 0.5 else { return false }
        timeout = proposed
        return true
    }

    mutating func record(time: Double, red: Double, green: Double, blue: Double, even: Bool,
                         signal: PulseSignal) {
        guard time.isFinite else { return }
        if start == nil { start = time }
        let seconds = time - (start ?? time)
        guard seconds >= 0, rows.last.map({ seconds > $0.seconds }) ?? true else { return }
        let dt = min(0.25, seconds - (rows.last?.seconds ?? seconds))
        let covered = signal.covered
        if covered {
            longestContact = max(longestContact, signal.elapsed)
            secondsByIssue[signal.issue, default: 0] += dt
        }
        rows.append(Row(seconds: seconds, red: covered ? red : nil, green: covered ? green : nil,
                        blue: covered ? blue : nil, even: even, issue: signal.issue))
    }

    var summary: String? {
        guard let last = rows.last, last.seconds > 0 else { return nil }
        let fps = Int((Double(rows.count - 1) / last.seconds).rounded())
        return "Longest contact: \(Int(longestContact)) s · Camera: \(fps) fps"
    }

    var timeoutMessage: String {
        guard !rows.isEmpty else { return "The camera delivered no frames. Close the measurement and reopen it." }
        if longestContact < 1 { return "The camera did not detect sustained fingertip contact. Use the preview to locate the lens." }
        let rejections: [PulseSignalIssue] = [.lowContrast, .changingLight, .conflictingRates, .unstableRhythm]
        let mainIssue = rejections.max { secondsByIssue[$0, default: 0] < secondsByIssue[$1, default: 0] }
        // Prefer measured evidence from several seconds over the reason on the last frame.
        if let mainIssue, secondsByIssue[mainIssue, default: 0] >= 2 {
            switch mainIssue {
            case .lowContrast: return "Fingertip detected, but the color changes were too small to measure. Try a lighter touch."
            case .changingLight: return "Overall brightness varied across the image. Shield the fingertip from changing room light."
            case .conflictingRates: return "The color channels gave different pulse rates. Support your hand and try again."
            case .unstableRhythm: return "The camera signal did not repeat consistently enough to calculate BPM."
            default: break
            }
        }
        if longestContact < PulseSignal.duration {
            return "The camera needed a longer uninterrupted sample. Start with your finger near the lens and use the preview to align it."
        }
        return "The camera detected your fingertip, but could not confirm one pulse rate during this attempt."
    }

    func csv(front: Bool) -> String? {
        guard !rows.isEmpty else { return nil }
        let camera = front ? "front" : "rear"
        var csv = "seconds,camera,contact,even_coverage,red,green,blue,signal_state\n"
        for row in rows {
            let colors = [row.red, row.green, row.blue].map { $0.map { String($0) } ?? "" }
            csv += "\(row.seconds),\(camera),\(row.red != nil ? 1 : 0),\(row.even ? 1 : 0),"
            csv += colors.joined(separator: ",") + "," + row.issue.rawValue + "\n"
        }
        return csv
    }
}
