import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  const root = await fixture(t), installed = path.join(root, 'RDViewer.app'), staged = path.join(root, 'staged', 'RDViewer.app'), backup = path.join(root, '.RDViewer.update-backup-test');
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
test('Mac update rejects backup directories inside the signed bundle', async (t) => {
  const paths = await replacementFixture(t);
  await assert.rejects(replaceContents({ ...paths, backup: path.join(paths.installed, '.backup'), verify: async () => {}, launch: async () => {} }), /복구 폴더 위치/);
  assert.equal(await readFile(path.join(paths.installed, 'Contents', 'version'), 'utf8'), 'old');
});
test('Mac signed app verifies while its rollback backup is retained beside the bundle', { skip: process.platform !== 'darwin' }, async (t) => {
  const execute = promisify(execFile), root = await fixture(t);
  const installed = path.join(root, 'RDViewer.app'), staged = path.join(root, 'staged', 'RDViewer.app'), backup = path.join(root, '.RDViewer.update-backup-signed-test');
  for (const [app, version] of [[installed, '1.0.0'], [staged, '2.0.0']]) {
    await mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    await mkdir(path.join(app, 'Contents', 'Resources'));
    await cp('/usr/bin/true', path.join(app, 'Contents', 'MacOS', 'RDViewer'));
    await writeFile(path.join(app, 'Contents', 'Resources', 'version'), version);
    await writeFile(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>RDViewer</string><key>CFBundleIdentifier</key><string>local.radar.folio</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
    await execute('/usr/bin/codesign', ['--force', '--sign', '-', app]);
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  }
  // Prove the fixture catches the original bug, rather than merely accepting
  // a bundle whose signature is never actually checked by the platform.
  await cp(path.join(installed, 'Contents'), path.join(installed, '.bad-backup'), { recursive: true });
  await assert.rejects(execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]), /unsealed contents/);
  await rm(path.join(installed, '.bad-backup'), { recursive: true });
  const inode = (await stat(installed)).ino;
  let checkedDuringLaunch = false;
  await replaceContents({ staged, installed, backup,
    verify: async (app) => {
      assert.equal(await readFile(path.join(backup, 'Resources', 'version'), 'utf8'), '1.0.0');
      assert.deepEqual(await readdir(app), ['Contents']);
      await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    },
    launch: async (app) => {
      assert.equal(await readFile(path.join(app, 'Contents', 'Resources', 'version'), 'utf8'), '2.0.0');
      await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
      checkedDuringLaunch = true;
    },
  });
  assert.equal(checkedDuringLaunch, true);
  assert.equal((await stat(installed)).ino, inode);
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
