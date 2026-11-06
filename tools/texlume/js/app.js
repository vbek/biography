/* Texlume — a private LaTeX editor that compiles in the browser. Projects live in IndexedDB. */
(() => {
  'use strict';

  if (!window.CodeMirror || !window.pdfjsLib || !window.indexedDB || !window.WebAssembly || !window.DecompressionStream) {
    document.getElementById('unsupported').hidden = false;
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;

  /* ------------------------------------------------------------ icons */
  const FILE_PATH = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
  const FOLDER_PATH = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
  const ICONS = {
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    play: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 21v-5h-5"/>',
    code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    file: FILE_PATH,
    tex: `${FILE_PATH}<path d="M9 13h6M9 17h4"/>`,
    'file-plus': `${FILE_PATH}<path d="M12 11v6M9 14h6"/>`,
    folder: FOLDER_PATH,
    'folder-plus': `${FOLDER_PATH}<path d="M12 10v6M9 13h6"/>`,
    upload: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8" fill="currentColor"/><circle cx="4.5" cy="12" r=".8" fill="currentColor"/><circle cx="4.5" cy="18" r=".8" fill="currentColor"/>',
    'list-ordered': '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1.5V9M4 9h3M4 14.5c.6-.8 2.6-.8 2.6.5 0 1-2.6 2-2.6 3.5h2.8" stroke-width="1.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    alert: '<path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 10v4M12 17h.01"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    bib: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    folders: '<path d="M8 4h3l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M3 8v10a2 2 0 0 0 2 2h12"/>',
    import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    broom: '<path d="M14 4l6 6M4 20l7-7M9 11l4 4-5 5H4v-4z"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  };
  const svg = (name, cls = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(n => n.insertAdjacentHTML('afterbegin', svg(n.dataset.icon)));

  /* ---------------------------------------------------------- helpers */
  const $ = s => document.querySelector(s);
  const el = {
    body: document.body,
    projectSelect: $('#projectSelect'), engineSelect: $('#engineSelect'), autoCompile: $('#autoCompile'),
    compileBtn: $('#compileBtn'), fileTree: $('#fileTree'), outline: $('#outline'), sidebar: $('#sidebar'),
    editorHost: $('#editorHost'), previewHost: $('#previewHost'), crumb: $('#crumb'), fmtBar: $('#fmtBar'),
    splitter: $('#splitter'), workspace: $('#workspace'),
    pdfViewport: $('#pdfViewport'), pdfPages: $('#pdfPages'), pdfEmpty: $('#pdfEmpty'), compileVeil: $('#compileVeil'),
    pageInput: $('#pageInput'), pageCount: $('#pageCount'), zoomSelect: $('#zoomSelect'),
    logBtn: $('#logBtn'), logView: $('#logView'), issues: $('#issues'), rawLog: $('#rawLog'), showBoxes: $('#showBoxes'),
    errBadge: $('#errBadge'), warnBadge: $('#warnBadge'),
    compileStatus: $('#compileStatus'), saveStatus: $('#saveStatus'), cursorPos: $('#cursorPos'), wordCount: $('#wordCount'),
    modal: $('#modal'), modalTitle: $('#modalTitle'), modalBody: $('#modalBody'), modalOk: $('#modalOk'),
    toasts: $('#toasts'), menu: $('#menu'), uploadInput: $('#uploadInput'), importInput: $('#importInput'),
    fastMode: $('#fastMode'), draftBadge: $('#draftBadge'), fastMenuItem: $('#fastMenuItem'),
    slowBox: $('#slowBox'), slowElapsed: $('#slowElapsed'), keepWaitingBtn: $('#keepWaitingBtn'), stopCompileBtn: $('#stopCompileBtn'),
    engineBox: $('#engineBox'), engineLabel: $('#engineLabel'), engineBar: $('#engineBar'), engineDetail: $('#engineDetail'),
  };
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const MOD = isMac ? 'Cmd' : 'Ctrl';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const dirname = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const basename = p => p.slice(p.lastIndexOf('/') + 1);
  const prefs = {
    get(k, d) { try { const v = localStorage.getItem(`texforge:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`texforge:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const narrow = () => window.matchMedia('(max-width: 860px)').matches;
  const fmtSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

  const TEXT_RE = /\.(tex|bib|sty|cls|txt|md|bbx|cbx|lbx|cfg|def|dtx|ins|csv|dat|tsv|tikz|pgf|ltx|bst|json|ya?ml|py|r|m|lua|gp|clo|xml|html?|bbl)$/i;
  const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
  const GRAPHIC_RE = /\.(png|jpe?g|pdf|eps|svg|gif|bmp|webp)$/i;
  const isText = p => TEXT_RE.test(p) || !/\.[^/]+$/.test(basename(p));

  function toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    el.toasts.append(t);
    setTimeout(() => t.remove(), type === 'error' ? 6000 : 3200);
  }

  /* ------------------------------------------------------------ state */
  const state = {
    project: null,          // { id, name, settings }
    files: [],              // [{ path, type: 'file'|'dir', kind, size, mtime, v }]
    docs: new Map(),        // path -> { doc, savedGen, lineHandles }
    current: null,
    lastTex: null,
    collapsed: new Set(),
    selectedDir: '',
    result: null,           // { items, log, ms, passes, pdf }
    sync: null,             // parsed SyncTeX
    pdfBytes: null,
    compiling: false,
    compileQueued: false,
    autoCompile: prefs.get('autoCompile', true),
    objectUrls: [],
  };
  const pid = () => state.project && state.project.id;

  /* ----------------------------------------------------------- editor */
  const cm = CodeMirror(el.editorHost, {
    value: '',
    mode: 'stex',
    lineNumbers: true,
    lineWrapping: true,
    matchBrackets: true,
    autoCloseBrackets: { pairs: '()[]{}$$', explode: '{}[]' },
    styleActiveLine: true,
    indentUnit: 2,
    tabSize: 2,
    gutters: ['cm-issues', 'CodeMirror-linenumbers'],
    readOnly: 'nocursor',
    dragDrop: true,
    spellcheck: true,
    inputStyle: 'contenteditable',
    extraKeys: {
      [`${MOD}-S`]: () => { saveAll().then(() => compile()).catch(() => {}); },
      [`${MOD}-Enter`]: () => compile(),
      [`Shift-${MOD}-Enter`]: () => compile(),
      [`${MOD}-B`]: () => FMT.bold(),
      [`${MOD}-I`]: () => FMT.italic(),
      [`${MOD}-/`]: () => toggleComment(),
      [`${MOD}-Alt-J`]: () => syncToPdf(),
      [`${MOD}-Alt-Right`]: () => syncToPdf(),
      'Ctrl-Space': c => c.showHint({ hint: latexHint, completeSingle: false }),
      [`${MOD}-F`]: 'findPersistent',
      'Tab': c => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('  ', 'end')),
      'Shift-Tab': c => c.indentSelection('subtract'),
    },
  });

  const modeFor = p => (/\.(tex|sty|cls|bib|ltx|dtx|ins|bbx|cbx|lbx|def|cfg|clo|tikz|pgf|bbl)$/i.test(p) ? 'stex' : 'text/plain');
  function makeDoc(p, text) {
    const doc = CodeMirror.Doc(text, modeFor(p));
    const entry = { doc, savedGen: doc.changeGeneration(), lineHandles: [] };
    state.docs.set(p, entry);
    return entry;
  }
  const isDirty = entry => entry && !entry.doc.isClean(entry.savedGen);
  const anyDirty = () => [...state.docs.values()].some(isDirty);

  /* ------------------------------------------------------------ save */
  let saveChain = Promise.resolve();
  function saveAll() {
    saveChain = saveChain.catch(() => {}).then(doSaveAll);
    return saveChain;
  }
  async function doSaveAll() {
    if (!pid()) return;
    const dirty = [...state.docs].filter(([, e]) => isDirty(e));
    if (!dirty.length) return;
    const project = pid();
    const gens = dirty.map(([, e]) => e.doc.changeGeneration());
    setSaveStatus('saving');
    try {
      const recs = await TFDB.putTexts(project, dirty.map(([p, e]) => [p, e.doc.getValue()]));
      if (project !== pid()) return;
      dirty.forEach(([, e], i) => { e.savedGen = gens[i]; });
      for (const r of recs) {
        const f = state.files.find(x => x.path === r.path);
        if (f) Object.assign(f, { v: r.v, size: r.size, mtime: r.mtime });
      }
      setSaveStatus(anyDirty() ? 'dirty' : 'saved');
    } catch (err) {
      setSaveStatus('error');
      toast(`Could not save to this browser's storage: ${err.message}`, 'error');
      throw err;
    } finally {
      refreshDirtyDots();
    }
  }
  function setSaveStatus(s) {
    el.saveStatus.textContent = { saving: 'Saving…', saved: 'Saved in this browser', dirty: 'Unsaved changes', error: 'Save failed' }[s] || '';
    el.saveStatus.className = `status ${s === 'error' ? 'err' : 'muted'}`;
  }

  const scheduleAuto = debounce(async () => {
    try { await saveAll(); } catch { return; }
    if (state.autoCompile) compile({ auto: true });
  }, 900);

  cm.on('changes', () => {
    if (!state.current || !state.docs.has(state.current)) return;
    if (/\.tex$/i.test(state.current)) state.lastTex = state.current;
    setSaveStatus('dirty');
    refreshDirtyDots();
    scheduleAuto();
    scheduleOutline();
    scheduleWordCount();
  });
  cm.on('cursorActivity', () => {
    const c = cm.getCursor();
    el.cursorPos.textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}`;
    highlightOutline();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAll().catch(() => {}); });
  window.addEventListener('pagehide', () => { saveAll().catch(() => {}); });
  window.addEventListener('beforeunload', e => {
    if (anyDirty()) { saveAll(); e.preventDefault(); e.returnValue = ''; }
  });

  /* --------------------------------------------------------- open file */
  async function openFile(p, line, { flash = false } = {}) {
    if (!p) return;
    if (isText(p)) {
      let entry = state.docs.get(p);
      if (!entry) {
        const rec = await TFDB.getFile(pid(), p);
        if (!rec) { toast(`${p} no longer exists`, 'error'); return; }
        const text = rec.kind === 'text' ? rec.text : await rec.blob.text();
        entry = makeDoc(p, text);
      }
      showEditor();
      if (cm.getDoc() !== entry.doc) cm.swapDoc(entry.doc);
      cm.setOption('readOnly', false);
      state.current = p;
      if (/\.tex$/i.test(p)) state.lastTex = p;
      prefs.set(`last:${pid()}`, p);
      markIssues();
      updateOutline();
      updateWordCount();
      if (line) {
        const ln = Math.max(0, Math.min(cm.lineCount() - 1, line - 1));
        cm.setCursor({ line: ln, ch: 0 });
        cm.scrollIntoView({ line: ln, ch: 0 }, Math.round(cm.getScrollInfo().clientHeight / 3));
        if (flash) {
          cm.addLineClass(ln, 'background', 'cm-line-flash');
          setTimeout(() => cm.removeLineClass(ln, 'background', 'cm-line-flash'), 1700);
        }
      }
      cm.focus();
    } else {
      state.current = p;
      showPreview(p);
    }
    renderCrumb();
    highlightTreeRow();
    if (narrow()) el.body.classList.remove('show-sidebar-mobile');
  }

  function showEditor() {
    el.previewHost.hidden = true;
    el.editorHost.hidden = false;
    el.fmtBar.hidden = false;
    requestAnimationFrame(() => cm.refresh());
  }

  function renderCrumb() {
    if (!state.current) { el.crumb.innerHTML = '<span class="muted">No file open</span>'; return; }
    const dir = dirname(state.current);
    el.crumb.innerHTML = `${dir ? `<span class="muted">${esc(dir)}/</span>` : ''}<b>${esc(basename(state.current))}</b>` +
      (state.project && state.current === state.project.settings.main ? ' <span class="muted">· main document</span>' : '');
  }

  function objectUrl(blob) {
    const u = URL.createObjectURL(blob);
    state.objectUrls.push(u);
    if (state.objectUrls.length > 30) URL.revokeObjectURL(state.objectUrls.shift());
    return u;
  }

  async function showPreview(p) {
    el.editorHost.hidden = true;
    el.fmtBar.hidden = true;
    el.previewHost.hidden = false;
    el.previewHost.innerHTML = '';
    const rec = await TFDB.getFile(pid(), p);
    if (!rec || rec.kind !== 'blob') return;
    const meta = document.createElement('div');
    meta.className = 'preview-meta';
    const graphic = GRAPHIC_RE.test(p);
    meta.innerHTML = `<div><b>${esc(p)}</b> <span class="muted size">${fmtSize(rec.size)}</span></div>` +
      (graphic ? `<p><code>\\includegraphics[width=\\linewidth]{${esc(p)}}</code></p>` : '<p class="muted">Binary file — not editable here.</p>');
    if (graphic) {
      const btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.innerHTML = `${svg('image')} Insert as figure`;
      btn.onclick = async () => {
        await openFile(state.lastTex || state.project.settings.main);
        insertSnippet(figureSnippet(p), { block: true });
      };
      meta.append(btn);
    }
    if (IMG_RE.test(p)) {
      const img = new Image();
      img.alt = p;
      img.src = objectUrl(rec.blob);
      img.onload = () => { meta.querySelector('.size').textContent = `${fmtSize(rec.size)} · ${img.naturalWidth}×${img.naturalHeight}px`; };
      el.previewHost.append(img, meta);
    } else if (/\.pdf$/i.test(p)) {
      el.previewHost.append(meta);
      try {
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await rec.blob.arrayBuffer()), isEvalSupported: false }).promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2.5, (el.previewHost.clientWidth - 60) / base.width);
        const dpr = window.devicePixelRatio || 1;
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${vp.width / dpr}px`;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        el.previewHost.prepend(canvas);
        doc.destroy();
      } catch { /* meta only */ }
    } else {
      const a = document.createElement('a');
      a.href = objectUrl(rec.blob);
      a.download = basename(p);
      a.className = 'btn';
      a.textContent = 'Save a copy';
      meta.append(a);
      el.previewHost.append(meta);
    }
  }

  /* -------------------------------------------------------- file tree */
  function buildTree() {
    const root = { path: '', type: 'dir', children: [] };
    const dirs = new Map([['', root]]);
    for (const f of state.files) {
      const node = { ...f, name: basename(f.path), children: f.type === 'dir' ? [] : null };
      (dirs.get(dirname(f.path)) || root).children.push(node);
      if (f.type === 'dir') dirs.set(f.path, node);
    }
    const sort = n => {
      n.children.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })));
      n.children.forEach(c => c.children && sort(c));
    };
    sort(root);
    return root;
  }

  function fileIcon(p) {
    if (/\.tex$/i.test(p)) return svg('tex', 'ftype tex');
    if (/\.bib$/i.test(p)) return svg('bib', 'ftype bib');
    if (GRAPHIC_RE.test(p)) return svg('image', 'ftype img');
    return svg('file', 'ftype');
  }

  function renderTree() {
    const root = buildTree();
    const frag = document.createDocumentFragment();
    const main = state.project && state.project.settings.main;
    const walk = (node, depth) => {
      for (const n of node.children) {
        const row = document.createElement('div');
        row.className = 'tree-row';
        row.dataset.path = n.path;
        row.dataset.type = n.type;
        row.style.paddingLeft = `${6 + depth * 14}px`;
        row.title = n.path;
        const isDir = n.type === 'dir';
        const open = isDir && !state.collapsed.has(n.path);
        if (open) row.classList.add('open');
        const actions = [];
        if (!isDir && /\.tex$/i.test(n.path) && n.path !== main) actions.push(`<button data-act="main" title="Set as main document">${svg('star')}</button>`);
        if (isDir) actions.push(`<button data-act="newfile" title="New file here">${svg('file-plus')}</button>`);
        actions.push(`<button data-act="rename" title="Rename / move">${svg('edit')}</button>`);
        actions.push(`<button data-act="delete" title="Delete">${svg('trash')}</button>`);
        row.innerHTML =
          (isDir ? svg('chevron', 'chev') : '<span class="chev blank"></span>') +
          (isDir ? svg('folder', 'ftype') : fileIcon(n.path)) +
          `<span class="name">${esc(n.name)}</span>` +
          (n.path === main ? '<span class="main-tag" title="Main document">MAIN</span>' : '') +
          (isDirty(state.docs.get(n.path)) ? '<span class="dirty-dot" title="Unsaved"></span>' : '') +
          `<span class="row-actions">${actions.join('')}</span>`;
        frag.append(row);
        if (isDir && open) walk(n, depth + 1);
      }
    };
    walk(root, 0);
    el.fileTree.replaceChildren(frag);
    if (!state.files.length) el.fileTree.innerHTML = '<div class="tree-empty">No files yet.</div>';
    highlightTreeRow();
  }

  function highlightTreeRow() {
    el.fileTree.querySelectorAll('.tree-row').forEach(r => r.classList.toggle('active', r.dataset.path === state.current));
  }
  function refreshDirtyDots() {
    el.fileTree.querySelectorAll('.tree-row[data-type="file"]').forEach(r => {
      const dirty = isDirty(state.docs.get(r.dataset.path));
      const dot = r.querySelector('.dirty-dot');
      if (dirty && !dot) r.querySelector('.name').insertAdjacentHTML('afterend', '<span class="dirty-dot" title="Unsaved"></span>');
      if (!dirty && dot) dot.remove();
    });
  }

  el.fileTree.addEventListener('click', async e => {
    const row = e.target.closest('.tree-row');
    if (!row) { state.selectedDir = ''; return; }
    const p = row.dataset.path;
    const isDir = row.dataset.type === 'dir';
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'main') return setMain(p);
    if (act === 'rename') return renamePath(p);
    if (act === 'delete') return deletePath(p, isDir);
    if (act === 'newfile') { state.selectedDir = p; return newFile(); }
    if (isDir) {
      state.selectedDir = p;
      if (state.collapsed.has(p)) state.collapsed.delete(p); else state.collapsed.add(p);
      renderTree();
    } else {
      state.selectedDir = dirname(p);
      openFile(p);
    }
  });

  /** Reload the file list from IndexedDB (folders are implied by paths). */
  async function refreshFiles() {
    const recs = await TFDB.listFiles(pid());
    const list = [];
    const dirs = new Set();
    for (const r of recs) {
      if (r.kind === 'dir') { dirs.add(r.path); continue; }
      list.push({ path: r.path, type: 'file', kind: r.kind, size: r.size, mtime: r.mtime, v: r.v });
      let d = dirname(r.path);
      while (d) { dirs.add(d); d = dirname(d); }
    }
    // folders first, parents before children, so buildTree can attach every file
    state.files = [...[...dirs].sort().map(d => ({ path: d, type: 'dir' })), ...list];
    renderTree();
    renderCrumb();
    return recs;
  }

  function uniquePath(p) {
    const taken = new Set(state.files.map(f => f.path.toLowerCase()));
    if (!taken.has(p.toLowerCase())) return p;
    const m = /^(.*?)(\.[^./]+)?$/.exec(p);
    for (let i = 1; ; i++) {
      const c = `${m[1]}-${i}${m[2] || ''}`;
      if (!taken.has(c.toLowerCase())) return c;
    }
  }
  const safeName = n => n.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'file';
  const cleanPath = p => p.replace(/\\/g, '/').split('/').map(s => s.trim()).filter(s => s && s !== '.' && s !== '..').join('/');

  async function addFiles(files, dir = '', { quiet = false } = {}) {
    const done = [];
    for (const f of files) {
      if (!f) continue;
      const p = (dir ? `${dir}/` : '') + safeName(f.name);
      try {
        if (isText(p)) {
          const text = await f.text();
          await TFDB.putFile(pid(), p, text);
          const entry = state.docs.get(p);
          if (entry) { entry.doc.setValue(text); entry.savedGen = entry.doc.changeGeneration(); } else makeDoc(p, text);
        } else {
          await TFDB.putFile(pid(), p, f);
        }
        done.push(p);
      } catch (err) {
        toast(`Could not add ${f.name}: ${err.message}`, 'error');
      }
    }
    await refreshFiles();
    if (done.length && !quiet) toast(`Added ${done.length} file${done.length > 1 ? 's' : ''} (stored only in this browser)`);
    if (done.some(p => /\.svg$/i.test(p))) toast('Note: LaTeX cannot include SVG directly — convert it to PDF or PNG.', 'error');
    if (done.length && state.autoCompile) scheduleAuto();
    return done;
  }

  // drag & drop onto the sidebar
  let dragDepth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  el.sidebar.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; el.sidebar.classList.add('dragging'); });
  el.sidebar.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.sidebar.classList.remove('dragging'); clearDropTarget(); } });
  el.sidebar.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    clearDropTarget();
    const row = e.target.closest('.tree-row');
    if (row && row.dataset.type === 'dir') row.classList.add('drop-target');
  });
  el.sidebar.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.sidebar.classList.remove('dragging');
    const row = e.target.closest('.tree-row');
    clearDropTarget();
    const files = [...e.dataTransfer.files];
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) { importZip(files[0]); return; }
    const dir = row ? (row.dataset.type === 'dir' ? row.dataset.path : dirname(row.dataset.path)) : '';
    addFiles(files, dir);
  });
  const clearDropTarget = () => el.fileTree.querySelectorAll('.drop-target').forEach(r => r.classList.remove('drop-target'));

  $('#uploadBtn').onclick = () => { el.uploadInput.value = ''; el.uploadInput.click(); };
  el.uploadInput.onchange = () => addFiles([...el.uploadInput.files], state.selectedDir);
  $('#newFileBtn').onclick = () => newFile();
  $('#newFolderBtn').onclick = () => newFolder();

  async function newFile() {
    const base = state.selectedDir ? `${state.selectedDir}/` : '';
    const name = await promptText('New file', 'File path', `${base}untitled.tex`, { selectName: true, hint: 'Use folders like chapters/intro.tex' });
    if (!name) return;
    const p = cleanPath(name);
    if (!p) return;
    if (state.files.some(f => f.path === p)) { toast('A file with that name already exists', 'error'); return; }
    await TFDB.putFile(pid(), p, '');
    makeDoc(p, '');
    await refreshFiles();
    openFile(p);
  }

  async function newFolder() {
    const base = state.selectedDir ? `${state.selectedDir}/` : '';
    const name = await promptText('New folder', 'Folder path', `${base}figures`, { selectName: true });
    if (!name) return;
    const p = cleanPath(name);
    if (!p) return;
    await TFDB.putFile(pid(), p, null);
    state.selectedDir = p;
    await refreshFiles();
  }

  async function renamePath(p) {
    const answer = await promptText('Rename or move', 'New path', p, { selectName: true });
    const to = answer && cleanPath(answer);
    if (!to || to === p) return;
    try {
      await saveAll();
      await TFDB.renamePath(pid(), p, to);
      for (const key of [...state.docs.keys()]) {
        if (key === p || key.startsWith(`${p}/`)) {
          const nk = to + key.slice(p.length);
          state.docs.set(nk, state.docs.get(key));
          state.docs.delete(key);
          if (state.current === key) state.current = nk;
          if (state.lastTex === key) state.lastTex = nk;
        }
      }
      const main = state.project.settings.main;
      if (main === p || main.startsWith(`${p}/`)) {
        state.project = await TFDB.updateProject(pid(), { settings: { main: to + main.slice(p.length) } });
      }
      await refreshFiles();
      if (state.current) openFile(state.current);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deletePath(p, isDir) {
    const ok = await confirmBox('Delete', `Delete <b>${esc(p)}</b>${isDir ? ' and everything inside it' : ''}? This cannot be undone.`, 'Delete', true);
    if (!ok) return;
    await TFDB.deletePath(pid(), p);
    for (const key of [...state.docs.keys()]) if (key === p || key.startsWith(`${p}/`)) state.docs.delete(key);
    const wasCurrent = state.current && (state.current === p || state.current.startsWith(`${p}/`));
    await refreshFiles();
    if (wasCurrent) {
      state.current = null;
      const main = state.project.settings.main;
      const fallback = state.files.some(f => f.path === main) ? main : state.files.find(f => f.type === 'file' && isText(f.path))?.path;
      if (fallback) openFile(fallback);
      else { cm.swapDoc(CodeMirror.Doc('', 'stex')); cm.setOption('readOnly', 'nocursor'); renderCrumb(); }
    }
  }

  async function setMain(p) {
    state.project = await TFDB.updateProject(pid(), { settings: { main: p } });
    renderTree();
    renderCrumb();
    toast(`${p} is now the main document`);
    compile();
  }

  /* ---------------------------------------------------------- outline */
  const SECTION_LEVEL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, frametitle: 4 };
  let outlineItems = [];
  function updateOutline() {
    const entry = state.docs.get(state.current);
    outlineItems = [];
    if (entry && /\.tex$/i.test(state.current)) {
      const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|frametitle)\*?\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/;
      const frameRe = /\\begin\{frame\}(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/;
      let ln = 0;
      entry.doc.eachLine(lineHandle => {
        const text = lineHandle.text.replace(/(^|[^\\])%.*$/, '$1');
        let m = re.exec(text);
        if (m) outlineItems.push({ line: ln, level: SECTION_LEVEL[m[1]], title: m[2] });
        else if ((m = frameRe.exec(text))) outlineItems.push({ line: ln, level: 4, title: m[1] });
        ln++;
      });
    }
    if (!outlineItems.length) {
      el.outline.innerHTML = `<div class="outline-empty">${state.current && /\.tex$/i.test(state.current) ? 'No sections in this file.' : 'Open a .tex file.'}</div>`;
      return;
    }
    const min = Math.min(...outlineItems.map(i => i.level));
    el.outline.innerHTML = outlineItems.map((it, i) => {
      const lvl = it.level - min;
      const title = it.title.replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}]/g, '').trim() || '(untitled)';
      return `<button class="outline-item" data-i="${i}" data-level="${lvl}" style="padding-left:${10 + lvl * 12}px" title="${esc(title)}">${esc(title)}</button>`;
    }).join('');
    highlightOutline();
  }
  const scheduleOutline = debounce(updateOutline, 400);
  function highlightOutline() {
    if (!outlineItems.length) return;
    const line = cm.getCursor().line;
    let cur = -1;
    outlineItems.forEach((it, i) => { if (it.line <= line) cur = i; });
    el.outline.querySelectorAll('.outline-item').forEach(b => b.classList.toggle('current', Number(b.dataset.i) === cur));
  }
  el.outline.addEventListener('click', e => {
    const b = e.target.closest('.outline-item');
    if (!b) return;
    const it = outlineItems[Number(b.dataset.i)];
    cm.setCursor({ line: it.line, ch: 0 });
    cm.scrollIntoView({ line: it.line, ch: 0 }, 80);
    cm.focus();
  });

  function updateWordCount() {
    const entry = state.docs.get(state.current);
    if (!entry || !/\.tex$/i.test(state.current)) { el.wordCount.textContent = ''; return; }
    let t = entry.doc.getValue();
    const body = /\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(t);
    if (body) t = body[1];
    const words = t
      .replace(/(^|[^\\])%.*$/gm, '$1')
      .replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath|tikzpicture)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
      .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]/g, ' ')
      .replace(/\\(?:label|ref|eqref|cite\w*|includegraphics|begin|end|usepackage|input|include)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, ' ')
      .replace(/\\[a-zA-Z@]+\*?/g, ' ')
      .replace(/[{}[\]\\&^_~#]/g, ' ')
      .split(/\s+/)
      .filter(w => /[\p{L}\p{N}]/u.test(w)).length;
    el.wordCount.textContent = `${words.toLocaleString()} words`;
  }
  const scheduleWordCount = debounce(updateWordCount, 800);

  /* ------------------------------------------------------- formatting */
  const CURSOR = '\u0001';
  function insertSnippet(snippet, { block = false } = {}) {
    if (!state.docs.has(state.current)) return;
    if (block) {
      const c = cm.getCursor('from');
      const line = cm.getLine(c.line);
      if (line.trim() && !cm.somethingSelected()) {
        cm.setCursor({ line: c.line, ch: line.length });
        snippet = `\n${snippet}`;
      }
    }
    const from = cm.getCursor('from');
    const indent = /^\s*/.exec(cm.getLine(from.line))[0];
    const text = snippet.split('\n').map((l, i) => (i ? indent + l : l)).join('\n');
    const idx = text.indexOf(CURSOR);
    cm.replaceSelection(text.replace(CURSOR, ''));
    if (idx >= 0) cm.setCursor(cm.posFromIndex(cm.indexFromPos(from) + idx));
    cm.focus();
  }
  function wrapWith(before, after) {
    if (!state.docs.has(state.current)) return;
    const sels = cm.getSelections();
    if (sels.some(s => s)) cm.replaceSelections(sels.map(s => before + s + after), 'around');
    else insertSnippet(before + CURSOR + after);
    cm.focus();
  }
  function figureSnippet(p) {
    const label = safeName(basename(p).replace(/\.[^.]+$/, '')).toLowerCase();
    return `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{${p}}\n  \\caption{${CURSOR}}\n  \\label{fig:${label}}\n\\end{figure}\n`;
  }
  const FMT = {
    bold: () => wrapWith('\\textbf{', '}'),
    italic: () => wrapWith('\\emph{', '}'),
    section: () => insertSnippet(`\\section{${CURSOR}}\n`, { block: true }),
    itemize: () => insertSnippet(`\\begin{itemize}\n  \\item ${CURSOR}\n\\end{itemize}\n`, { block: true }),
    enumerate: () => insertSnippet(`\\begin{enumerate}\n  \\item ${CURSOR}\n\\end{enumerate}\n`, { block: true }),
    math: () => wrapWith('$', '$'),
    equation: () => insertSnippet(`\\begin{equation}\n  ${CURSOR}\n  \\label{eq:}\n\\end{equation}\n`, { block: true }),
    table: () => insertSnippet(`\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{lll}\n    \\hline\n    ${CURSOR}A & B & C \\\\\n    \\hline\n    1 & 2 & 3 \\\\\n    \\hline\n  \\end{tabular}\n  \\caption{}\n  \\label{tab:}\n\\end{table}\n`, { block: true }),
    figure: () => chooseFigure(),
    comment: () => toggleComment(),
  };
  el.fmtBar.addEventListener('click', e => {
    const b = e.target.closest('[data-fmt]');
    if (b) FMT[b.dataset.fmt]();
  });

  function toggleComment() {
    if (!state.docs.has(state.current)) return;
    const lines = new Set();
    for (const r of cm.listSelections()) {
      const a = Math.min(r.anchor.line, r.head.line);
      let b = Math.max(r.anchor.line, r.head.line);
      if (b > a && (r.anchor.line > r.head.line ? r.anchor.ch : r.head.ch) === 0) b--;
      for (let l = a; l <= b; l++) lines.add(l);
    }
    const arr = [...lines].sort((x, y) => x - y);
    const allCommented = arr.every(l => /^\s*%/.test(cm.getLine(l)) || !cm.getLine(l).trim());
    cm.operation(() => {
      for (const l of arr) {
        const t = cm.getLine(l);
        if (allCommented) {
          const m = /^(\s*)% ?/.exec(t);
          if (m) cm.replaceRange(m[1], { line: l, ch: 0 }, { line: l, ch: m[0].length });
        } else if (t.trim()) {
          cm.replaceRange('% ', { line: l, ch: /^\s*/.exec(t)[0].length });
        }
      }
    });
  }

  async function chooseFigure() {
    if (!state.docs.has(state.current)) { toast('Open a .tex file first'); return; }
    const images = state.files.filter(f => f.type === 'file' && GRAPHIC_RE.test(f.path));
    const wrap = document.createElement('div');
    wrap.innerHTML =
      (images.length
        ? `<label for="figPick">Image from this project</label><select id="figPick">${images.map(f => `<option>${esc(f.path)}</option>`).join('')}</select>`
        : '<p>No images in this project yet.</p>') +
      '<p class="hint">You can also drag an image into the editor, or paste a screenshot with Ctrl+V.</p>' +
      '<button type="button" class="btn" id="figUpload">Add an image from this device…</button>';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*,.pdf,.eps';
    wrap.querySelector('#figUpload').onclick = () => picker.click();
    picker.onchange = async () => {
      el.modal.close('cancel');
      await handleEditorFiles([...picker.files]);
    };
    const ok = await openModal({ title: 'Insert figure', body: wrap, okText: 'Insert', okHidden: !images.length });
    if (ok && images.length) insertSnippet(figureSnippet(wrap.querySelector('#figPick').value), { block: true });
  }

  async function handleEditorFiles(files, pasted = false) {
    const graphics = files.filter(f => f && (GRAPHIC_RE.test(f.name) || /^image\//.test(f.type)));
    const others = files.filter(f => f && !graphics.includes(f));
    for (const f of graphics) {
      let name = safeName(f.name);
      if (pasted || !/\.[a-z0-9]+$/i.test(name) || /^image\.\w+$/i.test(name)) {
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*/, '');
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        name = `pasted-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
      }
      const p = uniquePath(`images/${name}`);
      try {
        await TFDB.putFile(pid(), p, f);
        await refreshFiles();
        insertSnippet(figureSnippet(p), { block: true });
        toast(`Added ${p}`);
      } catch (err) { toast(`Could not add image: ${err.message}`, 'error'); }
    }
    if (others.length) await addFiles(others, '');
  }
  cm.on('drop', (c, e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    if (!state.docs.has(state.current)) return;
    c.setCursor(c.coordsChar({ left: e.clientX, top: e.clientY }));
    handleEditorFiles(files);
  });
  cm.on('paste', (c, e) => {
    const items = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file');
    if (!items.length) return;
    e.preventDefault();
    handleEditorFiles(items.map(i => i.getAsFile()), true);
  });

  /* ---------------------------------------------------- autocomplete */
  const COMMANDS = ('section{} section*{} subsection{} subsubsection{} paragraph{} chapter{} part{} textbf{} textit{} emph{} underline{} ' +
    'texttt{} textsc{} textsf{} textrm{} begin{} end{} item label{} ref{} eqref{} pageref{} autoref{} cref{} cite{} citep{} citet{} ' +
    'footnote{} url{} href{}{} includegraphics[width=\\linewidth]{} caption{} centering usepackage{} usepackage[]{} documentclass{} ' +
    'documentclass[]{} title{} author{} date{} maketitle tableofcontents listoffigures listoftables newpage clearpage newline noindent ' +
    'vspace{} hspace{} input{} include{} bibliography{} bibliographystyle{} newcommand{}{} ' +
    'renewcommand{}{} frac{}{} dfrac{}{} sqrt{} sum prod int iint oint lim infty partial nabla alpha beta gamma delta epsilon varepsilon ' +
    'zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi ' +
    'Sigma Phi Psi Omega left( right) left[ right] cdot times div pm mp leq geq neq approx equiv sim propto in notin subset subseteq ' +
    'supset cup cap emptyset forall exists neg land lor rightarrow leftarrow Rightarrow Leftrightarrow mapsto to mathbb{} mathbf{} ' +
    'mathrm{} mathcal{} mathit{} boldsymbol{} text{} hat{} bar{} vec{} dot{} ddot{} tilde{} overline{} underbrace{} overbrace{} ldots ' +
    'cdots vdots ddots quad qquad hline toprule midrule bottomrule multicolumn{}{}{} multirow{}{}{} textwidth linewidth today LaTeX ' +
    'TeX frametitle{} pause small large Large LARGE footnotesize scriptsize tiny normalsize huge Huge textcolor{}{} color{} ' +
    'appendix bibitem{} thanks{} tikz draw node usetikzlibrary{}').split(' ');
  const ENVIRONMENTS = ('figure figure* table table* equation equation* align align* gather gather* multline itemize enumerate description ' +
    'tabular tabular* center flushleft flushright abstract document minipage verbatim quote quotation frame block columns column ' +
    'theorem lemma proof definition corollary cases pmatrix bmatrix matrix vmatrix array subfigure tikzpicture axis thebibliography ' +
    'lstlisting verbatim* split titlepage appendix tcolorbox').split(' ');

  function collectLabels() {
    const set = new Set();
    for (const [p, e] of state.docs) if (/\.tex$/i.test(p)) for (const m of e.doc.getValue().matchAll(/\\label\{([^}]+)\}/g)) set.add(m[1]);
    return [...set].sort();
  }
  function collectBibKeys() {
    const set = new Set();
    for (const [p, e] of state.docs) {
      if (/\.bib$/i.test(p)) for (const m of e.doc.getValue().matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,/g)) if (!/^(string|comment|preamble)$/i.test(m[1])) set.add(m[2]);
      if (/\.tex$/i.test(p)) for (const m of e.doc.getValue().matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)) set.add(m[1]);
    }
    return [...set].sort();
  }
  function collectUserCommands() {
    const set = new Set();
    for (const [p, e] of state.docs) if (/\.(tex|sty)$/i.test(p)) for (const m of e.doc.getValue().matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z@]+)\}?(?:\[(\d)\])?/g)) set.add(m[1] + '{}'.repeat(Number(m[2] || 0)));
    return [...set];
  }
  function rank(list, prefix) {
    if (!prefix) return list.slice(0, 200);
    const lp = prefix.toLowerCase();
    const starts = list.filter(x => x.startsWith(prefix));
    const istarts = list.filter(x => !x.startsWith(prefix) && x.toLowerCase().startsWith(lp));
    const has = list.filter(x => !x.toLowerCase().startsWith(lp) && x.toLowerCase().includes(lp));
    return [...starts, ...istarts, ...has].slice(0, 200);
  }
  const applyWithPlaceholders = (c, data, completion) => {
    const text = completion.text;
    c.replaceRange(text, data.from, data.to, 'complete');
    const idx = text.search(/\{\}|\[\]/);
    if (idx >= 0) c.setCursor({ line: data.from.line, ch: data.from.ch + idx + 1 });
  };
  function latexHint(c) {
    const cur = c.getCursor();
    const line = c.getLine(cur.line);
    const before = line.slice(0, cur.ch);
    if (c.getTokenAt(cur).type === 'comment') return null;
    const after = line.slice(cur.ch);
    let m;
    const argList = (items, typed, kind) => ({
      list: rank(items, typed).map(t => ({ text: t, displayText: t, render: elt => { elt.innerHTML = `${esc(t)}<span class="hint-kind">${kind}</span>`; } })),
      from: { line: cur.line, ch: cur.ch - typed.length },
      to: cur,
    });
    if ((m = /\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref|vref)\{([^}]*)$/.exec(before))) return argList(collectLabels(), m[1], 'label');
    if ((m = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\[[^\]]*\]){0,2}\{(?:[^}]*,\s*)?([^,}\s]*)$/.exec(before))) return argList(collectBibKeys(), m[1], 'citation');
    if ((m = /\\includegraphics\*?(?:\[[^\]]*\])?\{([^}]*)$/.exec(before))) return argList(state.files.filter(f => f.type === 'file' && GRAPHIC_RE.test(f.path)).map(f => f.path), m[1], 'image');
    if ((m = /\\(?:input|include|subfile)\{([^}]*)$/.exec(before))) return argList(state.files.filter(f => /\.tex$/i.test(f.path) && f.path !== state.project.settings.main).map(f => f.path.replace(/\.tex$/i, '')), m[1], 'file');
    if ((m = /\\bibliography\{([^}]*)$/.exec(before))) return argList(state.files.filter(f => /\.bib$/i.test(f.path)).map(f => f.path.replace(/\.bib$/i, '')), m[1], 'bib');
    if ((m = /\\(begin|end)\{([A-Za-z*]*)$/.exec(before))) {
      const isBegin = m[1] === 'begin';
      const typed = m[2];
      const indent = /^\s*/.exec(line)[0];
      const to = after.startsWith('}') ? { line: cur.line, ch: cur.ch + 1 } : cur;
      return {
        list: rank(ENVIRONMENTS, typed).map(env => ({
          text: env,
          displayText: env,
          render: elt => { elt.innerHTML = `${esc(env)}<span class="hint-kind">environment</span>`; },
          hint: (cc, data) => {
            if (!isBegin) { cc.replaceRange(`${env}}`, data.from, to, 'complete'); return; }
            const inner = /^(itemize|enumerate|description)$/.test(env) ? '\\item ' : '';
            cc.replaceRange(`${env}}\n${indent}  ${inner}\n${indent}\\end{${env}}`, data.from, to, 'complete');
            cc.setCursor({ line: data.from.line + 1, ch: indent.length + 2 + inner.length });
          },
        })),
        from: { line: cur.line, ch: cur.ch - typed.length },
        to,
      };
    }
    if ((m = /\\([A-Za-z]*)$/.exec(before))) {
      const all = [...new Set([...COMMANDS, ...collectUserCommands()])];
      const list = rank(all, m[1]).map(t => ({ text: t, displayText: `\\${t}`, hint: applyWithPlaceholders }));
      if (!list.length) return null;
      return { list, from: { line: cur.line, ch: cur.ch - m[1].length }, to: cur };
    }
    return null;
  }
  cm.on('inputRead', (c, change) => {
    if (change.origin !== '+input') return;
    const ch = change.text[change.text.length - 1].slice(-1);
    if (!/[\\{,A-Za-z]/.test(ch)) return;
    setTimeout(() => {
      if (c.state.completionActive) return;
      const cur = c.getCursor();
      const before = c.getLine(cur.line).slice(0, cur.ch);
      if (/\\\\$/.test(before)) return;
      const cmdCtx = ch === '\\' ? /\\$/.test(before) : /[A-Za-z]/.test(ch) && /\\[A-Za-z]+$/.test(before);
      const argCtx = /\\(?:ref|eqref|autoref|cref|Cref|pageref|[a-zA-Z]*cite[a-zA-Z]*|includegraphics|input|include|begin|end|bibliography)\*?(?:\[[^\]]*\]){0,2}\{[^}]*$/.test(before);
      if (cmdCtx || argCtx) c.showHint({ hint: latexHint, completeSingle: false });
    }, 0);
  });

  /* ------------------------------------------- engine download progress */
  let progressHide = null;
  let lastProgressAt = 0;
  TexEngine.on('progress', p => {
    clearTimeout(progressHide);
    lastProgressAt = Date.now();
    const pct = p.total ? Math.min(100, (p.loaded / p.total) * 100) : 0;
    el.engineBox.hidden = false;
    el.engineLabel.textContent = p.label || 'Downloading';
    el.engineBar.style.width = `${pct.toFixed(1)}%`;
    el.engineDetail.textContent = `${fmtSize(p.loaded)} of ${fmtSize(p.total)} · saved for offline use`;
    if (p.loaded >= p.total) progressHide = setTimeout(() => { el.engineBox.hidden = true; }, 600);
  });
  TexEngine.on('status', text => { if (state.compiling) setCompileStatus('busy', text); });

  /* --------------------------------------------------------- compile */
  function setCompileStatus(kind, text) {
    el.compileStatus.className = `status ${kind}`;
    el.compileStatus.querySelector('.text').textContent = text;
  }

  // Fast mode is the default: only an explicit "off" turns it off.
  const isFast = () => !!(state.project && state.project.settings.draft !== false);
  function syncFastUI() {
    const on = isFast();
    el.fastMode.checked = on;
    el.fastMenuItem.classList.toggle('checked', on);
  }
  async function setFast(on) {
    state.project = await TFDB.updateProject(pid(), { settings: { draft: on } });
    syncFastUI();
    toast(on ? 'Fast compile on — images are shown as placeholders' : 'Fast compile off — full PDF with images');
    compile();
  }

  /* Long compiles: Normal mode never stops on its own — after a while it asks the user.
     Fast mode keeps an automatic safety stop, since a slow fast-compile almost always means an infinite loop. */
  const FAST_TIMEOUT = 150000;
  const ASK_AFTER = 30000;
  const ASK_AGAIN = 60000;
  let slowWatch = null;

  function startSlowWatch() {
    stopSlowWatch();
    const started = Date.now();
    slowWatch = { askAt: started + ASK_AFTER, tick: null };
    slowWatch.tick = setInterval(() => {
      const now = Date.now();
      el.slowElapsed.textContent = `${Math.round((now - started) / 1000)} s`;
      if (!el.slowBox.hidden || now < slowWatch.askAt) return;
      if (now - lastProgressAt < 4000) { slowWatch.askAt = now + 5000; return; } // still downloading TeX files
      el.slowBox.hidden = false;
    }, 1000);
  }
  function stopSlowWatch() {
    if (slowWatch) clearInterval(slowWatch.tick);
    slowWatch = null;
    el.slowBox.hidden = true;
  }
  el.keepWaitingBtn.onclick = () => {
    el.slowBox.hidden = true;
    if (slowWatch) slowWatch.askAt = Date.now() + ASK_AGAIN;
  };
  el.stopCompileBtn.onclick = () => stopCompile();

  function stopCompile() {
    if (!state.compiling) return;
    state.compileQueued = false;
    TexEngine.abort();
  }
  let askingStop = false;
  async function askStopCompile() {
    if (askingStop) return;
    askingStop = true;
    const ok = await confirmBox('Stop compiling?',
      'LaTeX is still running. If you stop now, the PDF you see stays as it is and this compile is discarded.' +
      (isFast() ? '' : '<br><br><span class="muted">Tip: turn on <b>Fast</b> to skip images while you edit.</span>'),
      'Stop compiling', true);
    askingStop = false;
    if (ok) stopCompile();
  }

  function setCompileButton(busy) {
    el.compileBtn.classList.toggle('busy', busy);
    el.compileBtn.querySelector('.label').textContent = busy ? 'Stop' : 'Recompile';
    el.compileBtn.title = busy ? 'Compiling — click to stop' : 'Recompile (Ctrl+Enter)';
  }

  async function compile({ auto = false, full = false } = {}) {
    if (!state.project) return;
    if (state.compiling) { state.compileQueued = true; return; }
    const draft = isFast() && !full;
    const project = pid();
    state.compiling = true;
    setCompileButton(true);
    if (!draft) startSlowWatch();
    el.compileVeil.hidden = !viewer.pages.length;
    setCompileStatus('busy', 'Compiling…');
    try {
      await saveAll();
      const recs = (await TFDB.listFiles(project)).filter(r => r.kind !== 'dir');
      const main = state.project.settings.main;
      if (!recs.some(r => r.path === main)) throw new Error(`The main document "${main}" does not exist. Set one with the ★ button in the file list.`);
      const files = recs.map(r => ({ path: r.path, v: r.v, load: () => (r.kind === 'text' ? r.text : r.blob.arrayBuffer()) }));
      const res = await TexEngine.compile(project, files, main, state.project.settings.engine, { draft, timeout: draft ? FAST_TIMEOUT : 0 });
      if (project !== pid()) return;

      const items = LogParse.parse(res.log, res.dir);
      if (!res.pdf && !items.some(i => i.level === 'error')) {
        items.unshift({ level: 'error', file: null, line: null, message: 'No PDF was produced. See the raw log for details.' });
      }
      state.result = { items, log: res.log, ms: res.ms, passes: res.passes, pdf: !!res.pdf };
      renderIssues();
      markIssues();
      if (res.pdf) {
        state.pdfBytes = new Uint8Array(res.pdf);
        state.pdfDraft = draft;
        state.sync = res.synctex ? SyncTeX.parse(res.synctex, { projectDir: res.dir }) : null;
        await showPdf(state.pdfBytes);
        el.draftBadge.hidden = !draft;
        TFDB.putOutput(project, { pdf: new Blob([state.pdfBytes], { type: 'application/pdf' }), synctex: res.synctex, dir: res.dir, log: res.log, items, draft }).catch(() => {});
      }
      const errors = items.filter(i => i.level === 'error').length;
      const warnings = items.filter(i => i.level === 'warning').length;
      const secs = (res.ms / 1000).toFixed(1);
      const mode = draft ? ' (fast)' : '';
      if (!res.pdf) {
        setCompileStatus('err', `Compile failed — ${errors || 1} error${errors === 1 ? '' : 's'}`);
        if (!auto || !viewer.pages.length) showLogs(true);
      } else if (errors) {
        setCompileStatus('err', `Compiled${mode} with ${errors} error${errors > 1 ? 's' : ''} · ${secs}s`);
      } else if (warnings) {
        setCompileStatus('warn', `Compiled${mode} · ${warnings} warning${warnings > 1 ? 's' : ''} · ${secs}s`);
      } else {
        setCompileStatus('ok', `Compiled${mode} in ${secs}s${res.passes > 1 ? ` · ${res.passes} passes` : ''}`);
      }
    } catch (err) {
      if (err.cancelled) {
        setCompileStatus('warn', 'Compilation stopped — showing the last PDF');
      } else {
        setCompileStatus('err', err.message);
        if (!auto) toast(err.message, 'error');
      }
    } finally {
      state.compiling = false;
      stopSlowWatch();
      if (askingStop && el.modal.open) el.modal.close('cancel'); // the compile finished on its own
      setCompileButton(false);
      el.compileVeil.hidden = true;
      if (state.compileQueued) { state.compileQueued = false; compile({ auto: true }); }
    }
  }

  const LEVEL_ORDER = { error: 0, warning: 1, typesetting: 2 };
  function renderIssues() {
    const res = state.result;
    if (!res) {
      el.issues.innerHTML = '<div class="issues-empty">Not compiled yet.</div>';
      el.rawLog.textContent = '';
      el.errBadge.hidden = el.warnBadge.hidden = true;
      return;
    }
    const items = res.items.filter(i => el.showBoxes.checked || i.level !== 'typesetting')
      .map((it, i) => ({ it, i }))
      .sort((a, b) => (LEVEL_ORDER[a.it.level] - LEVEL_ORDER[b.it.level]) || a.i - b.i)
      .map(x => x.it);
    const errors = res.items.filter(i => i.level === 'error').length;
    const warnings = res.items.filter(i => i.level === 'warning').length;
    el.errBadge.hidden = !errors;
    el.errBadge.textContent = errors;
    el.warnBadge.hidden = !warnings;
    el.warnBadge.textContent = warnings;
    if (!items.length) {
      el.issues.innerHTML = `<div class="issues-empty"><div class="big">No problems found</div><div class="muted">${res.items.length ? `${res.items.length} box warning(s) hidden` : 'Clean compile.'}</div></div>`;
    } else {
      el.issues.replaceChildren(...items.map(it => {
        const b = document.createElement('button');
        b.className = `issue ${it.level}`;
        const loc = it.file ? `${it.file}${it.line ? `:${it.line}` : ''}` : '';
        b.innerHTML = `<div class="issue-head"><span class="lvl">${it.level === 'typesetting' ? 'box' : it.level}</span><span class="loc">${esc(loc)}</span></div>` +
          `<div class="msg">${esc(it.message)}</div>` + (it.context ? `<pre>${esc(it.context)}</pre>` : '');
        b.onclick = () => {
          const target = it.file || (it.line ? state.project.settings.main : null);
          if (target && state.files.some(f => f.path === target)) {
            openFile(target, it.line, { flash: true });
            if (narrow()) setLayout('editor');
          }
        };
        return b;
      }));
    }
    el.rawLog.textContent = res.log || '';
  }
  el.showBoxes.onchange = () => { prefs.set('showBoxes', el.showBoxes.checked); renderIssues(); markIssues(); };

  function markIssues() {
    const entry = state.docs.get(state.current);
    cm.clearGutter('cm-issues');
    if (!entry) return;
    for (const h of entry.lineHandles) entry.doc.removeLineClass(h.handle, 'background', h.cls);
    entry.lineHandles = [];
    if (!state.result) return;
    const byLine = new Map();
    for (const it of state.result.items) {
      if (it.file !== state.current || !it.line) continue;
      if (it.level === 'typesetting' && !el.showBoxes.checked) continue;
      const prev = byLine.get(it.line);
      if (!prev) byLine.set(it.line, { level: it.level, msgs: [it.message] });
      else {
        prev.msgs.push(it.message);
        if (LEVEL_ORDER[it.level] < LEVEL_ORDER[prev.level]) prev.level = it.level;
      }
    }
    for (const [line, info] of byLine) {
      const ln = line - 1;
      if (ln < 0 || ln >= cm.lineCount()) continue;
      const mk = document.createElement('div');
      mk.className = `issue-marker ${info.level}`;
      mk.title = info.msgs.join('\n');
      cm.setGutterMarker(ln, 'cm-issues', mk);
      if (info.level !== 'typesetting') {
        const cls = info.level === 'error' ? 'cm-line-error' : 'cm-line-warning';
        entry.lineHandles.push({ handle: cm.addLineClass(ln, 'background', cls), cls });
      }
    }
  }
  cm.on('gutterClick', (c, line, gutter) => { if (gutter === 'cm-issues') showLogs(true); });

  function showLogs(show) {
    el.logView.hidden = !show;
    el.logBtn.classList.toggle('active', show);
    if (show && el.body.classList.contains('layout-editor')) setLayout('split');
  }
  el.logBtn.onclick = () => showLogs(el.logView.hidden);
  $('#closeLogBtn').onclick = () => showLogs(false);
  document.querySelectorAll('[data-logtab]').forEach(b => { b.onclick = () => {
    document.querySelectorAll('[data-logtab]').forEach(x => x.classList.toggle('active', x === b));
    el.issues.hidden = b.dataset.logtab !== 'issues';
    el.rawLog.hidden = b.dataset.logtab !== 'raw';
  }; });

  /* ------------------------------------------------------ PDF viewer */
  const viewer = { doc: null, pages: [], scale: 1, zoom: prefs.get('zoom', 'fit'), gen: 0, observer: null };
  el.zoomSelect.value = String(viewer.zoom);
  if (el.zoomSelect.value !== String(viewer.zoom)) { viewer.zoom = 'fit'; el.zoomSelect.value = 'fit'; }

  async function showPdf(bytes) {
    const project = pid();
    let doc;
    try {
      doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    } catch (err) { toast(`Could not read PDF: ${err.message}`, 'error'); return; }
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push(await doc.getPage(i));
    if (project !== pid()) { doc.destroy(); return; }
    const old = viewer.doc;
    viewer.doc = doc;
    await buildPages(pages, captureAnchor());
    if (old && old !== doc) old.destroy();
  }

  function captureAnchor() {
    const vp = el.pdfViewport;
    if (!viewer.pages.length) return null;
    const top = vp.scrollTop;
    for (let i = 0; i < viewer.pages.length; i++) {
      const d = viewer.pages[i].div;
      if (d.offsetTop + d.offsetHeight > top) return { index: i, frac: (top - d.offsetTop) / d.offsetHeight, left: vp.scrollLeft };
    }
    return { index: viewer.pages.length - 1, frac: 0, left: 0 };
  }

  function computeScale(page) {
    const base = page.getViewport({ scale: 1 });
    const vp = el.pdfViewport;
    const w = Math.max(200, vp.clientWidth - 34);
    const h = Math.max(200, vp.clientHeight - 34);
    if (viewer.zoom === 'fit') return w / base.width;
    if (viewer.zoom === 'page') return Math.min(w / base.width, h / base.height);
    return Number(viewer.zoom) * (96 / 72);
  }

  async function buildPages(pages, anchor) {
    const gen = ++viewer.gen;
    if (!pages.length) return;
    const scale = computeScale(pages[0]);
    const infos = pages.map((page, i) => {
      const v = page.getViewport({ scale });
      const div = document.createElement('div');
      div.className = 'pdf-page';
      div.style.width = `${Math.floor(v.width)}px`;
      div.style.height = `${Math.floor(v.height)}px`;
      div.dataset.index = i;
      div.innerHTML = `<span class="page-num">${i + 1}</span>`;
      return { page, div, scale, rendered: false, rendering: null, task: null, canvas: null };
    });
    const center = anchor ? Math.min(anchor.index, infos.length - 1) : 0;
    await Promise.all([center, center + 1].filter(i => i < infos.length).map(i => renderPage(infos[i])));
    if (gen !== viewer.gen) return;
    viewer.observer?.disconnect();
    viewer.pages.forEach(p => p.task?.cancel());
    el.pdfPages.replaceChildren(...infos.map(i => i.div));
    viewer.pages = infos;
    viewer.scale = scale;
    el.pdfEmpty.hidden = true;
    if (anchor) {
      const d = infos[center].div;
      el.pdfViewport.scrollTop = d.offsetTop + anchor.frac * d.offsetHeight;
      el.pdfViewport.scrollLeft = anchor.left;
    }
    viewer.observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        const info = viewer.pages[Number(e.target.dataset.index)];
        if (!info) continue;
        if (e.isIntersecting) renderPage(info);
        else if (info.rendered && Math.abs(Number(e.target.dataset.index) - currentPageIndex()) > 6) unrenderPage(info);
      }
    }, { root: el.pdfViewport, rootMargin: '800px 0px' });
    infos.forEach(i => viewer.observer.observe(i.div));
    el.pageCount.textContent = `/ ${infos.length}`;
    updatePageIndicator();
  }

  function renderPage(info) {
    if (info.rendered) return Promise.resolve();
    if (info.rendering) return info.rendering;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const v = info.page.getViewport({ scale: info.scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(v.width);
    canvas.height = Math.floor(v.height);
    const task = info.page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: v });
    info.task = task;
    info.rendering = task.promise
      .then(() => { info.canvas?.remove(); info.canvas = canvas; info.div.prepend(canvas); info.rendered = true; })
      .catch(() => { /* cancelled */ })
      .finally(() => { info.rendering = null; info.task = null; });
    return info.rendering;
  }
  function unrenderPage(info) {
    info.task?.cancel();
    if (info.canvas) { info.canvas.width = 0; info.canvas.remove(); info.canvas = null; }
    info.rendered = false;
  }

  function currentPageIndex() {
    const vp = el.pdfViewport;
    const probe = vp.scrollTop + vp.clientHeight * 0.33;
    let idx = 0;
    for (let i = 0; i < viewer.pages.length; i++) {
      if (viewer.pages[i].div.offsetTop <= probe) idx = i; else break;
    }
    return idx;
  }
  function updatePageIndicator() {
    if (!viewer.pages.length) { el.pageInput.value = '–'; el.pageCount.textContent = '/ –'; return; }
    if (document.activeElement !== el.pageInput) el.pageInput.value = currentPageIndex() + 1;
  }
  let scrollRaf = 0;
  el.pdfViewport.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updatePageIndicator(); });
  }, { passive: true });

  function goToPage(n) {
    const info = viewer.pages[Math.max(0, Math.min(viewer.pages.length - 1, n - 1))];
    if (info) el.pdfViewport.scrollTop = info.div.offsetTop - 12;
  }
  el.pageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { goToPage(parseInt(el.pageInput.value, 10) || 1); el.pageInput.blur(); }
  });
  el.pageInput.addEventListener('focus', () => el.pageInput.select());
  el.pageInput.addEventListener('blur', updatePageIndicator);

  function setZoom(z) {
    viewer.zoom = z;
    prefs.set('zoom', z);
    el.zoomSelect.value = String(z);
    if (el.zoomSelect.value !== String(z)) {
      el.zoomSelect.querySelectorAll('[data-custom]').forEach(x => x.remove());
      const o = new Option(`${Math.round(Number(z) * 100)}%`, String(z));
      o.dataset.custom = '1';
      el.zoomSelect.add(o);
      el.zoomSelect.value = String(z);
    }
    if (viewer.pages.length) buildPages(viewer.pages.map(p => p.page), captureAnchor());
  }
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  function stepZoom(dir) {
    const cur = viewer.scale / (96 / 72);
    const next = dir > 0 ? ZOOM_STEPS.find(s => s > cur + 0.01) : [...ZOOM_STEPS].reverse().find(s => s < cur - 0.01);
    if (next) setZoom(next);
  }
  el.zoomSelect.onchange = () => setZoom(el.zoomSelect.value);
  $('#zoomInBtn').onclick = () => stepZoom(1);
  $('#zoomOutBtn').onclick = () => stepZoom(-1);
  el.pdfViewport.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    stepZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  const relayout = debounce(() => {
    if (viewer.pages.length && (viewer.zoom === 'fit' || viewer.zoom === 'page')) {
      const s = computeScale(viewer.pages[0].page);
      if (Math.abs(s - viewer.scale) > 0.005) buildPages(viewer.pages.map(p => p.page), captureAnchor());
    }
  }, 120);
  new ResizeObserver(relayout).observe(el.pdfViewport);

  function resetViewer() {
    viewer.gen++;
    viewer.observer?.disconnect();
    viewer.pages.forEach(p => p.task?.cancel());
    viewer.pages = [];
    viewer.doc?.destroy();
    viewer.doc = null;
    el.pdfPages.replaceChildren();
    el.pdfEmpty.hidden = false;
    updatePageIndicator();
  }

  /* ---------------------------------------------------------- SyncTeX */
  async function syncToPdf() {
    if (!state.current || !/\.tex$/i.test(state.current)) { toast('Place the cursor in a .tex file first'); return; }
    if (!viewer.pages.length || !state.sync) { toast('Compile the document first'); return; }
    const c = cm.getCursor();
    const results = state.sync.forward(state.current, c.line + 1);
    if (!results.length) { toast('No matching spot in the PDF yet — recompile if you just added this'); return; }
    if (el.body.classList.contains('layout-editor')) setLayout('split');
    if (narrow()) setLayout('pdf');
    showLogs(false);
    const page = results[0].page;
    const info = viewer.pages[page - 1];
    if (!info) return;
    info.div.querySelectorAll('.sync-box').forEach(b => b.remove());
    let minTop = Infinity;
    for (const r of results.filter(x => x.page === page).slice(0, 12)) {
      const b = document.createElement('div');
      b.className = 'sync-box';
      const s = info.scale;
      const top = (r.v - Math.max(r.H, 8)) * s;
      b.style.left = `${Math.max(0, r.h * s - 2)}px`;
      b.style.top = `${top - 2}px`;
      b.style.width = `${Math.max(r.W, 12) * s + 4}px`;
      b.style.height = `${Math.max(r.H, 8) * s + 4}px`;
      info.div.append(b);
      minTop = Math.min(minTop, top);
      setTimeout(() => b.remove(), 2600);
    }
    el.pdfViewport.scrollTo({ top: info.div.offsetTop + minTop - el.pdfViewport.clientHeight / 3, behavior: 'smooth' });
  }

  async function syncToCode(page, x, y) {
    if (!state.sync) { toast('Compile the document first'); return; }
    let r = state.sync.inverse(page, x, y);
    if (r && r.bibliography) {
      // a reference list entry: jump to the \bibliography / \printbibliography command instead
      r = null;
      for (const [p, e] of state.docs) {
        if (!/\.tex$/i.test(p)) continue;
        const lines = e.doc.getValue().split('\n');
        const i = lines.findIndex(l => /^[^%]*\\(bibliography|printbibliography)\b/.test(l));
        if (i >= 0) { r = { file: p, line: i + 1 }; break; }
      }
      if (!r) { toast('That is generated bibliography text — edit your .bib file'); return; }
    }
    if (!r || !r.file || !state.files.some(f => f.path === r.file)) { toast('No source found for that spot'); return; }
    if (narrow()) setLayout('editor');
    else if (el.body.classList.contains('layout-pdf')) setLayout('split');
    await openFile(r.file, r.line, { flash: true });
  }

  el.pdfPages.addEventListener('dblclick', e => {
    const div = e.target.closest('.pdf-page');
    if (!div) return;
    const info = viewer.pages[Number(div.dataset.index)];
    const r = div.getBoundingClientRect();
    window.getSelection()?.removeAllRanges();
    syncToCode(Number(div.dataset.index) + 1, (e.clientX - r.left) / info.scale, (e.clientY - r.top) / info.scale);
  });
  $('#syncToPdfBtn').onclick = () => syncToPdf();
  $('#syncToCodeBtn').onclick = () => {
    if (!viewer.pages.length) { toast('Compile the document first'); return; }
    const idx = currentPageIndex();
    const info = viewer.pages[idx];
    const vp = el.pdfViewport;
    const yInPage = Math.max(20, vp.scrollTop + vp.clientHeight * 0.33 - info.div.offsetTop);
    syncToCode(idx + 1, info.div.offsetWidth / 2 / info.scale, yInPage / info.scale);
  };

  /* ---------------------------------------------------------- modals */
  function openModal({ title, body, okText = 'OK', danger = false, okHidden = false, cancelText = 'Cancel', wide = false, cancelHidden = false }) {
    return new Promise(resolve => {
      el.modal.classList.toggle('wide', wide);
      el.modal.querySelector('[value="cancel"]').hidden = cancelHidden;
      el.modalTitle.textContent = title;
      el.modalBody.replaceChildren(body);
      el.modalOk.textContent = okText;
      el.modalOk.className = `btn ${danger ? 'danger' : 'primary'}`;
      el.modalOk.hidden = okHidden;
      el.modal.querySelector('[value="cancel"]').textContent = cancelText;
      el.modal.returnValue = '';
      el.modal.addEventListener('close', () => resolve(el.modal.returnValue === 'ok'), { once: true });
      el.modal.showModal();
      const input = body.querySelector('input[type="text"], select');
      if (input) setTimeout(() => input.focus(), 0);
    });
  }
  async function promptText(title, label, value = '', { selectName = false, hint = '' } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label>${esc(label)}</label><input type="text" required spellcheck="false" autocomplete="off">${hint ? `<p class="hint">${esc(hint)}</p>` : ''}`;
    const input = wrap.querySelector('input');
    input.value = value;
    setTimeout(() => {
      input.focus();
      if (selectName) {
        const start = value.lastIndexOf('/') + 1;
        const dot = value.lastIndexOf('.');
        input.setSelectionRange(start, dot > start ? dot : value.length);
      } else input.select();
    }, 10);
    const ok = await openModal({ title, body: wrap });
    return ok ? input.value.trim() : null;
  }
  async function confirmBox(title, html, okText = 'OK', danger = false) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<p>${html}</p>`;
    return openModal({ title, body: wrap, okText, danger });
  }

  /* -------------------------------------------------------- templates */
  function samplePng() {
    const w = 960;
    const h = 540;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#fafbff');
    grad.addColorStop(1, '#e8eefc');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d5dbe8';
    g.lineWidth = 1;
    for (let x = 0; x <= w; x += 60) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
    for (let y = 0; y <= h; y += 60) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
    g.strokeStyle = '#3c3c46';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    const curve = (fn, color) => {
      g.strokeStyle = color;
      g.lineWidth = 6;
      g.lineJoin = 'round';
      g.beginPath();
      for (let x = 0; x <= w; x += 2) { const y = fn(x); if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    };
    curve(x => h / 2 - h * 0.32 * Math.sin((x / w) * Math.PI * 4) * Math.exp(-x / w), '#2563eb');
    curve(x => h / 2 - h * 0.32 * Math.cos((x / w) * Math.PI * 4) * Math.exp(-x / w), '#16a34a');
    return new Promise(r => c.toBlob(r, 'image/png'));
  }

  const TEMPLATES = {
    article: {
      label: 'Article — figure, maths, table, bibliography',
      files: async () => [
        { path: 'main.tex', data: String.raw`\documentclass[11pt]{article}
\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage[margin=1in]{geometry}
\usepackage{hyperref}

\title{A Texlume Starter Document}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
This document shows the main features of Texlume: live compilation in
your browser, embedded figures, cross-references, a bibliography and
two-way SyncTeX. Double-click anywhere in the PDF to jump to the source.
\end{abstract}

\section{Introduction}
\LaTeX{} was built on top of \TeX{} by Leslie Lamport~\cite{lamport1994},
while \TeX{} itself is the work of Donald Knuth~\cite{knuth1984}.
Figure~\ref{fig:sample} shows an embedded image, and
Equation~\eqref{eq:gauss} is typeset in display mode.

\section{Mathematics}
The Gaussian integral is
\begin{equation}
  \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}.
  \label{eq:gauss}
\end{equation}
Inline maths works too: $a^2 + b^2 = c^2$.

\section{Figures}
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.75\linewidth]{images/sample.png}
  \caption{A damped sine and cosine. Drop or paste your own images into
  the editor to insert them.}
  \label{fig:sample}
