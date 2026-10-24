import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createReaderServer } from './server.mjs';
import { openInput } from './open.mjs';

test('local reader serves Markdown and contains file access within its root', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'leaf-reader-'));
  const root = path.join(temp, 'docs');
  await mkdir(root);
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'README.md'), '# 안녕하세요\n\n[문서](second.md)');
  await writeFile(path.join(root, 'second.md'), '# Second');
  await writeFile(path.join(root, '.git', 'secret.md'), 'hidden');
  await writeFile(path.join(root, 'node_modules', 'excluded.md'), 'dependency');
  await writeFile(path.join(root, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(path.join(root, 'secret.txt'), 'not markdown');
  await writeFile(path.join(root, 'large.md'), 'x'.repeat(5 * 1024 * 1024 + 1));
  await writeFile(path.join(temp, 'outside.md'), 'outside');
  await symlink(path.join(temp, 'outside.md'), path.join(root, 'escape.md'));
  await symlink(path.join(root, '.git', 'secret.md'), path.join(root, 'hidden-alias.md'));
  await symlink(path.join(root, 'secret.txt'), path.join(root, 'text-alias.md'));
  const server = await createReaderServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (endpoint, options) => fetch(`${base}${endpoint}`, options);
  const tree = await (await get('/api/tree')).json();
  assert.equal(tree.rootName, 'docs');
  assert.deepEqual(tree.files.map((file) => file.name).sort(), ['README.md', 'large.md', 'second.md']);
  assert.equal((await (await get('/api/document?path=README.md')).json()).content.startsWith('# 안녕하세요'), true);
  for (const name of ['../outside.md', 'escape.md', '.git/secret.md', 'hidden-alias.md']) {
    assert.equal((await get(`/api/document?path=${encodeURIComponent(name)}`)).status, 403, name);
  }
  assert.equal((await get('/api/document?path=secret.txt')).status, 415);
  assert.equal((await get('/api/document?path=text-alias.md')).status, 415);
  assert.equal((await get('/api/document?path=missing.md')).status, 404);
  assert.equal((await get('/api/document?path=large.md')).status, 413);
  assert.equal((await get('/api/document?path=README.md', { method: 'POST' })).status, 405);
  assert.equal((await get('/api/tree', { headers: { origin: 'https://example.com' } })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/api/tree`, { headers: { host: 'example.com' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await get('/api/tree', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const image = await get('/api/asset?path=image.svg');
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await get('/api/asset?path=README.md')).status, 415);
  assert.equal((await get('/vendor/markdown-it.js')).status, 200);
});

test('explicit opening mounts external documents without weakening GET boundaries', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'folio-open-'));
  const root = path.join(temp, 'root');
  const external = path.join(temp, '.claude', 'plans');
  await mkdir(root);
  await mkdir(external, { recursive: true });
  await mkdir(path.join(external, '.git'));
  await writeFile(path.join(root, 'README.md'), 'Root');
  await writeFile(path.join(external, '한글 document.md'), 'External');
  await writeFile(path.join(external, 'linked.md'), 'Linked');
  await writeFile(path.join(external, 'img.svg'), '<svg></svg>');
  await writeFile(path.join(external, '.git', 'private.md'), 'Private');
  await writeFile(path.join(temp, 'outside.md'), 'Outside');
  await writeFile(path.join(external, 'too-large.md'), 'x'.repeat(5 * 1024 * 1024 + 1));
  await symlink(path.join(temp, 'outside.md'), path.join(external, 'escape.md'));
  const server = await createReaderServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const open = (input, headers = {}) => fetch(`${base}/api/open`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1', ...headers },
    body: JSON.stringify({ input }),
  });
  assert.deepEqual(await (await fetch(`${base}/api/info`)).json(), { app: 'folio', version: 1 });
  assert.equal((await fetch(`${base}/api/open?input=${encodeURIComponent(path.join(external, 'linked.md'))}`)).status, 404);
  const result = await (await open(`[文档](<${external}/한글 document.md:12>)`)).json();
  assert.match(result.path, /^@opened\/[\w-]+\/한글 document\.md$/);
  assert.equal(new URL(result.url).searchParams.get('doc'), result.path);
  const getDoc = (name) => fetch(`${base}/api/document?path=${encodeURIComponent(name)}`);
  assert.equal((await (await getDoc(result.path)).json()).content, 'External');
  const prefix = result.path.slice(0, result.path.lastIndexOf('/') + 1);
  assert.equal((await (await getDoc(`${prefix}linked.md`)).json()).content, 'Linked');
  assert.equal((await fetch(`${base}/api/asset?path=${encodeURIComponent(`${prefix}img.svg`)}`)).status, 200);
  for (const suffix of ['../outside.md', 'escape.md', '.git/private.md']) {
    assert.equal((await getDoc(prefix + suffix)).status, 403, suffix);
  }
  assert.equal((await getDoc('@opened/unknown/file.md')).status, 404);
  assert.equal((await getDoc(path.join(external, 'linked.md'))).status, 400);
  const tree = await (await fetch(`${base}/api/tree`)).json();
  assert.deepEqual(tree.files.map((file) => file.name).sort(), ['README.md', '한글 document.md']);
  assert.equal((await (await open(`${external}/한글 document.md`)).json()).path, result.path);
  assert.equal((await open(`${external}/too-large.md`)).status, 413);
  assert.equal((await open(`${external}/missing.md`)).status, 404);
  assert.equal((await open(`${external}/escape.md`)).status, 403);
  assert.equal((await open(`${external}/img.svg`)).status, 415);
  assert.equal((await open('https://example.com/doc.md')).status, 400);
  assert.equal((await open('README.md', { 'X-Folio-Request': '' })).status, 403);
  assert.equal((await open('README.md', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await open('README.md', { origin: 'https://example.com' })).status, 403);
  assert.equal((await open('README.md', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await open('x'.repeat(17000))).status, 413);
  const cliUrl = await openInput(path.join(external, '한글 document.md'), { port: server.address().port });
  assert.equal(cliUrl, result.url);
  assert.equal(await openInput(undefined, { port: server.address().port }), `${base}/`);
});

test('CLI refuses a foreign server instead of restarting or posting a file path to it', async (t) => {
  let postCount = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') postCount += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"app":"other","version":1}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(openInput('/some/file.md', { port: server.address().port }), /다른 앱/);
  assert.equal(postCount, 0);
});

test('projects persist, isolate document access, deduplicate canonical folders, and unregister without deleting', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'rdviewer-projects-'));
  const root = path.join(temp, 'default');
  const other = path.join(temp, '프로젝트 두 번째');
  const nested = path.join(other, 'nested');
  const filename = path.join(temp, 'config', 'projects.json');
  await mkdir(root);
  await mkdir(nested, { recursive: true });
  await mkdir(path.join(other, '.git'));
  await writeFile(path.join(root, 'README.md'), 'Default');
  await writeFile(path.join(other, 'README.md'), 'Other');
  await writeFile(path.join(nested, 'README.md'), 'Nested');
  await writeFile(path.join(other, 'image.svg'), '<svg></svg>');
  await writeFile(path.join(other, '.git', 'secret.md'), 'Secret');
  await writeFile(path.join(temp, 'loose.md'), 'Loose');
  await symlink(path.join(root, 'README.md'), path.join(other, 'escape.md'));
  await symlink(other, path.join(temp, 'alias'));
  let server;
  async function start() {
    server = await createReaderServer(root, { projectsFile: filename });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  let base = await start();
  t.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const post = (endpoint, input, headers = {}) => fetch(`${base}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1', ...headers },
    body: JSON.stringify({ input }),
  });
  const json = async (endpoint) => (await fetch(`${base}${endpoint}`)).json();
  const project = (await (await post('/api/projects', other)).json()).project;
  assert.equal(project.name, '프로젝트 두 번째');
  assert.equal(project.isDefault, false);
  assert.equal((await (await post('/api/projects', path.join(temp, 'alias'))).json()).project.id, project.id);
  assert.equal((await (await post('/api/projects', root)).json()).project.id, 'default');
  const [a, b] = await Promise.all([post('/api/projects', nested), post('/api/projects', nested)]);
  const child = (await a.json()).project;
  assert.equal((await b.json()).project.id, child.id);
  assert.equal((await json('/api/projects')).projects.length, 3);
  assert.equal((await post('/api/projects', other, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/projects', other, { 'X-Folio-Request': '' })).status, 403);
  assert.equal((await post('/api/projects/remove', project.id, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post('/api/projects', path.join(other, 'README.md'))).status, 400);
  const tree = await json(`/api/tree?project=${project.id}`);
  assert.equal(tree.projectId, project.id);
  assert.deepEqual(tree.files.map((file) => file.path).sort(), [`@projects/${project.id}/README.md`, `@projects/${project.id}/nested/README.md`]);
  const opened = await (await post('/api/open', path.join(nested, 'README.md'))).json();
  assert.equal(opened.projectId, child.id);
  assert.equal(opened.path, `@projects/${child.id}/README.md`);
  assert.equal(new URL(opened.url).searchParams.get('project'), child.id);
  assert.equal(await openInput(other, { port: server.address().port, project: true }), `${base}/?project=${project.id}`);
  assert.equal((await json(`/api/document?path=${encodeURIComponent(`@projects/${project.id}/README.md`)}`)).content, 'Other');
  for (const suffix of ['../default/README.md', 'escape.md', '.git/secret.md']) {
    const result = await fetch(`${base}/api/document?path=${encodeURIComponent(`@projects/${project.id}/${suffix}`)}`);
    assert.equal(result.status, 403, suffix);
  }
  assert.equal((await fetch(`${base}/api/asset?path=${encodeURIComponent(`@projects/${project.id}/image.svg`)}`)).status, 200);
  const loose = await (await post('/api/open', path.join(temp, 'loose.md'))).json();
  assert.equal(loose.projectId, 'loose');
  const savedLooseDocument = await json(`/api/document?path=${encodeURIComponent(loose.path)}`);
  assert.equal(savedLooseDocument.fsPath, await realpath(path.join(temp, 'loose.md')));
  assert.equal(savedLooseDocument.content, 'Loose');
  assert.equal((await json('/api/tree?project=loose')).files.length, 1);
  assert.equal((await json('/api/tree?project=default')).files.length, 1);
  assert.equal((await json('/api/tree')).files.length, 2);
  await new Promise((resolve) => server.close(resolve));
  base = await start();
  // Session-only mounts expire; history can explicitly reopen the canonical path.
  assert.equal((await fetch(`${base}/api/document?path=${encodeURIComponent(loose.path)}`)).status, 404);
  const reopenedLoose = await (await post('/api/open', savedLooseDocument.fsPath)).json();
  assert.equal(reopenedLoose.projectId, 'loose');
  assert.notEqual(reopenedLoose.path, loose.path);
  assert.equal((await json(`/api/document?path=${encodeURIComponent(reopenedLoose.path)}`)).content, 'Loose');
  assert.equal((await json(`/api/document?path=${encodeURIComponent(`@projects/${project.id}/README.md`)}`)).fsPath, await realpath(path.join(other, 'README.md')));
  assert.equal((await json('/api/projects')).projects.some((entry) => entry.id === project.id), true);
  assert.equal((await json(`/api/document?path=${encodeURIComponent(opened.path)}`)).content, 'Nested');
  assert.equal((await post('/api/projects/remove', 'default')).status, 400);
  assert.equal((await post('/api/projects/remove', project.id)).status, 200);
  assert.equal((await fetch(`${base}/api/tree?project=${project.id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/document?path=${encodeURIComponent(`@projects/${project.id}/README.md`)}`)).status, 404);
  // Still on disk, so registering again succeeds and its document is readable.
  const restored = (await (await post('/api/projects', other)).json()).project;
  assert.equal((await json(`/api/document?path=${encodeURIComponent(`@projects/${restored.id}/README.md`)}`)).content, 'Other');
  await rm(nested, { recursive: true });
  assert.equal((await json('/api/projects')).projects.some((entry) => entry.id === child.id), true);
  const unavailable = await fetch(`${base}/api/tree?project=${child.id}`);
  assert.equal(unavailable.status, 404);
  assert.match((await unavailable.json()).error, /폴더/);
});

test('corrupt project registry is preserved and cannot be silently overwritten', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'rdviewer-registry-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const filename = path.join(temp, 'projects.json');
  await writeFile(filename, '{broken');
  await assert.rejects(createReaderServer(temp, { projectsFile: filename }), /손상/);
  const { readFile } = await import('node:fs/promises');
  assert.equal(await readFile(filename, 'utf8'), '{broken');
});

test('dot-prefixed Markdown files and assistant folders can be browsed and opened', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'rdviewer-dotfiles-'));
  const root = path.join(temp, 'root');
  const project = path.join(temp, 'project');
  const loose = path.join(temp, 'loose');
  for (const directory of [root, project, loose]) {
    await mkdir(path.join(directory, '.claude', 'workflows'), { recursive: true });
    await mkdir(path.join(directory, '.git'));
    await writeFile(path.join(directory, '.workflow.md'), '# Dot document');
    await writeFile(path.join(directory, '.claude', 'workflows', '.review.md'), '# Review');
    await writeFile(path.join(directory, '.git', 'internal.md'), 'Git metadata');
    await symlink(path.join(directory, '.git', 'internal.md'), path.join(directory, 'metadata-alias.md'));
  }
  const server = await createReaderServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (endpoint, input) => fetch(`${base}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1' },
    body: JSON.stringify({ input }),
  });
  const registered = await (await post('/api/projects', project)).json();
  for (const [directory, id, prefix] of [[root, 'default', ''], [project, registered.project.id, `@projects/${registered.project.id}/`]]) {
    const tree = await (await fetch(`${base}/api/tree?project=${id}`)).json();
    assert.deepEqual(tree.files.map((file) => file.path).sort(), [`${prefix}.claude/workflows/.review.md`, `${prefix}.workflow.md`]);
    for (const name of ['.workflow.md', '.claude/workflows/.review.md']) {
      const response = await post('/api/open', path.join(directory, name));
      assert.equal(response.status, 200, name);
      const opened = await response.json();
      assert.equal(opened.projectId, id);
      assert.equal(opened.path, prefix + name);
      const document = await fetch(`${base}/api/document?path=${encodeURIComponent(opened.path)}`);
      assert.equal(document.status, 200);
      assert.match((await document.json()).content, /^# /);
    }
    for (const name of ['.git/internal.md', 'metadata-alias.md']) {
      assert.equal((await fetch(`${base}/api/document?path=${encodeURIComponent(prefix + name)}`)).status, 403);
    }
  }
  for (const name of ['.workflow.md', '.claude/workflows/.review.md']) {
    const response = await post('/api/open', path.join(loose, name));
    assert.equal(response.status, 200, name);
    const opened = await response.json();
    assert.equal(opened.projectId, 'loose');
    assert.equal((await fetch(`${base}/api/document?path=${encodeURIComponent(opened.path)}`)).status, 200);
  }
});

test('content search finds body text and dotfiles while respecting folder and document boundaries', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'rdviewer-search-'));
  const root = path.join(temp, 'root');
  const other = path.join(temp, 'other');
  await mkdir(path.join(root, '.claude'), { recursive: true });
  await mkdir(path.join(root, '.git'));
  await mkdir(other);
  await writeFile(path.join(root, 'README.md'), '# Introduction\n\nBody-only NeEdLe 한국어 <script>alert(1)</script>');
  await writeFile(path.join(root, '.claude', '.workflow.md'), '# Instructions\n숨김 문서의 바늘');
  await writeFile(path.join(root, '.git', 'internal.md'), 'metadata-only-secret');
  await writeFile(path.join(root, 'large.md'), 'oversized-only-secret' + 'x'.repeat(5 * 1024 * 1024));
  await writeFile(path.join(other, 'external.md'), '# External\nother-folder-only-secret');
  await symlink(path.join(other, 'external.md'), path.join(root, 'escape.md'));
  const server = await createReaderServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const search = (q, project = 'default', options) => fetch(`${base}/api/search?project=${encodeURIComponent(project)}&q=${encodeURIComponent(q)}`, options);
  const body = await (await search('needle')).json();
  assert.equal(body.projectId, 'default');
  assert.equal(body.files.length, 1);
  assert.equal(body.files[0].path, 'README.md');
  assert.equal(body.files[0].matchedContent, true);
  assert.equal(body.files[0].line, 3);
  assert.match(body.files[0].snippet, /NeEdLe 한국어 <script>/);
  const named = await (await search('readme')).json();
  assert.equal(named.files[0].matchedContent, false);
  assert.equal(named.files[0].line, null);
  assert.equal((await (await search('바늘')).json()).files[0].path, '.claude/.workflow.md');
  assert.equal((await (await search('.claude')).json()).files[0].matchedContent, false);
  assert.deepEqual((await (await search('')).json()).files, []);
  for (const query of ['metadata-only-secret', 'oversized-only-secret', 'other-folder-only-secret']) {
    assert.deepEqual((await (await search(query)).json()).files, [], query);
  }
  assert.equal((await search('needle', 'missing')).status, 404);
  assert.equal((await search('x'.repeat(201))).status, 400);
  assert.equal((await search('needle', 'default', { headers: { origin: 'https://example.com' } })).status, 403);
  const post = (endpoint, input) => fetch(`${base}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1' }, body: JSON.stringify({ input }),
  });
  const folder = (await (await post('/api/projects', other)).json()).project;
  const otherResult = await (await search('other-folder-only-secret', folder.id)).json();
  assert.equal(otherResult.files[0].path, `@projects/${folder.id}/external.md`);
  assert.deepEqual((await (await search('needle', folder.id)).json()).files, []);
  await post('/api/open', path.join(other, 'external.md'));
  // Registered files stay in their folder rather than leaking into loose documents.
  assert.deepEqual((await (await search('other-folder-only-secret', 'loose')).json()).files, []);
  const loose = path.join(temp, '.notes.md');
  await writeFile(loose, 'loose-body-only');
  await post('/api/open', loose);
  const looseResult = await (await search('loose-body-only', 'loose')).json();
  assert.match(looseResult.files[0].path, /^@opened\//);
  await writeFile(path.join(root, 'README.md'), 'Updated body text');
  assert.deepEqual((await (await search('needle')).json()).files, []);
  assert.equal((await (await search('Updated body')).json()).files.length, 1);
});

