import Foundation

enum PulseSignalIssue: String {
    case seekingContact, collecting, lowContrast, unstableRhythm, changingLight, conflictingRates, confirming
}

/// Detect repeated optical pulses in a covered-lens window. All times are camera timestamps.
struct PulseSignal {
    static let duration = 25.0
    private struct Filter {
        var baseline: Double?
        var smooth = 0.0
        mutating func add(_ value: Double, dt: Double) -> Double {
            let prior = baseline ?? value
            let level = prior + (1 - exp(-dt / 0.8)) * (value - prior)
            baseline = level
            smooth += (1 - exp(-dt / 0.07)) * (value - level - smooth)
            return smooth
        }
    }
    private struct Sample {
        let time: Double
        let green: Double
        let red: Double
        let blue: Double
    }
    private var first: Double?
    private var previous: Double?
    private var greenFilter = Filter()
    private var redFilter = Filter()
    private var blueFilter = Filter()
    private var samples: [Sample] = []
    private var displayChannel: KeyPath<Sample, Double> = \.green
    private var lastAnalysis = -Double.infinity
    private var candidate: (bpm: Double, since: Double)?
    private(set) var elapsed = 0.0
    private(set) var covered = false
    private(set) var estimate: Int?
    private(set) var issue: PulseSignalIssue = .seekingContact
    private(set) var diagnostic = ""
    private(set) var quality = "Cover the active lens with your fingertip."
    var waveform: [Double] { samples.suffix(100).map { $0[keyPath: displayChannel] } }

    mutating func add(time: Double, red: Double, green: Double, blue: Double,
                      screenLit: Bool = false, evenCoverage: Bool = false) {
        // Reflected screen light does not produce the deep red of transmitted flash light.
        // The front camera also requires spatially even coverage of its central field.
        let minimumRed = screenLit ? 30.0 : 45.0
        let warm = screenLit ? (red > green * 1.06 && red > blue * 1.10)
                             : (red > green * 1.30 && red > blue * 1.30)
        // Ignore a few patchy frames when the finger still lights the lens. A
        // sustained loss or a view of the room must start a fresh measurement.
        if screenLit, !evenCoverage, warm, red > minimumRed, let previous,
           time > previous, time - previous <= 0.15 {
            covered = false
            estimate = nil
            issue = .seekingContact
            quality = "Keep the pad of your finger over the whole front camera."
            return
        }
        guard time.isFinite, red.isFinite, green.isFinite, blue.isFinite,
              red > minimumRed, warm, !screenLit || evenCoverage else {
            self = Self()
            if red.isFinite && red < minimumRed {
                quality = screenLit ? "Too dark. Rest your fingertip lightly over the front camera."
                                    : "Too dark. Shine a steady light onto the side of your fingertip."
            } else if screenLit && !evenCoverage {
                quality = "Cover the front camera opening fully with the pad of one finger."
            }
            return
        }
        if let previous, time - previous > 0.25 || time <= previous { self = Self() }
        let dt = time - (previous ?? time)
        if !covered {
            issue = .collecting
            quality = "Finger detected. Rest your hand and keep light pressure."
        }
        covered = true
        if first == nil { first = time }
        previous = time
        elapsed = time - (first ?? time)
        let g = greenFilter.add(green, dt: dt)
        let r = redFilter.add(red, dt: dt)
        let b = blueFilter.add(blue, dt: dt)
        guard elapsed >= 2 else { return }
        samples.append(Sample(time: time, green: g, red: r, blue: b))
        guard time - lastAnalysis >= 0.25 || (elapsed >= Self.duration && elapsed - dt < Self.duration) else { return }
        lastAnalysis = time
        samples.removeAll { time - $0.time > 12 }
        guard let start = samples.first, time - start.time >= 8 else { return }
        let redLevel = redFilter.baseline ?? 0
        let greenLevel = greenFilter.baseline ?? 0
        let redSpan = Self.contrast(samples, channel: \.red)
        let greenSpan = Self.contrast(samples, channel: \.green)
        diagnostic = String(format: "Red/green contrast %.2f / %.2f", redSpan, greenSpan)
        if screenLit && brightnessOnlyVariation() {
            candidate = nil
            estimate = nil
            issue = .changingLight
            quality = "Light is changing. Rest your hand and keep the camera fully covered."
            return
        }
        var greenRate = Self.rate(samples, channel: \.green, level: greenLevel, span: greenSpan, now: time)
        var redRate = Self.rate(samples, channel: \.red, level: redLevel, span: redSpan, now: time)
        if screenLit, greenRate == nil || redRate == nil {
            // If individual beats are too noisy to time reliably, require the
            // same rhythm independently in both colors before using the fallback.
            let greenFrequency = greenRate ?? Self.frequencyRate(samples, channel: \.green, level: greenLevel, span: greenSpan)
            let redFrequency = redRate ?? Self.frequencyRate(samples, channel: \.red, level: redLevel, span: redSpan)
            if let greenFrequency, let redFrequency {
                greenRate = greenFrequency
                redRate = redFrequency
            }
        }
        estimate = nil
        if let g = greenRate, let r = redRate, abs(g - r) > max(5, min(g, r) * 0.08) {
            candidate = nil
            issue = .conflictingRates
            quality = "Signals disagree. Rest your hand and keep the lighting steady."
            return
        }
        guard let rate = greenRate ?? redRate else {
            candidate = nil
            let greenDetail = (8...249).contains(greenLevel) && greenSpan >= 0.08
            let redDetail = (8...249).contains(redLevel) && redSpan >= 0.08
            if !redDetail && !greenDetail {
                issue = .lowContrast
                quality = screenLit ? "Little pulse detail. Ease finger pressure and keep your hand still."
                                    : "Little pulse detail. Adjust the side light or ease finger pressure."
            } else {
                issue = .unstableRhythm
                quality = "Finger detected. Hold still while looking for a regular pulse."
            }
            return
        }
        if screenLit && brightnessOnly(at: rate) {
            candidate = nil
            issue = .changingLight
            quality = "The colors are brightening together. Keep your fingertip covered and support the phone."
            return
        }
        issue = .confirming
        displayChannel = greenRate == nil ? \.red : \.green
        if let prior = candidate, abs(prior.bpm - rate) <= max(4, rate * 0.06) {
            quality = "Steady pulse signal"
            if elapsed >= Self.duration && time - prior.since >= 2 {
                estimate = Int(rate.rounded())
            }
        } else {
            candidate = (rate, time)
            quality = "Pulse found. Confirming the rhythm…"
        }
    }