\end{figure}

\section{Tables}
\begin{table}[htbp]
  \centering
  \begin{tabular}{lrr}
    \toprule
    Engine   & Unicode & Speed \\
    \midrule
    pdfLaTeX & partial & fast \\
    XeLaTeX  & full    & slower \\
    \bottomrule
  \end{tabular}
  \caption{TeX engines you can pick from the toolbar.}
  \label{tab:engines}
\end{table}

\bibliographystyle{plain}
\bibliography{refs}

\end{document}
` },
        { path: 'refs.bib', data: `@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}

@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {{\\LaTeX}: A Document Preparation System},
  edition   = {2nd},
  publisher = {Addison-Wesley},
  year      = {1994}
}
` },
        { path: 'images/sample.png', data: await samplePng() },
      ],
    },
    beamer: {
      label: 'Beamer presentation',
      files: async () => [
        { path: 'main.tex', data: String.raw`\documentclass{beamer}
\usetheme{Madrid}
\usepackage{graphicx}

\title{My Presentation}
\author{Your Name}
\date{\today}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{Motivation}
\begin{frame}{Why this matters}
  \begin{itemize}
    \item<1-> First point
    \item<2-> Second point
    \item<3-> Third point
  \end{itemize}
\end{frame}

\section{Results}
\begin{frame}{A figure}
  \centering
  \includegraphics[width=0.8\linewidth]{images/sample.png}
