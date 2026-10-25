using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

[DataContract]
internal sealed class UpdateRequest {
    [DataMember] public string archivePath;
    [DataMember] public string appDirectory;
    [DataMember] public string version;
    [DataMember] public string sha256;
    [DataMember] public string logFile;
    [DataMember] public int appPID;
}

[DataContract]
internal sealed class UpdateState {
    [DataMember] public string time;
    [DataMember] public string version;
    [DataMember] public string stage;
    [DataMember] public string detail;
    [DataMember] public int exitCode;
}

internal static class RDViewerUpdater {
    private static UpdateRequest request;
    private static string cache;
    private static bool EqualPath(string a, string b) {
        return String.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
    }
    private static void PlainFile(string filename) {
        if ((File.GetAttributes(filename) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
            throw new InvalidDataException("An update file is not a regular file.");
    }
    private static void WriteState(string stage, string detail, int exitCode) {
        var state = new UpdateState { time = DateTime.UtcNow.ToString("o"), version = request.version,
            stage = stage, detail = detail, exitCode = exitCode };
        using (var stream = new MemoryStream()) {
            new DataContractJsonSerializer(typeof(UpdateState)).WriteObject(stream, state);
            File.WriteAllBytes(request.logFile, stream.ToArray());
        }
    }
    private static void Validate(string manifest) {
        cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RDViewer", "updates");
        if (!EqualPath(manifest, Path.Combine(cache, "update-request.json"))
            || !EqualPath(System.Reflection.Assembly.GetExecutingAssembly().Location, Path.Combine(cache, "RDViewerUpdater.exe")))
            throw new InvalidDataException("The updater must run from its private cache.");
        if ((File.GetAttributes(cache) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("The update cache cannot be a link.");
        PlainFile(manifest);
        using (var input = File.OpenRead(manifest)) {
            if (input.Length > 8192) throw new InvalidDataException("Update metadata is too large.");
            request = (UpdateRequest)new DataContractJsonSerializer(typeof(UpdateRequest)).ReadObject(input);
        }
        if (request == null || !Regex.IsMatch(request.version ?? "", @"\A(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\z")
            || !Regex.IsMatch(request.sha256 ?? "", @"\A[a-f0-9]{64}\z") || request.appPID <= 0
            || !EqualPath(request.archivePath, Path.Combine(cache, "RDViewer-" + request.version + "-windows-x64-setup.exe"))
            || !EqualPath(request.logFile, Path.Combine(cache, "update-result.json")))
            throw new InvalidDataException("Update metadata is invalid.");
        PlainFile(request.archivePath);
        var info = new FileInfo(request.archivePath);
        if (info.Length < 1 || info.Length > 512L * 1024 * 1024) throw new InvalidDataException("Update archive size is invalid.");
    }
    [STAThread]
    private static int Main(string[] args) {
        try {
            if (args.Length != 1) return 1;
            Validate(args[0]);
            // Holding the exact process handle avoids PID reuse while waiting.
            using (var reader = Process.GetProcessById(request.appPID)) {
                var executable = Path.Combine(request.appDirectory, "RDViewer.exe");
                if (!EqualPath(reader.MainModule.FileName, executable)) throw new InvalidDataException("The running application path does not match.");
                WriteState("waiting-for-exit", "", 0);
                if (!reader.WaitForExit(60000)) throw new TimeoutException("The application did not exit normally within 60 seconds.");
            }
            WriteState("closing-owned-helpers", "", 0);
            // Installed MCP/CLI clients use this same executable as a Node
            // runtime. Release only our installation's file locks, never a
            // different RDViewer copy or the Claude/Codex host process.
            foreach (var component in Process.GetProcessesByName("RDViewer")) {
                using (component) {
                    string image;
                    try { image = component.MainModule.FileName; } catch { continue; }
                    if (!EqualPath(image, Path.Combine(request.appDirectory, "RDViewer.exe"))) continue;
                    try {
                        if (!component.HasExited) component.Kill();
                        if (!component.WaitForExit(10000)) throw new TimeoutException("An application helper did not exit.");
                    } catch (InvalidOperationException) {
                        if (!component.HasExited) throw;
                    } catch (System.ComponentModel.Win32Exception) {
                        if (!component.HasExited) throw;
                    }
                }
            }
            WriteState("verifying-installer", "", 0);
            using (var stream = new FileStream(request.archivePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var hash = SHA256.Create()) {
                var actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                if (actual != request.sha256) throw new InvalidDataException("The downloaded installer changed before execution.");
            }
            WriteState("installing", "", 0);
            var install = new ProcessStartInfo(request.archivePath, "/S /D=" + request.appDirectory) {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = cache
            };
            using (var process = Process.Start(install)) {
                if (!process.WaitForExit(180000)) throw new TimeoutException("The installer did not finish within 180 seconds.");
                if (process.ExitCode != 0) { WriteState("error", "The installer returned a failure exit code.", process.ExitCode); return process.ExitCode; }
            }
            WriteState("relaunching", "", 0);
            Process.Start(new ProcessStartInfo(Path.Combine(request.appDirectory, "RDViewer.exe")) {
                UseShellExecute = false, WorkingDirectory = request.appDirectory
            });
            WriteState("complete", "", 0);
            return 0;
        } catch (Exception error) {
            try { if (request != null && EqualPath(request.logFile, Path.Combine(cache, "update-result.json"))) WriteState("error", error.Message, 1); } catch { }
            return 1;
        }
    }
}