    // Shared threshold for broadband and frequency-specific changes in brightness.
    private static let commonLightResidual = 0.015

    // At the proposed beat frequency, compare both phase and relative amplitude
    // across colors. Slow color drift can hide a common light source in a broadband check.
    private func brightnessOnly(at bpm: Double) -> Bool {
        guard let first = samples.first, let last = samples.last, last.time > first.time,
              let r = redFilter.baseline, let g = greenFilter.baseline, let b = blueFilter.baseline,
              (12...245).contains(r), (12...245).contains(g), (12...245).contains(b) else { return false }
        let duration = last.time - first.time
        let levels = SIMD3(r, g, b)
        var real = SIMD3<Double>.zero
        var imaginary = SIMD3<Double>.zero
        for sample in samples {
            let t = sample.time - first.time
            let taper = 0.5 - 0.5 * cos(2 * .pi * t / duration)
            let colors = SIMD3(sample.red, sample.green, sample.blue) / levels
            let phase = 2 * .pi * bpm * t / 60
            real += colors * (taper * cos(phase))
            imaginary += colors * (taper * sin(phase))
        }
        let energy = (real * real + imaginary * imaginary).sum()
        let colorReal = real - SIMD3(repeating: real.sum() / 3)
        let colorImag = imaginary - SIMD3(repeating: imaginary.sum() / 3)
        let residual = (colorReal * colorReal + colorImag * colorImag).sum()
        return energy > 0 && residual < Self.commonLightResidual * energy
    }

    // Uniform brightness flicker modulates all three colours in nearly identical proportions.
    private func brightnessOnlyVariation() -> Bool {
        guard let r = redFilter.baseline, let g = greenFilter.baseline, let b = blueFilter.baseline,
              (12...245).contains(r), (12...245).contains(g), (12...245).contains(b) else { return false }
        var energy = 0.0, residual = 0.0
        for sample in samples {
            let rr = sample.red / r, gg = sample.green / g, bb = sample.blue / b
            let mean = (rr + gg + bb) / 3
            energy += rr*rr + gg*gg + bb*bb
            residual += (rr-mean)*(rr-mean) + (gg-mean)*(gg-mean) + (bb-mean)*(bb-mean)
        }
        return energy > 0 && residual < Self.commonLightResidual * energy
    }

