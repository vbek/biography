'use strict';
/* Folio PDF Editor — UI controller */

/* =============================================================== config */
const TOOL_DEFAULTS = {
  text: { color: '#111827', size: 16, font: 'Helvetica', bold: false, italic: false, opacity: 1 },
  pen: { color: '#1d4ed8', sw: 2, opacity: 1 },
  highlight: { color: '#facc15', sw: 14, opacity: 0.5 },
  rect: { color: '#dc2626', sw: 2, fill: '', opacity: 1 },
  ellipse: { color: '#dc2626', sw: 2, fill: '', opacity: 1 },
  line: { color: '#dc2626', sw: 2, opacity: 1 },
  arrow: { color: '#dc2626', sw: 2.5, opacity: 1 },
  whiteout: { fill: '#ffffff', opacity: 1 },
  redact: { fill: '#000000', opacity: 1 },
  note: { color: '#facc15' },
  image: { opacity: 1 },
  signature: { opacity: 1 },
};
const FIELDS = {
  text: ['color', 'font', 'size', 'opacity'],
  pen: ['color', 'sw', 'opacity'], highlight: ['color', 'sw', 'opacity'],
  rect: ['color', 'fill', 'sw', 'opacity'], ellipse: ['color', 'fill', 'sw', 'opacity'],
  line: ['color', 'sw', 'opacity'], arrow: ['color', 'sw', 'opacity'],
  whiteout: ['fill', 'opacity'], redact: ['fill', 'opacity'],
  note: ['color', 'note'], image: ['opacity'], signature: ['opacity'],
};
const TOOL_NAMES = {
  select: 'Select', hand: 'Pan', text: 'Text', pen: 'Pen', highlight: 'Highlighter', rect: 'Rectangle', ellipse: 'Ellipse',
  line: 'Line', arrow: 'Arrow', whiteout: 'White-out', redact: 'Redact', image: 'Image', signature: 'Signature', note: 'Comment', eraser: 'Eraser',
};
const HINTS = {
  select: 'Click an annotation to select it. Drag to move, pull a handle to resize, double‑click text to edit. Arrow keys nudge (Shift = 10pt).',
  hand: 'Drag to scroll. Tip: hold Space with any tool to pan.',
  text: 'Click anywhere on a page and type. Click outside or press Esc to finish.',
  pen: 'Draw freehand. Hold Shift while editing to keep things tidy.',
  highlight: 'Drag across text to highlight it.',
  rect: 'Drag to draw. Hold Shift for a square.', ellipse: 'Drag to draw. Hold Shift for a circle.',
  line: 'Drag to draw. Hold Shift to snap to 45°.', arrow: 'Drag from tail to tip. Hold Shift to snap to 45°.',
  whiteout: 'Drag over content to cover it with a solid box, then add new text on top — the classic way to “edit” existing PDF text.',
  redact: 'Drag to black out content. For permanent removal export as “Flattened PDF”, which burns redactions into page images.',
  image: 'Choose an image — it’s placed on the current page, ready to move and resize.',
  signature: 'Draw, type or upload a signature, then place it.',
  note: 'Click to drop a sticky comment. It exports as a real PDF comment.',
  eraser: 'Click an annotation to delete it.',
};
const SWATCHES = ['#111827', '#ffffff', '#dc2626', '#ea580c', '#facc15', '#16a34a', '#0891b2', '#1d4ed8', '#7c3aed', '#db2777'];

S.toolProps = JSON.parse(JSON.stringify(TOOL_DEFAULTS));
const pageEls = new Map();   // pageId -> {wrap, pdf, ink, key, task}
const thumbEls = new Map();  // pageId -> {el, cv, key}
const visible = new Set();
let curPageId = null;
let drag = null;             // active pointer interaction
let editing = null;          // {pageId, id, isNew, ta}
let clipboard = null;
let spaceDown = false;

/* ============================================================ helpers */
const viewer = $('#viewer'), pagesHost = $('#pages'), thumbsHost = $('#thumbs');
function toast(msg, { type = 'info', timeout = 3500 } = {}) {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').appendChild(t); requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, timeout);
}
function getSel() {
  if (!S.sel) return null;
  const p = pageById(S.sel.pageId); const o = p && p.annots.find((a) => a.id === S.sel.id);
  return o ? { p, o } : null;
}
const kindOf = (o) => o.kind || (o.type === 'path' ? (o.hl ? 'highlight' : 'pen') : o.type);
function currentPage() { return pageById(curPageId) || S.pages[0] || null; }

/* Live edit transactions (one undo step per slider drag / text field edit) */
let editPre = null;
function beginEdit() { if (editPre == null) editPre = snapshot(); }
function endEdit() {
  if (editPre == null) return;
  if (snapshot() !== editPre) { S.undo.push(editPre); S.redo = []; S.dirty = true; onHistoryChange(); }
  editPre = null;
}
function onHistoryChange() {
  $('#btnUndo').disabled = !S.undo.length; $('#btnRedo').disabled = !S.redo.length;
}
function undo() {
  commitTextEdit(); endEdit();
  if (!S.undo.length) return;
  S.redo.push(snapshot()); restore(S.undo.pop()); afterRestore();
}
function redo() {
  commitTextEdit(); endEdit();
  if (!S.redo.length) return;
  S.undo.push(snapshot()); restore(S.redo.pop()); afterRestore();
}
function afterRestore() {
  if (S.sel && !getSel()) S.sel = null;
  S.selectedPages = new Set([...S.selectedPages].filter((id) => pageById(id)));
  syncFormStorage(); refreshPages(); refreshPropsUI(); fillDocPanel(); buildForms(); onHistoryChange();
}

/* ======================================================= render loop */
const dirtyOverlays = new Set(); let rafPending = false;
function touch(p, thumb = true) {
  if (!p) return;
  dirtyOverlays.add(p.id);
  if (!rafPending) { rafPending = true; requestAnimationFrame(flushOverlays); }
  if (thumb) scheduleThumb(p.id);
}
function touchAll() { S.pages.forEach((p) => touch(p)); }
function flushOverlays() {
  rafPending = false;
  for (const id of dirtyOverlays) { const p = pageById(id); if (p && visible.has(id)) drawOverlay(p); }
  dirtyOverlays.clear();
}

