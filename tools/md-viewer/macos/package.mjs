import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { inspectArchive } from './update-helper.mjs';

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('Mac arm64 또는 x64 환경에서 패키징하세요.');
const directory = path.dirname(fileURLToPath(import.meta.url));
const viewer = path.dirname(directory);
const { version } = JSON.parse(await readFile(path.join(viewer, 'package.json'), 'utf8'));
execFileSync(process.execPath, [path.join(directory, 'build.mjs'), '--portable'], { stdio: 'inherit' });
const bundle = path.join(directory, 'build', 'RDViewer.app');
const smokeDirectory = await mkdtemp(path.join(os.tmpdir(), 'rdviewer-portable-smoke-'));
try {
  await writeFile(path.join(smokeDirectory, 'updates.json'), JSON.stringify({ autoUpdate: false }));
  const source = `
    import assert from 'node:assert/strict';
    import path from 'node:path';
    import {readFile} from 'node:fs/promises';
    import {pathToFileURL} from 'node:url';
    const config=JSON.parse(process.argv[1]);
    assert.match(await readFile(path.join(config.bundle,'Contents/Resources/Node-LICENSE.txt'),'utf8'),/Node[.]js/);
    const {createReaderServer}=await import(pathToFileURL(path.join(config.bundle,'Contents/Resources/viewer/server.mjs')).href);
    const server=await createReaderServer(path.join(config.bundle,'Contents/Resources/welcome'),{
      projectsFile:path.join(config.temp,'projects.json'),automationFile:path.join(config.temp,'automation.json')
    });
    try {
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
      await server.automationReady;
      const origin='http://127.0.0.1:'+server.address().port;
      const get=async(route)=>{const response=await fetch(origin+route);assert.equal(response.status,200);return response.json()};
      const update=await get('/api/updates');
      assert.equal(update.supported,true);assert.equal(update.currentVersion,config.version);assert.equal(update.autoUpdate,false);
      const fonts=await get('/api/fonts');assert.equal(fonts.available,true);assert.ok(fonts.fonts.length>0);
      const document=await get('/api/file?path=README.md');assert.equal(document.kind,'markdown');assert.match(document.content,/RDViewer/);
      console.log('Portable Mac bundled Node: updater, '+fonts.fonts.length+' installed fonts, and Markdown read passed.');
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  `;
  execFileSync(path.join(bundle, 'Contents', 'MacOS', 'RDViewerNode'), ['--input-type=module', '--eval', source, JSON.stringify({ bundle, temp: smokeDirectory, version })], { stdio: 'inherit', timeout: 45000 });
} finally { await rm(smokeDirectory, { recursive: true, force: true }); }
const filename = `RDViewer-${version}-macos-${process.arch}.zip`;
const archive = path.join(directory, 'build', filename);
execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', bundle, archive], { stdio: 'inherit' });
await inspectArchive(archive);
const hash = createHash('sha256');
for await (const bytes of createReadStream(archive)) hash.update(bytes);
await writeFile(`${archive}.sha256`, `${hash.digest('hex')}  ${filename}\n`);
console.log(`Mac portable archive: ${archive}`);
