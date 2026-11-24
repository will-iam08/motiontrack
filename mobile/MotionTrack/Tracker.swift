import Foundation
import CoreBluetooth
import Combine

// Proposed interface. Replace this section once the firmware team confirms the format.
enum Wire {
    static let service = CBUUID(string: "45583198-0001-4BAD-9000-000000000065")
    static let control = CBUUID(string: "45583198-0003-4BAD-9000-000000000065")
    static let telemetry = CBUUID(string: "45583198-0002-4BAD-9000-000000000065")
}
enum Movement: Equatable {
    case unavailable, detecting, unrecognized, curl, lateralRaise, shoulderPress, backRow
    case unmapped(UInt8)

    init(code: UInt8) {
        switch code {
        case 0: self = .detecting
        case 1: self = .curl
        case 2: self = .lateralRaise
        case 3: self = .shoulderPress
        case 4: self = .backRow
        case 255: self = .unrecognized
        default: self = .unmapped(code)
        }
    }
}

enum WorkoutStage: UInt8 {
    case idle, before, counting, after, complete, stopped, fault, starting
    var canStart: Bool { self == .idle || self == .complete || self == .stopped }
    var active: Bool { self == .before || self == .counting || self == .after }
}

struct Reading {
    enum Phase: UInt8 { case ready, active, finished }
    var phase: Phase = .ready
    var reps = 0
    var seconds = 0

    var movement: Movement = .unavailable
    var bpm: Int?
    var stage: WorkoutStage?
    var target = 0
    var flags: UInt8 = 0
    var beforeBPM: Int?
    var afterBPM: Int?
    var capture: UInt8 = 0

    init() {}
    init?(packet: Data) {
        let b = Array(packet)
        guard let version = b.first else { return nil }
        switch (version, b.count) {
        case (1, 8): break
        case (3, 17), (2, 11):
            if version == 3 {
                guard let stage = WorkoutStage(rawValue: b[11]) else { return nil }
                self.stage = stage
                target = Int(b[12])
                flags = b[13]
                beforeBPM = b[14] == 0 ? nil : Int(b[14])
                afterBPM = b[15] == 0 ? nil : Int(b[15])
                capture = b[16]
            }
            movement = Movement(code: b[8])
            let pulse = Int(b[9]) | Int(b[10]) << 8
            bpm = pulse == 0 ? nil : pulse
        default: return nil
        }
        guard let phase = Phase(rawValue: b[1]) else { return nil }
        self.phase = phase
        reps = Int(b[2]) | Int(b[3]) << 8
        seconds = Int(b[4]) | Int(b[5]) << 8 | Int(b[6]) << 16 | Int(b[7]) << 24
    }
}

final class Tracker: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    @Published private(set) var reading: Reading?
    @Published private(set) var status = "Disconnected"
    @Published private(set) var devices: [CBPeripheral] = []
    @Published private(set) var busy = false
    @Published private(set) var connected = false
    @Published private(set) var hasControls = false
    @Published private(set) var sending = false
    private var commandCharacteristic: CBCharacteristic?
    private var sentAtStage: WorkoutStage?
    private var confirmationTimeout: DispatchWorkItem?
    private var central: CBCentralManager?
    private var device: CBPeripheral?
    private var timeout: DispatchWorkItem?

    func scan() {
        if central == nil {
            busy = true
            status = "Checking Bluetooth…"
            central = CBCentralManager(delegate: self, queue: .main)
        } else if central?.state == .poweredOn {
            beginScan()
        } else {
            status = "Check Bluetooth in Settings and try again."
        }
    }
    private func beginScan() {
        devices = []
        reading = nil
        busy = true
        status = "Searching for trackers…"
        central?.scanForPeripherals(withServices: [Wire.service])
        deadline("Search finished. Select a tracker or scan again.")
    }
    private func deadline(_ message: String) {
        timeout?.cancel()
        let task = DispatchWorkItem { [weak self] in self?.end(message) }
        timeout = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: task)
    }
    private func end(_ message: String) {
        timeout?.cancel()
        central?.stopScan()
        let old = device
        device = nil
        commandCharacteristic = nil
        hasControls = false
        clearCommand()
        if let old { old.delegate = nil; central?.cancelPeripheralConnection(old) }
        busy = false
        connected = false
        reading = nil
        status = message
    }
    func disconnect() { end("Disconnected"); devices = [] }
    func connect(_ candidate: CBPeripheral) {
        central?.stopScan()
        device = candidate
        candidate.delegate = self
        devices = []
        busy = true
        status = "Connecting…"
        deadline("Connection timed out. Try again.")
        central?.connect(candidate)
    }
    private func clearCommand() {
        confirmationTimeout?.cancel()
        sending = false
        sentAtStage = nil
    }

    func send(_ op: UInt8, movement: UInt8 = 0, target: UInt8 = 0) {
        guard connected, !sending, let device, let commandCharacteristic,
              let stage = reading?.stage else { return }
        sending = true
        sentAtStage = stage
        device.writeValue(Data([1, op, movement, target, stage.rawValue]),
                          for: commandCharacteristic, type: .withResponse)
        let deadline = DispatchWorkItem { [weak self] in
            self?.clearCommand()
            self?.status = "No workout change confirmed. Check the tracker."
        }
        confirmationTimeout = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: deadline)
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === device, characteristic.uuid == Wire.control, error != nil else { return }
        clearCommand()
        status = "Command failed. Try again."
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn: if busy && device == nil { beginScan() }
        case .unknown, .resetting: break
        default: devices = []; end("Bluetooth unavailable. Check Bluetooth and app permissions.")
        }
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard central.isScanning, !devices.contains(where: { $0.identifier == peripheral.identifier }) else { return }
        devices.append(peripheral)
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === device else { return }
        peripheral.discoverServices([Wire.service])
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        if peripheral === device { end("Could not connect. Scan again.") }
    }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if peripheral === device { end("Connection lost. Scan to reconnect.") }
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral === device else { return }
        guard error == nil, let svc = peripheral.services?.first(where: { $0.uuid == Wire.service }) else {
            end("Tracker service unavailable."); return
        }
        peripheral.discoverCharacteristics([Wire.telemetry, Wire.control], for: svc)
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard peripheral === device else { return }
        guard error == nil, let ch = service.characteristics?.first(where: { $0.uuid == Wire.telemetry }),
              ch.properties.contains(.notify) else { end("Tracker telemetry unavailable."); return }
        commandCharacteristic = service.characteristics?.first { $0.uuid == Wire.control && $0.properties.contains(.write) }
        hasControls = commandCharacteristic != nil
        peripheral.setNotifyValue(true, for: ch)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === device else { return }
        guard error == nil, characteristic.isNotifying else { end("Could not subscribe to tracker."); return }
        timeout?.cancel()
        connected = true
        busy = false
        status = "Connected"
        if characteristic.properties.contains(.read) { peripheral.readValue(for: characteristic) }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard peripheral === device, characteristic.uuid == Wire.telemetry else { return }
        guard error == nil, let data = characteristic.value, let value = Reading(packet: data) else {
            reading = nil
            status = "Check telemetry format."
            return
        }
        if sending && value.stage != sentAtStage { clearCommand() }
        reading = value
        status = "Connected"
    }
}
