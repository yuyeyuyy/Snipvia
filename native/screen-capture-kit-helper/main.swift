import CoreGraphics
import CoreVideo
import Darwin
import Foundation
import ImageIO
@preconcurrency import ScreenCaptureKit
import UniformTypeIdentifiers

private struct Request: Decodable, Sendable {
    let version: Int
    let requestId: String
    let captureSessionId: String?
    let command: String
    let displayId: UInt32?
    let excludedPid: Int32?
    let format: String?
    let quality: Double?
    let delayMs: UInt64?
    let targetRequestId: String?
    let retainOriginal: Bool?
    let frameToken: String?
    let cropX: Int?
    let cropY: Int?
    let cropWidth: Int?
    let cropHeight: Int?
}

private struct DisplayDescriptor: Sendable {
    let id: UInt32
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let pixelWidth: Int
    let pixelHeight: Int
    let scaleFactor: Double

    var json: [String: Any] {
        [
            "id": String(id), "x": x, "y": y, "width": width, "height": height,
            "pixelWidth": pixelWidth, "pixelHeight": pixelHeight, "scaleFactor": scaleFactor
        ]
    }
}

private struct EncodedCapture: Sendable {
    let frameToken: String?
    let data: Data
    let width: Int
    let height: Int
    let bytesPerRow: Int?
    let format: String
    let mimeType: String
    let capturedAtEpochMs: Double
    let captureMs: Double
    let encodeMs: Double
    let rawBytesLength: Int?
    let jpegBytesLength: Int?
    let rawEncodeMs: Double?
    let jpegEncodeMs: Double?
    let displayCacheGeneration: Int
}

private final class FrameWriter: @unchecked Sendable {
    private let lock = NSLock()

    func send(_ header: [String: Any], payload: Data = Data()) {
        var value = header
        value["payloadLength"] = payload.count
        guard let metadata = try? JSONSerialization.data(withJSONObject: value), metadata.count <= 1_048_576 else {
            return
        }
        var length = UInt32(metadata.count).bigEndian
        let prefix = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(prefix)
        FileHandle.standardOutput.write(metadata)
        if !payload.isEmpty { FileHandle.standardOutput.write(payload) }
    }

    func event(requestId: String, captureSessionId: String? = nil, name: String) {
        var header: [String: Any] = ["kind": "event", "requestId": requestId, "name": name]
        if let captureSessionId { header["captureSessionId"] = captureSessionId }
        send(header)
    }

    func success(requestId: String, captureSessionId: String? = nil, command: String, values: [String: Any] = [:], payload: Data = Data()) {
        var header: [String: Any] = ["kind": "response", "ok": true, "requestId": requestId, "command": command]
        if let captureSessionId { header["captureSessionId"] = captureSessionId }
        send(header.merging(values) { _, new in new }, payload: payload)
    }

    func failure(requestId: String, captureSessionId: String? = nil, command: String, error: Error) {
        var header: [String: Any] = ["kind": "response", "ok": false, "requestId": requestId, "command": command, "error": error.localizedDescription]
        if let captureSessionId { header["captureSessionId"] = captureSessionId }
        send(header)
    }
}

