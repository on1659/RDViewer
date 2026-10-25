import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createFontCatalog, createSystemFontProvider, normalizeFontCatalog } from './font-catalog.mjs';
import { createReaderServer } from './server.mjs';

test('font catalog keeps canonical/localized names, deduplicates and strips private metadata', () => {
  const fonts = normalizeFontCatalog([
    { family: ' Malgun Gothic ', displayName: '맑은 고딕', location: 'C:\\Users\\private\\font.ttf', bytes: 'never exposed' },
    'malgun gothic', 'Arial', { family: "O'Ryan & Sons (UI)", displayName: "O'Ryan & Sons (UI)" },
    '.PrivateSystemFont', { family: '/private/font.ttf', displayName: 'Bad path' },
    { family: 'Safe Family', displayName: 'https://private/font.ttf' },
    { family: 'Cafe\u0301', displayName: 'Café' }, 'Café', 'YuMincho +36p Kana',
  ]);
  assert.equal(fonts.length, 6);
  assert.deepEqual(fonts.find((font) => font.family === 'YuMincho +36p Kana'), { family: 'YuMincho +36p Kana', displayName: 'YuMincho +36p Kana' });
  assert.deepEqual(fonts.find((font) => font.family === 'Malgun Gothic'), { family: 'Malgun Gothic', displayName: '맑은 고딕' });
  assert.deepEqual(fonts.find((font) => font.family === 'Safe Family'), { family: 'Safe Family', displayName: 'Safe Family' });
  assert.equal(fonts.filter((font) => font.family === 'Café').length, 1);
  assert.equal(fonts.every((font) => Object.keys(font).sort().join(',') === 'displayName,family'), true);
  assert.doesNotMatch(JSON.stringify(fonts), /private|bytes|location/);
  assert.equal(normalizeFontCatalog(Array.from({ length: 2100 }, (_, i) => `Family ${i}`)).length, 2000);
  assert.equal(normalizeFontCatalog(['Zeta', 'Alpha'], 1)[0].family, 'Alpha');
});

test('font discovery is lazy, cached and coalesces concurrent refreshes', async () => {
  let calls = 0, clock = 0, release;
  const wait = new Promise((resolve) => { release = resolve; });
  const catalog = createFontCatalog({ now: () => clock, cacheMs: 50, provider: async () => { calls++; await wait; return ['Arial']; } });
  assert.equal(calls, 0);
  const first = catalog.list();
  const second = catalog.list({ refresh: true });
  assert.equal(first, second);
  assert.equal(calls, 1);
  release();
  const result = await first;
  assert.deepEqual(result, { fonts: [{ family: 'Arial', displayName: 'Arial' }], available: true });
  await catalog.list();
  assert.equal(calls, 1);
  assert.equal(Object.isFrozen(result.fonts), true);
  clock = 51;
  await catalog.list();
  assert.equal(calls, 2);
  await catalog.list({ refresh: true });
  assert.equal(calls, 3);
});

test('unavailable catalogs expose no process errors or paths and retry can recover immediately', async () => {
  let calls = 0;
  const catalog = createFontCatalog({ provider: async () => { if (++calls === 1) throw new Error('/Users/private/secrets fonts stdout'); return ['Recovered Font']; } });
  const failed = await catalog.list();
  assert.equal(failed.available, false);
  assert.deepEqual(failed.fonts, []);
  assert.doesNotMatch(JSON.stringify(failed), /private|secrets|stdout/);
  assert.equal(typeof failed.error, 'string');
  await catalog.list();
  assert.equal(calls, 1);
  assert.equal((await catalog.list({ refresh: true })).available, true);
  assert.equal(calls, 2);
  assert.equal((await createFontCatalog({ provider: async () => [] }).list()).available, false);
});

test('Mac provider executes only its dedicated helper with bounded fixed arguments', async () => {
  const calls = [];
  const directory = '/Applications/RDViewer.app/Contents/Resources/viewer';
  const expected = path.resolve(directory, '../../MacOS/RDViewerFontCatalog');
  const provider = createSystemFontProvider({ platform: 'darwin', directory, executable: async (filename) => filename === expected, run: async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: JSON.stringify([{ family: 'Hiragino Sans', displayName: '히라기노 산스' }]) };
  } });
  assert.equal((await provider())[0].family, 'Hiragino Sans');
  assert.equal(calls[0].file, expected);
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout <= 10_000, true);
  assert.equal(calls[0].options.maxBuffer <= 8 * 1024 * 1024, true);
  const broken = createSystemFontProvider({ platform: 'darwin', directory, executable: async () => true, run: async (file) => { assert.match(file, /RDViewerFontCatalog$/); throw new Error('broken helper'); } });
  await assert.rejects(broken(), /broken helper/, 'an existing broken helper never runs the GUI or another command');
});

