import AVFoundation
import CoreImage
import SwiftUI
import Darwin
import UniformTypeIdentifiers

private struct PulseFrame {
    var wave: [Double] = []
    var seconds = 0.0
    var quality = "Starting camera…"
    var bpm: Int?
    var finished = false
    var contact = false
    var confirming = false
    var alignmentPreview: CGImage?
    var attemptSummary: String?
    var contrastDetail = ""
    var sampleCSV: String?
}

private struct SignalFile: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText] }
    let data: Data
    init(csv: String) { data = Data(csv.utf8) }
    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else { throw CocoaError(.fileReadCorruptFile) }
        self.data = data
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

private final class CameraReader: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    // Stop the previous session (including its torch) before opening the next camera.
    private static let queue = DispatchQueue(label: "MotionTrack.cameraPulse")
    private let position: AVCaptureDevice.Position
    private var camera: AVCaptureDevice?
    private var capture: AVCaptureSession?
    private var signal = PulseSignal()
    private var attempt = PulseAttempt()
    private var longestFrame: PulseFrame?
    private var cameraStarted = DispatchTime.now()
    private var running = false
    private var lastDisplay = -Double.infinity
    private let previewContext = CIContext(options: [.cacheIntermediates: false])
    private var previewTime = -Double.infinity
    private var previewImage: CGImage?
    private var contactSince: Double?
    private var lastContact = -Double.infinity
    private var opticsLocked = false
    private var timer: DispatchSourceTimer?
    private let publish: (PulseFrame) -> Void

    init(position: AVCaptureDevice.Position, publish: @escaping (PulseFrame) -> Void) {
        self.position = position
        self.publish = publish
    }

    func start() {
        Self.queue.async {
            self.running = true
            AVCaptureDevice.requestAccess(for: .video) { allowed in
                Self.queue.async {
                    guard self.running else { return }
                    guard allowed else { self.fail("Allow Camera in iPhone Settings to measure your pulse."); return }
                    self.configure()
                }
            }
        }
    }
    func stop() { Self.queue.async { self.shutdown() } }
    private func shutdown() {
        running = false
        timer?.cancel()
        timer = nil
        if let camera, (try? camera.lockForConfiguration()) != nil {
            if position == .back && camera.hasTorch { camera.torchMode = .off }
            Self.enableAutoMetering(camera)
            camera.unlockForConfiguration()
        }
        capture?.stopRunning()
        capture = nil
        camera = nil
        previewImage = nil
    }

    private func fail(_ message: String) {
        shutdown()
        publish(PulseFrame(quality: message, finished: true))
    }

    private func timeOut() {
        var final = longestFrame ?? PulseFrame()
        final.quality = attempt.timeoutMessage
        final.finished = true
        final.contact = false
        final.alignmentPreview = nil
        final.attemptSummary = attempt.summary
        final.sampleCSV = attempt.csv(front: position == .front)
        shutdown()
        publish(final)
    }

    private static func enableAutoMetering(_ device: AVCaptureDevice) {
        if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
        if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }
    }

    private func configure() {
        let wide = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
        let device = wide ?? (position == .front ? AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) : nil)
        guard let device else { fail("This camera is unavailable. Try the other camera."); return }
        let session = AVCaptureSession()
        let output = AVCaptureVideoDataOutput()
        do {
            let input = try AVCaptureDeviceInput(device: device)
            session.beginConfiguration()
            if session.canSetSessionPreset(.vga640x480) { session.sessionPreset = .vga640x480 }
            guard session.canAddInput(input) else { session.commitConfiguration(); fail("Camera unavailable. Try again."); return }
            session.addInput(input)
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: Self.queue)
            guard session.canAddOutput(output) else { session.commitConfiguration(); fail("Cannot read camera frames."); return }
            session.addOutput(output)
            session.commitConfiguration()
            capture = session
            camera = device
            session.startRunning()
            guard session.isRunning else { fail("Camera unavailable. Try again."); return }
            try device.lockForConfiguration()
            do {
                defer { device.unlockForConfiguration() }
                Self.enableAutoMetering(device)
                if device.activeFormat.videoSupportedFrameRateRanges.contains(where: {
                    $0.minFrameRate <= 30 && $0.maxFrameRate >= 30
                }) {
                    let frame = CMTime(value: 1, timescale: 30)
                    device.activeVideoMinFrameDuration = frame
                    device.activeVideoMaxFrameDuration = frame
                }
                if position == .back, device.isTorchAvailable { try device.setTorchModeOn(level: 0.2) }
            }
            let timeout = DispatchSource.makeTimerSource(queue: Self.queue)
            cameraStarted = .now()
            timeout.schedule(deadline: cameraStarted + PulseAttempt.initialTimeout)
            timeout.setEventHandler { [weak self] in
                guard let self, self.running else { return }
                self.timeOut()
            }
            timer = timeout
            timeout.resume()
        } catch { fail("Camera unavailable. Close other camera apps and retry.") }
    }

    // Auto-meter as the finger arrives. Once settled, prevent automatic exposure and
    // white balance from changing the very small color variations we are measuring.
    private func updateMetering(now: Double, usableLight: Bool) {
        guard let camera else { return }
        guard signal.covered, usableLight else {
            contactSince = nil
            if opticsLocked && now - lastContact >= 0.75, (try? camera.lockForConfiguration()) != nil {
                Self.enableAutoMetering(camera)
                camera.unlockForConfiguration()
                opticsLocked = false
                signal = PulseSignal()
            }
            return
        }
        lastContact = now
        if contactSince == nil { contactSince = now }
        guard !opticsLocked, let contactSince, now - contactSince >= 1.5,
              !camera.isAdjustingExposure, !camera.isAdjustingWhiteBalance,
              (try? camera.lockForConfiguration()) != nil else { return }
        defer { camera.unlockForConfiguration() }
        if camera.isExposureModeSupported(.locked) { camera.exposureMode = .locked }
        if camera.isWhiteBalanceModeSupported(.locked) { camera.whiteBalanceMode = .locked }
        opticsLocked = true
    }

    private struct Patch {
        var red = 0, green = 0, blue = 0, count = 0
        var total: Double { Double(red + green + blue) }
        var brightness: Double { total / Double(max(1, count)) }
        var redFraction: Double { Double(red) / max(total, 1) }
        var greenFraction: Double { Double(green) / max(total, 1) }
    }

    private func sampleColors(_ buffer: CVPixelBuffer) -> (red: Double, green: Double, blue: Double, even: Bool)? {
        guard CVPixelBufferLockBaseAddress(buffer, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let bytes = CVPixelBufferGetBaseAddress(buffer)?.assumingMemoryBound(to: UInt8.self) else { return nil }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let strideBytes = CVPixelBufferGetBytesPerRow(buffer)
        let x0 = w / 5, x1 = w - x0, y0 = h / 5, y1 = h - y0
        var tiles = Array(repeating: Patch(), count: 9)
        for y in stride(from: y0, to: y1, by: 4) {
            let row = 3 * ((y - y0) * 3 / (y1 - y0))
            for x in stride(from: x0, to: x1, by: 4) {
                let tile = row + (x - x0) * 3 / (x1 - x0)
                let i = y * strideBytes + x * 4
                tiles[tile].red += Int(bytes[i+2])
                tiles[tile].green += Int(bytes[i+1])
                tiles[tile].blue += Int(bytes[i])
                tiles[tile].count += 1
            }
        }
        var all = Patch()
        for tile in tiles {
            all.red += tile.red; all.green += tile.green; all.blue += tile.blue; all.count += tile.count
        }
        guard all.count > 0 else { return nil }
        // A covered lens can have shading. Reject strongly different colors or very dark
        // borders over several tiles, as when part of the front lens still sees the room.
        let matching = tiles.filter {
            $0.count > 0 && abs($0.redFraction - all.redFraction) < 0.10 &&
            abs($0.greenFraction - all.greenFraction) < 0.10 &&
            $0.brightness >= all.brightness * 0.45 && $0.brightness <= all.brightness * 1.75
        }.count
        let count = Double(all.count)
        return (Double(all.red)/count, Double(all.green)/count, Double(all.blue)/count, matching >= 8)
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard running, let buffer = CMSampleBufferGetImageBuffer(sample), let rgb = sampleColors(buffer) else { return }
        let now = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        signal.add(time: now, red: rgb.red, green: rgb.green, blue: rgb.blue,
                   screenLit: position == .front, evenCoverage: rgb.even)
        attempt.record(time: now, red: rgb.red, green: rgb.green, blue: rgb.blue, even: rgb.even, signal: signal)
        let cameraElapsed = Double(DispatchTime.now().uptimeNanoseconds - cameraStarted.uptimeNanoseconds) / 1e9
        if signal.covered, attempt.extendForContact(cameraElapsed: cameraElapsed, contactElapsed: signal.elapsed) {
            timer?.schedule(deadline: cameraStarted + attempt.timeout)
        }
        updateMetering(now: now, usableLight: (12...244).contains(rgb.red) || (12...244).contains(rgb.green))
        let done = signal.estimate != nil
        guard done || now - lastDisplay >= 0.1 else { return }
        lastDisplay = now
        if signal.covered {
            previewImage = nil
        } else if previewImage == nil || now - previewTime >= 0.25 {
            let portrait = CIImage(cvPixelBuffer: buffer).oriented(position == .front ? .leftMirrored : .right)
            let scale = 128 / max(portrait.extent.width, portrait.extent.height)
            let small = portrait.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            previewImage = previewContext.createCGImage(small, from: small.extent.integral)
            previewTime = now
        }
        let frame = PulseFrame(wave: signal.waveform, seconds: signal.elapsed, quality: signal.quality,
                               bpm: signal.estimate, finished: done, contact: signal.covered,
                               confirming: signal.issue == .confirming,
                               alignmentPreview: previewImage, contrastDetail: signal.diagnostic)
        if signal.covered && !frame.wave.isEmpty && frame.seconds >= (longestFrame?.seconds ?? 0) {
            longestFrame = frame
        }
        if done { shutdown() }
        publish(frame)
    }
}

