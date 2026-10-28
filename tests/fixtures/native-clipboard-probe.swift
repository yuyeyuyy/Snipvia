import AppKit
import CryptoKit
import Foundation

// Opt-in test only. Original clipboard formats stay in memory and are never logged.
@main
struct ClipboardProbe {
  static func main() {
    let board = NSPasteboard.general, args = CommandLine.arguments
    let marker = NSPasteboard.PasteboardType("org.snipvia.clipboard-test")
    var saved: [[NSPasteboard.PasteboardType: Data]] = [], total = 0
    let initialChange = board.changeCount
    var exitCode: Int32 = 0
    do {
      for item in board.pasteboardItems ?? [] {
        var values: [NSPasteboard.PasteboardType: Data] = [:]
        for type in item.types {
          guard let data = item.data(forType: type) else { throw Failure() }
          total += data.count
          guard total <= 64 * 1024 * 1024 else { throw Failure() }
          values[type] = data
        }
        saved.append(values)
      }
      guard board.changeCount == initialChange else { throw Failure() }
      let token = args[3], child = Process(), output = Pipe(), input = Pipe()
      child.executableURL = URL(fileURLWithPath: args[1])
      child.arguments = [args[2], args[4], token]
      var environment = ProcessInfo.processInfo.environment
      environment.removeValue(forKey: "ELECTRON_RUN_AS_NODE")
      child.environment = environment
      child.standardOutput = output; child.standardInput = input
      child.standardError = FileHandle.nullDevice
      var restored = false
      defer {
        if child.isRunning { child.terminate(); child.waitUntilExit() }
        if board.string(forType: marker) == token {
          let count = board.changeCount
          let originals = saved.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
          }
          if board.changeCount == count {
            board.clearContents()
            restored = originals.isEmpty || board.writeObjects(originals)
            let actual = board.pasteboardItems ?? []
            restored = restored && actual.count == saved.count
            if restored {
              for (index, values) in saved.enumerated() {
                for (type, data) in values where actual[index].data(forType: type) != data { restored = false }
              }
            }
          }
        } else {
          // An external copy wins; never replace it with the old snapshot.
          restored = board.changeCount == initialChange
        }
        print("{\"clipboardRestored\":\(restored)}")
      }
      try child.run()
      DispatchQueue.global().asyncAfter(deadline: .now() + 25) { if child.isRunning { child.terminate() } }
      func line() throws -> [String: Any] {
        var bytes = Data()
        while let data = try output.fileHandleForReading.read(upToCount: 1), !data.isEmpty {
          if data == Data([10]) { break }
          bytes.append(data)
          guard bytes.count < 65536 else { throw Failure() }
        }
        guard let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw Failure() }
        return value
      }
      guard try line()["ready"] as? Bool == true, board.changeCount == initialChange else { throw Failure() }
      try input.fileHandleForWriting.write(contentsOf: Data("copy\n".utf8))
      let result = try line()
      guard let paths = result["paths"] as? [String], let hashes = result["hashes"] as? [String], paths.count == 3 else { throw Failure() }
      try input.fileHandleForWriting.write(contentsOf: Data("finish\n".utf8))
      child.waitUntilExit()
      guard child.terminationStatus == 0, board.string(forType: marker) == token else { throw Failure() }
      let native = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
      guard native.map(\.path) == paths else { throw Failure() }
      let received = URL(fileURLWithPath: args[4]).appendingPathComponent("received")
      try FileManager.default.createDirectory(at: received, withIntermediateDirectories: true)
      for (index, file) in native.enumerated() {
        let target = received.appendingPathComponent(file.lastPathComponent)
        try FileManager.default.copyItem(at: file, to: target)
        let hash = SHA256.hash(data: try Data(contentsOf: target)).map { String(format: "%02x", $0) }.joined()
        guard hash == hashes[index] else { throw Failure() }
      }
      print("{\"nativeFiles\":3,\"originalBytesMatch\":true,\"usableAfterSourceExit\":true}")
    } catch {
      print("{\"failed\":true}")
      exitCode = 1
    }
    if exitCode != 0 { exit(exitCode) }
  }
  struct Failure: Error {}
}
