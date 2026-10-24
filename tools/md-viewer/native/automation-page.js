(async function rdviewerPageAction(command) {
  const action = command.action;
  const args = command.args || {};
  const visible = (el) => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const selector = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 12; node = node.parentElement) {
      const tag = node.localName;
      if (!tag) break;
      const siblings = node.parentElement ? [...node.parentElement.children].filter((item) => item.localName === tag) : [];
      parts.unshift(`${tag}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''}`);
      if (tag === 'body') break;
    }
    return parts.join(' > ');
  };
  const target = (fallback) => {
    const query = args.selector || fallback;
    if (!query || typeof query !== 'string' || query.length > 2048) throw new Error('A selector is required (maximum 2048 characters).');
    const element = document.querySelector(query);
    if (!element) throw new Error(`Element not found: ${query}`);
    return element;
  };
  if (action === 'snapshot' || action === 'status') {
    const candidates = [...document.querySelectorAll('video,audio'), ...document.querySelectorAll('button,a[href],input,textarea,select,[role=button],[contenteditable=true]')];
    const elements = [...new Set(candidates)].filter(visible).slice(0, 200).map((el) => ({
      selector: selector(el), tag: el.localName, role: el.getAttribute('role') || '',
      name: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '').slice(0, 300),
      type: el.getAttribute('type') || '', disabled: !!el.disabled,
      ...(el.type === 'password' ? {} : 'value' in el ? { value: String(el.value).slice(0, 1000) } : {}),
      ...(el instanceof HTMLMediaElement ? { paused: el.paused, currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : null } : {}),
    }));
    return { url: location.href, title: document.title, readyState: document.readyState, text: (document.body?.innerText || '').slice(0, 20000), elements, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, source: 'untrusted-preview-content' };
  }
  if (action === 'click') { const el = target(); el.scrollIntoView({ block: 'center', inline: 'nearest' }); el.focus?.(); el.click(); return { clicked: args.selector }; }
  if (action === 'fill') {
    const el = target(); const value = String(args.value ?? '').slice(0, 100000);
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    } else if (el instanceof HTMLSelectElement) el.value = value;
    else if (el.isContentEditable) el.textContent = value;
    else throw new Error('The selected element is not editable.');
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return { filled: args.selector };
  }
  if (action === 'press') {
    const el = args.selector ? target() : document.activeElement || document.body;
    const key = String(args.key || '').slice(0, 32); if (!key) throw new Error('A key is required.');
    el.focus?.();
    const proceed = el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true }));
    if (proceed && key === 'Enter' && el.form) el.form.requestSubmit();
    else if (proceed && (key === 'Enter' || key === ' ') && el.localName === 'button') el.click();
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    return { pressed: key };
  }
  if (action === 'scroll') {
    const x = Math.max(-10000, Math.min(10000, Number(args.x) || 0)); const y = Math.max(-10000, Math.min(10000, Number(args.y) || 0));
    (args.selector ? target() : window).scrollBy({ left: x, top: y, behavior: 'instant' }); return { scrolled: { x, y } };
  }
  if (['play','pause','seek'].includes(action)) {
    const el = target('video,audio'); if (!(el instanceof HTMLMediaElement)) throw new Error('Select a video or audio element.');
    if (action === 'play') await el.play();
    else if (action === 'pause') el.pause();
    else { const seconds = Number(args.seconds); if (!Number.isFinite(seconds) || seconds < 0) throw new Error('seconds must be a nonnegative number.'); el.currentTime = Number.isFinite(el.duration) ? Math.min(seconds, el.duration) : seconds; }
    return { paused: el.paused, currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : null };
  }
  throw new Error('Unsupported page action.');
})
