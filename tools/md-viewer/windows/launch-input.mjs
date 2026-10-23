import path from 'node:path';

export function launchInputs(argv, { packaged = true, cwd = process.cwd(), platform = process.platform } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return argv.slice(packaged ? 1 : 2)
    .filter((argument) => argument && !argument.startsWith('-'))
    .map((argument) => /^file:/i.test(argument) ? argument : paths.resolve(cwd, argument));
}

export function isReaderNavigation(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && url.pathname === '/' && !url.username && !url.password;
  } catch { return false; }
}

export function isExternalWebLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

// Only the app's main reader frame can invoke these fixed native pickers.
// Keep the raw value exact: URL normalization must not broaden this allowlist.
export function isDesktopAction(value, { sourceURL, origin, isMainFrame, isMainFrameInitiator } = {}) {
  return ['rdviewer://choose-folder', 'rdviewer://choose-files'].includes(value)
    && isMainFrame === true && isMainFrameInitiator === true
    && isReaderNavigation(sourceURL, origin);
}
