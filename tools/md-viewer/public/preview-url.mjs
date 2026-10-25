const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const effectivePort = (url) => url.port || (url.protocol === 'https:' ? '443' : '80');
const invalid = (status, message) => Object.assign(new Error(message), { status });

/** Canonical local HTTP(S) navigation shared by the reader UI and server. */
export function normalizePreviewURL(input, { blockedPorts = [], blockedOrigins = [] } = {}) {
  if (typeof input !== 'string' || !input.trim() || input.length > 8192 || /[\u0000-\u001f\u007f]/.test(input)) {
    throw invalid(400, '올바른 로컬 서버 주소를 입력하세요.');
  }
  let candidate = input.trim();
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#]|$)/i.test(candidate)) candidate = `http://${candidate}`;
  if (!/^https?:\/\//i.test(candidate) || candidate.includes('\\')) {
    throw invalid(400, 'http:// 또는 https:// 로컬 서버 주소를 입력하세요.');
  }
  let url;
  try { url = new URL(candidate); } catch { throw invalid(400, '주소와 포트 번호를 확인하세요.'); }
  if (url.href.length > 8192) throw invalid(400, '로컬 서버 주소가 너무 깁니다.');
  // Check the written authority as well as the parsed host. This rejects
  // credentials, alternate numeric IP spellings and URL-parser ambiguities.
  const authority = /^https?:\/\/([^/?#]*)/i.exec(candidate)?.[1];
  const writtenHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?$/i.exec(authority || '');
  if (!writtenHost || !localHosts.has(url.hostname) || url.username || url.password) {
    throw invalid(403, 'localhost, 127.0.0.1 또는 [::1] 로컬 서버만 열 수 있습니다.');
  }
  const port = effectivePort(url);
  if (Number(port) < 1 || Number(port) > 65535) throw invalid(400, '포트 번호는 1~65535 사이여야 합니다.');
  const blocked = new Set(['4317', '4318']);
  for (const value of blockedPorts) {
    const number = Number(value);
    if (Number.isInteger(number) && number > 0 && number <= 65535) blocked.add(String(number));
  }
  for (const origin of blockedOrigins) {
    try {
      const other = new URL(origin);
      if (['http:', 'https:'].includes(other.protocol) && localHosts.has(other.hostname)) blocked.add(effectivePort(other));
    } catch { /* An unavailable preview origin is not a restriction. */ }
  }
  if (blocked.has(port)) throw invalid(403, 'RDViewer 자체 주소 대신 별도의 로컬 개발 서버 주소를 입력하세요.');
  return url.href;
}
