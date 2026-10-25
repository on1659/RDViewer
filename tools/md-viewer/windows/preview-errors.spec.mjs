import test from 'node:test';
import assert from 'node:assert/strict';
import { previewLoadError, loadPreviewURL } from './preview-errors.mjs';

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
