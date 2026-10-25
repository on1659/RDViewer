import Cocoa

enum UpdateInstaller {
    static func prepare(_ args: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        DispatchQueue.global(qos: .utility).async {
            do {
                guard let archive = args["archivePath"] as? String,
                      let version = args["version"] as? String,
                      let hash = args["sha256"] as? String,
                      let serverPID = args["serverPID"] as? NSNumber,
                      let resources = Bundle.main.resourceURL,
                      version.range(of: #"^\d+\.\d+\.\d+$"#, options: .regularExpression) != nil,
                      hash.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
                      serverPID.intValue > 1 else { throw CocoaError(.fileReadCorruptFile) }
                let config = try ReaderBridge.configuration()
                let process = Process()
                process.executableURL = URL(fileURLWithPath: config.node)
                let request: [String: Any] = ["archivePath": archive, "version": version, "sha256": hash,
                                            "appPath": Bundle.main.bundleURL.resolvingSymlinksInPath().path,
                                            "parentPID": ProcessInfo.processInfo.processIdentifier, "serverPID": serverPID]
                let json = try JSONSerialization.data(withJSONObject: request)
                process.arguments = [resources.appendingPathComponent("viewer/macos/update-helper.mjs").path, "--prepare", String(decoding: json, as: UTF8.self)]
                let output = Pipe(), errors = Pipe()
                process.standardOutput = output; process.standardError = errors
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                let errorData = errors.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                guard process.terminationStatus == 0,
                      let prepared = try JSONSerialization.jsonObject(with: data) as? [String: String],
                      let helper = prepared["helperPath"], let requestPath = prepared["requestPath"] else {
                    let details = String(decoding: errorData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                    throw NSError(domain: "RDViewer.Update", code: 1, userInfo: [NSLocalizedDescriptionKey: details.isEmpty ? "업데이트를 준비하지 못했습니다." : String(details.prefix(2000))])
                }
                let cache = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/RDViewer/updates", isDirectory: true).resolvingSymlinksInPath()
                let work = URL(fileURLWithPath: requestPath).deletingLastPathComponent()
                guard work.deletingLastPathComponent().path == cache.path, helper == work.appendingPathComponent("install.mjs").path,
                      URL(fileURLWithPath: requestPath).lastPathComponent == "request.json", work.lastPathComponent.hasPrefix("install-") else { throw CocoaError(.fileReadCorruptFile) }
                let installer = Process()
                installer.executableURL = URL(fileURLWithPath: config.node)
                installer.arguments = [helper, "--apply", requestPath]
                installer.currentDirectoryURL = work
                installer.standardInput = FileHandle.nullDevice; installer.standardOutput = FileHandle.nullDevice; installer.standardError = FileHandle.nullDevice
                try installer.run()
                DispatchQueue.main.async {
                    completion(.success(["restarting": true, "version": version]))
                    // Give the authenticated command result time to reach the
                    // server before normal termination flushes recordings.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { NSApp.terminate(nil) }
                }
            } catch { DispatchQueue.main.async { completion(.failure(error)) } }
        }
    }
}
