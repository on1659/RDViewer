import path from 'node:path';
import { cp, lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export function createWindowsUpdateInstaller({ appDirectory, cacheDirectory, appPID = process.pid,
  helperSource = path.join(appDirectory, 'resources', 'RDViewerUpdater.exe'),
  onReady = () => {}, spawnProcess = spawn, waitForHelper = awaitHelperReady }) {
  return async ({ archivePath, version, sha256 }) => {
    if (!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(version)
      || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(appPID) || appPID <= 0) throw new Error('Invalid update metadata');
    const expected = path.join(cacheDirectory, `RDViewer-${version}-windows-x64-setup.exe`);
    if (archivePath !== expected || !(await lstat(archivePath)).isFile()
      || await realpath(archivePath) !== path.join(await realpath(cacheDirectory), path.basename(expected))) throw new Error('Untrusted update path');
    const digest = createHash('sha256'); for await (const chunk of createReadStream(archivePath)) digest.update(chunk);
    if (digest.digest('hex') !== sha256) throw new Error('Update archive changed');
    const logFile = path.join(cacheDirectory, 'update-result.json');
    const requestFile = path.join(cacheDirectory, 'update-request.json');
    const helperFile = path.join(cacheDirectory, 'RDViewerUpdater.exe');
    await cp(helperSource, helperFile);
    await writeFile(requestFile, `${JSON.stringify({ archivePath, appDirectory, appPID, sha256, version, logFile })}\n`, { mode: 0o600 });
    await writeFile(logFile, `${JSON.stringify({ time: new Date().toISOString(), version, stage: 'starting-helper', detail: '', exitCode: 0 })}\n`, { mode: 0o600 });
    // A GUI executable needs no console. Detached PowerShell exits before its
    // script runs on Node/Windows: https://github.com/nodejs/node/issues/51018.
    // Copy outside the app so the installer can replace every installed file.
    const helper = spawnProcess(helperFile, [requestFile],
      { detached: true, windowsHide: true, stdio: 'ignore', shell: false, cwd: cacheDirectory });
    await new Promise((resolve, reject) => { helper.once('spawn', resolve); helper.once('error', reject); });
    try { await waitForHelper(logFile, helper); }
    catch (error) {
      await writeFile(logFile, `${JSON.stringify({ time: new Date().toISOString(), version, stage: 'helper-startup-failed',
        detail: error.message, exitCode: helper.exitCode, signal: helper.signalCode })}\n`, { mode: 0o600 });
      helper.kill(); helper.unref(); throw error;
    }
    helper.unref();
    onReady();
  };
}

async function awaitHelperReady(logFile, helper) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    let state = {};
    try { state = JSON.parse(await readFile(logFile, 'utf8')); } catch { /* The native helper may be writing its status. */ }
    if (state.stage === 'waiting-for-exit') return;
    if (state.stage === 'error') throw new Error(state.detail || 'The update helper could not start.');
    if (helper.exitCode !== null) throw new Error(`The update helper exited before startup (${helper.exitCode}).`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The update helper did not acknowledge startup.');
}
