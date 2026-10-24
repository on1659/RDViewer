const { contextBridge, ipcRenderer } = require('electron');

// Expose one fixed operation, never the IPC transport or Electron objects.
// Sandboxed preload scripts use CommonJS even though the app is an ES module.
if (process.platform === 'win32' && process.isMainFrame) {
  contextBridge.exposeInMainWorld('rdviewerDesktop', {
    platform: 'win32',
    titleBarOverlay: true,
    setTitleBarTheme(theme) {
      if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return;
      if (![theme.background, theme.foreground].every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) return;
      ipcRenderer.send('rdviewer:title-bar-theme', { background: theme.background, foreground: theme.foreground });
    },
  });
}

// Native-only messages; the page never receives the recorder or IPC transport.
if (process.platform === 'win32' && process.isMainFrame && typeof ipcRenderer.on === 'function') {
  let recorder = null;
  let canvas = null;
  let stream = null;
  let writes = Promise.resolve();
  let pending = 0;
  let failure = null;
  let stopped = null;
  const cleanup = () => { stream?.getTracks().forEach((track) => track.stop()); stream = null; if (canvas) { canvas.width = 1; canvas.height = 1; } canvas = null; recorder = null; };
  ipcRenderer.on('rdviewer:recorder', async (_event, message) => {
    try {
      let result;
      if (message.op === 'start') {
        if (recorder) throw new Error('A recording is already running.');
        const mimeType = ['video/mp4', 'video/mp4;codecs=avc1.42001E'].find((type) => MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw new Error('This Windows runtime cannot encode MP4 recordings.');
        const width = Math.max(320, Math.min(1920, Number(message.width) || 1280));
        const height = Math.max(180, Math.min(1080, Number(message.height) || 720));
        canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d', { alpha: false }).fillRect(0, 0, width, height);
        stream = canvas.captureStream(Math.max(1, Math.min(15, Number(message.fps) || 10)));
        writes = Promise.resolve(); pending = 0; failure = null;
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2000000 });
        stopped = new Promise((resolve) => { recorder.onstop = resolve; });
        recorder.onerror = (event) => { failure = event.error?.message || 'Video encoding failed.'; };
        recorder.ondataavailable = (event) => {
          if (!event.data.size) return;
          if (event.data.size > 4 * 1024 * 1024 || pending >= 2) { failure = 'Recording storage is too slow.'; if (recorder?.state === 'recording') recorder.stop(); return; }
          pending++;
          writes = writes.then(async () => {
            const bytes = await event.data.arrayBuffer();
            await ipcRenderer.invoke('rdviewer:recording-chunk', bytes);
          }).catch((error) => { failure = error.message; if (recorder?.state === 'recording') recorder.stop(); }).finally(() => { pending--; });
        };
        recorder.start(1000); result = { mimeType };
      } else if (message.op === 'frame') {
        if (!canvas || recorder?.state !== 'recording') throw new Error(failure || 'Recording is not active.');
        const bitmap = await createImageBitmap(new Blob([message.png], { type: 'image/png' }));
        try { const context = canvas.getContext('2d'); context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); }
        finally { bitmap.close(); }
        result = { drawn: true };
      } else if (message.op === 'stop') {
        if (!recorder) throw new Error('Recording is not active.');
        if (recorder.state !== 'inactive') recorder.stop();
        await stopped; await writes;
        const error = failure; cleanup();
        if (error) throw new Error(error);
        result = { stopped: true };
      } else throw new Error('Unsupported recorder operation.');
      ipcRenderer.send('rdviewer:recorder-result', { id: message.id, result });
    } catch (error) {
      if (message.op !== 'frame') cleanup();
      ipcRenderer.send('rdviewer:recorder-result', { id: message.id, error: error.message });
    }
  });
}
