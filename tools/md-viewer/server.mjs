import http from 'node:http';
import { open, readFile, realpath, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parsePathInput } from './path-input.mjs';
import { createProjectRegistry, defaultProjectsFile } from './project-registry.mjs';
import { createProjectGrouper } from './project-groups.mjs';
import { createAutomationBroker, defaultAutomationFile, readAutomationJSON } from './automation-server.mjs';
import { createPreviewManager } from './preview-server.mjs';

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
  '/shortcuts.mjs': ['public/shortcuts.mjs', 'text/javascript; charset=utf-8'],
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

function fileKind(filename) {
  if (markdownExtension.test(filename)) return 'markdown';
  if (/\.png$/i.test(filename)) return 'image';
  if (/\.mp4$/i.test(filename)) return 'video';
  if (/\.html?$/i.test(filename)) return 'html';
  return null;
}

async function resolveReadable(root, input, mode) {
  const accepts = (filename) => mode === true ? markdownExtension.test(filename) : mode === false ? !!assetTypes[path.extname(filename).toLowerCase()] : !!fileKind(filename);
  if (!input || input.includes('\0') || path.isAbsolute(input) || input.includes('\\')) {
    throw fail(400, '올바른 상대 파일 경로가 필요합니다.');
  }
  const lexical = path.resolve(root, input);
  const relative = path.relative(root, lexical);
  if (!inside(root, lexical) || relative.split(path.sep).some((part) => metadataDirectories.has(part))) {
    throw fail(403, '이 폴더에서 읽을 수 없는 경로입니다.');
  }
  const extension = path.extname(lexical).toLowerCase();
  if (!accepts(lexical)) throw fail(415, mode === true ? 'Markdown 파일만 열 수 있습니다.' : mode === false ? '지원하지 않는 이미지 형식입니다.' : 'Markdown, PNG, MP4, HTML 파일만 열 수 있습니다.');
  const canonical = await realpath(lexical);
  if (!inside(root, canonical)) throw fail(403, '폴더 밖의 파일은 읽을 수 없습니다.');
  if (!accepts(canonical) || (mode === 'file' && fileKind(lexical) !== fileKind(canonical))) {
    throw fail(415, '지원하지 않는 파일 형식입니다.');
  }
  if (path.relative(root, canonical).split(path.sep).some((part) => metadataDirectories.has(part))) {
    throw fail(403, '버전 관리 내부 파일은 읽을 수 없습니다.');
  }
  const info = await stat(canonical);
  if (!info.isFile()) throw fail(404, '파일을 찾을 수 없습니다.');
  const kind = fileKind(canonical);
  if ((mode === true || kind === 'markdown') && info.size > maxDocumentSize) throw fail(413, '5MB 이하 문서만 열 수 있습니다.');
  if ((mode === false || kind === 'image') && info.size > maxAssetSize) throw fail(413, '20MB 이하 이미지만 열 수 있습니다.');
  if (kind === 'html' && info.size > maxDocumentSize) throw fail(413, '5MB 이하 HTML 파일만 열 수 있습니다.');
  if (!Number.isSafeInteger(info.size)) throw fail(413, '이 파일 크기는 지원하지 않습니다.');
  return { canonical, relative, extension, kind, size: info.size, previewRoot: root };
}


