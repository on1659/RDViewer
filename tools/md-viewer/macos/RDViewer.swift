import Cocoa
import WebKit
import UniformTypeIdentifiers

struct RuntimeConfiguration: Decodable {
    let node: String
    let root: String
}

enum ReaderBridge {
    static func configuration() throws -> RuntimeConfiguration {
        guard let url = Bundle.main.url(forResource: "runtime", withExtension: "json") else {
            throw NSError(domain: "RDViewer", code: 1, userInfo: [NSLocalizedDescriptionKey: "실행 설정을 찾을 수 없습니다. 앱을 다시 빌드해 주세요."])
        }
        return try JSONDecoder().decode(RuntimeConfiguration.self, from: Data(contentsOf: url))
    }

    static func open(_ input: String?, project: Bool = false) throws -> URL {
        let config = try configuration()
        guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: config.node)
        let script = resources.appendingPathComponent("viewer/open.mjs")
        var arguments = [script.path, "--no-browser", "--root", config.root]
        if let input {
            if project { arguments.append("--project") }
            arguments.append(input)
        }
        process.arguments = arguments
        process.currentDirectoryURL = URL(fileURLWithPath: config.root)
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let errorData = errors.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let value = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard process.terminationStatus == 0,
              let url = URL(string: value),
              url.scheme == "http", url.host == "127.0.0.1", url.port == 4317 else {
            let details = String(decoding: errorData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(domain: "RDViewer", code: 2, userInfo: [NSLocalizedDescriptionKey: details.isEmpty ? "문서 서버를 시작하지 못했습니다." : details])
        }
        return url
    }
}

final class RDViewerDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private let queue = DispatchQueue(label: "RDViewer.document-open")
    private var pendingInputs: [(input: String?, project: Bool)] = []
    private var ready = false
    private var latestRequest = 0
    private var automation: NativeAutomation?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let iconURL = Bundle.main.url(forResource: "RDViewer", withExtension: "icns") {
            NSApp.applicationIconImage = NSImage(contentsOf: iconURL)
        }
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "RDViewer 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: "파일")
        fileMenu.addItem(withTitle: "파일 추가…", action: #selector(chooseFile), keyEquivalent: "o").target = self
        let projectItem = fileMenu.addItem(withTitle: "폴더 추가…", action: #selector(chooseProject), keyEquivalent: "o")
        projectItem.keyEquivalentModifierMask = [.command, .shift]
        projectItem.target = self
        fileItem.submenu = fileMenu
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "편집")
        editMenu.addItem(withTitle: "복사", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "전체 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "문서 내 찾기…", action: #selector(findInDocument), keyEquivalent: "f").target = self
        editItem.submenu = editMenu
        NSApp.mainMenu = mainMenu

        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = "RDViewerDesktop"
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        let frame = NSRect(x: 0, y: 0, width: 1280, height: 860)
        let mainWindow = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        mainWindow.title = "RDViewer — Markdown Reader"
        mainWindow.minSize = NSSize(width: 400, height: 480)
        mainWindow.contentView = view
        mainWindow.center()
        mainWindow.isReleasedWhenClosed = false
        mainWindow.makeKeyAndOrderFront(nil)
        window = mainWindow
        webView = view
        automation = NativeAutomation(reader: view) { [weak self] url in
            guard self?.isReaderPage(url) == true else { return }; self?.webView?.load(URLRequest(url: url)); self?.window?.makeKeyAndOrderFront(nil)
        }
        ready = true
        if pendingInputs.isEmpty { enqueue(nil) }
        else {
            let inputs = pendingInputs
            pendingInputs.removeAll()
            inputs.forEach { enqueue($0.input, project: $0.project) }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            if url.isFileURL {
                let directory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                enqueue(url.path, project: directory)
            }
            else if ["rdviewer", "folio"].contains(url.scheme ?? ""), url.host == "open",
                    let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                    let input = components.queryItems?.first(where: { $0.name == "path" })?.value {
                enqueue(input)
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let automation else { return .terminateNow }
        automation.stop { sender.reply(toApplicationShouldTerminate: true) }; return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    @objc private func findInDocument() {
        guard let webView, isReaderPage(webView.url) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('rdviewer-find'))", completionHandler: nil)
    }

    @objc private func chooseFile() {
        let panel = NSOpenPanel()
        panel.title = "파일 추가"
        panel.prompt = "추가"
        panel.showsHiddenFiles = true
        panel.allowedContentTypes = ["md", "markdown", "mdown", "png", "mp4", "html", "htm"].compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        if panel.runModal() == .OK { panel.urls.forEach { enqueue($0.path) } }
    }

    @objc private func chooseProject() {
        let panel = NSOpenPanel()
        panel.showsHiddenFiles = true
        panel.title = "폴더 추가"
        panel.message = "추가할 폴더를 선택하세요. 폴더 안의 Markdown, PNG, MP4 파일을 모아 볼 수 있습니다."
        panel.prompt = "추가"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        if panel.runModal() == .OK { panel.urls.forEach { enqueue($0.path, project: true) } }
    }

    private func enqueue(_ input: String?, project: Bool = false) {
        guard ready else { pendingInputs.append((input, project)); return }
        latestRequest += 1
        let request = latestRequest
        queue.async {
            let result = Result { try ReaderBridge.open(input, project: project) }
            DispatchQueue.main.async {
                switch result {
                case .success(let url):
                    // Every selected file is registered; the latest selection is shown.
                    if request == self.latestRequest {
                        let load = {
                            self.webView?.load(URLRequest(url: url))
                            self.window?.makeKeyAndOrderFront(nil)
                            NSApp.activate(ignoringOtherApps: true)
                        }
                        if let automation = self.automation { automation.beforeReaderNavigation(completion: load) } else { load() }
                    }
                case .failure(let error):
                    let alert = NSAlert()
                    alert.messageText = project ? "폴더를 열 수 없어요" : "문서를 열 수 없어요"
                    alert.informativeText = error.localizedDescription
                    alert.addButton(withTitle: "확인")
                    alert.runModal()
                }
            }
        }
    }

    private func isReaderPage(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == 4317
            && url.path == "/" && url.user == nil && url.password == nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let action = url.absoluteString
        if ["rdviewer://choose-folder", "rdviewer://choose-files"].contains(action) {
            let trustedMainFrame = navigationAction.sourceFrame.isMainFrame
                && navigationAction.targetFrame?.isMainFrame == true
                && isReaderPage(navigationAction.sourceFrame.request.url)
            decisionHandler(.cancel)
            if trustedMainFrame {
                // Complete WebKit's navigation decision before opening a modal picker.
                DispatchQueue.main.async {
                    if action == "rdviewer://choose-folder" { self.chooseProject() }
                    else { self.chooseFile() }
                }
            }
        } else if isReaderPage(url) {
            decisionHandler(.allow)
        } else {
            if navigationAction.navigationType == .linkActivated, ["https", "http", "mailto"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["https", "http", "mailto"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.showsHiddenFiles = true
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.allowedContentTypes = ["md", "markdown", "mdown", "png", "mp4", "html", "htm"].compactMap { UTType(filenameExtension: $0) }
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }
}

@main
enum RDViewerMain {
    static func main() {
if ["--smoke-test", "--smoke-project"].contains(CommandLine.arguments.dropFirst().first ?? "") {
    do {
        let input = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
        print(try ReaderBridge.open(input, project: CommandLine.arguments[1] == "--smoke-project").absoluteString)
    } catch {
        fputs("\(error.localizedDescription)\n", stderr)
        exit(1)
    }
} else {
    let app = NSApplication.shared
    let delegate = RDViewerDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
}

    }
}
