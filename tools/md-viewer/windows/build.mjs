import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { packager } from '@electron/packager';
import { build as buildInstaller, Platform, Arch } from 'electron-builder';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';

const directory = path.dirname(fileURLToPath(import.meta.url));
const viewer = path.dirname(directory);
const build = path.join(directory, 'build');
const stage = path.join(build, 'stage');
const packageInfo = JSON.parse(await readFile(path.join(viewer, 'package.json'), 'utf8'));
const buildInfo = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
await mkdir(build, { recursive: true });
await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, 'viewer'), { recursive: true });

// Explicit source allowlist: no workspace documents, registry, credentials, QA,
// macOS bundles, test fixtures, or build dependencies can enter the release.
const files = [
  'server.mjs', 'path-input.mjs', 'project-registry.mjs', 'project-groups.mjs',
  'public/app.js', 'public/style.css', 'public/index.html', 'public/icon.svg',
  'node_modules/markdown-it/dist/markdown-it.min.js',
  'node_modules/markdown-it/LICENSE',
  'node_modules/@highlightjs/cdn-assets/highlight.min.js',
  'node_modules/@highlightjs/cdn-assets/styles/github.min.css',
  'node_modules/@highlightjs/cdn-assets/LICENSE',
];
for (const file of files) {
  const target = path.join(stage, 'viewer', file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(viewer, file), target);
}
for (const file of ['main.mjs', 'preload.cjs', 'launch-input.mjs', 'icon.png', 'welcome']) {
  await cp(path.join(directory, file), path.join(stage, file), { recursive: true });
}
await writeFile(path.join(stage, 'package.json'), `${JSON.stringify({
  name: 'rdviewer', productName: 'RDViewer', version: packageInfo.version,
  description: 'Local Markdown reader', main: 'main.mjs', type: 'module', private: true,
  author: 'RDViewer', homepage: 'https://github.com/on1659/RDViewer',
}, null, 2)}\n`);

// ICO can store a lossless 256px PNG, preserving the existing RDViewer artwork.
const png = await readFile(path.join(directory, 'icon.png'));
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
const icon = path.join(build, 'RDViewer.ico');
await writeFile(icon, Buffer.concat([header, png]));

const [output] = await packager({
  dir: stage, out: build, name: 'RDViewer', executableName: 'RDViewer',
  platform: 'win32', arch: 'x64', electronVersion: buildInfo.devDependencies.electron,
  appVersion: packageInfo.version, buildVersion: packageInfo.version,
  asar: true, prune: false, overwrite: true, icon,
  win32metadata: { CompanyName: 'RDViewer', FileDescription: 'RDViewer Markdown Reader', ProductName: 'RDViewer' },
});
await cp(path.join(directory, 'README.md'), path.join(output, 'README.md'));
await cp(path.join(directory, 'Register-FileTypes.ps1'), path.join(output, 'Register-FileTypes.ps1'));
const exe = NtExecutable.from(await readFile(path.join(output, 'RDViewer.exe')));
const resources = NtExecutableResource.from(exe);
const versions = Resource.VersionInfo.fromEntries(resources.entries);
const icons = Resource.IconGroupEntry.fromEntries(resources.entries);
if (!exe.is32bit() && versions.length && icons.length) {
  console.log('Validated Windows x64 PE executable, version metadata, and icon resource.');
} else {
  throw new Error('Windows executable resource verification failed.');
}
// Wrap only the allowlisted packager output. Builder must never repack the
// repository itself, which contains developer tools and unrelated documents.
const installerName = `RDViewer-${packageInfo.version}-windows-x64-setup.exe`;
await buildInstaller({
  projectDir: stage,
  prepackaged: output,
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  publish: 'never',
  config: {
    appId: 'RDViewer.Markdown', productName: 'RDViewer',
    directories: { output: build, buildResources: directory },
    electronVersion: buildInfo.devDependencies.electron,
    win: { icon, signAndEditExecutable: false, signExecutable: false },
    nsis: {
      artifactName: installerName,
      oneClick: false, perMachine: false, allowElevation: false,
      allowToChangeInstallationDirectory: true,
      packElevateHelper: false, deleteAppDataOnUninstall: false,
      createDesktopShortcut: true, createStartMenuShortcut: true,
      shortcutName: 'RDViewer', runAfterFinish: true,
      differentialPackage: false,
      installerIcon: icon, uninstallerIcon: icon,
      include: path.join(directory, 'installer.nsh'),
    },
  },
});
const installerPath = path.join(build, installerName);
const installer = NtExecutable.from(await readFile(installerPath));
const installerResources = NtExecutableResource.from(installer);
if (!Resource.IconGroupEntry.fromEntries(installerResources.entries).length) {
  throw new Error('Installer icon resource verification failed.');
}
const digest = createHash('sha256');
for await (const chunk of createReadStream(installerPath)) digest.update(chunk);
await writeFile(`${installerPath}.sha256`, `${digest.digest('hex')}  ${installerName}\n`);
console.log(`Windows offline installer: ${installerPath}`);