// Serve only requested bytes, with backpressure and cancellation. No video-sized
// buffers or decoding are involved in listing, metadata, search, or playback.
async function streamMedia(req, res, file) {
  const handle = await open(file.canonical, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw fail(404, '파일을 찾을 수 없습니다.');
    if (!Number.isSafeInteger(info.size)) throw fail(413, '이 파일 크기는 지원하지 않습니다.');
    if (file.kind === 'image' && info.size > maxAssetSize) throw fail(413, '20MB 이하 이미지만 열 수 있습니다.');
    const size = info.size;
    let start = 0;
    let end = size - 1;
    let status = 200;
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.method === 'GET' && req.headers.range !== undefined) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      const rejectRange = () => {
        res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Content-Length': '0' });
        res.end();
      };
      if (!match || (!match[1] && !match[2]) || size === 0) return rejectRange();
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return rejectRange();
        start = Math.max(0, size - suffix);
      } else {
        start = Number(match[1]);
        const requestedEnd = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return rejectRange();
        end = Math.min(size - 1, requestedEnd);
      }
      status = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.writeHead(status, {
      'Content-Type': file.kind === 'video' ? 'video/mp4' : 'image/png',
      'Content-Length': String(size === 0 ? 0 : end - start + 1),
    });
    if (req.method === 'HEAD' || size === 0) { res.end(); return; }
    await pipeline(handle.createReadStream({ start, end, autoClose: false, highWaterMark: 64 * 1024 }), res);
  } finally {
    await handle.close();
  }
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
      else if (entry.isFile() && fileKind(entry.name)) {
        const info = await stat(target).catch(() => null);
        if (info) files.push({ path: path.relative(root, target).split(path.sep).join('/'), name: entry.name, size: info.size, kind: fileKind(entry.name) });
      }
    }
  }
  await visit(root);
  return { rootName: path.basename(root), files, truncated };
}

async function readOpenRequest(req) {
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
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, '파일 경로 요청을 읽을 수 없습니다.'); }
}
async function readOpenInput(req) { return (await readOpenRequest(req))?.input; }

