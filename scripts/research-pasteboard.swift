// Research only. Uses a private named pasteboard; never reads/writes the user's general pasteboard.
import AppKit
let board = NSPasteboard(name: NSPasteboard.Name("snipvia-research-" + UUID().uuidString))
defer { board.releaseGlobally() }
func image(_ color: NSColor) -> NSImage {
  let image = NSImage(size: NSSize(width: 16, height: 16))
  image.lockFocus(); color.setFill(); NSRect(x: 0, y: 0, width: 16, height: 16).fill(); image.unlockFocus()
  return image
}
let success = board.writeObjects([image(.red), image(.blue)])
let count = board.pasteboardItems?.count ?? 0
print("{\"privateNamedPasteboard\":true,\"writeSucceeded\":\(success),\"nativeItemCount\":\(count),\"targetApplicationPasteTested\":false}")
if !success || count != 2 { exit(1) }