    private static func contrast(_ window: [Sample], channel: KeyPath<Sample, Double>) -> Double {
        let sorted = window.map { $0[keyPath: channel] }.sorted()
        return sorted[sorted.count * 9 / 10] - sorted[sorted.count / 10]
    }

    private static func rate(_ window: [Sample], channel: KeyPath<Sample, Double>, level baseline: Double, span: Double, now: Double) -> Double? {
        guard (8...249).contains(baseline), window.count >= 2 else { return nil }
        guard span > max(0.12, baseline * 0.001), span < max(5, baseline * 0.12) else { return nil }
        // Adapt to the local level and amplitude as fingertip perfusion or exposure changes.
        // The physical minimum contrast above is also the floor when normalizing a quiet region.
        let values = window.map { $0[keyPath: channel] }
        let normalized = normalizedPulse(window, values: values, noiseFloor: max(0.12, baseline * 0.001))
        var beats: [Double] = []
        var armed = false
        for i in 1..<window.count {
            let value = normalized[i]
            if value <= -0.45 { armed = true }
            if armed && value >= 0.45 {
                let delta = value - normalized[i-1]
                let fraction = delta > 0 ? min(1, max(0, (0.45 - normalized[i-1]) / delta)) : 1
                beats.append(window[i-1].time + fraction * (window[i].time - window[i-1].time))
                armed = false
            }
        }
        let periods = zip(beats.dropFirst(), beats).map { $0.0 - $0.1 }.sorted()
        guard periods.count >= 5 else { return nil }
        let median = periods[periods.count / 2]
        guard (0.32...1.5).contains(median),
              periods.filter({ abs($0 - median) <= median * 0.20 }).count >= Int(ceil(Double(periods.count) * 0.85)),
              now - (beats.last ?? 0) < median * 1.6,
              repeatsAtPeriod(window, values: normalized, period: median) else { return nil }
        return 60 / median
    }

    // Goertzel power for a tapered window. Normalization expresses the fraction
    // of weighted signal energy at the candidate frequency rather than raw amplitude.
    private struct Spectrum {
        static let sampleRate = 12.0
        let values: [Double]
        let normalization: Double

        init(_ input: ArraySlice<Double>) {
            let mean = input.reduce(0, +) / Double(input.count)
            let weights = input.indices.map {
                0.5 - 0.5 * cos(2 * .pi * Double($0 - input.startIndex) / Double(input.count - 1))
            }
            var energy = 0.0
            var weighted: [Double] = []
            for (value, weight) in zip(input, weights) {
                let centered = value - mean
                weighted.append(centered * weight)
                energy += centered * centered * weight
            }
            values = weighted
            normalization = weights.reduce(0, +) * energy
        }

        func power(at bpm: Int) -> Double {
            guard normalization > 0 else { return 0 }
            let coefficient = 2 * cos(2 * .pi * Double(bpm) / (60 * Self.sampleRate))
            var previous = 0.0, prior = 0.0
            for value in values {
                let next = value + coefficient * previous - prior
                prior = previous
                previous = next
            }
            return 2 * (previous*previous + prior*prior - coefficient*previous*prior) / normalization
        }
    }

    // The camera may settle gradually while a finger stays in place. Remove the
    // local mean before ranking frequencies. Use only centered, complete windows
    // so edge padding or an interrupted contact cannot create a candidate beat.
    private static func removeTrend(_ window: [Sample], channel: KeyPath<Sample, Double>)
        -> [(time: Double, value: Double)] {
        let radius = 0.5
        let start = window[0].time + radius
        let end = window[window.count - 1].time - radius
        var left = 0, right = 0, sum = 0.0
        var values: [(time: Double, value: Double)] = []
        values.reserveCapacity(window.count)
        for sample in window where sample.time >= start && sample.time <= end {
            while right < window.count && window[right].time <= sample.time + radius {
                sum += window[right][keyPath: channel]
                right += 1
            }
            while window[left].time < sample.time - radius {
                sum -= window[left][keyPath: channel]
                left += 1
            }
            values.append((sample.time, sample[keyPath: channel] - sum / Double(right - left)))
        }
        return values
    }

