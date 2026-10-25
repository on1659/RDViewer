import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
const helperPath = fileURLToPath(import.meta.url);
const bundleID = 'local.radar.folio';
const maximumArchive = 512 * 1024 * 1024;
export const updatesDirectory = () => path.join(os.homedir(), 'Library', 'Application Support', 'RDViewer', 'updates');
const validVersion = (value) => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);

async function run(command, args, options = {}) {
  return (await execute(command, args, { timeout: 30000, maxBuffer: 1024 * 1024, ...options })).stdout.trim();
}
async function sha256(file) { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); }

// Inspect both central and local names before extraction. Our portable packages
// deliberately contain regular files/directories only (no aliases or symlinks).
export async function inspectArchive(file) {
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    if (size < 22 || size > maximumArchive) throw new Error('업데이트 압축 파일의 크기가 올바르지 않습니다.');
    const tail = Buffer.alloc(Math.min(size, 65557));
    await handle.read(tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (tail.readUInt32LE(offset) === 0x06054b50 && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) { end = offset; break; }
    }
    if (end < 0) throw new Error('올바른 ZIP 업데이트 파일이 아닙니다.');
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), start = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || !count || count > 25000 || length > 8 * 1024 * 1024 || start + length > size - tail.length + end) throw new Error('지원하지 않는 ZIP 형식입니다.');
    const directory = Buffer.alloc(length); await handle.read(directory, 0, length, start);
    const names = new Set(); let cursor = 0, unpacked = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > length || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('손상된 ZIP 목록입니다.');
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10);
      const nameLength = directory.readUInt16LE(cursor + 28), extraLength = directory.readUInt16LE(cursor + 30), commentLength = directory.readUInt16LE(cursor + 32);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > length || !nameLength || flags & 1 || ![0, 8].includes(method)) throw new Error('지원하지 않는 ZIP 항목입니다.');
      const bytes = directory.subarray(cursor + 46, cursor + 46 + nameLength), name = bytes.toString('utf8');
      const segments = name.replace(/\/$/, '').split('/');
      if (!Buffer.from(name, 'utf8').equals(bytes) || !name.startsWith('RDViewer.app/') || name.includes('\\') || /[\x00-\x1f\x7f]/.test(name) || segments.some((part) => !part || part === '.' || part === '..') || names.has(name)) throw new Error('안전하지 않은 ZIP 경로입니다.');
      const mode = directory.readUInt32LE(cursor + 38) >>> 16, kind = mode & 0o170000;
      if (kind && kind !== 0o100000 && kind !== 0o040000) throw new Error('ZIP 링크나 특수 파일은 허용하지 않습니다.');
      unpacked += directory.readUInt32LE(cursor + 24);
      if (unpacked > 1024 * 1024 * 1024) throw new Error('업데이트 압축 해제 크기가 너무 큽니다.');
      const local = directory.readUInt32LE(cursor + 42), header = Buffer.alloc(30);
      if (local + 30 > start) throw new Error('손상된 ZIP 항목 위치입니다.');
      await handle.read(header, 0, header.length, local);
      if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(6) !== flags || header.readUInt16LE(8) !== method || header.readUInt16LE(26) !== nameLength) throw new Error('ZIP 항목 정보가 일치하지 않습니다.');
      const localName = Buffer.alloc(nameLength); await handle.read(localName, 0, nameLength, local + 30);
      if (!localName.equals(bytes)) throw new Error('ZIP 경로 정보가 일치하지 않습니다.');
      names.add(name); cursor = next;
    }
    if (cursor !== length || !names.has('RDViewer.app/Contents/Info.plist') || !names.has('RDViewer.app/Contents/MacOS/RDViewer')) throw new Error('RDViewer 앱이 없는 업데이트 파일입니다.');
    return { entries: count, unpacked };
  } finally { await handle.close(); }
}

