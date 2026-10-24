#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultAutomationFile, validateCommand } from './automation-server.mjs';

export async function discoverAutomation({ descriptor = process.env.RDVIEWER_AUTOMATION_FILE || defaultAutomationFile(), baseURL } = {}) {
  let data;
  try { data = JSON.parse(await readFile(descriptor, 'utf8')); }
  catch { throw new Error(`RDViewer 앱을 먼저 실행하세요. 연결 설정을 읽지 못했습니다: ${descriptor}`); }
  const url = new URL(baseURL || data.baseURL);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('조작 API는 로컬 HTTP 주소만 허용합니다.');
  if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) throw new Error('올바른 RDViewer 조작 토큰이 없습니다.');
  return { baseURL: url.origin, token: data.token };
}
export async function callAutomation(command, options = {}) {
  const normalized = validateCommand(command);
  const connection = await discoverAutomation(options);
  const response = await fetch(`${connection.baseURL}/api/automation/commands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` },
    body: JSON.stringify(normalized), signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `RDViewer 요청 오류 (${response.status})`);
  return result;
}
export async function automationStatus(options = {}) {
  const connection = await discoverAutomation(options);
  const response = await fetch(`${connection.baseURL}/api/automation/status`, { headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(5000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '앱 상태를 읽을 수 없습니다.'); return result;
}
export function parseCLI(argv) {
  const options = {}; const flags = {}; const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (['--descriptor', '--base-url', '--seconds', '--fps', '--width', '--x', '--y', '--selector'].includes(value)) {
      if (argv[index + 1] === undefined) throw new Error(`${value} 값이 필요합니다.`);
      const next = argv[++index];
      if (value === '--descriptor') options.descriptor = next;
      else if (value === '--base-url') options.baseURL = next;
      else flags[value.slice(2)] = ['--selector'].includes(value) ? next : Number(next);
    } else positional.push(value);
  }
  const [name, ...values] = positional;
  if (!name || ['help', '--help', '-h'].includes(name)) return { help: true };
  let action = name === 'record' ? 'record.start' : name === 'stop' ? 'record.stop' : name;
  const args = {};
  if (name === 'call') return { command: validateCommand(JSON.parse(values[0] || '{}')), options };
  if (name === 'open') { const input = values[0]; args.input = input && !/^https?:\/\/|^@(?:projects|opened)\//i.test(input) ? path.resolve(input) : input; }
  if (['click', 'fill'].includes(action)) args.selector = values[0];
  if (action === 'fill') args.value = values[1];
  if (action === 'press') { args.key = values[0]; if (values[1]) args.selector = values[1]; }
  if (['play', 'pause'].includes(action) && values[0]) args.selector = values[0];
  if (action === 'seek') { args.seconds = Number(values[0]); if (values[1]) args.selector = values[1]; }
  Object.assign(args, flags);
  if (name === 'record' && args.seconds === undefined) args.seconds = 10;
  if (name === 'info') return { info: true, options };
  return { command: validateCommand({ action, args }), options, waitRecording: name === 'record' ? args.seconds : 0 };
}
export const help = `RDViewer local agent tools (JSON output; desktop app required)\nnode cli.mjs open /absolute/path/index.html\nnode cli.mjs open http://localhost:3000\nnode cli.mjs status | snapshot | screenshot | close\nnode cli.mjs click '#button'\nnode cli.mjs fill '#name' 'value'\nnode cli.mjs press Enter '#name'\nnode cli.mjs scroll --y 500\nnode cli.mjs play | pause | seek 5\nnode cli.mjs record --seconds 5 --fps 10 --width 1280\nnode cli.mjs record.start --seconds 30 | stop\nnode cli.mjs info\nGlobal: --descriptor /path/automation.json --base-url http://127.0.0.1:4317\nThe descriptor contains a private token; never publish it. Artifacts are saved by the app in its own artifacts directory.`;
async function main() {
  const parsed = parseCLI(process.argv.slice(2));
  if (parsed.help) { console.log(help); return; }
  if (parsed.info) { console.log(JSON.stringify(await automationStatus(parsed.options))); return; }
  let result = await callAutomation(parsed.command, parsed.options);
  if (parsed.waitRecording) {
    await new Promise((resolve) => setTimeout(resolve, parsed.waitRecording * 1000 + 300));
    result = await callAutomation({ action: 'record.stop' }, parsed.options);
  }
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
