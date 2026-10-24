import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { realpath, stat, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

const types = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8' };
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const sensitive = (parts) => parts.some((part) => part.startsWith('.') || /^(?:id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/i.test(part));
const failure = (status, message) => Object.assign(new Error(message), { status });

export function createPreviewManager({ blockedFiles = [] } = {}) {
  const blocked = new Set(blockedFiles.map((file) => process.platform === 'win32' ? path.resolve(file).toLocaleLowerCase() : path.resolve(file)));
  const deniedFile = (file) => path.basename(file).toLocaleLowerCase() === 'automation.json' || blocked.has(process.platform === 'win32' ? file.toLocaleLowerCase() : file);
  let current = null; let serial = Promise.resolve();
  async function stop() {
    const previous = current; current = null;
    if (previous) { previous.server.closeAllConnections(); await new Promise((resolve) => previous.server.close(resolve)); }
  }
  async function mount(file) {
    const operation = serial.then(async () => {
      let root = await realpath(file.previewRoot || path.dirname(file.canonical));
      // Explicit hidden HTML still works without granting sibling hidden config files.
      if (sensitive(path.relative(root, file.canonical).split(path.sep).slice(0, -1))) root = await realpath(path.dirname(file.canonical));
      if (!current || current.root !== root) {
        await stop();
        const token = randomBytes(24).toString('hex');
        const cookieName = `rdv-preview-${randomBytes(8).toString('hex')}`;
        const entry = { root, token, cookieName, server: null, origin: '', selected: file.canonical };
        const server = http.createServer(async (req, res) => {
          const sendError = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message); };
          try {
            if (req.headers.host !== `127.0.0.1:${req.socket.localPort}` || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['service-worker']) throw failure(403, '미리보기 주소를 확인하세요.');
            if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, '미리보기는 읽기 전용입니다.');
            const url = new URL(req.url, entry.origin);
            const prefix = `/session/${token}/`;
            if (url.pathname.startsWith(prefix)) {
              res.writeHead(302, { 'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: `/${url.pathname.slice(prefix.length)}${url.search}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); return;
            }
            const cookies = (req.headers.cookie || '').split(/;\s*/);
            if (!cookies.includes(`${cookieName}=${token}`)) throw failure(403, '미리보기 파일을 먼저 여세요.');
            let decoded;
            try { decoded = decodeURIComponent(req.url.split('?')[0]); } catch { throw failure(400, '파일 경로 인코딩을 확인하세요.'); }
            if (decoded.includes('\0') || decoded.includes('\\')) throw failure(400, '파일 경로를 확인하세요.');
            const parts = decoded.split('/').filter(Boolean);
            if (parts.includes('..') || (sensitive(parts) && path.resolve(root, `.${decoded}`) !== entry.selected)) throw failure(403, '이 미리보기에서 읽을 수 없는 파일입니다.');
            let target = path.resolve(root, `.${decoded}`);
            if (!inside(root, target)) throw failure(403, '폴더 밖의 파일은 읽을 수 없습니다.');
            let canonical = await realpath(target);
            let info = await stat(canonical);
            if (info.isDirectory()) { target = path.join(target, 'index.html'); canonical = await realpath(target); info = await stat(canonical); }
            if (deniedFile(canonical) || !inside(root, canonical) || (sensitive(path.relative(root, canonical).split(path.sep)) && canonical !== entry.selected)) throw failure(403, '폴더 밖의 파일은 읽을 수 없습니다.');
            const contentType = types[path.extname(canonical).toLowerCase()];
            if (!contentType || !info.isFile()) throw failure(415, '지원하지 않는 미리보기 파일입니다.');
            if (!Number.isSafeInteger(info.size)) throw failure(413, '파일이 너무 큽니다.');
            if (!/^(?:video|audio)\//.test(contentType) && info.size > 50 * 1024 * 1024) throw failure(413, '미리보기 리소스는 50MB 이하만 읽을 수 있습니다.');
            res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
            res.setHeader('Content-Security-Policy', "default-src 'self' https: data: blob:; script-src 'self' https: 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' https: 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' https: data:; media-src 'self' https: blob:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
            // Browser fallback is a different origin, not an opaque frame. CORS is
            // restricted to this preview origin; it never grants reader API access.
            if (req.headers.origin === entry.origin) res.setHeader('Access-Control-Allow-Origin', entry.origin);
            let start = 0; let end = info.size - 1; let status = 200;
            res.setHeader('Accept-Ranges', 'bytes');
            if (req.method === 'GET' && req.headers.range !== undefined) {
              const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
              const invalid = () => { res.writeHead(416, { 'Content-Range': `bytes */${info.size}`, 'Content-Length': '0' }); res.end(); };
              if (!match || (!match[1] && !match[2]) || !info.size) return invalid();
              if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid(); start = Math.max(0, info.size - suffix); }
              else { start = Number(match[1]); const requestedEnd = match[2] ? Number(match[2]) : info.size - 1; if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= info.size || requestedEnd < start) return invalid(); end = Math.min(end, requestedEnd); }
              status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
            }
            const handle = await open(canonical, 'r');
            try {
              res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': String(info.size ? end - start + 1 : 0) });
              if (req.method === 'HEAD' || !info.size) { res.end(); return; }
              await pipeline(handle.createReadStream({ start, end, highWaterMark: 64 * 1024, autoClose: false }), res);
            } finally { await handle.close(); }
          } catch (error) {
            if (res.headersSent || res.destroyed) { res.destroy(); return; }
            sendError(error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500), error.status ? error.message : '미리보기 파일을 읽지 못했습니다.');
          }
        });
        entry.server = server;
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        entry.origin = `http://127.0.0.1:${server.address().port}`; current = entry;
      }
      current.selected = file.canonical;
      return `${current.origin}/session/${current.token}/${path.relative(current.root, file.canonical).split(path.sep).map(encodeURIComponent).join('/')}`;
    });
    serial = operation.catch(() => {}); return operation;
  }
  return { mount, close: () => { const operation = serial.then(stop); serial = operation.catch(() => {}); return operation; }, origin: () => current?.origin ?? null };
}
