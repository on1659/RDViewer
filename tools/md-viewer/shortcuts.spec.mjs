import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, normalizeShortcut, shortcutFromEvent, formatShortcut, createShortcutRegistry } from './public/shortcuts.mjs';
import { createReaderServer } from './server.mjs';
import { fileURLToPath } from 'node:url';

const key = (name, changes = {}) => ({ key: name.toLowerCase(), code: `Key${name}`, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...changes });

test('shortcut syntax normalizes modifier order, punctuation, digits and function keys', () => {
  assert.equal(normalizeShortcut('shift+mod+o'), 'Mod+Shift+O');
  assert.equal(normalizeShortcut('Control+KeyP'), 'Ctrl+P');
  assert.equal(normalizeShortcut('Mod+,'), 'Mod+Comma');
  assert.equal(normalizeShortcut('Mod+Comma'), 'Mod+Comma');
  assert.equal(normalizeShortcut('Alt+2'), 'Alt+Digit2');
  assert.equal(normalizeShortcut('F6'), 'F6');
  assert.equal(normalizeShortcut('Mod+Enter'), 'Mod+Enter');
  assert.equal(formatShortcut('Mod+Shift+O', { isMac: true }), '⌘ ⇧ O');
  assert.equal(formatShortcut('Mod+Comma'), 'Ctrl+,');
  assert.equal(formatShortcut(''), '미지정');
  for (const value of ['O', 'Shift+Shift+P', 'Ctrl+', 'Alt', 'Mod+Escape', 'Mod+Tab', 'Enter', null, {}, 'F25']) assert.equal(normalizeShortcut(value), null, String(value));
});

test('physical keys dispatch platform defaults in Korean layouts and ignore text composition', () => {
  const win = createShortcutRegistry();
  const mac = createShortcutRegistry(null, { isMac: true });
  assert.equal(win.match(key('O', { key: 'ㅐ' })), 'file.open');
  assert.equal(mac.match(key('O', { key: 'ㅐ', ctrlKey: false, metaKey: true })), 'file.open');
  assert.equal(win.match(key('O', { shiftKey: true })), 'folder.open');
  assert.equal(win.match(key('L', { shiftKey: true })), 'preview.openURL');
  assert.equal(mac.match(key('O')), null, 'physical Ctrl is not Cmd on Mac');
  assert.equal(win.match({ key: ',', code: 'Comma', ctrlKey: true }), 'settings.open');
  for (const changes of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }, { getModifierState: () => true }]) assert.equal(win.match(key('O', changes)), null);
  assert.equal(shortcutFromEvent({ key: 'Shift', shiftKey: true }), null);
  assert.equal(shortcutFromEvent(key('O', { ctrlKey: false })), null, 'ordinary typing is untouched');
});

test('custom bindings, disabling and resets persist independently of command defaults', () => {
  const registry = createShortcutRegistry();
  assert.deepEqual(registry.set('search.files', 'Mod+Shift+P'), { ok: true });
  assert.equal(registry.match(key('P')), null);
  assert.equal(registry.handles(key('P')), true, 'old defaults cannot fall through to browser print');
  assert.equal(registry.match(key('P', { shiftKey: true })), 'search.files');
  assert.deepEqual(registry.set('file.open', ''), { ok: true });
  assert.equal(registry.match(key('O')), null);
  assert.equal(registry.handles(key('O')), true, 'disabled file-open cannot fall through to browser picker');
  assert.equal(registry.handles(key('O', { repeat: true })), true);
  assert.equal(registry.handles(key('O', { isComposing: true })), false);
  assert.equal(registry.handles(key('S')), false, 'unregistered combinations stay untouched');
  const saved = JSON.parse(JSON.stringify(registry.serialize()));
  assert.deepEqual(saved, { version: 1, bindings: { 'search.files': 'Mod+Shift+P', 'file.open': '' } });
  const restored = createShortcutRegistry(saved);
  assert.equal(restored.binding('file.open'), '');
  assert.equal(restored.binding('search.files'), 'Mod+Shift+P');
  assert.equal(restored.binding('search.document'), 'Mod+F');
  restored.reset();
  assert.equal(restored.binding('file.open'), 'Mod+O');
  assert.deepEqual(restored.serialize(), { version: 1, bindings: {} });
  assert.equal(restored.set('view.focus', 'F6').ok, true);
  assert.equal(restored.match({ key: 'F6', code: 'F6', target: { tagName: 'INPUT' } }), 'view.focus');
});