function drawOverlay(p) {
  const el = pageEls.get(p.id); if (!el) return;
  const s = S.zoom * BASE, dpr = DPR(); const [w, h] = dims(p, s);
  const cv = el.ink; const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  const m = matrix(p, s * dpr);
  ctx.setTransform(...m);
  const redraw = () => touch(p, false);
  for (const o of allObjs(p)) if (!(editing && editing.id === o.id)) drawObj(ctx, o, redraw);
  if (drag && drag.draft && drag.pageId === p.id) drawObj(ctx, drag.draft);
  if (S.flash && S.flash.pageId === p.id) {
    const f = S.flash.rect; ctx.fillStyle = 'rgba(217,72,15,.28)'; ctx.strokeStyle = '#d9480f'; ctx.lineWidth = 1.5 / s;
    ctx.fillRect(f.x, f.y, f.w, f.h); ctx.strokeRect(f.x, f.y, f.w, f.h);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sel = getSel();
  if (sel && sel.p === p && !(editing && editing.id === sel.o.id)) drawSelection(ctx, p, sel.o, m, dpr);
}
function outlineOf(o) {
  const ls = localSize(o);
  if (ls) return [l2p(o, 0, 0), l2p(o, ls[0], 0), l2p(o, ls[0], ls[1]), l2p(o, 0, ls[1])];
  if (o.type === 'rect' || o.type === 'ellipse') return [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]];
  if (o.type === 'path') {
    const xs = o.pts.map((q) => q[0]), ys = o.pts.map((q) => q[1]); const pad = o.sw / 2;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  return null;
}
function handlesOf(o) {
  const ls = localSize(o);
  if (ls) return o.type === 'note' ? [] : [{ n: 'se', pt: l2p(o, ls[0], ls[1]) }];
  if (o.type === 'rect' || o.type === 'ellipse') return [
    { n: 'nw', pt: [o.x, o.y] }, { n: 'ne', pt: [o.x + o.w, o.y] }, { n: 'sw', pt: [o.x, o.y + o.h] }, { n: 'se', pt: [o.x + o.w, o.y + o.h] }];
  if (o.type === 'line' || o.type === 'arrow') return [{ n: 'p1', pt: [o.x1, o.y1] }, { n: 'p2', pt: [o.x2, o.y2] }];
  return [];
}
function drawSelection(ctx, p, o, m, dpr) {
  const ol = outlineOf(o);
  ctx.save(); ctx.lineWidth = 1.25 * dpr; ctx.strokeStyle = '#2f6fed';
  if (ol) {
    ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.beginPath();
    ol.forEach(([x, y], i) => { const [X, Y] = apply(m, x, y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  }
  const hs = 4.5 * dpr;
  for (const h of handlesOf(o)) {
    const [X, Y] = apply(m, ...h.pt);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.rect(X - hs, Y - hs, hs * 2, hs * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

async function renderPdf(p) {
  const el = pageEls.get(p.id); if (!el) return;
  const s = S.zoom * BASE; const key = `${s}|${rotOf(p)}|${el.formRev || 0}`;
  if (el.key === key) return;
  el.key = key;
  if (p.src == null) { el.pdf.width = el.pdf.height = 1; el.pdf.style.visibility = 'hidden'; return; }
  el.pdf.style.visibility = '';
  const [w, h] = dims(p, s); let dpr = DPR();
  const maxPx = 24e6; if (w * h * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (w * h));
  try {
    const page = await srcById(p.src).pdf.getPage(p.idx + 1);
    if (el.key !== key) return;
    const vp = page.getViewport({ scale: s * dpr, rotation: rotOf(p) });
    const off = document.createElement('canvas'); off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
    if (el.task) { try { el.task.cancel(); } catch { /* */ } }
    const task = page.render({ canvasContext: off.getContext('2d'), viewport: vp, annotationMode: AM.ENABLE_STORAGE });
    el.task = task;
    await task.promise;
    if (el.key !== key) return;
    el.pdf.width = off.width; el.pdf.height = off.height; el.pdf.getContext('2d').drawImage(off, 0, 0);
    off.width = off.height = 0;
  } catch (e) {
    if (e && e.name === 'RenderingCancelledException') return;
    console.error(e); if (el.key === key) el.key = null;
  }
}

/* ============================================================ viewer DOM */
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    const id = en.target.dataset.id;
    if (en.isIntersecting) { visible.add(id); const p = pageById(id); if (p) { renderPdf(p); drawOverlay(p); } }
    else visible.delete(id);
  }
}, { root: viewer, rootMargin: '900px 0px' });

function makePageEl(p) {
  const wrap = document.createElement('div'); wrap.className = 'page'; wrap.dataset.id = p.id;
  const pdf = document.createElement('canvas'); pdf.className = 'pdf';
  const ink = document.createElement('canvas'); ink.className = 'ink';
  const label = document.createElement('div'); label.className = 'page-label';
  wrap.append(pdf, ink, label);
  const el = { wrap, pdf, ink, label, key: null, task: null };
  ink.addEventListener('pointerdown', (e) => onPointerDown(e, pageById(p.id)));
  ink.addEventListener('pointermove', (e) => onPointerMove(e, pageById(p.id)));
  ink.addEventListener('pointerup', (e) => onPointerUp(e, pageById(p.id)));
  ink.addEventListener('pointercancel', (e) => onPointerUp(e, pageById(p.id)));
  ink.addEventListener('dblclick', (e) => onDblClick(e, pageById(p.id)));
  return el;
}
function sizePageEl(p) {
  const el = pageEls.get(p.id); const [w, h] = dims(p, S.zoom * BASE);
  el.wrap.style.width = w + 'px'; el.wrap.style.height = h + 'px';
}
function buildViewer() {
  const old = new Map(pageEls); pageEls.clear();
  const frag = document.createDocumentFragment();
  S.pages.forEach((p, i) => {
    let el = old.get(p.id); old.delete(p.id);
    if (!el) { el = makePageEl(p); io.observe(el.wrap); }
    pageEls.set(p.id, el);
    el.label.textContent = i + 1;
    el.wrap.classList.toggle('blank', p.src == null);
    sizePageEl(p); frag.appendChild(el.wrap);
  });
  for (const [id, el] of old) { io.unobserve(el.wrap); el.wrap.remove(); visible.delete(id); }
  pagesHost.appendChild(frag);
  for (const id of visible) { const p = pageById(id); if (p) { renderPdf(p); drawOverlay(p); } }
}
function refreshPages() {
  buildViewer(); buildThumbs();
  $('#pageCount').textContent = S.pages.length;
  $('#empty').hidden = S.pages.length > 0;
  document.body.classList.toggle('has-doc', S.pages.length > 0);
  if (!pageById(curPageId)) curPageId = S.pages[0] && S.pages[0].id;
  updateCurrentPage(); updatePageSelUI();
  if (S.doc.pageNumbers.enabled) touchAll();
}

/* ============================================================ thumbnails */
const thumbIO = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) scheduleThumb(en.target.dataset.id, 0);
}, { root: thumbsHost, rootMargin: '300px 0px' });
const thumbQueue = new Set(); let thumbBusy = false; const thumbTimers = new Map();
function scheduleThumb(id, delay = 450) {
  clearTimeout(thumbTimers.get(id));
  thumbTimers.set(id, setTimeout(() => { thumbQueue.add(id); pumpThumbs(); }, delay));
}
async function pumpThumbs() {
  if (thumbBusy) return; thumbBusy = true;
  while (thumbQueue.size) {
    const id = thumbQueue.values().next().value; thumbQueue.delete(id);
    const p = pageById(id); const t = thumbEls.get(id); if (!p || !t) continue;
    const r = t.el.getBoundingClientRect(), hr = thumbsHost.getBoundingClientRect();
    if (r.bottom < hr.top - 400 || r.top > hr.bottom + 400) { t.key = null; continue; }
    try {
      const tw = 132; const sc = tw / dims(p, 1)[0];
      const cv = await renderPageCanvas(p, sc * DPR());
      t.cv.width = cv.width; t.cv.height = cv.height; t.cv.getContext('2d').drawImage(cv, 0, 0);
      cv.width = cv.height = 0;
    } catch (e) { console.warn('thumb', e); }
  }
  thumbBusy = false;
}
function buildThumbs() {
  const old = new Map(thumbEls); thumbEls.clear();
  const frag = document.createDocumentFragment();
  S.pages.forEach((p, i) => {
    let t = old.get(p.id); old.delete(p.id);
    if (!t) {
      const el = document.createElement('div'); el.className = 'thumb'; el.draggable = true; el.dataset.id = p.id;
      const box = document.createElement('div'); box.className = 'thumb-box';
      const cv = document.createElement('canvas'); box.appendChild(cv);
      const num = document.createElement('span'); num.className = 'num';
      el.append(box, num);
      t = { el, cv, num, box }; bindThumb(t, p.id); thumbIO.observe(el);
    }
    const [w, h] = dims(p, 1); t.box.style.aspectRatio = `${w} / ${h}`;
    t.num.textContent = i + 1; thumbEls.set(p.id, t); frag.appendChild(t.el);
    scheduleThumb(p.id, 60);
  });
  for (const [, t] of old) { thumbIO.unobserve(t.el); t.el.remove(); }
  thumbsHost.appendChild(frag);
}
let lastThumbClick = null;
function bindThumb(t, id) {
  t.el.addEventListener('click', (e) => {
    const ids = S.pages.map((p) => p.id);
    if (e.shiftKey && lastThumbClick && ids.includes(lastThumbClick)) {
      const [a, b] = [ids.indexOf(lastThumbClick), ids.indexOf(id)].sort((x, y) => x - y);
      if (!e.ctrlKey && !e.metaKey) S.selectedPages.clear();
      ids.slice(a, b + 1).forEach((x) => S.selectedPages.add(x));
    } else if (e.ctrlKey || e.metaKey) {
      S.selectedPages.has(id) ? S.selectedPages.delete(id) : S.selectedPages.add(id); lastThumbClick = id;
    } else {
      S.selectedPages = new Set([id]); lastThumbClick = id; scrollToPage(id);
    }
    updatePageSelUI();
  });
  t.el.addEventListener('dragstart', (e) => {
    const ids = S.selectedPages.has(id) ? S.pages.filter((p) => S.selectedPages.has(p.id)).map((p) => p.id) : [id];
    drag = { thumbIds: ids }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-folio-pages', ids.join(','));
    t.el.classList.add('dragging');
  });
  t.el.addEventListener('dragend', () => { t.el.classList.remove('dragging'); clearDropMarks(); drag = null; });
  t.el.addEventListener('dragover', (e) => {
    if (!drag || !drag.thumbIds) return; e.preventDefault();
    const r = t.el.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
    clearDropMarks(); t.el.classList.add(after ? 'drop-after' : 'drop-before');
  });
  t.el.addEventListener('drop', (e) => {
    if (!drag || !drag.thumbIds) return; e.preventDefault(); e.stopPropagation();
    const r = t.el.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
    movePages(drag.thumbIds, id, after); clearDropMarks();
  });
}
function clearDropMarks() { $$('.thumb.drop-before, .thumb.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); }
function updatePageSelUI() {
  for (const [id, t] of thumbEls) { t.el.classList.toggle('selected', S.selectedPages.has(id)); t.el.classList.toggle('current', id === curPageId); }
  const n = S.selectedPages.size;
  $('#selInfo').textContent = n > 1 ? `${n} pages selected · Esc to clear` : 'Click to select · Ctrl/Shift for many · drag to reorder';
}

/* ====================================================== zoom & scroll */
function fitZoom(mode) {
  const avW = viewer.clientWidth - 56, avH = viewer.clientHeight - 48;
  const cp = currentPage(); if (!cp) return 1;
  const maxW = Math.max(...S.pages.map((p) => dims(p, 1)[0]));
  if (mode === 'fit-width') return clamp(avW / (maxW * BASE), 0.1, 6);
  const [w, h] = dims(cp, 1); return clamp(Math.min(avW / (w * BASE), avH / (h * BASE)), 0.1, 6);
}
function setZoom(z, mode = 'custom', anchor) {
  if (!S.pages.length) return;
  commitTextEdit();
  const cp = currentPage(); const el = cp && pageEls.get(cp.id);
  const rel = el ? (viewer.scrollTop - el.wrap.offsetTop) / el.wrap.offsetHeight : 0;
  const relX = viewer.scrollWidth > viewer.clientWidth ? (viewer.scrollLeft + viewer.clientWidth / 2) / viewer.scrollWidth : 0.5;
  S.zoomMode = mode; S.zoom = mode === 'custom' ? clamp(z, 0.1, 6) : fitZoom(mode);
  for (const p of S.pages) { sizePageEl(p); }
  if (el) viewer.scrollTop = el.wrap.offsetTop + rel * el.wrap.offsetHeight;
  if (viewer.scrollWidth > viewer.clientWidth) viewer.scrollLeft = relX * viewer.scrollWidth - viewer.clientWidth / 2;
  for (const id of visible) { const p = pageById(id); if (p) { drawOverlay(p); renderPdf(p); } }
  const sel = $('#zoomSel'); const match = [...sel.options].find((o) => o.value === mode || (+o.value && Math.abs(+o.value - S.zoom) < 0.001 && mode === 'custom'));
  if (match) sel.value = match.value;
  else { const c = sel.querySelector('option[value=custom]'); c.textContent = Math.round(S.zoom * 100) + '%'; sel.value = 'custom'; }
}
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
function zoomStep(dir) {
  const z = S.zoom; const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
  setZoom(next || z, 'custom');
}
function updateCurrentPage() {
  if (!S.pages.length) { $('#pageInput').value = 0; return; }
  const mid = viewer.scrollTop + viewer.clientHeight * 0.35; let best = S.pages[0].id;
  for (const p of S.pages) { const el = pageEls.get(p.id); if (el && el.wrap.offsetTop <= mid) best = p.id; else break; }
  if (best !== curPageId) {
    curPageId = best; updatePageSelUI();
    const t = thumbEls.get(best); if (t && !drag) t.el.scrollIntoView({ block: 'nearest' });
  }
  if (document.activeElement !== $('#pageInput')) $('#pageInput').value = S.pages.findIndex((p) => p.id === curPageId) + 1;
}
function scrollToPage(id, smooth = true) {
  const el = pageEls.get(id); if (!el) return;
  viewer.scrollTo({ top: el.wrap.offsetTop - 16, behavior: smooth ? 'smooth' : 'auto' });
  curPageId = id; updatePageSelUI(); $('#pageInput').value = S.pages.findIndex((p) => p.id === id) + 1;
}
viewer.addEventListener('scroll', () => updateCurrentPage(), { passive: true });
viewer.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !S.pages.length) return;
  e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 'custom');
}, { passive: false });
window.addEventListener('resize', () => { if (S.zoomMode !== 'custom') setZoom(0, S.zoomMode); });

