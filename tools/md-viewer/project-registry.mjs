import { access, readFile, realpath, stat, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parsePathInput } from './path-input.mjs';

const failure = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
function folderFailure(error) {
  if (error.status) return error;
  if (['ENOENT', 'ENOTDIR'].includes(error.code)) return failure(404, '폴더를 찾을 수 없어요. 이동되거나 삭제되었을 수 있어요.', 'FOLDER_MISSING');
  if (['EACCES', 'EPERM'].includes(error.code)) return failure(403, '폴더를 읽을 권한이 없어요. 접근 권한을 확인해 주세요.', 'FOLDER_PERMISSION');
  return failure(500, '폴더를 읽지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.', 'FOLDER_UNREADABLE');
}
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
  async function selectDirectory(input) {
    try {
      const directory = await realpath(parsePathInput(input, root));
      if (!(await stat(directory)).isDirectory()) throw failure(400, '파일 대신 폴더를 선택해 주세요.');
      await access(directory, constants.R_OK | constants.X_OK);
      return directory;
    } catch (error) { throw folderFailure(error); }
  }
  return {
    list, get,
    async readable(id) {
      const project = get(id);
      try {
        if (await realpath(project.path) !== project.path) throw failure(409, '폴더 위치가 바뀌었어요. 사용할 위치를 다시 연결해 주세요.', 'FOLDER_CHANGED');
        if (!(await stat(project.path)).isDirectory()) throw failure(404, '등록한 위치에 폴더가 없어요. 사용할 폴더를 다시 연결해 주세요.', 'FOLDER_MISSING');
        await access(project.path, constants.R_OK | constants.X_OK);
      } catch (error) { throw folderFailure(error); }
      return project;
    },
    add(input) {
      return transaction(async () => {
        const directory = await selectDirectory(input);
        const existing = list().find((entry) => entry.path === directory);
        if (existing) return existing;
        if (entries.length >= 100) throw failure(409, '프로젝트는 최대 100개까지 등록할 수 있습니다.');
        const entry = { id: randomUUID(), path: directory };
        await persist([...entries, entry]);
        return describe(entry);
      });
    },
    relocate(id, input) {
      return transaction(async () => {
        if (id === 'default') throw failure(400, '기본 폴더 위치는 변경할 수 없습니다.');
        const project = get(id);
        const directory = await selectDirectory(input);
        if (list().some((entry) => entry.id !== id && entry.path === directory)) throw failure(409, '이미 목록에 있는 폴더예요. 다른 위치를 선택해 주세요.');
        if (directory === project.path) return project;
        const entry = { id, path: directory };
        await persist(entries.map((current) => current.id === id ? entry : current));
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
