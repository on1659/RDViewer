import http from 'node:http';
import { readFile, realpath, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parsePathInput } from './path-input.mjs';
import { createProjectRegistry, defaultProjectsFile } from './project-registry.mjs';
import { createProjectGrouper } from './project-groups.mjs';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const markdownExtension = /\.(md|markdown|mdown)$/i;
const metadataDirectories = new Set(['.git', '.hg', '.svn']);
const excludedDirectories = new Set([...metadataDirectories, 'node_modules', 'old', 'build', 'dist', 'coverage', 'Pods', 'vendor']);
const maxDocumentSize = 5 * 1024 * 1024;
const maxAssetSize = 20 * 1024 * 1024;
const maxSearchBytes = 32 * 1024 * 1024;
const maxSearchResults = 200;
const assetTypes = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};
const publicFiles = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['public/icon.svg', 'image/svg+xml'],
  '/vendor/markdown-it.js': ['node_modules/markdown-it/dist/markdown-it.min.js', 'text/javascript; charset=utf-8'],
  '/vendor/highlight.min.js': ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'text/javascript; charset=utf-8'],
  '/vendor/highlight.css': ['node_modules/@highlightjs/cdn-assets/styles/github.min.css', 'text/css; charset=utf-8'],
};

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveReadable(root, input, isMarkdown) {
  if (!input || input.includes('\0') || path.isAbsolute(input) || input.includes('\\')) {
    throw fail(400, '올바른 상대 파일 경로가 필요합니다.');
  }
  const lexical = path.resolve(root, input);
  const relative = path.relative(root, lexical);
  if (!inside(root, lexical) || relative.split(path.sep).some((part) => metadataDirectories.has(part))) {
    throw fail(403, '이 폴더에서 읽을 수 없는 경로입니다.');
  }
  const extension = path.extname(lexical).toLowerCase();
  if (isMarkdown ? !markdownExtension.test(lexical) : !assetTypes[extension]) {
    throw fail(415, isMarkdown ? 'Markdown 파일만 열 수 있습니다.' : '지원하지 않는 이미지 형식입니다.');
  }
  const canonical = await realpath(lexical);
  if (!inside(root, canonical)) throw fail(403, '폴더 밖의 파일은 읽을 수 없습니다.');
  if (isMarkdown ? !markdownExtension.test(canonical) : !assetTypes[path.extname(canonical).toLowerCase()]) {
    throw fail(415, '지원하지 않는 파일 형식입니다.');
  }
  if (path.relative(root, canonical).split(path.sep).some((part) => metadataDirectories.has(part))) {
    throw fail(403, '버전 관리 내부 파일은 읽을 수 없습니다.');
  }
  const info = await stat(canonical);
  if (!info.isFile()) throw fail(404, '파일을 찾을 수 없습니다.');
  if (info.size > (isMarkdown ? maxDocumentSize : maxAssetSize)) {
    throw fail(413, isMarkdown ? '5MB 이하 문서만 열 수 있습니다.' : '20MB 이하 이미지만 열 수 있습니다.');
  }
  return { canonical, relative, extension };
}

async function listDocuments(root) {
  const files = [];
  let truncated = false;
  let visited = 0;
  async function visit(directory, depth = 0) {
    if (depth > 20 || files.length >= 5000 || visited >= 20000) { truncated = true; return; }
    visited += 1;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= 5000 || visited >= 20000) { truncated = true; break; }
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory() && !excludedDirectories.has(entry.name)) await visit(target, depth + 1);
      else if (entry.isFile() && markdownExtension.test(entry.name)) {
        const info = await stat(target).catch(() => null);
        if (info) files.push({ path: path.relative(root, target).split(path.sep).join('/'), name: entry.name, size: info.size });
      }
    }
  }
  await visit(root);
  return { rootName: path.basename(root), files, truncated };
}

async function readOpenInput(req) {
  if (req.headers['x-folio-request'] !== '1') throw fail(403, 'RDViewer의 파일 열기를 이용하세요.');
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw fail(415, 'JSON 형식으로 파일 경로를 보내세요.');
  }
  const limit = 16 * 1024;
  if (Number(req.headers['content-length']) > limit) throw fail(413, '파일 경로가 너무 깁니다.');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw fail(413, '파일 경로가 너무 깁니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8'))?.input; }
  catch { throw fail(400, '파일 경로 요청을 읽을 수 없습니다.'); }
}