\end{frame}

\end{document}
` },
        { path: 'images/sample.png', data: await samplePng() },
      ],
    },
    tikz: {
      label: 'TikZ & pgfplots figure',
      files: async () => [{ path: 'main.tex', data: String.raw`\documentclass{article}
\usepackage{tikz}
\usepackage{pgfplots}
\pgfplotsset{compat=1.17}

\begin{document}

\section*{A TikZ drawing}
\begin{tikzpicture}
  \draw[thick, ->] (0,0) -- (4,0) node[right] {$x$};
  \draw[thick, ->] (0,0) -- (0,3) node[above] {$y$};
  \draw[blue, thick, domain=0:3.5, smooth] plot (\x, {0.2*\x*\x});
  \fill[red] (2,0.8) circle (2pt) node[above left] {$P$};
\end{tikzpicture}

\section*{A pgfplots chart}
\begin{tikzpicture}
  \begin{axis}[xlabel={$x$}, ylabel={$f(x)$}, grid=major, width=10cm]
    \addplot[blue, thick, domain=-2:2, samples=60] {x^3 - x};
    \addplot[orange, thick, domain=-2:2, samples=60] {exp(-x^2)};
    \legend{$x^3-x$, $e^{-x^2}$}
  \end{axis}
\end{tikzpicture}

