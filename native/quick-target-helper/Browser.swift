import AppKit
import ApplicationServices
import Carbon
import Darwin

private let chromeId = "com.google.Chrome"
private enum BrowserError: Error { case invalid, permissionRequired, chromeNotRunning, tabChanged, unavailable }
private func chrome() -> NSRunningApplication? {
  NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == chromeId && !$0.isTerminated }
}
private func automationPermission(_ prompt: Bool) -> OSStatus {
  let target = NSAppleEventDescriptor(bundleIdentifier: chromeId)
  return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, prompt)
}
func browserPermissions(_ request: String? = nil) -> [String: Any] {
  let running = chrome() != nil
  if request == "accessibility" { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
  let status = running ? automationPermission(request == "automation") : OSStatus(-1744)
  return ["supported": true, "chromeRunning": running, "automation": status == noErr ? "granted" : status == -1743 ? "denied" : "required", "accessibility": AXIsProcessTrusted()]
}

// Static source only. URLs and IDs are Apple Event parameters, never executable script text.
private let browserScript = """
on snipviaTabs(baseURL, exactMatch)
  set foundTabs to {}
  set visited to 0
  if application id "com.google.Chrome" is not running then error "notRunning"
  tell application id "com.google.Chrome"
    if (count of windows) > 64 then error "limit"
    repeat with browserWindow in windows
      if mode of browserWindow is "normal" then
        set visited to visited + (count of tabs of browserWindow)
        if visited > 2048 then error "limit"
        set tabURLs to URL of tabs of browserWindow
        repeat with tabNumber from 1 to count of tabURLs
          set tabURL to item tabNumber of tabURLs
          set matchesURL to false
          considering case
            if exactMatch then
              set matchesURL to tabURL is baseURL
            else
              set matchesURL to tabURL starts with baseURL
            end if
          end considering
          if matchesURL then
            set browserTab to tab tabNumber of browserWindow
            set tabURL to URL of browserTab
            set end of foundTabs to {(id of browserWindow as text), (id of browserTab as text), tabURL, (title of browserTab), tabNumber}
            if (count of foundTabs) > 32 then error "limit"
          end if
        end repeat
      end if
    end repeat
  end tell
  return foundTabs
end snipviaTabs
on snipviaSelect(windowID, tabID, expectedURL)
  if application id "com.google.Chrome" is not running then error "notRunning"
  tell application id "com.google.Chrome"
    repeat with browserWindow in windows
      if (id of browserWindow as text) is windowID and mode of browserWindow is "normal" then
        set tabIDs to id of tabs of browserWindow
        repeat with tabNumber from 1 to count of tabIDs
          if (item tabNumber of tabIDs as text) is tabID then
            set browserTab to tab tabNumber of browserWindow
            if (id of browserTab as text) is not tabID then error "changed"
            considering case
              if (URL of browserTab) is not expectedURL then error "changed"
            end considering
            set active tab index of browserWindow to tabNumber
            set minimized of browserWindow to false
            set index of browserWindow to 1
            activate
            if (id of front window as text) is not windowID then error "changed"
            return {(id of active tab of front window as text), (URL of active tab of front window)}
          end if
        end repeat
      end if
    end repeat
  end tell
  error "changed"
end snipviaSelect
"""
private var compiledBrowserScript: NSAppleScript?
private func callBrowser(_ handler: String, _ parameters: [NSAppleEventDescriptor]) throws -> NSAppleEventDescriptor {
  guard chrome() != nil else { throw BrowserError.chromeNotRunning }
  guard automationPermission(false) == noErr else { throw BrowserError.permissionRequired }
  if compiledBrowserScript == nil { compiledBrowserScript = NSAppleScript(source: browserScript) }
  guard let script = compiledBrowserScript else { throw BrowserError.unavailable }
  let event = NSAppleEventDescriptor(eventClass: AEEventClass(kASAppleScriptSuite), eventID: AEEventID(kASSubroutineEvent), targetDescriptor: nil, returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
  event.setParam(NSAppleEventDescriptor(string: handler), forKeyword: AEKeyword(keyASSubroutineName))
  let args = NSAppleEventDescriptor.list()
  for (index, parameter) in parameters.enumerated() { args.insert(parameter, at: index + 1) }
  event.setParam(args, forKeyword: AEKeyword(keyDirectObject))
  var error: NSDictionary?
  let result = script.executeAppleEvent(event, error: &error)
  // Never expose script errors: they may include URLs or unrelated browser data.
  guard error == nil else { throw BrowserError.tabChanged }
  return result
}
private func input() throws -> [String: Any] {
  let data = FileHandle.standardInput.readData(ofLength: 8193)
  guard data.count <= 8192, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw BrowserError.invalid }
  return value
}
private func safeURL(_ value: String) -> URL? {
  guard value.utf8.count <= 4096, let url = URL(string: value), ["http", "https"].contains(url.scheme), url.host != nil, url.user == nil, url.password == nil else { return nil }
  return url
}
private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
private func elements(_ value: CFTypeRef?) -> [AXUIElement] { value as? [AXUIElement] ?? [] }
private func sameURL(_ element: AXUIElement, _ expected: String) -> Bool {
  guard let value = attribute(element, "AXURL") else { return false }
  if let url = value as? URL { return url.absoluteString == expected }
  return (value as? String) == expected
}
private func frame(_ element: AXUIElement) -> CGRect? {
  guard let position = attribute(element, "AXPosition"), let size = attribute(element, "AXSize"),
    CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
  var point = CGPoint.zero, dimensions = CGSize.zero
  guard AXValueGetValue(unsafeBitCast(position, to: AXValue.self), .cgPoint, &point),
    AXValueGetValue(unsafeBitCast(size, to: AXValue.self), .cgSize, &dimensions),
    point.x.isFinite, point.y.isFinite, dimensions.width.isFinite, dimensions.height.isFinite,
    dimensions.width > 10, dimensions.height > 10 else { return nil }
  return CGRect(origin: point, size: dimensions)
}
// Read roles/geometry only; never read AXValue, draft text, message bodies, or set text.
private func focusComposer(_ url: String) -> Bool {
  guard AXIsProcessTrusted(), let app = chrome(), app.isActive,
    let host = URL(string: url)?.host, ["chatgpt.com", "chat.deepseek.com"].contains(host) else { return false }
  let application = AXUIElementCreateApplication(app.processIdentifier)
  AXUIElementSetMessagingTimeout(application, 0.06)
  guard let focusedWindow = attribute(application, "AXFocusedWindow"), CFGetTypeID(focusedWindow) == AXUIElementGetTypeID() else { return false }
  let window = unsafeBitCast(focusedWindow, to: AXUIElement.self)
  let deadline = Date().addingTimeInterval(0.8)
  var visited = 0
  var exhausted = false
  func walk(_ root: AXUIElement, _ depth: Int, _ visit: (AXUIElement) -> Bool) {
    if depth > 48 || visited >= 1400 || Date() >= deadline { exhausted = true; return }
    visited += 1
    AXUIElementSetMessagingTimeout(root, 0.06)
    if !visit(root) { return }
    for child in elements(attribute(root, "AXChildren")) { if exhausted { break }; walk(child, depth + 1, visit) }
  }
  var areas: [AXUIElement] = []
  walk(window, 0) { element in
    if (attribute(element, "AXRole") as? String) == "AXWebArea" { if sameURL(element, url) { areas.append(element) }; return false }
    return true
  }
  guard !exhausted, areas.count == 1, let windowFrame = frame(window), let areaFrame = frame(areas[0]) else { return false }
  let viewport = windowFrame.intersection(areaFrame)
  var candidates: [AXUIElement] = []
  walk(areas[0], 0) { element in
    guard (attribute(element, "AXRole") as? String) == "AXTextArea" else { return true }
    var writable = DarwinBoolean(false), focusable = DarwinBoolean(false)
    guard (attribute(element, "AXEnabled") as? Bool) == true,
      (attribute(element, "AXSubrole") as? String) != "AXSecureTextField",
      AXUIElementIsAttributeSettable(element, "AXValue" as CFString, &writable) == .success, writable.boolValue,
      AXUIElementIsAttributeSettable(element, "AXFocused" as CFString, &focusable) == .success, focusable.boolValue else { return false }
    guard let bounds = frame(element), bounds.intersects(viewport), bounds.intersection(viewport).height > 10 else { return false }
    candidates.append(element)
    return false
  }
  guard !exhausted, Date() < deadline, candidates.count == 1, app.isActive, sameURL(areas[0], url) else { return false }
  return AXUIElementSetAttributeValue(candidates[0], "AXFocused" as CFString, kCFBooleanTrue) == .success && (attribute(candidates[0], "AXFocused") as? Bool) == true && app.isActive
}
func browserCommand(_ command: String, supplied: [String: Any]? = nil) throws -> [String: Any] {
  if command == "browser-script-check" {
    var error: NSDictionary?
    guard let script = NSAppleScript(source: browserScript), script.compileAndReturnError(&error), error == nil else { throw BrowserError.unavailable }
    return ["compiled": true]
  }
  if command == "permissions" { return browserPermissions() }
  if command == "request-automation" { return browserPermissions("automation") }
  if command == "request-accessibility" { return browserPermissions("accessibility") }
  let value = try supplied ?? input()
  if command == "browser-list" || command == "browser-resolve" {
    var permissions = browserPermissions()
    if command == "browser-resolve", permissions["chromeRunning"] as? Bool != true || permissions["automation"] as? String != "granted" { return ["kind": "unavailable", "permissions": permissions] }
    guard let raw = value["url"] as? String, let url = safeURL(raw), let exact = value["exact"] as? Bool else { throw BrowserError.invalid }
    let base = exact ? raw : "\(url.scheme!)://\(url.host!)" + (url.port.map { ":\($0)" } ?? "") + "/"
    let result = try callBrowser("snipviaTabs", [NSAppleEventDescriptor(string: base), NSAppleEventDescriptor(boolean: exact)])
    guard result.numberOfItems <= 32 else { throw BrowserError.unavailable }
    var tabs: [[String: Any]] = []
    if result.numberOfItems > 0 { for index in 1...result.numberOfItems {
      guard let row = result.atIndex(index), row.numberOfItems == 5, let windowId = row.atIndex(1)?.stringValue,
        let tabId = row.atIndex(2)?.stringValue, let tabURL = row.atIndex(3)?.stringValue, safeURL(tabURL) != nil else { throw BrowserError.unavailable }
      guard let candidate = safeURL(tabURL), candidate.scheme == url.scheme, candidate.host == url.host, candidate.port == url.port,
        !exact || tabURL == raw else { continue }
      tabs.append(["windowId": windowId, "tabId": tabId, "url": tabURL, "title": String((row.atIndex(4)?.stringValue ?? "").prefix(160)), "index": row.atIndex(5)?.int32Value ?? 0])
    } }
    if command == "browser-resolve" {
      guard let focus = value["focus"] as? Bool else { throw BrowserError.invalid }
      if tabs.count == 1 {
        guard let window = tabs[0]["windowId"] as? String, let tab = tabs[0]["tabId"] as? String, let address = tabs[0]["url"] as? String else { throw BrowserError.invalid }
        let selected = try selectTab(window, tab, address, focus)
        permissions["accessibility"] = selected["accessibility"]
        return ["kind": "activated", "permissions": permissions, "focused": selected["focused"] as? Bool ?? false]
      }
      return ["kind": "choices", "permissions": permissions, "tabs": tabs]
    }
    return ["tabs": tabs]
  }
  if command == "browser-select" {
    guard let window = value["windowId"] as? String, let tab = value["tabId"] as? String,
      window.count <= 128, tab.count <= 128, let url = value["url"] as? String, safeURL(url) != nil,
      let focus = value["focus"] as? Bool else { throw BrowserError.invalid }
    return try selectTab(window, tab, url, focus)
  }
  throw BrowserError.invalid
}

private func selectTab(_ window: String, _ tab: String, _ url: String, _ focus: Bool) throws -> [String: Any] {
  let result = try callBrowser("snipviaSelect", [NSAppleEventDescriptor(string: window), NSAppleEventDescriptor(string: tab), NSAppleEventDescriptor(string: url)])
  guard result.atIndex(1)?.stringValue == tab, result.atIndex(2)?.stringValue == url else { throw BrowserError.tabChanged }
  let end = Date().addingTimeInterval(0.3)
  while chrome()?.isActive != true && Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
  guard chrome()?.isActive == true else { throw BrowserError.unavailable }
  return ["activated": true, "focused": focus && focusComposer(url), "accessibility": AXIsProcessTrusted()]
}

func runBrowserServer() throws {
  guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: chromeId) != nil else { throw BrowserError.chromeNotRunning }
  compiledBrowserScript = NSAppleScript(source: browserScript)
  var error: NSDictionary?
  guard compiledBrowserScript?.compileAndReturnError(&error) == true, error == nil else { throw BrowserError.unavailable }
  func line(_ value: [String: Any]) { emit(value); FileHandle.standardOutput.write(Data([10])) }
  line(["ready": true])
  var buffer = Data()
  var chunk = [UInt8](repeating: 0, count: 1024)
  while true {
    let count = chunk.withUnsafeMutableBytes { Darwin.read(STDIN_FILENO, $0.baseAddress, $0.count) }
    if count == 0 { return }
    if count < 0 { if errno == EINTR { continue }; throw BrowserError.unavailable }
    buffer.append(contentsOf: chunk.prefix(count))
    while let end = buffer.firstIndex(of: 10) {
      let bytes = buffer[..<end]
      guard bytes.count <= 8192, let request = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
        Set(request.keys) == Set(["id", "command", "input"]), let id = request["id"] as? String, UUID(uuidString: id) != nil,
        let command = request["command"] as? String, ["browser-resolve", "browser-select"].contains(command),
        let input = request["input"] as? [String: Any] else { throw BrowserError.invalid }
      buffer.removeSubrange(...end)
      autoreleasepool {
        do { line(["id": id, "ok": true, "value": try browserCommand(command, supplied: input)]) }
        catch {
          let safe = error as? BrowserError ?? .unavailable
          line(["id": id, "ok": false, "error": String(describing: safe)])
        }
      }
    }
    guard buffer.count <= 8192 else { throw BrowserError.invalid }
  }
}