async function rejectLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('업데이트에 링크나 특수 파일이 있습니다.');
    if (entry.isDirectory()) await rejectLinks(file);
  }
}
async function bundleInfo(bundle) {
  const file = path.join(bundle, 'Contents', 'Info.plist');
  const id = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', file]);
  const version = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', file]);
  if (id !== bundleID || !validVersion(version)) throw new Error('RDViewer 앱 정보를 확인할 수 없습니다.');
  return { id, version };
}
export async function preserveRuntime(staged, installed) {
  const originalRuntime = path.join(installed, 'Contents', 'Resources', 'runtime.json');
  const runtime = JSON.parse(await readFile(originalRuntime, 'utf8'));
  if (typeof runtime.node !== 'string' || !runtime.node || typeof runtime.root !== 'string' || !runtime.root) throw new Error('기존 실행 설정을 읽을 수 없습니다.');
  await cp(originalRuntime, path.join(staged, 'Contents', 'Resources', 'runtime.json'));
}
export async function replaceContents({ staged, installed, backup, verify, launch }) {
  const target = path.join(installed, 'Contents');
  const incoming = path.join(installed, `.update-incoming-${randomUUID()}`);
  let moved = false, replaced = false;
  try {
    // Copy before renaming so updates also work when the app and cache are on
    // different volumes. Every rename below stays on the app's own volume.
    await cp(path.join(staged, 'Contents'), incoming, { recursive: true, errorOnExist: true, force: false });
    await rename(target, backup); moved = true;
    await rename(incoming, target); replaced = true;
    await verify(installed);
    await launch(installed);
  } catch (error) {
    if (replaced) await rm(target, { recursive: true, force: true });
    if (moved) await rename(backup, target);
    throw error;
  } finally { await rm(incoming, { recursive: true, force: true }); }
}

export async function prepareUpdate(input) {
  const { archivePath, version, sha256: expected, appPath, parentPID, serverPID } = input;
  if (!validVersion(version) || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || !Number.isSafeInteger(parentPID) || parentPID <= 1 || !Number.isSafeInteger(serverPID) || serverPID <= 1) throw new Error('업데이트 요청이 올바르지 않습니다.');
  const cache = await realpath(updatesDirectory());
  if (!path.isAbsolute(archivePath) || path.dirname(archivePath) !== cache || !new RegExp(`^RDViewer-${version.replaceAll('.', '\\.')}\\-macos-(arm64|x64)\\.zip$`).test(path.basename(archivePath)) || (await lstat(archivePath)).isSymbolicLink() || await realpath(archivePath) !== archivePath) throw new Error('업데이트 파일 위치가 올바르지 않습니다.');
  if (typeof appPath !== 'string' || !path.isAbsolute(appPath) || path.basename(appPath) !== 'RDViewer.app' || await realpath(appPath) !== appPath || (await lstat(appPath)).isSymbolicLink()) throw new Error('앱 설치 위치가 올바르지 않습니다.');
  await bundleInfo(appPath);
  if (await sha256(archivePath) !== expected) throw new Error('업데이트 파일 검증에 실패했습니다. 다시 내려받아 주세요.');
  await inspectArchive(archivePath);
  const work = path.join(cache, `install-${randomUUID()}`);
  await mkdir(work, { mode: 0o700 });
  try {
    await run('/usr/bin/ditto', ['-x', '-k', archivePath, path.join(work, 'unpacked')]);
    const staged = path.join(work, 'unpacked', 'RDViewer.app');
    await rejectLinks(staged);
    const info = await bundleInfo(staged);
    if (info.version !== version) throw new Error('업데이트 버전이 일치하지 않습니다.');
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
    // Keep workspace paths and external Node configuration. Relative portable
    // values continue to resolve against the updated bundle's resources.
    await preserveRuntime(staged, appPath);
    await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', staged]);
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
    await cp(helperPath, path.join(work, 'install.mjs'));
    const request = { appPath, version, parentPID, serverPID, work, staged, backup: path.join(appPath, `.update-backup-${path.basename(work)}`) };
    const requestPath = path.join(work, 'request.json');
    await writeFile(requestPath, JSON.stringify(request), { mode: 0o600 });
    return { requestPath, helperPath: path.join(work, 'install.mjs') };
  } catch (error) { await rm(work, { recursive: true, force: true }); throw error; }
}

