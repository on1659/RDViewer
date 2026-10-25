import { BrowserWindow, ipcMain, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, open, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadPreviewURL } from './preview-errors.mjs';

const actions = ['open','status','snapshot','click','fill','press','scroll','play','pause','seek','screenshot','record.start','record.stop','close'];
const bounded = (value, fallback, low, high) => Math.max(low, Math.min(high, Number(value) || fallback));
export async function startNativeAutomation({ reader, descriptor, directory, openReader }) {
  const source = await readFile(path.join(directory, 'viewer', 'native', 'automation-page.js'), 'utf8');
  await mkdir(descriptor.artifactDirectory, { recursive: true, mode: 0o700 });
  let preview = null; let allowedOrigin = ''; let alive = true; let recording = null; let lastRecording = null; let logs = [];
  const responses = new Map();
  reader.on('page-title-updated', (event) => { if (recording?.owner === reader) event.preventDefault(); });
  const api = async (route, body) => {
    const response = await fetch(`${descriptor.baseURL}/api/automation/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${descriptor.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(22000) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Automation bridge failed.'); return value;
  };
  const state = () => ({ previewOpen: !!preview && !preview.isDestroyed(), url: preview?.webContents.getURL() || '', title: preview?.getTitle() || '', engine: 'Chromium', activePreviewCount: preview && !preview.isDestroyed() ? 1 : 0 });
  const recordState = () => recording ? { active: true, startedAt: recording.startedAt, path: recording.path, mimeType: 'video/mp4', audio: false, frames: recording.frames } : { active: false, ...lastRecording };
  const publish = () => api('events', { state: state(), recording: recordState() }).catch(() => {});
  const target = () => preview && !preview.isDestroyed() ? preview.webContents : reader.webContents;
  const nativeRecorder = (op, data = {}) => new Promise((resolve, reject) => {
    const id = randomUUID(); const timeout = setTimeout(() => { responses.delete(id); reject(new Error('Recorder response timed out.')); }, 10000);
    responses.set(id, { resolve, reject, timeout }); reader.webContents.send('rdviewer:recorder', { id, op, ...data });
  });
  const trusted = (event) => event.sender === reader.webContents && event.senderFrame === reader.webContents.mainFrame && event.senderFrame?.url.startsWith(`${descriptor.baseURL}/`);
  ipcMain.on('rdviewer:recorder-result', (event, message) => {
    if (!trusted(event)) return; const response = responses.get(message?.id); if (!response) return;
    responses.delete(message.id); clearTimeout(response.timeout); message.error ? response.reject(new Error(String(message.error))) : response.resolve(message.result);
  });
  ipcMain.handle('rdviewer:recording-chunk', async (event, bytes) => {
    if (!trusted(event) || !recording || !(bytes instanceof ArrayBuffer) || bytes.byteLength > 4 * 1024 * 1024) throw new Error('Invalid recording chunk.');
    const active = recording; if (active.bytes + bytes.byteLength > 100 * 1024 * 1024) throw new Error('Recording size limit reached.');
    await active.file.writeFile(Buffer.from(bytes)); active.bytes += bytes.byteLength; return { written: bytes.byteLength };
  });
  async function stopRecording() {
    if (!recording) return lastRecording || { active: false };
    const active = recording; if (active.stopping) return active.stopping;
    active.stopping = (async () => {
      clearInterval(active.timer); clearTimeout(active.limit);
      if (active.inFlight) await active.inFlight.catch(() => {});
      let error = active.error ? new Error(active.error) : null;
      try { await nativeRecorder('stop'); } catch (value) { error = value; }
      await active.file.close(); recording = null; reader.webContents.setBackgroundThrottling(true);
      if (active.owner && !active.owner.isDestroyed()) active.owner.setTitle(active.previousTitle);
      lastRecording = { path: active.path, mimeType: 'video/mp4', audio: false, frames: active.frames, duration: (Date.now() - active.startedAt) / 1000, bytes: active.bytes, ...(error ? { error: error.message } : {}) };
      await publish(); if (error) throw error; return lastRecording;
    })(); return active.stopping;
  }
  async function openPreview(url) {
    await stopRecording();
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || ['4317', '4318'].includes(parsed.port) || parsed.origin === descriptor.baseURL) throw new Error('RDViewer 주소와 분리된 로컬 서버 주소를 입력해 주세요.');
    allowedOrigin = parsed.origin; logs = [];
    if (!preview || preview.isDestroyed()) {
      const previewSession = session.fromPartition(`rdviewer-preview-${randomUUID()}`);
      previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      previewSession.setPermissionCheckHandler(() => false);
      previewSession.on('will-download', (event) => event.preventDefault());
      preview = new BrowserWindow({ title: 'RDViewer 미리보기', width: 1280, height: 800, minWidth: 375, minHeight: 400, show: false, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { session: previewSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: true } });
      preview.setMenuBarVisibility(false);
      preview.on('page-title-updated', (event) => { if (recording?.owner === preview) event.preventDefault(); });
      preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      preview.webContents.on('will-navigate', (event, destination) => { try { if (new URL(destination).origin !== allowedOrigin) event.preventDefault(); } catch { event.preventDefault(); } });
      preview.webContents.on('will-redirect', (event, destination) => { try { if (new URL(destination).origin !== allowedOrigin) event.preventDefault(); } catch { event.preventDefault(); } });
      const activePreview = preview;
      const publishNavigation = (url) => {
        if (preview !== activePreview || activePreview.isDestroyed()) return;
        try { if (new URL(url).origin === allowedOrigin) void publish(); } catch { /* Ignore incomplete navigation addresses. */ }
      };
      // did-navigate is main-frame-only; in-page events also include subframes.
      preview.webContents.on('did-navigate', (_event, url) => publishNavigation(url));
      preview.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame) publishNavigation(url); });
      preview.webContents.on('will-attach-webview', (event) => event.preventDefault());
      preview.webContents.on('console-message', (details) => { logs.push({ level: details.level, message: String(details.message).slice(0, 1000) }); logs = logs.slice(-100); });
      preview.on('close', (event) => { if (recording && !recording.stopping) { event.preventDefault(); void stopRecording().catch(() => {}).finally(() => preview?.destroy()); } });
      preview.on('closed', () => { preview = null; void previewSession.clearStorageData(); void publish(); });
    }
    await preview.webContents.session.clearStorageData();
    await preview.webContents.session.clearCache();
    try { await loadPreviewURL(preview.webContents, url); }
    catch (error) { if (preview && !preview.isDestroyed()) preview.destroy(); await publish(); throw error; }
    preview.webContents.navigationHistory.clear();
    preview.show(); await publish(); return state();
  }
  async function execute(command) {
    const args = command.args || {}; const action = command.action;
    if (action === 'open') {
      if (['html','url'].includes(args.kind)) return openPreview(args.previewURL || args.url);
      await stopRecording(); if (preview && !preview.isDestroyed()) preview.destroy();
      await openReader(args.url); await publish(); return { opened: true, kind: args.kind, url: args.url };
    }
    if (action === 'status') return { ...state(), recording: recordState(), capabilities: actions, logs };
    if (action === 'close') { const artifact = await stopRecording(); if (preview && !preview.isDestroyed()) preview.destroy(); await publish(); return { closed: true, recording: artifact }; }
    if (action === 'record.stop') return stopRecording();
    if (action === 'record.start') {
      if (recording) throw new Error('A recording is already running.');
      const webContents = target(); const initial = await webContents.capturePage(); if (initial.isEmpty()) throw new Error('The preview is not ready to record.');
      const width = Math.floor(bounded(args.width, 1280, 320, 1920) / 2) * 2;
      const height = Math.floor(Math.min(1080, width * initial.getSize().height / Math.max(1, initial.getSize().width)) / 2) * 2;
      const fps = bounded(args.fps, 10, 1, 15); const seconds = bounded(args.seconds, 10, 1, 120);
      const output = path.join(descriptor.artifactDirectory, `${randomUUID()}.mp4`); const file = await open(output, 'wx', 0o600);
      recording = { owner: BrowserWindow.fromWebContents(webContents), previousTitle: BrowserWindow.fromWebContents(webContents)?.getTitle() || 'RDViewer', file, path: output, startedAt: Date.now(), frames: 0, bytes: 0, inFlight: null, timer: null, limit: null };
      reader.webContents.setBackgroundThrottling(false);
      try { await nativeRecorder('start', { width, height, fps }); } catch (error) { await file.close(); recording = null; reader.webContents.setBackgroundThrottling(true); await rm(output, { force: true }); throw error; }
      const active = recording; active.owner?.setTitle('🔴 녹화 중 — RDViewer');
      const frame = () => {
        if (recording !== active || active.inFlight || active.stopping) return;
        active.inFlight = (async () => {
          if (webContents.isDestroyed()) throw new Error('The recording preview was closed.');
          const captured = await webContents.capturePage(); const png = captured.resize({ width }).toPNG();
          if (png.byteLength > 8 * 1024 * 1024) throw new Error('Captured frame exceeds the recording buffer limit.');
          await nativeRecorder('frame', { png }); active.frames++;
        })().catch((error) => { active.error = error.message; clearInterval(active.timer); setTimeout(() => { void stopRecording().catch(() => {}); }, 0); }).finally(() => { active.inFlight = null; });
      };
      active.timer = setInterval(frame, 1000 / fps); active.limit = setTimeout(() => { void stopRecording().catch(() => {}); }, seconds * 1000); frame();
      await publish(); return { active: true, path: output, mimeType: 'video/mp4', audio: false, fps, seconds, width, height };
    }
    if (action === 'screenshot') {
      const captured = await target().capturePage(); const png = captured.resize({ width: Math.min(1920, captured.getSize().width) }).toPNG();
      const output = path.join(descriptor.artifactDirectory, `${randomUUID()}.png`); await writeFile(output, png, { flag: 'wx', mode: 0o600 });
      return { path: output, mimeType: 'image/png', bytes: png.byteLength };
    }
    const result = await target().executeJavaScript(`(${source})(${JSON.stringify({ action, args })})`, true);
    return action === 'snapshot' ? { ...result, logs, engine: 'Chromium' } : result;
  }
  async function loop() {
    while (alive) {
      try {
        const value = await api('next'); if (!value.command) continue;
        const command = value.command;
        try { const result = await execute(command); await api('result', { id: command.id, result }); }
        catch (error) { await api('result', { id: command.id, error: error.message }); }
      } catch { if (alive) await new Promise((resolve) => setTimeout(resolve, 1000)); }
    }
  }
  await api('register', { platform: process.platform, capabilities: actions }); await publish(); void loop();
  return { stop: async () => { alive = false; await stopRecording().catch(() => {}); if (preview && !preview.isDestroyed()) preview.destroy(); }, execute, beforeReaderNavigation: async () => { await stopRecording(); if (preview && !preview.isDestroyed()) preview.destroy(); }, isRecording: () => !!recording };
}