private enum PulseLens: String, CaseIterable, Identifiable {
    case front, rear
    var id: Self { self }
    var title: String { self == .front ? "Front camera" : "Rear camera" }
    var position: AVCaptureDevice.Position { self == .front ? .front : .back }

    static var preferred: Self {
        var system = utsname()
        guard uname(&system) == 0 else { return .rear }
        let model = withUnsafeBytes(of: &system.machine) { String(decoding: $0.prefix(while: { $0 != 0 }), as: UTF8.self) }
        // The 17 Pro and 17 Pro Max have the widely separated rear flash.
        return ["iPhone18,1", "iPhone18,2"].contains(model) ? .front : .rear
    }
}

@MainActor private final class PulseLighting: ObservableObject {
    private weak var screen: UIScreen?
    private var previousBrightness: CGFloat?
    private var appliedBrightness: CGFloat?
    private var previousIdleSetting: Bool?

    func begin(front: Bool) {
        if previousIdleSetting == nil {
            previousIdleSetting = UIApplication.shared.isIdleTimerDisabled
            UIApplication.shared.isIdleTimerDisabled = true
        }
        guard front, previousBrightness == nil,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                  .first(where: { $0.activationState == .foregroundActive }) else { return }
        let screen = scene.screen
        self.screen = screen
        previousBrightness = screen.brightness
        let level = max(screen.brightness, 0.85)
        screen.brightness = level
        appliedBrightness = screen.brightness
    }

