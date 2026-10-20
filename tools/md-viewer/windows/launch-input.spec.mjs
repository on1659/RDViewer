import test from 'node:test';
import assert from 'node:assert/strict';
import { launchInputs, isReaderNavigation, isExternalWebLink } from './launch-input.mjs';

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