/* ================================================================ tools */
function setTool(t) {
  commitTextEdit(); endEdit();
  if (t === 'image') { $('#fileImage').value = ''; $('#fileImage').click(); }
  if (t === 'signature') { openSignature(); }
  S.tool = t;
  $$('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  pagesHost.className = 'pages tool-' + t;
  if (t !== 'select' && S.sel) { S.sel = null; touchAll(); }
  refreshPropsUI();
}
function evtToPage(e, p) {
  const el = pageEls.get(p.id); const r = el.ink.getBoundingClientRect();
  return apply(inv(matrix(p, S.zoom * BASE)), e.clientX - r.left, e.clientY - r.top);
}
function hitTest(p, x, y) {
  const tol = 4 / (S.zoom * BASE);
  for (let i = p.annots.length - 1; i >= 0; i--) if (hitObj(p.annots[i], x, y, tol)) return p.annots[i];
  return null;
}
function handleAt(o, x, y) {
  const tol = 7 / (S.zoom * BASE);
  return handlesOf(o).find((h) => Math.abs(h.pt[0] - x) <= tol && Math.abs(h.pt[1] - y) <= tol) || null;
}
function select(p, o) {
  const prev = getSel();
  S.sel = o ? { pageId: p.id, id: o.id } : null;
  if (prev && prev.p !== p) touch(prev.p, false);
  if (p) touch(p, false);
  refreshPropsUI();
}
function snap45(x0, y0, x, y) {
  const a = Math.round(Math.atan2(y - y0, x - x0) / (Math.PI / 4)) * (Math.PI / 4); const L = Math.hypot(x - x0, y - y0);
  return [x0 + Math.cos(a) * L, y0 + Math.sin(a) * L];
}
function newObj(type, extra) { return { id: uid(), type, ...extra }; }

function onPointerDown(e, p) {
  if (!p || e.button !== 0) return;
  const el = pageEls.get(p.id);
  if (editing) { commitTextEdit(); if (S.tool === 'text') return; }
  curPageId = p.id;
  const [x, y] = evtToPage(e, p); const tool = (spaceDown ? 'hand' : S.tool); const tp = S.toolProps[S.tool] || {};
  const R = rotOf(p);
  if (tool === 'hand') {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, st: viewer.scrollTop, sl: viewer.scrollLeft };
  } else if (tool === 'select') {
    const sel = getSel(); const h = sel && sel.p === p ? handleAt(sel.o, x, y) : null;
    if (h) {
      drag = { mode: 'resize', pageId: p.id, h: h.n, orig: JSON.parse(JSON.stringify(sel.o)), o: sel.o, x0: x, y0: y };
    } else {
      const hit = hitTest(p, x, y);
      select(p, hit);
      if (hit) drag = { mode: 'move', pageId: p.id, o: hit, lx: x, ly: y, moved: false };
    }
  } else if (tool === 'eraser') {
    const hit = hitTest(p, x, y);
    if (hit) { pushHistory(); p.annots.splice(p.annots.indexOf(hit), 1); touch(p); }
    drag = { mode: 'erase', pageId: p.id };
  } else if (tool === 'text') {
    const o = newObj('text', { ...tp, text: '', rot: R, x: 0, y: 0 });
    [o.x, o.y] = l2p({ x, y, rot: R }, -2, -o.size * 0.62);
    pushHistory(); p.annots.push(o); select(p, o); startTextEdit(p, o, true);
    e.preventDefault(); return;
  } else if (tool === 'note') {
    const o = newObj('note', { color: tp.color || '#facc15', text: '', rot: R, x: 0, y: 0 });
    [o.x, o.y] = l2p({ x, y, rot: R }, -NOTE / 2, -NOTE / 2);
    pushHistory(); p.annots.push(o); setTool('select'); select(p, o);
    setTimeout(() => $('#pNote').focus(), 30);
    return;
  } else if (tool === 'pen' || tool === 'highlight') {
    drag = { mode: 'draw', pageId: p.id, draft: newObj('path', { color: tp.color, sw: tp.sw, opacity: tp.opacity, hl: tool === 'highlight', pts: [[x, y]] }) };
  } else if (['rect', 'ellipse', 'whiteout', 'redact'].includes(tool)) {
    const base = tool === 'whiteout' || tool === 'redact'
      ? { kind: tool, fill: tp.fill, sw: 0, color: '', opacity: tp.opacity }
      : { color: tp.color, sw: tp.sw, fill: tp.fill, opacity: tp.opacity };
    drag = { mode: 'shape', pageId: p.id, x0: x, y0: y, draft: newObj(tool === 'ellipse' ? 'ellipse' : 'rect', { ...base, x, y, w: 0, h: 0 }) };
  } else if (tool === 'line' || tool === 'arrow') {
    drag = { mode: 'line', pageId: p.id, draft: newObj(tool, { color: tp.color, sw: tp.sw, opacity: tp.opacity, x1: x, y1: y, x2: x, y2: y }) };
  } else return;
  el.ink.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function onPointerMove(e, p) {
  if (!p) return;
  if (!drag) { hoverCursor(e, p); return; }
  if (drag.mode === 'pan') {
    viewer.scrollTop = drag.st - (e.clientY - drag.sy); viewer.scrollLeft = drag.sl - (e.clientX - drag.sx); return;
  }
  if (drag.pageId !== p.id) return;
  const [x, y] = evtToPage(e, p); const s = S.zoom * BASE;
  switch (drag.mode) {
    case 'move': {
      const dx = x - drag.lx, dy = y - drag.ly; if (!dx && !dy) return;
      if (!drag.moved) { pushHistory(); drag.moved = true; }
      translateObj(drag.o, dx, dy); drag.lx = x; drag.ly = y; break;
    }
    case 'resize': {
      if (!drag.moved) { pushHistory(); drag.moved = true; }
      resizeObj(drag.o, drag.orig, drag.h, x, y, e.shiftKey); break;
    }
    case 'erase': {
      if (e.buttons & 1) { const hit = hitTest(p, x, y); if (hit) { pushHistory(); p.annots.splice(p.annots.indexOf(hit), 1); } }
      break;
    }
    case 'draw': {
      const pts = drag.draft.pts; const L = pts[pts.length - 1];
      if (Math.hypot(x - L[0], y - L[1]) * s >= 1.5) pts.push([x, y]);
      break;
    }
    case 'shape': {
      let w = x - drag.x0, h = y - drag.y0;
      if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      Object.assign(drag.draft, { x: Math.min(drag.x0, drag.x0 + w), y: Math.min(drag.y0, drag.y0 + h), w: Math.abs(w), h: Math.abs(h) });
      break;
    }
    case 'line': {
      const d = drag.draft; [d.x2, d.y2] = e.shiftKey ? snap45(d.x1, d.y1, x, y) : [x, y]; break;
    }
  }
  touch(p, false);
}
function onPointerUp(e, p) {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.mode === 'pan') return;
  if (!p || d.pageId !== p.id) return;
  const s = S.zoom * BASE;
  if (d.draft) {
    const o = d.draft; let keep = true;
    if (o.type === 'path') { o.pts = simplify(o.pts, 0.35 / s).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]); }
    else if (o.type === 'rect' || o.type === 'ellipse') keep = o.w * s > 3 && o.h * s > 3;
    else if (o.type === 'line' || o.type === 'arrow') keep = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * s > 4;
    if (keep) { pushHistory(); p.annots.push(o); }
  }
  if (d.mode === 'resize' || d.mode === 'move') normalizeObj(d.o);
  if (d.moved || d.draft || d.mode === 'erase') touch(p); else touch(p, false);
  refreshPropsUI();
}
function onDblClick(e, p) {
  if (S.tool !== 'select' || !p) return;
  const [x, y] = evtToPage(e, p); const hit = hitTest(p, x, y);
  if (hit && hit.type === 'text') { select(p, hit); startTextEdit(p, hit, false); }
  else if (hit && hit.type === 'note') { select(p, hit); $('#pNote').focus(); }
}
function hoverCursor(e, p) {
  const el = pageEls.get(p.id); let cur = '';
  if (S.tool === 'select' && !spaceDown) {
    const [x, y] = evtToPage(e, p); const sel = getSel();
    const h = sel && sel.p === p ? handleAt(sel.o, x, y) : null;
    if (h) cur = h.n === 'p1' || h.n === 'p2' ? 'crosshair' : 'nwse-resize';
    else if (hitTest(p, x, y)) cur = 'move';
  } else if (S.tool === 'eraser') {
    const [x, y] = evtToPage(e, p); if (hitTest(p, x, y)) cur = 'pointer';
  }
  el.ink.style.cursor = cur;
}
function resizeObj(o, orig, h, x, y, shift) {
  if (o.type === 'image') {
    const [lx, ly] = p2l(orig, x, y);
    o.w = Math.max(4, lx); o.h = shift ? Math.max(4, ly) : o.w * orig.h / orig.w;
  } else if (o.type === 'text') {
    const [lx] = p2l(orig, x, y); const bw = textBox(orig).w;
    o.size = clamp(Math.round(orig.size * Math.max(lx, 4) / bw * 2) / 2, 4, 400);
  } else if (o.type === 'rect' || o.type === 'ellipse') {
    let x0 = orig.x, y0 = orig.y, x1 = orig.x + orig.w, y1 = orig.y + orig.h;
    if (h[0] === 'n') y0 = y; else y1 = y;
    if (h[1] === 'w') x0 = x; else x1 = x;
    Object.assign(o, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  } else if (o.type === 'line' || o.type === 'arrow') {
    if (h === 'p1') [o.x1, o.y1] = shift ? snap45(o.x2, o.y2, x, y) : [x, y];
    else[o.x2, o.y2] = shift ? snap45(o.x1, o.y1, x, y) : [x, y];
  }
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let idx = -1, md = 0;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]); if (d > md) { md = d; idx = i; } }
    if (md > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ========================================================= text editing */
function startTextEdit(p, o, isNew) {
  commitTextEdit();
  const el = pageEls.get(p.id); const s = S.zoom * BASE;
  const ta = document.createElement('textarea'); ta.className = 'text-editor'; ta.spellcheck = true; ta.value = o.text || '';
  const [sx, sy] = apply(matrix(p, s), o.x, o.y);
  Object.assign(ta.style, { left: sx + 'px', top: sy + 'px', transform: `rotate(${rotOf(p) - (o.rot || 0)}deg)` });
  editing = { pageId: p.id, id: o.id, isNew, ta, o };
  const fit = () => {
    Object.assign(ta.style, { font: cssFont(o, o.size * s), color: o.color, lineHeight: LH, opacity: o.opacity ?? 1 });
    const tmp = { ...o, text: ta.value || ' ' }; const b = textBox(tmp);
    ta.style.width = Math.max(b.w * s + o.size * s * 1.2, 40) + 'px'; ta.style.height = (b.h * s + 4) + 'px';
  };
  editing.fit = fit; fit();
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitTextEdit(); }
  });
  ta.addEventListener('blur', () => setTimeout(() => { if (editing && editing.ta === ta && !document.activeElement?.closest('.inspector')) commitTextEdit(); }, 120));
  el.wrap.appendChild(ta); touch(p, false);
  const focusIt = () => { if (editing && editing.ta === ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } };
  focusIt(); setTimeout(focusIt, 0);
}
function commitTextEdit() {
  if (!editing) return;
  const { pageId, isNew, ta, o } = editing; editing = null;
  const p = pageById(pageId); ta.remove();
  if (!p) return;
  const text = ta.value.replace(/\s+$/, '');
  if (!text.trim()) {
    const i = p.annots.indexOf(o); if (i >= 0) p.annots.splice(i, 1);
    if (isNew) { S.undo.pop(); onHistoryChange(); } else S.dirty = true;
    if (S.sel && S.sel.id === o.id) S.sel = null;
  } else if (text !== o.text) {
    if (!isNew) pushHistory();
    o.text = text;
  }
  if (isNew && S.tool === 'text') S.sel = null;
  touch(p); refreshPropsUI();
}