    func end() {
        if let screen, let old = previousBrightness, let applied = appliedBrightness,
           abs(screen.brightness - applied) < 0.02 { screen.brightness = old }
        if let previousIdleSetting { UIApplication.shared.isIdleTimerDisabled = previousIdleSetting }
        previousBrightness = nil
        appliedBrightness = nil
        previousIdleSetting = nil
        screen = nil
    }
}

struct CameraPulseView: View {
    let title: String
    let useTitle: String
    let accept: (Int) -> Void
    let skip: () -> Void
    let skipTitle: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var light = PulseLighting()
    @State private var lens = PulseLens.preferred
    @State private var reader: CameraReader?
    @State private var frame = PulseFrame()
    @State private var generation = UUID()
    @State private var cameraReady = false
    @State private var exportingSample = false
    @State private var exportError: String?

    private var screenLit: Bool { lens == .front && reader != nil && !frame.finished }
    private var guidance: String {
        if lens == .front {
            return "Hold the screen facing you. Rest one finger lightly over the selfie camera at the top of the screen, with your fingertip touching the bright area around it."
        }
        return "Lightly cover the main rear lens. If light does not reach your fingertip, switch to Front camera."
    }
    private var resultText: String {
        if let bpm = frame.bpm { return "\(bpm) BPM" }
        if frame.finished { return "No reading" }
        if !frame.contact { return "Place fingertip" }
        let remaining = Int(ceil(max(0, PulseSignal.duration - frame.seconds)))
        if remaining > 0 { return "\(remaining) s" }
        return frame.confirming ? "Confirming…" : "Checking signal…"
    }

