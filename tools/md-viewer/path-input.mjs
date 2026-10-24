import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// Clipboard text from editor links, terminals, and assistant responses.
export function parsePathInput(input, root, home = homedir(), platform = process.platform) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  if (typeof input !== 'string' || !input.trim() || /[\0\r\n]/.test(input)) {
    throw invalid('Markdown·PNG·MP4·HTML 파일 경로나 링크를 입력하세요.');
  }
  let value = input.trim();
  const link = value.match(/^\[[^\]]*\]\((.*)\)$/s);
  if (link) value = link[1].trim();
  for (const [start, end] of [['<', '>'], ['"', '"'], ["'", "'"], ['`', '`']]) {
    if (value.startsWith(start) && value.endsWith(end)) value = value.slice(1, -1);
  }
  if (link && !/^file:/i.test(value)) {
    try { value = decodeURIComponent(value); }
    catch { throw invalid('링크의 파일 경로 인코딩을 확인하세요.'); }
  }
  // Only remove editor locations directly following a document/source extension.
  value = value.replace(/(\.(?:md|markdown|mdown|html?))(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/i, '$1');
  if (/^file:/i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw invalid('올바른 file:// 링크가 아닙니다.'); }
    if (url.hostname && url.hostname !== 'localhost') throw invalid('이 컴퓨터의 파일만 열 수 있습니다.');
    if (url.search || url.hash) throw invalid('파일 링크의 위치 표기를 확인하세요.');
    try { value = fileURLToPath(url, { windows }); } catch { throw invalid('올바른 로컬 파일 링크가 아닙니다.'); }
  } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^(?:https?|ftp|data|javascript|vscode|vscode-insiders|sandbox|codex|plugin):/i.test(value) || value.startsWith('//')) {
    throw invalid('웹 주소 대신 로컬 Markdown·PNG·MP4·HTML 파일 경로를 입력하세요.');
  }
  if (value.startsWith('~/') || (windows && value.startsWith('~\\'))) value = paths.join(home, value.slice(2));
  if (value.includes('\0') || (!windows && value.includes('\\'))) throw invalid('올바른 파일 경로가 필요합니다.');
  if (windows) {
    // Network/device paths and NTFS alternate streams are outside local document access.
    if (/^[\\/]{2}/.test(value) || /^[a-z]:[^\\/]/i.test(value) ||
        value.replace(/^[a-z]:/i, '').includes(':')) {
      throw invalid('로컬 드라이브의 파일 경로를 입력하세요.');
    }
  }
  return paths.resolve(root, value);
}