@available(macOS 14.0, *)
private actor CaptureService {
    private let frames: FrozenFrameCache
    init(frames: FrozenFrameCache) { self.frames = frames }
    private var shareableContent: SCShareableContent?
    private var excludedApplication: SCRunningApplication?
    private var excludedPid: Int32 = -1
    private var topologyFingerprint: String?
    private var displayCacheGeneration = 0
    private var displayDescriptors: [DisplayDescriptor] = []
    private var captureContexts: [UInt32: (SCContentFilter, SCStreamConfiguration)] = [:]

    func initialize(excludedPid: Int32, force: Bool = false) async throws -> ([DisplayDescriptor], Bool, Int) {
        if !force, shareableContent != nil, self.excludedPid == excludedPid {
            return (displayDescriptors, excludedApplication != nil, displayCacheGeneration)
        }
        if force || shareableContent == nil || self.excludedPid != excludedPid {
            captureContexts.removeAll()
            shareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            self.excludedPid = excludedPid
            excludedApplication = shareableContent?.applications.first(where: { $0.processID == excludedPid })
            topologyFingerprint = currentDisplayTopologyFingerprint()
            displayCacheGeneration += 1
        }
        guard let content = shareableContent else { throw helperError("ScreenCaptureKit content is unavailable") }
        let displays = content.displays.map { display in
            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let scale = max(1, Double(filter.pointPixelScale))
            return DisplayDescriptor(
                id: display.displayID,
                x: display.frame.origin.x,
                y: display.frame.origin.y,
                width: display.frame.width,
                height: display.frame.height,
                pixelWidth: Int((Double(display.width) * scale).rounded()),
                pixelHeight: Int((Double(display.height) * scale).rounded()),
                scaleFactor: scale
            )
        }
        displayDescriptors = displays
        return (displays, excludedApplication != nil, displayCacheGeneration)
    }

    func invalidate() {
        shareableContent = nil
        excludedApplication = nil
        topologyFingerprint = nil
        displayDescriptors.removeAll()
        captureContexts.removeAll()
    }

    func capture(displayId: UInt32, format: String, retainOriginal: Bool, quality: Double, requestId: String, captureSessionId: String?, writer: FrameWriter) async throws -> EncodedCapture {
        _ = try await initialize(excludedPid: excludedPid)
        if topologyFingerprint != currentDisplayTopologyFingerprint() {
            _ = try await initialize(excludedPid: excludedPid, force: true)
        }
        if excludedApplication == nil {
            _ = try await initialize(excludedPid: excludedPid, force: true)
        }
        guard let content = shareableContent,
              let display = content.displays.first(where: { $0.displayID == displayId }) else {
            invalidate()
            _ = try await initialize(excludedPid: excludedPid)
            guard let refreshed = shareableContent?.displays.first(where: { $0.displayID == displayId }) else {
                throw helperError("ScreenCaptureKit display not found")
            }
            return try await captureImage(display: refreshed, format: format, retainOriginal: retainOriginal, quality: quality, requestId: requestId, captureSessionId: captureSessionId, writer: writer)
        }
        return try await captureImage(display: display, format: format, retainOriginal: retainOriginal, quality: quality, requestId: requestId, captureSessionId: captureSessionId, writer: writer)
    }

    private func captureImage(display: SCDisplay, format: String, retainOriginal: Bool, quality: Double, requestId: String, captureSessionId: String?, writer: FrameWriter) async throws -> EncodedCapture {
        guard let application = excludedApplication else { throw helperError("Snipvia application could not be resolved for self exclusion") }
        let filter: SCContentFilter
        let configuration: SCStreamConfiguration
        if let context = captureContexts[display.displayID] {
            filter = context.0; configuration = context.1
        } else {
            filter = SCContentFilter(display: display, excludingApplications: [application], exceptingWindows: [])
            let scale = max(1, Double(filter.pointPixelScale))
            configuration = SCStreamConfiguration()
            configuration.width = Int((Double(display.width) * scale).rounded())
            configuration.height = Int((Double(display.height) * scale).rounded())
            configuration.scalesToFit = false
            configuration.pixelFormat = kCVPixelFormatType_32BGRA
            configuration.showsCursor = false
            configuration.queueDepth = 1
            captureContexts[display.displayID] = (filter, configuration)
        }

        try Task.checkCancellation()
        writer.event(requestId: requestId, captureSessionId: captureSessionId, name: "capture-start")
        let captureStarted = ContinuousClock.now
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        let captureMs = milliseconds(captureStarted.duration(to: ContinuousClock.now))
        let capturedAt = Date().timeIntervalSince1970 * 1000
        writer.event(requestId: requestId, captureSessionId: captureSessionId, name: "capture-end")
        try Task.checkCancellation()
        writer.event(requestId: requestId, captureSessionId: captureSessionId, name: "encode-start")
        let encodeStarted = ContinuousClock.now
        let payload: Data
        let bytesPerRow: Int?
        let mimeType: String
        var rawBytesLength: Int?
        var jpegBytesLength: Int?
        var rawEncodeMs: Double?
        var jpegEncodeMs: Double?
        if format == "bgra" {
            let raw = try renderBGRA(image)
            payload = raw.0
            bytesPerRow = raw.1
            mimeType = "application/x-bgra"
        } else if format == "comparison" {
            let rawStarted = ContinuousClock.now
            let raw = try renderBGRA(image)
            rawEncodeMs = milliseconds(rawStarted.duration(to: ContinuousClock.now))
            let jpegStarted = ContinuousClock.now
            let jpeg = try encodeJPEG(image, quality: quality)
            jpegEncodeMs = milliseconds(jpegStarted.duration(to: ContinuousClock.now))
            var combined = raw.0
            combined.append(jpeg)
            payload = combined
            bytesPerRow = raw.1
            mimeType = "application/octet-stream"
            rawBytesLength = raw.0.count
            jpegBytesLength = jpeg.count
        } else {
            payload = try encodeJPEG(image, quality: quality)
            bytesPerRow = nil
            mimeType = "image/jpeg"
        }
        let encodeMs = milliseconds(encodeStarted.duration(to: ContinuousClock.now))
        writer.event(requestId: requestId, captureSessionId: captureSessionId, name: "encode-end")
        try Task.checkCancellation()
        let token = retainOriginal ? try frames.insert(image, session: captureSessionId ?? requestId) : nil
        return EncodedCapture(
            frameToken: token,
            data: payload,
            width: image.width,
            height: image.height,
            bytesPerRow: bytesPerRow,
            format: format == "bgra" || format == "comparison" ? format : "jpeg",
            mimeType: mimeType,
            capturedAtEpochMs: capturedAt,
            captureMs: captureMs,
            encodeMs: encodeMs,
            rawBytesLength: rawBytesLength,
            jpegBytesLength: jpegBytesLength,
            rawEncodeMs: rawEncodeMs,
            jpegEncodeMs: jpegEncodeMs,
            displayCacheGeneration: displayCacheGeneration
        )
    }

    private func renderBGRA(_ image: CGImage) throws -> (Data, Int) {
        let rowBytes = image.width * 4
        var data = Data(count: rowBytes * image.height)
        let rendered = data.withUnsafeMutableBytes { bytes -> Bool in
            guard let address = bytes.baseAddress,
                  let context = CGContext(
                    data: address, width: image.width, height: image.height,
                    bitsPerComponent: 8, bytesPerRow: rowBytes,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
                  ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        guard rendered else { throw helperError("BGRA rendering failed") }
        return (data, rowBytes)
    }

    private func encodeJPEG(_ image: CGImage, quality: Double) throws -> Data {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw helperError("JPEG encoder is unavailable")
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw helperError("JPEG encoding failed") }
        return data as Data
    }
}

private final class CommandCoordinator: @unchecked Sendable {
    private let writer: FrameWriter
    private let frames = FrozenFrameCache()
    private let lock = NSLock()
    private var tasks: [String: Task<Void, Never>] = [:]
    @available(macOS 14.0, *) private lazy var service = CaptureService(frames: frames)

    init(writer: FrameWriter) { self.writer = writer }

    private func removeTask(_ requestId: String) {
        lock.lock()
        tasks.removeValue(forKey: requestId)
        lock.unlock()
    }

    func handle(_ request: Request) {
        guard request.version == 1 else {
            writer.failure(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command, error: helperError("Unsupported protocol version"))
            return
        }
        if request.command == "crash" { exit(86) }
        if request.command == "cancel" {
            lock.lock()
            let task = request.targetRequestId.flatMap { tasks.removeValue(forKey: $0) }
            lock.unlock()
            task?.cancel()
            writer.success(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command)
            return
        }
        guard #available(macOS 14.0, *) else {
            writer.failure(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command, error: helperError("ScreenCaptureKit helper requires macOS 14 or later"))
            return
        }
        let task = Task { [weak self] in
            guard let self else { return }
            do {
                switch request.command {
                case "initialize", "refresh":
                    let result = try await service.initialize(excludedPid: request.excludedPid ?? getppid(), force: request.command == "refresh")
                    writer.success(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command, values: [
                        "displays": result.0.map(\.json), "excludedApplicationFound": result.1,
                        "helperPid": ProcessInfo.processInfo.processIdentifier,
                        "capabilities": ["frozen-frame-png"],
                        "displayCacheGeneration": result.2
                    ])
                case "capture", "sleep":
                    if request.command == "sleep" {
                        try await Task.sleep(for: .milliseconds(request.delayMs ?? 1000))
                    }
                    guard let displayId = request.displayId else { throw helperError("displayId is required") }
                    let output = try await service.capture(
                        displayId: displayId,
                        format: request.format == "bgra" || request.format == "comparison" ? request.format! : "jpeg",
                        retainOriginal: request.retainOriginal ?? false,
                        quality: min(1, max(0, request.quality ?? 0.95)),
                        requestId: request.requestId,
                        captureSessionId: request.captureSessionId,
                        writer: writer
                    )
                    if Task.isCancelled {
                        if let token = output.frameToken { frames.release(token, session: request.captureSessionId ?? request.requestId) }
                        throw CancellationError()
                    }
                    writer.event(requestId: request.requestId, captureSessionId: request.captureSessionId, name: "bridge-start")
                    writer.success(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command, values: [
                        "frameToken": output.frameToken as Any,
                        "displayId": String(displayId), "width": output.width, "height": output.height,
                        "format": output.format, "mimeType": output.mimeType,
                        "capturedAtEpochMs": output.capturedAtEpochMs,
                        "captureMs": output.captureMs, "encodeMs": output.encodeMs,
                        "bytesPerRow": output.bytesPerRow as Any,
                        "rawBytesLength": output.rawBytesLength as Any,
                        "jpegBytesLength": output.jpegBytesLength as Any,
                        "rawEncodeMs": output.rawEncodeMs as Any,
                        "jpegEncodeMs": output.jpegEncodeMs as Any,
                        "displayCacheGeneration": output.displayCacheGeneration
                    ].compactMapValues { value in
                        if value is NSNull { return nil }
                        return value
                    }, payload: output.data)
                case "crop":
                    guard let token = request.frameToken, let session = request.captureSessionId,
                          let x = request.cropX, let y = request.cropY, let width = request.cropWidth, let height = request.cropHeight else {
                        throw helperError("Frozen-frame crop parameters are required")
                    }
                    let frame = try frames.frame(token, session: session)
                    let started = ContinuousClock.now
                    let png = try await Task.detached(priority: .userInitiated) {
                        try frame.png(x: x, y: y, width: width, height: height)
                    }.value
                    try Task.checkCancellation()
                    writer.success(requestId: request.requestId, captureSessionId: session, command: request.command,
                        values: ["format": "png", "width": width, "height": height, "encodeMs": milliseconds(started.duration(to: ContinuousClock.now))], payload: png)
                case "release":
                    if let token = request.frameToken, let session = request.captureSessionId { frames.release(token, session: session) }
                    writer.success(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command)
                case "invalidate":
                    await service.invalidate()
                    writer.success(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command)
                case "ping":
                    writer.success(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command, values: ["helperPid": ProcessInfo.processInfo.processIdentifier])
                case "dispose":
                    writer.success(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command)
                    exit(0)
                default:
                    throw helperError("Unknown command: \(request.command)")
                }
            } catch {
                writer.failure(requestId: request.requestId, captureSessionId: request.captureSessionId, command: request.command, error: error)
            }
            self.removeTask(request.requestId)
        }
        lock.lock()
        tasks[request.requestId] = task
        lock.unlock()
    }

    func cancelAll() {
        lock.lock()
        let active = Array(tasks.values)
        tasks.removeAll()
        lock.unlock()
        active.forEach { $0.cancel() }
    }
}

