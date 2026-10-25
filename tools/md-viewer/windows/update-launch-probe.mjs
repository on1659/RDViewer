// CI-only Windows PowerShell host probe; never included in application builds.
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function probePowerShell(directory) {
  await mkdir(directory, { recursive: true });
  const results = [];
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const conhost = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe');
  for (const options of [
    { name: 'conhost-headless', detached: true, windowsHide: true, conhost: true },
    { name: 'detached-hidden', detached: true, windowsHide: true },
    { name: 'attached-hidden', detached: false, windowsHide: true },
    { name: 'detached-visible', detached: true, windowsHide: false },
    { name: 'attached-visible', detached: false, windowsHide: false },
  ]) {
    const marker = path.join(directory, `${options.name}.marker`);
    const outFile = path.join(directory, `${options.name}.stdout.log`);
    const errFile = path.join(directory, `${options.name}.stderr.log`);
    await rm(marker, { force: true });
    const encodedPath = Buffer.from(marker).toString('base64');
    const script = `[IO.File]::WriteAllText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')), 'ready')`;
    const output = openSync(outFile, 'w'); const errors = openSync(errFile, 'w');
    const arguments_ = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    const child = spawn(options.conhost ? conhost : powershell,
      options.conhost ? ['--headless', powershell, ...arguments_] : arguments_,
      { detached: options.detached, windowsHide: options.windowsHide, stdio: ['ignore', output, errors], shell: false, cwd: directory });
    closeSync(output); closeSync(errors);
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); }, 10000);
      child.once('error', (error) => { clearTimeout(timer); resolve({ error: error.message }); });
      child.once('exit', (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal }); });
    });
    results.push({ name: options.name, ...result, wroteMarker: await readFile(marker, 'utf8').catch(() => null),
      stdout: await readFile(outFile, 'utf8'), stderr: await readFile(errFile, 'utf8') });
    if (results.at(-1).wroteMarker === 'ready') {
      const survivor = path.join(directory, `${options.name}.survived-parent.marker`);
      const survivorPath = Buffer.from(survivor).toString('base64');
      const survivorScript = `Start-Sleep -Seconds 2; [IO.File]::WriteAllText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${survivorPath}')), 'survived')`;
      const survivorArguments = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(survivorScript, 'utf16le').toString('base64')];
      const configuration = { executable: options.conhost ? conhost : powershell,
        arguments: options.conhost ? ['--headless', powershell, ...survivorArguments] : survivorArguments,
        options: { detached: options.detached, windowsHide: options.windowsHide, stdio: 'ignore', shell: false, cwd: directory } };
      const parentSource = "const {spawn}=require('node:child_process');const c=JSON.parse(process.argv[1]);const child=spawn(c.executable,c.arguments,c.options);child.once('spawn',()=>{child.unref();console.log('launcher exiting before marker');});child.once('error',e=>{console.error(e);process.exitCode=1;});";
      const launcher = spawn(process.execPath, ['-e', parentSource, JSON.stringify(configuration)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let text = ''; launcher.stdout.on('data', (value) => { text += value; }); launcher.stderr.on('data', (value) => { text += value; });
      const launcherExit = await new Promise((resolve) => launcher.once('exit', resolve));
      const exitedBeforeMarker = await readFile(survivor, 'utf8').catch(() => null) === null;
      await new Promise((resolve) => setTimeout(resolve, 3500));
      results.at(-1).parentExitSurvival = { launcherExit, exitedBeforeMarker, marker: await readFile(survivor, 'utf8').catch(() => null), text };
    }
  }
  console.log(JSON.stringify({ powerShellHostProbe: results }));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== 'win32' || !process.argv[2]) throw new Error('Windows probe directory is required.');
  await probePowerShell(process.argv[2]);
}
