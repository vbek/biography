'use strict';
/* Folio PDF Editor — core model, geometry, drawing and document loading.
 *
 * Coordinate system: every annotation is stored in "page space" — PDF points
 * measured from the top-left corner of the UNROTATED page (x right, y down).
 * Display/export transforms add the page rotation on top, so annotations stay
 * glued to the content when a page is rotated.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BASE = 96 / 72;          // CSS px per PDF point at 100% zoom
const ASC = 0.8;               // baseline offset as a fraction of font size
const LH = 1.2;                // line height
const NOTE = 22;               // sticky-note icon size (points)
const DPR = () => window.devicePixelRatio || 1;

const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

const store = {
  async get(k, d) {
    try {
      const v = localStorage.getItem(k); return v ? JSON.parse(v) : d;
    } catch { return d; }
  },
  async set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { console.warn('storage', e); }
  }
};

/* ------------------------------------------------------------------ state */
const DEFAULT_DOC = () => ({
  title: '', author: '', subject: '', keywords: '',
  watermark: { enabled: false, text: 'CONFIDENTIAL', size: 64, angle: 45, color: '#d9480f', opacity: 0.18 },
  pageNumbers: { enabled: false, format: '{n}', pos: 'bc', size: 10, start: 1 }
});

const S = {
  sources: [],          // {id, name, bytes, pdf, fields}
  pages: [],            // {id, src, idx, W, H, view:[x1,y1,x2,y2], orot, urot, annots:[]}
  assets: {},           // id -> {type:'image', dataUrl, w, h} | {type:'font', family, label, b64}
  doc: DEFAULT_DOC(),
  formValues: {},       // `${srcId}::${fieldName}` -> value
  fileName: 'document.pdf',
  zoom: 1, zoomMode: 'fit-width',
  tool: 'select',
  sel: null,            // {pageId, id}
  selectedPages: new Set(),
  undo: [], redo: [],
  dirty: false,
};

const srcById = (id) => S.sources.find((s) => s.id === id);
const pageById = (id) => S.pages.find((p) => p.id === id);

/* --------------------------------------------------------------- history */
function snapshot() {
  return JSON.stringify({ pages: S.pages, doc: S.doc, formValues: S.formValues });
}
function pushHistory() {
  S.undo.push(snapshot());
  if (S.undo.length > 150) S.undo.shift();
  S.redo = [];
  S.dirty = true;
  if (typeof onHistoryChange === 'function') onHistoryChange();
}
function restore(snap) {
  const d = JSON.parse(snap);
  S.pages = d.pages; S.doc = d.doc; S.formValues = d.formValues || {};
}