test('conflicts use effective platform keys and failed changes preserve previous bindings', () => {
  const win = createShortcutRegistry();
  const mac = createShortcutRegistry(null, { isMac: true });
  assert.equal(win.set('view.source', 'Ctrl+P').conflict, 'search.files');
  assert.equal(mac.set('view.source', 'Meta+P').conflict, 'search.files');
  assert.equal(win.set('view.source', 'Mod+Ctrl+P').conflict, 'search.files');
  assert.equal(win.binding('view.source'), '');
  for (const chord of ['Mod+Q', 'Mod+W', 'Mod+C', 'Mod+Shift+Z', 'Alt+F4', 'F11']) assert.equal(win.set('view.source', chord).ok, false, chord);
  assert.equal(win.set('view.source', 'S').ok, false);
  assert.equal(win.set('missing.command', 'Mod+S').ok, false);
  assert.equal(win.binding('search.files'), 'Mod+P');
});

test('malformed or conflicting storage cannot shadow commands and future IDs remain versioned', () => {
  for (const saved of [null, [], { version: 2, bindings: { 'file.open': '' } }, { version: 1, bindings: [] }, { version: 1, bindings: { 'file.open': 7, 'search.files': 'Mod+Q' } }]) assert.equal(createShortcutRegistry(saved).binding('file.open'), 'Mod+O');
  const registry = createShortcutRegistry({ version: 1, bindings: { 'file.open': 'Ctrl+P', 'future.action': 'Mod+Shift+U' } });
  assert.equal(registry.binding('file.open'), 'Ctrl+P', 'valid saved custom binding takes precedence over a default');
  assert.equal(registry.binding('search.files'), '', 'only the conflicting default is disabled');
  assert.equal(registry.match(key('P')), 'file.open');
  assert.equal(registry.binding('future.action'), '');
  assert.deepEqual(registry.serialize(), { version: 1, bindings: { 'file.open': 'Ctrl+P', 'future.action': 'Mod+Shift+U', 'search.files': '' } });
  assert.equal(new Set(COMMANDS.map(({ id }) => id)).size, COMMANDS.length);
  assert.equal(Object.isFrozen(COMMANDS), true);
});

test('a new URL default never resets existing custom shortcuts on upgrade', () => {
  for (const isMac of [false, true]) {
    const registry = createShortcutRegistry({ version: 1, bindings: { 'view.focus': 'Mod+Shift+L', 'search.files': 'Mod+Shift+P', 'file.open': '', 'future.action': 'F8' } }, { isMac });
    assert.equal(registry.binding('view.focus'), 'Mod+Shift+L');
    assert.equal(registry.binding('preview.openURL'), '');
    assert.equal(registry.binding('search.files'), 'Mod+Shift+P');
    assert.equal(registry.binding('file.open'), '');
    assert.equal(registry.match(key('L', { shiftKey: true, ctrlKey: !isMac, metaKey: isMac })), 'view.focus');
    const restored = createShortcutRegistry(registry.serialize(), { isMac });
    assert.equal(restored.binding('preview.openURL'), '');
    assert.equal(restored.binding('view.focus'), 'Mod+Shift+L');
    assert.equal(restored.serialize().bindings['future.action'], 'F8');
    assert.equal(restored.set('preview.openURL', 'Mod+Shift+U').ok, true);
  }
});

test('conflicting explicit saved overrides disable only the duplicate', () => {
  const registry = createShortcutRegistry({ version: 1, bindings: { 'file.open': 'F6', 'folder.open': 'F6', 'search.files': 'F8' } });
  assert.equal(registry.binding('file.open'), 'F6');
  assert.equal(registry.binding('folder.open'), '');
  assert.equal(registry.binding('search.files'), 'F8');
  assert.equal(registry.binding('preview.openURL'), 'Mod+Shift+L');
});

test('shortcut module is served as JavaScript from the local reader', async (t) => {
  const server = await createReaderServer(fileURLToPath(new URL('.', import.meta.url)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/shortcuts.mjs`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /export const COMMANDS/);
});
