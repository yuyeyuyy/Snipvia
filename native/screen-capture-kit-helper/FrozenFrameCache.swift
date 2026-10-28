import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

final class FrozenCaptureFrame: @unchecked Sendable {
    let image: CGImage
    init(_ image: CGImage) { self.image = image }
    func png(x: Int, y: Int, width: Int, height: Int) throws -> Data {
        guard x >= 0, y >= 0, width > 0, height > 0, width <= image.width, height <= image.height,
              x <= image.width - width, y <= image.height - height,
              let crop = image.cropping(to: CGRect(x: x, y: y, width: width, height: height)) else {
            throw frameError("Invalid frozen-frame crop")
        }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
            throw frameError("PNG encoder is unavailable")
        }
        CGImageDestinationAddImage(destination, crop, nil)
        guard CGImageDestinationFinalize(destination), data.length <= 64 * 1024 * 1024 else {
            throw frameError("PNG encoding failed or exceeded 64 MiB")
        }
        return data as Data
    }
}

/// Immutable images have explicit ownership; output encoding never occupies CaptureService's actor.
final class FrozenFrameCache: @unchecked Sendable {
    private struct Entry { let session: String; let frame: FrozenCaptureFrame; let bytes: Int }
    private let lock = NSLock()
    private var entries: [String: Entry] = [:]
    private var bytes = 0
    private let maxFrames: Int
    private let maxBytes: Int
    init(maxFrames: Int = 4, maxBytes: Int = 256 * 1024 * 1024) { self.maxFrames = maxFrames; self.maxBytes = maxBytes }
    func insert(_ image: CGImage, session: String) throws -> String {
        let cost = image.width * image.height * 4
        lock.lock(); defer { lock.unlock() }
        guard cost > 0, cost <= 128 * 1024 * 1024, entries.count < maxFrames, cost <= maxBytes - bytes else {
            throw frameError("Frozen-frame cache is full")
        }
        let token = UUID().uuidString
        entries[token] = Entry(session: session, frame: FrozenCaptureFrame(image), bytes: cost); bytes += cost
        return token
    }
    func frame(_ token: String, session: String) throws -> FrozenCaptureFrame {
        lock.lock(); defer { lock.unlock() }
        guard let entry = entries[token], entry.session == session else { throw frameError("Frozen frame has expired") }
        return entry.frame
    }
    func release(_ token: String, session: String) {
        lock.lock(); defer { lock.unlock() }
        guard let entry = entries[token], entry.session == session else { return }
        entries.removeValue(forKey: token); bytes -= entry.bytes
    }
    var count: Int { lock.lock(); defer { lock.unlock() }; return entries.count }
}
private func frameError(_ message: String) -> NSError {
    NSError(domain: "com.snipvia.capture-helper.frame", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