test('content search marks its result limit instead of returning unbounded results', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'rdviewer-search-limit-'));
  await Promise.all(Array.from({ length: 201 }, (_, i) => writeFile(path.join(temp, `doc-${i}.md`), 'shared searchable text')));
  const server = await createReaderServer(temp);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/search?q=searchable`);
  const result = await response.json();
  assert.equal(result.files.length, 200);
  assert.equal(result.truncated, true);
});


test('PNG and MP4 metadata, streaming ranges, and HEAD preserve binary data without decoding it', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'rdviewer-media-'));
  const bytes = Buffer.from([0, 255, 10, 13, 128, 42, 9, 1, 2, 3]);
  await writeFile(path.join(temp, 'clip.MP4'), bytes);
  await writeFile(path.join(temp, 'empty.mp4'), '');
  await writeFile(path.join(temp, '그림.png'), bytes);
  await writeFile(path.join(temp, 'README.md'), '# Markdown');
  const huge = await open(path.join(temp, 'large.mp4'), 'w');
  const size = 5 * 1024 * 1024 * 1024 + 7;
  await huge.truncate(size);
  await huge.write(Buffer.from('END'), 0, 3, size - 3);
  await huge.close();
  const server = await createReaderServer(temp);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (endpoint, options) => fetch(`${base}${endpoint}`, options);
  const tree = await (await get('/api/tree')).json();
  assert.deepEqual(tree.files.map(({ name, kind }) => [name, kind]).sort(), [
    ['README.md', 'markdown'], ['clip.MP4', 'video'], ['empty.mp4', 'video'], ['large.mp4', 'video'], ['그림.png', 'image'],
  ].sort());
  const metadata = await (await get('/api/file?path=large.mp4')).json();
  assert.equal(metadata.size, size);
  assert.equal(metadata.kind, 'video');
  assert.equal(metadata.content, undefined);
  assert.equal(metadata.mediaURL, '/api/media?path=large.mp4');
  assert.equal(metadata.fsPath, await realpath(path.join(temp, 'large.mp4')));
  const document = await (await get('/api/file?path=README.md')).json();
  assert.equal(document.kind, 'markdown');
  assert.equal(document.content, '# Markdown');
  assert.equal(document.mediaURL, undefined);
  assert.equal((await get('/api/document?path=clip.MP4')).status, 415);
  assert.equal((await get('/api/media?path=README.md')).status, 415);
  assert.equal((await get('/api/asset?path=clip.MP4')).status, 415);
  const full = await get('/api/media?path=clip.MP4');
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-length'), String(bytes.length));
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  const png = await get(`/api/media?path=${encodeURIComponent('그림.png')}`);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), bytes);
  for (const [range, start, end] of [['bytes=0-0', 0, 0], ['bytes=2-5', 2, 5], ['bytes=7-', 7, 9], ['bytes=-3', 7, 9], ['bytes=8-999', 8, 9], ['bytes=-999', 0, 9]]) {
    const response = await get('/api/media?path=clip.MP4', { headers: { Range: range } });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`, range);
    assert.equal(response.headers.get('content-length'), String(end - start + 1), range);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1), range);
  }
  for (const range of ['bytes=', 'bytes=-0', 'bytes=10-', 'bytes=7-2', 'bytes=0-1,4-5', 'items=0-2', 'bytes=9007199254740993-', 'bytes=-9007199254740993']) {
    const response = await get('/api/media?path=clip.MP4', { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), 'bytes */10', range);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  const head = await get('/api/media?path=large.mp4', { method: 'HEAD', headers: { Range: 'bytes=0-2' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(size));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const tail = await get('/api/media?path=large.mp4', { headers: { Range: 'bytes=-3' } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), `bytes ${size - 3}-${size - 1}/${size}`);
  assert.equal(await tail.text(), 'END');
  const empty = await get('/api/media?path=empty.mp4');
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get('content-length'), '0');
  assert.equal((await empty.arrayBuffer()).byteLength, 0);
  assert.equal((await get('/api/media?path=empty.mp4', { headers: { Range: 'bytes=0-' } })).status, 416);
  // Cancelling playback closes the stream without affecting the server.
  const streaming = await get('/api/media?path=large.mp4');
  await streaming.body.cancel();
  assert.equal((await get('/api/info')).status, 200);
});

