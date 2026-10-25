import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export function updatePowerShell({ archivePath, appDirectory, appPID }) {
  // Values travel as encoded JSON, never as executable PowerShell syntax.
  const data = Buffer.from(JSON.stringify({ archivePath, appDirectory, appPID }), 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
Wait-Process -Id $data.appPID -Timeout 60 -ErrorAction SilentlyContinue
if (Get-Process -Id $data.appPID -ErrorAction SilentlyContinue) { exit 1 }
$installer = Start-Process -FilePath $data.archivePath -ArgumentList @('/S', ('/D=' + $data.appDirectory)) -Wait -PassThru
if ($installer.ExitCode -ne 0) { exit $installer.ExitCode }
Start-Process -FilePath (Join-Path $data.appDirectory 'RDViewer.exe')
`;
}

export function createWindowsUpdateInstaller({ appDirectory, cacheDirectory, appPID = process.pid,
  onReady = () => {}, spawnProcess = spawn, systemRoot = process.env.SystemRoot || 'C:\\Windows' }) {
  return async ({ archivePath, version, sha256 }) => {
    if (!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(version)
      || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(appPID) || appPID <= 0) throw new Error('Invalid update metadata');
    const expected = path.join(cacheDirectory, `RDViewer-${version}-windows-x64-setup.exe`);
    if (archivePath !== expected || !(await lstat(archivePath)).isFile()
      || await realpath(archivePath) !== path.join(await realpath(cacheDirectory), path.basename(expected))) throw new Error('Untrusted update path');
    const digest = createHash('sha256'); for await (const chunk of createReadStream(archivePath)) digest.update(chunk);
    if (digest.digest('hex') !== sha256) throw new Error('Update archive changed');
    const script = updatePowerShell({ archivePath, appDirectory, appPID });
    const helper = spawnProcess(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { detached: true, windowsHide: true, stdio: 'ignore', shell: false });
    await new Promise((resolve, reject) => { helper.once('spawn', resolve); helper.once('error', reject); });
    helper.unref();
    onReady();
  };
}