/* =========================================================== objects */
function deleteSelected() {
  const s = getSel(); if (!s) return false;
  pushHistory(); s.p.annots.splice(s.p.annots.indexOf(s.o), 1); S.sel = null; touch(s.p); refreshPropsUI(); return true;
}
function duplicateSelected() {
  const s = getSel(); if (!s) return;
  const c = cloneObj(s.o); translateObj(c, 12, 12); pushHistory(); s.p.annots.push(c); select(s.p, c); touch(s.p);
}
function arrange(front) {
  const s = getSel(); if (!s) return;
  pushHistory(); const a = s.p.annots; a.splice(a.indexOf(s.o), 1); front ? a.push(s.o) : a.unshift(s.o); touch(s.p);
}
function nudge(dx, dy) {
  const s = getSel(); if (!s) return;
  beginEdit(); translateObj(s.o, dx, dy); touch(s.p);
  clearTimeout(nudge.t); nudge.t = setTimeout(endEdit, 500);
}
function visibleCenter(p) {
  const el = pageEls.get(p.id); const r = el.wrap.getBoundingClientRect(), vr = viewer.getBoundingClientRect();
  const cx = (Math.max(r.left, vr.left) + Math.min(r.right, vr.right)) / 2 - r.left;
  const cy = (Math.max(r.top, vr.top) + Math.min(r.bottom, vr.bottom)) / 2 - r.top;
  return apply(inv(matrix(p, S.zoom * BASE)), clamp(cx, 0, r.width), clamp(cy, 0, r.height));
}
async function addImageAsset(dataUrl) {
  const im = new Image(); im.src = dataUrl; await im.decode();
  let w = im.naturalWidth, h = im.naturalHeight; let url = dataUrl;
  const isJpg = /^data:image\/jpe?g/i.test(dataUrl), isPng = /^data:image\/png/i.test(dataUrl);
  const k = Math.min(1, 3000 / Math.max(w, h));
  if (k < 1 || (!isJpg && !isPng)) {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
    url = cv.toDataURL(isJpg ? 'image/jpeg' : 'image/png', 0.92); w = cv.width; h = cv.height;
  }
  const id = 'img_' + uid(); S.assets[id] = { type: 'image', dataUrl: url, w, h };
  return id;
}
function placeImage(assetId, { maxW = 0.45, signature = false } = {}) {
  const p = currentPage(); if (!p) { toast('Open a document first.', { type: 'warn' }); return; }
  const a = S.assets[assetId]; const [Dw] = dims(p, 1);
  let w = Math.min(a.w * 0.75, Dw * maxW); if (signature) w = Math.min(Dw * 0.32, Math.max(120, a.w * 0.3));
  const h = w * a.h / a.w; const R = rotOf(p);
  const [cx, cy] = visibleCenter(p); const [ox, oy] = l2p({ x: 0, y: 0, rot: R }, w / 2, h / 2);
  const o = newObj('image', { asset: assetId, x: cx - ox, y: cy - oy, w, h, rot: R, opacity: 1, ...(signature ? { kind: 'signature' } : {}) });
  pushHistory(); p.annots.push(o); setTool('select'); select(p, o); touch(p);
}

