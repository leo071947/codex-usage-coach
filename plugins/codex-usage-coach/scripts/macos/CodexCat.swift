import AppKit
import ApplicationServices
import Darwin

// AppKit coordinates are points, independent of the display's Retina scale.
struct Timeline {
    var frame = 1, direction = 1
    var position = 0.0, accumulator = 0.0
    var edge = false
    var walking: Bool { (18...111).contains(frame) }
    mutating func advance(_ elapsed: Double, width: Double) {
        accumulator += min(0.25, max(0, elapsed))
        let step = 1.0 / 12
        while accumulator >= step {
            accumulator -= step; frame = frame % 121 + 1
            if frame == 18 && edge { direction = -direction; edge = false }
            if walking && !edge {
                position += Double(direction) * 42 * step
                if position >= width { position = width; edge = true; frame = 112 }
                if position <= 0 { position = 0; edge = true; frame = 112 }
            }
        }
    }
}

struct Usage: Decodable {
    struct Quota: Decodable { var remainingPct: Double?; var resetsText: String? }
    struct Today: Decodable { var remainingText: String?; var usedText: String? }
    struct Feed: Decodable { var error: String? }
    var weekly: Quota?, fiveHour: Quota?, today: Today?, feed: Feed?
    var account: String?, stale: Bool?
    static let empty = Usage()
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func axRect(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute), let s = attribute(element, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}

final class AnchorReader {
    private let queue = DispatchQueue(label: "codex.cat.accessibility")
    private var busy = false
    private var last = 0.0
    func poll(pid: pid_t, primaryTop: CGFloat, completion: @escaping (CGRect?) -> Void) {
        let now = ProcessInfo.processInfo.systemUptime
        guard !busy && now - last >= 0.7 else { return }
        busy = true; last = now
        queue.async {
            let app = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(app, 0.15)
            var result: CGRect?
            if let windowValue = attribute(app, kAXFocusedWindowAttribute), CFGetTypeID(windowValue) == AXUIElementGetTypeID() {
                let window = windowValue as! AXUIElement
                let minimized = attribute(window, kAXMinimizedAttribute) as? Bool ?? false
                if !minimized, let windowRect = axRect(window) {
                    var visited = 0; var bestScore = -Double.infinity
                    let deadline = ProcessInfo.processInfo.systemUptime + 0.55
                    func visit(_ element: AXUIElement, depth: Int) {
                        guard depth < 16, visited < 1200, ProcessInfo.processInfo.systemUptime < deadline else { return }
                        visited += 1
                        let role = attribute(element, kAXRoleAttribute) as? String ?? ""
                        if role == kAXTextAreaRole || role == kAXTextFieldRole {
                            // Read metadata and geometry only, never kAXValueAttribute.
                            let enabled = attribute(element, kAXEnabledAttribute) as? Bool ?? true
                            if enabled, let rect = axRect(element), rect.width > 180, rect.height >= 18,
                               rect.height < windowRect.height * 0.4, rect.minY > windowRect.minY + windowRect.height * 0.45,
                               windowRect.intersects(rect) {
                                let label = ((attribute(element, kAXDescriptionAttribute) as? String ?? "") + " " + (attribute(element, kAXTitleAttribute) as? String ?? "")).lowercased()
                                let named = ["message", "prompt", "codex", "输入", "消息"].contains { label.contains($0) }
                                let score = Double(rect.minY) + Double(rect.width) * 0.1 + (named ? 10000 : 0)
                                if score > bestScore { bestScore = score; result = rect }
                            }
                        }
                        if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
                            for child in children { visit(child, depth: depth + 1) }
                        }
                    }
                    visit(window, depth: 0)
                }
            }
            let found = result.map { CGRect(x: $0.minX, y: primaryTop - $0.maxY, width: $0.width, height: $0.height) }
            DispatchQueue.main.async { self.busy = false; completion(found) }
        }
    }
}

final class CompanionPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    init(size: NSSize) {
        super.init(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false; backgroundColor = .clear; hasShadow = false
        level = .normal; hidesOnDeactivate = false; isFloatingPanel = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isReleasedWhenClosed = false
    }
}

