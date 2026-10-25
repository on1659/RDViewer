import Cocoa
import WebKit
import AVFoundation

private struct AutomationDescriptor: Decodable {
    let baseURL: String
    let token: String
    let artifactDirectory: String
}

private func automationError(_ message: String) -> NSError { NSError(domain: "RDViewer.Automation", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

private func previewNavigationError(_ error: Error) -> NSError {
    let original = error as NSError
    let underlying = original.userInfo[NSUnderlyingErrorKey] as? NSError
    let network = original.domain == NSURLErrorDomain ? original : (underlying?.domain == NSURLErrorDomain ? underlying : nil)
    let message: String
    switch network?.code {
    case URLError.Code.cannotConnectToHost.rawValue, URLError.Code.cannotFindHost.rawValue, URLError.Code.dnsLookupFailed.rawValue, URLError.Code.notConnectedToInternet.rawValue:
        message = "로컬 서버에 연결할 수 없어요. 서버가 실행 중인지와 주소·포트를 확인해 주세요."
    case URLError.Code.timedOut.rawValue:
        message = "페이지 응답을 기다리는 시간이 초과됐어요. 서버 상태를 확인한 뒤 다시 시도해 주세요."
    case URLError.Code.secureConnectionFailed.rawValue, URLError.Code.serverCertificateHasBadDate.rawValue, URLError.Code.serverCertificateUntrusted.rawValue, URLError.Code.serverCertificateHasUnknownRoot.rawValue, URLError.Code.serverCertificateNotYetValid.rawValue, URLError.Code.clientCertificateRejected.rawValue, URLError.Code.clientCertificateRequired.rawValue:
        message = "HTTPS 연결을 확인할 수 없어요. 인증서가 유효하고 주소와 일치하는지 확인해 주세요. HTTP 서버라면 http://로 주소를 바꿔 주세요."
    case URLError.Code.cancelled.rawValue:
        message = "페이지 열기가 취소됐어요. 주소를 확인한 뒤 다시 시도해 주세요."
    default:
        message = "페이지를 열지 못했어요. 서버 상태와 주소를 확인한 뒤 다시 시도해 주세요."
    }
    return automationError(message)
}

final class NativeAutomation: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private weak var reader: WKWebView?
    private let openReader: (URL) -> Void
    private var descriptor: AutomationDescriptor?
    private var running = true
    private var previewWindow: NSWindow?
    private var preview: WKWebView?
    private var previewURLObservation: NSKeyValueObservation?
    private var allowedOrigin = ""
    private var navigationCompletion: ((Result<[String: Any], Error>) -> Void)?
    private var logs: [[String: String]] = []
    private var recorder: WebViewRecorder?
    private var lastRecording: [String: Any]?
    private weak var recordingWindow: NSWindow?
    private var previousRecordingTitle = ""
    private var actionSource = ""
    private let actions = ["open", "status", "snapshot", "click", "fill", "press", "scroll", "play", "pause", "seek", "screenshot", "record.start", "record.stop", "close"]

    init(reader: WKWebView, openReader: @escaping (URL) -> Void) {
        self.reader = reader; self.openReader = openReader
        super.init()
        if let resources = Bundle.main.resourceURL { actionSource = (try? String(contentsOf: resources.appendingPathComponent("viewer/native/automation-page.js"), encoding: .utf8)) ?? "" }
        connect()
    }
    private func connect() {
        guard running else { return }
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("RDViewer")
        do {
            descriptor = try JSONDecoder().decode(AutomationDescriptor.self, from: Data(contentsOf: directory.appendingPathComponent("automation.json")))
            request("register", body: ["platform": "darwin", "capabilities": actions]) { result in
                if case .success = result { self.publish(); self.poll() }
                else { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.connect() } }
            }
        } catch { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.connect() } }
    }
    private func request(_ route: String, body: [String: Any]? = nil, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let descriptor, let url = URL(string: descriptor.baseURL + "/api/automation/" + route) else { completion(.failure(automationError("Automation server is unavailable."))); return }
        var request = URLRequest(url: url); request.timeoutInterval = 22
        request.setValue("Bearer " + descriptor.token, forHTTPHeaderField: "Authorization")
        if let body {
            request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do { request.httpBody = try JSONSerialization.data(withJSONObject: body) } catch { completion(.failure(error)); return }
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error { completion(.failure(error)); return }
                guard let data, let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { completion(.failure(automationError("Invalid automation response."))); return }
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { completion(.failure(automationError(json["error"] as? String ?? "Automation request failed."))); return }
                completion(.success(json))
            }
        }.resume()
    }
    private func poll() {
        guard running else { return }
        request("next") { result in
            guard self.running else { return }
            switch result {
            case .success(let value):
                guard let command = value["command"] as? [String: Any], let id = command["id"] as? String, let action = command["action"] as? String else { self.poll(); return }
                self.execute(action, args: command["args"] as? [String: Any] ?? [:]) { result in
                    var payload: [String: Any] = ["id": id]
                    switch result { case .success(let value): payload["result"] = value; case .failure(let error): payload["error"] = error.localizedDescription }
                    self.request("result", body: payload) { _ in self.poll() }
                }
            case .failure:
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.connect() }
            }
        }
    }
    private func origin(_ url: URL) -> String { "\(url.scheme ?? "")://\(url.host ?? ""):\(url.port ?? (url.scheme == "https" ? 443 : 80))" }
    private func state() -> [String: Any] {
        ["previewOpen": preview != nil, "url": preview?.url?.absoluteString ?? "", "title": preview?.title ?? "", "engine": "WebKit", "activePreviewCount": preview == nil ? 0 : 1]
    }
    private func recordingState() -> [String: Any] {
        if let recorder { return recorder.state() }
        var value = lastRecording ?? [:]; value["active"] = false; return value
    }
    private func publish() { request("events", body: ["state": state(), "recording": recordingState()]) { _ in } }
    private func stopRecording(_ completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let recorder else { completion(.success(lastRecording ?? ["active": false])); return }
        recorder.stop { result in
            self.recorder = nil
            if case .success(let value) = result { self.lastRecording = value }
            self.recordingWindow?.title = self.previousRecordingTitle; self.recordingWindow = nil; self.publish(); completion(result)
        }
    }
    private func cancelPreviewNavigation() {
        if let pending = navigationCompletion {
            navigationCompletion = nil
            pending(.failure(previewNavigationError(URLError(.cancelled))))
        }
    }
    private func closePreview() {
        cancelPreviewNavigation()
        previewURLObservation?.invalidate(); previewURLObservation = nil
        preview?.navigationDelegate = nil; preview?.uiDelegate = nil; preview?.stopLoading()
        preview?.configuration.userContentController.removeScriptMessageHandler(forName: "rdviewerLog")
        preview?.removeFromSuperview(); preview = nil
        previewWindow?.delegate = nil; previewWindow?.close(); previewWindow = nil
        publish()
    }
    private func showPreview(_ url: URL, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let host = (url.host ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
        guard ["http", "https"].contains(url.scheme ?? ""), ["127.0.0.1", "localhost", "::1"].contains(host), url.user == nil, url.password == nil, url.port != 4317, url.port != 4318 else { completion(.failure(automationError("RDViewer 주소와 분리된 로컬 서버 주소를 입력해 주세요."))); return }
        stopRecording { result in
            if case .failure(let error) = result { completion(.failure(error)); return }
            self.cancelPreviewNavigation()
            self.previewURLObservation?.invalidate(); self.previewURLObservation = nil
            self.preview?.navigationDelegate = nil; self.preview?.uiDelegate = nil; self.preview?.stopLoading()
            self.preview?.configuration.userContentController.removeScriptMessageHandler(forName: "rdviewerLog")
            self.preview?.removeFromSuperview(); self.preview = nil
            self.allowedOrigin = self.origin(url); self.logs = []
            let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent(); configuration.mediaTypesRequiringUserActionForPlayback = []
            configuration.applicationNameForUserAgent = "RDViewerPreview"
            let controller = WKUserContentController()
            controller.add(self, name: "rdviewerLog")
            let instrumentation = """
            (() => { const emit = (level, message) => { try { window.webkit.messageHandlers.rdviewerLog.postMessage({level, message:String(message).slice(0,1000)}); } catch {} }; for(const level of ['log','warn','error']) { const original=console[level]; console[level]=(...args)=>{emit(level,args.map(a=>typeof a==='string'?a:String(a)).join(' ')); original.apply(console,args);}; } addEventListener('error',e=>emit('error',e.message)); addEventListener('unhandledrejection',e=>emit('error',e.reason)); })();
            """
            controller.addUserScript(WKUserScript(source: instrumentation, injectionTime: .atDocumentStart, forMainFrameOnly: true)); configuration.userContentController = controller
            let view = WKWebView(frame: .zero, configuration: configuration); view.navigationDelegate = self; view.uiDelegate = self
            if self.previewWindow == nil {
                let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 760), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
                window.minSize = NSSize(width: 375, height: 400); window.isReleasedWhenClosed = false; window.center(); self.previewWindow = window
            }
            self.previewWindow?.title = "RDViewer 미리보기"; self.previewWindow?.delegate = self; self.previewWindow?.contentView = view
            self.preview = view; self.navigationCompletion = completion
            // WKNavigationDelegate does not finish a new navigation for every
            // hash/history change. Observe the active view's URL as well.
            self.previewURLObservation = view.observe(\.url, options: [.new]) { [weak self, weak view] _, _ in
                guard let self, let view, self.preview === view else { return }
                self.publish()
            }
            self.previewWindow?.orderOut(nil)
            view.load(URLRequest(url: url))
            DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self, weak view] in
                guard let self, let view else { return }
                if self.preview === view, let pending = self.navigationCompletion {
                    self.navigationCompletion = nil; self.closePreview()
                    pending(.failure(previewNavigationError(URLError(.timedOut))))
                }
            }
        }
    }
    private func execute(_ action: String, args: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        // Internal server-only command. It is deliberately absent from public
        // automation capabilities and never exposed to preview JavaScript.
        if action == "update.install" {
            stopRecording { result in
                if case .failure(let error) = result { completion(.failure(error)); return }
                self.closePreview()
                UpdateInstaller.prepare(args, completion: completion)
            }
            return
        }
        if action == "open" {
            guard let text = (args["previewURL"] ?? args["url"]) as? String, let url = URL(string: text) else { completion(.failure(automationError("Missing open URL."))); return }
            if ["html","url"].contains(args["kind"] as? String ?? "") { showPreview(url, completion: completion) }
            else {
                stopRecording { result in
                    if case .failure(let error) = result { completion(.failure(error)); return }
                    self.closePreview(); self.logs = []; self.openReader(url); self.waitForReader(url, deadline: Date().addingTimeInterval(12)) { result in completion(result.map { _ in ["opened": true, "url": url.absoluteString, "kind": args["kind"] ?? "markdown"] }) }
                }
            }; return
        }
        if action == "status" { var value = state(); value["recording"] = recordingState(); value["capabilities"] = actions; value["logs"] = logs; completion(.success(value)); return }
        if action == "close" { stopRecording { result in self.closePreview(); completion(result.map { ["closed": true, "recording": $0] }) }; return }
        if action == "record.stop" { stopRecording(completion); return }
        guard let view = preview ?? reader else { completion(.failure(automationError("Open a file first."))); return }
        if action == "screenshot" {
            snapshot(view) { result in
                do {
                    let image = try result.get(); guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { throw automationError("Could not encode screenshot.") }
                    let output = try self.artifact("png"); try png.write(to: output, options: .atomic)
                    completion(.success(["path": output.path, "mimeType": "image/png", "bytes": png.count]))
                } catch { completion(.failure(error)) }
            }; return
        }
        if action == "record.start" {
            guard recorder == nil else { completion(.failure(automationError("A recording is already running."))); return }
            do {
                let output = try artifact("mp4")
                let recorder = try WebViewRecorder(view: view, output: output, args: args)
                self.recorder = recorder; self.lastRecording = nil; self.recordingWindow = view.window; self.previousRecordingTitle = view.window?.title ?? "RDViewer"; self.recordingWindow?.title = "🔴 녹화 중 — RDViewer"
                recorder.onAutomaticStop = { [weak self] result in
                    guard let self else { return }; self.recorder = nil; if case .success(let value) = result { self.lastRecording = value }; self.recordingWindow?.title = self.previousRecordingTitle; self.recordingWindow = nil; self.publish()
                }
                recorder.start(); publish(); completion(.success(recorder.state()))
            } catch { completion(.failure(error)) }; return
        }
        guard !actionSource.isEmpty else { completion(.failure(automationError("Automation actions are missing."))); return }
        let function = "return await (\(actionSource))(command);"
        view.callAsyncJavaScript(function, arguments: ["command": ["action": action, "args": args]], in: nil, in: .defaultClient) { result in
            switch result {
            case .success(let value):
                guard var object = value as? [String: Any] else { completion(.failure(automationError("Invalid page action response."))); return }
                if action == "snapshot" { object["logs"] = self.logs; object["engine"] = "WebKit" }; completion(.success(object))
            case .failure(let error):
                let native = error as NSError
                let message = native.userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription
                completion(.failure(automationError(String(message.prefix(2000)))))
            }
        }
    }
    private func waitForReader(_ url: URL, deadline: Date, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let reader else { completion(.failure(automationError("Reader is unavailable."))); return }
        guard Date() < deadline else { completion(.failure(automationError("Reader load timed out."))); return }
        if reader.isLoading { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.waitForReader(url, deadline: deadline, completion: completion) }; return }
        let expected = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "doc" })?.value?.components(separatedBy: "/").last ?? ""
        let encoded = String(data: (try? JSONSerialization.data(withJSONObject: [expected])) ?? Data("[\"\"]".utf8), encoding: .utf8) ?? "[\"\"]"
        let predicate = "document.readyState === 'complete' && document.title === (\(encoded))[0]+' — RDViewer' && document.querySelector('#article')?.getAttribute('aria-busy') !== 'true' && (!document.querySelector('video') || document.querySelector('video').readyState >= 1)"
        reader.evaluateJavaScript(predicate) { value, error in
            if error == nil, value as? Bool == true { completion(.success(["ready": true])) }
            else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.waitForReader(url, deadline: deadline, completion: completion) } }
        }
    }
    private func artifact(_ extensionName: String) throws -> URL {
        guard let descriptor else { throw automationError("Automation is not connected.") }
        let directory = URL(fileURLWithPath: descriptor.artifactDirectory, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return directory.appendingPathComponent(UUID().uuidString + "." + extensionName)
    }
    private func snapshot(_ view: WKWebView, completion: @escaping (Result<NSImage, Error>) -> Void) {
        let config = WKSnapshotConfiguration(); config.snapshotWidth = NSNumber(value: min(1920, max(320, view.bounds.width))); config.afterScreenUpdates = false
        view.takeSnapshot(with: config) { image, error in if let error { completion(.failure(error)) } else if let image { completion(.success(image)) } else { completion(.failure(automationError("The web view snapshot is empty."))) } }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === preview, message.frameInfo.isMainFrame, let value = message.body as? [String: Any] else { return }
        logs.append(["level": String(describing: value["level"] ?? "log").prefix(20).description, "message": String(describing: value["message"] ?? "").prefix(1000).description]); if logs.count > 100 { logs.removeFirst(logs.count - 100) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === preview else { return }
        publish()
        if let pending = navigationCompletion {
            navigationCompletion = nil; previewWindow?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
            pending(.success(state()))
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard webView === preview else { return }
        if let pending = navigationCompletion { navigationCompletion = nil; closePreview(); pending(.failure(previewNavigationError(error))) }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { self.webView(webView, didFail: navigation, withError: error) }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) { guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }; decisionHandler(origin(url) == allowedOrigin || url.absoluteString == "about:blank" ? .allow : .cancel) }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) { completionHandler(nil) }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    func windowShouldClose(_ sender: NSWindow) -> Bool { stopRecording { _ in self.closePreview() }; return false }
    func beforeReaderNavigation(completion: @escaping () -> Void) { stopRecording { _ in self.closePreview(); completion() } }
    func stop(completion: @escaping () -> Void = {}) { running = false; stopRecording { _ in self.closePreview(); completion() } }
}