/* -------------------------------------------------------------- geometry */
const rotOf = (p) => (((p.orot + p.urot) % 360) + 360) % 360;
function dims(p, s) {
  return rotOf(p) % 180 === 0 ? [p.W * s, p.H * s] : [p.H * s, p.W * s];
}
/** Affine matrix [a,b,c,d,e,f] mapping page space → display pixels at scale s. */
function matrix(p, s) {
  const W = p.W, H = p.H;
  switch (rotOf(p)) {
    case 90: return [0, s, -s, 0, H * s, 0];
    case 180: return [-s, 0, 0, -s, W * s, H * s];
    case 270: return [0, -s, s, 0, 0, W * s];
    default: return [s, 0, 0, s, 0, 0];
  }
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function inv(m) {
  const [a, b, c, d, e, f] = m; const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
/** Local (object) frame → page space. Objects with a `rot` are drawn rotated CCW by rot degrees. */
function l2p(o, lx, ly) {
  const t = -(o.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return [o.x + lx * c - ly * s, o.y + lx * s + ly * c];
}
function p2l(o, px, py) {
  const t = (o.rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = px - o.x, dy = py - o.y;
  return [dx * c - dy * s, dx * s + dy * c];
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1; const L = dx * dx + dy * dy;
  let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0; t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/* ----------------------------------------------------------------- fonts */
const STD_FONTS = {
  Helvetica: { label: 'Helvetica (Sans)', css: 'Helvetica, Arial, "Liberation Sans", sans-serif', pdf: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'] },
  Times: { label: 'Times (Serif)', css: '"Times New Roman", Times, "Liberation Serif", serif', pdf: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] },
  Courier: { label: 'Courier (Mono)', css: '"Courier New", Courier, "Liberation Mono", monospace', pdf: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] },
};
function fontCss(name) {
  if (STD_FONTS[name]) return STD_FONTS[name].css;
  const a = S.assets[name];
  return a && a.type === 'font' ? `"${a.family}", sans-serif` : STD_FONTS.Helvetica.css;
}
const cssFont = (o, px) => `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${px}px ${fontCss(o.font)}`;
const _mctx = document.createElement('canvas').getContext('2d');
function textBox(o) {
  _mctx.font = cssFont(o, o.size);
  const lines = String(o.text || '').split('\n');
  let w = 0; for (const l of lines) w = Math.max(w, _mctx.measureText(l).width);
  return { w: Math.max(w, o.size * 0.4), h: lines.length * o.size * LH, lines };
}
async function registerFontAsset(id) {
  const a = S.assets[id]; if (!a || a.type !== 'font' || a._loaded) return;
  try {
    const ff = new FontFace(a.family, b64ToBytes(a.b64));
    await ff.load(); document.fonts.add(ff); a._loaded = true;
  } catch (e) { console.warn('font load failed', e); }
}

/* ------------------------------------------------------------ images */
const _imgCache = new Map();
function imgFor(assetId, onload) {
  let im = _imgCache.get(assetId);
  if (!im) {
    const a = S.assets[assetId]; if (!a) return null;
    im = new Image(); im.decoding = 'async';
    im.onload = () => onload && onload();
    im.src = a.dataUrl; _imgCache.set(assetId, im);
  }
  return im;
}
async function ensureImagesLoaded() {
  const ids = Object.keys(S.assets).filter((k) => S.assets[k].type === 'image');
  await Promise.all(ids.map((id) => new Promise((res) => {
    const im = imgFor(id); if (im.complete && im.naturalWidth) return res();
    im.addEventListener('load', res, { once: true }); im.addEventListener('error', res, { once: true });
  })));
}

/* ---------------------------------------------------- virtual objects */
/** Watermark and page numbers are generated per page from document settings. */
function virtualObjs(p) {
  const out = []; const R = rotOf(p); const [Dw, Dh] = dims(p, 1); const mi = inv(matrix(p, 1));
  const wm = S.doc.watermark;
  if (wm.enabled && wm.text) {
    const o = { id: '_wm', type: 'text', virtual: true, text: wm.text, font: 'Helvetica', bold: true, size: +wm.size || 48, color: wm.color, opacity: +wm.opacity, rot: R + (+wm.angle || 0), x: 0, y: 0 };
    const b = textBox(o); const [cx, cy] = apply(mi, Dw / 2, Dh / 2);
    const [ox, oy] = l2p({ x: 0, y: 0, rot: o.rot }, b.w / 2, b.h / 2);
    o.x = cx - ox; o.y = cy - oy; out.push(o);
  }
  const pn = S.doc.pageNumbers;
  if (pn.enabled) {
    const i = S.pages.indexOf(p); const n = i + (+pn.start || 0); const total = S.pages.length - 1 + (+pn.start || 0);
    const text = pn.format.replace('{n}', n).replace('{total}', total);
    const o = { id: '_pn', type: 'text', virtual: true, text, font: 'Helvetica', size: +pn.size || 10, color: '#333333', opacity: 1, rot: R, x: 0, y: 0 };
    const b = textBox(o); const m = Math.max(18, o.size * 2.2);
    const dx = pn.pos[1] === 'c' ? (Dw - b.w) / 2 : pn.pos[1] === 'l' ? m : Dw - m - b.w;
    const dy = pn.pos[0] === 't' ? m - b.h / 2 : Dh - m - b.h / 2;
    [o.x, o.y] = apply(mi, dx, dy); out.push(o);
  }
  return out;
}
const allObjs = (p, withVirtual = true) => (withVirtual ? [...virtualObjs(p), ...p.annots] : p.annots);

/* --------------------------------------------------------------- drawing */
function arrowGeom(o) {
  const dx = o.x2 - o.x1, dy = o.y2 - o.y1; const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L; const hl = Math.min(L * 0.6, Math.max(9, o.sw * 4)); const hw = hl * 0.45;
  const bx = o.x2 - ux * hl, by = o.y2 - uy * hl;
  return { tip: [o.x2, o.y2], a: [bx - uy * hw, by + ux * hw], b: [bx + uy * hw, by - ux * hw], end: [o.x2 - ux * hl * 0.7, o.y2 - uy * hl * 0.7] };
}
/** Draw one object into a context already transformed to page space. */
function drawObj(ctx, o, onImg) {
  ctx.save();
  ctx.globalAlpha = o.opacity ?? 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (o.type) {
    case 'text': {
      const b = textBox(o);
      ctx.translate(o.x, o.y); ctx.rotate(-(o.rot || 0) * Math.PI / 180);
      ctx.font = cssFont(o, o.size); ctx.fillStyle = o.color; ctx.textBaseline = 'alphabetic';
      b.lines.forEach((l, i) => ctx.fillText(l, 0, i * o.size * LH + o.size * ASC));
      break;
    }
    case 'image': {
      const im = imgFor(o.asset, onImg);
      ctx.translate(o.x, o.y); ctx.rotate(-(o.rot || 0) * Math.PI / 180);
      if (im && im.complete && im.naturalWidth) ctx.drawImage(im, 0, 0, o.w, o.h);
      break;
    }
    case 'rect': {
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(o.x, o.y, o.w, o.h); }
      if (o.sw > 0 && o.color) { ctx.strokeStyle = o.color; ctx.lineWidth = o.sw; ctx.lineJoin = 'miter'; ctx.strokeRect(o.x, o.y, o.w, o.h); }
      break;
    }
    case 'ellipse': {
      ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, Math.PI * 2);
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      if (o.sw > 0 && o.color) { ctx.strokeStyle = o.color; ctx.lineWidth = o.sw; ctx.stroke(); }
      break;
    }
    case 'line': case 'arrow': {
      ctx.strokeStyle = o.color; ctx.lineWidth = o.sw; ctx.beginPath(); ctx.moveTo(o.x1, o.y1);
      if (o.type === 'arrow') {
        const g = arrowGeom(o); ctx.lineTo(...g.end); ctx.stroke();
        ctx.fillStyle = o.color; ctx.beginPath(); ctx.moveTo(...g.tip); ctx.lineTo(...g.a); ctx.lineTo(...g.b); ctx.closePath(); ctx.fill();
      } else { ctx.lineTo(o.x2, o.y2); ctx.stroke(); }
      break;
    }
    case 'path': {
      const pts = o.pts; if (!pts.length) break;
      ctx.strokeStyle = o.color; ctx.lineWidth = o.sw;
      if (o.hl) ctx.globalCompositeOperation = 'multiply';
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      ctx.stroke();
      break;
    }
    case 'note': {
      ctx.translate(o.x, o.y); ctx.rotate(-(o.rot || 0) * Math.PI / 180);
      ctx.fillStyle = o.color || '#facc15'; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(NOTE, 0); ctx.lineTo(NOTE, NOTE * 0.7); ctx.lineTo(NOTE * 0.7, NOTE); ctx.lineTo(0, NOTE); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(4, 6.5); ctx.lineTo(NOTE - 4, 6.5); ctx.moveTo(4, 11); ctx.lineTo(NOTE - 4, 11); ctx.moveTo(4, 15.5); ctx.lineTo(NOTE * 0.6, 15.5); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Bounding info used for hit-testing and selection. */
function localSize(o) {
  if (o.type === 'text') { const b = textBox(o); return [b.w, b.h]; }
  if (o.type === 'image') return [o.w, o.h];
  if (o.type === 'note') return [NOTE, NOTE];
  return null;
}
function hitObj(o, x, y, tol) {
  const ls = localSize(o);
  if (ls) { const [lx, ly] = p2l(o, x, y); return lx >= -tol && ly >= -tol && lx <= ls[0] + tol && ly <= ls[1] + tol; }
  switch (o.type) {
    case 'rect': case 'ellipse': {
      const x0 = Math.min(o.x, o.x + o.w), y0 = Math.min(o.y, o.y + o.h), w = Math.abs(o.w), h = Math.abs(o.h);
      const inside = x >= x0 - tol && y >= y0 - tol && x <= x0 + w + tol && y <= y0 + h + tol;
      if (!inside) return false;
      if (o.fill) return true;
      const inner = x > x0 + tol + o.sw && y > y0 + tol + o.sw && x < x0 + w - tol - o.sw && y < y0 + h - tol - o.sw;
      return !inner;
    }
    case 'line': case 'arrow': return segDist(x, y, o.x1, o.y1, o.x2, o.y2) <= o.sw / 2 + tol;
    case 'path': {
      const p = o.pts; if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= o.sw / 2 + tol;
      for (let i = 1; i < p.length; i++) if (segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= o.sw / 2 + tol) return true;
      return false;
    }
  }
  return false;
}
function translateObj(o, dx, dy) {
  if ('x1' in o) { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
  else if (o.pts) o.pts = o.pts.map(([x, y]) => [x + dx, y + dy]);
  else { o.x += dx; o.y += dy; }
}
function normalizeObj(o) {
  if ((o.type === 'rect' || o.type === 'ellipse') && (o.w < 0 || o.h < 0)) {
    if (o.w < 0) { o.x += o.w; o.w = -o.w; }
    if (o.h < 0) { o.y += o.h; o.h = -o.h; }
  }
}
function cloneObj(o) { const c = JSON.parse(JSON.stringify(o)); c.id = uid(); return c; }

/* ------------------------------------------------------- page rendering */
const AM = pdfjsLib.AnnotationMode;
/** Render a page (plus optional annotations) into a fresh canvas at scale (px per point). */
async function renderPageCanvas(p, scale, { annots = true, intent = 'display', rotation = null } = {}) {
  const pp = rotation == null ? p : { ...p, orot: rotation, urot: 0 };
  const [w, h] = dims(pp, scale);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (p.src != null) {
    const src = srcById(p.src);
    const page = await src.pdf.getPage(p.idx + 1);
    const vp = page.getViewport({ scale, rotation: rotOf(pp) });
    await page.render({ canvasContext: ctx, viewport: vp, intent, annotationMode: AM.ENABLE_STORAGE }).promise;
  }
  if (annots) {
    ctx.setTransform(...matrix(pp, scale));
    for (const o of allObjs(pp)) drawObj(ctx, o);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return cv;
}
const canvasBlob = (cv, type = 'image/png', q) => new Promise((r) => cv.toBlob(r, type, q));

/* --------------------------------------------------------- loading docs */
async function bytesOf(file) { return new Uint8Array(await file.arrayBuffer()); }
let passwordPrompt = null; // set by UI: async (reason) => string|null

async function openPdfjs(bytes) {
  const task = pdfjsLib.getDocument({
    data: bytes.slice(), isEvalSupported: false,
    standardFontDataUrl: 'lib/standard_fonts/', cMapUrl: 'lib/cmaps/', cMapPacked: true,
  });
  let pw = null;
  task.onPassword = async (update, reason) => {
    const p = passwordPrompt ? await passwordPrompt(reason) : null;
    if (p == null) { task.destroy(); return; }
    pw = p; update(p);
  };
  const pdf = await task.promise;
  return { pdf, password: pw };
}

/** Add a PDF (bytes) as a new source and return its page models. */
async function addSource(name, bytes, forcedId) {
  const { pdf, password } = await openPdfjs(bytes);
  const src = { id: forcedId ?? (S.sources.reduce((m, s) => Math.max(m, s.id), -1) + 1), name, bytes, pdf, password, fields: null };
  S.sources.push(src);
  try { src.fields = await pdf.getFieldObjects(); } catch { src.fields = null; }
  const pages = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const pg = await pdf.getPage(i + 1);
    const view = pg.view.slice();
    pages.push({ id: uid(), src: src.id, idx: i, W: view[2] - view[0], H: view[3] - view[1], view, orot: pg.rotate || 0, urot: 0, annots: [] });
  }
  return { src, pages };
}

/** Convert an image file into single-page PDF bytes. */
async function imageToPdfBytes(file) {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  let bytes = await bytesOf(file); let img;
  try {
    if (/png/i.test(file.type)) img = await doc.embedPng(bytes);
    else if (/jpe?g/i.test(file.type)) img = await doc.embedJpg(bytes);
  } catch { img = null; }
  if (!img) {
    const bmp = await createImageBitmap(file);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    img = await doc.embedPng(new Uint8Array(await (await canvasBlob(cv)).arrayBuffer()));
  }
  let w = img.width * 0.75, h = img.height * 0.75; const k = Math.min(1, 1190 / Math.max(w, h));
  w *= k; h *= k;
  const page = doc.addPage([w, h]); page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  doc.setTitle(file.name.replace(/\.[^.]+$/, ''));
  return doc.save();
}

/* --------------------------------------------------------- text extraction */
const _textCache = new Map();
async function getTextItems(p) {
  if (p.src == null) return [];
  const key = p.src + ':' + p.idx;
  if (_textCache.has(key)) return _textCache.get(key);
  const page = await srcById(p.src).pdf.getPage(p.idx + 1);
  const tc = await page.getTextContent();
  const v = p.view;
  const items = tc.items.filter((it) => it.str !== undefined && it.str.length).map((it) => {
    const [a, b, c, d, e, f] = it.transform;
    const fs = Math.hypot(c, d) || Math.hypot(a, b) || 10;
    return { str: it.str, u: e - v[0], v: v[3] - f, fs, w: it.width, eol: it.hasEOL };
  });
  _textCache.set(key, items);
  return items;
}

/** Group a page's text into lines (array of {text, fs, v}). Includes user-added text boxes. */
async function pageLines(p) {
  const items = (await getTextItems(p)).filter((i) => i.str.trim().length).map((i) => ({ ...i }));
  for (const o of p.annots) {
    if (o.type !== 'text') continue;
    const b = textBox(o);
    b.lines.forEach((l, i) => { if (l.trim()) items.push({ str: l, u: o.x, v: o.y + i * o.size * LH + o.size * ASC, fs: o.size, w: _mctx.measureText(l).width, user: true }); });
  }
  items.sort((a, b) => a.v - b.v || a.u - b.u);
  const lines = [];
  for (const it of items) {
    const L = lines[lines.length - 1];
    if (L && Math.abs(L.v - it.v) < Math.min(L.fs, it.fs) * 0.5) L.items.push(it);
    else lines.push({ v: it.v, fs: it.fs, items: [it] });
    lines[lines.length - 1].user = lines[lines.length - 1].items.every((x) => x.user);
  }
  return lines.map((L) => {
    L.items.sort((a, b) => a.u - b.u);
    let text = ''; let end = null; let fs = 0;
    for (const it of L.items) {
      if (end != null) {
        const gap = it.u - end;
        if (gap > it.fs * 0.18 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += gap > it.fs * 2.5 ? '\t' : ' ';
      }
      text += it.str; end = it.u + it.w; fs = Math.max(fs, it.fs);
    }
    return { text: text.replace(/\s+$/, ''), fs, v: L.v, user: L.user };
  }).filter((l) => l.text.length);
}

/** Build paragraphs across pages: [{page, blocks:[{type:'h1'|'h2'|'p', text}]}] */
async function documentBlocks(pages, onProgress) {
  const all = [];
  for (let i = 0; i < pages.length; i++) {
    all.push(await pageLines(pages[i]));
    onProgress && onProgress((i + 1) / pages.length);
  }
  // body font size = most common size weighted by characters
  const hist = new Map();
  all.flat().forEach((l) => { const k = Math.round(l.fs); hist.set(k, (hist.get(k) || 0) + l.text.length); });
  let body = 11, best = -1; hist.forEach((n, k) => { if (n > best) { best = n; body = k; } });
  return all.map((lines, pi) => {
    const blocks = []; let cur = null; let prev = null;
    for (const l of lines) {
      const level = l.fs >= body * 1.7 && l.text.length < 140 ? 'h1' : !l.user && l.fs >= body * 1.25 && l.text.length < 160 ? 'h2' : 'p';
      const gap = prev ? l.v - prev.v : 0;
      const newBlock = !cur || level !== cur.type || cur.type !== 'p' || gap > Math.max(l.fs, prev.fs) * 1.75 || Math.abs(l.fs - prev.fs) > prev.fs * 0.2 || /^[•\-–▪●◦]\s?/.test(l.text);
      if (newBlock) { cur = { type: level, text: l.text }; blocks.push(cur); }
      else if (/[A-Za-z]-$/.test(cur.text) && /^[a-z]/.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text;
      else cur.text += ' ' + l.text;
      prev = l;
    }
    return { page: pi + 1, blocks };
  });
}

/* --------------------------------------------------------------- utils */
function bytesToB64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const blobToDataUrl = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
function hexToRgb01(hex) {
  const h = String(hex || '#000').replace('#', ''); const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255];
}
function baseName(name) { return String(name || 'document').replace(/\.[^.\/\\]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document'; }
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
/** Parse "1-3, 5, 8-" into zero-based indices against n pages. */
function parseRange(str, n) {
  const out = []; const seen = new Set();
  for (const part of String(str).split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
    else if (/^\d+$/.test(part)) { a = b = +part; }
    else continue;
    if (a > b) [a, b] = [b, a];
    for (let i = Math.max(1, a); i <= Math.min(n, b); i++) if (!seen.has(i)) { seen.add(i); out.push(i - 1); }
  }
  return out;
}
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
