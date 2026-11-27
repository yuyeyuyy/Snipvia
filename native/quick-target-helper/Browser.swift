import AppKit
import ApplicationServices
import Carbon
import Darwin

private let chromeId = "com.google.Chrome"
private enum BrowserError: Error { case invalid, permissionRequired, chromeNotRunning, tabChanged, unavailable }
private func chromeApplications() -> [NSRunningApplication] {
  NSRunningApplication.runningApplications(withBundleIdentifier: chromeId).filter { !$0.isTerminated }
}
private func automationPermission(_ application: NSRunningApplication, _ prompt: Bool) -> OSStatus {
  let target = NSAppleEventDescriptor(processIdentifier: application.processIdentifier)
  return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, prompt)
}
private func permissionState(_ applications: [NSRunningApplication], _ status: OSStatus) -> [String: Any] {
  ["supported": true, "chromeRunning": !applications.isEmpty, "automation": status == noErr ? "granted" : status == -1743 ? "denied" : "required", "accessibility": AXIsProcessTrusted()]
}
func browserPermissions(_ request: String? = nil) -> [String: Any] {
  if request == "accessibility" { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
  let apps = chromeApplications()
  if request == "automation", let app = apps.first(where: { $0.isActive }) ?? apps.first {
    _ = automationPermission(app, true)
  }
  return permissionState(apps, aggregatePermission(apps))
}
private func aggregatePermission(_ apps: [NSRunningApplication]) -> OSStatus {
  guard !apps.isEmpty else { return OSStatus(-1744) }
  return apps.lazy.map { automationPermission($0, false) }.first { $0 != noErr } ?? noErr
}

// Fixed Apple Event terminology from Chrome's scripting dictionary.
private enum ChromeCode {
  static let window: OSType = 0x6377696e          // cwin
  static let tab: OSType = 0x43725462             // CrTb
  static let id: OSType = 0x49442020              // ID
  static let url: OSType = 0x55524c20             // URL
  static let title: OSType = 0x706e616d           // pnam
  static let mode: OSType = 0x6d6f6465            // mode
  static let minimized: OSType = 0x706d6e64       // pmnd
  static let index: OSType = 0x70696478           // pidx
  static let activeTab: OSType = 0x61635461       // acTa
  static let activeTabIndex: OSType = 0x61635449  // acTI
}
private typealias Descriptor = NSAppleEventDescriptor

private func specifier(_ desired: OSType, form: OSType, data: Descriptor, parent: Descriptor) throws -> Descriptor {
  let record = Descriptor.record()
  record.setDescriptor(Descriptor(typeCode: desired), forKeyword: AEKeyword(keyAEDesiredClass))
  record.setDescriptor(Descriptor(enumCode: form), forKeyword: AEKeyword(keyAEKeyForm))
  record.setDescriptor(data, forKeyword: AEKeyword(keyAEKeyData))
  record.setDescriptor(parent, forKeyword: AEKeyword(keyAEContainer))
  guard let object = record.coerce(toDescriptorType: DescType(typeObjectSpecifier)) else { throw BrowserError.unavailable }
  return object
}
private func item(_ kind: OSType, _ index: Int, in parent: Descriptor = .null()) throws -> Descriptor {
  try specifier(kind, form: OSType(formAbsolutePosition), data: Descriptor(int32: Int32(index)), parent: parent)
}
private func every(_ kind: OSType, in parent: Descriptor = .null()) throws -> Descriptor {
  var all = OSType(kAEAll)
  let ordinal = withUnsafeBytes(of: &all) { Descriptor(descriptorType: DescType(typeAbsoluteOrdinal), bytes: $0.baseAddress, length: $0.count) }
  guard let ordinal else { throw BrowserError.unavailable }
  return try specifier(kind, form: OSType(formAbsolutePosition), data: ordinal, parent: parent)
}
private func property(_ code: OSType, of object: Descriptor) throws -> Descriptor {
  try specifier(OSType(cProperty), form: OSType(formPropertyID), data: Descriptor(typeCode: code), parent: object)
}
private func window(_ id: Descriptor) throws -> Descriptor {
  try specifier(ChromeCode.window, form: OSType(formUniqueID), data: id, parent: .null())
}
private struct ChromeConnection {
  let app: NSRunningApplication
  let deadline: TimeInterval

  private func send(_ suite: AEEventClass, _ operation: AEEventID, object: Descriptor? = nil, data: Descriptor? = nil) throws -> Descriptor {
    let remaining = deadline - ProcessInfo.processInfo.systemUptime
    guard !app.isTerminated, remaining > 0 else { throw BrowserError.unavailable }
    let target = Descriptor(processIdentifier: app.processIdentifier)
    let event = Descriptor(eventClass: suite, eventID: operation, targetDescriptor: target,
      returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
    if let object { event.setParam(object, forKeyword: AEKeyword(keyDirectObject)) }
    if let data { event.setParam(data, forKeyword: AEKeyword(keyAEData)) }
    let reply: Descriptor
    do {
      let noPrompt = Descriptor.SendOptions(rawValue: UInt(kAEDoNotPromptForUserConsent))
      reply = try event.sendEvent(options: [.waitForReply, .neverInteract, .dontRecord, noPrompt], timeout: min(remaining, 0.75))
    } catch let error as NSError where [-1743, -1744].contains(error.code) {
      throw BrowserError.permissionRequired
    } catch {
      throw BrowserError.unavailable
    }
    switch reply.paramDescriptor(forKeyword: AEKeyword(keyErrorNumber))?.int32Value ?? 0 {
    case 0: return reply
    case -1743, -1744: throw BrowserError.permissionRequired
    case -1728, -1719: throw BrowserError.tabChanged
    default: throw BrowserError.unavailable
    }
  }
  func get(_ code: OSType, _ object: Descriptor) throws -> Descriptor {
    let reply = try send(AEEventClass(kAECoreSuite), AEEventID(kAEGetData), object: property(code, of: object))
    guard let value = reply.paramDescriptor(forKeyword: AEKeyword(keyDirectObject)) else { throw BrowserError.unavailable }
    return value
  }
  func set(_ code: OSType, _ object: Descriptor, _ value: Descriptor) throws {
    _ = try send(AEEventClass(kAECoreSuite), AEEventID(kAESetData), object: property(code, of: object), data: value)
  }
}
private struct ChromeTab {
  let browserPid: pid_t
  let windowId: String
  let tabId: String
  let url: String
  let title: String
  let index: Int

  var json: [String: Any] {
    ["browserPid": browserPid, "windowId": windowId, "tabId": tabId, "url": url, "title": title, "index": index]
  }
}

private func matchesURL(_ candidate: String, _ expected: URL, exact: Bool) -> Bool {
  guard let url = safeURL(candidate), url.scheme == expected.scheme, url.host == expected.host else { return false }
  let defaultPort = expected.scheme == "https" ? 443 : 80
  return (url.port ?? defaultPort) == (expected.port ?? defaultPort) && (!exact || candidate == expected.absoluteString)
}

private func findTabs(_ connections: [ChromeConnection], url: URL, exact: Bool) throws -> [ChromeTab] {
  var matches: [ChromeTab] = []
  var windowCount = 0
  var tabCount = 0
  for chrome in connections {
    let ids = try chrome.get(ChromeCode.id, every(ChromeCode.window))
    guard ids.descriptorType == typeAEList else { throw BrowserError.unavailable }
    windowCount += ids.numberOfItems
    guard windowCount <= 64 else { throw BrowserError.unavailable }
    for number in 0..<ids.numberOfItems {
      guard let id = ids.atIndex(number + 1), let windowId = id.stringValue else { throw BrowserError.unavailable }
      let browserWindow = try window(id)
      guard try chrome.get(ChromeCode.mode, browserWindow).stringValue == "normal" else { continue }
      let urls = try chrome.get(ChromeCode.url, every(ChromeCode.tab, in: browserWindow))
      guard urls.descriptorType == typeAEList else { throw BrowserError.unavailable }
      tabCount += urls.numberOfItems
      guard tabCount <= 2048 else { throw BrowserError.unavailable }
      for number in 0..<urls.numberOfItems {
        guard let tabURL = urls.atIndex(number + 1)?.stringValue, matchesURL(tabURL, url, exact: exact) else { continue }
        let browserTab = try item(ChromeCode.tab, number + 1, in: browserWindow)
        guard let tabId = try chrome.get(ChromeCode.id, browserTab).stringValue else { throw BrowserError.unavailable }
        guard try chrome.get(ChromeCode.url, browserTab).stringValue == tabURL else { continue }
        let title = try chrome.get(ChromeCode.title, browserTab).stringValue ?? ""
        matches.append(ChromeTab(browserPid: chrome.app.processIdentifier, windowId: windowId,
          tabId: tabId, url: tabURL, title: String(title.prefix(160)), index: number + 1))
        guard matches.count <= 32 else { throw BrowserError.unavailable }
      }
    }
  }
  return matches
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
private func focusComposer(_ url: String, in app: NSRunningApplication) -> Bool {
  guard AXIsProcessTrusted(), app.isActive,
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
  if command == "permissions" { return browserPermissions() }
  if command == "request-automation" { return browserPermissions("automation") }
  if command == "request-accessibility" { return browserPermissions("accessibility") }
  let value = try supplied ?? input()
  if command == "browser-list" || command == "browser-resolve" {
    guard let raw = value["url"] as? String, let url = safeURL(raw), let exact = value["exact"] as? Bool else { throw BrowserError.invalid }
    let apps = chromeApplications()
    let status = aggregatePermission(apps)
    var permissions = permissionState(apps, status)
    if command == "browser-resolve", apps.isEmpty || status != noErr {
      return ["kind": "unavailable", "permissions": permissions]
    }
    guard !apps.isEmpty else { throw BrowserError.chromeNotRunning }
    guard status == noErr else { throw BrowserError.permissionRequired }
    let deadline = ProcessInfo.processInfo.systemUptime + 1.8
    let connections = apps.map { ChromeConnection(app: $0, deadline: deadline) }
    let tabs = try findTabs(connections, url: url, exact: exact)
    if command == "browser-resolve" {
      guard let focus = value["focus"] as? Bool else { throw BrowserError.invalid }
      if tabs.count == 1 {
        let tab = tabs[0]
        guard let app = apps.first(where: { $0.processIdentifier == tab.browserPid }) else { throw BrowserError.tabChanged }
        let selected = try selectTab(in: app, windowId: tab.windowId, tabId: tab.tabId, url: tab.url, focus: focus)
        permissions["accessibility"] = selected["accessibility"]
        return ["kind": "activated", "permissions": permissions, "focused": selected["focused"] as? Bool ?? false]
      }
      return ["kind": "choices", "permissions": permissions, "tabs": tabs.map(\.json)]
    }
    return ["tabs": tabs.map(\.json)]
  }
  if command == "browser-select" {
    guard let pid = value["browserPid"] as? pid_t, pid > 0, let windowId = value["windowId"] as? String,
      let tabId = value["tabId"] as? String, (1...128).contains(windowId.count), (1...128).contains(tabId.count),
      let url = value["url"] as? String, safeURL(url) != nil, let focus = value["focus"] as? Bool else { throw BrowserError.invalid }
    guard let app = chromeApplications().first(where: { $0.processIdentifier == pid }) else { throw BrowserError.tabChanged }
    return try selectTab(in: app, windowId: windowId, tabId: tabId, url: url, focus: focus)
  }
  throw BrowserError.invalid
}

private func selectTab(in app: NSRunningApplication, windowId: String, tabId: String, url: String, focus: Bool) throws -> [String: Any] {
  guard automationPermission(app, false) == noErr else { throw BrowserError.permissionRequired }
  let chrome = ChromeConnection(app: app, deadline: ProcessInfo.processInfo.systemUptime + 1.3)
  let windows = try chrome.get(ChromeCode.id, every(ChromeCode.window))
  guard windows.descriptorType == typeAEList, windows.numberOfItems <= 64,
    let id = (0..<windows.numberOfItems).lazy.compactMap({ windows.atIndex($0 + 1) }).first(where: { $0.stringValue == windowId }) else { throw BrowserError.tabChanged }
  let browserWindow = try window(id)
  guard try chrome.get(ChromeCode.mode, browserWindow).stringValue == "normal" else { throw BrowserError.tabChanged }
  let ids = try chrome.get(ChromeCode.id, every(ChromeCode.tab, in: browserWindow))
  guard ids.descriptorType == typeAEList, ids.numberOfItems <= 2048,
    let index = (0..<ids.numberOfItems).first(where: { ids.atIndex($0 + 1)?.stringValue == tabId }) else { throw BrowserError.tabChanged }
  let tab = try item(ChromeCode.tab, index + 1, in: browserWindow)
  guard try chrome.get(ChromeCode.id, tab).stringValue == tabId,
    try chrome.get(ChromeCode.url, tab).stringValue == url else { throw BrowserError.tabChanged }
  try chrome.set(ChromeCode.activeTabIndex, browserWindow, Descriptor(int32: Int32(index + 1)))
  try chrome.set(ChromeCode.minimized, browserWindow, Descriptor(boolean: false))
  try chrome.set(ChromeCode.index, browserWindow, Descriptor(int32: 1))
  _ = app.activate(options: [])
  let end = Date().addingTimeInterval(0.3)
  while !app.isActive && Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
  guard app.isActive else { throw BrowserError.unavailable }
  let front = try item(ChromeCode.window, 1)
  let activeTab = try property(ChromeCode.activeTab, of: front)
  guard try chrome.get(ChromeCode.id, front).stringValue == windowId,
    try chrome.get(ChromeCode.id, activeTab).stringValue == tabId,
    try chrome.get(ChromeCode.url, activeTab).stringValue == url else { throw BrowserError.tabChanged }
  return ["activated": true, "focused": focus && focusComposer(url, in: app), "accessibility": AXIsProcessTrusted()]
}

func runBrowserServer() throws {
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