/* ======================================================= props panel */
function buildSwatches() {
  $$('.swatches[data-target]').forEach((box) => {
    const key = box.dataset.target; box.innerHTML = '';
    SWATCHES.forEach((c) => {
      const b = document.createElement('button'); b.className = 'sw'; b.style.setProperty('--c', c); b.title = c; b.dataset.c = c;
      b.addEventListener('click', () => { beginEdit(); setProp(key, c); endEdit(); });
      box.appendChild(b);
    });
    const lab = document.createElement('label'); lab.className = 'sw custom'; lab.title = 'Custom color';
    const inp = document.createElement('input'); inp.type = 'color'; lab.appendChild(inp);
    inp.addEventListener('focus', beginEdit); inp.addEventListener('input', () => setProp(key, inp.value)); inp.addEventListener('change', endEdit);
    box.appendChild(lab);
  });
}
function propTarget() {
  const s = getSel(); if (s) return { o: s.o, kind: kindOf(s.o), sel: s };
  if (S.toolProps[S.tool]) return { o: S.toolProps[S.tool], kind: S.tool, sel: null };
  return null;
}
function setProp(key, val) {
  const t = propTarget(); if (!t) return;
  if (t.sel && t.o.type === 'image' && key !== 'opacity') return;
  t.o[key] = val;
  if (t.sel) { touch(t.sel.p); if (editing && editing.o === t.o) editing.fit(); }
  else saveToolProps();
  refreshPropsUI(true);
}
let saveTPTimer;
function saveToolProps() { clearTimeout(saveTPTimer); saveTPTimer = setTimeout(() => store.set('toolProps', S.toolProps), 400); }
function refreshPropsUI(soft) {
  const t = propTarget();
  const name = t ? (t.sel ? TOOL_NAMES[t.kind] || 'Object' : TOOL_NAMES[S.tool]) : TOOL_NAMES[S.tool];
  $('#propTitle').textContent = t && t.sel ? `${name} · selected` : name;
  const fields = t ? FIELDS[t.kind] || [] : [];
  $$('#inspector [data-panel=props] .field').forEach((f) => {
    const k = f.dataset.f; f.hidden = k === 'actions' ? !(t && t.sel) : !fields.includes(k);
  });
  $('#toolHint').textContent = t && t.sel ? '' : (HINTS[S.tool] || '');
  if (!t) return;
  const o = t.o;
  $$('.swatches[data-target]').forEach((box) => {
    const v = o[box.dataset.target]; box.querySelectorAll('.sw[data-c]').forEach((b) => b.classList.toggle('on', !!v && b.dataset.c.toLowerCase() === String(v).toLowerCase()));
    const ci = box.querySelector('input[type=color]'); if (v && document.activeElement !== ci) ci.value = v;
  });
  $('#pFillOn').checked = !!o.fill;
  $('[data-target=fill]').classList.toggle('off', !o.fill && !['whiteout', 'redact'].includes(t.kind));
  $('#pFillOn').closest('.chk').hidden = ['whiteout', 'redact'].includes(t.kind);
  if (o.sw != null) { $('#pSw').value = o.sw; $('#oSw').textContent = o.sw + ' pt'; }
  if (o.opacity != null) { $('#pOpacity').value = o.opacity; $('#oOpacity').textContent = Math.round(o.opacity * 100) + '%'; }
  if (o.font) { fillFontSelect(); $('#pFont').value = o.font; }
  if (o.size != null && document.activeElement !== $('#pSize')) $('#pSize').value = o.size;
  $('#pBold').classList.toggle('on', !!o.bold); $('#pItalic').classList.toggle('on', !!o.italic);
  if (!soft && document.activeElement !== $('#pNote')) $('#pNote').value = o.text || '';
}
function fillFontSelect() {
  const sel = $('#pFont'); const want = [...Object.keys(STD_FONTS), ...Object.keys(S.assets).filter((k) => S.assets[k].type === 'font')];
  if (sel.options.length === want.length) return;
  sel.innerHTML = '';
  for (const k of want) { const op = document.createElement('option'); op.value = k; op.textContent = STD_FONTS[k] ? STD_FONTS[k].label : S.assets[k].label; sel.appendChild(op); }
}
function bindProps() {
  buildSwatches();
  const live = (el, fn) => {
    el.addEventListener('pointerdown', beginEdit); el.addEventListener('focus', beginEdit);
    el.addEventListener('input', fn); el.addEventListener('change', () => { fn(); endEdit(); });
  };
  live($('#pSw'), () => setProp('sw', +$('#pSw').value));
  live($('#pOpacity'), () => setProp('opacity', +$('#pOpacity').value));
  live($('#pSize'), () => { const v = +$('#pSize').value; if (v >= 4 && v <= 400) setProp('size', v); });
  $('#pFont').addEventListener('change', () => { beginEdit(); setProp('font', $('#pFont').value); endEdit(); });
  $('#pBold').addEventListener('click', () => { const t = propTarget(); if (t) { beginEdit(); setProp('bold', !t.o.bold); endEdit(); } });
  $('#pItalic').addEventListener('click', () => { const t = propTarget(); if (t) { beginEdit(); setProp('italic', !t.o.italic); endEdit(); } });
  $('#pFillOn').addEventListener('change', (e) => { beginEdit(); setProp('fill', e.target.checked ? ($('[data-target=fill] input').value || '#fde68a') : ''); endEdit(); });
  $('#pNote').addEventListener('focus', beginEdit);
  $('#pNote').addEventListener('input', () => { const s = getSel(); if (s && s.o.type === 'note') { s.o.text = $('#pNote').value; S.dirty = true; } });
  $('#pNote').addEventListener('change', endEdit);
  $('#aDel').addEventListener('click', deleteSelected);
  $('#aDup').addEventListener('click', duplicateSelected);
  $('#aFront').addEventListener('click', () => arrange(true));
  $('#aBack').addEventListener('click', () => arrange(false));
  $('#btnLoadFont').addEventListener('click', () => { $('#fileFont').value = ''; $('#fileFont').click(); });
  $('#fileFont').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const bytes = await bytesOf(f); const id = 'font_' + uid(); const label = f.name.replace(/\.[^.]+$/, '');
    S.assets[id] = { type: 'font', family: 'Folio_' + id, label, b64: bytesToB64(bytes) };
    await registerFontAsset(id);
    if (!S.assets[id]._loaded) { delete S.assets[id]; toast('That font file could not be loaded.', { type: 'error' }); return; }
    fillFontSelect(); beginEdit(); setProp('font', id); endEdit(); toast(`Font “${label}” loaded.`);
  });
}

/* ========================================================== page ops */
function targetPages() {
  const sel = S.pages.filter((p) => S.selectedPages.has(p.id));
  return sel.length ? sel : [currentPage()].filter(Boolean);
}
function rotatePages(delta) {
  const ps = targetPages(); if (!ps.length) return;
  commitTextEdit(); pushHistory(); ps.forEach((p) => { p.urot = (p.urot + delta + 360) % 360; });
  refreshPages(); ps.forEach((p) => touch(p));
  if (S.zoomMode !== 'custom') setZoom(0, S.zoomMode);
}
function deletePages() {
  const ps = targetPages(); if (!ps.length) return;
  if (ps.length >= S.pages.length) { toast('A document needs at least one page.', { type: 'warn' }); return; }
  commitTextEdit(); pushHistory();
  const ids = new Set(ps.map((p) => p.id)); const firstIdx = S.pages.findIndex((p) => ids.has(p.id));
  S.pages = S.pages.filter((p) => !ids.has(p.id)); S.selectedPages.clear();
  if (S.sel && ids.has(S.sel.pageId)) S.sel = null;
  curPageId = (S.pages[Math.min(firstIdx, S.pages.length - 1)] || {}).id;
  refreshPages(); toast(`Deleted ${ps.length} page${ps.length > 1 ? 's' : ''}.`);
}
function duplicatePages() {
  const ps = targetPages(); if (!ps.length) return;
  pushHistory();
  for (const p of ps) {
    const c = JSON.parse(JSON.stringify(p)); c.id = uid(); c.annots = c.annots.map((a) => ({ ...a, id: uid() }));
    S.pages.splice(S.pages.indexOf(p) + 1, 0, c);
  }
  refreshPages();
}
function insertBlank() {
  const cp = currentPage(); const [w, h] = cp ? dims(cp, 1) : [612, 792];
  const np = { id: uid(), src: null, idx: 0, W: w, H: h, view: [0, 0, w, h], orot: 0, urot: 0, annots: [] };
  pushHistory();
  const i = cp ? S.pages.indexOf(cp) + 1 : S.pages.length; S.pages.splice(i, 0, np);
  refreshPages(); setTimeout(() => scrollToPage(np.id), 50);
}
function movePages(ids, targetId, after) {
  if (ids.includes(targetId)) return;
  pushHistory();
  const moving = S.pages.filter((p) => ids.includes(p.id)); const rest = S.pages.filter((p) => !ids.includes(p.id));
  let i = rest.findIndex((p) => p.id === targetId); if (after) i++;
  rest.splice(i, 0, ...moving); S.pages = rest; refreshPages();
}

/* ============================================================== search */
let searchHits = [];
async function runSearch() {
  const q = $('#searchInput').value; const cs = $('#searchCase').checked;
  const list = $('#searchResults'); list.innerHTML = ''; searchHits = [];
  $('#btnHlAll').hidden = true;
  if (!q.trim()) { $('#searchMeta').textContent = ''; return; }
  $('#searchMeta').textContent = 'Searching…';
  const needle = cs ? q : q.toLowerCase();
  for (let pi = 0; pi < S.pages.length; pi++) {
    const p = S.pages[pi];
    const items = [...await getTextItems(p)];
    p.annots.filter((o) => o.type === 'text').forEach((o) => textBox(o).lines.forEach((l, i) => items.push({ str: l, u: o.x, v: o.y + i * o.size * LH + o.size * ASC, fs: o.size, w: (_mctx.font = cssFont(o, o.size), _mctx.measureText(l).width) })));
    for (const it of items) {
      const hay = cs ? it.str : it.str.toLowerCase(); let k = hay.indexOf(needle);
      while (k >= 0) {
        const len = it.str.length || 1;
        searchHits.push({ pageId: p.id, page: pi + 1, rect: { x: it.u + it.w * (k / len), y: it.v - it.fs * 0.85, w: Math.max(2, it.w * (q.length / len)), h: it.fs * 1.1 }, snip: it.str.slice(Math.max(0, k - 30), k + q.length + 40), k: Math.min(k, 30) });
        if (searchHits.length >= 1000) break;
        k = hay.indexOf(needle, k + needle.length);
      }
    }
  }
  $('#searchMeta').textContent = searchHits.length ? `${searchHits.length}${searchHits.length >= 1000 ? '+' : ''} match${searchHits.length === 1 ? '' : 'es'}` : 'No matches. Scanned PDFs have no searchable text.';
  $('#btnHlAll').hidden = !searchHits.length;
  const frag = document.createDocumentFragment();
  searchHits.slice(0, 300).forEach((h) => {
    const li = document.createElement('li'); const b = document.createElement('b'); b.textContent = 'p.' + h.page;
    const span = document.createElement('span'); const pre = h.snip.slice(0, h.k), mid = h.snip.slice(h.k, h.k + q.length), post = h.snip.slice(h.k + q.length);
    span.append(pre); const mk = document.createElement('mark'); mk.textContent = mid; span.append(mk, post);
    li.append(b, span); li.addEventListener('click', () => flashHit(h)); frag.appendChild(li);
  });
  list.appendChild(frag);
}
function flashHit(h) {
  const el = pageEls.get(h.pageId); const p = pageById(h.pageId); if (!el || !p) return;
  const [X, Y] = apply(matrix(p, S.zoom * BASE), h.rect.x, h.rect.y);
  viewer.scrollTo({ top: el.wrap.offsetTop + Y - viewer.clientHeight / 3, left: Math.max(0, el.wrap.offsetLeft + X - viewer.clientWidth / 2), behavior: 'smooth' });
  S.flash = h; touch(p, false); clearTimeout(flashHit.t);
  flashHit.t = setTimeout(() => { S.flash = null; touch(p, false); }, 1800);
}
function highlightAllHits() {
  if (!searchHits.length) return;
  pushHistory(); const touched = new Set();
  for (const h of searchHits) {
    const p = pageById(h.pageId); if (!p) continue;
    p.annots.push(newObj('rect', { kind: 'highlight-box', x: h.rect.x, y: h.rect.y, w: h.rect.w, h: h.rect.h, fill: '#facc15', sw: 0, color: '', opacity: 0.4 }));
    touched.add(p);
  }
  touched.forEach((p) => touch(p)); toast(`Highlighted ${searchHits.length} matches.`);
}