    var body: some View {
        VStack(spacing: 0) {
            if screenLit {
                // Keep the area surrounding the selfie lens white, including in Dark Mode.
                Color.white.frame(height: 54).accessibilityHidden(true)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text(title).font(.title2.bold())
                        Spacer()
                        Button("Close") { stop(); dismiss() }
                    }
                    Picker("Measurement camera", selection: $lens) {
                        ForEach(PulseLens.allCases) { Text($0.title).tag($0) }
                    }.pickerStyle(.segmented)
                    Text(guidance).font(.body)
                    if let preview = frame.alignmentPreview {
                        HStack(spacing: 12) {
                            Image(decorative: preview, scale: 1)
                                .resizable().scaledToFill().frame(width: 56, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Text("If you see your surroundings here, slide your fingertip over the lens until the view is covered.")
                                .font(.subheadline)
                        }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text(resultText).font(.system(.largeTitle, design: .rounded).weight(.semibold)).monospacedDigit()
                        if !frame.finished || !frame.wave.isEmpty {
                            Canvas { context, size in
                                let wave = frame.wave
                                guard wave.count > 1, let low = wave.min(), let high = wave.max() else { return }
                                var path = Path()
                                for (i, value) in wave.enumerated() {
                                    let point = CGPoint(x: Double(i)*size.width/Double(wave.count-1),
                                                        y: size.height * (0.5 - (value-(high+low)/2)/max(0.5,high-low)*0.85))
                                    if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
                                }
                                context.stroke(path, with: .color(.mint), lineWidth: 2)
                            }.frame(height: 68).accessibilityHidden(true)
                        }
                        Label(frame.quality, systemImage: frame.finished && frame.bpm == nil ? "info.circle" :
                                (frame.contact ? "waveform.path.ecg" : "camera"))
                        if let summary = frame.attemptSummary {
                            Text(summary).font(.footnote).monospacedDigit()
                        } else if !frame.finished {
                            ProgressView(value: min(frame.seconds / PulseSignal.duration, 1)).tint(.mint)
                        }
                    }
                    .foregroundStyle(.white).padding(18).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(red: 0.07, green: 0.19, blue: 0.16), in: RoundedRectangle(cornerRadius: 18))
                    if let bpm = frame.bpm {
                        Button(useTitle) { stop(); accept(bpm) }.buttonStyle(.borderedProminent)
                    }
                    if frame.finished {
                        Button("Try again") { start() }.buttonStyle(.bordered)
                    }
                    if frame.sampleCSV != nil {
                        DisclosureGroup("Troubleshooting") {
                            VStack(alignment: .leading, spacing: 8) {
                                if !frame.contrastDetail.isEmpty {
                                    Text(frame.contrastDetail).font(.footnote).monospacedDigit()
                                }
                                Text("Save a sample of timing and fingertip colors for troubleshooting. No images or account details are included.")
                                    .font(.footnote)
                                Button("Save signal sample…") { exportingSample = true }
                                if let exportError { Text(exportError).font(.footnote) }
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                        }
                    }
                    Button(skipTitle) { stop(); skip() }
                    Text("Fitness estimate. Camera frames stay on this iPhone.").font(.footnote).foregroundStyle(.secondary)
                }.padding(20)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .preferredColorScheme(screenLit ? .light : nil)
        .onAppear { start() }
        .onDisappear { stop() }
        .onChange(of: lens) { _ in start() }
        .onChange(of: scenePhase) { phase in
            if phase == .background && !frame.finished {
                stop()
                frame = PulseFrame(quality: "Measurement paused. Tap Try again when ready.", finished: true)
            } else if phase == .inactive {
                light.end()
            } else if cameraReady && !frame.finished {
                light.begin(front: lens == .front)
            }
        }
        .fileExporter(isPresented: $exportingSample, document: frame.sampleCSV.map(SignalFile.init(csv:)),
                      contentType: .commaSeparatedText, defaultFilename: "MotionTrack-camera-signal") { result in
            if case .failure(let error) = result, (error as NSError).code != NSUserCancelledError {
                exportError = error.localizedDescription
            }
        }
    }

    private func stop() {
        generation = UUID()
        reader?.stop()
        reader = nil
        cameraReady = false
        light.end()
    }
    private func start() {
        stop()
        exportError = nil
        frame = PulseFrame()
        let token = generation
        let next = CameraReader(position: lens.position) { value in
            DispatchQueue.main.async {
                guard token == generation else { return }
                frame = value
                if value.finished {
                    cameraReady = false
                    light.end()
                } else if !cameraReady {
                    cameraReady = true
                    if scenePhase == .active { light.begin(front: lens == .front) }
                }
            }
        }
        reader = next
        next.start()
    }
}
