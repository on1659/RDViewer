import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { inspectArchive, preserveRuntime, replaceContents } from './update-helper.mjs';

function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name), localName = Buffer.from(item.localName ?? item.name), data = Buffer.from(item.data ?? 'file');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(localName.length, 26);
    locals.push(local, localName, data);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(item.unpacked ?? data.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(((item.mode ?? 0o100644) << 16) >>> 0, 38); header.writeUInt32LE(offset, 42);
    central.push(header, name); offset += local.length + localName.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const baseEntries = [{ name: 'RDViewer.app/Contents/Info.plist' }, { name: 'RDViewer.app/Contents/MacOS/RDViewer' }];
async function fixture(t) { const directory = await mkdtemp(path.join(os.tmpdir(), 'rdviewer-mac-update-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
async function inspectFixture(t, entries) { const directory = await fixture(t), archive = path.join(directory, 'update.zip'); await writeFile(archive, zip(entries)); return inspectArchive(archive); }

test('Mac ZIP inspection accepts only the expected app files', async (t) => {
  assert.equal((await inspectFixture(t, baseEntries)).entries, 2);
  await assert.rejects(inspectFixture(t, [{ name: 'Other.app/Contents/Info.plist' }]), /ZIP 경로/);
  await assert.rejects(inspectFixture(t, [{ name: 'RDViewer.app/Contents/readme' }]), /앱이 없는/);
});
test('Mac ZIP inspection rejects traversal, backslashes, duplicate and absolute names', async (t) => {
  for (const name of ['RDViewer.app/../escape', 'RDViewer.app/Contents/../../escape', '/RDViewer.app/Contents/file', 'RDViewer.app/Contents/\\escape', 'RDViewer.app//escape']) await assert.rejects(inspectFixture(t, [...baseEntries, { name }]), /ZIP 경로/);
  await assert.rejects(inspectFixture(t, [...baseEntries, baseEntries[0]]), /ZIP 경로/);
});
test('Mac ZIP inspection rejects symlinks, local/central mismatch, and excessive extraction', async (t) => {
  await assert.rejects(inspectFixture(t, [...baseEntries, { name: 'RDViewer.app/Contents/link', mode: 0o120777 }]), /링크/);
  await assert.rejects(inspectFixture(t, [{ ...baseEntries[0], localName: '../escape' }, baseEntries[1]]), /일치하지/);
  await assert.rejects(inspectFixture(t, [...baseEntries, { name: 'RDViewer.app/Contents/huge', unpacked: 1024 * 1024 * 1024 }]), /크기/);
});
async function replacementFixture(t) {
  const root = await fixture(t), installed = path.join(root, 'RDViewer.app'), staged = path.join(root, 'staged', 'RDViewer.app'), backup = path.join(installed, '.backup');
  for (const [directory, value] of [[installed, 'old'], [staged, 'new']]) { await mkdir(path.join(directory, 'Contents'), { recursive: true }); await writeFile(path.join(directory, 'Contents', 'version'), value); }
  return { installed, staged, backup };
}
test('Mac Contents update preserves bundle root identity and rolls back failed validation', async (t) => {
  const paths = await replacementFixture(t), inode = (await stat(paths.installed)).ino;
  await assert.rejects(replaceContents({ ...paths, verify: async () => { throw new Error('bad signature'); }, launch: async () => assert.fail('must not launch') }), /bad signature/);
  assert.equal(await readFile(path.join(paths.installed, 'Contents', 'version'), 'utf8'), 'old');
  assert.equal((await stat(paths.installed)).ino, inode);
});
test('Mac Contents update rolls back a failed application health check', async (t) => {
  const paths = await replacementFixture(t);
  await assert.rejects(replaceContents({ ...paths, verify: async () => {}, launch: async () => { throw new Error('launch failed'); } }), /launch failed/);
  assert.equal(await readFile(path.join(paths.installed, 'Contents', 'version'), 'utf8'), 'old');
});
test('Mac Contents update keeps backup until launch succeeds', async (t) => {
  const paths = await replacementFixture(t), inode = (await stat(paths.installed)).ino;
  await replaceContents({ ...paths, verify: async () => {}, launch: async () => { assert.equal(await readFile(path.join(paths.backup, 'version'), 'utf8'), 'old'); } });
  assert.equal(await readFile(path.join(paths.installed, 'Contents', 'version'), 'utf8'), 'new');
  assert.equal((await stat(paths.installed)).ino, inode);
});
test('Mac update preserves external and portable runtime settings byte for byte', async (t) => {
  for (const runtime of [{ node: '/custom/node', root: '/my/workspace' }, { node: '../MacOS/RDViewerNode', root: 'welcome' }]) {
    const paths = await replacementFixture(t);
    for (const app of [paths.staged, paths.installed]) await mkdir(path.join(app, 'Contents', 'Resources'));
    const text = JSON.stringify(runtime, null, 2) + '\n';
    await writeFile(path.join(paths.installed, 'Contents', 'Resources', 'runtime.json'), text);
    await preserveRuntime(paths.staged, paths.installed);
    assert.equal(await readFile(path.join(paths.staged, 'Contents', 'Resources', 'runtime.json'), 'utf8'), text);
  }
});
