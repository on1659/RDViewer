// Add actions here with a stable ID; UI, saved bindings and key dispatch use
// that ID rather than labels or a second list of hardcoded key combinations.
export const COMMANDS = Object.freeze([
  ['file.open', '파일 추가', 'Mod+O'],
  ['folder.open', '폴더 추가', 'Mod+Shift+O'],
  ['preview.openURL', '주소로 들어가기', 'Mod+Shift+L'],
  ['preview.back', '웹페이지 뒤로가기', ''],
  ['preview.forward', '웹페이지 앞으로가기', ''],
  ['search.files', '파일 이름·내용 검색', 'Mod+P'],
  ['search.document', '문서 안에서 찾기', 'Mod+F'],
  ['document.reload', '현재 문서 새로고침', 'Mod+R'],
  ['settings.open', '설정', 'Mod+Comma'],
  ['view.read', '읽기 보기', ''],
  ['view.source', '원문 보기', ''],
  ['view.focus', '집중 모드', ''],
  ['folders.expandAll', '모든 폴더 펼치기', ''],
  ['folders.collapseAll', '모든 폴더 접기', ''],
].map(([id, label, defaultBinding]) => Object.freeze({ id, label, defaultBinding })));

const commandIds = new Set(COMMANDS.map(({ id }) => id));
const modifiers = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'];
const aliases = new Map(Object.entries({
  mod: 'Mod', cmdorctrl: 'Mod', commandorcontrol: 'Mod',
  ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift',
  meta: 'Meta', cmd: 'Meta', command: 'Meta', win: 'Meta',
  ',': 'Comma', comma: 'Comma', '.': 'Period', period: 'Period',
  '/': 'Slash', slash: 'Slash', '\\': 'Backslash', backslash: 'Backslash',
  ';': 'Semicolon', semicolon: 'Semicolon', "'": 'Quote', quote: 'Quote',
  '-': 'Minus', minus: 'Minus', '=': 'Equal', equal: 'Equal',
  '[': 'BracketLeft', bracketleft: 'BracketLeft', ']': 'BracketRight', bracketright: 'BracketRight',
  '`': 'Backquote', backquote: 'Backquote', space: 'Space', ' ': 'Space',
  enter: 'Enter',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', delete: 'Delete', backspace: 'Backspace',
}));

/** Canonical stored syntax is e.g. Mod+Shift+O or Mod+Comma; null is invalid. */
export function normalizeShortcut(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  if (!value.trim()) return '';
  const parts = value.split('+').map((part) => part.trim());
  if (parts.some((part) => !part)) return null;
  const tokens = parts.map((part) => aliases.get(part.toLowerCase()) || (/^(?:Key)?[a-z]$/i.test(part) ? part.slice(-1).toUpperCase() : /^(?:Digit)?[0-9]$/.test(part) ? `Digit${part.slice(-1)}` : /^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(part) ? part.toUpperCase() : null));
  if (tokens.some((part) => !part) || new Set(tokens).size !== tokens.length) return null;
  const key = tokens.at(-1);
  if (modifiers.includes(key) || tokens.slice(0, -1).some((part) => !modifiers.includes(part))) return null;
  const held = modifiers.filter((part) => tokens.includes(part));
  if (!held.length && !/^F\d+$/.test(key)) return null;
  return [...held, key].join('+');
}

function physicalBinding(binding, isMac) {
  return [...new Set(binding.split('+').map((part) => part === 'Mod' ? isMac ? 'Meta' : 'Ctrl' : part))].sort().join('+');
}

function isReserved(binding, isMac) {
  const physical = physicalBinding(binding, isMac);
  const reserved = [
    'Mod+Q', 'Mod+W', 'Mod+N', 'Mod+T', 'Mod+L',
    'Mod+Shift+W', 'Mod+Shift+N', 'Mod+Shift+T',
    'Mod+C', 'Mod+V', 'Mod+A', 'Mod+X', 'Mod+Z', 'Mod+Shift+Z', 'Mod+Y',
    'Mod+Equal', 'Mod+Shift+Equal', 'Mod+Minus', 'Mod+Digit0',
    'Alt+F4', 'Meta+Space', 'Ctrl+Alt+Delete', 'F11',
  ];
  return reserved.some((value) => physicalBinding(value, isMac) === physical);
}

