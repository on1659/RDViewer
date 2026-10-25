import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const repository = 'https://github.com/on1659/RDViewer';
const latestEndpoint = 'https://api.github.com/repos/on1659/RDViewer/releases/latest';
const maximumArchive = 512 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
export function stableVersion(value) {
  return typeof value === 'string' && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value) ? value : null;
}
export function newerVersion(candidate, current) {
  if (!stableVersion(candidate) || !stableVersion(current)) return false;
  const a = candidate.split('.').map(Number); const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function updateAssetName(version, platform, arch) {
  if (!stableVersion(version)) return null;
  if (platform === 'win32' && arch === 'x64') return `RDViewer-${version}-windows-x64-setup.exe`;
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return `RDViewer-${version}-macos-${arch}.zip`;
  return null;
}
export function selectRelease(value, current, platform, arch) {
  const version = typeof value?.tag_name === 'string' ? stableVersion(value.tag_name.slice(1)) : null;
  if (!version || value.tag_name !== `v${version}` || value.draft || value.prerelease || !newerVersion(version, current)) return null;
  const name = updateAssetName(version, platform, arch);
  if (!name || !Array.isArray(value.assets)) return null;
  const assetURL = (filename) => `${repository}/releases/download/v${version}/${filename}`;
  const find = (filename) => value.assets.find((asset) => asset.name === filename && asset.browser_download_url === assetURL(filename)
    && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= (filename.endsWith('.sha256') ? 4096 : maximumArchive));
  const archive = find(name); const checksum = find(`${name}.sha256`);
  if (!archive || !checksum) return null;
  return { version, name, size: archive.size, url: assetURL(name), checksumURL: assetURL(`${name}.sha256`), releaseURL: `${repository}/releases/tag/v${version}` };
}
async function request(url, { fetcher, signal }) {
  let current = url;
  for (let count = 0; count < 6; count++) {
    const parsed = new URL(current);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
      || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname)) throw new Error('Untrusted update address');
    const response = await fetcher(current, { redirect: 'manual', signal, headers: { 'User-Agent': 'RDViewer-Updater', Accept: 'application/vnd.github+json' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('Missing update redirect');
      current = new URL(location, current).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Update request failed'); }
    return response;
  }
  throw new Error('Too many update redirects');
}
async function smallResponse(response, limit) {
  const chunks = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length; if (length > limit) { throw new Error('Update metadata too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function digestFile(filename) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest('hex');
}

export async function createUpdateManager({
  currentVersion = '0.0.0', platform = process.platform, arch = process.arch,
  supported = false, cacheDirectory, settingsFile, install = async () => {},
  fetcher = globalThis.fetch, startupDelay = 15000, interval = 6 * 60 * 60 * 1000,
} = {}) {
  supported = supported && !!stableVersion(currentVersion) && !!updateAssetName(currentVersion, platform, arch) && !!cacheDirectory && !!settingsFile;
  let autoUpdate = true;
  if (settingsFile) {
    try { const saved = JSON.parse(await readFile(settingsFile, 'utf8')); if (typeof saved.autoUpdate === 'boolean') autoUpdate = saved.autoUpdate; } catch { /* Defaults survive corrupt/missing settings. */ }
  }
  let state = supported ? 'idle' : 'unsupported'; let progress = 0; let error = null; let latest = null; let checkedAt = null;
  let staged = null; let operation = null; let automaticOperation = false; let stopped = false; let startupTimer; let periodicTimer; let controller;
  const status = () => ({ supported, currentVersion, latestVersion: latest?.version ?? null, checkedAt, status: state, autoUpdate, progress,
    releaseURL: latest?.releaseURL ?? `${repository}/releases/latest`, error });
  const required = () => { if (!supported) throw fail(409, '설치된 RDViewer 앱에서 업데이트할 수 있습니다.'); };
  async function settings(value) {
    if (typeof value?.autoUpdate !== 'boolean' || Object.keys(value).some((key) => key !== 'autoUpdate')) throw fail(400, '자동 업데이트 설정을 확인하세요.');
    required();
    await mkdir(path.dirname(settingsFile), { recursive: true, mode: 0o700 });
    const temporary = `${settingsFile}.${randomUUID()}.tmp`;
    try { await writeJSON(temporary, { autoUpdate: value.autoUpdate }); await rename(temporary, settingsFile); }
    finally { await rm(temporary, { force: true }); }
    autoUpdate = value.autoUpdate;
    if (!autoUpdate && automaticOperation) controller?.abort();
    if (autoUpdate) void background();
    return status();
  }
  async function check({ automatic = false } = {}) {
    required();
    if (operation || ['ready', 'installing'].includes(state)) return operation ?? status();
    state = 'checking'; error = null; progress = 0;
    automaticOperation = automatic;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); timeout.unref?.();
    operation = (async () => {
      try {
        const response = await request(latestEndpoint, { fetcher, signal: controller.signal });
        latest = selectRelease(JSON.parse(await smallResponse(response, 1024 * 1024)), currentVersion, platform, arch);
        checkedAt = new Date().toISOString();
        state = latest ? 'available' : 'idle';
      } catch {
        state = automatic ? (latest ? 'available' : 'idle') : 'error';
        if (!automatic) error = '업데이트를 확인하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도하세요.';
      } finally { clearTimeout(timeout); operation = null; controller = null; automaticOperation = false; }
      return status();
    })();
    return operation;
  }
  async function download({ automatic = false } = {}) {
    required();
    if (operation || ['ready', 'installing'].includes(state)) return operation ?? status();
    if (!latest) throw fail(409, '먼저 새 버전을 확인하세요.');
    const release = latest;
    state = 'downloading'; error = null; progress = 0;
    automaticOperation = automatic;
    controller = new AbortController(); const signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); timeout.unref?.();
    operation = (async () => {
      let temporary;
      try {
        const checksumResponse = await request(release.checksumURL, { fetcher, signal });
        const checksumText = await smallResponse(checksumResponse, 4096);
        const checksum = /^([a-fA-F0-9]{64})  (\S+)\r?\n?$/.exec(checksumText);
        if (!checksum || checksum[2] !== release.name) throw new Error('Invalid update checksum');
        const sha256 = checksum[1].toLowerCase();
        await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
        const filename = path.join(cacheDirectory, release.name);
        let cached = false;
        try { const info = await lstat(filename); cached = info.isFile() && info.size === release.size && await digestFile(filename) === sha256; } catch { /* No verified cached archive. */ }
        if (!cached) {
          temporary = path.join(cacheDirectory, `${release.name}.${randomUUID()}.part`);
          const response = await request(release.url, { fetcher, signal });
          const declared = response.headers.get('content-length');
          if (declared && (!/^\d+$/.test(declared) || Number(declared) !== release.size)) { await response.body?.cancel(); throw new Error('Invalid archive length'); }
          const file = await open(temporary, 'wx', 0o600); const digest = createHash('sha256'); let length = 0;
          try {
            for await (const chunk of response.body ?? []) {
              length += chunk.length; if (length > release.size || length > maximumArchive) throw new Error('Update archive too large');
              digest.update(chunk); await file.writeFile(chunk); progress = Math.min(99, Math.floor(length / release.size * 100));
            }
            if (length !== release.size || digest.digest('hex') !== sha256) throw new Error('Update verification failed');
          } finally { await file.close(); }
          await rename(temporary, filename); temporary = null;
        }
        staged = { archivePath: filename, version: release.version, sha256 };
        progress = 100; state = 'ready';
        // Keep only this verified update; never touch unrelated files or user data.
        for (const entry of await readdir(cacheDirectory)) {
          if (entry !== release.name && /^RDViewer-\d+\.\d+\.\d+-(?:windows-x64-setup\.exe|macos-(?:arm64|x64)\.zip)$/.test(entry)) {
            await rm(path.join(cacheDirectory, entry), { force: true }).catch(() => {});
          }
        }
      } catch {
        staged = null; progress = 0; state = automatic ? 'available' : 'error';
        if (!automatic) error = '업데이트를 내려받거나 검증하지 못했어요. 다시 시도하세요.';
      } finally { if (temporary) await rm(temporary, { force: true }).catch(() => {}); clearTimeout(timeout); operation = null; controller = null; automaticOperation = false; }
      return status();
    })();
    return operation;
  }
  async function apply() {
    required();
    if (operation || state !== 'ready' || !staged) throw fail(409, '업데이트 다운로드를 먼저 완료하세요.');
    state = 'installing'; error = null;
    try {
      const info = await lstat(staged.archivePath);
      if (!info.isFile() || info.size !== latest.size || await digestFile(staged.archivePath) !== staged.sha256) throw new Error('Update archive changed');
      await install({ ...staged });
    } catch {
      state = 'error'; staged = null; progress = 0;
      error = '업데이트를 적용하지 못했어요. 앱은 현재 버전으로 계속 사용할 수 있습니다.';
    }
    return status();
  }
  async function background() {
    if (stopped || !supported || !autoUpdate) return;
    await check({ automatic: true }).catch(() => {});
    if (!stopped && autoUpdate && state === 'available') await download({ automatic: true }).catch(() => {});
  }
  function start() {
    if (!supported || stopped || startupTimer || periodicTimer) return;
    startupTimer = setTimeout(() => { startupTimer = null; void background(); }, startupDelay); startupTimer.unref?.();
    periodicTimer = setInterval(() => { void background(); }, interval); periodicTimer.unref?.();
  }
  function close() { stopped = true; clearTimeout(startupTimer); clearInterval(periodicTimer); controller?.abort(); }
  return { status, settings, check, download, install: apply, start, close };
}

async function writeJSON(filename, value) {
  const file = await open(filename, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value)}\n`); } finally { await file.close(); }
}