    private static func frequencyRate(_ window: [Sample], channel: KeyPath<Sample, Double>,
                                      level: Double, span: Double) -> Double? {
        guard (8...249).contains(level), span >= 0.08, span < max(5, level * 0.12),
              window.count > 2 else { return nil }
        let detrended = removeTrend(window, channel: channel)
        guard let first = detrended.first, let last = detrended.last, last.time - first.time >= 9 else { return nil }
        // Camera callbacks may skip frames. Interpolate against their timestamps
        // so frequency in cycles per second is independent of callback cadence.
        var samples: [Double] = []
        var source = 0
        let count = Int((last.time - first.time) * Spectrum.sampleRate) + 1
        for index in 0..<count {
            let time = first.time + Double(index) / Spectrum.sampleRate
            while source + 2 < detrended.count && detrended[source + 1].time < time { source += 1 }
            let a = detrended[source], b = detrended[source + 1]
            let fraction = (time - a.time) / (b.time - a.time)
            samples.append(a.value + fraction * (b.value - a.value))
        }
        let spectrum = Spectrum(samples[...])
        let rates = stride(from: 40, through: 186, by: 2)
        let peaks = rates.map { (rate: $0, power: spectrum.power(at: $0)) }
        guard let best = peaks.max(by: { $0.power < $1.power }), best.power >= 0.30 else { return nil }
        // A strong second peak, including a competing harmonic, is ambiguous.
        let margin = 100 / (last.time - first.time)
        guard !peaks.contains(where: {
            Double(abs($0.rate - best.rate)) > margin && $0.power > best.power * 0.60
        }) else { return nil }
        // An isolated burst can dominate one full-window peak. Require support
        // for that rhythm on both sides of the window before accepting this channel.
        let half = samples.count / 2
        guard Spectrum(samples[..<half]).power(at: best.rate) >= 0.22,
              Spectrum(samples[half...]).power(at: best.rate) >= 0.22 else { return nil }
        // Downsampling can fold faster flicker into the pulse band. Confirm at
        // the original camera timestamps before attributing the peak to a pulse.
        let mean = detrended.reduce(0) { $0 + $1.value } / Double(detrended.count)
        let angularFrequency = Double(best.rate) * 2 * .pi / 60
        var cosine = 0.0, sine = 0.0, energy = 0.0
        for sample in detrended {
            let phase = (sample.time - first.time) * angularFrequency
            let value = sample.value - mean
            cosine += value * cos(phase)
            sine += value * sin(phase)
            energy += value * value
        }
        guard 2 * (cosine*cosine + sine*sine) > 0.18 * Double(detrended.count) * energy else { return nil }
        return Double(best.rate)
    }

    private static func normalizedPulse(_ window: [Sample], values: [Double], noiseFloor: Double) -> [Double] {
        var left = 0, right = 0
        var sum = 0.0, squares = 0.0
        return window.indices.map { i in
            while right < window.count && window[right].time <= window[i].time + 0.75 {
                sum += values[right]
                squares += values[right]*values[right]
                right += 1
            }
            while window[left].time < window[i].time - 0.75 {
                sum -= values[left]
                squares -= values[left]*values[left]
                left += 1
            }
            let count = Double(right - left)
            let mean = sum / count
            let deviation = sqrt(max(0, squares / count - mean*mean))
            return (values[i] - mean) / max(noiseFloor, deviation)
        }
    }

    // Confirm waveform repetition at the beat interval using timestamps, including irregular frame rates.
    private static func repeatsAtPeriod(_ window: [Sample], values: [Double], period: Double) -> Bool {
        var earlier = 0
        var cross = 0.0, currentEnergy = 0.0, pastEnergy = 0.0
        for i in window.indices {
            let target = window[i].time - period
            guard target >= window[0].time else { continue }
            while earlier + 1 < i && window[earlier+1].time < target { earlier += 1 }
            let fraction = (target-window[earlier].time) / (window[earlier+1].time-window[earlier].time)
            let past = values[earlier] + fraction * (values[earlier+1]-values[earlier])
            cross += values[i]*past
            currentEnergy += values[i]*values[i]
            pastEnergy += past*past
        }
        return cross > 0.55 * sqrt(currentEnergy*pastEnergy)
    }
}
