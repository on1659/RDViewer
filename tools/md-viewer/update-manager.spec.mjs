import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once, EventEmitter } from 'node:events';
import { createUpdateManager, newerVersion, selectRelease, stableVersion, updateAssetName } from './update-manager.mjs';
import { createReaderServer } from './server.mjs';
import { createWindowsUpdateInstaller, updatePowerShell } from './windows/update-install.mjs';

const payload = Buffer.from('verified installer fixture');
const hash = createHash('sha256').update(payload).digest('hex');
const version = '0.9.0';
const name = updateAssetName(version, 'darwin', 'arm64');
const releaseURL = 'https://github.com/on1659/RDViewer';
function release(overrides = {}) {
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets: [
    { name, size: payload.length, browser_download_url: `${releaseURL}/releases/download/v${version}/${name}` },
    { name: `${name}.sha256`, size: 150, browser_download_url: `${releaseURL}/releases/download/v${version}/${name}.sha256` },
  ], ...overrides };
}
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rdviewer-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith('/latest')) return Response.json(release());
    if (url.endsWith('.sha256')) return new Response(`${hash}  ${name}\n`);
    return new Response(payload, { headers: { 'content-length': String(payload.length) } });
  };
  const options = { currentVersion: '0.4.13', platform: 'darwin', arch: 'arm64', supported: true,
    cacheDirectory: path.join(directory, 'updates'), settingsFile: path.join(directory, 'updates.json'), fetcher,
    startupDelay: 100000, ...overrides };
  const manager = await createUpdateManager(options); t.after(() => manager.close());
  return { manager, options, directory, calls };
}
async function waitFor(check) { for (let count = 0; count < 100; count++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('State did not settle'); }

test('release selection accepts only newer stable versions and exact repository assets', () => {
  assert.equal(stableVersion('01.2.3'), null);
  for (const value of ['1.2.3-beta', '1.2', '1.2.3\n', '../1.2.3']) assert.equal(stableVersion(value), null);
  assert.equal(newerVersion('1.0.0', '0.99.99'), true);
  assert.equal(newerVersion('0.4.13', '0.4.13'), false);
  assert.equal(newerVersion('0.4.12', '0.4.13'), false);
  assert.equal(selectRelease(release(), '0.4.13', 'darwin', 'arm64').name, name);
  for (const data of [release({ prerelease: true }), release({ draft: true }), release({ tag_name: 'v0.1.0' }), release({ assets: [] }),
    release({ assets: release().assets.map((entry) => ({ ...entry, browser_download_url: entry.browser_download_url.replace('on1659', 'attacker') })) })]) {
    assert.equal(selectRelease(data, '0.4.13', 'darwin', 'arm64'), null);
  }
  assert.equal(updateAssetName('1.0.0', 'win32', 'x64'), 'RDViewer-1.0.0-windows-x64-setup.exe');
  assert.equal(updateAssetName('1.0.0', 'linux', 'x64'), null);
});

test('unsupported/development manager never contacts network or applies an update', async (t) => {
  const { manager, calls } = await fixture(t, { supported: false, startupDelay: 0 });
  manager.start();
  assert.equal(manager.status().status, 'unsupported');
  await assert.rejects(manager.check(), { status: 409 });
  await assert.rejects(manager.install(), { status: 409 });
  assert.deepEqual(calls, []);
});

test('check coalesces requests and distinguishes initial/offline/successful status', async (t) => {
  let resolve; let count = 0;
  const { manager } = await fixture(t, { fetcher: async () => { count++; return await new Promise((done) => { resolve = done; }); } });
  assert.equal(manager.status().checkedAt, null);
  const first = manager.check(); const second = manager.check();
  assert.equal(count, 1);
  resolve(Response.json(release({ tag_name: 'v0.4.13' })));
  await Promise.all([first, second]);
  assert.equal(manager.status().status, 'idle'); assert.ok(manager.status().checkedAt);
  assert.equal(manager.status().latestVersion, null);
  const offline = await fixture(t, { fetcher: async () => { throw new Error('secret private connection detail'); } });
  await offline.manager.check({ automatic: true });
  assert.equal(offline.manager.status().error, null); assert.equal(offline.manager.status().checkedAt, null);
  await offline.manager.check(); assert.equal(offline.manager.status().status, 'error');
  assert.ok(!JSON.stringify(offline.manager.status()).includes('secret'));
});

test('download streams, verifies, reuses cache, prunes owned archives and rechecks before install', async (t) => {
  let installed;
  const { manager, options, directory, calls } = await fixture(t, { install: async (value) => { installed = value; } });
  await manager.check(); await manager.download();
  assert.equal(manager.status().status, 'ready'); assert.equal(manager.status().progress, 100);
  assert.deepEqual(await readFile(path.join(options.cacheDirectory, name)), payload);
  assert.ok(!JSON.stringify(manager.status()).includes(directory));
  await writeFile(path.join(options.cacheDirectory, 'RDViewer-0.1.0-macos-arm64.zip'), 'old');
  await writeFile(path.join(options.cacheDirectory, 'keep-user-file.zip'), 'keep');
  const next = await createUpdateManager(options); t.after(() => next.close());
  const count = calls.length; await next.check(); await next.download();
  assert.equal(calls.length - count, 2, 'cached archive avoids a second archive download');
  assert.ok(!(await readdir(options.cacheDirectory)).includes('RDViewer-0.1.0-macos-arm64.zip'));
  assert.ok((await readdir(options.cacheDirectory)).includes('keep-user-file.zip'));
  await manager.install(); assert.equal(installed.version, version); assert.equal(installed.sha256, hash);
  assert.equal(manager.status().status, 'installing');
  await assert.rejects(manager.install(), { status: 409 });
  await writeFile(path.join(options.cacheDirectory, name), 'tampered');
  await next.install(); assert.equal(next.status().status, 'error');
});

test('hash mismatch removes partial downloads and never reaches the installer', async (t) => {
  let installed = false;
  const { manager, options } = await fixture(t, { install: async () => { installed = true; }, fetcher: async (url) =>
    url.endsWith('/latest') ? Response.json(release()) : url.endsWith('.sha256') ? new Response(`${'0'.repeat(64)}  ${name}\n`) : new Response(payload) });
  await manager.check(); await manager.download();
  assert.equal(manager.status().status, 'error'); assert.deepEqual(await readdir(options.cacheDirectory), []);
  await assert.rejects(manager.install(), { status: 409 }); assert.equal(installed, false);
});

test('redirects cannot leave approved HTTPS download hosts', async (t) => {
  const visited = [];
  const { manager } = await fixture(t, { fetcher: async (url) => { visited.push(url); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9999/private' } }); } });
  await manager.check(); assert.equal(manager.status().status, 'error'); assert.equal(visited.length, 1);
});

test('automatic update setting persists and disabling cancels automatic traffic', async (t) => {
  let aborted = false; let started = false;
  const { manager, options } = await fixture(t, { startupDelay: 0, fetcher: async (_url, { signal }) => {
    started = true; return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true }));
  } });
  manager.start(); await waitFor(() => started);
  await manager.settings({ autoUpdate: false }); await waitFor(() => aborted);
  const another = await createUpdateManager(options); t.after(() => another.close());
  assert.equal(another.status().autoUpdate, false);
  await assert.rejects(manager.settings({ autoUpdate: true, archivePath: '/tmp/evil.exe' }), { status: 400 });
});

test('HTTP update actions require trusted origin, JSON marker and fixed body', async (t) => {
  const { options, directory } = await fixture(t);
  const server = await createReaderServer(directory, { updateOptions: options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const initial = await (await fetch(`${origin}/api/updates`)).json(); assert.equal(initial.currentVersion, '0.4.13');
  const post = (route, value = {}, headers = {}) => fetch(`${origin}/api/updates/${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1', ...headers }, body: JSON.stringify(value) });
  assert.equal((await post('check', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('check', {}, { 'X-Folio-Request': '' })).status, 403);
  assert.equal((await post('install', { archivePath: '/tmp/malware' })).status, 400);
  assert.equal((await post('settings', { autoUpdate: false })).status, 200);
  assert.equal((await post('check')).status, 202);
  await waitFor(() => server.updates.status().status === 'available');
  assert.equal((await post('download')).status, 202);
  await waitFor(() => server.updates.status().status === 'ready');
});

test('Windows native installer verifies exact cache path and hash, launches only fixed encoded helper', async (t) => {
  const { options } = await fixture(t);
  const { mkdir } = await import('node:fs/promises'); await mkdir(options.cacheDirectory);
  const filename = path.join(options.cacheDirectory, 'RDViewer-0.9.0-windows-x64-setup.exe'); await writeFile(filename, payload);
  let launched; let ready = false;
  const install = createWindowsUpdateInstaller({ appDirectory: '/Apps/RDViewer odd $name', cacheDirectory: options.cacheDirectory,
    appPID: 123, systemRoot: '/Windows', onReady: () => { ready = true; }, spawnProcess: (...args) => {
      launched = args; const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child;
    } });
  await assert.rejects(install({ archivePath: '/tmp/outside.exe', version, sha256: hash }));
  await assert.rejects(install({ archivePath: filename, version, sha256: '0'.repeat(64) }));
  assert.equal(launched, undefined);
  await install({ archivePath: filename, version, sha256: hash }); assert.equal(ready, true);
  assert.equal(launched[2].shell, false); assert.equal(launched[2].detached, true);
  const script = Buffer.from(launched[1].at(-1), 'base64').toString('utf16le');
  assert.ok(script.includes('Wait-Process')); assert.ok(!script.includes('/Apps/RDViewer odd $name'));
  assert.ok(!script.includes('Stop-Process')); assert.ok(script.includes("@('/S', ('/D=' + $data.appDirectory))"));
  assert.equal(script, updatePowerShell({ archivePath: filename, appDirectory: '/Apps/RDViewer odd $name', appPID: 123 }));
});