async function processCommand(pid) {
  try { return await run('/bin/ps', ['-p', String(pid), '-o', 'command=']); } catch { return ''; }
}
async function stopOwnedServer(pid, appPath) {
  const command = await processCommand(pid);
  if (!command) return;
  const script = path.join(appPath, 'Contents', 'Resources', 'viewer', 'server.mjs');
  if (!command.includes(` ${script} --root `) || !command.includes(' --port 4317')) throw new Error('RDViewer 문서 서버를 확인할 수 없습니다.');
  process.kill(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 50; attempt++) { if (!await processCommand(pid)) return; await delay(100); }
  throw new Error('문서 서버 종료 시간이 초과되었습니다.');
}
async function launchAndVerify(appPath, expectedVersion) {
  await run('/usr/bin/open', ['-a', appPath]);
  for (let attempt = 0; attempt < 120; attempt++) {
    await delay(250);
    try {
      const response = await fetch('http://127.0.0.1:4317/api/updates', { signal: AbortSignal.timeout(1000) });
      const data = await response.json();
      if (response.ok && data.currentVersion === expectedVersion) return;
    } catch { /* Allow normal launch/server startup time. */ }
  }
  throw new Error('업데이트된 앱을 시작하지 못했습니다. 이전 버전으로 복구합니다.');
}
async function applyUpdate(requestPath) {
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  const { appPath, parentPID, serverPID, staged, work, backup, version } = request;
  const cache = await realpath(updatesDirectory());
  if (path.dirname(work) !== cache || !/^install-[a-f0-9-]{36}$/.test(path.basename(work)) || requestPath !== path.join(work, 'request.json') || staged !== path.join(work, 'unpacked', 'RDViewer.app') || backup !== path.join(appPath, `.update-backup-${path.basename(work)}`) || !validVersion(version)) throw new Error('업데이트 작업 경로가 올바르지 않습니다.');
  for (let attempt = 0; ; attempt++) {
    if (!await processCommand(parentPID)) break;
    if (attempt >= 240) throw new Error('RDViewer 종료를 기다리는 시간이 초과되었습니다.');
    await delay(250);
  }
  await stopOwnedServer(serverPID, appPath);
  let success = false;
  try {
    await replaceContents({ staged, installed: appPath, backup,
      verify: (app) => run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]),
      launch: (app) => launchAndVerify(app, version) });
    success = true;
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    // If a new process started but failed its health check, close only processes
    // whose exact executable/script belongs to this installed bundle.
    try {
      const lines = (await run('/bin/ps', ['-axo', 'pid=,command='])).split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (match && (match[2] === path.join(appPath, 'Contents', 'MacOS', 'RDViewer') || match[2].includes(` ${path.join(appPath, 'Contents', 'Resources', 'viewer', 'server.mjs')} --root `))) process.kill(Number(match[1]), 'SIGTERM');
      }
      await delay(400); await run('/usr/bin/open', ['-a', appPath]);
    } catch { /* Keep rollback contents available even if relaunch is unavailable. */ }
    throw error;
  } finally {
    await writeFile(path.join(cache, 'last-install.json'), JSON.stringify({ version, success, completedAt: new Date().toISOString() }), { mode: 0o600 });
    if (success) await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === helperPath) {
  const [operation, input] = process.argv.slice(2);
  const task = operation === '--prepare' ? prepareUpdate(JSON.parse(input || '{}')) : operation === '--apply' ? applyUpdate(input) : Promise.reject(new Error('지원하지 않는 업데이트 작업입니다.'));
  task.then((result) => { if (result) console.log(JSON.stringify(result)); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