private final class WebViewRecorder {
    weak var view: WKWebView?
    let output: URL
    let fps: Int
    let seconds: Double
    let width: Int
    let height: Int
    let startedAt = Date()
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let adaptor: AVAssetWriterInputPixelBufferAdaptor
    var frames = 0
    var inFlight = false
    var stopping = false
    var timer: Timer?
    var limit: DispatchWorkItem?
    var onAutomaticStop: ((Result<[String: Any], Error>) -> Void)?
    var stopCallbacks: [(Result<[String: Any], Error>) -> Void] = []
    init(view: WKWebView, output: URL, args: [String: Any]) throws {
        self.view = view; self.output = output
        fps = max(1, min(15, (args["fps"] as? NSNumber)?.intValue ?? 10))
        seconds = max(1, min(120, (args["seconds"] as? NSNumber)?.doubleValue ?? 10))
        width = max(320, min(1920, (args["width"] as? NSNumber)?.intValue ?? 1280)) / 2 * 2
        height = max(180, min(1080, Int(Double(width) * max(1, view.bounds.height) / max(1, view.bounds.width)))) / 2 * 2
        writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 2000000, AVVideoExpectedSourceFrameRateKey: fps]])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height, kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true])
        guard writer.canAdd(input) else { throw automationError("MP4 encoder is unavailable.") }; writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? automationError("Could not start the MP4 writer.") }; writer.startSession(atSourceTime: .zero)
    }
    func state() -> [String: Any] { ["active": !stopping, "startedAt": startedAt.timeIntervalSince1970 * 1000, "path": output.path, "mimeType": "video/mp4", "frames": frames, "fps": fps, "width": width, "height": height, "seconds": seconds, "audio": false] }
    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1 / Double(fps), repeats: true) { [weak self] _ in self?.frame() }
        let finish = DispatchWorkItem { [weak self] in self?.stop { result in self?.onAutomaticStop?(result) } }; limit = finish; DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: finish); frame()
    }
    private func frame() {
        guard !stopping, !inFlight, input.isReadyForMoreMediaData, let view else { return }
        inFlight = true
        let config = WKSnapshotConfiguration(); config.snapshotWidth = NSNumber(value: width); config.afterScreenUpdates = false
        view.takeSnapshot(with: config) { [weak self] image, error in
            guard let self else { return }
            defer { self.inFlight = false; if self.stopping { self.finish() } }
            guard !self.stopping, error == nil, let image else { return }
            autoreleasepool {
                guard let pool = self.adaptor.pixelBufferPool else { return }
                var optional: CVPixelBuffer?; guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(nil, pool, [kCVPixelBufferPoolAllocationThresholdKey as String: 4] as CFDictionary, &optional) == kCVReturnSuccess, let pixel = optional else { return }
                CVPixelBufferLockBaseAddress(pixel, []); defer { CVPixelBufferUnlockBaseAddress(pixel, []) }
                guard let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: self.width, height: self.height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
                context.setFillColor(NSColor.black.cgColor); context.fill(CGRect(x: 0, y: 0, width: self.width, height: self.height)); context.draw(cg, in: CGRect(x: 0, y: 0, width: self.width, height: self.height))
                let time = self.frames == 0 ? CMTime.zero : CMTime(seconds: Date().timeIntervalSince(self.startedAt), preferredTimescale: 600)
                if self.adaptor.append(pixel, withPresentationTime: time) { self.frames += 1 }
            }
        }
    }
    func stop(_ completion: @escaping (Result<[String: Any], Error>) -> Void) {
        stopCallbacks.append(completion); if stopping { return }; stopping = true; timer?.invalidate(); timer = nil; limit?.cancel(); if !inFlight { finish() }
    }
    private var finishing = false
    private func finish() {
        guard !finishing else { return }; finishing = true
        writer.endSession(atSourceTime: CMTime(seconds: Date().timeIntervalSince(startedAt), preferredTimescale: 600)); input.markAsFinished(); writer.finishWriting { [self] in
            DispatchQueue.main.async {
                let result: Result<[String: Any], Error>
                if self.writer.status == .completed, self.frames > 0 { var value = self.state(); value["active"] = false; value["duration"] = Date().timeIntervalSince(self.startedAt); value["bytes"] = (try? FileManager.default.attributesOfItem(atPath: self.output.path)[.size]) ?? 0; result = .success(value) }
                else { result = .failure(self.writer.error ?? automationError("No video frames were captured.")) }
                let callbacks = self.stopCallbacks; self.stopCallbacks = []; callbacks.forEach { $0(result) }
            }
        }
    }
}