\end{document}
` }],
    },
    blank: {
      label: 'Blank document',
      files: async () => [{ path: 'main.tex', data: String.raw`\documentclass{article}
\usepackage{graphicx}

\begin{document}

Hello, world!

\end{document}
` }],
    },
  };

  /* -------------------------------------------------------- projects */
  async function loadProjects(preferId) {
    const projects = await TFDB.listProjects();
    if (!projects.length) {
      const p = await TFDB.createProject('Getting Started', await TEMPLATES.article.files());
      TFDB.persist();
      return loadProjects(p.id);
    }
    renderProjectSelect(projects);
    const want = [preferId, prefs.get('project')].find(id => id && projects.some(p => p.id === id)) || projects[0].id;
    el.projectSelect.value = want;
    await openProject(want);
  }

  async function openProject(id) {
    if (state.project && anyDirty()) await saveAll().catch(() => {});
    const project = await TFDB.getProject(id);
    if (!project) return;
    state.project = project;
    prefs.set('project', id);
    document.title = `${project.name} — Texlume`;
    state.docs.clear();
    state.current = null;
    state.lastTex = null;
    state.result = null;
    state.sync = null;
    state.pdfBytes = null;
    state.collapsed.clear();
    state.selectedDir = '';
    resetViewer();
    renderIssues();
    showLogs(false);
    setCompileStatus('', 'Ready');
    setSaveStatus('');
    el.engineSelect.value = project.settings.engine === 'xelatex' ? 'xelatex' : 'pdflatex';
    syncFastUI();
    el.draftBadge.hidden = true;

    const recs = await refreshFiles();
    for (const r of recs) {
      if (r.kind === 'text' && isText(r.path) && r.size < 2e6) makeDoc(r.path, r.text);
    }
    renderTree();
    const last = prefs.get(`last:${id}`);
    const first = [last, project.settings.main].find(p => p && state.files.some(f => f.path === p && f.type === 'file'))
      || state.files.find(f => f.type === 'file' && /\.tex$/i.test(f.path))?.path;
    if (first) await openFile(first);
    else { cm.swapDoc(CodeMirror.Doc('', 'stex')); cm.setOption('readOnly', 'nocursor'); renderCrumb(); }

    // show the last PDF straight away, then refresh it
    const out = await TFDB.getOutput(id).catch(() => null);
    if (out && out.pdf && id === pid()) {
      state.pdfBytes = new Uint8Array(await out.pdf.arrayBuffer());
      state.pdfDraft = !!out.draft;
      el.draftBadge.hidden = !out.draft;
      state.sync = out.synctex ? SyncTeX.parse(out.synctex, { projectDir: out.dir }) : null;
      state.result = { items: out.items || [], log: out.log || '', pdf: true };
      renderIssues();
      markIssues();
      await showPdf(state.pdfBytes);
    }
    if (state.autoCompile || !out) compile({ auto: true });
  }

  async function newProject() {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<label>Project name</label><input type="text" required maxlength="80" spellcheck="false" autocomplete="off" placeholder="My Paper">' +
      `<label>Template</label><select>${Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>` +
      '<p class="hint">Or use “Import project (.zip)” in the ⋯ menu to open an Overleaf export.</p>';
    const ok = await openModal({ title: 'New project', body: wrap, okText: 'Create' });
    if (!ok) return;
    const name = wrap.querySelector('input').value.trim() || 'Untitled';
    const tpl = TEMPLATES[wrap.querySelector('select').value] || TEMPLATES.blank;
    const p = await TFDB.createProject(name, await tpl.files());
    TFDB.persist();
    await loadProjects(p.id);
  }

  async function importZip(file) {
    try {
      const entries = await Zip.read(await file.arrayBuffer());
      let list = entries.filter(e => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(e.name));
      // strip a single common top-level folder
      const tops = new Set(list.map(e => e.name.split('/')[0]));
      if (tops.size === 1 && list.every(e => e.name.includes('/'))) list = list.map(e => ({ ...e, name: e.name.slice(e.name.indexOf('/') + 1) }));
      const dec = new TextDecoder();
      const files = list.filter(e => cleanPath(e.name)).map(e => ({
        path: cleanPath(e.name),
        data: isText(e.name) ? dec.decode(e.data) : new Blob([e.data]),
      }));
      if (!files.length) throw new Error('The zip is empty');
      let main = files.find(f => f.path === 'main.tex')?.path;
      if (!main) main = files.find(f => typeof f.data === 'string' && /\.tex$/i.test(f.path) && /^[^%\n]*\\documentclass/m.test(f.data))?.path;
      if (!main) main = files.find(f => /\.tex$/i.test(f.path))?.path || 'main.tex';
      const name = file.name.replace(/\.zip$/i, '') || 'Imported project';
      const p = await TFDB.createProject(name, files, { main });
      TFDB.persist();
      toast(`Imported ${files.length} files — main document: ${main}`);
      await loadProjects(p.id);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'error');
    }
  }

  function renderProjectSelect(projects) {
    el.projectSelect.innerHTML = projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if (pid() && projects.some(p => p.id === pid())) el.projectSelect.value = pid();
  }

  /** Delete one project and everything stored for it in this browser. */
  async function deleteProjectById(id) {
    TexEngine.forget(id);
    await TFDB.deleteProject(id);
    try { localStorage.removeItem(`texforge:last:${id}`); } catch { /* ignore */ }
    if (id === pid()) { state.project = null; prefs.set('project', null); }
  }

  /* ------------------------------------------------- project manager */
  async function manageProjects() {
    await saveAll().catch(() => {});
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="project-list" id="projectList"></div>' +
      '<p class="hint">Projects are stored only in this browser. Deleting one removes its files and PDF permanently — use ⋯ → Download source (.zip) first if you want a copy.</p>';
    const list = wrap.querySelector('#projectList');
    let deletedCurrent = false;
    let changed = false;

    const render = async () => {
      const projects = await TFDB.listProjects();
      const rows = await Promise.all(projects.map(async p => {
        const files = (await TFDB.listFiles(p.id)).filter(f => f.kind !== 'dir');
        return { p, count: files.length, size: files.reduce((s, f) => s + (f.size || 0), 0) };
      }));
      if (!rows.length) { list.innerHTML = '<p class="muted">No projects left. A new “Getting Started” project will be created when you close this.</p>'; return; }
      list.replaceChildren(...rows.map(({ p, count, size }) => {
        const row = document.createElement('div');
        row.className = `project-row${p.id === pid() ? ' current' : ''}`;
        const when = new Date(p.updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        row.innerHTML =
          `<div class="p-info"><div class="p-name">${esc(p.name)}${p.id === pid() ? '<span class="current-tag">OPEN</span>' : ''}</div>` +
          `<div class="p-meta">Edited ${esc(when)} · ${count} file${count === 1 ? '' : 's'} · ${fmtSize(size)}</div></div>` +
          '<div class="p-actions">' +
          (p.id === pid() ? '' : '<button type="button" class="btn" data-pa="open">Open</button>') +
          '<button type="button" class="btn" data-pa="rename">Rename</button>' +
          `<button type="button" class="btn" data-pa="delete" title="Delete ${esc(p.name)}">${svg('trash')}Delete</button>` +
          '</div>';
        row.querySelector('[data-pa="open"]')?.addEventListener('click', () => {
          el.modal.close('cancel');
          el.projectSelect.value = p.id;
          openProject(p.id);
        });
        row.querySelector('[data-pa="rename"]').addEventListener('click', () => {
          const nameEl = row.querySelector('.p-name');
          const input = document.createElement('input');
          input.type = 'text';
          input.value = p.name;
          input.maxLength = 80;
          input.style.margin = '0';
          nameEl.replaceWith(input);
          input.focus();
          input.select();
          const commit = async () => {
            const name = input.value.trim();
            if (name && name !== p.name) {
              const updated = await TFDB.updateProject(p.id, { name });
              if (p.id === pid()) { state.project = updated; document.title = `${name} — Texlume`; }
              changed = true;
            }
            render();
          };
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); render(); }
          });
          input.addEventListener('blur', commit, { once: true });
        });
        const del = row.querySelector('[data-pa="delete"]');
        let armed = null;
        del.addEventListener('click', async () => {
          if (!armed) {
            // first click arms, second click (within 4 s) deletes
            del.classList.add('confirming');
            del.innerHTML = `${svg('trash')}Delete forever?`;
            armed = setTimeout(() => { armed = null; del.classList.remove('confirming'); del.innerHTML = `${svg('trash')}Delete`; }, 4000);
            return;
          }
          clearTimeout(armed);
          if (p.id === pid()) deletedCurrent = true;
          await deleteProjectById(p.id);
          changed = true;
          toast(`Deleted “${p.name}”`);
          render();
        });
        return row;
      }));
    };
    await render();
    await openModal({ title: 'Your projects', body: wrap, okText: 'Done', wide: true, cancelHidden: true });
    if (deletedCurrent || !(await TFDB.listProjects()).length) await loadProjects();
    else if (changed) renderProjectSelect(await TFDB.listProjects());
  }

  el.projectSelect.onchange = () => openProject(el.projectSelect.value);
  $('#manageProjectsBtn').onclick = () => manageProjects();
  $('#texInfo').onclick = () => showAbout();
  $('#newProjectBtn').onclick = () => newProject();
  el.engineSelect.onchange = async () => {
    state.project = await TFDB.updateProject(pid(), { settings: { engine: el.engineSelect.value } });
    compile();
  };
  el.compileBtn.onclick = () => (state.compiling ? askStopCompile() : compile());
  el.autoCompile.checked = state.autoCompile;
  el.autoCompile.onchange = () => {
    state.autoCompile = el.autoCompile.checked;
    prefs.set('autoCompile', state.autoCompile);
    if (state.autoCompile) compile({ auto: true });
  };
  el.showBoxes.checked = prefs.get('showBoxes', false);
  el.fastMode.onchange = () => setFast(el.fastMode.checked);
  el.draftBadge.onclick = () => compile({ full: true });
  el.importInput.onchange = () => { if (el.importInput.files[0]) importZip(el.importInput.files[0]); };

  /* ------------------------------------------------------------ menu */
  $('#menuBtn').onclick = e => { e.stopPropagation(); el.menu.hidden = !el.menu.hidden; };
  document.addEventListener('click', e => { if (!el.menu.hidden && !el.menu.contains(e.target)) el.menu.hidden = true; });
  el.menu.addEventListener('click', async e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    el.menu.hidden = true;
    const act = b.dataset.action;
    if (act === 'new-project') newProject();
    else if (act === 'manage-projects') manageProjects();
    else if (act === 'import') { el.importInput.value = ''; el.importInput.click(); }
    else if (act === 'toggle-fast') setFast(!isFast());
    else if (act === 'download-pdf') downloadPdf();
    else if (act === 'download-zip') downloadZip();
    else if (act === 'clean') {
      TexEngine.forget(pid());
      toast('Cleared cached build files (.aux, .bbl, …) for this project');
      compile();
    } else if (act === 'rename-project') {
      const name = await promptText('Rename project', 'Project name', state.project.name);
      if (!name || name === state.project.name) return;
      await TFDB.updateProject(pid(), { name });
      await loadProjects(pid());
    } else if (act === 'delete-project') {
      const ok = await confirmBox('Delete project', `Permanently delete <b>${esc(state.project.name)}</b> and all of its files from this browser? This cannot be undone — download a .zip first if you want a copy.`, 'Delete project', true);
      if (!ok) return;
      await deleteProjectById(pid());
      await loadProjects();
    } else if (act === 'shortcuts') showShortcuts();
    else if (act === 'about') showAbout();
  });

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fileStem = () => (state.project.name || 'document').replace(/[^\w.-]+/g, '_');
  function downloadPdf() {
    if (!state.pdfBytes) { toast('Compile the document first'); return; }
    if (state.pdfDraft) toast('This PDF was compiled in fast mode, so images are placeholders. Click “Fast · no images” for the full PDF.', 'error');
    saveBlob(new Blob([state.pdfBytes], { type: 'application/pdf' }), `${fileStem()}.pdf`);
  }
  async function downloadZip() {
    await saveAll().catch(() => {});
    const recs = (await TFDB.listFiles(pid())).filter(r => r.kind !== 'dir');
    const enc = new TextEncoder();
    const entries = await Promise.all(recs.map(async r => ({
      name: `${fileStem()}/${r.path}`,
      data: r.kind === 'text' ? enc.encode(r.text) : new Uint8Array(await r.blob.arrayBuffer()),
      mtime: r.mtime,
    })));
    saveBlob(await Zip.create(entries), `${fileStem()}.zip`);
  }
  $('#downloadPdfBtn').onclick = downloadPdf;

  function showShortcuts() {
    const k = s => s.split('+').map(x => `<kbd>${x === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : x}</kbd>`).join('+');
    const rows = [
      ['Mod+Enter', 'Recompile'], ['Mod+S', 'Save and recompile'], ['Mod+Alt+J', 'Show cursor position in PDF'],
      ['Double-click PDF', 'Jump to source line'], ['Mod+B / Mod+I', 'Bold / italic'], ['Mod+/', 'Toggle comment'],
      ['Ctrl+Space', 'Autocomplete'], ['Mod+F', 'Find'], ['Shift+Mod+F', 'Find and replace'], ['Alt+G', 'Go to line'],
      ['Mod+Wheel', 'Zoom PDF'], ['Paste / drop image', 'Add and insert a figure'],
    ];
    const wrap = document.createElement('div');
    wrap.innerHTML = `<dl class="shortcut-list">${rows.map(([a, b]) => `<dt>${a.includes(' ') && !a.includes('+') ? esc(a) : a.split(' / ').map(k).join(' / ')}</dt><dd>${esc(b)}</dd>`).join('')}</dl>`;
    openModal({ title: 'Keyboard shortcuts', body: wrap, okText: 'Close', okHidden: false, cancelText: 'Done' });
  }

  async function showAbout() {
    const est = await TFDB.usage();
    const wrap = document.createElement('div');
    wrap.innerHTML =
      `<p class="about-lead">${svg('lock')} <span>Your projects never leave this device. Files are stored in this browser (IndexedDB) and compiled here by TeX Live running in WebAssembly — nothing is uploaded.</span></p>` +
      '<ul class="about-list">' +
      '<li>The TeX engine (~23 MB) downloads from this site the first time, then works offline. Extra packages and XeLaTeX download only when a document needs them.</li>' +
      '<li>Clearing site data in your browser deletes your projects. Use <b>Download source (.zip)</b> to keep a backup.</li>' +
      '<li>Engines: pdfLaTeX and XeLaTeX with BibTeX (TeX Live 2023, via BusyTeX). LuaLaTeX, Biber and shell-escape are not available in the browser.</li>' +
      '</ul>' +
      (est ? `<p class="muted">Storage used by this site: ${fmtSize(est.usage || 0)}${est.quota ? ` of ${fmtSize(est.quota)} available` : ''}.</p>` : '') +
      '<button type="button" class="btn" id="clearEngine">Remove downloaded TeX files</button>';
    wrap.querySelector('#clearEngine').onclick = async () => {
      await TexEngine.clearCache();
      toast('Removed the cached TeX engine. It will download again on the next compile.');
      el.modal.close('cancel');
    };
    openModal({ title: 'About Texlume', body: wrap, okText: 'Close' });
  }

  /* ---------------------------------------------------------- layout */
  function setLayout(l) {
    el.body.classList.remove('layout-editor', 'layout-split', 'layout-pdf');
    el.body.classList.add(`layout-${l}`);
    prefs.set('layout', l);
    requestAnimationFrame(() => { cm.refresh(); relayout(); });
  }
  document.querySelectorAll('[data-layout]').forEach(b => { b.onclick = () => setLayout(b.dataset.layout); });
  setLayout(prefs.get('layout', 'split'));

  $('#sidebarToggle').onclick = () => {
    if (narrow()) el.body.classList.toggle('show-sidebar-mobile');
    else {
      el.body.classList.toggle('no-sidebar');
      prefs.set('noSidebar', el.body.classList.contains('no-sidebar'));
      requestAnimationFrame(() => cm.refresh());
    }
  };
  if (prefs.get('noSidebar', false)) el.body.classList.add('no-sidebar');

  el.workspace.style.setProperty('--split-f', prefs.get('split', 0.5));
  el.splitter.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.splitter.setPointerCapture(e.pointerId);
    el.splitter.classList.add('dragging');
    el.body.classList.add('resizing');
    const sidebarW = el.body.classList.contains('no-sidebar') ? 0 : el.sidebar.getBoundingClientRect().width;
    const rect = el.workspace.getBoundingClientRect();
    const move = ev => {
      const avail = rect.width - sidebarW - 5;
      const f = Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left - sidebarW) / avail));
      el.workspace.style.setProperty('--split-f', f.toFixed(4));
      cm.refresh();
    };
    const up = () => {
      el.splitter.removeEventListener('pointermove', move);
      el.splitter.classList.remove('dragging');
      el.body.classList.remove('resizing');
      prefs.set('split', Number(el.workspace.style.getPropertyValue('--split-f')) || 0.5);
      relayout();
    };
    el.splitter.addEventListener('pointermove', move);
    el.splitter.addEventListener('pointerup', up, { once: true });
    el.splitter.addEventListener('pointercancel', up, { once: true });
  });
  el.splitter.addEventListener('dblclick', () => { el.workspace.style.setProperty('--split-f', 0.5); prefs.set('split', 0.5); cm.refresh(); relayout(); });

  /* ----------------------------------------------------------- theme */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    prefs.set('theme', t);
  }
  applyTheme(prefs.get('theme', window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  $('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');

  /* ------------------------------------------------- global shortcuts */
  document.addEventListener('keydown', e => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); if (!cm.hasFocus()) saveAll().then(() => compile()).catch(() => {}); }
    else if (e.key === 'Enter' && !cm.hasFocus()) { e.preventDefault(); compile(); }
  });

  /* ------------------------------------------------------------ boot */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  loadProjects().catch(err => {
    setCompileStatus('err', err.message);
    toast(`Could not open local storage: ${err.message}`, 'error');
  });
})();
