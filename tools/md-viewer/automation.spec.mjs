import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReaderServer } from './server.mjs';
import { validateCommand } from './automation-server.mjs';
import { parseCLI, callAutomation } from './cli.mjs';

async function fixture(t, persisted = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rdviewer-agent-'));
  const root = path.join(directory, 'root'); await mkdir(root);
  const descriptor = persisted ? path.join(directory, 'private', 'automation.json') : null;
  const server = await createReaderServer(root, { automationFile: descriptor });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); await server.automationReady;
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = server.automation.descriptor().token;
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = (route, method = 'GET', body) => fetch(`${base}${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const ui = (route, input) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1' }, body: JSON.stringify(input) });
  return { directory, root, server, base, token, descriptor, headers, request, ui };
}

test('HTML preview uses a separate origin, serves local assets, and rejects API, hidden, traversal and worker access', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '.preview.html'), '<!doctype html><script type="module" src="/app.js"></script><h1>Preview</h1>');
  await writeFile(path.join(f.root, 'app.js'), 'export const message="hello";');
  await writeFile(path.join(f.root, 'automation.json'), '{"token":"private"}');
  await writeFile(path.join(f.root, '.env'), 'secret'); await mkdir(path.join(f.root, '.git')); await writeFile(path.join(f.root, '.git', 'config'), 'private');
  await writeFile(path.join(f.directory, 'outside.js'), 'outside'); await symlink(path.join(f.directory, 'outside.js'), path.join(f.root, 'escape.js'));
  const tree = await (await fetch(`${f.base}/api/tree`)).json(); assert.equal(tree.files.find((file) => file.name === '.preview.html').kind, 'html');
  const metadata = await (await fetch(`${f.base}/api/file?path=.preview.html`)).json();
  assert.equal(metadata.kind, 'html'); assert.equal(metadata.content, undefined);
  assert.equal(metadata.previewURL, null);
  const mounted = await (await f.ui('/api/preview/open', { input: '.preview.html' })).json();
  metadata.previewURL = mounted.previewURL;
  const initial = await fetch(metadata.previewURL, { redirect: 'manual' }); assert.equal(initial.status, 302);
  const cookie = initial.headers.get('set-cookie').split(';')[0]; const origin = new URL(metadata.previewURL).origin;
  const get = (file, extra = {}) => fetch(`${origin}${file}`, { headers: { Cookie: cookie, ...extra } });
  assert.match(await (await get(initial.headers.get('location'))).text(), /Preview/);
  const script = await get('/app.js'); assert.equal(script.status, 200); assert.match(script.headers.get('content-type'), /javascript/); assert.match(await script.text(), /hello/);
  assert.equal((await fetch(`${origin}/app.js`)).status, 403);
  assert.equal((await get('/api/info')).status, 404);
  assert.equal((await get('/automation.json')).status, 403);
  assert.equal((await get('/.env')).status, 403); assert.equal((await get('/.git/config')).status, 403);
  assert.equal((await get('/%2e%2e%2foutside.js')).status, 403); assert.equal((await get('/escape.js')).status, 403);
  assert.equal((await get('/app.js', { 'Service-Worker': 'script' })).status, 403);
  assert.match(script.headers.get('content-security-policy'), /worker-src 'none'/);
  assert.match(script.headers.get('content-security-policy'), /https:/);
  const other = path.join(f.directory, 'other'); await mkdir(other); await writeFile(path.join(other, 'index.html'), '<h1>Other</h1>');
  const opened = await (await f.ui('/api/open', { input: path.join(other, 'index.html') })).json();
  const next = await (await f.ui('/api/preview/open', { input: opened.path })).json();
  assert.notEqual(new URL(next.previewURL).origin, origin);
  await assert.rejects(fetch(`${origin}/app.js`, { headers: { Cookie: cookie } }));
});

test('automation requires private bearer auth and routes bounded commands through the native bridge', async (t) => {
  const f = await fixture(t, true);
  const saved = JSON.parse(await readFile(f.descriptor, 'utf8'));
  assert.equal(saved.token, f.token); assert.equal(saved.baseURL, f.base);
  if (process.platform !== 'win32') assert.equal((await stat(f.descriptor)).mode & 0o777, 0o600);
  assert.equal((await fetch(`${f.base}/api/automation/status`)).status, 401);
  assert.equal((await fetch(`${f.base}/api/automation/status?token=${f.token}`)).status, 401);
  assert.equal((await fetch(`${f.base}/api/automation/status`, { headers: { ...f.headers, Origin: f.base } })).status, 403);
  assert.equal((await f.request('/api/automation/commands', 'POST', { action: 'snapshot' })).status, 503);
  assert.equal((await f.request('/api/automation/register', 'POST', { platform: 'test', capabilities: ['open','status','snapshot','fill','record.start','record.stop','close','eval'] })).status, 200);
  const status = await (await f.request('/api/automation/status')).json(); assert.equal(status.connected, true); assert.equal(status.token, undefined); assert.ok(!status.capabilities.includes('eval'));
  const commandPromise = f.request('/api/automation/commands', 'POST', { action: 'fill', args: { selector: '#name', value: '' } });
  const { command } = await (await f.request('/api/automation/next')).json(); assert.equal(command.action, 'fill'); assert.equal(command.args.value, '');
  assert.equal((await f.request('/api/automation/result', 'POST', { id: command.id, result: { filled: true } })).status, 200);
  assert.deepEqual((await (await commandPromise).json()).result, { filled: true });
  assert.equal((await f.request('/api/automation/result', 'POST', { id: command.id, result: {} })).status, 404);
  assert.equal((await f.request('/api/automation/commands', 'POST', { action: 'eval', args: { javascript: 'process.exit()' } })).status, 400);
  assert.equal((await f.request('/api/automation/commands', 'POST', { action: 'record.start', args: { seconds: 121 } })).status, 400);
  for (const input of ['https://example.com', 'http://localhost:4318/']) {
    const rejected = f.request('/api/automation/commands', 'POST', { action: 'open', args: { input } });
    assert.equal((await (await f.request('/api/automation/next')).json()).command, null);
    assert.equal((await rejected).status, 403);
  }
  await writeFile(path.join(f.root, 'index.html'), '<h1>Control</h1>');
  const openPromise = f.request('/api/automation/commands', 'POST', { action: 'open', args: { input: path.join(f.root, 'index.html') } });
  const opened = (await (await f.request('/api/automation/next')).json()).command; assert.equal(opened.args.kind, 'html'); assert.match(opened.args.previewURL, /^http:\/\/127\.0\.0\.1:\d+\/session\//); assert.ok(path.isAbsolute(opened.args.fsPath));
  await f.request('/api/automation/result', 'POST', { id: opened.id, result: { opened: true } }); assert.equal((await openPromise).status, 200);
});

test('CLI and MCP use the discovered endpoint without leaking credentials or requiring an AI SDK', async (t) => {
  const f = await fixture(t, true);
  await f.request('/api/automation/register', 'POST', { platform: 'test', capabilities: ['snapshot'] });
  const pending = callAutomation({ action: 'snapshot' }, { descriptor: f.descriptor, baseURL: f.base });
  const command = (await (await f.request('/api/automation/next')).json()).command;
  await f.request('/api/automation/result', 'POST', { id: command.id, result: { text: 'Fixture page' } });
  assert.equal((await pending).result.text, 'Fixture page');
  assert.equal(parseCLI(['fill', '#name', '']).command.args.value, '');
  assert.equal(parseCLI(['record', '--seconds', '3']).waitRecording, 3);
  assert.throws(() => validateCommand({ action: 'record.start', args: { fps: 120 } }), /fps/);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./mcp.mjs', import.meta.url))], { env: { ...process.env, RDVIEWER_AUTOMATION_FILE: f.descriptor }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let errors = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { errors += chunk; });
  child.stdin.end([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'rdviewer_connection', arguments: {} } }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'unknown' }),
    'not json',
  ].join('\n') + '\n');
  const [code] = await once(child, 'close'); assert.equal(code, 0, errors);
  const messages = output.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(messages.find((message) => message.id === 1).result.protocolVersion, '2025-06-18');
  assert.equal(messages.find((message) => message.id === 2).result.tools.length, 2);
  const navigationActions = messages.find((message) => message.id === 2).result.tools.find((tool) => tool.name === 'rdviewer').inputSchema.properties.action.enum;
  for (const action of ['back', 'forward', 'reload']) assert.ok(navigationActions.includes(action));
  assert.equal(JSON.parse(messages.find((message) => message.id === 3).result.content[0].text).connected, true);
  assert.equal(messages.find((message) => message.id === 4).error.code, -32601);
  assert.ok(messages.some((message) => message.error?.code === -32700));
  assert.ok(!output.includes(f.token));
});

test('browser history commands preserve native state through the UI and authenticated agent routes', async (t) => {
  const f = await fixture(t, true);
  await f.request('/api/automation/register', 'POST', { platform: 'test', capabilities: ['back', 'forward', 'reload'] });
  for (const action of ['back', 'forward', 'reload']) {
    assert.deepEqual(parseCLI([action]).command, { action, args: {} });
    assert.throws(() => validateCommand({ action, args: { input: 'https://example.com' } }), /args/);
    const pending = action === 'forward'
      ? f.request('/api/automation/commands', 'POST', { action })
      : f.ui('/api/preview/action', { action });
    const command = (await (await f.request('/api/automation/next')).json()).command;
    assert.equal(command.action, action); assert.deepEqual(command.args, {});
    const native = { previewOpen: true, url: 'http://localhost:5014/next', canGoBack: true, canGoForward: action === 'back', loading: false, navigated: true };
    await f.request('/api/automation/events', 'POST', { state: native });
    await f.request('/api/automation/result', 'POST', { id: command.id, result: native });
    const response = await pending; assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, native);
    assert.deepEqual((await (await fetch(`${f.base}/api/preview/status`)).json()).state, native);
  }
  assert.equal((await fetch(`${f.base}/api/preview/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'back' }) })).status, 403);
  assert.equal((await f.ui('/api/preview/action', { action: 'eval' })).status, 400);
});