test('Mac profiler fallback extracts only family metadata when no helper exists', async () => {
  const provider = createSystemFontProvider({ platform: 'darwin', executable: async () => false, run: async (file, args, options) => {
    assert.equal(file, '/usr/sbin/system_profiler');
    assert.deepEqual(args, ['SPFontsDataType', '-json']);
    assert.equal(options.shell, false);
    return { stdout: JSON.stringify({ SPFontsDataType: [{ _name: 'Private file.ttf', location: '/private/file.ttf', typefaces: [{ family: 'Canonical Family', localized_family: '지역 글꼴', path: '/private/file.ttf' }] }] }) };
  } });
  assert.deepEqual(await provider(), [{ family: 'Canonical Family', displayName: '지역 글꼴' }]);
});

test('Windows font provider uses fixed no-profile UTF-8 PowerShell and localized family names', async () => {
  const provider = createSystemFontProvider({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, run: async (file, args, options) => {
    assert.equal(file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
    assert.match(args[4], /InstalledFontCollection/);
    assert.match(args[4], /CurrentUICulture/);
    assert.match(args[4], /UTF8Encoding/);
    assert.match(args[4], /\.Dispose\(\)/);
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, false);
    return { stdout: '\uFEFF[{"family":"Malgun Gothic","displayName":"맑은 고딕"}]' };
  } });
  assert.deepEqual(await provider('untrusted request must never enter args'), [{ family: 'Malgun Gothic', displayName: '맑은 고딕' }]);
});

test('Linux fontconfig provider is optional and never reads font files itself', async () => {
  const provider = createSystemFontProvider({ platform: 'linux', run: async (file, args) => {
    assert.equal(file, '/usr/bin/fc-list');
    assert.deepEqual(args, ['--format', '%{family}\n']);
    return { stdout: 'Noto Sans,Noto Sans Korean\nArial\n' };
  } });
  assert.deepEqual(normalizeFontCatalog(await provider()).map((font) => font.family), ['Arial', 'Noto Sans', 'Noto Sans Korean']);
  await assert.rejects(createSystemFontProvider({ platform: 'other' })());
});

test('fonts API shares local-origin guards, exposes names only and refreshes without user process input', async (t) => {
  let calls = 0;
  const server = await createReaderServer(fileURLToPath(new URL('.', import.meta.url)), { fontProvider: async (...args) => {
    assert.deepEqual(args, []);
    calls++;
    return [{ family: 'Arial', displayName: 'Arial', path: '/private/never' }];
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(calls, 0);
  for (const options of [{ method: 'POST' }, { headers: { origin: 'https://example.com' } }, { headers: { 'sec-fetch-site': 'cross-site' } }]) {
    assert.equal((await fetch(`${base}/api/fonts`, options)).status >= 400, true);
  }
  assert.equal(calls, 0);
  const response = await fetch(`${base}/api/fonts?family=unexpected-shell-input`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { fonts: [{ family: 'Arial', displayName: 'Arial' }], available: true });
  await fetch(`${base}/api/fonts`);
  assert.equal(calls, 1);
  await fetch(`${base}/api/fonts?refresh=1`);
  assert.equal(calls, 2);
  const failed = await createReaderServer(fileURLToPath(new URL('.', import.meta.url)), { fontProvider: async () => { throw new Error('/private/provider failure'); } });
  await new Promise((resolve) => failed.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => failed.close(resolve)));
  const unavailable = await (await fetch(`http://127.0.0.1:${failed.address().port}/api/fonts`)).json();
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.fonts, []);
  assert.doesNotMatch(unavailable.error, /private|provider/);
});

test('Mac helper and Windows catalog are included in build and installed-app checks', async () => {
  const mac = await readFile(new URL('./macos/build.mjs', import.meta.url), 'utf8');
  const win = await readFile(new URL('./windows/build.mjs', import.meta.url), 'utf8');
  const smoke = await readFile(new URL('./windows/installer-smoke.ps1', import.meta.url), 'utf8');
  assert.match(mac, /FontCatalog\.swift/);
  assert.match(mac, /RDViewerFontCatalog/);
  assert.match(mac, /codesign.*fontHelper/);
  assert.match(mac, /'font-catalog\.mjs'/);
  assert.match(win, /'font-catalog\.mjs'/);
  assert.match(smoke, /\$origin\/api\/fonts/);
});
