import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const directory = path.dirname(fileURLToPath(import.meta.url));

async function inspectServer(base) {
  let response;
  try { response = await fetch(`${base}/api/info`, { signal: AbortSignal.timeout(1000) }); }
  catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw new Error('RDViewer 서버에 연결할 수 없습니다. 포트 사용 상태를 확인하세요.');
  }
  const info = await response.json().catch(() => null);
  if (!response.ok || info?.app !== 'folio' || info?.version !== 1) {
    throw new Error('이 포트에 다른 앱 또는 이전 RDViewer가 실행 중입니다. 앱을 종료하거나 --port로 다른 포트를 선택하세요.');
  }
  return true;
}

export async function openInput(input, { openBrowser = false, project = false, port = 4317, root = path.resolve(directory, '../..') } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('포트는 1~65535 정수여야 합니다.');
  const base = `http://127.0.0.1:${port}`;
  if (!(await inspectServer(base))) {
    const child = spawn(process.execPath, [
      path.join(directory, 'server.mjs'), '--root', root, '--port', String(port),
    ], { detached: true, stdio: 'ignore' });
    let spawnError;
    child.on('error', (error) => { spawnError = error; });
    child.unref();
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(100);
      if (spawnError) throw new Error('RDViewer 서버를 시작하지 못했습니다.');
      if (await inspectServer(base)) { ready = true; break; }
    }
    if (!ready) throw new Error('RDViewer 서버 시작 시간이 초과되었습니다.');
  }
  let url = `${base}/`;
  if (input) {
    const response = await fetch(`${base}${project ? '/api/projects' : '/api/open'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Folio-Request': '1' },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '문서를 열지 못했습니다.');
    url = result.url;
  }
  if (openBrowser) {
    if (process.platform !== 'darwin') throw new Error(`브라우저에서 이 주소를 여세요: ${url}`);
    await new Promise((resolve, reject) => {
      spawn('open', [url], { stdio: 'ignore' })
        .on('error', () => reject(new Error(`브라우저에서 이 주소를 여세요: ${url}`)))
        .on('exit', (code) => code === 0 ? resolve() : reject(new Error(`브라우저에서 이 주소를 여세요: ${url}`)));
    });
  }
  return url;
}

async function main() {
  const args = process.argv.slice(2);
  let input;
  let port = 4317;
  let root;
  let openBrowser = true;
  let project = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--no-browser') openBrowser = false;
    else if (args[index] === '--project' && args[index + 1]) {
      if (input !== undefined) throw new Error('문서 또는 프로젝트 경로 하나만 전달하세요.');
      project = true; input = args[++index];
    }
    else if (args[index] === '--port' && args[index + 1]) port = Number(args[++index]);
    else if (args[index] === '--root' && args[index + 1]) root = args[++index];
    else if (args[index] === '--help') {
      console.log('node open.mjs ["/path/to/document.md" | --project "/path/to/project"] [--no-browser] [--port 4317] [--root "/path/to/docs"]');
      return;
    } else if (args[index].startsWith('--')) throw new Error(`알 수 없는 옵션: ${args[index]}`);
    else if (input === undefined) input = args[index];
    else throw new Error('문서 경로 하나를 따옴표로 감싸서 전달하세요.');
  }
  console.log(await openInput(input, { openBrowser, project, port, root }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