export async function createReaderServer(rootInput, { projectsFile = null, automationFile = null } = {}) {
  const root = await realpath(path.resolve(rootInput));
  if (!(await stat(root)).isDirectory()) throw new Error('문서 폴더를 지정하세요.');
  const registry = await createProjectRegistry(root, projectsFile);
  const groups = createProjectGrouper();
  const treeCaches = new Map();
  const mounts = new Map();
  const openedDocuments = new Map();
  const preview = createPreviewManager({ blockedFiles: automationFile ? [automationFile] : [] });
  let readerOrigin = '';
  async function prepareOpen(input) {
    if (/^https?:\/\//i.test(input)) {
      const url = new URL(input);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || ['4317', '4318', new URL(readerOrigin).port, ...(preview.origin() ? [new URL(preview.origin()).port] : [])].includes(url.port || (url.protocol === 'https:' ? '443' : '80'))) throw fail(403, '별도의 로컬 개발 서버 주소만 열 수 있습니다.');
      return { kind: 'url', url: url.href, previewURL: url.href };
    }
    const file = input.startsWith('@projects/') || input.startsWith('@opened/') ? await resolveRequested(input, 'file') : await openDocument(input);
    const relative = file.relative.split(path.sep).join('/');
    const projectId = relative.startsWith('@projects/') ? relative.split('/')[1] : relative.startsWith('@opened/') ? 'loose' : 'default';
    return { kind: file.kind, path: relative, fsPath: file.canonical, projectId, url: `${readerOrigin}/?doc=${encodeURIComponent(relative)}&project=${encodeURIComponent(projectId)}`, ...(file.kind === 'html' ? { previewURL: await preview.mount(file) } : {}) };
  }
  const automation = createAutomationBroker({ filename: automationFile, prepare: async (command) => command.action === 'open' ? { action: 'open', args: await prepareOpen(command.args.input) } : command, complete: async (action) => { if (action === 'close') await preview.close(); } });
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
      const file = await resolveReadable(candidate.path, path.relative(candidate.path, target).split(path.sep).join('/'), 'file');
      if (!candidate.isDefault) file.relative = `@projects/${candidate.id}/${file.relative.split(path.sep).join('/')}`;
      return { ...file, projectId: candidate.id };
    }
    // Explicit selection grants access to this parent only, including a selected
    // .claude/plans folder. Symlinks still cannot escape that boundary.
    const parent = await realpath(path.dirname(target));
    const file = await resolveReadable(parent, path.basename(target), 'file');
    let id = [...mounts].find(([, directory]) => directory === parent)?.[0];
    if (!id) { id = randomUUID(); mounts.set(id, parent); }
    file.relative = `@opened/${id}/${file.relative.split(path.sep).join('/')}`;
    openedDocuments.set(file.relative, {
      path: file.relative, name: path.basename(file.canonical), size: file.size, kind: file.kind,
    });
    return { ...file, projectId: 'loose' };
  }
  async function projectTree(id) {
    if (id === 'loose') return { rootName: '개별 문서', files: [...openedDocuments.values()], truncated: false, projectId: 'loose' };
    const project = await registry.readable(id);
    let cached = treeCaches.get(project.id);
    if (!cached || cached.path !== project.path || Date.now() - cached.time > 3000) {
      const tree = await listDocuments(project.path);
      if (!project.isDefault) tree.files = tree.files.map((file) => ({ ...file, path: `@projects/${project.id}/${file.path}` }));
      cached = { tree, path: project.path, time: Date.now() };
      treeCaches.set(project.id, cached);
    }
    return { ...cached.tree, projectId: project.id };
  }
  async function searchDocuments(input, id, typesInput = null) {
    const typeKinds = { md: 'markdown', png: 'image', mp4: 'video', html: 'html' };
    const types = typesInput === null ? Object.keys(typeKinds) : typesInput === '' ? [] : typesInput.split(',');
    if (types.some((type) => !Object.hasOwn(typeKinds, type))) throw fail(400, '지원하는 파일 형식은 md, png, mp4, html입니다.');
    const kinds = new Set(types.map((type) => typeKinds[type]));
    const query = (input || '').trim();
    if (query.length > 200 || query.includes('\0')) throw fail(400, '검색어는 200자 이하로 입력하세요.');
    const tree = await projectTree(id);
    const files = [];
    let truncated = tree.truncated;
    let bytes = 0;
    const deadline = Date.now() + 2500;
    const needle = query.toLocaleLowerCase();
    if (query) for (const entry of tree.files) {
      if (!kinds.has(fileKind(entry.path))) continue;
      if (files.length >= maxSearchResults || Date.now() > deadline) { truncated = true; break; }
      // Resolve through the same access boundary used to open a document. Never
      // search another folder, metadata, or a symlink that escapes the folder.
      let content = '';
      try {
        const file = await resolveRequested(entry.path, 'file');
        if (file.kind !== 'markdown') {
          const relative = entry.path.startsWith('@projects/') ? entry.path.split('/').slice(2).join('/') : entry.path.startsWith('@opened/') ? entry.name : entry.path;
          if (relative.toLocaleLowerCase().includes(needle)) files.push({ ...entry, snippet: '', line: null, matchedContent: false });
          continue;
        }
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
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
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
      if (await automation.handle(req, res, url, send)) return;
      if (url.pathname === '/api/preview/status' && req.method === 'GET') return send(200, automation.status());
      if (url.pathname === '/api/preview/open' && req.method === 'POST') {
        const input = await readOpenInput(req);
        if (typeof input !== 'string' || input.length > 8192) throw fail(400, '열 파일 경로가 필요합니다.');
        if (automation.status().connected) {
          const reply = await automation.dispatch({ action: 'open', args: { input } });
          return send(200, { native: true, ...reply });
        }
        const prepared = await prepareOpen(input);
        if (!['html', 'url'].includes(prepared.kind)) throw fail(415, 'HTML 미리보기를 선택하세요.');
        return send(200, { native: false, previewURL: prepared.previewURL });
      }
      if (url.pathname === '/api/preview/action' && req.method === 'POST') {
        if (req.headers['x-folio-request'] !== '1') throw fail(403, 'RDViewer에서 미리보기 작업을 선택하세요.');
        const command = await readAutomationJSON(req);
        if (!['record.start', 'record.stop', 'screenshot', 'close'].includes(command.action)) throw fail(400, '지원하지 않는 미리보기 작업입니다.');
        const reply = await automation.dispatch(command);
        return send(200, { native: true, ...reply });
      }
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
      if (url.pathname === '/api/projects/relocate' && req.method === 'POST') {
        const input = await readOpenRequest(req);
        if (!input || typeof input.id !== 'string' || typeof input.input !== 'string') throw fail(400, '다시 연결할 폴더와 새 경로가 필요합니다.');
        const project = await groups.describe(await registry.relocate(input.id, input.input));
        treeCaches.delete(project.id);
        return send(200, { project });
      }
      if (url.pathname === '/api/open' && req.method === 'POST') {
        const file = await openDocument(await readOpenInput(req));
        const relative = file.relative.split(path.sep).join('/');
        return send(200, {
          path: relative, name: path.basename(file.canonical), projectId: file.projectId, kind: file.kind,
          url: `http://${expectedHost}/?doc=${encodeURIComponent(relative)}&project=${encodeURIComponent(file.projectId)}`,
        });
      }
      if (url.pathname === '/api/media' && ['GET', 'HEAD'].includes(req.method)) {
        const file = await resolveRequested(url.searchParams.get('path'), 'file');
        if (!['image', 'video'].includes(file.kind)) throw fail(415, 'PNG 또는 MP4 파일만 열 수 있습니다.');
        return await streamMedia(req, res, file);
      }
      if (req.method !== 'GET') throw fail(405, '지원하지 않는 요청입니다.');
      if (url.pathname === '/api/info') { await server.automationReady; return send(200, { app: 'folio', version: 1 }); }
      if (url.pathname === '/api/projects') {
        const { projects, removedIds } = await registry.reconcile();
        removedIds.forEach((id) => treeCaches.delete(id));
        return send(200, { projects: await groups.list(projects), defaultProjectId: 'default', removedIds });
      }
      if (url.pathname === '/api/search') {
        return send(200, await searchDocuments(url.searchParams.get('q'), url.searchParams.get('project') ?? 'default', url.searchParams.get('types')));
      }
      if (url.pathname === '/api/tree') {
        const requested = url.searchParams.get('project');
        const tree = await projectTree(requested ?? 'default');
        return send(200, {
          ...tree,
          files: requested === null && tree.projectId !== 'loose' ? [...tree.files, ...openedDocuments.values()] : tree.files,
        });
      }
      if (url.pathname === '/api/file') {
        const file = await resolveRequested(url.searchParams.get('path'), 'file');
        const relative = file.relative.split(path.sep).join('/');
        return send(200, { path: relative, fsPath: file.canonical, kind: file.kind, size: file.size,
          ...(file.kind === 'markdown' ? { content: await readFile(file.canonical, 'utf8') } : file.kind === 'html' ? { previewURL: null } : { mediaURL: `/api/media?path=${encodeURIComponent(relative)}` }) });
      }
      if (url.pathname === '/api/document' || url.pathname === '/api/asset') {
        const document = url.pathname === '/api/document';
        const file = await resolveRequested(url.searchParams.get('path'), document);
        const data = await readFile(file.canonical);
        if (document) return send(200, { path: file.relative.split(path.sep).join('/'), fsPath: file.canonical, content: data.toString('utf8') });
        // SVG is only an image; opening its URL must not execute embedded script.
        if (file.extension === '.svg') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        return send(200, data, assetTypes[file.extension]);
      }
      const publicFile = Object.hasOwn(publicFiles, url.pathname) ? publicFiles[url.pathname] : null;
      if (publicFile) return send(200, await readFile(path.join(appDirectory, publicFile[0])), publicFile[1]);
      throw fail(404, '페이지를 찾을 수 없습니다.');
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      if (error.removedProjectId) treeCaches.delete(error.removedProjectId);
      send(status, { error: error.status ? error.message : (status === 500 ? '파일을 읽지 못했습니다.' : '파일을 찾을 수 없습니다.'), ...(error.status && error.code ? { code: error.code } : {}), ...(error.removedProjectId ? { removedProjectId: error.removedProjectId } : {}) });
    }
  });
  server.automation = automation;
  server.automationReady = Promise.resolve();
  server.on('listening', () => { readerOrigin = `http://127.0.0.1:${server.address().port}`; server.automationReady = automation.initialize(readerOrigin); server.automationReady.catch(() => {}); });
  server.on('close', () => { automation.close(); void preview.close(); });
  return server;
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
  const server = await createReaderServer(root, { projectsFile: defaultProjectsFile(), automationFile: defaultAutomationFile() });
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