export async function createReaderServer(rootInput, { projectsFile = null } = {}) {
  const root = await realpath(path.resolve(rootInput));
  if (!(await stat(root)).isDirectory()) throw new Error('문서 폴더를 지정하세요.');
  const registry = await createProjectRegistry(root, projectsFile);
  const groups = createProjectGrouper();
  const treeCaches = new Map();
  const mounts = new Map();
  const openedDocuments = new Map();
  async function resolveRequested(input, document) {
    if (typeof input === 'string' && input.startsWith('@projects/')) {
      const [, id, ...parts] = input.split('/');
      const project = await registry.readable(id);
      if (id === 'default') throw fail(400, '기본 프로젝트 경로를 확인하세요.');
      const file = await resolveReadable(project.path, parts.join('/'), document);
      return { ...file, relative: `@projects/${id}/${file.relative.split(path.sep).join('/')}` };
    }
    if (typeof input === 'string' && input.startsWith('@opened/')) {
      const [, id, ...parts] = input.split('/');
      const mount = mounts.get(id);
      if (!mount) throw fail(404, '이 문서를 다시 열어 주세요.');
      const file = await resolveReadable(mount, parts.join('/'), document);
      return { ...file, relative: `@opened/${id}/${file.relative.split(path.sep).join('/')}` };
    }
    return resolveReadable(root, input, document);
  }
  async function openDocument(input) {
    let target = parsePathInput(input, root);
    const containingProjects = (value) => registry.list()
      .filter((project) => inside(project.path, value));
    if (!containingProjects(target).length) target = path.join(await realpath(path.dirname(target)), path.basename(target));
    const candidate = registry.list()
      .filter((project) => inside(project.path, target))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (candidate) {
      await registry.readable(candidate.id);
      const file = await resolveReadable(candidate.path, path.relative(candidate.path, target).split(path.sep).join('/'), true);
      if (!candidate.isDefault) file.relative = `@projects/${candidate.id}/${file.relative.split(path.sep).join('/')}`;
      return { ...file, projectId: candidate.id };
    }
    // Explicit selection grants access to this parent only, including a selected
    // .claude/plans folder. Symlinks still cannot escape that boundary.
    const parent = await realpath(path.dirname(target));
    const file = await resolveReadable(parent, path.basename(target), true);
    let id = [...mounts].find(([, directory]) => directory === parent)?.[0];
    if (!id) { id = randomUUID(); mounts.set(id, parent); }
    file.relative = `@opened/${id}/${file.relative.split(path.sep).join('/')}`;
    openedDocuments.set(file.relative, {
      path: file.relative, name: path.basename(file.canonical), size: (await stat(file.canonical)).size,
    });
    return { ...file, projectId: 'loose' };
  }
  async function projectTree(id) {
    if (id === 'loose') return { rootName: '개별 문서', files: [...openedDocuments.values()], truncated: false, projectId: 'loose' };
    const project = await registry.readable(id);
    let cached = treeCaches.get(project.id);
    if (!cached || Date.now() - cached.time > 3000) {
      const tree = await listDocuments(project.path);
      if (!project.isDefault) tree.files = tree.files.map((file) => ({ ...file, path: `@projects/${project.id}/${file.path}` }));
      cached = { tree, time: Date.now() };
      treeCaches.set(project.id, cached);
    }
    return { ...cached.tree, projectId: project.id };
  }
  async function searchDocuments(input, id) {
    const query = (input || '').trim();
    if (query.length > 200 || query.includes('\0')) throw fail(400, '검색어는 200자 이하로 입력하세요.');
    const tree = await projectTree(id);
    const files = [];
    let truncated = tree.truncated;
    let bytes = 0;
    const deadline = Date.now() + 2500;
    const needle = query.toLocaleLowerCase();
    if (query) for (const entry of tree.files) {
      if (files.length >= maxSearchResults || Date.now() > deadline) { truncated = true; break; }
      // Resolve through the same access boundary used to open a document. Never
      // search another folder, metadata, or a symlink that escapes the folder.
      let content;
      try {
        const file = await resolveRequested(entry.path, true);
        const info = await stat(file.canonical);
        if (bytes + info.size > maxSearchBytes) { truncated = true; continue; }
        bytes += info.size;
        content = await readFile(file.canonical, 'utf8');
      } catch { continue; } // Deleted, oversized, or unreadable documents stay unreadable.
      const relative = entry.path.startsWith('@projects/') ? entry.path.split('/').slice(2).join('/') : entry.path.startsWith('@opened/') ? entry.name : entry.path;
      const named = relative.toLocaleLowerCase().includes(needle);
      const match = content.toLocaleLowerCase().indexOf(needle);
      if (!named && match < 0) continue;
      let snippet = '';
      let line = null;
      if (match >= 0) {
        line = content.slice(0, match).split('\n').length;
        const start = Math.max(content.lastIndexOf('\n', match - 1) + 1, match - 70);
        let end = content.indexOf('\n', match);
        if (end < 0) end = content.length;
        end = Math.min(end, Math.max(match + needle.length, start + 180));
        snippet = content.slice(start, end).trim();
      }
      files.push({ ...entry, snippet, line, matchedContent: match >= 0 });
    }
    return { query, projectId: tree.projectId, files, truncated };
  }
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    function send(status, data, contentType = 'application/json; charset=utf-8') {
      res.writeHead(status, { 'Content-Type': contentType });
      res.end(contentType.startsWith('application/json') ? JSON.stringify(data) : data);
    }
    try {
      const expectedHost = `127.0.0.1:${req.socket.localPort}`;
      const localhostHost = `localhost:${req.socket.localPort}`;
      if (![expectedHost, localhostHost].includes(req.headers.host)) throw fail(403, '로컬 주소로 접속하세요.');
      if (req.headers.origin && ![`http://${expectedHost}`, `http://${localhostHost}`].includes(req.headers.origin)) {
        throw fail(403, '외부 페이지에서 접근할 수 없습니다.');
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, '외부 페이지에서 접근할 수 없습니다.');
      const url = new URL(req.url, `http://${expectedHost}`);
      if (url.pathname === '/api/projects' && req.method === 'POST') {
        const project = await groups.describe(await registry.add(await readOpenInput(req)));
        return send(200, { project, url: `http://${expectedHost}/?project=${encodeURIComponent(project.id)}` });
      }
      if (url.pathname === '/api/projects/remove' && req.method === 'POST') {
        const id = await readOpenInput(req);
        await registry.remove(id);
        treeCaches.delete(id);
        return send(200, { removed: true });
      }
      if (url.pathname === '/api/open' && req.method === 'POST') {
        const file = await openDocument(await readOpenInput(req));
        const relative = file.relative.split(path.sep).join('/');
        return send(200, {
          path: relative, name: path.basename(file.canonical), projectId: file.projectId,
          url: `http://${expectedHost}/?doc=${encodeURIComponent(relative)}&project=${encodeURIComponent(file.projectId)}`,
        });
      }
      if (req.method !== 'GET') throw fail(405, '지원하지 않는 요청입니다.');
      if (url.pathname === '/api/info') return send(200, { app: 'folio', version: 1 });
      if (url.pathname === '/api/projects') return send(200, { projects: await groups.list(registry.list()), defaultProjectId: 'default' });
      if (url.pathname === '/api/search') {
        return send(200, await searchDocuments(url.searchParams.get('q'), url.searchParams.get('project') ?? 'default'));
      }
      if (url.pathname === '/api/tree') {
        const requested = url.searchParams.get('project');
        const tree = await projectTree(requested ?? 'default');
        return send(200, {
          ...tree,
          files: requested === null && tree.projectId !== 'loose' ? [...tree.files, ...openedDocuments.values()] : tree.files,
        });
      }
      if (url.pathname === '/api/document' || url.pathname === '/api/asset') {
        const document = url.pathname === '/api/document';
        const file = await resolveRequested(url.searchParams.get('path'), document);
        const data = await readFile(file.canonical);
        if (document) return send(200, { path: file.relative.split(path.sep).join('/'), content: data.toString('utf8') });
        // SVG is only an image; opening its URL must not execute embedded script.
        if (file.extension === '.svg') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        return send(200, data, assetTypes[file.extension]);
      }
      const publicFile = Object.hasOwn(publicFiles, url.pathname) ? publicFiles[url.pathname] : null;
      if (publicFile) return send(200, await readFile(path.join(appDirectory, publicFile[0])), publicFile[1]);
      throw fail(404, '페이지를 찾을 수 없습니다.');
    } catch (error) {
      const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      send(status, { error: error.status ? error.message : (status === 500 ? '파일을 읽지 못했습니다.' : '파일을 찾을 수 없습니다.') });
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('RDViewer Markdown Reader\nnode server.mjs [--root /path/to/docs] [--port 4317] [--open]\n기본 폴더: 실행한 폴더. 브라우저: http://127.0.0.1:4317');
    return;
  }
  let root = process.cwd();
  let port = 4317;
  let openBrowser = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root' && args[index + 1]) root = args[++index];
    else if (arg === '--port' && args[index + 1]) port = Number(args[++index]);
    else if (arg === '--open') openBrowser = true;
    else throw new Error(`알 수 없는 옵션: ${arg}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('포트는 1~65535 정수여야 합니다.');
  const server = await createReaderServer(root, { projectsFile: defaultProjectsFile() });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `${port} 포트가 사용 중입니다. --port로 다른 포트를 지정하세요.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`RDViewer Markdown Reader · ${url}\n문서 폴더: ${path.resolve(root)}\n종료: Ctrl+C`);
    if (openBrowser && process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore' }).on('error', () => console.log(`브라우저에서 ${url}을 여세요.`));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