test('media stays inside registered or explicitly selected folders and retains Markdown limits', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'rdviewer-media-boundary-'));
  const root = path.join(temp, 'root');
  const other = path.join(temp, 'other');
  const loose = path.join(temp, 'loose');
  for (const directory of [root, other, loose]) {
    await mkdir(path.join(directory, '.git'), { recursive: true });
    await writeFile(path.join(directory, 'image.png'), 'PNG');
    await writeFile(path.join(directory, 'clip.mp4'), 'MP4');
    await writeFile(path.join(directory, '.git', 'hidden.mp4'), 'metadata');
    await symlink(path.join(directory, '.git', 'hidden.mp4'), path.join(directory, 'hidden-alias.mp4'));
  }
  await symlink(path.join(other, 'clip.mp4'), path.join(root, 'escape.mp4'));
  await symlink(path.join(root, 'clip.mp4'), path.join(root, 'wrong-kind.png'));
  await writeFile(path.join(root, 'large.png'), Buffer.alloc(20 * 1024 * 1024 + 1));
  await writeFile(path.join(root, 'large.md'), 'x'.repeat(5 * 1024 * 1024 + 1));
  await writeFile(path.join(root, 'unsupported.jpg'), 'JPEG');
  const server = await createReaderServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (endpoint, options) => fetch(`${base}${endpoint}`, options);
  const post = (endpoint, input) => get(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1' }, body: JSON.stringify({ input }) });
  const project = (await (await post('/api/projects', other)).json()).project;
  for (const [prefix, id] of [['', 'default'], [`@projects/${project.id}/`, project.id]]) {
    for (const name of ['image.png', 'clip.mp4']) {
      const response = await get(`/api/file?path=${encodeURIComponent(prefix + name)}`);
      assert.equal(response.status, 200);
      const file = await response.json();
      assert.equal((await get(file.mediaURL)).status, 200);
      const opened = await (await post('/api/open', path.join(id === 'default' ? root : other, name))).json();
      assert.equal(opened.path, prefix + name);
      assert.equal(opened.kind, name.endsWith('png') ? 'image' : 'video');
      assert.equal(opened.projectId, id);
    }
    for (const name of ['.git/hidden.mp4', 'hidden-alias.mp4', '../loose/clip.mp4']) {
      for (const endpoint of ['file', 'media']) assert.equal((await get(`/api/${endpoint}?path=${encodeURIComponent(prefix + name)}`)).status, 403, `${endpoint} ${prefix}${name}`);
    }
  }
  for (const endpoint of ['file', 'media']) {
    assert.equal((await get(`/api/${endpoint}?path=escape.mp4`)).status, 403);
    assert.equal((await get(`/api/${endpoint}?path=wrong-kind.png`)).status, 415);
    assert.equal((await get(`/api/${endpoint}?path=large.png`)).status, 413);
    assert.equal((await get(`/api/${endpoint}?path=large.md`)).status, 413);
    assert.equal((await get(`/api/${endpoint}?path=unsupported.jpg`)).status, 415);
    assert.equal((await get(`/api/${endpoint}?path=missing.mp4`)).status, 404);
    assert.equal((await get(`/api/${endpoint}?path=clip.mp4`, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await get(`/api/${endpoint}?path=clip.mp4`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  }
  const opened = await (await post('/api/open', path.join(loose, 'clip.mp4'))).json();
  assert.match(opened.path, /^@opened\//);
  assert.equal(opened.projectId, 'loose');
  const metadata = await (await get(`/api/file?path=${encodeURIComponent(opened.path)}`)).json();
  assert.equal(metadata.kind, 'video');
  assert.equal(await (await get(metadata.mediaURL)).text(), 'MP4');
  assert.equal((await (await get('/api/tree?project=loose')).json()).files[0].kind, 'video');
  assert.equal((await get('/api/media?path=@opened/missing/clip.mp4')).status, 404);
  assert.equal((await get('/api/media?path=clip.mp4', { method: 'POST' })).status, 405);
  assert.match((await get('/')).headers.get('content-security-policy'), /media-src 'self' blob:/);
});

test('media search matches filenames without treating binary content as document text or exhausting Markdown budget', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'rdviewer-media-search-'));
  await writeFile(path.join(temp, 'a-picture.PNG'), Buffer.from('binary-only-secret'));
  const huge = await open(path.join(temp, 'b-movie.mp4'), 'w');
  await huge.truncate(64 * 1024 * 1024);
  await huge.write(Buffer.from('binary-only-secret'));
  await huge.close();
  await writeFile(path.join(temp, 'z-readme.md'), 'markdown-body-secret');
  const server = await createReaderServer(temp);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const search = async (q) => (await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`)).json();
  assert.deepEqual((await search('binary-only-secret')).files, []);
  for (const [q, kind] of [['PICTURE', 'image'], ['movie', 'video']]) {
    const result = await search(q);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].kind, kind);
    assert.equal(result.files[0].matchedContent, false);
    assert.equal(result.files[0].line, null);
    assert.equal(result.files[0].snippet, '');
    assert.equal(result.truncated, false);
  }
  const markdown = await search('markdown-body-secret');
  assert.equal(markdown.files.length, 1);
  assert.equal(markdown.files[0].kind, 'markdown');
  assert.equal(markdown.files[0].matchedContent, true);
  assert.equal(markdown.truncated, false);
});


test('search file types filter before result limits, preserve Markdown aliases, and never search media bodies', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'rdviewer-search-types-'));
  await Promise.all(Array.from({ length: 201 }, (_, index) => writeFile(path.join(root, `match-${String(index).padStart(3, '0')}.md`), 'body-only-match')));
  await writeFile(path.join(root, 'zz-match.PNG'), 'binary-body-only');
  await writeFile(path.join(root, 'zz-match.mp4'), 'binary-body-only');
  await writeFile(path.join(root, 'zz-match.HTM'), 'html-body-only');
  await writeFile(path.join(root, 'alias.markdown'), 'alias-body');
  await writeFile(path.join(root, 'alias.mdown'), 'alias-body');
  const server = await createReaderServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const search = async (query, types) => {
    const url = new URL('/api/search', base); url.searchParams.set('q', query);
    if (types !== undefined) url.searchParams.set('types', types);
    return fetch(url);
  };
  const all = await (await search('match')).json(); assert.equal(all.files.length, 200); assert.equal(all.truncated, true);
  const png = await (await search('match', 'png')).json(); assert.deepEqual(png.files.map((file) => file.name), ['zz-match.PNG']); assert.equal(png.truncated, false);
  const mixed = await (await search('match', 'png,mp4,html')).json(); assert.deepEqual(mixed.files.map((file) => file.name).sort(), ['zz-match.HTM', 'zz-match.PNG', 'zz-match.mp4'].sort()); assert.equal(mixed.truncated, false);
  const aliases = await (await search('alias-body', 'md')).json(); assert.deepEqual(aliases.files.map((file) => file.name).sort(), ['alias.markdown', 'alias.mdown']);
  for (const query of ['binary-body-only', 'html-body-only']) assert.deepEqual((await (await search(query, 'png,mp4,html')).json()).files, []);
  assert.deepEqual((await (await search('match', '')).json()).files, []);
  for (const types of ['pdf', 'md,pdf', 'MD', 'md,', ',png']) assert.equal((await search('match', types)).status, 400, types);
});
