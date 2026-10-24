/* RDViewer is a read-only client. All document content is treated as untrusted. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const icons = {
    folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2"/>',
    expandAll: '<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 3H5a2 2 0 0 0-2 2v12M10 14h8M14 10v8"/>',
    collapseAll: '<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 3H5a2 2 0 0 0-2 2v12M10 14h8"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    book: '<path d="M12 5v15M3 5c4-2 6-1 9 1 3-2 5-3 9-1v14c-4-2-6-1-9 1-3-2-5-3-9-1V5Z"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
    settings: '<path d="m9 3-.6 2.2-1.5.9-2.2-.6L3 8.5l1.6 1.6v1.8L3 13.5l1.7 3 2.2-.6 1.5.9L9 19h3l.6-2.2 1.5-.9 2.2.6 1.7-3-1.6-1.6v-1.8L18 8.5l-1.7-3-2.2.6-1.5-.9L12 3Z" transform="translate(1.5 1)"/><circle cx="12" cy="12" r="3"/>',
    document: '<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    video: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4Z"/>',
    html: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20m-14 4-3 3 3 3m8-6 3 3-3 3"/>',
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
    showOutline: saved.showOutline !== false,
    theme: [...Object.keys(palettes), "system", "custom"].includes(savedTheme) ? savedTheme : "light",
    custom: Object.fromEntries(Object.keys(palettes.light).map((key) => [key, validColor(saved.custom?.[key]) ? saved.custom[key] : palettes.light[key]])),
  };
  const localDocuments = new Map();
  const fileKind = (path) => /\.html?$/i.test(path) ? "html" : /\.png$/i.test(path) ? "image" : /\.mp4$/i.test(path) ? "video" : "markdown";
  const supportedFile = (path) => /\.(md|markdown|mdown|png|mp4|html|htm)$/i.test(path);
  const fileTypes = ["md", "png", "mp4", "html"];
  const fileTypeLabels = { md: "MD", png: "PNG", mp4: "MP4", html: "HTML" };
  const storedFileTypes = storage.get("file-types");
  const selectedFileTypes = new Set(Array.isArray(storedFileTypes) && (!storedFileTypes.length || storedFileTypes.some((type) => fileTypes.includes(type))) ? storedFileTypes.filter((type) => fileTypes.includes(type)) : fileTypes);
  const fileType = (path) => ({ markdown: "md", image: "png", video: "mp4", html: "html" })[fileKind(path)];
  const matchesFileType = (file) => supportedFile(file.path) && selectedFileTypes.has(fileType(file.path));
  const fileTypeQuery = () => fileTypes.filter((type) => selectedFileTypes.has(type)).join(",");
  function renderFileTypeFilter() {
    const selected = fileTypes.filter((type) => selectedFileTypes.has(type));
    $("file-type-label").textContent = selected.length === 4 ? "전체" : selected.length === 0 ? "형식 선택" : selected.length <= 2 ? selected.map((type) => fileTypeLabels[type]).join(" · ") : `형식 ${selected.length}개`;
    $("toggle-file-types").dataset.active = String(selected.length !== 4);
    $("toggle-file-types").setAttribute("aria-label", `파일 형식 필터: ${selected.length ? selected.map((type) => fileTypeLabels[type]).join(", ") : "선택 없음"}`);
    for (const input of $("file-type-options").querySelectorAll("input[data-file-type]")) input.checked = selectedFileTypes.has(input.dataset.fileType);
  }
  function setFileTypePopover(open, restoreFocus = false) {
    $("file-type-options").hidden = !open;
    $("toggle-file-types").setAttribute("aria-expanded", String(open));
    if (open) $("file-type-options").querySelector("input")?.focus();
    else if (restoreFocus) $("toggle-file-types").focus();
  }
  function changeFileTypes(types) {
    selectedFileTypes.clear();
    for (const type of types) if (fileTypes.includes(type)) selectedFileTypes.add(type);
    storage.set("file-types", fileTypes.filter((type) => selectedFileTypes.has(type)));
    renderFileTypeFilter(); scheduleFolderSearch();
  }
  $("toggle-file-types").addEventListener("click", () => setFileTypePopover($("file-type-options").hidden));
  $("file-type-options").addEventListener("change", (event) => {
    const input = event.target.closest("input[data-file-type]");
    if (!input) return;
    const types = new Set(selectedFileTypes);
    if (input.checked) types.add(input.dataset.fileType); else types.delete(input.dataset.fileType);
    changeFileTypes(types);
  });
  $("file-types-all").addEventListener("click", () => changeFileTypes(fileTypes));
  $("file-types-md").addEventListener("click", () => changeFileTypes(["md"]));
  $("file-type-filter").addEventListener("focusout", (event) => { if (event.relatedTarget && !$("file-type-filter").contains(event.relatedTarget)) setFileTypePopover(false); });
  document.addEventListener("click", (event) => { if (!event.target.closest("#file-type-filter")) setFileTypePopover(false); });
  renderFileTypeFilter();
  const kindLabel = (kind) => kind === "image" ? "PNG 이미지" : kind === "video" ? "MP4 동영상" : kind === "html" ? "HTML 미리보기" : "Markdown";
  const fileGlyph = (path) => fileKind(path) === "markdown" ? '<span class="file-glyph" aria-hidden="true">M↓</span>' : `<span class="file-glyph media-glyph" aria-hidden="true">${icon(fileKind(path))}</span>`;
  const htmlPreview = { path: "", data: null, native: false, opening: false, frame: null, timer: 0, generation: 0, status: null, busy: false, error: "", artifact: null, autoNativeAttempted: false };
  let previewCommands = Promise.resolve();
  let previewStatusRequest = false;
  let recordingActive = false;
  function previewRequest(endpoint, body) {
    const task = previewCommands.then(() => fetchJSON(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Folio-Request": "1" }, body: JSON.stringify(body),
    }));
    previewCommands = task.catch(() => {});
    return task;
  }
  function disposeHTML({ unloading = false } = {}) {
    const close = htmlPreview.native || htmlPreview.opening;
    htmlPreview.generation++;
    htmlPreview.path = ""; htmlPreview.data = null; htmlPreview.native = false; htmlPreview.opening = false; htmlPreview.busy = false; htmlPreview.error = ""; htmlPreview.status = null; htmlPreview.autoNativeAttempted = false;
    clearTimeout(htmlPreview.timer); htmlPreview.timer = 0;
    if (htmlPreview.frame) { htmlPreview.frame.removeAttribute("src"); htmlPreview.frame.remove(); htmlPreview.frame = null; }
    $("html-view").replaceChildren(); $("html-view").hidden = true;
    if (close) {
      const body = { action: "close", args: {} };
      const task = unloading ? fetch("/api/preview/action", { method: "POST", headers: { "Content-Type": "application/json", "X-Folio-Request": "1" }, body: JSON.stringify(body), keepalive: true }) : previewRequest("/api/preview/action", body);
      void task.then(() => { recordingActive = false; $("preview-recording").hidden = true; }).catch(() => {});
    }
  }
  function previewURL(value) {
    const url = new URL(value, location.href);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin === location.origin || url.username || url.password) throw new Error("미리보기 주소를 확인할 수 없어요.");
    return url.href;
  }
  function applyPreviewStatus(status) {
    htmlPreview.status = status;
    const recording = status.recording || {};
    recordingActive = recording.active === true;
    if (typeof recording.path === "string" && !recordingActive) htmlPreview.artifact = recording;
    const seconds = recordingActive && Number.isFinite(recording.startedAt) ? Math.max(0, Math.floor((Date.now() - recording.startedAt) / 1000)) : 0;
    $("preview-recording").hidden = !recordingActive;
    $("preview-recording").textContent = recordingActive ? `● 녹화 중 ${seconds}초` : "";
    if (!htmlPreview.path || !$("html-preview-status")) return;
    const connected = status.connected === true;
    const open = htmlPreview.native && status.state?.previewOpen !== false;
    $("html-preview-status").textContent = htmlPreview.error || (recordingActive ? `미리보기 화면을 녹화하고 있어요 · ${seconds}초` : open ? "별도 미리보기 창에서 확인하고 있어요." : htmlPreview.frame ? "이 화면에서 HTML을 확인하고 있어요. 녹화와 AI 조작은 앱에서 사용할 수 있어요." : "미리보기를 열어 화면을 확인하세요.");
    $("html-preview-status").dataset.error = String(Boolean(htmlPreview.error));
    $("html-preview-open").textContent = open ? "미리보기 다시 열기" : "미리보기 열기";
    for (const id of ["html-preview-open", "html-preview-close", "html-preview-capture", "html-preview-record", "html-preview-stop", "html-preview-duration"]) $(id).disabled = htmlPreview.busy;
    $("html-preview-close").disabled ||= !open && !htmlPreview.frame;
    $("html-preview-capture").disabled ||= !connected || !open || recordingActive;
    $("html-preview-record").disabled ||= !connected || !open || recordingActive;
    $("html-preview-stop").disabled ||= !connected || !recordingActive;
    $("html-preview-duration").disabled ||= recordingActive;
    $("html-preview-record").hidden = recordingActive;
    $("html-preview-stop").hidden = !recordingActive;
    const artifact = htmlPreview.artifact;
    $("html-preview-artifact").hidden = !artifact?.path;
    $("html-preview-artifact-path").textContent = artifact?.path || "";
  }
  function schedulePreviewStatus() {
    clearTimeout(htmlPreview.timer); htmlPreview.timer = 0;
    if (document.visibilityState !== "visible" || !htmlPreview.path && !recordingActive) return;
    htmlPreview.timer = setTimeout(() => { void readPreviewStatus(); }, 2000);
  }
  async function readPreviewStatus() {
    if (previewStatusRequest || document.visibilityState !== "visible" || !htmlPreview.path && !recordingActive) return;
    previewStatusRequest = true;
    try {
      const status = await fetchJSON("/api/preview/status");
      applyPreviewStatus(status);
      // Native startup can finish just after the reader restores its HTML tab.
      // Replace the temporary browser frame once, rather than keeping two views.
      if (desktop && status.connected && htmlPreview.frame && htmlPreview.data && !htmlPreview.native && !htmlPreview.opening && !htmlPreview.busy && !htmlPreview.autoNativeAttempted) {
        htmlPreview.autoNativeAttempted = true; htmlPreview.busy = true;
        try { await openHTMLPreview(htmlPreview.data, state.request); }
        catch (error) { htmlPreview.opening = false; htmlPreview.error = error.message; }
        finally { htmlPreview.busy = false; applyPreviewStatus(htmlPreview.status || {}); }
      }
    }
    catch { if (htmlPreview.path) applyPreviewStatus({ connected: false, state: { previewOpen: false }, recording: { active: recordingActive } }); }
    finally { previewStatusRequest = false; schedulePreviewStatus(); }
  }
  document.addEventListener("visibilitychange", () => { clearTimeout(htmlPreview.timer); if (document.visibilityState === "visible") void readPreviewStatus(); });
  async function previewAction(action, args = {}) {
    if (htmlPreview.busy) return;
    htmlPreview.busy = true; htmlPreview.error = ""; applyPreviewStatus(htmlPreview.status || {});
    try {
      const response = await previewRequest("/api/preview/action", { action, args });
      const result = response.result || response;
      const artifact = result.recording?.path ? result.recording : result.path ? result : null;
      if (artifact) htmlPreview.artifact = artifact;
      if (action === "close") { htmlPreview.native = false; if (htmlPreview.frame) { htmlPreview.frame.remove(); htmlPreview.frame = null; } }
      if (action === "record.start") { recordingActive = true; applyPreviewStatus({ ...(htmlPreview.status || {}), recording: { active: true, startedAt: Date.now() } }); }
      if (action === "record.stop") recordingActive = false;
      await readPreviewStatus();
    } catch (error) { htmlPreview.error = error.message; }
    finally { htmlPreview.busy = false; applyPreviewStatus(htmlPreview.status || {}); }
  }
  async function openHTMLPreview(data, request) {
    const generation = htmlPreview.generation;
    htmlPreview.opening = true; htmlPreview.error = "";
    if (htmlPreview.frame) { htmlPreview.frame.remove(); htmlPreview.frame = null; }
    const response = await previewRequest("/api/preview/open", { input: data.fsPath || data.path || state.path });
    if (request !== state.request || generation !== htmlPreview.generation) return;
    htmlPreview.opening = false; htmlPreview.native = response.native === true;
    if (!htmlPreview.native) {
      const frame = document.createElement("iframe");
      frame.className = "html-preview-frame"; frame.title = `${filename(state.path)} HTML 미리보기`;
      // The preview is on a separate, server-managed origin. Keeping its own
      // origin enables modules and fetch without granting access to the reader.
      frame.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin");
      frame.referrerPolicy = "no-referrer"; frame.src = previewURL(response.previewURL || data.previewURL);
      htmlPreview.frame = frame; $("html-preview-canvas").append(frame);
    }
    applyPreviewStatus({ connected: htmlPreview.native, state: { previewOpen: htmlPreview.native }, recording: { active: false } });
    void readPreviewStatus();
  }
  async function renderHTML(data, request) {
    htmlPreview.path = state.path; htmlPreview.data = data; htmlPreview.artifact = null; htmlPreview.autoNativeAttempted = false;
    $("article").hidden = true; $("source-view").hidden = true; $("document-meta").hidden = false; $("document-end").hidden = true;
    $("reading-time").textContent = ""; $("word-count").textContent = Number.isFinite(data.size) ? formatSize(data.size) : "";
    $("status-text").textContent = "HTML 미리보기";
    $("html-view").hidden = false;
    $("html-view").innerHTML = `<div class="html-preview-heading"><div><span class="html-preview-label">${icon("html")} HTML</span><h1>${escape(filename(state.path))}</h1><p id="html-preview-status" role="status">미리보기를 여는 중이에요…</p></div><div class="html-preview-actions"><button id="html-preview-open" class="secondary-button">미리보기 열기</button><button id="html-preview-close" class="secondary-button">미리보기 닫기</button></div></div><div id="html-preview-tools" class="html-preview-tools"><button id="html-preview-capture" class="secondary-button">화면 캡처</button><label for="html-preview-duration">녹화 길이</label><select id="html-preview-duration"><option value="10">10초</option><option value="30">30초</option><option value="60">1분</option></select><button id="html-preview-record" class="primary-button">녹화 시작</button><button id="html-preview-stop" class="primary-button" hidden>녹화 끝내기</button></div><div id="html-preview-canvas" class="html-preview-canvas"></div><div id="html-preview-artifact" class="html-preview-artifact" hidden><span>최근 저장 결과</span><code id="html-preview-artifact-path"></code><button id="html-preview-result" class="secondary-button">결과 열기</button></div>`;
    $("html-preview-open").addEventListener("click", () => {
      if (htmlPreview.busy) return;
      htmlPreview.busy = true; applyPreviewStatus(htmlPreview.status || {});
      void openHTMLPreview(data, request).catch((error) => { htmlPreview.opening = false; htmlPreview.error = error.message; }).finally(() => { htmlPreview.busy = false; applyPreviewStatus(htmlPreview.status || {}); });
    });
    $("html-preview-close").addEventListener("click", () => {
      if (htmlPreview.frame) { htmlPreview.frame.remove(); htmlPreview.frame = null; applyPreviewStatus(htmlPreview.status || {}); }
      else void previewAction("close");
    });
    $("html-preview-capture").addEventListener("click", () => { void previewAction("screenshot"); });
    $("html-preview-record").addEventListener("click", () => { void previewAction("record.start", { seconds: Number($("html-preview-duration").value), fps: 10, width: 1280 }); });
    $("html-preview-stop").addEventListener("click", () => { void previewAction("record.stop"); });
    $("html-preview-result").addEventListener("click", () => {
      const path = htmlPreview.artifact?.path;
      if (path) void fetchJSON("/api/open", { method: "POST", headers: { "Content-Type": "application/json", "X-Folio-Request": "1" }, body: JSON.stringify({ input: path }) }).then((result) => openDocument(result.path)).catch((error) => toast(error.message));
    });
    if (localDocuments.has(state.path)) {
      htmlPreview.path = "";
      $("html-preview-capture").disabled = true; $("html-preview-record").disabled = true; $("html-preview-duration").disabled = true; $("html-preview-close").disabled = true;
      $("html-preview-stop").hidden = true; $("html-preview-open").textContent = "파일 경로로 열기";
      $("html-preview-open").replaceWith($("html-preview-open").cloneNode(true));
      $("html-preview-open").addEventListener("click", () => showOpenDialog());
      $("html-preview-status").textContent = "HTML과 연결된 CSS·이미지를 함께 보려면 파일 경로로 열어 주세요. 선택한 HTML은 이 화면에서 실행하지 않아요.";
      return;
    }
    htmlPreview.busy = true;
    applyPreviewStatus({ connected: false, state: { previewOpen: false } });
    try { await openHTMLPreview(data, request); }
    catch (error) { if (request === state.request) { htmlPreview.opening = false; htmlPreview.error = error.message; applyPreviewStatus({ connected: false, state: { previewOpen: false } }); } }
    finally { if (request === state.request) { htmlPreview.busy = false; applyPreviewStatus(htmlPreview.status || {}); } }
  }
  let activeMedia = null;
  let activeMediaURL = "";
  function disposeMedia(options = {}) {
    disposeHTML(options);
    const media = activeMedia; activeMedia = null;
    if (media) {
      media.onload = null; media.onerror = null;
      if (media.tagName === "VIDEO") { media.pause(); media.removeAttribute("src"); media.load(); }
      else media.removeAttribute("src");
      media.remove();
    }
    if (activeMediaURL) URL.revokeObjectURL(activeMediaURL);
    activeMediaURL = "";
    $("media-view").replaceChildren(); $("media-view").hidden = true;
  }
  window.addEventListener("pagehide", () => disposeMedia({ unloading: true }));
  window.addEventListener("pageshow", (event) => { if (event.persisted && state.path && state.kind !== "markdown") void openDocument(state.path, { reload: true, history: false }); });
  function setDocumentKind(kind = "markdown") {
    state.kind = kind;
    const media = kind !== "markdown";
    $("app").classList.toggle("viewing-media", media);
    document.querySelector(".view-switch").hidden = media;
    $("find-document").hidden = media;
    document.querySelector(".toolbar-divider").hidden = media;
    if (media) { $("document-find").hidden = true; $("find-document").setAttribute("aria-expanded", "false"); state.source = false; }
    document.querySelector(".document-kind").innerHTML = `${icon(media ? kind : "document")}${kind === "image" ? "PNG" : kind === "video" ? "MP4" : kind === "html" ? "HTML" : "MARKDOWN"}`;
    document.querySelector(".status-format").innerHTML = media ? kindLabel(kind) : 'Markdown <span>UTF-8</span>';
    $("source-code").textContent = "";
  }
  function renderMedia(data, request) {
    const kind = data.kind;
    const local = localDocuments.get(state.path);
    let source;
    if (local?.file) { activeMediaURL = URL.createObjectURL(local.file); source = activeMediaURL; }
    else {
      const url = new URL(data.mediaURL, location.href);
      if (url.origin !== location.origin || url.pathname !== "/api/media") throw new Error("미디어 파일 경로가 올바르지 않아요.");
      source = url.href;
    }
    const media = document.createElement(kind === "video" ? "video" : "img");
    activeMedia = media;
    media.className = kind === "video" ? "media-video" : "media-image";
    if (kind === "video") { media.controls = true; media.preload = "metadata"; media.playsInline = true; media.setAttribute("aria-label", filename(state.path)); }
    else { media.alt = filename(state.path); media.decoding = "async"; }
    const label = document.createElement("p"); label.className = "media-caption";
    label.textContent = `${filename(state.path)} · ${kindLabel(kind)}${Number.isFinite(data.size) ? ` · ${formatSize(data.size)}` : ""}`;
    const error = () => {
      if (request !== state.request || activeMedia !== media) return;
      disposeMedia(); state.loaded = false; renderRecent();
      $("article").hidden = false;
      $("article").innerHTML = `<div class="empty-state"><span class="empty-icon">${icon(kind)}</span><h1>${kind === "video" ? "동영상을 재생할 수 없어요" : "이미지를 열 수 없어요"}</h1><p>${kind === "video" ? "이 영상의 코덱을 지원하지 않거나 파일이 손상되었을 수 있어요. H.264 영상과 AAC 오디오로 저장한 MP4를 사용해 주세요." : "파일이 손상되었거나 PNG 형식이 아닌지 확인해 주세요."}</p><button id="retry-media">다시 시도</button></div>`;
      $("retry-media").addEventListener("click", () => openDocument(state.path, { reload: true, history: false }));
      $("status-text").textContent = "미디어 열기 실패";
      announce(kind === "video" ? "동영상을 재생할 수 없어요. 영상 코덱이나 파일을 확인해 주세요." : "이미지를 열 수 없어요.");
    };
    media.onerror = error;
    $("article").hidden = true; $("source-view").hidden = true;
    $("document-meta").hidden = false; $("document-end").hidden = true;
    $("reading-time").textContent = ""; $("word-count").textContent = Number.isFinite(data.size) ? formatSize(data.size) : "";
    $("status-text").textContent = local ? "선택한 파일 · 이 탭에서만 보관" : "로컬 파일 · 읽기 전용";
    $("media-view").hidden = false; $("media-view").append(media, label);
    media.src = source;
  }
  function formatSize(size) {
    return size >= 1024 * 1024 * 1024 ? `${(size / 1024 ** 3).toFixed(1)} GB` : size >= 1024 * 1024 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`;
  }
  const storedRecent = storage.get("recent-documents");
  const recentDocuments = (Array.isArray(storedRecent) ? storedRecent : []).filter((item) => item && typeof item.path === "string" && typeof item.name === "string").slice(0, 30).map((item) => ({
    path: item.path, name: item.name, fsPath: typeof item.fsPath === "string" ? item.fsPath : "", folder: typeof item.folder === "string" ? item.folder : "", ephemeral: Boolean(item.ephemeral), kind: fileKind(item.path),
  }));
  let recentExpanded = false;
  let recentCollapsed = storage.get("recent-collapsed") === true;
  let recentOpening = false;
  let currentDocumentData;
  const desktopBridge = window.rdviewerDesktop;
  if (desktopBridge?.platform === "win32" && desktopBridge.titleBarOverlay === true) {
    document.documentElement.dataset.desktopTitlebar = "windows";
    $("desktop-titlebar").hidden = false;
  }
  const storedSessions = storage.get("project-sessions");
  const projectSessions = Object.fromEntries(Object.entries(storedSessions && typeof storedSessions === "object" ? storedSessions : {}).filter(([, session]) => session && Array.isArray(session.tabs)).map(([id, session]) => [id, { tabs: session.tabs.filter((path) => typeof path === "string" && !path.startsWith("선택한 파일/")), path: typeof session.path === "string" ? session.path : "" }]));
  const storedGroupFolders = storage.get("group-folders");
  const groupFolders = new Map(Object.entries(storedGroupFolders && typeof storedGroupFolders === "object" ? storedGroupFolders : {}).filter(([, id]) => typeof id === "string"));
  const state = { projectReady: false, projectId: "default", projects: [], navigation: 0, treeRequest: 0, files: [], rootName: "", tabs: [], path: "", content: "", kind: "markdown", source: false, scrolls: new Map(), headings: [], request: 0, loaded: false, treeLoaded: false };
  const desktop = navigator.userAgent.includes("RDViewerDesktop");
  const folderSearch = { files: [], query: "", projectId: "", loading: false, error: "", truncated: false, sequence: 0, controller: null, timer: null };
  const documentFind = { matches: [], index: -1, truncated: false };
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
    if (desktopBridge?.platform === "win32" && desktopBridge.titleBarOverlay === true && typeof desktopBridge.setTitleBarTheme === "function") {
      try { Promise.resolve(desktopBridge.setTitleBarTheme({ background: tokens.sidebar, foreground: tokens["ui-text"] })).catch(() => {}); } catch { /* Theme remains usable if the desktop bridge is unavailable. */ }
    }
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
    $("show-outline").checked = settings.showOutline;
    $("app").classList.toggle("outline-hidden", !settings.showOutline);
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
    const snippet = searching && file.matchedContent ? `<span class="file-snippet">${file.line ? `${file.line}행 · ` : ""}${escape(file.snippet || "본문 일치")}</span>` : "";
    return `<button class="file-item${file.path === state.path ? " active" : ""}" style="--depth:${depth}" data-path="${escape(file.path)}" data-content-match="${Boolean(file.matchedContent)}" title="${escape(displayPath(file.path))}"${file.path === state.path ? ' aria-current="page"' : ""}>${fileGlyph(file.path)}<span class="file-details"><span class="file-name">${escape(file.name || filename(file.path))}</span>${searching && parent ? `<span class="file-parent">${escape(parent)}</span>` : ""}${snippet}</span></button>`;
  }
  // Every registered folder shares this explorer; reading a file never replaces its siblings.
  const treeCache = new Map();
  const treeOpen = new Set((storage.get("tree-open") || []).filter((key) => typeof key === "string"));
  const manuallyClosed = new Set();
  let folderContext = "";
  let suppressFolderAutoOpen = false;
  let expandSequence = 0;
  function rootKey(id) { return `root:${id}`; }
  function groupKey(id) { return `group:${id}`; }
  function directoryKey(id, path) { return `dir:${id}/${path}`; }
  function saveTreeOpen() { storage.set("tree-open", [...treeOpen]); }
  function projectFiles(id) {
    const files = treeCache.get(id)?.files || [];
    return id === "loose" ? [...files.filter((file) => !localDocuments.has(file.path)), ...[...localDocuments].map(([path, doc]) => ({ path, name: doc.name, kind: doc.kind }))] : files;
  }
  async function mapFolders(ids, callback) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
      while (next < ids.length) { const id = ids[next++]; await callback(id); }
    }));
  }
  let activeTreeReads = 0;
  const pendingTreeReads = [];
  async function fetchTreeData(id) {
    if (activeTreeReads < 2) activeTreeReads++;
    else await new Promise((resolve) => pendingTreeReads.push(resolve));
    try { return await fetchJSON(`/api/tree?project=${encodeURIComponent(id)}`); }
    finally {
      const next = pendingTreeReads.shift();
      if (next) next(); else activeTreeReads--;
    }
  }
  async function ensureTree(id, refresh = false) {
    let entry = treeCache.get(id);
    if (entry?.promise) return entry.promise;
    if (entry?.loaded && !refresh) return true;
    if (!entry) { entry = { files: [], loaded: false, error: "", loading: false }; treeCache.set(id, entry); }
    entry.loading = true; entry.error = "";
    entry.promise = (async () => {
      try {
        const data = await fetchTreeData(id);
        if (!Array.isArray(data.files)) throw new Error("문서 목록 형식이 올바르지 않아요.");
        entry.files = data.files.filter((file) => typeof file.path === "string" && ownerOf(file.path) === id);
        entry.loaded = true; entry.rootName = data.rootName; entry.truncated = Boolean(data.truncated);
        return true;
      } catch (error) { entry.error = error.message; return false; }
      finally {
        entry.loading = false; entry.promise = null;
        if (state.projectId === id) { state.files = projectFiles(id); state.treeLoaded = entry.loaded; }
        renderTree();
      }
    })();
    renderTree();
    return entry.promise;
  }
  function updateTreeActions() {
    const empty = !state.projects.length;
    $("expand-all-folders").disabled = empty;
    $("collapse-all-folders").disabled = empty;
  }
  async function setAllFolders(open) {
    const sequence = ++expandSequence;
    suppressFolderAutoOpen = true;
    manuallyClosed.clear();
    if (!open) { treeOpen.clear(); saveTreeOpen(); renderTree(); announce("모든 폴더를 접었어요."); return; }
    for (const group of projectGroups().filter((group) => group.id !== "loose")) {
      if (group.projects.length > 1) treeOpen.add(groupKey(group.id));
      for (const project of group.projects) treeOpen.add(rootKey(project.id));
    }
    renderTree();
    await mapFolders(state.projects.map((project) => project.id), async (id) => {
      if (sequence !== expandSequence) return;
      await ensureTree(id);
      if (sequence !== expandSequence) return;
      for (const file of projectFiles(id).filter(matchesFileType)) {
        const parts = displayPath(file.path).split("/").slice(0, -1);
        parts.forEach((_, index) => treeOpen.add(directoryKey(id, parts.slice(0, index + 1).join("/"))));
      }
    });
    if (sequence !== expandSequence) return;
    saveTreeOpen(); renderTree(); announce("모든 폴더를 펼쳤어요.");
  }
  function renderTree() {
    const query = $("file-search").value.trim().toLocaleLowerCase();
    const context = `${query}\0${state.path || folderContext.split("\0")[1] || ""}\0${fileTypeQuery()}`;
    const changed = folderContext !== context;
    if (changed) { suppressFolderAutoOpen = false; manuallyClosed.clear(); folderContext = context; }
    const groups = projectGroups().filter((group) => group.id !== "loose");
    if (!suppressFolderAutoOpen && state.path && (changed || !treeCache.get(ownerOf(state.path))?.loaded)) {
      const id = ownerOf(state.path);
      if (id !== "loose") {
        treeOpen.add(rootKey(id));
        const group = groups.find((item) => item.projects.some((project) => project.id === id));
        if (group?.projects.length > 1) {
          const primary = group.projects.find((project) => project.name === group.name) || group.projects.find((project) => project.isDefault);
          treeOpen.add(primary ? rootKey(primary.id) : groupKey(group.id));
        }
        const parts = displayPath(state.path).split("/").slice(0, -1);
        parts.forEach((_, index) => treeOpen.add(directoryKey(id, parts.slice(0, index + 1).join("/"))));
      }
    }
    const candidates = query && folderSearch.query === query ? folderSearch.files : [...treeCache.keys()].flatMap(projectFiles);
    const filesFor = (id) => (query ? candidates.filter((file) => ownerOf(file.path) === id) : projectFiles(id)).filter(matchesFileType);
    const opened = (key, matching = false) => !manuallyClosed.has(key) && (treeOpen.has(key) || !suppressFolderAutoOpen && query && matching);
    function summary(name, depth, count, title = name) {
      return `<summary style="--depth:${depth}" title="${escape(title)}">${icon("chevron", "chevron")}${icon("folder")}<span class="folder-name">${escape(name)}</span>${count === undefined ? "" : `<span class="folder-count">${count}</span>`}</summary>`;
    }
    function renderFiles(id, files, depth) {
      const root = { folders: new Map(), files: [], count: 0 };
      for (const file of files) {
        let node = root; node.count++;
        for (const part of displayPath(file.path).split("/").slice(0, -1)) {
          if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [], count: 0 });
          node = node.folders.get(part); node.count++;
        }
        node.files.push(file);
      }
      function render(node, parent = "", level = depth) {
        return [...node.folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
          const path = parent ? `${parent}/${name}` : name;
          const key = directoryKey(id, path);
          return `<details class="folder" data-folder="${escape(key)}"${opened(key, child.count > 0) ? " open" : ""}>${summary(name, level, child.count)}${render(child, path, level + 1)}</details>`;
        }).join("") + node.files.map((file) => fileButton(file, level, Boolean(query))).join("");
      }
      return render(root);
    }
    function rootStatus(project, depth, files) {
      const entry = treeCache.get(project.id);
      return entry?.loading ? `<p class="muted tree-inline-message" style="--depth:${depth + 1}">문서를 불러오는 중…</p>` : entry?.error ? `<div class="tree-inline-message" style="--depth:${depth + 1}"><span>${escape(entry.error)}</span><button class="tree-retry" data-retry-root="${escape(project.id)}">다시 시도</button></div>` : !query && entry?.loaded && !files.length ? `<p class="muted tree-inline-message" style="--depth:${depth + 1}">${!selectedFileTypes.size ? "표시할 파일 형식을 선택해 주세요." : "선택한 형식의 파일이 없어요."}</p>` : "";
    }
    function renderRoot(project, depth) {
      const entry = treeCache.get(project.id);
      const files = filesFor(project.id);
      if (query && !files.length && !entry?.error) return "";
      const key = rootKey(project.id);
      return `<details class="folder root-folder" data-root="${escape(project.id)}" data-folder="${escape(key)}"${opened(key, files.length > 0) ? " open" : ""}>${summary(project.name, depth, entry?.loaded || query ? `${files.length}${entry?.truncated && !query ? "+" : ""}` : undefined, project.path)}${rootStatus(project, depth, files)}${renderFiles(project.id, files, depth + 1)}</details>`;
    }
    const roots = groups.map((group) => {
      if (group.projects.length === 1) return renderRoot(group.projects[0], 0);
      // The repository's main folder is the group itself, without a duplicate level.
      const primary = group.projects.find((project) => project.name === group.name) || group.projects.find((project) => project.isDefault);
      const files = primary ? filesFor(primary.id) : [];
      const branches = group.projects.filter((project) => project !== primary).map((project) => renderRoot(project, 1)).join("");
      const children = `${branches}${primary ? rootStatus(primary, 0, files) + renderFiles(primary.id, files, 1) : ""}`;
      if (query && !children) return "";
      const key = primary ? rootKey(primary.id) : groupKey(group.id);
      return `<details class="folder root-group"${primary ? ` data-root="${escape(primary.id)}"` : ""} data-folder="${escape(key)}"${opened(key, Boolean(query && children)) ? " open" : ""}>${summary(group.name, 0, undefined, group.label)}${children}</details>`;
    }).join("");
    const loose = filesFor("loose").map((file) => fileButton(file, 0, Boolean(query))).join("");
    const scroll = $("file-tree").scrollTop;
    $("file-tree").innerHTML = roots + loose || `<p class="muted tree-message">${!selectedFileTypes.size ? "표시할 파일 형식을 선택해 주세요." : query ? folderSearch.loading ? "모든 폴더에서 찾고 있어요…" : "선택한 형식에서 일치하는 파일이 없어요." : "폴더나 MD · PNG · MP4 · HTML 파일을 추가해 주세요."}</p>`;
    $("file-tree").scrollTop = scroll;
    const entries = [...treeCache.values()];
    const allFiles = [...new Map([...treeCache.keys()].flatMap(projectFiles).map((file) => [file.path, file])).values()];
    const count = allFiles.filter(matchesFileType).length;
    $("file-count").textContent = `${count.toLocaleString()}${selectedFileTypes.size !== 4 ? ` / ${allFiles.length.toLocaleString()}` : ""}${entries.some((entry) => entry.truncated) ? "+" : ""}개 파일`;
    updateTreeActions();
  }
  function cancelFolderSearch() {
    clearTimeout(folderSearch.timer); folderSearch.controller?.abort(); folderSearch.sequence++;
    folderSearch.files = []; folderSearch.query = ""; folderSearch.loading = false; folderSearch.error = ""; folderSearch.truncated = false;
    $("file-search-status").hidden = true;
  }
  function localSearchFiles(query) {
    return [...localDocuments].filter(([path]) => matchesFileType({ path })).map(([path, doc]) => {
      const lines = typeof doc.content === "string" ? doc.content.split(/\r?\n/) : [];
      const line = lines.findIndex((text) => text.toLocaleLowerCase().includes(query));
      if (!displayPath(path).toLocaleLowerCase().includes(query) && line < 0) return null;
      const text = line < 0 ? "" : lines[line];
      const offset = text.toLocaleLowerCase().indexOf(query);
      const start = Math.max(0, offset - 40);
      return { path, name: doc.name, kind: doc.kind, matchedContent: line >= 0, line: line >= 0 ? line + 1 : null, snippet: `${start ? "…" : ""}${text.slice(start, start + 180)}${text.length > start + 180 ? "…" : ""}` };
    }).filter(Boolean);
  }
  function renderSearchStatus() {
    const status = $("file-search-status");
    status.hidden = !folderSearch.query;
    status.dataset.error = String(Boolean(folderSearch.error));
    status.textContent = !selectedFileTypes.size ? "표시할 파일 형식을 선택해 주세요." : folderSearch.loading ? "선택한 형식에서 파일 이름과 내용을 찾고 있어요…" : `${folderSearch.files.filter(matchesFileType).length.toLocaleString()}개 파일 · 모든 폴더${folderSearch.error ? ` · 일부 폴더 검색 실패 (${folderSearch.error})` : ""}${folderSearch.truncated ? " · 일부 결과만 표시돼요. 검색어를 구체적으로 입력하세요." : ""}`;
  }
  function scheduleFolderSearch() {
    cancelFolderSearch();
    const query = $("file-search").value.trim().toLocaleLowerCase();
    if (!query || !selectedFileTypes.size) { folderSearch.query = query; renderSearchStatus(); renderTree(); return; }
    const types = fileTypeQuery();
    const sequence = folderSearch.sequence;
    folderSearch.query = query; folderSearch.loading = true;
    const local = localSearchFiles(query);
    const fallback = [...treeCache.keys()].flatMap(projectFiles).filter((file) => matchesFileType(file) && !localDocuments.has(file.path) && displayPath(file.path).toLocaleLowerCase().includes(query));
    folderSearch.files = [...fallback, ...local];
    renderSearchStatus(); renderTree();
    folderSearch.timer = setTimeout(async () => {
      const controller = new AbortController(); folderSearch.controller = controller;
      const results = new Map(folderSearch.files.map((file) => [file.path, file]));
      let failures = 0;
      await mapFolders([...state.projects.map((project) => project.id), "loose"], async (projectId) => {
        if (sequence !== folderSearch.sequence) return;
        try {
          const data = await fetchJSON(`/api/search?project=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}&types=${encodeURIComponent(types)}`, { signal: controller.signal });
          if (sequence !== folderSearch.sequence) return;
          if (!Array.isArray(data.files)) throw new Error("검색 응답이 올바르지 않아요.");
          for (const file of data.files) if (typeof file.path === "string" && ownerOf(file.path) === projectId && matchesFileType(file)) results.set(file.path, file);
          folderSearch.truncated ||= Boolean(data.truncated);
          folderSearch.files = [...results.values()]; renderTree();
        } catch (error) { if (sequence === folderSearch.sequence && error.name !== "AbortError") failures++; }
      });
      if (sequence !== folderSearch.sequence) return;
      folderSearch.error = failures ? `${failures}개` : "";
      folderSearch.loading = false; renderSearchStatus(); renderTree();
    }, 200);
  }
  async function openSearchResult(button) {
    const path = button.dataset.path;
    const query = $("file-search").value.trim();
    const matchedContent = button.dataset.contentMatch === "true";
    await openDocument(path);
    if (matchedContent && query && state.loaded && state.path === path) {
      showDocumentFind(query);
      if (!documentFind.matches.length && !state.source) { setSource(true); refreshDocumentFind(true); }
    }
  }
  function clearDocumentHighlights() {
    for (const root of [$("article"), $("source-code")]) {
      root.querySelectorAll("mark.document-find-match").forEach((mark) => mark.replaceWith(document.createTextNode(mark.textContent)));
      root.normalize();
    }
    documentFind.matches = []; documentFind.index = -1;
  }
  function updateDocumentFindCount() {
    const total = documentFind.matches.length;
    $("document-find-count").textContent = `${total ? documentFind.index + 1 : 0} / ${total}${documentFind.truncated ? "+" : ""}`;
    $("document-find-prev").disabled = !total; $("document-find-next").disabled = !total;
    $("document-find-input").setAttribute("aria-invalid", String(Boolean($("document-find-input").value && state.loaded && !total)));
  }
  function selectDocumentMatch(index, scroll = true) {
    const matches = documentFind.matches;
    if (!matches.length) { updateDocumentFindCount(); return; }
    documentFind.index = (index + matches.length) % matches.length;
    matches.forEach((parts, i) => parts.forEach((mark) => mark.classList.toggle("current", i === documentFind.index)));
    updateDocumentFindCount();
    if (scroll) matches[documentFind.index][0].scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  }
  function refreshDocumentFind(scroll = false) {
    const previous = documentFind.index;
    clearDocumentHighlights(); documentFind.truncated = false;
    const query = $("document-find-input").value;
    if ($("document-find").hidden || !query || !state.loaded) { updateDocumentFindCount(); return; }
    const root = state.source ? $("source-code") : $("article");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) { return node.parentElement.closest("button,script,style,.local-document-note,.empty-state") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    const nodes = []; let text = ""; let node;
    while ((node = walker.nextNode())) { nodes.push({ node, start: text.length, end: text.length + node.length }); text += node.data; }
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const matches = []; let match;
    while ((match = pattern.exec(text))) {
      if (matches.length >= 5000) { documentFind.truncated = true; break; }
      matches.push({ start: match.index, end: match.index + match[0].length, parts: [] });
    }
    // Build each original text node with textContent; document/query text never becomes HTML.
    let firstMatch = 0;
    for (const entry of nodes) {
      while (firstMatch < matches.length && matches[firstMatch].end <= entry.start) firstMatch++;
      const relevant = [];
      for (let i = firstMatch; i < matches.length && matches[i].start < entry.end; i++) relevant.push(matches[i]);
      if (!relevant.length) continue;
      const fragment = document.createDocumentFragment(); let offset = 0;
      for (const found of relevant) {
        const start = Math.max(found.start, entry.start) - entry.start;
        const end = Math.min(found.end, entry.end) - entry.start;
        fragment.append(document.createTextNode(entry.node.data.slice(offset, start)));
        const mark = document.createElement("mark"); mark.className = "document-find-match"; mark.textContent = entry.node.data.slice(start, end);
        found.parts.push(mark); fragment.append(mark); offset = end;
      }
      fragment.append(document.createTextNode(entry.node.data.slice(offset))); entry.node.replaceWith(fragment);
    }
    documentFind.matches = matches.map((found) => found.parts).filter((parts) => parts.length);
    selectDocumentMatch(Math.max(0, Math.min(previous, documentFind.matches.length - 1)), scroll);
  }
  function showDocumentFind(query) {
    if (state.kind !== "markdown" || $("open-dialog").open || $("project-dialog").open || $("project-picker").open) return;
    setSidebar(false);
    $("document-find").hidden = false; $("find-document").setAttribute("aria-expanded", "true");
    if (typeof query === "string") $("document-find-input").value = query;
    documentFind.index = -1; refreshDocumentFind(Boolean(query));
    $("document-find-input").focus(); $("document-find-input").select();
  }
  function closeDocumentFind() {
    $("document-find").hidden = true; $("find-document").setAttribute("aria-expanded", "false");
    clearDocumentHighlights(); $("find-document").focus(); updateDocumentFindCount();
  }
  $("find-document").addEventListener("click", () => showDocumentFind());
  $("document-find-input").addEventListener("input", () => { documentFind.index = -1; refreshDocumentFind(true); });
  $("document-find-input").addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); selectDocumentMatch(documentFind.index + (event.shiftKey ? -1 : 1)); }
  });
  $("document-find-prev").addEventListener("click", () => selectDocumentMatch(documentFind.index - 1));
  $("document-find-next").addEventListener("click", () => selectDocumentMatch(documentFind.index + 1));
  $("document-find-close").addEventListener("click", closeDocumentFind);
  window.addEventListener("rdviewer-find", () => showDocumentFind());
  function renderTabs() {
    $("tabs").innerHTML = state.tabs.map((path) => `<div class="tab${path === state.path ? " selected" : ""}"><button class="tab-open" data-path="${escape(path)}" title="${escape(displayPath(path))}"${path === state.path ? ' aria-current="page"' : ""}>${fileGlyph(path)}<span class="tab-label">${escape(filename(path))}</span></button><button class="tab-close icon-button" data-close="${escape(path)}" aria-label="${escape(filename(path))} 탭 닫기">${icon("close")}</button></div>`).join("");
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
        } else if (path && supportedFile(path)) {
          link.dataset.document = path;
          let decodedHash = hash;
          try { decodedHash = hash ? decodeURIComponent(hash) : ""; } catch { /* Leave malformed fragments as text. */ }
          if (decodedHash) link.dataset.documentHash = decodedHash;
          link.href = `?project=${encodeURIComponent(ownerOf(path))}&doc=${encodeURIComponent(path)}${decodedHash ? `#${encodeURIComponent(decodedHash)}` : ""}`;
        } else {
          link.removeAttribute("href");
          link.setAttribute("aria-disabled", "true");
          link.title = "MD · PNG · MP4 · HTML 파일 링크만 열 수 있어요";
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
  async function fetchJSON(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
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
  function recentIdentity(item) {
    if (!item.fsPath) return item.path;
    return /^[a-z]:[\\/]/i.test(item.fsPath) ? item.fsPath.toLocaleLowerCase() : item.fsPath;
  }
  function renderRecent() {
    const collapsed = recentCollapsed;
    $("toggle-recent").setAttribute("aria-expanded", String(!collapsed));
    $("recent-content").hidden = collapsed;
    $("recent-count").textContent = recentDocuments.length || "";
    $("clear-recent").disabled = !recentDocuments.length;
    const visible = recentExpanded ? recentDocuments : recentDocuments.slice(0, 5);
    $("recent-list").innerHTML = visible.length ? visible.map((item) => {
      const available = !item.ephemeral || localDocuments.has(item.path);
      const detail = available ? `${kindLabel(fileKind(item.path))} · ${item.folder}` : "다시 선택 필요 · 이 탭에서만 보관";
      return `<button class="recent-item${item.path === state.path && state.loaded ? " active" : ""}" data-recent-path="${escape(item.path)}" title="${escape(item.fsPath || `${item.folder}/${item.name}`)}"${item.path === state.path && state.loaded ? ' aria-current="page"' : ""}>${fileGlyph(item.path)}<span class="recent-details"><span class="recent-name">${escape(item.name)}</span><span class="recent-folder">${escape(detail)}</span></span></button>`;
    }).join("") : '<p class="recent-empty">열어본 문서가 여기에 표시돼요.</p>';
    $("more-recent").hidden = recentDocuments.length <= 5;
    $("more-recent").textContent = recentExpanded ? "간단히 보기" : `더 보기 (${recentDocuments.length - 5})`;
    $("more-recent").setAttribute("aria-expanded", String(recentExpanded));
  }
  function rememberDocument(path, data) {
    const previous = recentDocuments.find((item) => item.path === path);
    const project = state.projects.find((item) => item.id === ownerOf(path));
    const entry = { path, name: filename(path), kind: fileKind(path), fsPath: typeof data.fsPath === "string" ? data.fsPath : previous?.fsPath || "", folder: project?.name || (localDocuments.has(path) ? "선택한 파일 · 이 탭" : "폴더 밖 문서"), ephemeral: localDocuments.has(path) };
    const identity = recentIdentity(entry);
    for (let index = recentDocuments.length - 1; index >= 0; index--) if (recentIdentity(recentDocuments[index]) === identity || recentDocuments[index].path === path) recentDocuments.splice(index, 1);
    recentDocuments.unshift(entry); recentDocuments.length = Math.min(30, recentDocuments.length);
    storage.set("recent-documents", recentDocuments); renderRecent();
  }
  async function openRecent(path) {
    if (recentOpening) return;
    const entry = recentDocuments.find((item) => item.path === path);
    if (!entry) return;
    if (entry.ephemeral && !localDocuments.has(path)) { toast("이 문서는 이전 탭에서만 보관되었어요. 파일 추가에서 다시 선택해 주세요."); return; }
    recentOpening = true;
    try {
      let target = path;
      if (entry.fsPath) {
        const data = await fetchJSON("/api/open", { method: "POST", headers: { "Content-Type": "application/json", "X-Folio-Request": "1" }, body: JSON.stringify({ input: entry.fsPath }) });
        if (typeof data.path !== "string") throw new Error("문서 경로를 확인할 수 없어요.");
        target = data.path;
      }
      if (target !== path) {
        const previousOwner = ownerOf(path), nextOwner = ownerOf(target);
        const replaceTabs = (tabs, id) => [...new Set(tabs.flatMap((item) => item !== path ? [item] : id === nextOwner ? [target] : []))];
        if (state.projectId === previousOwner) state.tabs = replaceTabs(state.tabs, state.projectId);
        for (const [id, session] of Object.entries(projectSessions)) {
          session.tabs = replaceTabs(session.tabs, id);
          if (session.path === path) session.path = id === nextOwner ? target : "";
        }
        // Avoid saving the obsolete mount again while switching to a new owner.
        if (state.path === path && previousOwner !== nextOwner) { saveScroll(); state.path = ""; state.loaded = false; }
      }
      await openDocument(target, { reload: true });
    } catch (error) { toast(error.message); }
    finally { recentOpening = false; }
  }
  $("toggle-recent").addEventListener("click", () => { recentCollapsed = !recentCollapsed; storage.set("recent-collapsed", recentCollapsed); renderRecent(); });
  $("more-recent").addEventListener("click", () => { recentExpanded = !recentExpanded; renderRecent(); });
  $("clear-recent").addEventListener("click", () => { recentDocuments.length = 0; recentExpanded = false; storage.set("recent-documents", []); renderRecent(); toast("최근 문서 기록을 지웠어요."); });
  $("recent-list").addEventListener("click", (event) => { const button = event.target.closest("[data-recent-path]"); if (button) void openRecent(button.dataset.recentPath); });
  renderRecent();
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
    result.push({ id: "loose", name: "개별 문서", label: "개별 문서", kind: "folder", projects: [{ id: "loose", name: "개별 문서", path: "폴더 밖에서 연 문서" }] });
    return result;
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
    renderTree();
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
    $("project-picker-status").textContent = groups.length ? `${groups.length}개 묶음 · ${count}개 작업 폴더` : "일치하는 폴더가 없어요.";
    $("project-cards").innerHTML = groups.map((group) => `<section class="project-card" aria-label="${escape(group.label)}"><header><div><h3>${escape(group.name)}</h3>${group.label !== group.name ? `<span class="project-card-path">${escape(group.path)}</span>` : ""}</div><span class="project-badge">${group.projects.length}개</span></header><div class="project-card-choices">${group.projects.map((project) => `<button class="project-choice" data-select-project="${escape(project.id)}"${project.id === state.projectId ? ' aria-current="true"' : ""}><span class="project-choice-heading"><strong>${escape(project.name)}</strong>${project.id === state.projectId ? '<span class="project-current-badge">읽는 중</span>' : ""}</span>${project.branch ? `<span class="project-choice-branch">${escape(project.branch)}</span>` : ""}<span class="project-choice-path">${escape(project.path)}</span></button>`).join("")}</div></section>`).join("");
  }
  async function loadProjects() {
    const data = await fetchJSON("/api/projects");
    if (!Array.isArray(data.projects)) throw new Error("폴더 목록을 불러오지 못했어요.");
    state.projects = data.projects;
    for (const id of treeCache.keys()) if (id !== "loose" && !state.projects.some((project) => project.id === id)) treeCache.delete(id);
    renderProjects();
    const expanded = state.projects.filter((project) => treeOpen.has(rootKey(project.id)) && !treeCache.has(project.id)).map((project) => project.id);
    void mapFolders(expanded, (id) => ensureTree(id));
    void ensureTree("loose");
    if ($("file-search").value.trim()) scheduleFolderSearch();
  }
  function emptyReader(message = "탐색기에서 읽고 싶은 문서를 골라 주세요.") {
    disposeMedia(); setDocumentKind(); currentDocumentData = null;
    state.path = ""; state.content = ""; state.loaded = false; state.headings = [];
    clearDocumentHighlights(); updateDocumentFindCount();
    $("article").hidden = false; $("source-view").hidden = true; $("document-meta").hidden = true; $("document-end").hidden = true;
    $("article").removeAttribute("aria-busy");
    $("article").innerHTML = `<div class="empty-state"><span class="empty-icon">R.</span><h1>읽을 문서를 기다리고 있어요</h1><p>${escape(message)}</p></div>`;
    $("breadcrumb").textContent = "문서 선택"; $("outline-links").innerHTML = '<p class="muted">문서를 열면 목차가 표시돼요.</p>';
    $("word-count").textContent = ""; $("reading-time").textContent = ""; $("status-text").textContent = "문서를 선택해 주세요";
    document.title = "RDViewer — Markdown reader"; updateProgress();
  }
  async function switchProject(id, { path = "", hash = "", history = true, restore = true } = {}) {
    const navigation = ++state.navigation;
    disposeMedia();
    ++state.request; ++state.treeRequest;
    saveScroll(); saveProjectSession();
    if (id !== "loose" && !state.projects.some((project) => project.id === id)) {
      try { await loadProjects(); } catch (error) { if (navigation === state.navigation) toast(error.message); return; }
      if (navigation !== state.navigation) return;
      if (!state.projects.some((project) => project.id === id)) { toast("이 폴더는 목록에서 제거되었어요."); id = "default"; path = ""; }
    }
    state.projectId = id; state.projectReady = true; state.projectPending = true;
    const selectedGroup = projectGroups().find((group) => group.projects.some((project) => project.id === id));
    if (selectedGroup) { groupFolders.set(selectedGroup.id, id); storage.set("group-folders", Object.fromEntries(groupFolders)); }
    state.tabs = (projectSessions[id]?.tabs || []).filter((item) => typeof item === "string" && ownerOf(item) === id);
    state.files = projectFiles(id); state.treeLoaded = Boolean(treeCache.get(id)?.loaded); state.source = false;
    emptyReader("폴더 문서를 찾고 있어요…"); renderTabs(); renderProjects();
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
      emptyReader(id === "loose" ? "파일 추가에서 파일을 선택하거나 경로를 붙여넣어 주세요." : "이 폴더에는 MD · PNG · MP4 · HTML 파일이 없어요. 파일을 추가한 뒤 목록을 새로고침해 주세요.");
      window.history.replaceState({}, "", projectURL()); saveProjectSession();
    }
  }
  async function openDocument(path, { hash = "", history = true, reload = false } = {}) {
    if (ownerOf(path) !== state.projectId) return switchProject(ownerOf(path), { path, hash, history });
    if (path === state.path && state.loaded && !reload) { if (currentDocumentData) rememberDocument(path, currentDocumentData); if (hash) jumpToHeading(hash); setSidebar(false); return; }
    saveScroll();
    const request = ++state.request;
    disposeMedia(); setDocumentKind(fileKind(path)); currentDocumentData = null;
    state.content = "";
    state.path = path;
    state.loaded = false;
    renderRecent();
    clearDocumentHighlights(); updateDocumentFindCount();
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
      if (path.startsWith("선택한 파일/") && !localDocuments.has(path)) throw new Error("이 파일은 이전 탭에서만 보관되었어요. ‘파일 추가’에서 파일을 다시 선택해 주세요.");
      const data = localDocuments.get(path) || await fetchJSON(`/api/file?path=${encodeURIComponent(path)}`);
      if (request !== state.request) return;
      const kind = data.kind || fileKind(path);
      if (kind !== fileKind(path)) throw new Error("파일 응답 형식이 올바르지 않아요.");
      setDocumentKind(kind);
      if (kind === "markdown") {
        if (typeof data.content !== "string") throw new Error("문서 응답 형식이 올바르지 않아요.");
        state.content = data.content; renderDocument();
      } else if (kind === "html") await renderHTML(data, request);
      else renderMedia(data, request);
      if (request !== state.request) return;
      state.loaded = true;
      currentDocumentData = data;
      rememberDocument(path, data);
      document.title = `${filename(path)} — RDViewer`;
      saveProjectSession();
      if (!state.files.some((file) => file.path === path)) {
        const file = { path, name: filename(path), kind: fileKind(path) };
        state.files.push(file);
        const entry = treeCache.get(ownerOf(path));
        if (entry && !localDocuments.has(path) && !entry.files.some((item) => item.path === path)) entry.files.push(file);
      }
      renderTree();
      requestAnimationFrame(() => {
        if (request !== state.request) return;
        $("reading").scrollTo({ top: state.scrolls.get(`${path}:${state.source}`) || 0, behavior: "instant" });
        if (hash) jumpToHeading(hash);
        refreshDocumentFind(false);
        updateProgress();
      });
      announce(`${filename(path)} 파일을 열었어요.`);
    } catch (error) {
      if (request !== state.request) return;
      disposeMedia(); state.loaded = false; $("article").hidden = false;
      $("article").innerHTML = `<div class="empty-state"><span class="empty-icon">f.</span><h1>파일을 열 수 없어요</h1><p>${escape(error.message)}</p><button id="retry-document">다시 시도</button></div>`;
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
      state.request++; disposeMedia(); setDocumentKind(); currentDocumentData = null;
      state.path = ""; state.content = ""; state.loaded = false; state.headings = [];
      clearDocumentHighlights(); updateDocumentFindCount();
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
    if (!state.loaded || state.kind !== "markdown") return;
    saveScroll();
    state.source = source;
    $("article").hidden = source; $("source-view").hidden = !source;
    $("preview-mode").classList.toggle("active", !source); $("source-mode").classList.toggle("active", source);
    $("preview-mode").setAttribute("aria-pressed", String(!source)); $("source-mode").setAttribute("aria-pressed", String(source));
    $("reading").scrollTo({ top: state.scrolls.get(`${state.path}:${source}`) || 0, behavior: "instant" });
    refreshDocumentFind(!$("document-find").hidden);
    updateProgress();
  }
  async function loadTree(notify = true, navigation = state.navigation) {
    const projectId = state.projectId;
    const success = await ensureTree(projectId);
    if (navigation !== state.navigation) return false;
    state.files = projectFiles(projectId); state.treeLoaded = Boolean(treeCache.get(projectId)?.loaded);
    state.rootName = treeCache.get(projectId)?.rootName || "내 문서";
    const project = state.projects.find((item) => item.id === projectId);
    $("root-name").textContent = project?.path || "폴더 밖에서 연 문서";
    $("root-name").title = $("root-name").textContent;
    if (notify) toast(success ? "문서 목록을 새로고침했어요." : "폴더 연결을 확인해 주세요.");
    renderTree(); return success;
  }
  async function refreshTrees() {
    $("refresh-tree").disabled = true;
    try {
      const ids = [...new Set([state.projectId, "loose", ...state.projects.filter((project) => treeOpen.has(rootKey(project.id))).map((project) => project.id)])];
      await mapFolders(ids, (id) => ensureTree(id, true));
      if ($("file-search").value.trim()) scheduleFolderSearch();
      toast("문서 목록을 새로고침했어요.");
    } finally { $("refresh-tree").disabled = false; }
  }
  function focusSearch() {
    if ($("app").classList.contains("focus")) { $("app").classList.remove("focus"); $("focus-mode").setAttribute("aria-pressed", "false"); }
    if (window.matchMedia("(max-width: 700px)").matches) setSidebar(true);
    $("file-search").focus(); $("file-search").select();
  }
  $("file-search").addEventListener("input", scheduleFolderSearch);
  $("expand-all-folders").addEventListener("click", () => setAllFolders(true));
  $("collapse-all-folders").addEventListener("click", () => setAllFolders(false));
  $("file-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { const first = $("file-tree").querySelector("[data-path]"); if (first) openSearchResult(first); }
    if (event.key === "ArrowDown") { event.preventDefault(); $("file-tree").querySelector("[data-path],summary")?.focus(); }
  });
  $("file-tree").addEventListener("click", (event) => {
    const retry = event.target.closest("[data-retry-root]");
    if (retry) { void ensureTree(retry.dataset.retryRoot, true); return; }
    const button = event.target.closest("[data-path]"); if (button) openSearchResult(button);
  });
  $("file-tree").addEventListener("toggle", (event) => {
    const folder = event.target;
    if (!folder.isConnected || !folder.matches("details.folder")) return;
    const key = folder.dataset.folder;
    if (folder.open) { treeOpen.add(key); manuallyClosed.delete(key); }
    else { treeOpen.delete(key); manuallyClosed.add(key); }
    saveTreeOpen();
    if (folder.open && folder.dataset.root && !treeCache.get(folder.dataset.root)?.loaded && !treeCache.get(folder.dataset.root)?.loading && !treeCache.get(folder.dataset.root)?.error) void ensureTree(folder.dataset.root);
  }, true);
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
  $("refresh-tree").addEventListener("click", refreshTrees);
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
    if (!$("reading-settings").hidden) $("show-outline").focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#reading-settings,#toggle-settings")) { $("reading-settings").hidden = true; $("toggle-settings").setAttribute("aria-expanded", "false"); }
  });
  $("font-size").addEventListener("input", (event) => { settings.fontSize = Number(event.target.value); applySettings(); updateProgress(); });
  $("reading-width").addEventListener("change", (event) => { settings.width = Number(event.target.value); applySettings(); updateProgress(); });
  $("theme").addEventListener("change", (event) => { settings.theme = event.target.value; applySettings(); });
  $("show-outline").addEventListener("change", (event) => { settings.showOutline = event.target.checked; applySettings(); updateProgress(); });
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
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "폴더를 변경하지 못했어요.");
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
  $("close-project-picker").addEventListener("click", () => $("project-picker").close());
  $("project-picker").addEventListener("close", () => { if (pickerOpener?.isConnected && pickerOpener.getClientRects().length) pickerOpener.focus(); else $("toggle-sidebar").focus(); });
  $("project-picker-search").addEventListener("input", renderProjectPicker);
  $("project-cards").addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-project]");
    if (!button) return;
    $("project-picker").close();
    switchProject(button.dataset.selectProject);
  });
    function chooseNative(action) {
    closeProjectMenu();
    window.location.href = `rdviewer://${action}`;
  }
  function addFiles() { if (desktop) chooseNative("choose-files"); else showOpenDialog(); }
  $("add-project").addEventListener("click", () => { if (desktop) chooseNative("choose-folder"); else showProjectDialog(); });
  $("add-files").addEventListener("click", () => { closeProjectMenu(); addFiles(); });
  $("add-file-path").addEventListener("click", () => { closeProjectMenu(); showOpenDialog(); });
  $("manage-projects").addEventListener("click", () => showProjectDialog(false));
  $("close-project-dialog").addEventListener("click", () => $("project-dialog").close());
  $("project-dialog").addEventListener("close", () => { if (projectOpener?.isConnected && projectOpener.getClientRects().length) projectOpener.focus(); else $("toggle-sidebar").focus(); });
  $("project-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("project-path").value.trim(); if (!input) return;
    $("submit-project").disabled = true; $("project-error").hidden = true;
    try {
      const data = await postProject("/api/projects", input);
      if (!data.project?.id) throw new Error("폴더 응답이 올바르지 않아요.");
      await loadProjects(); $("project-dialog").close(); $("project-path").value = "";
      await switchProject(data.project.id); toast(`${data.project.name} 폴더를 열었어요.`);
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
      toast("폴더 목록에서 뺐어요. 폴더와 파일은 그대로예요.");
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
  $("open-document").addEventListener("click", addFiles);
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
    const errors = []; let opened = 0; let lastPath = "";
    for (const file of files) {
      if (!supportedFile(file.name)) { errors.push(`${file.name}: MD · PNG · MP4 · HTML 파일을 선택해 주세요.`); continue; }
      const kind = fileKind(file.name);
      const limit = ["markdown", "html"].includes(kind) ? 5 * 1024 ** 2 : kind === "image" ? 20 * 1024 ** 2 : Number.MAX_SAFE_INTEGER;
      if (file.size > limit) { errors.push(`${file.name}: ${kind === "image" ? "PNG는 최대 20MB" : "MD와 HTML은 최대 5MB"}까지 열 수 있어요.`); continue; }
      try {
        const path = `선택한 파일/${crypto.randomUUID()}/${file.name}`;
        // File handles stay in memory; only the selected media gets an object URL.
        const data = { kind, size: file.size, name: file.name };
        if (kind === "markdown") data.content = await file.text(); else data.file = file;
        localDocuments.set(path, data);
        if (state.projectId === "loose") state.files.push({ path, name: file.name });
        lastPath = path; opened++;
      } catch { errors.push(`${file.name}: 파일을 읽지 못했어요.`); }
    }
    if (lastPath) await openDocument(lastPath);
    $("file-picker").value = "";
    if (errors.length) { if (!$("open-dialog").open) showOpenDialog(); showOpenError(errors.join("\n")); }
    else if (opened) { $("open-dialog").close(); toast(`${opened}개 문서를 이 탭에 열었어요.`); }
    renderTree();
  }
  $("choose-files").addEventListener("click", () => { if (desktop) { $("open-dialog").close(); chooseNative("choose-files"); } else $("file-picker").click(); });
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o" && !event.shiftKey && !event.altKey) { event.preventDefault(); addFiles(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !event.shiftKey && !event.altKey) { event.preventDefault(); showDocumentFind(); return; }
    if ($("open-dialog").open || $("project-dialog").open || $("project-picker").open) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p" && !event.shiftKey && !event.altKey) { event.preventDefault(); focusSearch(); }
    if (event.key === "Escape") {
      if (!$("file-type-options").hidden) { event.preventDefault(); setFileTypePopover(false, true); return; }
      if (!$("document-find").hidden) { event.preventDefault(); closeDocumentFind(); return; }
      if (!$("project-menu").hidden) { setProjectMenu(false, true); return; }
      const settingsOpen = !$("reading-settings").hidden;
      $("reading-settings").hidden = true; $("toggle-settings").setAttribute("aria-expanded", "false");
      if (settingsOpen) $("toggle-settings").focus();
      else if ($("app").classList.contains("sidebar-open")) { setSidebar(false); $("toggle-sidebar").focus(); }
      else if ($("file-search") === document.activeElement) { $("file-search").value = ""; scheduleFolderSearch(); }
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
    $("project-path").placeholder = "C:\\Work\\폴더";
  }
  async function initialize() {
    try {
      await loadProjects(); await navigateFromURL(true);
    }
    catch (error) { emptyReader(error.message); $("file-tree").innerHTML = '<p class="muted tree-message">폴더에 연결하지 못했어요.<br><button id="retry-projects" class="secondary-button">다시 연결</button></p>'; $("retry-projects").addEventListener("click", initialize); }
  }
  initialize();
})();
