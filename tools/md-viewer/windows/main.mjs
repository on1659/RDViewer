import { app, BrowserWindow, Menu, dialog, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { createReaderServer } from './viewer/server.mjs';
import { parsePathInput } from './viewer/path-input.mjs';
import { launchInputs, isReaderNavigation, isExternalWebLink, isDesktopAction } from './launch-input.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const origin = 'http://127.0.0.1:4318';
let window;
let server;
let queue = Promise.resolve();
const waiting = launchInputs(process.argv, { packaged: app.isPackaged });
let ready = false;
app.setName('RDViewer');
const userData = path.join(app.getPath('appData'), 'RDViewer');
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setAppUserModelId('RDViewer.Markdown');

function focus() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function openInput(input) {
  const target = parsePathInput(input, directory);
  const info = await stat(target);
  const endpoint = info.isDirectory() ? '/api/projects' : '/api/open';
  const response = await fetch(`${origin}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1' },
    body: JSON.stringify({ input: target }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '파일을 열지 못했습니다.');
  if (!isReaderNavigation(result.url, origin)) throw new Error('올바른 문서 주소가 아닙니다.');
  await window.loadURL(result.url);
  focus();
}

function enqueue(inputs) {
  if (!ready) { waiting.push(...inputs); return; }
  for (const input of inputs) {
    queue = queue.then(() => openInput(input)).catch((error) =>
      dialog.showMessageBox(window, { type: 'error', title: 'RDViewer', message: '문서를 열지 못했습니다.', detail: error.message }));
  }
}

async function choose(project = false) {
  const result = await dialog.showOpenDialog(window, {
    title: project ? '폴더 추가' : '파일 추가',
    properties: [project ? 'openDirectory' : 'openFile', 'multiSelections', 'showHiddenFiles'],
    ...(project ? {} : { filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown'] }] }),
  });
  if (!result.canceled) enqueue(result.filePaths);
}

async function external(url) {
  if (isExternalWebLink(url)) await shell.openExternal(url).catch(() => {});
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, cwd) => {
    enqueue(launchInputs(argv, { packaged: app.isPackaged, cwd }));
    focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    server?.closeAllConnections();
    server?.close();
  });
  app.whenReady().then(async () => {
    // A fixed dedicated origin keeps themes and document tabs across launches.
    // Never attach to another process that happens to occupy this port.
    server = await createReaderServer(path.join(directory, 'welcome'), {
      projectsFile: path.join(app.getPath('userData'), 'projects.json'),
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(4318, '127.0.0.1', resolve);
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', (event) => event.preventDefault());
    window = new BrowserWindow({
      title: 'RDViewer', width: 1280, height: 850, minWidth: 375, minHeight: 500,
      backgroundColor: '#1e1e1e', icon: path.join(directory, 'icon.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    window.webContents.setUserAgent(`${window.webContents.getUserAgent()} RDViewerDesktop`);
    window.webContents.setWindowOpenHandler(({ url }) => {
      void external(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && event.url.startsWith('rdviewer:')) event.preventDefault();
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (isDesktopAction(url, {
        origin, sourceURL: event.initiator?.url, isMainFrame: event.isMainFrame,
        isMainFrameInitiator: event.initiator === window.webContents.mainFrame,
      })) {
        event.preventDefault();
        void choose(url === 'rdviewer://choose-folder');
        return;
      }
      if (!isReaderNavigation(url, origin)) { event.preventDefault(); void external(url); }
    });
    window.webContents.on('will-redirect', (event, url) => {
      if (!isReaderNavigation(url, origin)) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '파일', submenu: [
        { label: '파일 추가…', accelerator: 'CmdOrCtrl+O', click: () => { void choose(); } },
        { label: '폴더 추가…', accelerator: 'CmdOrCtrl+Shift+O', click: () => { void choose(true); } },
        { type: 'separator' },
        { label: '폴더 목록', click: () => { void window.loadURL(`${origin}/`); } },
        { type: 'separator' }, { role: 'quit', label: '끝내기' },
      ] },
      { label: '편집', submenu: [
        { label: '문서 내 찾기…', accelerator: 'CmdOrCtrl+F', click: () => {
          if (isReaderNavigation(window.webContents.getURL(), origin)) {
            void window.webContents.executeJavaScript("window.dispatchEvent(new Event('rdviewer-find'))").catch(() => {});
          }
        } },
        { type: 'separator' }, { role: 'copy', label: '복사' }, { role: 'paste', label: '붙여넣기' }, { role: 'selectAll', label: '모두 선택' }] },
      { label: '보기', submenu: [{ role: 'reload', label: '새로고침' }, { role: 'resetZoom', label: '기본 크기' }, { role: 'zoomIn', label: '확대' }, { role: 'zoomOut', label: '축소' }, { role: 'togglefullscreen', label: '전체 화면' }] },
    ]));
    await window.loadURL(`${origin}/`);
    ready = true;
    enqueue(waiting.splice(0));
  }).catch((error) => {
    dialog.showErrorBox('RDViewer 시작 오류', error.code === 'EADDRINUSE'
      ? 'RDViewer 전용 포트 4318을 다른 프로그램이 사용하고 있습니다. 해당 프로그램을 종료한 뒤 다시 실행하세요.'
      : error.message);
    app.quit();
  });
}