private func helperError(_ message: String) -> NSError {
    NSError(domain: "com.snipvia.capture-helper", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

private func currentDisplayTopologyFingerprint() -> String {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success else { return "unavailable" }
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return "unavailable" }
    return displays.prefix(Int(count)).sorted().map { displayId in
        let bounds = CGDisplayBounds(displayId)
        let origin = "\(bounds.origin.x):\(bounds.origin.y)"
        let points = "\(bounds.width):\(bounds.height)"
        let pixels = "\(CGDisplayPixelsWide(displayId)):\(CGDisplayPixelsHigh(displayId))"
        return "\(displayId):\(origin):\(points):\(pixels)"
    }.joined(separator: "|")
}

private func milliseconds(_ duration: Duration) -> Double {
    Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1_000_000_000_000_000
}

@main
private struct SnipviaCaptureHelper {
    static func main() {
        signal(SIGPIPE, SIG_IGN)
        let writer = FrameWriter()
        let coordinator = CommandCoordinator(writer: writer)
        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8) else { continue }
            do {
                coordinator.handle(try JSONDecoder().decode(Request.self, from: data))
            } catch {
                writer.send(["kind": "protocol-error", "ok": false, "error": error.localizedDescription])
            }
        }
        coordinator.cancelAll()
    }
}
