import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizePreviewURL } from './public/preview-url.mjs';
import { createReaderServer } from './server.mjs';

test('local URL normalization preserves explicit HTTPS, queries, hash routes and dot-segment semantics', () => {
  assert.equal(normalizePreviewURL('localhost:5014/app'), 'http://localhost:5014/app');
  assert.equal(normalizePreviewURL('  127.0.0.1:5014/a/../web?name=한글#route  '), 'http://127.0.0.1:5014/web?name=%ED%95%9C%EA%B8%80#route');
  assert.equal(normalizePreviewURL('HTTPS://LOCALHOST:5014/app'), 'https://localhost:5014/app');
  assert.equal(normalizePreviewURL('https://127.0.0.1:5014'), 'https://127.0.0.1:5014/');
  assert.equal(normalizePreviewURL('[::1]:5014/'), 'http://[::1]:5014/');
  assert.equal(normalizePreviewURL('https://[::1]:5014/index.html'), 'https://[::1]:5014/index.html');
  assert.equal(normalizePreviewURL('http://localhost:80/'), 'http://localhost/');
  assert.equal(normalizePreviewURL('localhost/path with spaces'), 'http://localhost/path%20with%20spaces');
});

test('URL input rejects remote servers, credentials, ambiguous hosts, invalid ports, controls and non-web protocols', () => {
  for (const input of [null, '', ' ', 'x'.repeat(8193), 'http://localhost:0', 'http://localhost:65536',
    `http://localhost:5014/?name=${'한'.repeat(1000)}`,
    'http://localhost:', 'localhost:abc', 'https:localhost:5014', 'javascript:alert(1)', 'file:///tmp/index.html',
    'data:text/html,hello', 'ftp://localhost:5014', '//localhost:5014', 'http://local\nhost:5014',
    'http://localhost:5014/\tfoo', 'http://localhost:5014/\u007f', 'http://localhost:5014\\@example.com']) {
    assert.throws(() => normalizePreviewURL(input), undefined, String(input));
  }
  for (const input of ['https://example.com', 'http://127.0.0.2:5014', 'http://192.168.1.1:5014',
    'http://user:pass@localhost:5014', 'http://@localhost:5014', 'http://localhost.evil.example',
    'http://127.1:5014', 'http://2130706433:5014', 'http://0x7f000001:5014',
    'http://%6cocalhost:5014', 'http://localhost.:5014', 'http://[::ffff:127.0.0.1]:5014']) {
    assert.throws(() => normalizePreviewURL(input), { status: 403 }, input);
  }
});

test('reader and preview ports are forbidden across loopback aliases, schemes and default-port spellings', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const scheme of ['http', 'https']) {
      for (const port of ['4317', '04317', '4318', '5015']) {
        assert.throws(() => normalizePreviewURL(`${scheme}://${host}:${port}/`, { blockedPorts: [5015] }), { status: 403 });
      }
      assert.throws(() => normalizePreviewURL(`${scheme}://${host}:5016/`, { blockedOrigins: ['http://127.0.0.1:5016'] }), { status: 403 });
    }
  }
  assert.throws(() => normalizePreviewURL('http://127.0.0.1:80/', { blockedOrigins: ['http://localhost'] }), { status: 403 });
  assert.equal(normalizePreviewURL('https://localhost:5014/', { blockedPorts: ['', null], blockedOrigins: ['not a URL'] }), 'https://localhost:5014/');
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'rdviewer-local-url-'));
  const reader = await createReaderServer(directory);
  reader.listen(0, '127.0.0.1'); await once(reader, 'listening'); await reader.automationReady;
  const origin = `http://127.0.0.1:${reader.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Folio-Request': '1' };
  const post = (input, extra = {}) => fetch(`${origin}/api/preview/open`, { method: 'POST',
    headers: { ...headers, ...extra }, body: JSON.stringify({ input }) });
  const token = reader.automation.descriptor().token;
  const native = (route, method = 'GET', value) => fetch(`${origin}/api/automation/${route}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(value ? { body: JSON.stringify(value) } : {}),
  });
  t.after(async () => { reader.closeAllConnections(); await new Promise((done) => reader.close(done)); await rm(directory, { recursive: true, force: true }); });
  return { directory, reader, origin, post, native };
}