/* =============================================================== forms */
function fieldEntries(src) {
  if (!src.fields) return [];
  return Object.entries(src.fields).map(([name, objs]) => {
    const ws = objs.filter((w) => w.id && w.type && !['button', 'signature'].includes(w.type));
    return ws.length ? { name, type: ws[0].type, widgets: ws } : null;
  }).filter(Boolean);
}
function storageValue(f, val) {
  const st = srcById(f.srcId).pdf.annotationStorage;
  for (const w of f.widgets) {
    if (f.type === 'checkbox') st.setValue(w.id, { value: !!val });
    else if (f.type === 'radiobutton') st.setValue(w.id, { value: val != null && String(w.exportValues) === String(val) });
    else if (f.type === 'combobox' || f.type === 'listbox') st.setValue(w.id, { value: val == null ? [] : [String(val)] });
    else st.setValue(w.id, { value: val == null ? '' : String(val) });
  }
}
function originalValue(f) {
  const w = f.widgets[0];
  if (f.type === 'checkbox') return w.value != null && w.value !== 'Off' && w.value !== false && String(w.value) === String(w.exportValues ?? w.value);
  if (f.type === 'radiobutton') { const on = f.widgets.find((x) => x.value != null && String(x.value) === String(x.exportValues)); return on ? on.exportValues : (w.value && w.value !== 'Off' ? w.value : null); }
  return Array.isArray(w.value) ? w.value[0] : (w.value ?? '');
}
function syncFormStorage() {
  for (const src of S.sources) for (const f of fieldEntries(src)) {
    f.srcId = src.id; const k = src.id + '::' + f.name;
    storageValue(f, k in S.formValues ? S.formValues[k] : originalValue(f));
  }
  rerenderSourcePages(null);
}
function rerenderSourcePages(srcId) {
  for (const p of S.pages) {
    if (p.src == null || (srcId != null && p.src !== srcId)) continue;
    const el = pageEls.get(p.id); if (el) { el.formRev = (el.formRev || 0) + 1; if (visible.has(p.id)) renderPdf(p); }
    scheduleThumb(p.id, 300);
  }
}
function buildForms() {
  const host = $('#formFields'); host.innerHTML = ''; let total = 0;
  for (const src of S.sources) {
    const fields = fieldEntries(src); if (!fields.length) continue;
    if (!S.pages.some((p) => p.src === src.id)) continue;
    if (S.sources.length > 1) { const h = document.createElement('div'); h.className = 'form-src'; h.textContent = src.name; host.appendChild(h); }
    for (const f of fields) {
      f.srcId = src.id; total++;
      const key = src.id + '::' + f.name; const cur = key in S.formValues ? S.formValues[key] : originalValue(f);
      const w0 = f.widgets[0];
      const row = document.createElement('label'); row.className = 'form-row';
      const lab = document.createElement('span'); lab.textContent = f.name.split('.').pop(); lab.title = f.name;
      let input;
      if (f.type === 'checkbox') {
        row.classList.add('check'); input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!cur;
        row.append(input, lab);
      } else {
        if (f.type === 'radiobutton' || f.type === 'combobox' || f.type === 'listbox') {
          input = document.createElement('select');
          const opts = f.type === 'radiobutton' ? f.widgets.map((w) => ({ v: w.exportValues, t: w.exportValues })) : (w0.items || []).map((it) => ({ v: it.exportValue, t: it.displayValue }));
          [{ v: '', t: '—' }, ...opts].forEach((o) => { const op = document.createElement('option'); op.value = o.v; op.textContent = o.t; input.appendChild(op); });
          input.value = cur ?? '';
        } else {
          input = document.createElement(w0.multiline ? 'textarea' : 'input');
          if (!w0.multiline) input.type = w0.password ? 'password' : 'text';
          if (w0.charLimit) input.maxLength = w0.charLimit;
          input.value = cur ?? '';
        }
        row.append(lab, input);
      }
      if (w0.editable === false || w0.readOnly) input.disabled = true;
      const apply = () => {
        const v = f.type === 'checkbox' ? input.checked : input.value;
        S.formValues[key] = f.type === 'radiobutton' && v === '' ? null : v;
        storageValue(f, S.formValues[key]); S.dirty = true;
        clearTimeout(f.t); f.t = setTimeout(() => rerenderSourcePages(src.id), 150);
      };
      input.addEventListener('focus', beginEdit);
      input.addEventListener('input', apply);
      input.addEventListener('change', () => { apply(); endEdit(); });
      host.appendChild(row);
    }
  }
  $('#formsHint').textContent = total ? `${total} field${total > 1 ? 's' : ''}. Values are written into the PDF on export.` : 'No fillable fields in this document. Use the Text tool to type anywhere.';
  $('[data-tab=forms]').classList.toggle('badge', total > 0);
}

/* ============================================================ doc panel */
function fillDocPanel() {
  const d = S.doc;
  $('#mTitle').value = d.title; $('#mAuthor').value = d.author; $('#mSubject').value = d.subject; $('#mKeywords').value = d.keywords;
  const w = d.watermark; $('#wmOn').checked = w.enabled; $('#wmText').value = w.text; $('#wmSize').value = w.size; $('#wmAngle').value = w.angle; $('#wmColor').value = w.color; $('#wmOpacity').value = w.opacity; $('#oWmOp').textContent = Math.round(w.opacity * 100) + '%';
  const n = d.pageNumbers; $('#pnOn').checked = n.enabled; $('#pnFormat').value = n.format; $('#pnPos').value = n.pos; $('#pnSize').value = n.size; $('#pnStart').value = n.start;
}
function bindDocPanel() {
  const bind = (sel, fn, redraw) => {
    const el = $(sel);
    el.addEventListener('focus', beginEdit); el.addEventListener('pointerdown', beginEdit);
    const go = () => { fn(el); S.dirty = true; if (redraw) { touchAll(); } };
    el.addEventListener('input', go); el.addEventListener('change', () => { go(); endEdit(); });
  };
  bind('#mTitle', (e) => (S.doc.title = e.value));
  bind('#mAuthor', (e) => (S.doc.author = e.value));
  bind('#mSubject', (e) => (S.doc.subject = e.value));
  bind('#mKeywords', (e) => (S.doc.keywords = e.value));
  bind('#wmOn', (e) => (S.doc.watermark.enabled = e.checked), true);
  bind('#wmText', (e) => (S.doc.watermark.text = e.value), true);
  bind('#wmSize', (e) => (S.doc.watermark.size = clamp(+e.value || 64, 6, 400)), true);
  bind('#wmAngle', (e) => (S.doc.watermark.angle = +e.value || 0), true);
  bind('#wmColor', (e) => (S.doc.watermark.color = e.value), true);
  bind('#wmOpacity', (e) => { S.doc.watermark.opacity = +e.value; $('#oWmOp').textContent = Math.round(e.value * 100) + '%'; }, true);
  bind('#pnOn', (e) => (S.doc.pageNumbers.enabled = e.checked), true);
  bind('#pnFormat', (e) => (S.doc.pageNumbers.format = e.value), true);
  bind('#pnPos', (e) => (S.doc.pageNumbers.pos = e.value), true);
  bind('#pnSize', (e) => (S.doc.pageNumbers.size = clamp(+e.value || 10, 4, 72)), true);
  bind('#pnStart', (e) => (S.doc.pageNumbers.start = Math.max(0, +e.value || 0)), true);
}