func text(_ string: String, rect: NSRect, size: CGFloat, color: NSColor, bold: Bool = false) {
    let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
    let font = NSFont.monospacedSystemFont(ofSize: size, weight: bold ? .bold : .regular)
    (string as NSString).draw(in: rect, withAttributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
}
func percent(_ value: Double?) -> String { value.map { String(format: "%.0f%%", $0) } ?? "—" }

final class CatView: NSView {
    weak var owner: CatApp?
    var tracking: NSTrackingArea?
    var down = NSPoint.zero, windowStart = NSPoint.zero, dragged = false
    override var isFlipped: Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking = tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.activeAlways, .mouseEnteredAndExited], owner: self)
        addTrackingArea(area); tracking = area
    }
    override func mouseEntered(with event: NSEvent) { owner?.hovering = true }
    override func mouseExited(with event: NSEvent) { owner?.hovering = false }
    override func mouseDown(with event: NSEvent) { down = NSEvent.mouseLocation; windowStart = window?.frame.origin ?? .zero; dragged = false }
    override func mouseDragged(with event: NSEvent) {
        let current = NSEvent.mouseLocation
        if hypot(current.x - down.x, current.y - down.y) > 3 { dragged = true; owner?.manualPosition = true }
        if dragged { window?.setFrameOrigin(NSPoint(x: windowStart.x + current.x - down.x, y: windowStart.y + current.y - down.y)) }
    }
    override func mouseUp(with event: NSEvent) { if !dragged { owner?.toggleDetails() } }
    override func rightMouseDown(with event: NSEvent) {
        owner?.menuOpen = true
        defer { owner?.menuOpen = false }
        if let menu = owner?.makeMenu() { NSMenu.popUpContextMenu(menu, with: event, for: self) }
    }
    override func draw(_ dirtyRect: NSRect) {
        guard let owner = owner, !owner.frames.isEmpty else { return }
        NSGraphicsContext.current?.imageInterpolation = .none
        NSGraphicsContext.saveGraphicsState()
        if owner.timeline.direction < 0 { let transform = NSAffineTransform(); transform.translateX(by: 104, yBy: 0); transform.scaleX(by: -1, yBy: 1); transform.concat() }
        owner.frames[owner.timeline.frame - 1].draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        NSGraphicsContext.restoreGraphicsState()
    }
}

