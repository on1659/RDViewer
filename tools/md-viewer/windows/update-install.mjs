import path from 'node:path';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { closeSync, createReadStream, openSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export function updatePowerShell({ archivePath, appDirectory, appPID, sha256, version, logFile }) {
  // Values travel as encoded JSON, never as executable PowerShell syntax.
  const data = Buffer.from(JSON.stringify({ archivePath, appDirectory, appPID, sha256, version, logFile }), 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
function Write-UpdateState([string]$stage, [string]$detail = '', [int]$code = 0) {
  $state = @{ time = [DateTime]::UtcNow.ToString('o'); version = $data.version; stage = $stage; detail = $detail; exitCode = $code }
  [IO.File]::WriteAllText($data.logFile, ($state | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
}
try {
  Write-UpdateState 'waiting-for-exit'
  $oldProcess = Get-Process -Id $data.appPID -ErrorAction SilentlyContinue
  if ($oldProcess -and -not $oldProcess.WaitForExit(60000)) { throw 'The application did not exit normally within 60 seconds.' }
  Write-UpdateState 'verifying-installer'
  $actualHash = (Get-FileHash -LiteralPath $data.archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $data.sha256) { throw 'The downloaded installer changed before execution.' }
  Write-UpdateState 'installing'
  # /D must be last and unquoted, including spaces, as required by NSIS.
  $installer = Start-Process -FilePath $data.archivePath -ArgumentList ('/S /D=' + $data.appDirectory) -PassThru
  $null = $installer.Handle
  if (-not $installer.WaitForExit(180000)) { throw 'The installer did not finish within 180 seconds.' }
  $installer.Refresh()
  $code = $installer.ExitCode
  if ($code -ne 0) { Write-UpdateState 'error' 'The installer returned a failure exit code.' $code; exit $code }
  Write-UpdateState 'relaunching'
  Start-Process -FilePath (Join-Path $data.appDirectory 'RDViewer.exe') -WorkingDirectory $data.appDirectory
  Write-UpdateState 'complete'
} catch {
  Write-UpdateState 'error' $_.Exception.Message 1
  exit 1
}
`;
}

export function createWindowsUpdateInstaller({ appDirectory, cacheDirectory, appPID = process.pid,
  onReady = () => {}, spawnProcess = spawn, waitForHelper = awaitHelperReady,
  systemRoot = process.env.SystemRoot || 'C:\\Windows' }) {
  return async ({ archivePath, version, sha256 }) => {
    if (!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(version)
      || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(appPID) || appPID <= 0) throw new Error('Invalid update metadata');
    const expected = path.join(cacheDirectory, `RDViewer-${version}-windows-x64-setup.exe`);
    if (archivePath !== expected || !(await lstat(archivePath)).isFile()
      || await realpath(archivePath) !== path.join(await realpath(cacheDirectory), path.basename(expected))) throw new Error('Untrusted update path');
    const digest = createHash('sha256'); for await (const chunk of createReadStream(archivePath)) digest.update(chunk);
    if (digest.digest('hex') !== sha256) throw new Error('Update archive changed');
    const logFile = path.join(cacheDirectory, 'update-result.json');
    await writeFile(logFile, `${JSON.stringify({ time: new Date().toISOString(), version, stage: 'starting-helper', detail: '', exitCode: 0 })}\n`, { mode: 0o600 });
    const script = updatePowerShell({ archivePath, appDirectory, appPID, sha256, version, logFile });
    const output = openSync(path.join(cacheDirectory, 'update-helper.stdout.log'), 'w', 0o600);
    const errors = openSync(path.join(cacheDirectory, 'update-helper.stderr.log'), 'w', 0o600);
    let helper;
    try {
      helper = spawnProcess(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { detached: true, windowsHide: true, stdio: ['ignore', output, errors], shell: false, cwd: cacheDirectory });
    } finally { closeSync(output); closeSync(errors); }
    await new Promise((resolve, reject) => { helper.once('spawn', resolve); helper.once('error', reject); });
    await waitForHelper(logFile, helper);
    helper.unref();
    onReady();
  };
}

async function awaitHelperReady(logFile, helper) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    let state = {};
    try { state = JSON.parse(await readFile(logFile, 'utf8')); } catch { /* Writer may be replacing the current status. */ }
    if (state.stage === 'waiting-for-exit') return;
    if (state.stage === 'error' || helper.exitCode !== null) throw new Error('The update helper could not start.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The update helper did not acknowledge startup.');
}
