import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { launchInputs, isReaderNavigation, isExternalWebLink, isDesktopAction, normalizeTitleBarTheme } from './launch-input.mjs';

test('Explorer and second-instance arguments retain spaces and resolve against sender cwd', () => {
  assert.deepEqual(launchInputs(['C:\\Apps\\RDViewer.exe', '설계 문서.md', 'D:\\Work\\Docs', '--flag'], {
    cwd: 'C:\\Work', platform: 'win32',
  }), ['C:\\Work\\설계 문서.md', 'D:\\Work\\Docs']);
  assert.deepEqual(launchInputs(['electron', 'app', 'file:///C:/Docs/a.md'], { packaged: false }),
    ['file:///C:/Docs/a.md']);
});

test('native window navigation and external protocol boundaries', () => {
  const origin = 'http://127.0.0.1:4318';
  assert.equal(isReaderNavigation(`${origin}/?doc=a.md`, origin), true);
  for (const url of ['file:///etc/passwd', 'https://example.com', `${origin}/api/document`,
    'http://127.0.0.1:43180/', 'http://user@127.0.0.1:4318/']) {
    assert.equal(isReaderNavigation(url, origin), false, url);
  }
  assert.equal(isExternalWebLink('https://example.com/docs'), true);
  for (const url of ['file:///C:/a.exe', 'javascript:alert(1)', 'ms-settings:defaultapps', 'https://user:pass@example.com']) {
    assert.equal(isExternalWebLink(url), false, url);
  }
});

test('native picker actions require an exact URL and the trusted main reader frame', () => {
  const context = {
    origin: 'http://127.0.0.1:4318', sourceURL: 'http://127.0.0.1:4318/?doc=notes.md',
    isMainFrame: true, isMainFrameInitiator: true,
  };
  for (const action of ['rdviewer://choose-folder', 'rdviewer://choose-files']) {
    assert.equal(isDesktopAction(action, context), true);
    assert.equal(isDesktopAction(action), false);
    for (const replacement of [
      { isMainFrame: false }, { isMainFrameInitiator: false },
      { sourceURL: 'https://example.com/' }, { sourceURL: 'http://127.0.0.1:4318/api/document' },
      { sourceURL: 'http://127.0.0.1:43180/' }, { sourceURL: 'http://user@127.0.0.1:4318/' },
    ]) assert.equal(isDesktopAction(action, { ...context, ...replacement }), false);
  }
  for (const value of ['rdviewer://choose-folder/', 'rdviewer://choose-files?path=C:/secret.md',
    'rdviewer://choose-files#open', 'rdviewer://user@choose-folder', 'rdviewer://choose-folder:4318',
    'RDVIEWER://choose-folder', 'rdviewer://open?path=C:/secret.md', 'rdviewer://choose-files/../choose-folder',
    'https://choose-folder', 'javascript:alert(1)', ' rdviewer://choose-folder']) {
    assert.equal(isDesktopAction(value, context), false, value);
  }
});

test('native title bar accepts only opaque hex colors and strips extra renderer properties', () => {
  assert.deepEqual(normalizeTitleBarTheme({ background: '#252526', foreground: '#F1F1F1', height: 999, anything: 'ignored' }),
    { background: '#252526', foreground: '#f1f1f1' });
  for (const value of [null, undefined, [], '#252526', {},
    { background: '#252526', foreground: 123 },
    { background: 'transparent', foreground: '#ffffff' },
    { background: '#12345678', foreground: '#ffffff' },
    { background: '#fff', foreground: '#ffffff' },
    { background: '#252526\n', foreground: '#ffffff' },
    { background: 'url(https://example.com)', foreground: '#ffffff' },
  ]) assert.equal(normalizeTitleBarTheme(value), null);
});

test('sandboxed preload exposes only a fixed title bar operation to the Windows main frame', () => {
  const source = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
  const exposed = [];
  const sent = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => exposed.push({ name, api }) },
    ipcRenderer: { send: (...args) => sent.push(args) },
  };
  for (const process of [{ platform: 'darwin', isMainFrame: true }, { platform: 'win32', isMainFrame: false }]) {
    runInNewContext(source, { process, require: () => electron });
  }
  assert.equal(exposed.length, 0);
  runInNewContext(source, { process: { platform: 'win32', isMainFrame: true }, require: () => electron });
  assert.equal(exposed.length, 1);
  assert.equal(exposed[0].name, 'rdviewerDesktop');
  const { api } = exposed[0];
  assert.deepEqual(Object.keys(api).sort(), ['platform', 'setTitleBarTheme', 'titleBarOverlay']);
  assert.equal(api.titleBarOverlay, true);
  api.setTitleBarTheme(null);
  api.setTitleBarTheme({ background: 'transparent', foreground: '#ffffff' });
  assert.equal(sent.length, 0);
  api.setTitleBarTheme({ background: '#252526', foreground: '#f1f1f1', channel: 'arbitrary' });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    ['rdviewer:title-bar-theme', { background: '#252526', foreground: '#f1f1f1' }],
  ]);
});
