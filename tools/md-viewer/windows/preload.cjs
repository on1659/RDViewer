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
