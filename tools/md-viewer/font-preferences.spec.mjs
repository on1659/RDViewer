import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { FONT_OPTIONS, normalizeFontPreferences, readerFontFamily, validateCustomFont } from './public/font-preferences.mjs';
import { createReaderServer } from './server.mjs';

test('font preferences upgrade old settings without modifying unrelated fields', () => {
  for (const saved of [undefined, null, {}, { theme: 'dark', fontSize: 18 }, { fontFamily: 'missing' }, { fontFamily: '__proto__' }]) {
    assert.deepEqual(normalizeFontPreferences(saved), { fontFamily: 'system', customFont: '' });
  }
  const saved = { fontFamily: 'serif', customFont: '  맑은 고딕  ', theme: 'dark', fontSize: 18 };
  assert.deepEqual(normalizeFontPreferences(saved), { fontFamily: 'serif', customFont: '맑은 고딕' });
  assert.equal(saved.customFont, '  맑은 고딕  ', 'normalizing never mutates existing settings');
  assert.deepEqual(FONT_OPTIONS.map(({ id }) => id), ['system', 'sans', 'serif', 'mono', 'custom']);
  assert.equal(Object.isFrozen(FONT_OPTIONS), true);
  assert.equal(FONT_OPTIONS.every(Object.isFrozen), true);
});

test('custom font names accept Korean and English names with a bounded safe alphabet', () => {
  for (const name of ['맑은 고딕', 'Apple SD Gothic Neo', 'D2Coding', 'Noto Sans CJK KR', 'IBM_Plex-Sans 2.0', 'Cafe\u0301']) {
    assert.deepEqual(validateCustomFont(` ${name} `), { ok: true, value: name.normalize('NFC') });
  }
  assert.deepEqual(validateCustomFont(''), { ok: true, value: '' });
  assert.equal(validateCustomFont('한'.repeat(80)).ok, true);
  assert.equal(validateCustomFont('한'.repeat(81)).ok, false);
});

test('custom fonts reject CSS, paths, control characters and network inputs', () => {
  for (const name of [null, {}, ['Arial'], 'Arial,serif', '"Arial"', "Arial';color:red", 'url(https://fonts.example/font.woff)', 'https://example/font', 'C:\\Fonts\\a.ttf', '/Library/Fonts/a.ttf', 'var(--font)', 'Arial\n', '\tArial', 'Arial\r', 'Arial\u0000', 'Arial\u202e', '🙂']) {
    assert.equal(validateCustomFont(name).ok, false, String(name));
    const normalized = normalizeFontPreferences({ fontFamily: 'custom', customFont: name });
    assert.equal(normalized.customFont, '');
    assert.equal(readerFontFamily(normalized), readerFontFamily({ fontFamily: 'system' }));
  }
});

test('only vetted preset stacks or a quoted custom name reach reader CSS', () => {
  for (const { id } of FONT_OPTIONS) {
    const stack = readerFontFamily({ fontFamily: id });
    assert.equal(typeof stack, 'string');
    assert.doesNotMatch(stack, /(?:https?:|url\(|@import|;|\{|\}|\\)/i);
    assert.match(stack, /(?:sans-serif|serif|monospace)$/);
  }
  assert.match(readerFontFamily({ fontFamily: 'sans' }), /Apple SD Gothic Neo.*Malgun Gothic/);
  assert.match(readerFontFamily({ fontFamily: 'serif' }), /AppleMyungjo.*Batang/);
  assert.match(readerFontFamily({ fontFamily: 'mono' }), /Menlo.*Consolas/);
  assert.equal(readerFontFamily({ fontFamily: 'custom', customFont: '맑은 고딕' }), `"맑은 고딕", ${readerFontFamily({ fontFamily: 'system' })}`);
  assert.equal(readerFontFamily({ fontFamily: 'custom', customFont: '' }), readerFontFamily({ fontFamily: 'system' }));
});

test('font module is served as JavaScript and explicitly included in Windows packaging checks', async (t) => {
  const server = await createReaderServer(fileURLToPath(new URL('.', import.meta.url)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/font-preferences.mjs`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /export function readerFontFamily/);
  const build = await readFile(new URL('./windows/build.mjs', import.meta.url), 'utf8');
  const smoke = await readFile(new URL('./windows/installer-smoke.ps1', import.meta.url), 'utf8');
  assert.match(build, /'public\/font-preferences\.mjs'/);
  assert.match(smoke, /\$origin\/font-preferences\.mjs/);
  assert.match(smoke, /readerFontFamily/);
});