/** Capture physical letter/digit/punctuation keys consistently across layouts. */
export function shortcutFromEvent(event, { isMac = false, includeRepeat = false } = {}) {
  if (!event || event.isComposing || event.keyCode === 229 || event.repeat && !includeRepeat || ['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'CapsLock'].includes(event.key)) return null;
  if (event.getModifierState?.('AltGraph')) return null;
  const held = [];
  if (isMac ? event.metaKey : event.ctrlKey) held.push('Mod');
  if (isMac && event.ctrlKey) held.push('Ctrl');
  if (!isMac && event.metaKey) held.push('Meta');
  if (event.altKey) held.push('Alt');
  if (event.shiftKey) held.push('Shift');
  const code = typeof event.code === 'string' ? event.code : '';
  const codeKey = /^(?:Key[A-Z]|Digit[0-9]|Comma|Period|Slash|Backslash|Semicolon|Quote|Minus|Equal|BracketLeft|BracketRight|Backquote|Space|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(code) ? code : null;
  return normalizeShortcut([...held, codeKey || event.key || ''].join('+'));
}

export function formatShortcut(binding, { isMac = false } = {}) {
  const normalized = normalizeShortcut(binding);
  if (!normalized) return '미지정';
  const labels = { Mod: isMac ? '⌘' : 'Ctrl', Ctrl: isMac ? '⌃' : 'Ctrl', Alt: isMac ? '⌥' : 'Alt', Shift: isMac ? '⇧' : 'Shift', Meta: isMac ? '⌘' : 'Win', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backquote: '`', Space: 'Space' };
  return normalized.split('+').map((part) => labels[part] || part.replace(/^Digit/, '')).join(isMac ? ' ' : '+');
}

/**
 * No DOM or storage dependency. Persist serialize() under folio.shortcuts.
 * Schema: {version:1, bindings:{[stableCommandId]:canonicalChordOrEmptyString}}.
 * Missing overrides use defaults; an empty override disables a command.
 */
export function createShortcutRegistry(saved, { isMac = false } = {}) {
  let overrides = Object.create(null);
  if (saved?.version === 1 && saved.bindings && typeof saved.bindings === 'object' && !Array.isArray(saved.bindings)) {
    for (const [id, value] of Object.entries(saved.bindings).slice(0, 200)) {
      const normalized = normalizeShortcut(value);
      if (/^[a-z][a-zA-Z0-9.]{0,79}$/.test(id) && normalized !== null && (!normalized || !isReserved(normalized, isMac))) overrides[id] = normalized;
    }
  }
  const binding = (id) => commandIds.has(id) ? Object.hasOwn(overrides, id) ? overrides[id] : COMMANDS.find((command) => command.id === id).defaultBinding : '';
  // Saved custom bindings take precedence over newly introduced defaults.
  // Resolve only the conflicting command; never reset unrelated user choices.
  const seen = new Set();
  for (const { id } of COMMANDS.filter(({ id }) => Object.hasOwn(overrides, id))) {
    const chord = overrides[id];
    if (!chord) continue;
    const physical = physicalBinding(chord, isMac);
    if (seen.has(physical)) overrides[id] = '';
    else seen.add(physical);
  }
  for (const { id, defaultBinding } of COMMANDS) {
    if (Object.hasOwn(overrides, id) || !defaultBinding) continue;
    const physical = physicalBinding(defaultBinding, isMac);
    if (seen.has(physical)) overrides[id] = '';
    else seen.add(physical);
  }
  return {
    commands: COMMANDS,
    binding,
    match(event) {
      if (event?.defaultPrevented) return null;
      const chord = shortcutFromEvent(event, { isMac });
      if (!chord) return null;
      const physical = physicalBinding(chord, isMac);
      return COMMANDS.find(({ id }) => binding(id) && physicalBinding(binding(id), isMac) === physical)?.id || null;
    },
    // Keep former app defaults inert after remapping/disable instead of falling
    // through to the browser's print, file-open, find or reload behavior.
    handles(event) {
      if (event?.defaultPrevented) return false;
      const chord = shortcutFromEvent(event, { isMac, includeRepeat: true });
      if (!chord) return false;
      const physical = physicalBinding(chord, isMac);
      return COMMANDS.some(({ id, defaultBinding }) => [defaultBinding, binding(id)].some((value) => value && physicalBinding(value, isMac) === physical));
    },
    set(id, value) {
      if (!commandIds.has(id)) return { ok: false, error: '등록되지 않은 명령이에요.' };
      const normalized = normalizeShortcut(value);
      if (normalized === null) return { ok: false, error: 'Ctrl·⌘·Alt 같은 보조 키와 함께 입력해 주세요.' };
      if (normalized && isReserved(normalized, isMac)) return { ok: false, error: '운영체제나 기본 편집 기능에서 사용하는 단축키예요.' };
      const conflict = normalized && COMMANDS.find((command) => command.id !== id && binding(command.id) && physicalBinding(binding(command.id), isMac) === physicalBinding(normalized, isMac));
      if (conflict) return { ok: false, error: `‘${conflict.label}’에서 사용 중인 단축키예요.`, conflict: conflict.id };
      const command = COMMANDS.find((command) => command.id === id);
      if (normalized === command.defaultBinding) delete overrides[id]; else overrides[id] = normalized;
      return { ok: true };
    },
    reset(id) {
      if (id !== undefined) {
        const command = COMMANDS.find((command) => command.id === id);
        return command ? this.set(id, command.defaultBinding) : { ok: false, error: '등록되지 않은 명령이에요.' };
      }
      overrides = Object.create(null);
      return { ok: true };
    },
    serialize: () => ({ version: 1, bindings: { ...overrides } }),
  };
}
