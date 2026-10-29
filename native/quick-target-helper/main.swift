import AppKit
import Foundation

// Application activation and opt-in Chrome automation run separately from capture.
enum TargetError: Error { case invalid, notRunning, openFailed, notActive }
func application(_ path: String) throws -> (URL, Bundle) {
  let url = URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL
  guard url.pathExtension.lowercased() == "app", let bundle = Bundle(url: url),
    let identifier = bundle.bundleIdentifier, !identifier.isEmpty,
    bundle.executableURL != nil else { throw TargetError.invalid }
  return (url, bundle)
}
func emit(_ value: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: value) { FileHandle.standardOutput.write(data) }
}
func applicationIcon(_ url: URL) throws -> String {
  // Render the real bundle artwork at 2x without decoding an unbounded source image.
  guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 68, pixelsHigh: 68,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
    let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw TargetError.invalid }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  NSWorkspace.shared.icon(forFile: url.path).draw(in: NSRect(x: 0, y: 0, width: 68, height: 68),
    from: .zero, operation: .copy, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]), png.count <= 32768 else { throw TargetError.invalid }
  return "data:image/png;base64," + png.base64EncodedString()
}
let args = CommandLine.arguments
do {
  if args.count == 3, args[1] == "browser-icon", ["chrome", "default", "http"].contains(args[2]) {
    let url = args[2] == "chrome" ? NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome")
      : NSWorkspace.shared.urlForApplication(toOpen: URL(string: args[2] == "http" ? "http://example.invalid/" : "https://example.invalid/")!)
    if let url { emit(["icon": try applicationIcon(url)]) } else { emit(["icon": NSNull()]) }
    exit(0)
  }
  if args.count == 2, args[1] == "browser-server" {
    _ = NSApplication.shared
    NSApplication.shared.setActivationPolicy(.prohibited)
    try runBrowserServer(); exit(0)
  }
  if args.count == 2, ["browser-script-check", "permissions", "request-automation", "request-accessibility", "browser-list", "browser-select", "browser-resolve"].contains(args[1]) {
    _ = NSApplication.shared
    NSApplication.shared.setActivationPolicy(.prohibited)
    emit(try browserCommand(args[1])); exit(0)
  }
  guard args.count >= 3 else { throw TargetError.invalid }
  if ["activate", "status"].contains(args[1]) {
    _ = NSApplication.shared
    NSApplication.shared.setActivationPolicy(.prohibited)
  }
  let (url, bundle) = try application(args[2])
  switch args[1] {
  case "icon":
    guard args.count == 3 else { throw TargetError.invalid }
    emit(["icon": try applicationIcon(url)])
  case "describe":
    guard args.count == 3 else { throw TargetError.invalid }
    emit(["path": url.path, "bundleId": bundle.bundleIdentifier!,
      "label": bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ?? url.deletingPathExtension().lastPathComponent,
      "version": bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""])
  case "status":
    guard args.count == 3 else { throw TargetError.invalid }
    let existing = NSWorkspace.shared.runningApplications.first {
      $0.bundleIdentifier == bundle.bundleIdentifier && $0.bundleURL?.resolvingSymlinksInPath().standardizedFileURL == url && !$0.isTerminated
    }
    emit(["running": existing != nil, "active": existing?.isActive ?? false])
  case "activate":
    guard args.count == 5, args[3] == bundle.bundleIdentifier, ["true", "false"].contains(args[4]) else { throw TargetError.invalid }
    let running = NSWorkspace.shared.runningApplications.first {
      $0.bundleIdentifier == args[3] && $0.bundleURL?.resolvingSymlinksInPath().standardizedFileURL == url && !$0.isTerminated
    }
    guard running != nil || args[4] == "true" else { throw TargetError.notRunning }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    configuration.addsToRecentItems = false
    configuration.createsNewApplicationInstance = false
    var completed = false
    var activated: NSRunningApplication?
    if let existing = running {
      _ = existing.activate(options: [])
      activated = existing
      completed = true
    } else {
      NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
        if error == nil { activated = app }
        completed = true
      }
    }
    let deadline = Date().addingTimeInterval(3)
    while !completed && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
    guard let target = activated, target.bundleIdentifier == args[3],
      target.bundleURL?.resolvingSymlinksInPath().standardizedFileURL == url else { throw TargetError.openFailed }
    while !target.isActive && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
    guard target.isActive else { throw TargetError.notActive }
    emit(["activated": true])
  default: throw TargetError.invalid
  }
} catch { FileHandle.standardError.write(Data(String(describing: error).utf8)); exit(1) }
