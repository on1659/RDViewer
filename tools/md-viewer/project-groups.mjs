import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const groupId = (kind, directory) => `${kind}-${createHash('sha256').update(directory).digest('hex')}`;
const stripNewline = (value) => value.replace(/\r?\n$/, '');

// This is display metadata only. Access boundaries and saved project IDs remain
// defined by the registry, including when several folders share a repository.
export function createProjectGrouper() {
  const cache = new Map();
  const waiting = [];
  let active = 0;
  async function limited(operation) {
    if (active >= 4) await new Promise((resolve) => waiting.push(resolve));
    else active += 1;
    try { return await operation(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }
  async function inspect(directory) {
    const canonical = await realpath(directory).catch(() => path.resolve(directory));
    const fallback = {
      group: { id: groupId('folder', canonical), name: path.basename(canonical) || canonical, kind: 'folder' },
      branch: null,
    };
    // Do not inherit GIT_DIR/GIT_WORK_TREE or injected config from the launcher.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    env.GIT_OPTIONAL_LOCKS = '0';
    const git = async (args) => stripNewline((await exec('git', ['-C', canonical, ...args], {
      env, timeout: 1500, maxBuffer: 64 * 1024, windowsHide: true,
    })).stdout);
    try {
      const commonDir = await realpath(await git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
      const name = path.basename(commonDir) === '.git'
        ? path.basename(path.dirname(commonDir))
        : path.basename(commonDir);
      const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null);
      return { group: { id: groupId('git', commonDir), name: name || commonDir, kind: 'git' }, branch };
    } catch { return fallback; }
  }
  async function describe(project) {
    let entry = cache.get(project.path);
    if (!entry || Date.now() - entry.time > 10_000) {
      entry = { time: Date.now(), promise: limited(() => inspect(project.path)) };
      cache.set(project.path, entry);
      if (cache.size > 256) cache.delete(cache.keys().next().value);
    }
    return { ...project, ...await entry.promise };
  }
  return {
    describe,
    list: (projects) => Promise.all(projects.map(describe)),
  };
}
