import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeFolderOrder, moveFolderOrder } from './public/folder-order.mjs';
import { createReaderServer } from './server.mjs';

test('saved folder positions survive reload and keep newly added folders in discovery order', () => {
  const ids = Object.freeze(['folder:default', 'repo:lamdice', 'folder:notes']);
  const moved = moveFolderOrder(ids, 'folder:notes', 'folder:default');
  const persisted = JSON.parse(JSON.stringify(moved));
  assert.deepEqual(normalizeFolderOrder(ids, persisted), ['folder:notes', 'folder:default', 'repo:lamdice']);
  assert.deepEqual(normalizeFolderOrder([...ids, 'folder:new'], persisted), ['folder:notes', 'folder:default', 'repo:lamdice', 'folder:new']);
  assert.deepEqual(ids, ['folder:default', 'repo:lamdice', 'folder:notes']);
});

test('removed and duplicate saved IDs cannot revive folders or duplicate current roots', () => {
  const saved = Object.freeze(['gone', 'repo:lamdice', 'repo:lamdice', 'folder:default']);
  assert.deepEqual(normalizeFolderOrder(['folder:default', 'repo:lamdice', 'folder:notes', 'folder:notes'], saved), ['repo:lamdice', 'folder:default', 'folder:notes']);
  assert.deepEqual(normalizeFolderOrder(['folder:default', 'folder:notes'], saved), ['folder:default', 'folder:notes']);
  assert.deepEqual(saved, ['gone', 'repo:lamdice', 'repo:lamdice', 'folder:default']);
});

test('malformed storage and ID values fall back without mutating or treating prototype names as properties', () => {
  const ids = Object.freeze(['folder:default', '__proto__', 'constructor', 'toString']);
  for (const saved of [null, undefined, 'folder:default', 42, {}, { order: ['constructor'] }]) assert.deepEqual(normalizeFolderOrder(ids, saved), ids);
  assert.deepEqual(normalizeFolderOrder(ids, ['toString', null, {}, '__proto__', '__proto__']), ['toString', '__proto__', 'folder:default', 'constructor']);
  assert.deepEqual(normalizeFolderOrder(['', null, 3, {}, [], 'folder:valid', 'bad\0id', 'bad\nid', 'x'.repeat(8193)]), ['folder:valid']);
  for (const ids of [null, {}, 'folder:default', undefined]) assert.deepEqual(normalizeFolderOrder(ids, ['folder:default']), []);
});

test('moving up and down uses the target edge and preserves every other folder position', () => {
  const ids = Object.freeze(['a', 'b', 'c', 'd']);
  assert.deepEqual(moveFolderOrder(ids, 'd', 'b', 'before'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveFolderOrder(ids, 'a', 'c', 'after'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveFolderOrder(ids, 'c', 'a', 'before'), ['c', 'a', 'b', 'd']);
  assert.deepEqual(moveFolderOrder(ids, 'b', 'd', 'after'), ['a', 'c', 'd', 'b']);
  assert.deepEqual(moveFolderOrder(ids, 'b', 'c', 'before'), ids);
  assert.deepEqual(moveFolderOrder(ids, 'c', 'b', 'after'), ids);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
});

test('invalid drops and self drops are stable no-ops with a fresh order array', () => {
  const ids = Object.freeze(['a', 'b']);
  for (const [source, target, edge] of [['a', 'a', 'before'], ['unknown', 'b', 'after'], ['a', 'unknown', 'before'], [null, 'b', 'before'], ['a', 'b', 'inside'], ['a', 'b', null]]) {
    const result = moveFolderOrder(ids, source, target, edge);
    assert.deepEqual(result, ids);
    assert.notEqual(result, ids);
  }
});

test('folder-order helper is served as JavaScript and included in Windows release inputs', async (t) => {
  const server = await createReaderServer(fileURLToPath(new URL('.', import.meta.url)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/folder-order.mjs`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  const source = await response.text();
  assert.match(source, /export function normalizeFolderOrder/);
  assert.match(source, /export function moveFolderOrder/);
  const build = await readFile(new URL('./windows/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /'public\/folder-order\.mjs'/);
});
