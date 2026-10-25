import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateCustomFont } from './public/font-preferences.mjs';

const execute = promisify(execFile);
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const unavailable = '설치된 글꼴 목록을 가져오지 못했어요. 다시 시도해 주세요.';
const runOptions = Object.freeze({ encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false });
const powershellScript = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; Add-Type -AssemblyName System.Drawing; $collection=[System.Drawing.Text.InstalledFontCollection]::new(); try { $culture=[System.Globalization.CultureInfo]::CurrentUICulture.LCID; $fonts=@($collection.Families | ForEach-Object { $display=$_.Name; try { $display=$_.GetName($culture) } catch {}; [pscustomobject]@{family=$_.Name;displayName=$display} }); ConvertTo-Json -InputObject $fonts -Compress -Depth 3 } finally { $collection.Dispose() }`;

/** Strip all provider metadata. Localized labels never replace canonical CSS family names. */
export function normalizeFontCatalog(input, limit = 2000) {
  const entries = Array.isArray(input) ? input : typeof input === 'string' || input?.family ? [input] : [];
  const families = new Map();
  for (const entry of entries.slice(0, 20_000)) {
    const family = validateCustomFont(typeof entry === 'string' ? entry : entry?.family);
    if (!family.ok || !family.value || family.value.startsWith('.')) continue;
    const key = family.value.toLocaleLowerCase('en-US');
    if (families.has(key)) continue;
    const display = validateCustomFont(typeof entry === 'string' ? entry : entry?.displayName);
    families.set(key, { family: family.value, displayName: display.ok && display.value ? display.value : family.value });
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...families.values()].sort((a, b) => collator.compare(a.displayName, b.displayName) || collator.compare(a.family, b.family)).slice(0, Math.max(0, Math.min(2000, limit)));
}

function parseJSON(output) {
  return JSON.parse(String(output).replace(/^\uFEFF/, '').trim());
}

function profilerFamilies(data) {
  const fonts = [];
  let visited = 0;
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 12 || ++visited > 50_000) return;
    if (Array.isArray(value)) { value.forEach((entry) => visit(entry, depth + 1)); return; }
    const family = value.family || value.family_name || value.spfonts_family;
    if (typeof family === 'string') fonts.push({ family, displayName: typeof value.localized_family === 'string' ? value.localized_family : family });
    Object.values(value).forEach((entry) => visit(entry, depth + 1));
  }
  visit(data);
  return fonts;
}

/** Fixed local commands only; no request or family name becomes a process argument. */
export function createSystemFontProvider({ platform = process.platform, directory = appDirectory, env = process.env, run = execute, executable = async (filename) => {
  try { await access(filename, constants.X_OK); return true; } catch { return false; }
} } = {}) {
  return async () => {
    if (platform === 'darwin') {
      const helpers = [
        path.resolve(directory, '../../MacOS/RDViewerFontCatalog'),
        path.resolve(directory, 'macos/build/RDViewer.app/Contents/MacOS/RDViewerFontCatalog'),
      ];
      for (const helper of helpers) if (await executable(helper)) return parseJSON((await run(helper, [], runOptions)).stdout);
      const response = await run('/usr/sbin/system_profiler', ['SPFontsDataType', '-json'], { ...runOptions, maxBuffer: 8 * 1024 * 1024 });
      return profilerFamilies(parseJSON(response.stdout));
    }
    if (platform === 'win32') {
      const powershell = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const response = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', powershellScript], runOptions);
      return parseJSON(response.stdout);
    }
    if (platform === 'linux') {
      const response = await run('/usr/bin/fc-list', ['--format', '%{family}\n'], runOptions);
      return String(response.stdout).split(/\r?\n/).flatMap((line) => line.split(','));
    }
    throw new Error('Installed font enumeration is unavailable.');
  };
}

/** Lazy, bounded discovery. Concurrent callers share one probe; retry never starts a second probe. */
export function createFontCatalog({ provider = createSystemFontProvider(), now = Date.now, cacheMs = 5 * 60_000, failureCacheMs = 10_000 } = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  return {
    list({ refresh = false } = {}) {
      if (pending) return pending;
      if (!refresh && cached && now() < expiresAt) return Promise.resolve(cached);
      pending = (async () => {
        try {
          const fonts = normalizeFontCatalog(await provider());
          if (!fonts.length) throw new Error('No installed families were returned.');
          cached = { fonts: fonts.map(Object.freeze), available: true };
        } catch { cached = { fonts: [], available: false, error: unavailable }; }
        Object.freeze(cached.fonts); Object.freeze(cached);
        expiresAt = now() + (cached.available ? cacheMs : failureCacheMs);
        return cached;
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
