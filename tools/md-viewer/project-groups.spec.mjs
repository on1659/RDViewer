import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProjectGrouper } from './project-groups.mjs';
import { createReaderServer } from './server.mjs';

const exec = promisify(execFile);
const git = (directory, ...args) => exec('git', ['-C', directory, ...args], {
  timeout: 5000,
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' },
});

test('local repository identity groups worktrees and subfolders without merging unrelated names', async (t) => {
  const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'rdviewer-groups-')));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'first', 'LAMDice');
  const other = path.join(temp, 'second', 'LAMDice');
  const worktree = path.join(temp, 'LAMDice-balloon');
  const subfolder = path.join(repo, 'docs');
  const folder = path.join(temp, 'LAMDice-skin');
  await Promise.all([repo, other, folder].map((directory) => mkdir(directory, { recursive: true })));
  await git(repo, 'init', '-b', 'main');
  await git(repo, '-c', 'user.name=RDViewer Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture');
  await git(repo, 'worktree', 'add', '-b', 'feature/balloon', worktree);
  await git(other, 'init', '-b', 'independent');
  await mkdir(subfolder);
  const paths = [repo, worktree, subfolder, other, folder, path.join(temp, 'missing')];
  const projects = paths.map((directory, i) => ({ id: `project-${i}`, path: directory, name: path.basename(directory) }));
  const grouper = createProjectGrouper();
  const results = await grouper.list(projects);
  assert.equal(results[0].group.kind, 'git');
  assert.equal(results[0].group.name, 'LAMDice');
  assert.equal(results[0].branch, 'main');
  assert.equal(results[1].branch, 'feature/balloon');
  assert.deepEqual(results[1].group, results[0].group);
  assert.deepEqual(results[2].group, results[0].group);
  assert.equal(results[3].group.name, results[0].group.name);
  assert.notEqual(results[3].group.id, results[0].group.id);
  assert.equal(results[4].group.kind, 'folder');
  assert.equal(results[5].group.kind, 'folder');
  assert.equal(results[5].branch, null);
  assert.notEqual(results[4].group.id, results[5].group.id);
  assert.deepEqual(results.map(({ id, path: directory }) => ({ id, path: directory })), projects.map(({ id, path: directory }) => ({ id, path: directory })));
  assert.deepEqual(await createProjectGrouper().list(projects), results, 'group IDs are stable across instances');

  await git(worktree, 'checkout', '--detach');
  assert.equal((await createProjectGrouper().describe(projects[1])).branch, null);

  const server = await createReaderServer(repo);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const added = await (await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1' },
    body: JSON.stringify({ input: worktree }),
  })).json();
  assert.equal(added.project.group.id, results[0].group.id);
  const listed = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(listed.projects.length, 2);
  assert.equal(listed.projects[0].id, 'default');
  assert.equal(listed.projects[1].id, added.project.id);
  assert.deepEqual(listed.projects[0].group, listed.projects[1].group);
});
