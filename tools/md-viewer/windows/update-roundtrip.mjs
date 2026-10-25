// CI only: exercise the production installer adapter with the actual built EXE.
// No fixtures or alternate update endpoints are present in a shipped app.
import { createWindowsUpdateInstaller, updatePowerShell } from './update-install.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [archivePath, appDirectory, cacheDirectory, version, sha256, pid] = process.argv.slice(2);
if (process.platform !== 'win32' || !pid) throw new Error('Windows update smoke arguments are required.');
const script = updatePowerShell({ archivePath, appDirectory, appPID: Number(pid), version, sha256,
  logFile: path.join(cacheDirectory, 'update-result.json') });
const source = Buffer.from(script, 'utf8').toString('base64');
const parse = `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}')); $errors = $null; $tokens = $null; [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | Format-List *; exit 1 }; Write-Output 'Windows PowerShell 5.1 parser accepted the exact updater helper script.'`;
execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(parse, 'utf16le').toString('base64')], { stdio: 'inherit', windowsHide: true });
await createWindowsUpdateInstaller({ appDirectory, cacheDirectory, appPID: Number(pid) })({ archivePath, version, sha256 });
console.log('Verified native updater helper is waiting for normal app exit.');
