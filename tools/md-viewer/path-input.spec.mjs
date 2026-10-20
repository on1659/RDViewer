import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePathInput as parseInput } from './path-input.mjs';
import { defaultProjectsFile } from './project-registry.mjs';
const parsePathInput = (input, root, home, platform = 'linux') => parseInput(input, root, home, platform);

test('assistant and editor paths retain spaces, unicode, and filename punctuation', () => {
  for (const input of [
    '/docs/설계 문서.md', '"/docs/설계 문서.md"', "'/docs/설계 문서.md'",
    '`/docs/설계 문서.md`', '[설계 문서](/docs/설계 문서.md:12)',
    '[설계 문서](</docs/설계 문서.md:12>)', '/docs/설계 문서.md#L12-L30',
    'file:///docs/%EC%84%A4%EA%B3%84%20%EB%AC%B8%EC%84%9C.md',
    '[설계 문서](/docs/%EC%84%A4%EA%B3%84%20%EB%AC%B8%EC%84%9C.md:12)',
    'file://localhost/docs/%EC%84%A4%EA%B3%84%20%EB%AC%B8%EC%84%9C.md#L12',
  ]) assert.equal(parsePathInput(input, '/repo'), '/docs/설계 문서.md', input);
  assert.equal(parsePathInput('docs/a.md:12:8', '/repo'), '/repo/docs/a.md');
  assert.equal(parsePathInput('~/plans/a.md', '/repo', '/home/reader'), '/home/reader/plans/a.md');
  assert.equal(parsePathInput('/docs/design:12.md', '/repo'), '/docs/design:12.md');
  assert.equal(parsePathInput('design:12.md', '/repo'), '/repo/design:12.md');
  assert.equal(parsePathInput('/docs/design#L12.md', '/repo'), '/docs/design#L12.md');
});

test('Windows local paths, editor links and file URLs preserve Unicode and spaces', () => {
  const parse = (input) => parsePathInput(input, 'C:\\Projects\\Docs', 'C:\\Users\\Reader', 'win32');
  for (const input of [
    'C:\\Projects\\Docs\\설계 문서.md',
    '"C:\\Projects\\Docs\\설계 문서.md"',
    '[설계](C:\\Projects\\Docs\\설계 문서.md:12)',
    'file:///C:/Projects/Docs/%EC%84%A4%EA%B3%84%20%EB%AC%B8%EC%84%9C.md',
    '설계 문서.md',
  ]) assert.equal(parse(input), 'C:\\Projects\\Docs\\설계 문서.md', input);
  assert.equal(parse('sub\\design.md:12:8'), 'C:\\Projects\\Docs\\sub\\design.md');
  assert.equal(parse('~\\plans\\a.md'), 'C:\\Users\\Reader\\plans\\a.md');
  for (const input of ['\\\\server\\share\\a.md', '\\\\?\\C:\\a.md', 'C:relative.md',
    'C:\\a.md:stream', 'file://server/share/a.md', 'file:///C:/a%5Cb.md']) {
    assert.throws(() => parse(input), undefined, input);
  }
});

test('Windows project registry uses per-user AppData', () => {
  assert.equal(defaultProjectsFile({ platform: 'win32', home: 'C:\\Users\\Reader', env: {} }),
    'C:\\Users\\Reader\\AppData\\Roaming\\RDViewer\\projects.json');
  assert.equal(defaultProjectsFile({ platform: 'win32', home: 'C:\\Users\\Reader', env: { APPDATA: 'D:\\Profile\\Roaming' } }),
    'D:\\Profile\\Roaming\\RDViewer\\projects.json');
});

test('rejects web links, remote files, and malformed input', () => {
  for (const input of [
    null, {}, '', ' \n', '/a\0.md', '/a.md\n/b.md', 'https://example.com/a.md',
    '[remote](https://example.com/a.md)', 'file://remote/a.md', '//remote/a.md',
    'sandbox:/mnt/data/a.md',
    'file:///a%00.md', 'file:///a%2Fb.md', 'file:///a.md?path=/b.md',
  ]) assert.throws(() => parsePathInput(input, '/repo'), undefined, String(input));
});
