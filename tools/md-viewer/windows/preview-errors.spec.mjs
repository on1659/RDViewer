import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { previewLoadError, loadPreviewURL, navigatePreview, isAllowedPreviewNavigation } from './preview-errors.mjs';

test('native preview errors explain local server, timeout and certificate failures', () => {
  assert.match(previewLoadError({ code: 'ERR_CONNECTION_REFUSED' }).message, /서버가 실행 중인지/);
  assert.match(previewLoadError({ code: 'ERR_CONNECTION_TIMED_OUT' }).message, /시간이 초과/);
  for (const code of ['ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_COMMON_NAME_INVALID', 'ERR_CERT_DATE_INVALID', 'ERR_SSL_PROTOCOL_ERROR']) {
    const message = previewLoadError({ message: `${code} loading https://localhost:5014/private?token=do-not-expose` }).message;
    assert.match(message, /인증서가 유효하고 주소와 일치/);
    assert.match(message, /http:\/\//);
    assert.doesNotMatch(message, /private|token|do-not-expose/);
  }
  assert.doesNotMatch(previewLoadError({ message: '/private/user/secret-file' }).message, /private|secret/);
});
test('native preview loading stops a stalled page and reports a retryable timeout', async () => {
  let stopped = 0;
  await assert.rejects(loadPreviewURL({ loadURL: () => new Promise(() => {}), isDestroyed: () => false, stop: () => { stopped++; } }, 'http://127.0.0.1:5014/', 5), /시간이 초과/);
  assert.equal(stopped, 1);
});
test('native preview loading preserves successful navigation and translates rejection', async () => {
  let stopped = 0;
  const successful = { loadURL: async (url) => assert.equal(url, 'http://localhost:5014/'), isDestroyed: () => false, stop: () => { stopped++; } };
  await loadPreviewURL(successful, 'http://localhost:5014/', 100);
  assert.equal(stopped, 0);
  await assert.rejects(loadPreviewURL({ ...successful, loadURL: async () => { throw Object.assign(new Error('refused'), { code: 'ERR_CONNECTION_REFUSED' }); } }, 'http://localhost:5014/', 100), /서버가 실행 중인지/);
  assert.equal(stopped, 1);
});

function historyFixture({ inPage = false, stalled = false, entries = ['http://localhost:5014/start', 'http://localhost:5014/next'] } = {}) {
  const contents = new EventEmitter(); let index = entries.length - 1; let reloaded = 0; let stopped = 0;
  const complete = () => { if (!stalled) queueMicrotask(() => contents.emit(inPage ? 'did-navigate-in-page' : 'did-finish-load', {}, entries[index], true)); };
  Object.assign(contents, {
    isDestroyed: () => false, getURL: () => entries[index], reload: () => { reloaded++; complete(); }, stop: () => { stopped++; },
    navigationHistory: { canGoBack: () => index > 0, canGoForward: () => index < entries.length - 1, getActiveIndex: () => index,
      getEntryAtIndex: (at) => entries[at] ? { url: entries[at] } : null,
      goBack: () => { index--; complete(); }, goForward: () => { index++; complete(); } },
  });
  return { contents, reloaded: () => reloaded, stopped: () => stopped };
}
test('native history uses the existing preview for back, forward and current-page reload', async () => {
  const f = historyFixture(); const options = { allowedOrigin: 'http://localhost:5014' };
  assert.deepEqual(await navigatePreview(f.contents, 'back', options), { navigated: true });
  assert.equal(f.contents.getURL(), 'http://localhost:5014/start'); assert.equal(f.contents.navigationHistory.canGoForward(), true);
  assert.deepEqual(await navigatePreview(f.contents, 'forward', options), { navigated: true });
  assert.equal(f.contents.getURL(), 'http://localhost:5014/next');
  assert.deepEqual(await navigatePreview(f.contents, 'forward', options), { navigated: false });
  assert.deepEqual(await navigatePreview(f.contents, 'reload', options), { navigated: true });
  assert.equal(f.reloaded(), 1); assert.equal(f.contents.getURL(), 'http://localhost:5014/next');
  assert.deepEqual(f.contents.eventNames(), [], 'completed commands must release navigation listeners');
});
test('native history accepts in-page transitions and bounds stalled operations without destroying history', async () => {
  const sameDocument = historyFixture({ inPage: true });
  assert.deepEqual(await navigatePreview(sameDocument.contents, 'back', { allowedOrigin: 'http://localhost:5014' }), { navigated: true });
  const stalled = historyFixture({ stalled: true });
  await assert.rejects(navigatePreview(stalled.contents, 'reload', { allowedOrigin: 'http://localhost:5014', timeout: 5 }), /시간이 초과/);
  assert.equal(stalled.stopped(), 1); assert.equal(stalled.contents.getURL(), 'http://localhost:5014/next');
  assert.deepEqual(stalled.contents.eventNames(), []);
});
test('native history and link guards reject another origin and credential-bearing addresses', async () => {
  for (const unsafe of ['https://example.com/', 'http://localhost:5015/start', 'http://user:secret@localhost:5014/private', 'file:///tmp/private']) {
    assert.equal(isAllowedPreviewNavigation(unsafe, 'http://localhost:5014'), false);
    const f = historyFixture({ entries: [unsafe, 'http://localhost:5014/next'] });
    await assert.rejects(navigatePreview(f.contents, 'back', { allowedOrigin: 'http://localhost:5014' }), /같은 로컬 서버/);
    assert.equal(f.contents.getURL(), 'http://localhost:5014/next');
  }
  assert.equal(isAllowedPreviewNavigation('http://localhost:5014/next#part', 'http://localhost:5014'), true);
  await assert.rejects(navigatePreview(null, 'back'), /먼저 열어/);
});
