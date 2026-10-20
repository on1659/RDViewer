/* RDViewer is a read-only client. All document content is treated as untrusted. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const icons = {
    folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2"/>',
    expandAll: '<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 3H5a2 2 0 0 0-2 2v12M10 14h8M14 10v8"/>',
    collapseAll: '<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 3H5a2 2 0 0 0-2 2v12M10 14h8"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    book: '<path d="M12 5v15M3 5c4-2 6-1 9 1 3-2 5-3 9-1v14c-4-2-6-1-9 1-3-2-5-3-9-1V5Z"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
    document: '<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
    list: '<path d="M8 6h13M8 12h10M8 18h7M3 6h.01M3 12h.01M3 18h.01"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
  };
  const icon = (name, className = "") => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ""}</svg>`;
  document.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const storage = {
    get(key) { try { return JSON.parse(localStorage.getItem(`folio.${key}`)); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(`folio.${key}`, JSON.stringify(value)); } catch { /* Private browsing still supports reading. */ } },
  };
  const palettes = {
    light: { background: "#fdfdfb", text: "#282e2b", accent: "#287b68" },
    paper: { background: "#f3f2ef", text: "#323337", accent: "#5b617e" },
    sepia: { background: "#f4ead7", text: "#493b2e", accent: "#876031" },
    dark: { background: "#202522", text: "#e1e6de", accent: "#8acbb3" },
    midnight: { background: "#171d2c", text: "#e1e7f4", accent: "#a5baff" },
    vscode: {
      background: "#1e1e1e", text: "#d4d4d4", accent: "#4fc1ff",
      tokens: { paper: "#1e1e1e", sidebar: "#252526", raised: "#252526", muted: "#a6a6a6", line: "#454545", hover: "#2a2d2e", "accent-soft": "#173b55", code: "#252526", "ui-text": "#d4d4d4" },
    },
    "visualstudio-purple": {
      background: "#211e29", text: "#e8e3ef", accent: "#c4a1f5",
      tokens: { paper: "#211e29", sidebar: "#2e253e", raised: "#352b47", muted: "#b6aabd", line: "#51445f", hover: "#40334f", "accent-soft": "#453153", code: "#292232", "ui-text": "#e8e3ef" },
    },
  };
  const validColor = (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
  const rgb = (color) => color.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
  function mix(a, b, amount) { return `#${rgb(a).map((value, i) => Math.round(value * (1 - amount) + rgb(b)[i] * amount).toString(16).padStart(2, "0")).join("")}`; }
  function luminance(color) { return rgb(color).map((value) => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0); }
  function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }
  const saved = storage.get("settings") || {};
  // Preserve the charcoal-and-blue appearance saved under its former label.
  const savedTheme = saved.theme === "visualstudio" ? "vscode" : saved.theme;
  const settings = {
    fontSize: Number.isFinite(saved.fontSize) ? Math.min(24, Math.max(14, saved.fontSize)) : 17,
    width: [680, 800, 1000].includes(saved.width) ? saved.width : 800,
    theme: [...Object.keys(palettes), "system", "custom"].includes(savedTheme) ? savedTheme : "light",
    custom: Object.fromEntries(Object.keys(palettes.light).map((key) => [key, validColor(saved.custom?.[key]) ? saved.custom[key] : palettes.light[key]])),
  };
  const localDocuments = new Map();
  const storedSessions = storage.get("project-sessions");
  const projectSessions = Object.fromEntries(Object.entries(storedSessions && typeof storedSessions === "object" ? storedSessions : {}).filter(([, session]) => session && Array.isArray(session.tabs)).map(([id, session]) => [id, { tabs: session.tabs.filter((path) => typeof path === "string" && !path.startsWith("선택한 파일/")), path: typeof session.path === "string" ? session.path : "" }]));
  const storedGroupFolders = storage.get("group-folders");
  const groupFolders = new Map(Object.entries(storedGroupFolders && typeof storedGroupFolders === "object" ? storedGroupFolders : {}).filter(([, id]) => typeof id === "string"));
  const state = { projectReady: false, projectId: "default", projects: [], navigation: 0, treeRequest: 0, files: [], rootName: "", tabs: [], path: "", content: "", source: false, scrolls: new Map(), headings: [], request: 0, loaded: false, treeLoaded: false };
  let toastTimer;
  let scrollFrame;
  const mediaTheme = window.matchMedia("(prefers-color-scheme: dark)");
  function applySettings() {
    const resolved = settings.theme === "system" ? (mediaTheme.matches ? "dark" : "light") : settings.theme;
    const palette = resolved === "custom" ? settings.custom : palettes[resolved];
    const { background, text, accent } = palette;
    const dark = luminance(background) < .2;
    const uiText = contrast(background, "#ffffff") > contrast(background, "#181b19") ? "#ffffff" : "#181b19";
    const uiAccent = contrast(accent, background) >= 4.5 ? accent : uiText;
    const tokens = { canvas: background, paper: mix(background, dark ? "#ffffff" : "#ffffff", .035), sidebar: mix(background, uiText, .035), raised: background, text, muted: mix(background, uiText, .62), line: mix(background, uiText, .16), hover: mix(background, uiText, .08), accent: uiAccent, "reader-accent": accent, "accent-soft": mix(background, accent, .1), code: mix(background, uiText, .035), "ui-text": uiText, "ui-accent": uiAccent };
    Object.assign(tokens, palette.tokens);
    for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(`--${name}`, value);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.tone = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]').content = background;
    for (const key of Object.keys(palettes.light)) {
      $( `color-${key}` ).value = palette[key];
      $( `hex-${key}` ).value = palette[key];
      $( `hex-${key}` ).setCustomValidity("");
      $( `hex-${key}` ).removeAttribute("aria-invalid");
    }
    const ratio = contrast(background, text);
    const accentRatio = contrast(background, accent);
    $("contrast-status").textContent = `본문 대비 ${ratio.toFixed(1)}:1 · 강조 ${accentRatio.toFixed(1)}:1${Math.min(ratio, accentRatio) < 4.5 ? " — 4.5:1 이상을 권장해요. 색상을 조절하거나 초기화해 주세요." : " — 읽기 좋은 대비예요."}`;
    $("contrast-status").dataset.warning = String(Math.min(ratio, accentRatio) < 4.5);
    document.documentElement.style.setProperty("--reader-size", `${settings.fontSize}px`);
    document.documentElement.style.setProperty("--reader-width", `${settings.width}px`);
    $("font-size").value = settings.fontSize;
    $("font-size-output").value = `${settings.fontSize}px`;
    $("reading-width").value = settings.width;
    $("theme").value = settings.theme;
    storage.set("settings", settings);
  }
  applySettings();
  mediaTheme.addEventListener("change", applySettings);
  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500);
  }
  function announce(message) { $("announcement").textContent = message; }
  function resolvePath(reference, base = state.path) {
    let decoded;
    try { decoded = decodeURIComponent(reference); } catch { return null; }
    if (/[\u0000-\u001f\\]/.test(decoded) || /^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith("//")) return null;
    const parts = decoded.startsWith("/") ? [] : base.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else parts.push(part);
    }
    return parts.join("/");
  }
  let markdown;
  if (typeof window.markdownit === "function") {
    markdown = window.markdownit({
      html: false, linkify: true, typographer: true,
      highlight(code, language) {
        if (window.hljs && language && window.hljs.getLanguage(language)) {
          try { return window.hljs.highlight(code, { language, ignoreIllegals: true }).value; } catch { /* Render escaped code below. */ }
        }
        return "";
      },
    });
    markdown.renderer.rules.image = (tokens, index) => {
      const token = tokens[index];
      const src = token.attrGet("src") || "";
      const alt = token.content || "이미지";
      if (/^(https?:)?\/\//i.test(src)) return `<span class="image-placeholder" role="img" aria-label="${escape(alt)}">외부 이미지 · ${escape(alt)}</span>`;
      if (localDocuments.has(state.path)) return `<span class="image-placeholder">${escape(alt)} · 파일 경로로 열면 상대 이미지를 볼 수 있어요</span>`;
      const imagePath = resolvePath(src.split(/[?#]/)[0]);
      if (!imagePath) return `<span class="image-placeholder">${escape(alt)} · 이미지를 표시할 수 없어요</span>`;
      return `<img src="/api/asset?path=${encodeURIComponent(imagePath)}" alt="${escape(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
    };
  }
  function filename(path) { return path.split("/").pop(); }
  function displayPath(path) {
    if (path.startsWith("@projects/")) return path.split("/").slice(2).join("/");
    if (path.startsWith("@opened/")) return ["다른 폴더", ...path.split("/").slice(2)].join("/");
    if (localDocuments.has(path)) return `선택한 파일/${filename(path)}`;
    return path;
  }
  function fileButton(file, depth = 0, searching = false) {
    const parent = displayPath(file.path).split("/").slice(0, -1).join("/");
    return `<button class="file-item${file.path === state.path ? " active" : ""}" style="--depth:${depth}" data-path="${escape(file.path)}" title="${escape(displayPath(file.path))}"${file.path === state.path ? ' aria-current="page"' : ""}><span class="file-glyph" aria-hidden="true">M↓</span><span class="file-details"><span class="file-name">${escape(file.name || filename(file.path))}</span>${searching && parent ? `<span class="file-parent">${escape(parent)}</span>` : ""}</span></button>`;
  }
  let foldersBeforeSearch = null;
  let folderSearchProject = "";
  let folderContext = "";
  let suppressFolderAutoOpen = false;
  function updateTreeActions() {
    const empty = !$("file-tree").querySelector("details.folder");
    $("expand-all-folders").disabled = empty;
    $("collapse-all-folders").disabled = empty;
  }
  function setAllFolders(open) {
    // Keep this explicit choice through refreshes and redraws of the same view.
    // A new document, project, or search restores automatic path revelation.
    suppressFolderAutoOpen = true;
    const folders = $("file-tree").querySelectorAll("details.folder");
    folders.forEach((folder) => { folder.open = open; });
    announce(`${folders.length}개 폴더를 모두 ${open ? "펼쳤어요" : "접었어요"}.`);
  }
  function renderTree() {
    const query = $("file-search").value.trim().toLocaleLowerCase();
    const context = `${state.projectId}\0${query}\0${state.path}`;
    if (folderContext !== context) { suppressFolderAutoOpen = false; folderContext = context; }
    let openFolders = new Set([...$("file-tree").querySelectorAll("details[open]")].map((el) => el.dataset.folder));
    if (folderSearchProject !== state.projectId) {
      foldersBeforeSearch = null;
      folderSearchProject = state.projectId;
    }
    if (query && foldersBeforeSearch === null) foldersBeforeSearch = openFolders;
    if (!query && foldersBeforeSearch !== null) { openFolders = foldersBeforeSearch; foldersBeforeSearch = null; }
    const visibleFiles = state.files.filter((file) => /\.(md|markdown|mdown)$/i.test(file.path) && (!query || displayPath(file.path).toLocaleLowerCase().includes(query)));
    const root = { folders: new Map(), files: [], count: 0 };
    for (const file of visibleFiles.filter((file) => !localDocuments.has(file.path) && !file.path.startsWith("@opened/"))) {
      const parts = displayPath(file.path).split("/");
      let node = root;
      node.count++;
      for (const part of parts.slice(0, -1)) {
        if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [], count: 0 });
        node = node.folders.get(part);
        node.count++;
      }
      node.files.push(file);
    }
    function render(node, parent = "", depth = 0) {
      return [...node.folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
        const path = parent ? `${parent}/${name}` : name;
        const open = openFolders.has(path) || !suppressFolderAutoOpen && (query || displayPath(state.path).startsWith(`${path}/`));
        return `<details class="folder" data-folder="${escape(path)}"${open ? " open" : ""}><summary style="--depth:${depth}">${icon("chevron", "chevron")}${icon("folder")}<span class="folder-name">${escape(name)}</span><span class="folder-count">${child.count}</span></summary>${render(child, path, depth + 1)}</details>`;
      }).join("") + node.files.map((file) => fileButton(file, depth)).join("");
    }
    const imports = [...localDocuments].filter(([path]) => visibleFiles.some((file) => file.path === path)).map(([path, doc]) => fileButton({ path, name: doc.name })).join("");
    const external = visibleFiles.filter((file) => file.path.startsWith("@opened/")).map((file) => fileButton(file)).join("");
    $("file-tree").innerHTML = visibleFiles.length ? `${imports ? `<div class="local-files-heading">선택한 파일 · 이 탭에서만 보관</div>${imports}` : ""}${external ? `<div class="local-files-heading">다른 폴더에서 연 문서</div>${external}` : ""}${render(root)}` : `<p class="muted tree-message">${query ? "일치하는 문서가 없어요.<br>다른 이름으로 검색해 보세요." : "이 폴더에는 Markdown 문서가 없어요."}</p>`;
    updateTreeActions();
  }
  function renderTabs() {
    $("tabs").innerHTML = state.tabs.map((path) => `<div class="tab${path === state.path ? " selected" : ""}"><button class="tab-open" data-path="${escape(path)}" title="${escape(displayPath(path))}"${path === state.path ? ' aria-current="page"' : ""}><span class="file-glyph" aria-hidden="true">M↓</span><span class="tab-label">${escape(filename(path))}</span></button><button class="tab-close icon-button" data-close="${escape(path)}" aria-label="${escape(filename(path))} 탭 닫기">${icon("close")}</button></div>`).join("");
    $("tabs").querySelector(".selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function setSidebar(open) {
    $("app").classList.toggle("sidebar-open", open);
    $("sidebar-backdrop").hidden = !open;
    $("toggle-sidebar").setAttribute("aria-expanded", String(open));
    if (open) $("file-search").focus();
  }
  function saveScroll() { if (state.path && state.loaded) state.scrolls.set(`${state.path}:${state.source}`, $("reading").scrollTop); }
  function updateProgress() {
    const reader = $("reading");
    const max = reader.scrollHeight - reader.clientHeight;
    const progress = state.loaded ? (max <= 1 ? 100 : Math.min(100, Math.round(reader.scrollTop / max * 100))) : 0;
    $("reading-progress").style.width = `${progress}%`;
    $("progress-label").textContent = `${progress}%`;
    if (!state.source && state.headings.length) {
      const top = reader.getBoundingClientRect().top;
      let active = state.headings[0].id;
      for (const heading of state.headings) {
        if (heading.getBoundingClientRect().top <= top + 85) active = heading.id;
        else break;
      }
      $("outline-links").querySelectorAll("a").forEach((a) => {
        const selected = a.dataset.heading === active;
        a.classList.toggle("active", selected);
        if (selected) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
      });
    }
  }
  function jumpToHeading(hash) {
    let id;
    try { id = decodeURIComponent(hash.replace(/^#/, "")); } catch { return; }
    const target = state.headings.find((heading) => heading.id === id);
    if (target) {
      if (state.source) setSource(false);
      target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    } else if (id) toast("이 제목을 문서에서 찾지 못했어요.");
  }
  function enhanceDocument() {
    const counts = new Map();
    const usedIds = new Set();
    state.headings = [...$("article").querySelectorAll("h1,h2,h3,h4,h5,h6")];
    state.headings.forEach((heading) => {
      const base = heading.textContent.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-") || "section";
      let count = counts.get(base) || 0;
      while (usedIds.has(count ? `${base}-${count}` : base)) count++;
      counts.set(base, count + 1);
      heading.id = count ? `${base}-${count}` : base;
      usedIds.add(heading.id);
    });
    const minLevel = Math.min(...state.headings.map((h) => Number(h.tagName[1])));
    $("outline-links").innerHTML = state.headings.length
      ? state.headings.map((heading) => `<a href="#${encodeURIComponent(heading.id)}" data-heading="${escape(heading.id)}" style="--level:${Math.min(3, Number(heading.tagName[1]) - minLevel)}">${escape(heading.textContent)}</a>`).join("")
      : '<p class="muted">이 문서에는 제목이 없어요.</p>';
    $("article").querySelectorAll("li").forEach((item) => {
      const container = item.firstElementChild?.tagName === "P" ? item.firstElementChild : item;
      const first = container.firstChild;
      if (first?.nodeType !== Node.TEXT_NODE) return;
      const match = first.textContent.match(/^\[([ xX])\]\s+/);
      if (!match) return;
      first.textContent = first.textContent.slice(match[0].length);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = true;
      checkbox.checked = match[1].toLowerCase() === "x";
      checkbox.setAttribute("aria-label", checkbox.checked ? "완료한 항목" : "미완료 항목");
      item.classList.add("task-item");
      container.prepend(checkbox);
    });
    $("article").querySelectorAll("table").forEach((table) => {
      const wrap = document.createElement("div");
      wrap.className = "table-scroll";
      wrap.tabIndex = 0;
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", "표 (가로 스크롤 가능)");
      table.before(wrap); wrap.append(table);
    });
    $("article").querySelectorAll("pre").forEach((pre) => {
      const button = document.createElement("button");
      button.className = "copy-code";
      button.textContent = "복사";
      button.setAttribute("aria-label", "코드 복사");
      button.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(pre.querySelector("code")?.textContent || ""); toast("코드를 복사했어요."); }
        catch { toast("브라우저에서 복사를 허용하지 않았어요."); }
      });
      pre.append(button);
    });
    $("article").querySelectorAll("a").forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
      else if (/^mailto:/i.test(href)) { link.rel = "noopener noreferrer"; }
      else if (href.startsWith("#")) { link.dataset.anchor = href; }
      else if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith("//")) {
        const [pathPart, hash] = href.split("#");
        const path = resolvePath(pathPart.split("?")[0]);
        if (localDocuments.has(state.path)) {
          link.removeAttribute("href");
          link.setAttribute("aria-disabled", "true");
          link.dataset.localReference = "true";
          link.title = "파일 경로로 열면 상대 문서 링크를 이용할 수 있어요";
        } else if (path && /\.(md|markdown|mdown)$/i.test(path)) {
          link.dataset.document = path;
          let decodedHash = hash;
          try { decodedHash = hash ? decodeURIComponent(hash) : ""; } catch { /* Leave malformed fragments as text. */ }
          if (decodedHash) link.dataset.documentHash = decodedHash;
          link.href = `?project=${encodeURIComponent(ownerOf(path))}&doc=${encodeURIComponent(path)}${decodedHash ? `#${encodeURIComponent(decodedHash)}` : ""}`;
        } else {
          link.removeAttribute("href");
          link.setAttribute("aria-disabled", "true");
          link.title = "Markdown 문서 링크만 열 수 있어요";
        }
      } else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); }
    });
    $("article").querySelectorAll("img").forEach((img) => {
      img.addEventListener("error", () => {
        const label = document.createElement("span");
        label.className = "image-placeholder";
        label.textContent = `${img.alt || "이미지"} · 파일을 불러올 수 없어요`;
        img.replaceWith(label);
      }, { once: true });
      img.addEventListener("load", updateProgress, { once: true });
    });
  }
  function renderDocument() {
    $("source-code").textContent = state.content;
    if (!markdown) throw new Error("Markdown 렌더러를 불러오지 못했어요. 서버 의존성을 확인해 주세요.");
    $("article").innerHTML = markdown.render(state.content);
    if (!state.content.trim()) $("article").innerHTML = '<div class="empty-state"><h1>아직 비어 있는 문서</h1><p>파일에 내용이 추가되면 새로고침해 주세요.</p></div>';
    if (localDocuments.has(state.path)) {
      const notice = document.createElement("p"); notice.className = "local-document-note";
      notice.textContent = "선택한 파일 · 새로고침하면 다시 선택해야 해요. 상대 이미지·링크는 파일 경로로 열어 주세요.";
      $("article").prepend(notice);
    }
    enhanceDocument();
    $("article").hidden = state.source;
    $("source-view").hidden = !state.source;
    $("document-meta").hidden = false;
    $("document-end").hidden = false;
    const characters = state.content.replace(/\s/g, "").length;
    $("reading-time").textContent = `약 ${Math.max(1, Math.ceil(characters / 650))}분 읽기`;
    $("word-count").textContent = `${characters.toLocaleString()}자`;
    $("status-text").textContent = localDocuments.has(state.path) ? "선택한 파일 · 이 탭에서만 보관" : "로컬 문서 · 읽기 전용";
    $("preview-mode").classList.toggle("active", !state.source);
    $("source-mode").classList.toggle("active", state.source);
    $("preview-mode").setAttribute("aria-pressed", String(!state.source));
    $("source-mode").setAttribute("aria-pressed", String(state.source));
  }
  async function fetchJSON(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      let message;
      try { const body = await response.json(); message = typeof body.error === "string" ? body.error : body.error?.message; } catch { /* Fall back to a useful status. */ }
      throw new Error(message || (response.status === 404 ? "파일을 찾을 수 없어요. 이동하거나 삭제되었는지 확인해 주세요." : `문서를 불러오지 못했어요 (${response.status}).`));
    }
    return response.json();
  }
  function ownerOf(path) {
    if (path?.startsWith("@projects/")) return path.split("/")[1];
    return path?.startsWith("@opened/") || path?.startsWith("선택한 파일/") ? "loose" : "default";
  }
  function projectURL(path = "", hash = "") {
    return `?project=${encodeURIComponent(state.projectId)}${path ? `&doc=${encodeURIComponent(path)}` : ""}${hash ? `#${encodeURIComponent(hash.replace(/^#/, ""))}` : ""}`;
  }
  function saveProjectSession() {
    if (!state.projectReady || state.projectPending && !state.path) return;
    projectSessions[state.projectId] = { tabs: [...state.tabs], path: state.path };
    storage.set("project-sessions", Object.fromEntries(Object.entries(projectSessions).map(([id, session]) => [id, { tabs: session.tabs.filter((path) => !localDocuments.has(path)), path: localDocuments.has(session.path) ? "" : session.path }])));
    storage.set("selected-project", state.projectId);
  }
  function projectGroups() {
    const groups = new Map();
    for (const project of state.projects) {
      const group = project.group?.id ? project.group : { id: `folder:${project.id}`, name: project.name, kind: "folder" };
      if (!groups.has(group.id)) groups.set(group.id, { ...group, projects: [] });
      groups.get(group.id).projects.push(project);
    }
    const result = [...groups.values()];
    for (const group of result) {
      const main = group.projects.find((project) => project.name === group.name) || group.projects.find((project) => project.isDefault) || group.projects[0];
      group.path = main.path;
      group.label = result.filter((other) => other.name === group.name).length > 1 ? `${group.name} · ${group.path}` : group.name;
    }
    result.push({ id: "loose", name: "개별 문서", label: "개별 문서", kind: "folder", projects: [{ id: "loose", name: "개별 문서", path: "프로젝트 밖에서 연 문서" }] });
    return result;
  }
  const expandedProjectGroups = new Set();
  function renderSidebarProjects() {
    $("sidebar-projects").innerHTML = projectGroups().map((group, index) => {
      const active = group.projects.some((project) => project.id === state.projectId);
      const expanded = expandedProjectGroups.has(group.id);
      const multiple = group.projects.length > 1;
      return `<div class="sidebar-project">
        <div class="sidebar-project-row${active ? " active" : ""}">
          <button class="sidebar-project-link" data-open-group="${escape(group.id)}" title="${escape(group.label)}"${active ? ' aria-current="true"' : ""}>${icon("folder")}<span>${escape(group.name)}</span></button>
          ${multiple ? `<button class="sidebar-project-expand" data-expand-group="${escape(group.id)}" aria-label="${escape(group.name)} 작업 폴더" aria-expanded="${expanded}" aria-controls="sidebar-folders-${index}">${icon("chevron")}</button>` : ""}
        </div>
        ${multiple ? `<div id="sidebar-folders-${index}" class="sidebar-project-folders"${expanded ? "" : " hidden"}>${group.projects.map((project) => `<button data-open-project="${escape(project.id)}" title="${escape(`${project.branch || project.name}\n${project.path}`)}"${project.id === state.projectId ? ' aria-current="true"' : ""}>${icon("folder")}<span>${escape(project.name === group.name ? "기본 폴더" : project.name.startsWith(`${group.name}-`) ? project.name.slice(group.name.length + 1) : project.name)}</span></button>`).join("")}</div>` : ""}
      </div>`;
    }).join("");
  }
  function renderProjects() {
    const groups = projectGroups();
    const active = groups.find((group) => group.projects.some((project) => project.id === state.projectId)) || groups[0];
    const activeFolder = active.projects.find((project) => project.id === state.projectId) || active.projects[0];
    $("current-project-group").textContent = active.name;
    $("current-project-group").title = active.label;
    $("current-project-folder").textContent = activeFolder.name !== active.name ? activeFolder.name : activeFolder.branch || "";
    $("current-project-folder").title = `${activeFolder.name}${activeFolder.branch ? ` · ${activeFolder.branch}` : ""}\n${activeFolder.path}`;
    $("current-project-folder").hidden = !$("current-project-folder").textContent;
    $("project-group-count").textContent = String(groups.length - 1);
    renderSidebarProjects();
    renderProjectPicker();
    const expanded = new Set([...$("project-list").querySelectorAll("details[open]")].map((item) => item.dataset.group));
    const firstRender = !$("project-list").childElementCount;
    $("project-list").innerHTML = groups.filter((group) => group.id !== "loose").map((group) => `<details class="project-group" data-group="${escape(group.id)}"${expanded.has(group.id) || firstRender && group === active ? " open" : ""}><summary><span class="project-group-name">${escape(group.label)}</span><span class="project-badge">${group.projects.length}개 폴더</span></summary><div class="project-group-folders">${group.projects.map((project) => `<div class="project-list-item"><div class="project-list-info"><strong>${escape(project.name)}</strong>${project.branch ? `<span class="project-branch">${escape(project.branch)}</span>` : ""}<span>${escape(project.path)}</span></div>${project.isDefault ? '<span class="project-badge">기본</span>' : `<button class="secondary-button" data-remove-project="${escape(project.id)}" aria-label="${escape(project.name)} 작업 폴더 목록에서 빼기">목록에서 빼기</button>`}</div>`).join("")}</div></details>`).join("");
  }
  function renderProjectPicker() {
    const query = $("project-picker-search").value.trim().toLocaleLowerCase();
    const groups = projectGroups().map((group) => ({
      ...group,
      projects: group.projects.filter((project) => `${group.name} ${project.name} ${project.path} ${project.branch || ""}`.toLocaleLowerCase().includes(query)),
    })).filter((group) => group.projects.length);
    const count = groups.reduce((sum, group) => sum + group.projects.length, 0);
    $("project-picker-status").textContent = groups.length ? `${groups.length}개 묶음 · ${count}개 작업 폴더` : "일치하는 프로젝트가 없어요.";
    $("project-cards").innerHTML = groups.map((group) => `<section class="project-card" aria-label="${escape(group.label)}"><header><div><h3>${escape(group.name)}</h3>${group.label !== group.name ? `<span class="project-card-path">${escape(group.path)}</span>` : ""}</div><span class="project-badge">${group.projects.length}개</span></header><div class="project-card-choices">${group.projects.map((project) => `<button class="project-choice" data-select-project="${escape(project.id)}"${project.id === state.projectId ? ' aria-current="true"' : ""}><span class="project-choice-heading"><strong>${escape(project.name)}</strong>${project.id === state.projectId ? '<span class="project-current-badge">읽는 중</span>' : ""}</span>${project.branch ? `<span class="project-choice-branch">${escape(project.branch)}</span>` : ""}<span class="project-choice-path">${escape(project.path)}</span></button>`).join("")}</div></section>`).join("");
  }
  async function loadProjects() {
    const data = await fetchJSON("/api/projects");
    if (!Array.isArray(data.projects)) throw new Error("프로젝트 목록을 불러오지 못했어요.");
    state.projects = data.projects;
    renderProjects();
  }
  function emptyReader(message = "탐색기에서 읽고 싶은 문서를 골라 주세요.") {
    state.path = ""; state.content = ""; state.loaded = false; state.headings = [];
    $("article").hidden = false; $("source-view").hidden = true; $("document-meta").hidden = true; $("document-end").hidden = true;
    $("article").removeAttribute("aria-busy");
    $("article").innerHTML = `<div class="empty-state"><span class="empty-icon">R.</span><h1>읽을 문서를 기다리고 있어요</h1><p>${escape(message)}</p></div>`;
    $("breadcrumb").textContent = "문서 선택"; $("outline-links").innerHTML = '<p class="muted">문서를 열면 목차가 표시돼요.</p>';
    $("word-count").textContent = ""; $("reading-time").textContent = ""; $("status-text").textContent = "문서를 선택해 주세요";
    document.title = "RDViewer — Markdown reader"; updateProgress();
  }
  async function switchProject(id, { path = "", hash = "", history = true, restore = true } = {}) {
    const navigation = ++state.navigation;
    ++state.request; ++state.treeRequest;
    saveScroll(); saveProjectSession();
    if (id !== "loose" && !state.projects.some((project) => project.id === id)) {
      try { await loadProjects(); } catch (error) { if (navigation === state.navigation) toast(error.message); return; }
      if (navigation !== state.navigation) return;
      if (!state.projects.some((project) => project.id === id)) { toast("이 프로젝트는 목록에서 제거되었어요."); id = "default"; path = ""; }
    }
    state.projectId = id; state.projectReady = true; state.projectPending = true;
    const selectedGroup = projectGroups().find((group) => group.projects.some((project) => project.id === id));
    if (selectedGroup) { groupFolders.set(selectedGroup.id, id); storage.set("group-folders", Object.fromEntries(groupFolders)); }
    state.tabs = (projectSessions[id]?.tabs || []).filter((item) => typeof item === "string" && ownerOf(item) === id);
    state.files = []; state.treeLoaded = false; state.source = false;
    $("file-search").value = ""; emptyReader("프로젝트 문서를 찾고 있어요…"); renderTabs(); renderProjects();
    $("file-tree").innerHTML = '<p class="muted tree-message">문서를 찾고 있어요…</p>';
    updateTreeActions();
    storage.set("selected-project", id);
    if (history) window.history.pushState({}, "", projectURL(path, hash));
    const documentRequest = state.request;
    const success = await loadTree(false, navigation);
    if (navigation !== state.navigation) return;
    state.projectPending = false;
    if (documentRequest !== state.request) return;
    const savedPath = restore ? projectSessions[id]?.path : "";
    const next = path || (savedPath && ownerOf(savedPath) === id && state.files.some((file) => file.path === savedPath) ? savedPath : "") || (restore && success ? (state.files.find((file) => /^readme\.md$/i.test(displayPath(file.path)))?.path || state.files[0]?.path) : "");
    if (next) {
      window.history.replaceState({ path: next }, "", projectURL(next, hash));
      await openDocument(next, { hash, history: false });
    } else if (success) {
      emptyReader(id === "loose" ? "문서 열기에서 파일을 선택하거나 경로를 붙여넣어 주세요." : "이 프로젝트에는 Markdown 문서가 없어요. 파일을 추가한 뒤 목록을 새로고침해 주세요.");
      window.history.replaceState({}, "", projectURL()); saveProjectSession();
    }
  }
  async function openDocument(path, { hash = "", history = true, reload = false } = {}) {
    if (ownerOf(path) !== state.projectId) return switchProject(ownerOf(path), { path, hash, history });
    if (path === state.path && state.loaded && !reload) { if (hash) jumpToHeading(hash); setSidebar(false); return; }
    saveScroll();
    const request = ++state.request;
    state.path = path;
    state.loaded = false;
    if (!state.tabs.includes(path)) state.tabs.push(path);
    renderTabs(); renderTree(); setSidebar(false);
    const parts = displayPath(path).split("/");
    $("breadcrumb").innerHTML = parts.map((part, index) => index === parts.length - 1 ? `<strong>${escape(part)}</strong>` : escape(part)).join('<span class="sep">/</span>');
    $("article").hidden = false;
    $("source-view").hidden = true;
    $("article").innerHTML = '<div class="empty-state"><span class="empty-icon">f.</span><p>문서를 펼치고 있어요…</p></div>';
    $("article").setAttribute("aria-busy", "true");
    $("document-end").hidden = true;
    $("outline-links").innerHTML = '<p class="muted">목차를 불러오는 중…</p>';
    $("status-text").textContent = "문서 불러오는 중";
    $("reading-time").textContent = "";
    $("word-count").textContent = "";
    state.headings = [];
    updateProgress();
    if (history) window.history.pushState({ path }, "", projectURL(path, hash));
    try {
      if (path.startsWith("선택한 파일/") && !localDocuments.has(path)) throw new Error("이 파일은 이전 탭에서만 보관되었어요. ‘문서 열기’에서 파일을 다시 선택해 주세요.");
      const data = localDocuments.get(path) || await fetchJSON(`/api/document?path=${encodeURIComponent(path)}`);
      if (request !== state.request) return;
      if (typeof data.content !== "string") throw new Error("문서 응답 형식이 올바르지 않아요.");
      state.content = data.content;
      renderDocument();
      state.loaded = true;
      document.title = `${filename(path)} — RDViewer`;
      saveProjectSession();
      if (!state.files.some((file) => file.path === path)) { state.files.push({ path, name: filename(path) }); renderTree(); }
      $("file-count").textContent = `${state.files.length.toLocaleString()}개의 Markdown 문서`;
      requestAnimationFrame(() => {
        if (request !== state.request) return;
        $("reading").scrollTo({ top: state.scrolls.get(`${path}:${state.source}`) || 0, behavior: "instant" });
        if (hash) jumpToHeading(hash);
        updateProgress();
      });
      announce(`${filename(path)} 문서를 열었어요.`);
    } catch (error) {
      if (request !== state.request) return;
      $("article").innerHTML = `<div class="empty-state"><span class="empty-icon">f.</span><h1>문서를 열 수 없어요</h1><p>${escape(error.message)}</p><button id="retry-document">다시 시도</button></div>`;
      $("retry-document").addEventListener("click", () => openDocument(path, { reload: true, history: false }));
      $("outline-links").innerHTML = '<p class="muted">문서를 열면 목차가 표시돼요.</p>';
      $("status-text").textContent = "문서 연결 실패";
      announce(error.message);
    } finally {
      if (request === state.request) $("article").removeAttribute("aria-busy");
    }
  }
  function closeTab(path) {
    const index = state.tabs.indexOf(path);
    if (index < 0) return;
    state.tabs.splice(index, 1);
    if (state.path === path) {
      saveScroll();
      if (state.tabs.length) { openDocument(state.tabs[Math.min(index, state.tabs.length - 1)]); return; }
      state.request++;
      state.path = ""; state.content = ""; state.loaded = false; state.headings = [];
      $("article").hidden = false; $("source-view").hidden = true; $("document-meta").hidden = true; $("document-end").hidden = true;
      $("article").innerHTML = '<div class="empty-state"><span class="empty-icon">f.</span><h1>다음 문장을 만나 보세요</h1><p>탐색기에서 읽고 싶은 문서를 골라 주세요.</p><button id="choose-document">문서 찾아보기</button></div>';
      $("choose-document").addEventListener("click", focusSearch);
      $("breadcrumb").textContent = "문서 선택";
      $("outline-links").innerHTML = '<p class="muted">문서를 열면 목차가 표시돼요.</p>';
      $("word-count").textContent = ""; $("status-text").textContent = "문서를 선택해 주세요";
      document.title = "RDViewer — Markdown reader";
      window.history.pushState({}, "", projectURL());
      updateProgress();
    }
    saveProjectSession(); renderTabs(); renderTree();
  }
  function setSource(source) {
    if (!state.loaded) return;
    saveScroll();
    state.source = source;
    $("article").hidden = source; $("source-view").hidden = !source;
    $("preview-mode").classList.toggle("active", !source); $("source-mode").classList.toggle("active", source);
    $("preview-mode").setAttribute("aria-pressed", String(!source)); $("source-mode").setAttribute("aria-pressed", String(source));
    $("reading").scrollTo({ top: state.scrolls.get(`${state.path}:${source}`) || 0, behavior: "instant" });
    updateProgress();
  }
  async function loadTree(notify = true, navigation = state.navigation) {
    const request = ++state.treeRequest;
    const projectId = state.projectId;
    $("refresh-tree").disabled = true;
    try {
      const data = await fetchJSON(`/api/tree?project=${encodeURIComponent(projectId)}`);
      if (request !== state.treeRequest || navigation !== state.navigation) return false;
      if (!Array.isArray(data.files)) throw new Error("문서 목록 형식이 올바르지 않아요.");
      state.files = [...data.files.filter((file) => typeof file.path === "string" && ownerOf(file.path) === projectId), ...(projectId === "loose" ? [...localDocuments].map(([path, doc]) => ({ path, name: doc.name })) : [])];
      state.rootName = data.rootName || "내 문서"; state.treeLoaded = true;
      const project = state.projects.find((item) => item.id === projectId);
      $("root-name").textContent = project?.path || "프로젝트 밖에서 연 문서";
      $("root-name").title = $("root-name").textContent;
      $("file-count").textContent = `${state.files.length.toLocaleString()}${data.truncated ? "+" : ""}개의 Markdown 문서`;
      renderTree();
      if (notify) toast("문서 목록을 새로고침했어요.");
      return true;
    } catch (error) {
      if (request !== state.treeRequest || navigation !== state.navigation) return false;
      $("root-name").textContent = "폴더 연결을 확인해 주세요";
      $("file-tree").innerHTML = `<p class="muted tree-message">${escape(error.message)}<br>새로고침으로 다시 시도해 주세요.</p>`;
      updateTreeActions();
      $("file-count").textContent = "문서 목록 연결 실패";
      if (!state.path) emptyReader(error.message);
      else toast(error.message);
      return false;
    } finally { if (request === state.treeRequest) $("refresh-tree").disabled = false; }
  }
  function focusSearch() {
    if ($("app").classList.contains("focus")) { $("app").classList.remove("focus"); $("focus-mode").setAttribute("aria-pressed", "false"); }
    if (window.matchMedia("(max-width: 700px)").matches) setSidebar(true);
    $("file-search").focus(); $("file-search").select();
  }
  $("file-search").addEventListener("input", renderTree);
  $("expand-all-folders").addEventListener("click", () => setAllFolders(true));
  $("collapse-all-folders").addEventListener("click", () => setAllFolders(false));
  $("file-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { const first = $("file-tree").querySelector("[data-path]"); if (first) openDocument(first.dataset.path); }
    if (event.key === "ArrowDown") { event.preventDefault(); $("file-tree").querySelector("[data-path],summary")?.focus(); }
  });
  $("file-tree").addEventListener("click", (event) => { const button = event.target.closest("[data-path]"); if (button) openDocument(button.dataset.path); });
  $("tabs").addEventListener("click", (event) => {
    const close = event.target.closest("[data-close]");
    if (close) closeTab(close.dataset.close);
    else { const open = event.target.closest("[data-path]"); if (open) openDocument(open.dataset.path); }
  });
  $("article").addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    if (link.dataset.localReference) { event.preventDefault(); toast("파일 경로로 열면 상대 문서 링크를 이용할 수 있어요."); }
    else if (link.dataset.document) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); openDocument(link.dataset.document, { hash: link.dataset.documentHash || "" });
    } else if (link.dataset.anchor) { event.preventDefault(); jumpToHeading(link.dataset.anchor); }
  });
  $("outline-links").addEventListener("click", (event) => {
    const link = event.target.closest("[data-heading]");
    if (link) { event.preventDefault(); jumpToHeading(link.dataset.heading); }
  });
  $("reading").addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = null; updateProgress(); });
  }, { passive: true });
  window.addEventListener("resize", updateProgress);
  $("preview-mode").addEventListener("click", () => setSource(false));
  $("source-mode").addEventListener("click", () => setSource(true));
  $("refresh-tree").addEventListener("click", () => loadTree());
  $("reload-document").addEventListener("click", () => { if (state.path) openDocument(state.path, { reload: true, history: false }); });
  $("toggle-sidebar").addEventListener("click", () => {
    if (window.matchMedia("(max-width: 700px)").matches) setSidebar(!$("app").classList.contains("sidebar-open"));
    else { $("app").classList.remove("focus"); $("focus-mode").setAttribute("aria-pressed", "false"); }
  });
  $("close-sidebar").addEventListener("click", () => { setSidebar(false); $("toggle-sidebar").focus(); });
  $("sidebar-backdrop").addEventListener("click", () => { setSidebar(false); $("toggle-sidebar").focus(); });
  $("toggle-settings").addEventListener("click", () => {
    $("reading-settings").hidden = !$("reading-settings").hidden;
    $("toggle-settings").setAttribute("aria-expanded", String(!$("reading-settings").hidden));
    if (!$("reading-settings").hidden) $("font-size").focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#reading-settings,#toggle-settings")) { $("reading-settings").hidden = true; $("toggle-settings").setAttribute("aria-expanded", "false"); }
  });
  $("font-size").addEventListener("input", (event) => { settings.fontSize = Number(event.target.value); applySettings(); updateProgress(); });
  $("reading-width").addEventListener("change", (event) => { settings.width = Number(event.target.value); applySettings(); updateProgress(); });
  $("theme").addEventListener("change", (event) => { settings.theme = event.target.value; applySettings(); });
  function editColor(key, value) {
    if (!validColor(value)) return;
    const resolved = settings.theme === "system" ? (mediaTheme.matches ? "dark" : "light") : settings.theme;
    if (resolved !== "custom") settings.custom = Object.fromEntries(Object.keys(palettes.light).map((name) => [name, palettes[resolved][name]]));
    settings.custom[key] = value.toLowerCase(); settings.theme = "custom"; applySettings();
  }
  for (const key of Object.keys(palettes.light)) {
    $(`color-${key}`).addEventListener("input", (event) => editColor(key, event.target.value));
    $(`hex-${key}`).addEventListener("input", (event) => {
      const value = event.target.value.trim();
      const valid = validColor(value);
      event.target.setAttribute("aria-invalid", String(!valid));
      event.target.setCustomValidity(valid ? "" : "#과 6자리 색상 코드를 입력해 주세요. 예: #f4ead7");
      if (valid) editColor(key, value);
    });
  }
  $("reset-colors").addEventListener("click", () => { settings.theme = "light"; settings.custom = { ...palettes.light }; applySettings(); toast("색상을 기본 라이트 테마로 되돌렸어요."); });
  $("theme").addEventListener("change", () => { if (settings.theme === "custom") $("color-editor").open = true; });
  async function postProject(url, input) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Folio-Request": "1" }, body: JSON.stringify({ input }) });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "프로젝트를 변경하지 못했어요.");
    return data;
  }
  let projectOpener;
  function setProjectMenu(open, focus = false) {
    $("project-menu").hidden = !open;
    $("toggle-project-menu").setAttribute("aria-expanded", String(open));
    if (focus) (open ? $("add-project") : $("toggle-project-menu")).focus();
  }
  $("toggle-project-menu").addEventListener("click", () => setProjectMenu($("project-menu").hidden, true));
  document.addEventListener("click", (event) => {
    if (!$("project-menu-anchor").contains(event.target)) setProjectMenu(false);
  });
  $("project-menu-anchor").addEventListener("focusout", (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setProjectMenu(false);
  });
  function closeProjectMenu() {
    if (!$("project-menu").hidden) setProjectMenu(false, true);
  }
  function projectError(message) { $("project-error").textContent = message; $("project-error").hidden = false; }
  function showProjectDialog(focusPath = true) {
    closeProjectMenu();
    projectOpener = document.activeElement;
    setSidebar(false); $("project-error").hidden = true;
    $("project-dialog").showModal();
    if (focusPath) $("project-path").focus();
    else $("close-project-dialog").focus();
    loadProjects().catch((error) => projectError(error.message));
  }
  let pickerOpener;
  function showProjectPicker({ refresh = true } = {}) {
    if ($("project-picker").open || $("project-dialog").open || $("open-dialog").open) return;
    closeProjectMenu();
    pickerOpener = document.activeElement === document.body ? $("toggle-project-menu") : document.activeElement;
    setSidebar(false);
    $("project-picker-search").value = "";
    $("project-picker-error").hidden = true;
    renderProjectPicker();
    $("project-picker").showModal();
    $("project-picker-search").focus();
    if (refresh) loadProjects().catch((error) => { $("project-picker-error").textContent = error.message; $("project-picker-error").hidden = false; });
  }
  $("browse-projects").addEventListener("click", () => showProjectPicker());
  $("sidebar-projects").addEventListener("click", (event) => {
    const expand = event.target.closest("[data-expand-group]");
    if (expand) {
      const id = expand.dataset.expandGroup;
      if (expandedProjectGroups.has(id)) expandedProjectGroups.delete(id);
      else expandedProjectGroups.add(id);
      renderSidebarProjects();
      $("sidebar-projects").querySelectorAll("[data-expand-group]").forEach((button) => {
        if (button.dataset.expandGroup === id) button.focus();
      });
      return;
    }
    const folder = event.target.closest("[data-open-project]");
    const groupButton = event.target.closest("[data-open-group]");
    const group = groupButton && projectGroups().find((item) => item.id === groupButton.dataset.openGroup);
    const id = folder?.dataset.openProject || (group && (group.projects.find((project) => project.id === groupFolders.get(group.id)) || group.projects[0]).id);
    if (id && id !== state.projectId) switchProject(id);
  });
  $("close-project-picker").addEventListener("click", () => $("project-picker").close());
  $("project-picker").addEventListener("close", () => { if (pickerOpener?.isConnected && pickerOpener.getClientRects().length) pickerOpener.focus(); else $("toggle-sidebar").focus(); });
  $("project-picker-search").addEventListener("input", renderProjectPicker);
  $("project-cards").addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-project]");
    if (!button) return;
    $("project-picker").close();
    switchProject(button.dataset.selectProject);
  });
  $("add-project").addEventListener("click", () => showProjectDialog());
  $("manage-projects").addEventListener("click", () => showProjectDialog(false));
  $("close-project-dialog").addEventListener("click", () => $("project-dialog").close());
  $("project-dialog").addEventListener("close", () => { if (projectOpener?.isConnected && projectOpener.getClientRects().length) projectOpener.focus(); else $("toggle-sidebar").focus(); });
  $("project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("project-path").value.trim(); if (!input) return;
    $("submit-project").disabled = true; $("project-error").hidden = true;
    try {
      const data = await postProject("/api/projects", input);
      if (!data.project?.id) throw new Error("프로젝트 응답이 올바르지 않아요.");
      await loadProjects(); $("project-dialog").close(); $("project-path").value = "";
      await switchProject(data.project.id); toast(`${data.project.name} 프로젝트를 열었어요.`);
    } catch (error) { projectError(error.message); }
    finally { $("submit-project").disabled = false; }
  });
  $("project-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-project]"); if (!button) return;
    const id = button.dataset.removeProject; button.disabled = true; $("project-error").hidden = true;
    try {
      await postProject("/api/projects/remove", id);
      delete projectSessions[id];
      await loadProjects();
      if (state.projectId === id) { await switchProject("default"); delete projectSessions[id]; }
      saveProjectSession();
      $("close-project-dialog").focus();
      toast("프로젝트 목록에서 뺐어요. 폴더와 파일은 그대로예요.");
    } catch (error) { projectError(error.message); button.disabled = false; }
  });
  let dialogOpener;
  function showOpenDialog() {
    if ($("open-dialog").open || $("project-dialog").open || $("project-picker").open) return;
    dialogOpener = document.activeElement;
    setSidebar(false);
    $("reading-settings").hidden = true; $("toggle-settings").setAttribute("aria-expanded", "false");
    $("open-error").hidden = true;
    $("open-dialog").showModal();
    $("open-path").focus();
  }
  function showOpenError(message) { $("open-error").textContent = message; $("open-error").hidden = false; }
  $("open-document").addEventListener("click", showOpenDialog);
  $("close-open-dialog").addEventListener("click", () => $("open-dialog").close());
  $("open-dialog").addEventListener("close", () => { (dialogOpener?.isConnected && dialogOpener.getClientRects().length ? dialogOpener : $("open-document")).focus(); });
  $("open-path-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("open-path").value.trim();
    if (!input) return;
    $("submit-open-path").disabled = true; $("open-error").hidden = true;
    try {
      const response = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json", "X-Folio-Request": "1" }, body: JSON.stringify({ input }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "문서를 열지 못했어요.");
      if (typeof data.path !== "string") throw new Error("문서 경로 응답이 올바르지 않아요.");
      $("open-dialog").close(); $("open-path").value = "";
      await openDocument(data.path);
    } catch (error) { showOpenError(error.message); }
    finally { $("submit-open-path").disabled = false; }
  });
  async function importFiles(files) {
    const errors = []; let opened = 0;
    for (const file of files) {
      if (!/\.(md|markdown|mdown)$/i.test(file.name)) { errors.push(`${file.name}: Markdown 파일을 선택해 주세요.`); continue; }
      if (file.size > 5 * 1024 * 1024) { errors.push(`${file.name}: 최대 5MB까지 열 수 있어요.`); continue; }
      try {
        const content = await file.text();
        const path = `선택한 파일/${crypto.randomUUID()}/${file.name}`;
        localDocuments.set(path, { content, name: file.name });
        if (state.projectId === "loose") state.files.push({ path, name: file.name });
        await openDocument(path); opened++;
      } catch { errors.push(`${file.name}: 파일을 읽지 못했어요.`); }
    }
    $("file-picker").value = "";
    if (errors.length) { if (!$("open-dialog").open) showOpenDialog(); showOpenError(errors.join("\n")); }
    else if (opened) { $("open-dialog").close(); toast(`${opened}개 문서를 이 탭에 열었어요.`); }
    $("file-count").textContent = `${state.files.length.toLocaleString()}개의 Markdown 문서`;
  }
  $("choose-files").addEventListener("click", () => $("file-picker").click());
  $("file-picker").addEventListener("change", (event) => importFiles([...event.target.files]));
  let dragDepth = 0;
  const isFileDrag = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
  document.addEventListener("dragenter", (event) => { if (isFileDrag(event)) { event.preventDefault(); dragDepth++; $("drop-overlay").hidden = false; $("drop-zone").classList.add("dragging"); } });
  document.addEventListener("dragover", (event) => { if (isFileDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } });
  document.addEventListener("dragleave", (event) => { if (isFileDrag(event) && --dragDepth <= 0) { dragDepth = 0; $("drop-overlay").hidden = true; $("drop-zone").classList.remove("dragging"); } });
  document.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault(); dragDepth = 0; $("drop-overlay").hidden = true; $("drop-zone").classList.remove("dragging");
    importFiles([...event.dataTransfer.files]);
  });
  $("focus-mode").addEventListener("click", () => {
    const focused = $("app").classList.toggle("focus");
    $("focus-mode").setAttribute("aria-pressed", String(focused));
    $("focus-mode").title = focused ? "집중 모드 종료" : "집중 모드";
    setSidebar(false); updateProgress();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o" && !event.shiftKey && !event.altKey) { event.preventDefault(); showOpenDialog(); return; }
    if ($("open-dialog").open || $("project-dialog").open || $("project-picker").open) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p" && !event.shiftKey && !event.altKey) { event.preventDefault(); focusSearch(); }
    if (event.key === "Escape") {
      if (!$("project-menu").hidden) { setProjectMenu(false, true); return; }
      const settingsOpen = !$("reading-settings").hidden;
      $("reading-settings").hidden = true; $("toggle-settings").setAttribute("aria-expanded", "false");
      if (settingsOpen) $("toggle-settings").focus();
      else if ($("app").classList.contains("sidebar-open")) { setSidebar(false); $("toggle-sidebar").focus(); }
      else if ($("file-search") === document.activeElement) { $("file-search").value = ""; renderTree(); }
    }
    if (event.key === "Tab" && $("app").classList.contains("sidebar-open") && window.matchMedia("(max-width: 700px)").matches) {
      const items = [...$("sidebar").querySelectorAll('a,button:not([disabled]),input,select,summary')].filter((el) => el.getClientRects().length);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  });
  async function navigateFromURL(initial = false) {
    const params = new URLSearchParams(window.location.search);
    const path = params.get("doc") || "";
    const id = path ? ownerOf(path) : params.get("project") || (initial ? storage.get("selected-project") : null) || "default";
    await switchProject(id, { path, hash: window.location.hash.slice(1), history: false });
  }
  window.addEventListener("popstate", () => navigateFromURL());
  if (!/Mac|iPhone|iPad/.test(navigator.platform)) $("search-shortcut").textContent = "Ctrl P";
  if (/Win/.test(navigator.platform)) {
    $("open-path").placeholder = "C:\\Work\\문서.md 또는 [문서](경로)";
    $("project-path").placeholder = "C:\\Work\\프로젝트 폴더";
  }
  async function initialize() {
    try {
      await loadProjects(); await navigateFromURL(true);
    }
    catch (error) { emptyReader(error.message); $("file-tree").innerHTML = '<p class="muted tree-message">프로젝트에 연결하지 못했어요.<br><button id="retry-projects" class="secondary-button">다시 연결</button></p>'; $("retry-projects").addEventListener("click", initialize); }
  }
  initialize();
})();