final class BubbleView: NSView {
    weak var owner: CatApp?
    override var isFlipped: Bool { true }
    override func mouseDown(with event: NSEvent) { owner?.toggleDetails() }
    func orb(center: NSPoint, label: String, quota: Double?, tint: NSColor, age: Double, animate: Bool) {
        guard !animate || (age > 0 && age < 3) else { return }
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        if animate && age >= 2.4 {
            let progress = (age - 2.4) / 0.6
            tint.withAlphaComponent(1 - progress).setFill()
            for index in 0..<9 {
                let angle = Double(index) * .pi * 2 / 9
                let radius = 27 + 18 * progress
                NSRect(x: center.x + cos(angle) * radius, y: center.y + sin(angle) * radius, width: 4 - 2 * progress, height: 4 - 2 * progress).fill()
            }
            return
        }
        let t = animate ? min(1, age / 2.4) : 1
        let scale = animate ? pow(t, 0.85) : 1
        let origin = owner?.bubbleOriginX ?? bounds.midX
        let x = animate ? origin + (center.x - origin) * t : center.x
        let y = animate ? 156 + (center.y - 156) * t : center.y
        context.saveGState(); defer { context.restoreGState() }
        context.translateBy(x: x, y: y); context.scaleBy(x: scale, y: scale)
        context.setShouldAntialias(false)
        var points: [NSPoint] = []
        for row in stride(from: -32, to: 32, by: 4) {
            let middle = Double(row + 2), half = floor(sqrt(1089 - middle * middle) / 4) * 4
            points.append(NSPoint(x: half, y: Double(row))); points.append(NSPoint(x: half, y: Double(row + 4)))
        }
        for row in stride(from: 28, through: -32, by: -4) {
            let middle = Double(row + 2), half = floor(sqrt(1089 - middle * middle) / 4) * 4
            points.append(NSPoint(x: -half, y: Double(row + 4))); points.append(NSPoint(x: -half, y: Double(row)))
        }
        let shape = NSBezierPath(); shape.move(to: points[0]); points.dropFirst().forEach { shape.line(to: $0) }; shape.close()
        NSColor(srgbRed: 0.15, green: 0.10, blue: 0.22, alpha: 0.94).setFill(); shape.fill()
        context.saveGState(); shape.addClip()
        let fraction = max(0, min(1, (quota ?? 0) / 100))
        let top = floor((32 - 64 * fraction) / 4) * 4
        let wave = [-4.0, -4, 0, 0, 4, 4, 0, 0]
        if fraction > 0 {
            for column in 0..<18 {
                let edge = fraction >= 0.999 ? -40 : top + wave[column % 8]
                for (offset, alpha) in [(-4.0,0.12),(0,0.26),(4,0.42),(8,0.62)] {
                    tint.withAlphaComponent(alpha).setFill()
                    NSRect(x: Double(-36 + column * 4), y: edge + offset, width: 4, height: offset == 8 ? max(0, 34 - edge - 8) : 4).fill()
                }
            }
        }
        context.restoreGState()
        tint.setStroke(); shape.lineWidth = 3; shape.stroke()
        NSColor(srgbRed: 0.94, green: 0.87, blue: 1, alpha: 0.9).setFill()
        NSRect(x: -16, y: -28, width: 12, height: 4).fill(); NSRect(x: -24, y: -20, width: 4, height: 8).fill()
        text(label, rect: NSRect(x: -31, y: -16, width: 62, height: 16), size: 9, color: .white)
        text(percent(quota), rect: NSRect(x: -32, y: 0, width: 64, height: 25), size: 18, color: .white, bold: true)
    }
    override func draw(_ dirtyRect: NSRect) {
        guard let app = owner else { return }
        let data = app.details ? app.usage : app.flightUsage
        if app.details {
            NSColor(srgbRed: 0.12, green: 0.09, blue: 0.17, alpha: 0.97).setFill()
            NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), xRadius: 10, yRadius: 10).fill()
        }
        let animate = app.motion && !app.details
        let age = ProcessInfo.processInfo.systemUptime - app.popStart
        orb(center: NSPoint(x: bounds.midX - 44, y: 58), label: app.en ? "5 HOURS" : "5 小时", quota: data.fiveHour?.remainingPct, tint: NSColor(srgbRed: 0.42, green: 0.94, blue: 0.89, alpha: 1), age: age, animate: animate)
        orb(center: NSPoint(x: bounds.midX + 44, y: 46), label: app.en ? "WEEK" : "本周", quota: data.weekly?.remainingPct, tint: NSColor(srgbRed: 0.88, green: 0.57, blue: 0.97, alpha: 1), age: age - 0.85, animate: animate)
        if app.details {
            let rows: [(String,String)] = [
                (app.en ? "Account" : "关联账号",data.account ?? "—"),
                (app.en ? "Planned left" : "今日建议剩余",(data.today?.remainingText ?? "—") + " tokens"),
                (app.en ? "Used today" : "今日已用",(data.today?.usedText ?? "—") + " tokens"),
                (app.en ? "5h reset" : "5小时重置",data.fiveHour?.resetsText ?? "—"),
                (app.en ? "Week reset" : "周额度重置",data.weekly?.resetsText ?? "—")]
            for (index,row) in rows.enumerated() { text(row.0 + "  " + row.1, rect: NSRect(x: 12, y: CGFloat(112 + index * 25), width: 286, height: 22), size: 10, color: .white) }
            let warning = data.stale == true || data.feed?.error != nil
            text(warning ? (app.en ? "Estimated / last known data" : "估算或上次同步数据") : (app.en ? "Budget is a plan, not official quota" : "建议预算不等于官方额度"), rect: NSRect(x: 12, y: 251, width: 286, height: 24), size: 9, color: .lightGray)
        }
    }
}