/* =========================================================== signature */
const sig = { color: '#111827', drawn: false, font: 0, mode: 'draw', uploaded: null };
const SIG_FONTS = ['"Segoe Script", "Brush Script MT", cursive', '"Brush Script MT", "Segoe Script", cursive', '"Lucida Handwriting", "Segoe Script", cursive', '"Snell Roundhand", "Apple Chancery", "Segoe Print", cursive'];
function sigCtx() { const c = $('#sigPad').getContext('2d'); c.lineCap = 'round'; c.lineJoin = 'round'; return c; }
function clearSigPad() { const c = $('#sigPad'); c.getContext('2d').clearRect(0, 0, c.width, c.height); sig.drawn = false; }
async function openSignature() {
  clearSigPad(); sig.uploaded = null; $('#sigTyped').value = '';
  await renderSavedSigs();
  $('#sigDlg').showModal();
}
async function renderSavedSigs() {
  const list = await store.get('signatures', []); const host = $('#savedSigs'); host.innerHTML = '';
  host.hidden = !list.length;
  list.forEach((url, i) => {
    const b = document.createElement('button'); b.className = 'saved-sig'; b.title = 'Use this signature';
    const im = document.createElement('img'); im.src = url; im.alt = 'Saved signature'; b.appendChild(im);
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.title = 'Forget';
    x.addEventListener('click', async (e) => { e.stopPropagation(); list.splice(i, 1); await store.set('signatures', list); renderSavedSigs(); });
    b.appendChild(x);
    b.addEventListener('click', async () => { $('#sigDlg').close(); placeImage(await addImageAsset(url), { signature: true }); });
    host.appendChild(b);
  });
}
function trimCanvas(cv) {
  const ctx = cv.getContext('2d'); const { width: w, height: h } = cv; const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
function typedSigCanvas() {
  const text = $('#sigTyped').value.trim(); if (!text) return null;
  const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 360; const c = cv.getContext('2d');
  c.fillStyle = sig.color; c.textBaseline = 'middle'; let size = 150;
  c.font = `${size}px ${SIG_FONTS[sig.font]}`; while (c.measureText(text).width > 1340 && size > 30) { size -= 6; c.font = `${size}px ${SIG_FONTS[sig.font]}`; }
  c.fillText(text, 30, 185); return cv;
}
function bindSignature() {
  const pad = $('#sigPad'); let last = null;
  const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); last = pos(e); const c = sigCtx(); c.fillStyle = sig.color; c.beginPath(); c.arc(last[0], last[1], 2.4, 0, 7); c.fill(); sig.drawn = true; });
  pad.addEventListener('pointermove', (e) => {
    if (!last) return; const p = pos(e); const c = sigCtx(); const v = Math.hypot(p[0] - last[0], p[1] - last[1]);
    c.strokeStyle = sig.color; c.lineWidth = clamp(6 - v * 0.06, 2.6, 6); c.beginPath(); c.moveTo(...last); c.lineTo(...p); c.stroke(); last = p;
  });
  const up = () => { last = null; }; pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
  $('#sigClear').addEventListener('click', () => { clearSigPad(); $('#sigTyped').value = ''; sig.uploaded = null; $('#sigUploadBtn').textContent = 'Choose image…'; });
  $('#sigClose').addEventListener('click', () => $('#sigDlg').close());
  $$('#sigModeSeg input').forEach((r) => r.addEventListener('change', () => {
    sig.mode = r.value; $('#sigDrawWrap').hidden = r.value !== 'draw'; $('#sigTypeWrap').hidden = r.value !== 'type'; $('#sigUploadWrap').hidden = r.value !== 'upload';
    if (r.value === 'type') setTimeout(() => $('#sigTyped').focus(), 0);
  }));
  const fh = $('#sigFonts');
  SIG_FONTS.forEach((f, i) => {
    const b = document.createElement('button'); b.className = 'sig-font' + (i === 0 ? ' on' : ''); b.style.fontFamily = f; b.textContent = 'Signature';
    b.addEventListener('click', () => { sig.font = i; $$('.sig-font').forEach((x, j) => x.classList.toggle('on', j === i)); });
    fh.appendChild(b);
  });
  $('#sigTyped').addEventListener('input', () => $$('.sig-font').forEach((b) => { b.textContent = $('#sigTyped').value || 'Signature'; }));
  const ch = $('#sigColors');
  ['#111827', '#1e3a8a', '#1d4ed8'].forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'sw' + (i === 0 ? ' on' : ''); b.style.setProperty('--c', c);
    b.addEventListener('click', () => { sig.color = c; $$('#sigColors .sw').forEach((x) => x.classList.toggle('on', x === b)); $$('.sig-font').forEach((x) => (x.style.color = c)); });
    ch.appendChild(b);
  });
  $('#sigUploadBtn').addEventListener('click', () => { $('#fileSig').value = ''; $('#fileSig').click(); });
  $('#fileSig').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; sig.uploaded = await blobToDataUrl(f); $('#sigUploadBtn').textContent = f.name; });
  $('#sigPlace').addEventListener('click', async () => {
    let url = null;
    if (sig.mode === 'upload') url = sig.uploaded;
    else { const src = sig.mode === 'draw' ? (sig.drawn ? pad : null) : typedSigCanvas(); const t = src && trimCanvas(src); url = t && t.toDataURL('image/png'); }
    if (!url) { toast(sig.mode === 'type' ? 'Type your name first.' : sig.mode === 'upload' ? 'Choose an image first.' : 'Draw your signature first.', { type: 'warn' }); return; }
    if ($('#sigSave').checked) { const list = await store.get('signatures', []); if (!list.includes(url)) { list.unshift(url); await store.set('signatures', list.slice(0, 6)); } }
    $('#sigDlg').close(); placeImage(await addImageAsset(url), { signature: true });
  });
  $('#sigDlg').addEventListener('close', () => { if (S.tool === 'signature') setTool('select'); });
}

/* ============================================================== export */
let exportFmt = 'pdf';
function buildFormats() {
  const host = $('#formats'); host.innerHTML = '';
  for (const f of FORMATS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'fmt'; b.dataset.id = f.id;
    b.innerHTML = `<span class="fmt-ext">${escHtml(f.ext.split('.').pop().toUpperCase())}</span><span class="fmt-name">${escHtml(f.label)}</span><span class="fmt-tag">${escHtml(f.tag)}</span>`;
    b.addEventListener('click', () => selectFormat(f.id));
    host.appendChild(b);
  }
}
function selectFormat(id) {
  exportFmt = id; const f = FORMATS.find((x) => x.id === id);
  $$('.fmt').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  $$('[data-opt]').forEach((el) => {
    let show = f.opts.includes(el.dataset.opt);
    if (el.dataset.opt === 'dpi' && (id === 'docx' || id === 'html')) show = $('input[name=mode]:checked').value === 'images';
    if (el.dataset.opt === 'annots' && (id === 'docx' || id === 'html') && $('input[name=mode]:checked').value === 'text') show = false;
    if (el.dataset.opt === 'zip') show = show && (rangePages().length > 1);
    el.hidden = !show;
  });
  $('#rangeSeg').closest('.field').hidden = !!f.noRange;
  $('#formatHint').textContent = f.desc;
  const btn = $('#btnDoExport span'); btn.textContent = `Export ${f.label}`;
}
function rangePages() {
  const r = $('input[name=range]:checked').value;
  if (r === 'current') return [currentPage()].filter(Boolean);
  if (r === 'selected') { const s = S.pages.filter((p) => S.selectedPages.has(p.id)); return s.length ? s : [currentPage()].filter(Boolean); }
  if (r === 'custom') return parseRange($('#rangeCustom').value, S.pages.length).map((i) => S.pages[i]);
  return S.pages.slice();
}
async function openExport(fmt) {
  if (!S.pages.length) { toast('Open a document first.', { type: 'warn' }); return; }
  commitTextEdit(); endEdit();
  const prefs = await store.get('exportPrefs', {});
  if (prefs.dpi) $('#optDpi').value = prefs.dpi; if (prefs.quality) $('#optQuality').value = prefs.quality;
  $('#oDpi').textContent = $('#optDpi').value + ' dpi'; $('#oQuality').textContent = Math.round($('#optQuality').value * 100) + '%';
  $('#exportName').value = baseName(S.fileName) + (S.dirty ? '-edited' : '');
  $('#exportProgress').hidden = true;
  const selRadio = $('input[name=range][value=selected]'); selRadio.closest('label').classList.toggle('disabled', S.selectedPages.size === 0);
  selectFormat(fmt || prefs.fmt || 'pdf');
  $('#exportDlg').showModal();
}
async function doExport() {
  const f = FORMATS.find((x) => x.id === exportFmt);
  const pages = f.noRange ? S.pages.slice() : rangePages();
  if (!pages.length) { toast('That page range is empty.', { type: 'warn' }); return; }
  const o = {
    name: $('#exportName').value || baseName(S.fileName), dpi: +$('#optDpi').value, quality: +$('#optQuality').value,
    flatten: $('#optFlatten').checked, annots: $('#optAnnots').checked, zip: $('#optZip').checked,
    mode: $('input[name=mode]:checked').value,
  };
  store.set('exportPrefs', { fmt: exportFmt, dpi: o.dpi, quality: o.quality });
  const prog = $('#exportProgress'); prog.hidden = false; const bar = prog.querySelector('i'), lab = prog.querySelector('span');
  const form = $('#exportForm'); form.classList.add('busy');
  try {
    const res = await Exporter.run(exportFmt, pages, o, (frac, label) => { bar.style.width = Math.round(frac * 100) + '%'; lab.textContent = label || ''; });
    $('#exportDlg').close();
    if (exportFmt === 'pdf' || exportFmt === 'project') S.dirty = false;
    toast(`Exported ${res.count > 1 && !o.zip ? res.count + ' files' : f.label}.`);
    res.warnings.forEach((w) => toast(w, { type: 'warn', timeout: 8000 }));
  } catch (e) {
    console.error(e); toast('Export failed: ' + e.message, { type: 'error', timeout: 8000 });
  } finally { form.classList.remove('busy'); prog.hidden = true; bar.style.width = '0'; }
}
function bindExport() {
  buildFormats();
  $('#optDpi').addEventListener('input', () => ($('#oDpi').textContent = $('#optDpi').value + ' dpi'));
  $('#optQuality').addEventListener('input', () => ($('#oQuality').textContent = Math.round($('#optQuality').value * 100) + '%'));
  $$('input[name=range]').forEach((r) => r.addEventListener('change', () => { $('#rangeCustom').hidden = r.value !== 'custom' || !r.checked; if (r.value === 'custom') $('#rangeCustom').focus(); selectFormat(exportFmt); }));
  $('#rangeCustom').addEventListener('input', () => selectFormat(exportFmt));
  $$('input[name=mode]').forEach((r) => r.addEventListener('change', () => selectFormat(exportFmt)));
  $('#exportForm').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault(); if (!$('#exportForm').classList.contains('busy')) doExport();
  });
  $('#exportDlg').addEventListener('cancel', (e) => { if ($('#exportForm').classList.contains('busy')) e.preventDefault(); });
}