test('parallel opens prepare only on native delivery, metadata cannot revoke the active preview, and project-relative assets work', async (t) => {
  const f = await fixture(t);
  const first = path.join(f.root, 'docs'); await mkdir(first);
  await writeFile(path.join(first, 'index.html'), '<link rel="stylesheet" href="../style.css"><h1>A</h1>');
  await writeFile(path.join(f.root, 'style.css'), 'h1{color:purple}');
  const other = path.join(f.directory, 'other'); await mkdir(other); await writeFile(path.join(other, 'index.html'), '<h1>B</h1>');
  await f.request('/api/automation/register', 'POST', { platform: 'test', capabilities: ['open','close'] });
  const aPending = f.request('/api/automation/commands', 'POST', { action: 'open', args: { input: path.join(first, 'index.html') } });
  const a = (await (await f.request('/api/automation/next')).json()).command;
  const initial = await fetch(a.args.previewURL, { redirect: 'manual' }); const cookie = initial.headers.get('set-cookie').split(';')[0]; const origin = new URL(a.args.previewURL).origin;
  assert.equal(initial.headers.get('location'), '/docs/index.html');
  assert.equal(await (await fetch(`${origin}/style.css`, { headers: { Cookie: cookie } })).text(), 'h1{color:purple}');
  const bPending = f.request('/api/automation/commands', 'POST', { action: 'open', args: { input: path.join(other, 'index.html') } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await f.request('/api/automation/next')).status, 409);
  const registered = await (await f.ui('/api/open', { input: path.join(other, 'index.html') })).json();
  const metadata = await (await fetch(`${f.base}/api/file?path=${encodeURIComponent(registered.path)}`)).json(); assert.equal(metadata.previewURL, null);
  assert.equal((await fetch(`${origin}/docs/index.html`, { headers: { Cookie: cookie } })).status, 200);
  await f.request('/api/automation/result', 'POST', { id: a.id, result: {} }); assert.equal((await aPending).status, 200);
  const b = (await (await f.request('/api/automation/next')).json()).command; assert.notEqual(new URL(b.args.previewURL).origin, origin);
  await assert.rejects(fetch(`${origin}/docs/index.html`, { headers: { Cookie: cookie } }));
  await f.request('/api/automation/result', 'POST', { id: b.id, result: {} }); assert.equal((await bPending).status, 200);
  const closing = f.request('/api/automation/commands', 'POST', { action: 'close' });
  const close = (await (await f.request('/api/automation/next')).json()).command;
  await f.request('/api/automation/result', 'POST', { id: close.id, result: { closed: true } }); await closing;
  await assert.rejects(fetch(b.args.previewURL));
});