final class CatApp: NSObject, NSApplicationDelegate {
    var frames: [NSImage] = [], timeline = Timeline(), usage = Usage.empty, flightUsage = Usage.empty
    var motion = true, details = false, hovering = false, manualPosition = false, wasStopped = false, menuOpen = false
    var popStart = -100.0, bubbleOriginX: CGFloat = 92
    var flightPoint = NSPoint.zero
    var en: Bool { language == "en" || (language == "auto" && !(Locale.preferredLanguages.first ?? "en").hasPrefix("zh")) }
    var language = "auto"
    var cat: CompanionPanel!, bubble: CompanionPanel!, catView: CatView!, bubbleView: BubbleView!
    var menuItem: NSStatusItem?, timer: Timer?, feed: Process?, host: NSRunningApplication?
    var signalSources: [DispatchSourceSignal] = []
    var anchor: CGRect?, anchorAt = 0.0, lastTick = 0.0, lastRead = 0.0, lastHost = 0.0
    var dataURL = URL(fileURLWithPath: "/"), pluginURL = URL(fileURLWithPath: "/"), home = "", node = "", interval = "30"
    let reader = AnchorReader()
    func argument(_ name: String) -> String? { guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return nil }; return CommandLine.arguments[index + 1] }
    func applicationDidFinishLaunching(_ notification: Notification) {
        home = argument("--home") ?? ProcessInfo.processInfo.environment["CODEX_HOME"] ?? NSHomeDirectory() + "/.codex"
        guard let plugin = argument("--plugin-root"), let nodePath = argument("--node") else { NSApp.terminate(nil); return }
        pluginURL = URL(fileURLWithPath: plugin); node = nodePath; interval = argument("--interval") ?? "30"
        dataURL = URL(fileURLWithPath: home).appendingPathComponent("usage-coach/dial.json")
        try? FileManager.default.createDirectory(at: dataURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let settings = try? Data(contentsOf: dataURL.deletingLastPathComponent().appendingPathComponent("dial-ui.json")), let json = try? JSONSerialization.jsonObject(with: settings) as? [String:String] { language = json["language"] ?? "auto" }
        frames = (1...121).compactMap { NSImage(contentsOf: pluginURL.appendingPathComponent(String(format: "assets/lv1/%03d.png", $0))) }
        guard frames.count == 121 else { alert("Missing cat frames. Reinstall the plugin."); NSApp.terminate(nil); return }
        cat = CompanionPanel(size: NSSize(width: 104, height: 104)); catView = CatView(frame: NSRect(x: 0, y: 0, width: 104, height: 104)); catView.owner = self; cat.contentView = catView
        bubble = CompanionPanel(size: NSSize(width: 184, height: 164)); bubbleView = BubbleView(frame: NSRect(x: 0, y: 0, width: 184, height: 164)); bubbleView.owner = self; bubble.contentView = bubbleView
        menuItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength); menuItem?.button?.title = "CAT"; menuItem?.menu = makeMenu()
        let pidURL = dataURL.deletingLastPathComponent().appendingPathComponent("dial-window.pid")
        try? String(ProcessInfo.processInfo.processIdentifier).write(to: pidURL, atomically: true, encoding: .utf8)
        let pump = Process(); pump.executableURL = URL(fileURLWithPath: node); pump.arguments = [pluginURL.appendingPathComponent("server/dial-feed.mjs").path,"--interval=" + interval]
        var environment = ProcessInfo.processInfo.environment; environment["CODEX_HOME"] = home; pump.environment = environment
        pump.standardOutput = FileHandle.nullDevice; pump.standardError = FileHandle.nullDevice
        do { try pump.run(); feed = pump } catch { alert("Could not start local usage feed: " + error.localizedDescription) }
        lastTick = ProcessInfo.processInfo.systemUptime; lastHost = lastTick
        timer = Timer.scheduledTimer(withTimeInterval: 1.0/60, repeats: true) { [weak self] _ in self?.tick() }
        if let timer = timer { RunLoop.main.add(timer, forMode: .common) }
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }; source.resume(); signalSources.append(source)
        }
        // The user grants this permission in System Settings; never change it ourselves.
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }
    func tick() {
        let now = ProcessInfo.processInfo.systemUptime, elapsed = now - lastTick; lastTick = now
        if now - lastRead > 2 { lastRead = now; if let bytes = try? Data(contentsOf: dataURL), let next = try? JSONDecoder().decode(Usage.self, from: bytes) { usage = next } }
        let candidates = NSWorkspace.shared.runningApplications.filter { app in
            let id = app.bundleIdentifier?.lowercased() ?? ""
            return id != Bundle.main.bundleIdentifier && (id.contains(".codex") || app.localizedName?.lowercased() == "codex")
        }
        guard let activeHost = candidates.first(where: { $0.isActive }) ?? candidates.first else {
            cat.orderOut(nil); bubble.orderOut(nil)
            if now - lastHost > 5 { NSApp.terminate(nil) }; return
        }
        lastHost = now
        if host?.processIdentifier != activeHost.processIdentifier { host = activeHost; anchor = nil; anchorAt = 0 }
        guard !activeHost.isHidden, (NSWorkspace.shared.frontmostApplication?.processIdentifier == activeHost.processIdentifier || menuOpen), AXIsProcessTrusted() else { cat.orderOut(nil); bubble.orderOut(nil); return }
        let pid = activeHost.processIdentifier, primaryTop = NSScreen.screens.first?.frame.maxY ?? 0
        reader.poll(pid: pid, primaryTop: primaryTop) { [weak self] rect in
            guard let self = self, self.host?.processIdentifier == pid else { return }
            self.anchor = rect; self.anchorAt = ProcessInfo.processInfo.systemUptime
        }
        guard let anchor = anchor, now - anchorAt < 2 else { cat.orderOut(nil); bubble.orderOut(nil); return }
        if motion && !hovering && !details && !manualPosition && !menuOpen { timeline.advance(elapsed, width: Double(max(0, anchor.width - 104))) }
        if !manualPosition { cat.setFrameOrigin(NSPoint(x: anchor.minX + min(CGFloat(timeline.position), max(0, anchor.width - 104)), y: anchor.maxY - 7)) }
        cat.orderFrontRegardless(); catView.needsDisplay = true
        let stopped = !timeline.walking || hovering || !motion
        if stopped && !wasStopped && now - popStart > 3.85 { popStart = now; flightPoint = cat.frame.origin; flightUsage = usage }
        wasStopped = stopped
        guard details || !motion || now - popStart < 3.85 else { bubble.orderOut(nil); return }
        let size = details ? NSSize(width: 310, height: 282) : NSSize(width: 184, height: 164)
        let source = details ? cat.frame.origin : flightPoint
        var origin = NSPoint(x: source.x + 52 - size.width/2, y: source.y + 104 - 18)
        let area = NSScreen.screens.first(where: { $0.frame.intersects(cat.frame) })?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        origin.x = max(area.minX, min(area.maxX-size.width, origin.x)); origin.y = min(area.maxY-size.height, origin.y)
        bubbleOriginX = source.x + 52 - origin.x
        let frame = NSRect(origin: origin, size: size)
        if bubble.frame != frame { bubble.setFrame(frame, display: false) }
        bubble.orderFrontRegardless(); bubbleView.needsDisplay = true
    }
    func makeMenu() -> NSMenu {
        let menu = NSMenu(title: "NEON CAT")
        func item(_ title: String, _ action: Selector, tag: Int = 0) {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
            entry.attributedTitle = NSAttributedString(string: title, attributes: [.font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)])
            entry.target = self; entry.tag = tag; menu.addItem(entry)
        }
        item(en ? "View usage details" : "查看余量详情", #selector(showDetails))
        item(en ? "Resume input patrol" : "沿输入框行走", #selector(resume))
        item(motion ? (en ? "Disable animation" : "关闭动效") : (en ? "Enable animation" : "开启动效"), #selector(toggleMotion))
        menu.addItem(.separator())
        item("中文", #selector(changeLanguage(_:)), tag: 1); item("English", #selector(changeLanguage(_:)), tag: 2); item(en ? "System language" : "跟随系统", #selector(changeLanguage(_:)), tag: 0)
        item(en ? "Accessibility settings" : "辅助功能设置", #selector(settings))
        menu.addItem(.separator()); item(en ? "Quit cat" : "退出猫咪", #selector(quit))
        return menu
    }
    @objc func showDetails() { details = true }
    func toggleDetails() { details.toggle() }
    @objc func resume() { manualPosition = false; details = false }
    @objc func toggleMotion() { motion.toggle(); menuItem?.menu = makeMenu() }
    @objc func changeLanguage(_ sender: NSMenuItem) {
        language = sender.tag == 1 ? "zh" : sender.tag == 2 ? "en" : "auto"
        if let data = try? JSONSerialization.data(withJSONObject: ["language":language]) { try? data.write(to: dataURL.deletingLastPathComponent().appendingPathComponent("dial-ui.json"), options: .atomic) }
        menuItem?.menu = makeMenu()
    }
    @objc func settings() { if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") { NSWorkspace.shared.open(url) } }
    @objc func quit() { NSApp.terminate(nil) }
    func alert(_ message: String) { let alert = NSAlert(); alert.messageText = "Codex Usage Cat"; alert.informativeText = message; alert.runModal() }
    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate(); if let feed = feed, feed.isRunning { feed.terminate() }
        signalSources.forEach { $0.cancel() }
        let pid = dataURL.deletingLastPathComponent().appendingPathComponent("dial-window.pid")
        if (try? String(contentsOf: pid)) == String(ProcessInfo.processInfo.processIdentifier) { try? FileManager.default.removeItem(at: pid) }
    }
}

if CommandLine.arguments.contains("--self-test") {
    var timeline = Timeline(); timeline.advance(0.2, width: 200); precondition(timeline.position == 0)
    var turned = false
    for _ in 0..<700 { timeline.advance(1.0/12, width: 200); precondition((0...200).contains(timeline.position)); turned = turned || timeline.direction < 0 }
    precondition(turned)
    precondition((try? JSONDecoder().decode(Usage.self, from: Data("{\"fiveHour\":{\"remainingPct\":70}}".utf8)))?.fiveHour?.remainingPct == 70)
    print("Mac timeline and usage decoding passed.")
} else {
    let app = NSApplication.shared
    let delegate = CatApp(); app.delegate = delegate; app.setActivationPolicy(.accessory)
    withExtendedLifetime(delegate) { app.run() }
}