/* ========================================================== loading */
function resetDoc() {
  commitTextEdit();
  for (const s of S.sources) { try { s.pdf.destroy(); } catch { /* */ } }
  S.sources = []; S.pages = []; S.assets = Object.fromEntries(Object.entries(S.assets).filter(([, a]) => a.type === 'font'));
  S.doc = DEFAULT_DOC(); S.formValues = {}; S.undo = []; S.redo = []; S.sel = null; S.selectedPages = new Set(); S.dirty = false;
  _textCache.clear(); _imgCache.clear(); searchHits = []; $('#searchResults').innerHTML = ''; $('#searchMeta').textContent = '';
  for (const [, el] of pageEls) { io.unobserve(el.wrap); el.wrap.remove(); } pageEls.clear(); visible.clear();
  for (const [, t] of thumbEls) { thumbIO.unobserve(t.el); t.el.remove(); } thumbEls.clear();
  onHistoryChange();
}
function setFileName(n) { S.fileName = n; $('#fileName').value = n; document.title = `${n} — Folio PDF Editor`; }
async function afterLoad(first) {
  refreshPages(); buildForms(); fillDocPanel(); refreshPropsUI();
  requestAnimationFrame(() => { setZoom(0, S.zoomMode === 'custom' ? 'fit-width' : S.zoomMode); if (first) scrollToPage(first, false); });
}
async function loadInfoFromPdf(src) {
  try {
    const { info } = await src.pdf.getMetadata();
    if (info) { S.doc.title = info.Title || ''; S.doc.author = info.Author || ''; S.doc.subject = info.Subject || ''; S.doc.keywords = info.Keywords || ''; }
  } catch { /* ignore */ }
}
const isPdf = (f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
const isImg = (f) => /^image\//i.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name);
const isProject = (f) => /\.json$/i.test(f.name) || /json/i.test(f.type);

async function openFiles(files, append) {
  files = [...files]; if (!files.length) return;
  const proj = files.find(isProject);
  if (proj && !append) return importProject(proj);
  const usable = files.filter((f) => isPdf(f) || isImg(f));
  if (!usable.length) { toast('Please choose PDF or image files.', { type: 'warn' }); return; }
  if (!append && S.dirty && !confirm('Discard your unsaved changes and open a new document?')) return;
  const busy = showBusy(`Opening ${usable.length > 1 ? usable.length + ' files' : usable[0].name}…`);
  try {
    if (!append || !S.pages.length) { resetDoc(); setFileName(usable[0].name.replace(/\.[^.]+$/, '') + '.pdf'); }
    else pushHistory();
    let firstNew = null; let loadedFirst = false;
    for (const f of usable) {
      try {
        const bytes = isPdf(f) ? await bytesOf(f) : await imageToPdfBytes(f);
        const { src, pages } = await addSource(f.name, bytes);
        if (!loadedFirst && !append && isPdf(f)) { await loadInfoFromPdf(src); loadedFirst = true; }
        S.pages.push(...pages); firstNew = firstNew || pages[0].id;
      } catch (e) {
        console.error(e);
        toast(/password/i.test(e.name + e.message) ? `“${f.name}” needs a password.` : `Couldn’t open “${f.name}”: ${e.message}`, { type: 'error', timeout: 6000 });
      }
    }
    syncFormStorage();
    await afterLoad(append ? firstNew : null);
    if (append && firstNew) { toast('Files added at the end.'); setTimeout(() => scrollToPage(firstNew), 100); }
  } finally { busy(); }
}
async function openBytes(name, bytes) {
  resetDoc(); setFileName(name);
  const { src, pages } = await addSource(name, bytes); await loadInfoFromPdf(src);
  S.pages = pages; syncFormStorage(); await afterLoad();
}
async function importProject(file) {
  if (S.dirty && !confirm('Discard your unsaved changes and open this project?')) return;
  const busy = showBusy('Opening project…');
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'folio-pdf-editor') throw new Error('Not a Folio project file');
    resetDoc();
    for (const s of data.sources) await addSource(s.name, b64ToBytes(s.b64), s.id);
    S.assets = { ...S.assets, ...data.assets }; S.pages = data.pages; S.doc = { ...DEFAULT_DOC(), ...data.doc }; S.formValues = data.formValues || {};
    for (const [k, a] of Object.entries(S.assets)) if (a.type === 'font') await registerFontAsset(k);
    setFileName(data.fileName || 'document.pdf'); syncFormStorage(); await afterLoad();
    toast('Project restored — keep editing.');
  } catch (e) { console.error(e); toast('Couldn’t open project: ' + e.message, { type: 'error' }); } finally { busy(); }
}
function newBlank() {
  if (S.dirty && !confirm('Discard your unsaved changes?')) return;
  resetDoc(); setFileName('Untitled.pdf');
  S.pages = [{ id: uid(), src: null, idx: 0, W: 612, H: 792, view: [0, 0, 612, 792], orot: 0, urot: 0, annots: [] }];
  afterLoad(); setTool('text');
}
function showBusy(msg) {
  const t = document.createElement('div'); t.className = 'toast busy in'; t.textContent = msg; $('#toasts').appendChild(t);
  return () => t.remove();
}
passwordPrompt = (reason) => new Promise((resolve) => {
  const dlg = $('#pwDlg'); $('#pwInput').value = '';
  $('#pwMsg').textContent = reason === 2 ? 'Incorrect password — try again.' : 'This PDF is protected. Enter its password to open it.';
  dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? $('#pwInput').value : null);
  dlg.showModal(); setTimeout(() => $('#pwInput').focus(), 0);
});

/* ============================================================== wiring */
function bindUI() {
  $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#btnOpen').addEventListener('click', () => { $('#fileOpen').value = ''; $('#fileOpen').click(); });
  $('#btnOpen2').addEventListener('click', () => { $('#fileOpen').value = ''; $('#fileOpen').click(); });
  $('#btnAdd').addEventListener('click', () => { $('#fileAdd').value = ''; $('#fileAdd').click(); });
  $('#btnNew').addEventListener('click', newBlank);
  $('#fileOpen').addEventListener('change', (e) => openFiles(e.target.files, false));
  $('#fileAdd').addEventListener('change', (e) => openFiles(e.target.files, true));
  $('#fileImage').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) { setTool('select'); return; }
    placeImage(await addImageAsset(await blobToDataUrl(f)));
  });
  $('#fileImage').addEventListener('cancel', () => setTool('select'));
  $('#btnUndo').addEventListener('click', undo); $('#btnRedo').addEventListener('click', redo);
  $('#btnZoomIn').addEventListener('click', () => zoomStep(1)); $('#btnZoomOut').addEventListener('click', () => zoomStep(-1));
  $('#zoomSel').addEventListener('change', (e) => { const v = e.target.value; if (v.startsWith('fit')) setZoom(0, v); else if (v !== 'custom') setZoom(+v, 'custom'); });
  $('#pageInput').addEventListener('change', (e) => { const n = clamp(parseInt(e.target.value, 10) || 1, 1, S.pages.length); const p = S.pages[n - 1]; if (p) scrollToPage(p.id); });
  $('#pageInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#fileName').addEventListener('change', (e) => setFileName(e.target.value.trim() || 'document.pdf'));
  $('#btnExport').addEventListener('click', () => openExport());
  $('#pgRotL').addEventListener('click', () => rotatePages(-90)); $('#pgRotR').addEventListener('click', () => rotatePages(90));
  $('#pgDup').addEventListener('click', duplicatePages); $('#pgBlank').addEventListener('click', insertBlank); $('#pgDel').addEventListener('click', deletePages);
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
    if (t.dataset.tab === 'search') setTimeout(() => $('#searchInput').focus(), 0);
  }));
  $('#btnSearch').addEventListener('click', runSearch);
  $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  $('#searchCase').addEventListener('change', runSearch);
  $('#btnHlAll').addEventListener('click', highlightAllHits);
  $('#btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next);
  });

  // drag & drop files
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
    openFiles(e.dataTransfer.files, e.shiftKey && S.pages.length > 0);
  });
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // keyboard
  const KEYS = { v: 'select', h: 'hand', t: 'text', p: 'pen', m: 'highlight', r: 'rect', o: 'ellipse', l: 'line', a: 'arrow', w: 'whiteout', x: 'redact', i: 'image', s: 'signature', n: 'note', e: 'eraser' };
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = ['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable;
    if ($('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && k === 'o') { e.preventDefault(); $('#btnOpen').click(); return; }
    if (mod && k === 's') { e.preventDefault(); openExport(e.shiftKey ? undefined : 'pdf'); return; }
    if (typing) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(1); return; }
    if (mod && k === '-') { e.preventDefault(); zoomStep(-1); return; }
    if (mod && k === '0') { e.preventDefault(); setZoom(1, 'custom'); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (mod && k === 'c') { const s = getSel(); if (s) clipboard = JSON.parse(JSON.stringify(s.o)); return; }
    if (mod && k === 'v') {
      if (!clipboard) return; const p = currentPage(); if (!p) return; e.preventDefault();
      const c = cloneObj(clipboard); translateObj(c, 14, 14); clipboard = JSON.parse(JSON.stringify(c));
      pushHistory(); p.annots.push(c); setTool('select'); select(p, c); touch(p); return;
    }
    if (mod && k === 'a' && document.activeElement && document.activeElement.closest('.sidebar')) { e.preventDefault(); S.selectedPages = new Set(S.pages.map((p) => p.id)); updatePageSelUI(); return; }
    if (k === 'delete' || k === 'backspace') {
      if (getSel()) { e.preventDefault(); deleteSelected(); }
      else if (S.selectedPages.size) { e.preventDefault(); deletePages(); }
      return;
    }
    if (k === 'escape') { if (S.sel) select(null, null); else if (S.selectedPages.size) { S.selectedPages.clear(); updatePageSelUI(); } else setTool('select'); return; }
    if (k.startsWith('arrow') && getSel()) {
      e.preventDefault(); const d = e.shiftKey ? 10 : 1; const s = getSel(); const R = rotOf(s.p);
      let [dx, dy] = { arrowleft: [-d, 0], arrowright: [d, 0], arrowup: [0, -d], arrowdown: [0, d] }[k];
      // convert screen direction to page space
      const mi = inv(matrix(s.p, 1)); const [ax, ay] = apply(mi, 0, 0); const [bx, by] = apply(mi, dx, dy); nudge(bx - ax, by - ay); void R; return;
    }
    if (k === ' ' && !spaceDown) { spaceDown = true; pagesHost.classList.add('panning'); e.preventDefault(); return; }
    if (!mod && !e.altKey && KEYS[k] && S.pages.length) { setTool(KEYS[k]); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; pagesHost.classList.remove('panning'); } });
}

/* ================================================================ boot */
(async function init() {
  const theme = await store.get('theme', null); if (theme) document.documentElement.dataset.theme = theme;
  const tp = await store.get('toolProps', null);
  if (tp) for (const k of Object.keys(S.toolProps)) S.toolProps[k] = { ...S.toolProps[k], ...(tp[k] || {}) };
  fillFontSelect(); bindProps(); bindDocPanel(); bindSignature(); bindExport(); bindUI();
  setTool('select'); onHistoryChange(); fillDocPanel(); refreshPages();
})();
