export function previewLoadError(error) {
  const explicit = typeof error?.code === 'string' ? error.code : '';
  const code = /^ERR_[A-Z_]+$/.test(explicit) ? explicit : String(error?.message ?? '').slice(0, 1000).match(/\bERR_[A-Z_]+\b/)?.[0] ?? '';
  let message = '페이지를 열지 못했어요. 서버 상태와 주소를 확인한 뒤 다시 시도해 주세요.';
  if (code.startsWith('ERR_CERT_') || code.startsWith('ERR_SSL_') || code === 'ERR_BAD_SSL_CLIENT_AUTH_CERT') {
    message = 'HTTPS 연결을 확인할 수 없어요. 인증서가 유효하고 주소와 일치하는지 확인해 주세요. HTTP 서버라면 http://로 주소를 바꿔 주세요.';
  } else if (['ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED', 'ERR_ADDRESS_UNREACHABLE', 'ERR_CONNECTION_FAILED', 'ERR_INTERNET_DISCONNECTED'].includes(code)) {
    message = '로컬 서버에 연결할 수 없어요. 서버가 실행 중인지와 주소·포트를 확인해 주세요.';
  } else if (['ERR_TIMED_OUT', 'ERR_CONNECTION_TIMED_OUT'].includes(code)) {
    message = '페이지 응답을 기다리는 시간이 초과됐어요. 서버 상태를 확인한 뒤 다시 시도해 주세요.';
  } else if (code === 'ERR_ABORTED') {
    message = '페이지 열기가 취소됐어요. 주소를 확인한 뒤 다시 시도해 주세요.';
  }
  return new Error(message);
}

export async function loadPreviewURL(contents, url, timeout = 12000) {
  let timer;
  try {
    const expiry = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Preview timed out.'), { code: 'ERR_TIMED_OUT' })), timeout);
    });
    await Promise.race([contents.loadURL(url), expiry]);
  } catch (error) {
    if (!contents.isDestroyed()) contents.stop();
    throw previewLoadError(error);
  } finally { clearTimeout(timer); }
}

// Native history actions do not return a load promise. Subscribe before moving
// so cached, same-document and ordinary navigations all finish in one bounded
// operation, without replacing the preview or its browsing history.
export function isAllowedPreviewNavigation(value, allowedOrigin) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === allowedOrigin;
  } catch { return false; }
}
export async function navigatePreview(contents, action, { allowedOrigin, timeout = 12000 } = {}) {
  if (!contents || contents.isDestroyed()) throw new Error('주소로 연 미리보기를 먼저 열어 주세요.');
  if (!['back', 'forward', 'reload'].includes(action)) throw new Error('지원하지 않는 페이지 이동입니다.');
  const history = contents.navigationHistory;
  if ((action === 'back' && !history.canGoBack()) || (action === 'forward' && !history.canGoForward())) return { navigated: false };
  const offset = action === 'back' ? -1 : action === 'forward' ? 1 : 0;
  const destination = offset ? history.getEntryAtIndex(history.getActiveIndex() + offset)?.url : contents.getURL();
  if (!isAllowedPreviewNavigation(destination, allowedOrigin)) throw new Error('현재 미리보기와 같은 로컬 서버 안에서만 이동할 수 있어요.');
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      contents.off('did-finish-load', finished); contents.off('did-navigate-in-page', inPage);
      contents.off('did-fail-load', failed); contents.off('destroyed', closed);
    };
    const finished = () => { cleanup(); resolve(); };
    const inPage = (_event, _url, isMainFrame) => { if (isMainFrame) finished(); };
    const failed = (_event, _code, description, _url, isMainFrame) => {
      if (!isMainFrame) return;
      cleanup(); reject(previewLoadError({ message: description }));
    };
    const closed = () => { cleanup(); reject(new Error('미리보기 창이 닫혔어요. 다시 열어 주세요.')); };
    contents.on('did-finish-load', finished); contents.on('did-navigate-in-page', inPage);
    contents.on('did-fail-load', failed); contents.on('destroyed', closed);
    timer = setTimeout(() => {
      cleanup(); if (!contents.isDestroyed()) contents.stop();
      reject(previewLoadError({ code: 'ERR_TIMED_OUT' }));
    }, timeout);
    try {
      if (action === 'back') history.goBack();
      else if (action === 'forward') history.goForward();
      else contents.reload();
    } catch (error) { cleanup(); reject(previewLoadError(error)); }
  });
  return { navigated: true };
}
