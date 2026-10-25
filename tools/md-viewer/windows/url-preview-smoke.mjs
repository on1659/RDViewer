// CI-only test driver. This file and its HTTP fixture never enter an app build.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [installDirectory, descriptorFile] = process.argv.slice(2);
if (process.platform !== 'win32' || !installDirectory || !descriptorFile) throw new Error('The installed Windows app and descriptor paths are required.');
const run = promisify(execFile);
const executable = path.join(installDirectory, 'RDViewer.exe');
const cli = path.join(installDirectory, 'resources', 'agent', 'cli.mjs');
const descriptor = JSON.parse(await readFile(descriptorFile, 'utf8'));
assert.equal(descriptor.baseURL, 'http://127.0.0.1:4318');
const origin = descriptor.baseURL;
const timeout = setTimeout(() => { console.error('Windows installed URL preview smoke exceeded 75 seconds.'); process.exit(1); }, 75000);

async function installedCLI(...args) {
  const { stdout } = await run(executable, [cli, ...args, '--descriptor', descriptorFile], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}
async function openURL(input) {
  const response = await fetch(`${origin}/api/preview/open`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1' },
    body: JSON.stringify({ input }), signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, value: await response.json() };
}
async function previewState() {
  const response = await fetch(`${origin}/api/preview/status`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200); return (await response.json()).state;
}
async function until(check, description, milliseconds = 6000) {
  const end = Date.now() + milliseconds;
  let lastError;
  while (Date.now() < end) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`);
}

let relativeRequests = 0;
const fixture = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (pathname === '/fixture/data.json') {
    relativeRequests++; response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ message: 'relative fetch ready' })); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (pathname === '/fixture/index.html') {
    response.end(`<!doctype html><meta charset="utf-8"><title>RDViewer URL fixture</title>
<h1>Installed local URL preview</h1><p id="loaded">waiting for relative fetch</p>
<button id="increment">Increment</button><output id="count">0</output>
<a id="next" href="/next.html?from=fixture#arrived">Next local page</a>
<script>
document.querySelector('#increment').onclick = () => { document.querySelector('#count').textContent = 'clicked 1'; };
fetch('./data.json').then(r => r.json()).then(v => { document.querySelector('#loaded').textContent = v.message; });
</script>`); return;
  }
  if (pathname === '/next.html') {
    response.end('<!doctype html><meta charset="utf-8"><title>Next URL fixture</title><h1>Local URL navigation arrived</h1>'); return;
  }
  response.writeHead(404); response.end('Not found');
});

try {
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  const port = fixture.address().port;
  const initialURL = `http://localhost:${port}/fixture/index.html?start=1#begin`;
  const opened = await openURL(`localhost:${port}/fixture/index.html?start=1#begin`);
  assert.equal(opened.status, 200, JSON.stringify(opened.value));
  assert.equal(opened.value.native, true); assert.equal(opened.value.action, 'open');
  assert.equal(opened.value.result.url, initialURL, 'bare URL must reach the native preview as canonical HTTP');
  await until(async () => (await installedCLI('snapshot')).result.text.includes('relative fetch ready'), 'relative fetch in the installed URL preview');
  assert.ok(relativeRequests >= 1, 'relative requests must reach the local fixture server');
  await installedCLI('click', '#increment');
  assert.ok((await installedCLI('snapshot')).result.text.includes('clicked 1'));
  const expectedNext = `http://localhost:${port}/next.html?from=fixture#arrived`;
  // Navigation can dispose the JS evaluation context after the real click.
  // Accept that race only if both the native state and next-page content prove it.
  let navigationError;
  try { await installedCLI('click', '#next'); } catch (error) { navigationError = error; }
  try {
    await until(async () => (await previewState()).url === expectedNext, 'published URL after an in-preview link click');
    assert.ok((await installedCLI('snapshot')).result.text.includes('Local URL navigation arrived'));
  } catch (error) { throw new Error(`${error.message}${navigationError ? `; link command: ${navigationError.message}` : ''}`); }
  await installedCLI('close');
  assert.equal((await previewState()).previewOpen, false);
  fixture.closeAllConnections(); await new Promise((resolve) => fixture.close(resolve));
  const unavailable = await openURL(`http://localhost:${port}/unavailable.html`);
  assert.equal(unavailable.status, 422, JSON.stringify(unavailable.value));
  assert.match(unavailable.value.error, /로컬 서버에 연결할 수 없어요/);
  await until(async () => {
    const state = await previewState(); return state.previewOpen === false && state.activePreviewCount === 0;
  }, 'failed URL preview cleanup');
  console.log('Installed EXE: bare localhost URL, relative fetch, native button/link navigation, published current URL, friendly connection-refused error and preview cleanup passed.');
} finally {
  await installedCLI('close').catch(() => {});
  fixture.closeAllConnections(); if (fixture.listening) await new Promise((resolve) => fixture.close(resolve));
  clearTimeout(timeout);
}
