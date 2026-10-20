import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createReaderServer } from './server.mjs';
import { openInput } from './open.mjs';

test('local reader serves Markdown and contains file access within its root', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'leaf-reader-'));
  const root = path.join(temp, 'docs');
  await mkdir(root);
  await mkdir(path.join(root, '.private'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'README.md'), '# 안녕하세요\n\n[문서](second.md)');
  await writeFile(path.join(root, 'second.md'), '# Second');
  await writeFile(path.join(root, '.private', 'secret.md'), 'hidden');
  await writeFile(path.join(root, 'node_modules', 'excluded.md'), 'dependency');
  await writeFile(path.join(root, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await writeFile(path.join(root, 'secret.txt'), 'not markdown');
  await writeFile(path.join(root, 'large.md'), 'x'.repeat(5 * 1024 * 1024 + 1));
  await writeFile(path.join(temp, 'outside.md'), 'outside');
  await symlink(path.join(temp, 'outside.md'), path.join(root, 'escape.md'));
  await symlink(path.join(root, '.private', 'secret.md'), path.join(root, 'hidden-alias.md'));
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
  for (const name of ['../outside.md', 'escape.md', '.private/secret.md', 'hidden-alias.md']) {
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
  await mkdir(path.join(external, '.secret'));
  await writeFile(path.join(root, 'README.md'), 'Root');
  await writeFile(path.join(external, '한글 document.md'), 'External');
  await writeFile(path.join(external, 'linked.md'), 'Linked');
  await writeFile(path.join(external, 'img.svg'), '<svg></svg>');
  await writeFile(path.join(external, '.secret', 'private.md'), 'Private');
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
  for (const suffix of ['../outside.md', 'escape.md', '.secret/private.md']) {
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
  await mkdir(path.join(other, '.hidden'));
  await writeFile(path.join(root, 'README.md'), 'Default');
  await writeFile(path.join(other, 'README.md'), 'Other');
  await writeFile(path.join(nested, 'README.md'), 'Nested');
  await writeFile(path.join(other, 'image.svg'), '<svg></svg>');
  await writeFile(path.join(other, '.hidden', 'secret.md'), 'Secret');
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
  for (const suffix of ['../default/README.md', 'escape.md', '.hidden/secret.md']) {
    const result = await fetch(`${base}/api/document?path=${encodeURIComponent(`@projects/${project.id}/${suffix}`)}`);
    assert.equal(result.status, 403, suffix);
  }
  assert.equal((await fetch(`${base}/api/asset?path=${encodeURIComponent(`@projects/${project.id}/image.svg`)}`)).status, 200);
  const loose = await (await post('/api/open', path.join(temp, 'loose.md'))).json();
  assert.equal(loose.projectId, 'loose');
  assert.equal((await json('/api/tree?project=loose')).files.length, 1);
  assert.equal((await json('/api/tree?project=default')).files.length, 1);
  assert.equal((await json('/api/tree')).files.length, 2);
  await new Promise((resolve) => server.close(resolve));
  base = await start();
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
