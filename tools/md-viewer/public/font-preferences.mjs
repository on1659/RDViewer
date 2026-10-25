// Fonts come from the device. The selector never enumerates installed fonts,
// downloads web fonts, or accepts arbitrary CSS declarations.
export const FONT_OPTIONS = Object.freeze([
  ['system', '시스템 기본'],
  ['sans', '고딕'],
  ['serif', '명조'],
  ['mono', '고정폭'],
  ['custom', '직접 지정'],
].map(([id, label]) => Object.freeze({ id, label })));

const SYSTEM_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const FONT_STACKS = Object.freeze({
  system: SYSTEM_FONT,
  sans: 'Arial, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
  serif: '"AppleMyungjo", "Batang", "Noto Serif KR", Georgia, serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "D2Coding", "Noto Sans Mono CJK KR", monospace',
});
const fontIds = new Set(FONT_OPTIONS.map(({ id }) => id));

/** A single installed font name, not a CSS family list or URL. Empty means fallback. */
export function validateCustomFont(value) {
  if (typeof value !== 'string') return { ok: false, error: '글꼴 이름을 입력해 주세요.' };
  const normalized = value.normalize('NFC');
  if (Array.from(normalized).length > 80) return { ok: false, error: '글꼴 이름은 80자까지 입력할 수 있어요.' };
  if (!/^[\p{L}\p{M}\p{N} ._-]*$/u.test(normalized)) return { ok: false, error: '글자·숫자·공백과 . _ -만 사용할 수 있어요.' };
  return { ok: true, value: normalized.trim() };
}

/** Extract only these fields from existing folio.settings; keep unrelated settings outside this function. */
export function normalizeFontPreferences(saved) {
  const fontFamily = fontIds.has(saved?.fontFamily) ? saved.fontFamily : 'system';
  const custom = validateCustomFont(saved?.customFont ?? '');
  return { fontFamily, customFont: custom.ok ? custom.value : '' };
}

/** Safe, offline CSS stack for --reader-font. An unavailable custom font falls back automatically. */
export function readerFontFamily(preferences) {
  const { fontFamily, customFont } = normalizeFontPreferences(preferences);
  if (fontFamily === 'custom') return customFont ? `"${customFont}", ${SYSTEM_FONT}` : SYSTEM_FONT;
  return FONT_STACKS[fontFamily];
}
