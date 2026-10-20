import { readFile, realpath, stat, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parsePathInput } from './path-input.mjs';

const failure = (status, message) => Object.assign(new Error(message), { status });
export function defaultProjectsFile({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const directory = platform === 'darwin'
    ? paths.join(home, 'Library', 'Application Support', 'RDViewer')
    : platform === 'win32'
      ? paths.join(env.APPDATA || paths.join(home, 'AppData', 'Roaming'), 'RDViewer')
      : paths.join(env.XDG_CONFIG_HOME || paths.join(home, '.config'), 'RDViewer');
  return paths.join(directory, 'projects.json');
}

export async function createProjectRegistry(root, filename = null) {
  let entries = [];
  if (filename) {
    let text;
    try { text = await readFile(filename, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`프로젝트 목록을 읽지 못했습니다: ${error.message}`); }
    if (text !== undefined) {
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('프로젝트 목록 파일이 손상되었습니다. 기존 파일을 보존합니다.'); }
      if (!data || data.version !== 1 || !Array.isArray(data.projects) || data.projects.length > 100 ||
          data.projects.some((entry) => !entry || typeof entry.id !== 'string' || !/^[a-f\d-]{36}$/.test(entry.id) || typeof entry.path !== 'string' || !path.isAbsolute(entry.path)) ||
          new Set(data.projects.map((entry) => entry.id)).size !== data.projects.length ||
          new Set(data.projects.map((entry) => entry.path)).size !== data.projects.length) {
        throw new Error('프로젝트 목록 파일 형식이 올바르지 않습니다. 기존 파일을 보존합니다.');
      }
      entries = data.projects.map(({ id, path: directory }) => ({ id, path: directory }));
    }
  }
  const describe = (entry) => ({ ...entry, name: path.basename(entry.path) || entry.path, isDefault: entry.id === 'default' });
  const defaultEntry = { id: 'default', path: root };
  let pending = Promise.resolve();
  function transaction(operation) {
    const task = pending.then(operation);
    pending = task.catch(() => {});
    return task;
  }
  async function persist(next) {
    if (filename) {
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify({ version: 1, projects: next }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, filename);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw failure(500, `프로젝트 목록을 저장하지 못했습니다: ${error.message}`);
      }
    }
    entries = next;
  }
  function list() { return [describe(defaultEntry), ...entries.filter((entry) => entry.path !== root).map(describe)]; }
  function get(id) {
    const project = list().find((entry) => entry.id === id);
    if (!project) throw failure(404, '등록된 프로젝트를 찾을 수 없습니다.');
    return project;
  }
  return {
    list, get,
    async readable(id) {
      const project = get(id);
      try {
        if (await realpath(project.path) !== project.path || !(await stat(project.path)).isDirectory()) throw new Error();
      } catch { throw failure(404, '프로젝트 폴더에 접근할 수 없습니다. 폴더 위치와 연결 상태를 확인하세요.'); }
      return project;
    },
    add(input) {
      return transaction(async () => {
        let directory;
        try {
          directory = await realpath(parsePathInput(input, root));
          if (!(await stat(directory)).isDirectory()) throw failure(400, 'Markdown 문서가 있는 폴더를 선택하세요.');
        } catch (error) {
          if (error.status) throw error;
          throw failure(404, '프로젝트 폴더를 찾거나 읽을 수 없습니다.');
        }
        const existing = list().find((entry) => entry.path === directory);
        if (existing) return existing;
        if (entries.length >= 100) throw failure(409, '프로젝트는 최대 100개까지 등록할 수 있습니다.');
        const entry = { id: randomUUID(), path: directory };
        await persist([...entries, entry]);
        return describe(entry);
      });
    },
    remove(id) {
      return transaction(async () => {
        if (id === 'default') throw failure(400, '기본 프로젝트는 목록에서 제거할 수 없습니다.');
        get(id);
        await persist(entries.filter((entry) => entry.id !== id));
      });
    },
  };
}