test('broker caps pending work and releases queued requests on timeout or close', async () => {
  const { createAutomationBroker } = await import('./automation-server.mjs');
  const broker = createAutomationBroker({ commandTimeoutMs: 35 }); await broker.initialize('http://127.0.0.1:1234');
  const { Readable } = await import('node:stream');
  const request = Readable.from([Buffer.from(JSON.stringify({ platform: 'test', capabilities: ['snapshot'] }))]);
  request.method = 'POST'; request.headers = { authorization: `Bearer ${broker.descriptor().token}`, 'content-type': 'application/json' };
  await broker.handle(request, {}, new URL('http://127.0.0.1:1234/api/automation/register'), () => {});
  const pending = Array.from({ length: 32 }, () => broker.dispatch({ action: 'snapshot' }));
  const results = Promise.allSettled(pending);
  await assert.rejects(broker.dispatch({ action: 'snapshot' }), /가득/);
  const keepAlive = setTimeout(() => {}, 100);
  const completed = await results; clearTimeout(keepAlive);
  assert.equal(completed.length, 32); assert.ok(completed.every((result) => result.status === 'rejected' && result.reason.status === 504));
  assert.equal(broker.status().pending, 0);
  const last = broker.dispatch({ action: 'snapshot' }); broker.close(); await assert.rejects(last, /종료/);
});