test('browser local-server previews retain strict frame CSP and local file previews still work', async (t) => {
  const f = await fixture(t);
  let requests = 0;
  const development = http.createServer((_req, res) => { requests++; res.end('<h1>Local development app</h1>'); });
  development.listen(0, '127.0.0.1'); await once(development, 'listening');
  t.after(() => { development.closeAllConnections(); development.close(); });
  const port = development.address().port;
  const response = await f.post(`127.0.0.1:${port}/a/../app?x=1#route`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result, { native: false, previewURL: `http://127.0.0.1:${port}/app?x=1#route` });
  assert.equal(requests, 0, 'opening an address never proxies arbitrary HTTP through the reader');
  assert.match(await (await fetch(result.previewURL)).text(), /Local development app/);
  assert.equal(requests, 1);
  assert.equal((await (await f.post('https://localhost:5014/')).json()).previewURL, 'https://localhost:5014/');
  const ipv6 = await f.post('http://[::1]:5014/'); assert.equal(ipv6.status, 409); assert.match((await ipv6.json()).error, /localhost/);
  const page = await fetch(f.origin);
  const frameSources = /frame-src ([^;]+)/.exec(page.headers.get('content-security-policy'))[1].split(' ');
  assert.deepEqual(frameSources, ['http://127.0.0.1:*', 'https://127.0.0.1:*', 'http://localhost:*', 'https://localhost:*']);
  const module = await fetch(`${f.origin}/preview-url.mjs`); assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
  await writeFile(path.join(f.directory, 'local.html'), '<h1>Local file</h1>');
  assert.equal((await f.post(pathToFileURL(path.join(f.directory, 'local.html')).href)).status, 200);
  const localFile = await (await f.post('local.html')).json(); assert.match(localFile.previewURL, /127\.0\.0\.1:\d+\/session\//);
  const previewPort = new URL(localFile.previewURL).port;
  assert.equal((await f.post(`http://localhost:${previewPort}/`)).status, 403);
  assert.equal((await f.post(`${f.origin}/`)).status, 403);
  assert.equal((await f.post(`https://localhost:${new URL(f.origin).port}/`)).status, 403);
  const build = await readFile(new URL('./windows/build.mjs', import.meta.url), 'utf8'); assert.ok(build.includes("'public/preview-url.mjs'"));
});

test('preview opening requires its UI marker, safe origin and bounded JSON', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.post('http://localhost:5014', { 'X-Folio-Request': '' })).status, 403);
  assert.equal((await f.post('http://localhost:5014', { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.post('http://localhost:5014', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.post('http://localhost:5014', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.post('x'.repeat(8193))).status, 400);
  assert.equal((await f.post('x'.repeat(33000))).status, 413);
  assert.equal((await f.post('https://example.com/')).status, 403);
});

test('native previews receive canonical loopback URLs, including HTTPS and IPv6, through the existing command queue', async (t) => {
  const f = await fixture(t);
  await f.native('register', 'POST', { platform: 'test', capabilities: ['open'] });
  for (const input of ['localhost:5014/app/../index.html', 'https://127.0.0.1:5014/', 'https://[::1]:5014/']) {
    const pending = f.post(input);
    const { command } = await (await f.native('next')).json();
    assert.equal(command.action, 'open');
    assert.deepEqual(command.args, { kind: 'url', url: normalizePreviewURL(input), previewURL: normalizePreviewURL(input) });
    await f.native('result', 'POST', { id: command.id, result: { opened: true } });
    assert.equal((await (await pending).json()).native, true);
  }
});
