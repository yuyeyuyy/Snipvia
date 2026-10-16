import CoreGraphics
import CoreVideo
import Foundation
import ScreenCaptureKit

struct CaptureResult: Codable {
    let excluded: Bool
    let durationMs: Double
    let width: Int
    let height: Int
    let markerPixels: Int
}

struct BenchmarkResult: Codable {
    let supported: Bool
    let shareableContentMs: Double
    let displayCount: Int
    let applicationCount: Int
    let excludedProcessFound: Bool
    let excludedApplicationName: String?
    let excludedBundleIdentifier: String?
    let captures: [CaptureResult]
}

@available(macOS 14.0, *)
func countMarkerPixels(in image: CGImage) -> Int {
    let bytesPerRow = image.width * 4
    var pixels = [UInt8](repeating: 0, count: bytesPerRow * image.height)
    guard let context = CGContext(
        data: &pixels,
        width: image.width,
        height: image.height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else { return -1 }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    var count = 0
    for y in stride(from: 0, to: image.height, by: 8) {
        for x in stride(from: 0, to: image.width, by: 8) {
            let offset = y * bytesPerRow + x * 4
            let blue = Int(pixels[offset])
            let green = Int(pixels[offset + 1])
            let red = Int(pixels[offset + 2])
            if abs(red - 253) <= 10 && abs(green - 1) <= 10 && abs(blue - 197) <= 10 { count += 1 }
        }
    }
    return count
}

@available(macOS 14.0, *)
func capture(display: SCDisplay, excluding application: SCRunningApplication?, excluded: Bool) async throws -> CaptureResult {
    let filter = SCContentFilter(
        display: display,
        excludingApplications: excluded ? [application].compactMap { $0 } : [],
        exceptingWindows: []
    )
    let configuration = SCStreamConfiguration()
    let scale = max(1, Int(filter.pointPixelScale.rounded()))
    configuration.width = display.width * scale
    configuration.height = display.height * scale
    configuration.scalesToFit = false
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.showsCursor = false
    configuration.queueDepth = 1
    let startedAt = ContinuousClock.now
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    let elapsed = startedAt.duration(to: ContinuousClock.now)
    return CaptureResult(
        excluded: excluded,
        durationMs: Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1_000_000_000_000_000,
        width: image.width,
        height: image.height,
        markerPixels: countMarkerPixels(in: image)
    )
}

@main
struct Phase4ScreenCaptureKitBenchmark {
    static func main() async {
        guard #available(macOS 14.0, *) else {
            print("{\"supported\":false,\"error\":\"SCScreenshotManager requires macOS 14 or later\"}")
            return
        }
        do {
            let excludedPID = CommandLine.arguments.dropFirst().first.flatMap(Int32.init) ?? -1
            let contentStartedAt = ContinuousClock.now
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            let contentElapsed = contentStartedAt.duration(to: ContinuousClock.now)
            guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else {
                throw NSError(domain: "SnipviaPhase4", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display available"])
            }
            let application = content.applications.first(where: { $0.processID == excludedPID })
            var captures: [CaptureResult] = []
            for _ in 0..<10 { captures.append(try await capture(display: display, excluding: application, excluded: false)) }
            for _ in 0..<10 { captures.append(try await capture(display: display, excluding: application, excluded: true)) }
            let result = BenchmarkResult(
                supported: true,
                shareableContentMs: Double(contentElapsed.components.seconds) * 1000 + Double(contentElapsed.components.attoseconds) / 1_000_000_000_000_000,
                displayCount: content.displays.count,
                applicationCount: content.applications.count,
                excludedProcessFound: application != nil,
                excludedApplicationName: application?.applicationName,
                excludedBundleIdentifier: application?.bundleIdentifier,
                captures: captures
            )
            let data = try JSONEncoder().encode(result)
            print(String(decoding: data, as: UTF8.self))
        } catch {
            let object: [String: Any] = ["supported": false, "error": error.localizedDescription]
            let data = try! JSONSerialization.data(withJSONObject: object)
            print(String(decoding: data, as: UTF8.self))
        }
    }
}
