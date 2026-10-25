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
