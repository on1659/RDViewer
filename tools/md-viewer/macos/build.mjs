import { cp, mkdir, writeFile, readFile, access, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const directory = path.dirname(fileURLToPath(import.meta.url));
const viewer = path.dirname(directory);
const output = path.join(directory, 'build', 'RDViewer.app');
const contents = path.join(output, 'Contents');
const portable = process.argv.includes('--portable');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(contents, 'MacOS'), { recursive: true });
await mkdir(path.join(contents, 'Resources', 'viewer'), { recursive: true });
execFileSync('xcrun', ['swiftc', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`, '-framework', 'Cocoa', '-framework', 'WebKit', '-framework', 'AVFoundation', '-framework', 'CoreVideo',
  path.join(directory, 'RDViewer.swift'), path.join(directory, 'Automation.swift'), path.join(directory, 'UpdateInstaller.swift'), '-o', path.join(contents, 'MacOS', 'RDViewer')], { stdio: 'inherit' });
const fontHelper = path.join(contents, 'MacOS', 'RDViewerFontCatalog');
execFileSync('xcrun', ['swiftc', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`, '-framework', 'AppKit',
  path.join(directory, 'FontCatalog.swift'), '-o', fontHelper], { stdio: 'inherit' });
execFileSync('codesign', ['--force', '--sign', '-', fontHelper], { stdio: 'inherit' });
await cp(path.join(directory, 'Info.plist'), path.join(contents, 'Info.plist'));
await cp(path.join(directory, 'RDViewer.icns'), path.join(contents, 'Resources', 'RDViewer.icns'));
if (portable) {
  const node = path.join(contents, 'MacOS', 'RDViewerNode');
  await cp(process.execPath, node);
  await cp(path.join(path.dirname(process.execPath), '..', 'LICENSE'), path.join(contents, 'Resources', 'Node-LICENSE.txt'));
  execFileSync('codesign', ['--force', '--sign', '-', node], { stdio: 'inherit' });
  try { execFileSync(node, ['--version'], { stdio: 'pipe' }); }
  catch { throw new Error('휴대용 앱에는 nodejs.org의 독립 실행형 Node.js가 필요합니다. 공유 라이브러리에 의존하는 Node.js로 패키징할 수 없습니다.'); }
  await cp(path.join(viewer, 'windows', 'welcome'), path.join(contents, 'Resources', 'welcome'), { recursive: true });
}
await writeFile(path.join(contents, 'Resources', 'runtime.json'), JSON.stringify({
  node: portable ? '../MacOS/RDViewerNode' : process.execPath,
  root: portable ? 'welcome' : path.resolve(viewer, '../..'),
}, null, 2));
for (const entry of ['server.mjs', 'font-catalog.mjs', 'update-manager.mjs', 'automation-server.mjs', 'preview-server.mjs', 'cli.mjs', 'mcp.mjs', 'API.md', 'AGENT-TOOLS.md', 'native', 'open.mjs', 'path-input.mjs', 'project-registry.mjs', 'project-groups.mjs', 'package.json', 'public', 'node_modules']) {
  const source = path.join(viewer, entry);
  try { await access(source); } catch {
    if (entry === 'path-input.mjs') continue;
    throw new Error(`${entry} 파일이 필요합니다. 먼저 npm install을 실행하고 구현을 확인하세요.`);
  }
  await cp(source, path.join(contents, 'Resources', 'viewer', entry), { recursive: true, dereference: true });
}
await mkdir(path.join(contents, 'Resources', 'viewer', 'macos'), { recursive: true });
await cp(path.join(directory, 'update-helper.mjs'), path.join(contents, 'Resources', 'viewer', 'macos', 'update-helper.mjs'));
execFileSync('codesign', ['--force', '--deep', '--sign', '-', output], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', output], { stdio: 'inherit' });
console.log(`앱 빌드: ${output}`);
async function pruneRemovedEntries(source, destination) {
  const entries = await readdir(source, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  for (const entry of await readdir(destination)) {
    if (!names.has(entry)) await rm(path.join(destination, entry), { recursive: true, force: true });
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await pruneRemovedEntries(path.join(source, entry.name), path.join(destination, entry.name));
  }
}
if (process.argv.includes('--install')) {
  const installed = path.join(os.homedir(), 'Applications', 'RDViewer.app');
  try {
    await access(installed);
    const currentInfo = await readFile(path.join(installed, 'Contents', 'Info.plist'), 'utf8');
    if (!currentInfo.includes('local.radar.folio')) throw new Error('같은 이름의 다른 앱이 있습니다.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(installed), { recursive: true });
  // Keep the bundle directory's identity: Dock bookmarks refer to that directory.
  // Deleting and recreating it leaves pinned, non-running app icons stale.
  await cp(output, installed, { recursive: true, dereference: true });
  await pruneRemovedEntries(output, installed);
  execFileSync('codesign', ['--verify', '--deep', '--strict', installed], { stdio: 'inherit' });
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', installed]);
  console.log(`설치: ${installed}`);
}
