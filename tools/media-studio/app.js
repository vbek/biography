/* Media Studio, image mode — a small, dependency-free, non-destructive image editor.
   Each image keeps a plain settings object; the preview and every export are rendered from the original
   pixels through the same pipeline: orient (rotate/flip) → crop → resize → blur/sharpen → colour → vignette → watermark. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const MAX_DIM = 16384;

/* ------------------------------------------------------------------ formats */
const FORMATS = [['image/jpeg', 'JPEG', 'jpg'], ['image/png', 'PNG', 'png'], ['image/webp', 'WebP', 'webp'], ['image/avif', 'AVIF', 'avif']]
  .filter(([t]) => { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL(t).startsWith('data:' + t); });
const EXT = Object.fromEntries(FORMATS.map(([t, , e]) => [t, e]));
const LABEL = Object.fromEntries(FORMATS.map(([t, l]) => [t, l]));
const isLossy = (t) => t !== 'image/png';

const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';
const typeLabel = (it) => (it.type.split('/')[1] || it.name.split('.').pop() || '?').replace('svg+xml', 'svg').toUpperCase();

/* ------------------------------------------------------------------ settings */
const ADJ = [
  ['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100], ['saturation', 'Saturation', -100, 100],
  ['warmth', 'Warmth', -100, 100], ['hue', 'Hue', -180, 180, '°'], ['sharpen', 'Sharpen', 0, 100],
  ['blur', 'Blur', 0, 40, 'px'], ['vignette', 'Vignette', 0, 100],
];
const PRESETS = { none: 'Original', vivid: 'Vivid', warm: 'Warm', cool: 'Cool', fade: 'Fade', vintage: 'Vintage', bw: 'B&W', noir: 'Noir', sepia: 'Sepia', invert: 'Invert' };

const defaults = (type) => ({
  rot: 0, fh: false, fv: false, crop: { x: 0, y: 0, w: 1, h: 1 },
  resize: { mode: 'none', w: 0, h: 0, pct: 100, lock: true },
  adj: Object.fromEntries(ADJ.map(([k]) => [k, 0])),
  preset: 'none',
  wm: { text: '', size: 5, color: '#ffffff', opacity: 70, pos: 'br' },
  out: { format: EXT[type] ? type : 'image/png', quality: 85, maxKB: 0, bg: '#ffffff' },
});

const items = [];
let cur = null, cropMode = false, tmpCrop = null, comparing = false, pendingSnap = null, nextId = 1;

/* ------------------------------------------------------------------ geometry */
function orientedSize(it) { return it.s.rot % 180 ? [it.sh, it.sw] : [it.sw, it.sh]; }
function cropPx(it, c = it.s.crop) {
  const [rw, rh] = orientedSize(it);
  const x = Math.round(c.x * rw), y = Math.round(c.y * rh);
  return { x, y, w: Math.max(1, Math.min(rw - x, Math.round(c.w * rw))), h: Math.max(1, Math.min(rh - y, Math.round(c.h * rh))) };
}
function outputSize(it) {
  const { w: cw, h: ch } = cropPx(it), r = it.s.resize;
  let W = cw, H = ch;
  if (r.mode === 'pct') { W = cw * r.pct / 100; H = ch * r.pct / 100; }
  else if (r.mode === 'px') { W = r.w || cw; H = r.lock ? W * ch / cw : (r.h || ch); }
  else if (r.mode === 'fit') { const k = Math.min(1, (r.w || Infinity) / cw, (r.h || Infinity) / ch); W = cw * k; H = ch * k; }
  return [clamp(Math.round(W), 1, MAX_DIM), clamp(Math.round(H), 1, MAX_DIM)];
}

/* ------------------------------------------------------------------ colour (3×4 affine matrices) */
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mul(A, B) { // A after B
  const R = new Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    R[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j] + (j === 3 ? A[i * 4 + 3] : 0);
  }
  return R;
}
const scaleM = (s, o = 0) => [s, 0, 0, o, 0, s, 0, o, 0, 0, s, o];
const contrastM = (f) => scaleM(f, 128 * (1 - f));
const warmM = (t) => [1, 0, 0, t * 0.35, 0, 1, 0, t * 0.05, 0, 0, 1, -t * 0.35];
const satM = (s) => [
  .213 + .787 * s, .715 - .715 * s, .072 - .072 * s, 0,
  .213 - .213 * s, .715 + .285 * s, .072 - .072 * s, 0,
  .213 - .213 * s, .715 - .715 * s, .072 + .928 * s, 0];
function hueM(deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [
    .213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928, 0,
    .213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283, 0,
    .213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072, 0];
}
const SEPIA = [.393, .769, .189, 0, .349, .686, .168, 0, .272, .534, .131, 0];
const lerpM = (A, t) => A.map((v, i) => I[i] * (1 - t) + v * t);
const PRESET_M = {
  vivid: () => mul(contrastM(1.12), satM(1.4)),
  warm: () => mul(satM(1.08), warmM(35)),
  cool: () => mul(satM(0.95), warmM(-35)),
  fade: () => mul(scaleM(0.85, 30), satM(0.75)),
  vintage: () => mul(contrastM(0.9), mul(scaleM(1, 12), lerpM(SEPIA, 0.55))),
  bw: () => satM(0),
  noir: () => mul(contrastM(1.45), satM(0)),
  sepia: () => SEPIA,
  invert: () => scaleM(-1, 255),
};
function colorMatrix(st) {
  const a = st.adj;
  let M = PRESET_M[st.preset] ? PRESET_M[st.preset]() : I;
  if (a.saturation) M = mul(satM(1 + a.saturation / 100), M);
  if (a.hue) M = mul(hueM(a.hue), M);
  if (a.warmth) M = mul(warmM(a.warmth), M);
  if (a.contrast) M = mul(contrastM(1 + a.contrast / 100), M);
  if (a.brightness) M = mul(scaleM(1 + a.brightness / 100), M);
  return M.every((v, i) => Math.abs(v - I[i]) < 1e-6) ? null : M;
}
function applyMatrix(d, m) {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = m[0] * r + m[1] * g + m[2] * b + m[3];
    d[i + 1] = m[4] * r + m[5] * g + m[6] * b + m[7];
    d[i + 2] = m[8] * r + m[9] * g + m[10] * b + m[11];
  }
}

/* ------------------------------------------------------------------ pixel effects */
function blurPass(src, dst, w, h, r, horizontal) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4, lineStep = horizontal ? w * 4 : 4, div = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[base + clamp(i, 0, len - 1) * step + c];
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = sum / div;
        sum += src[base + Math.min(len - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c];
      }
    }
  }
}
function blur(d, w, h, radius) { // three box passes ≈ gaussian
  const r = Math.max(1, Math.round(radius / 1.7)), tmp = new Uint8ClampedArray(d.length);
  for (let k = 0; k < 3; k++) { blurPass(d, tmp, w, h, r, true); blurPass(tmp, d, w, h, r, false); }
}
function sharpen(d, w, h, amount) { // unsharp mask
  const tmp = new Uint8ClampedArray(d.length), b = new Uint8ClampedArray(d.length);
  blurPass(d, tmp, w, h, 1, true); blurPass(tmp, b, w, h, 1, false);
  for (let i = 0; i < d.length; i++) if ((i & 3) !== 3) d[i] = d[i] + amount * (d[i] - b[i]);
}
function vignette(d, w, h, amt) {
  const cx = w / 2, cy = h / 2, max = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    const dy2 = (y + 0.5 - cy) ** 2;
    for (let x = 0; x < w; x++) {
      const t = Math.sqrt((x + 0.5 - cx) ** 2 + dy2) / max;
      if (t <= 0.45) continue;
      const f = 1 - amt * 0.85 * ((t - 0.45) / 0.55) ** 2, i = (y * w + x) * 4;
      d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
    }
  }
}
function drawWatermark(ctx, W, H, wm) {
  const text = wm.text.trim();
  if (!text) return;
  const fs = Math.max(8, W * wm.size / 100), m = Math.min(W, H) * 0.03;
  ctx.save();
  ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = wm.color; ctx.globalAlpha = wm.opacity / 100;
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = fs / 8;
  if (wm.pos === 'tile') {
    const tw = ctx.measureText(text).width, sx = tw + fs * 3, sy = fs * 4, R = Math.hypot(W, H);
    ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let row = 0, y = -R; y < R; y += sy, row++) for (let x = -R + (row % 2) * sx / 2; x < R; x += sx) ctx.fillText(text, x, y);
  } else {
    const v = wm.pos[0], hz = wm.pos[1];
    ctx.textAlign = hz === 'l' ? 'left' : hz === 'r' ? 'right' : 'center';
    ctx.textBaseline = v === 't' ? 'top' : v === 'b' ? 'bottom' : 'middle';
    ctx.fillText(text, hz === 'l' ? m : hz === 'r' ? W - m : W / 2, v === 't' ? m : v === 'b' ? H - m : H / 2);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ render pipeline */
// scale: output pixels per final pixel (preview < 1). full: ignore crop+resize (crop mode). noFx: geometry only (compare).
function render(it, { scale = 1, full = false, noFx = false, fill = null, target = null } = {}) {
  const st = it.s, [rw, rh] = orientedSize(it);
  const c = full ? { x: 0, y: 0, w: rw, h: rh } : cropPx(it);
  const [OW, OH] = full ? [rw, rh] : outputSize(it);
  const W = Math.max(1, Math.round(OW * scale)), H = Math.max(1, Math.round(OH * scale));
  const cv = target || document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, H);
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, W, H); }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.scale(W / c.w, H / c.h); ctx.translate(-c.x, -c.y);
  ctx.translate(rw / 2, rh / 2); ctx.scale(st.fh ? -1 : 1, st.fv ? -1 : 1); ctx.rotate(st.rot * Math.PI / 180);
  ctx.drawImage(it.bitmap, -it.sw / 2, -it.sh / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (noFx) return cv;

  const a = st.adj, M = colorMatrix(st), k = W / OW;
  const vig = a.vignette + (st.preset === 'vintage' ? 30 : 0), blurR = a.blur * k;
  if (M || vig > 0 || blurR >= 0.5 || a.sharpen > 0) {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    if (blurR >= 0.5) blur(d, W, H, blurR);
    if (a.sharpen > 0) sharpen(d, W, H, a.sharpen / 50);
    if (M) applyMatrix(d, M);
    if (vig > 0) vignette(d, W, H, Math.min(1, vig / 100));
    ctx.putImageData(img, 0, 0);
  }
  drawWatermark(ctx, W, H, st.wm);
  return cv;
}

function canvasToBlob(cv, type, q) {
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Your browser could not encode this image.'))), type, q));
}
// Encode at full size; with a size limit, binary-search the quality for the largest file under it.
async function encode(it) {
  const o = it.s.out, type = o.format;
  const cv = render(it, { fill: type === 'image/jpeg' ? o.bg : null });
  if (!isLossy(type)) return { blob: await canvasToBlob(cv, type), q: null };
  if (!o.maxKB) return { blob: await canvasToBlob(cv, type, o.quality / 100), q: o.quality };
  const target = o.maxKB * 1024;
  let b = await canvasToBlob(cv, type, 0.95);
  if (b.size <= target) return { blob: b, q: 95 };
  let lo = 0.02, hi = 0.95, best = null, bestQ = lo;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    b = await canvasToBlob(cv, type, mid);
    if (b.size <= target) { best = b; bestQ = mid; lo = mid; } else hi = mid;
  }
  if (!best) { best = await canvasToBlob(cv, type, 0.02); return { blob: best, q: 2, over: best.size > target }; }
  return { blob: best, q: Math.round(bestQ * 100) };
}

/* ------------------------------------------------------------------ preview */
let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

// comparing: false | 'overlay' (original as a see-through layer in its own pixel space) | 'split' (before/after slider)
let split = 50, lastCompare = 'overlay';
const ov = { opacity: 50, u: 1, dx: 0, dy: 0, align: 'match', top: false, diff: false };
function setCompare(mode) {
  if (comparing === mode || (mode && !cur)) return;
  if (mode && cropMode) exitCrop(false);
  comparing = mode;
  if (mode) lastCompare = mode;
  $('#btnCompare').classList.toggle('active', !!mode);
  $('#cmpbar').hidden = !mode;
  $('#cmpOverlay').setAttribute('aria-pressed', mode === 'overlay');
  $('#cmpSplit').setAttribute('aria-pressed', mode === 'split');
  $('#ovCtl').hidden = mode !== 'overlay';
  $('#cmpHint').hidden = mode !== 'split';
  $('#wrap').hidden = !cur || mode === 'overlay';
  $('#ovStage').hidden = mode !== 'overlay';
  $('#wrap').classList.toggle('split', mode === 'split');
  $('#before').hidden = $('#splitUi').hidden = mode !== 'split';
  schedule();
}

/* ------------------------------------------------------------------ overlay compare */
// Same geometry as render(): maps original-image pixels to output pixels.
function forwardMatrix(it) {
  const st = it.s, [rw, rh] = orientedSize(it), c = cropPx(it), [OW, OH] = outputSize(it);
  return new DOMMatrix().scale(OW / c.w, OH / c.h).translate(-c.x, -c.y).translate(rw / 2, rh / 2)
    .scale(st.fh ? -1 : 1, st.fv ? -1 : 1).rotate(st.rot).translate(-it.sw / 2, -it.sh / 2);
}
function bounds(m, w, h) {
  const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
let ovFrozen = null, ovFrame = null, ovEditKey = '', ovOrigKey = '';
function drawOverlay() {
  const it = cur, [OW, OH] = outputSize(it), dpr = window.devicePixelRatio || 1;
  // edited layer -> original pixel space: either back onto the area it came from, or at true size, centred
  const E = ov.align === 'match' ? forwardMatrix(it).inverse() : new DOMMatrix().translate((it.sw - OW) / 2, (it.sh - OH) / 2);
  const O = new DOMMatrix().translate(ov.dx, ov.dy).translate(it.sw / 2, it.sh / 2).scale(ov.u).translate(-it.sw / 2, -it.sh / 2);
  let frame = ovFrozen; // keep the framing still while the original is being dragged
  if (!frame) {
    const a = bounds(E, OW, OH), b = bounds(O, it.sw, it.sh);
    const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[2], b[2]), y1 = Math.max(a[3], b[3]);
    const vp = $('#viewport'), k = Math.min(1, (vp.clientWidth - 40) / (x1 - x0), (vp.clientHeight - 40) / (y1 - y0));
    frame = { k, x0, y0, w: x1 - x0, h: y1 - y0 };
  }
  ovFrame = frame;
  const D = new DOMMatrix().scale(frame.k).translate(-frame.x0, -frame.y0);
  const stage = $('#ovStage'), ed = $('#ovEdit'), og = $('#ovOrig');
  stage.style.width = frame.w * frame.k + 'px'; stage.style.height = frame.h * frame.k + 'px';

  const editPx = frame.k * Math.hypot(E.a, E.b), origPx = frame.k * ov.u; // screen px per layer px
  const eScale = Math.min(1, editPx * dpr), oScale = Math.min(1, origPx * dpr);
  const eKey = JSON.stringify([it.id, it.s, eScale.toFixed(3)]), oKey = JSON.stringify([it.id, oScale.toFixed(3)]);
  if (eKey !== ovEditKey) { render(it, { scale: eScale, target: ed }); ovEditKey = eKey; }
  if (oKey !== ovOrigKey) { render({ ...it, s: defaults(it.type) }, { scale: oScale, noFx: true, target: og }); ovOrigKey = oKey; }

  Object.assign(ed.style, { width: OW + 'px', height: OH + 'px', transform: D.multiply(E).toString(), outlineWidth: 1.5 / editPx + 'px' });
  Object.assign(og.style, {
    width: it.sw + 'px', height: it.sh + 'px', transform: D.multiply(O).toString(), outlineWidth: 1.5 / origPx + 'px',
    opacity: ov.diff ? 1 : ov.opacity / 100, mixBlendMode: ov.diff ? 'difference' : 'normal', zIndex: ov.top || ov.diff ? 2 : 0,
  });
  ed.style.zIndex = 1;
  $('#ovOpacity').disabled = ov.diff;
  overlayInfo(it, OW, OH);
}
function overlayInfo(it, OW, OH) {
  const st = it.s, c = cropPx(it), [rw, rh] = orientedSize(it), notes = [];
  if (c.w !== rw || c.h !== rh) notes.push(`cropped to ${c.w}×${c.h}`);
  if (st.rot) notes.push(`rotated ${st.rot}°`);
  if (st.fh) notes.push('flipped horizontally');
  if (st.fv) notes.push('flipped vertically');
  const pct = Math.round(OW / c.w * 100);
  if (pct !== 100) notes.push(`scaled ${pct}%`);
  $('#cmpInfo').innerHTML = `<span class="key"><span class="sw edit"></span>Edited</span><span class="key"><span class="sw orig"></span>Original</span>`
    + `<span><b>${it.sw}×${it.sh}</b> → <b>${OW}×${OH}</b>${notes.length ? ' · ' + notes.join(' · ') : ' · same size'}</span>`;
}
function setOv(patch) {
  Object.assign(ov, patch);
  $('#ovOpacity').value = ov.opacity; $('#ovOpacityV').textContent = ov.opacity + '%';
  $('#ovScale').value = Math.round(ov.u * 100); $('#ovScaleV').textContent = Math.round(ov.u * 100) + '%';
  $('#ovAlign').value = ov.align; $('#ovTop').checked = ov.top; $('#ovDiff').checked = ov.diff;
  schedule();
}
function bindOverlay() {
  $('#ovOpacity').oninput = (e) => setOv({ opacity: +e.target.value });
  $('#ovScale').oninput = (e) => setOv({ u: +e.target.value / 100 });
  $('#ovAlign').onchange = (e) => setOv({ align: e.target.value, dx: 0, dy: 0, u: 1 });
  $('#ovTop').onchange = (e) => setOv({ top: e.target.checked });
  $('#ovDiff').onchange = (e) => setOv({ diff: e.target.checked });
  $('#ovReset').onclick = () => setOv({ dx: 0, dy: 0, u: 1 });
  const stage = $('#ovStage');
  stage.addEventListener('pointerdown', (e) => {
    e.preventDefault(); stage.focus();
    if (!ovFrame) return;
    ovFrozen = ovFrame;
    const sx = e.clientX, sy = e.clientY, d0 = { dx: ov.dx, dy: ov.dy };
    stage.setPointerCapture(e.pointerId); stage.classList.add('dragging');
    const move = (ev) => setOv({ dx: d0.dx + (ev.clientX - sx) / ovFrozen.k, dy: d0.dy + (ev.clientY - sy) / ovFrozen.k });
    const up = () => {
      ovFrozen = null; stage.classList.remove('dragging'); schedule();
      stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up);
    };
    stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  });
  stage.addEventListener('wheel', (e) => { e.preventDefault(); setOv({ u: clamp(ov.u * Math.exp(-e.deltaY * 0.0015), 0.1, 4) }); }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); setOv({ dx: ov.dx + mv[0], dy: ov.dy + mv[1] }); }
  });
}
function setSplit(v) {
  split = clamp(v, 0, 100);
  $('#wrap').style.setProperty('--split', split + '%');
  $('#divider').setAttribute('aria-valuenow', Math.round(split));
}

function draw() {
  if (!cur) return;
  if (comparing === 'overlay') { drawOverlay(); updateInfo(); return; }
  const it = cur;
  const vp = $('#viewport'), [OW, OH] = cropMode ? orientedSize(it) : outputSize(it);
  const css = Math.min(1, (vp.clientWidth - 40) / OW, (vp.clientHeight - 40) / OH);
  const scale = Math.min(1, css * (window.devicePixelRatio || 1)), view = $('#view');
  render(it, { scale, full: cropMode, target: view });
  // 'split' draws the same crop/rotation/size without colour edits on top, clipped at the divider
  if (comparing === 'split') render(cur, { scale, noFx: true, target: $('#before') });
  view.style.width = OW * css + 'px'; view.style.height = OH * css + 'px';
  $('#crop').hidden = !cropMode;
  if (cropMode) positionCrop();
  updateInfo();
}

/* ------------------------------------------------------------------ info & size estimate */
let estTimer = 0, estToken = 0, lastEst = null;
function updateInfo() {
  const it = cur, [W, H] = outputSize(it), o = it.s.out;
  const est = lastEst && lastEst.id === it.id && lastEst.key === estKey(it) ? lastEst : null;
  let sizeHtml = '<span class="muted">estimating…</span>';
  if (est) {
    const pct = Math.round((est.size / it.size - 1) * 100);
    sizeHtml = `${est.over ? '<span class="bad">' : ''}${fmtBytes(est.size)}${est.over ? '</span>' : ''}`
      + ` <span class="${pct <= 0 ? 'good' : 'bad'}">(${pct > 0 ? '+' : ''}${pct}%)</span>`;
  }
  $('#outInfo').innerHTML = `
    <dt>Original</dt><dd>${it.sw} × ${it.sh} · ${fmtBytes(it.size)} · ${typeLabel(it)}</dd>
    <dt>Output</dt><dd>${W} × ${H} · ${LABEL[o.format]}${est?.q != null && o.maxKB ? ` · q${est.q}` : ''}</dd>
    <dt>File size</dt><dd>${sizeHtml}</dd>`;
  $('#sizeNote').textContent = `Output: ${W} × ${H} px`;
  if (!est) { clearTimeout(estTimer); estTimer = setTimeout(estimate, 450); }
}
const estKey = (it) => JSON.stringify(it.s);
async function estimate() {
  const it = cur;
  if (!it) return;
  const [W, H] = outputSize(it), tok = ++estToken, key = estKey(it);
  if (W * H > 40e6) { lastEst = { id: it.id, key, size: NaN }; return; }
  try {
    const r = await encode(it);
    if (tok !== estToken) return;
    lastEst = { id: it.id, key, size: r.blob.size, q: r.q, over: r.over };
    if (cur === it) updateInfo();
  } catch { /* shown on download */ }
}

/* ------------------------------------------------------------------ opening files */
async function decode(file) {
  if (!/svg/.test(file.type)) {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h });
  } finally { URL.revokeObjectURL(url); }
}

async function addFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|svg|ico)$/i.test(f.name));
  if (!list.length) return toast('Those files are not images.', 'warn');
  let first = null;
  for (const f of list) {
    let bitmap;
    try { bitmap = await decode(f); } catch { toast(`Can't open ${f.name} — your browser doesn't support this format.`, 'warn'); continue; }
    if (bitmap.width * bitmap.height > 120e6) toast(`${f.name} is very large; editing may be slow.`, 'warn');
    const it = {
      id: nextId++, name: f.name, type: f.type, size: f.size, bitmap, sw: bitmap.width, sh: bitmap.height,
      s: defaults(f.type), undo: [], redo: [], outName: f.name.replace(/\.[^.]+$/, '') + '-edited', thumb: URL.createObjectURL(f),
    };
    items.push(it);
    first = first || it;
  }
  if (first) select(first);
  renderStrip();
}

function select(it) {
  if (cropMode) exitCrop(false);
  if (!it) setCompare(false);
  cur = it; pendingSnap = null;
  document.body.classList.toggle('has-img', !!it);
  $('#drop').hidden = !!it; $('#wrap').hidden = !it || comparing === 'overlay';
  if (!it) return;
  setOv({ dx: 0, dy: 0, u: 1 });
  syncUI(); renderStrip(); refreshPresetThumbs(); schedule();
}

function removeItem(it) {
  const i = items.indexOf(it);
  items.splice(i, 1);
  it.bitmap.close?.(); URL.revokeObjectURL(it.thumb);
  if (cur === it) select(items[Math.min(i, items.length - 1)] || null);
  renderStrip();
}

function renderStrip() {
  const strip = $('#strip');
  document.body.classList.toggle('multi', items.length > 1);
  strip.hidden = !items.length;
  strip.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'thumb' + (it === cur ? ' active' : '');
    b.title = it.name;
    b.innerHTML = `<img alt="" src="${it.thumb}"><span class="rm" role="button" aria-label="Remove ${it.name.replace(/"/g, '')}"><svg class="ic"><use href="#i-x"/></svg></span>`;
    b.onclick = (e) => (e.target.closest('.rm') ? removeItem(it) : select(it));
    strip.appendChild(b);
  }
  const add = document.createElement('button');
  add.className = 'thumb add'; add.title = 'Add images'; add.setAttribute('aria-label', 'Add images');
  add.innerHTML = '<svg class="ic"><use href="#i-plus"/></svg>';
  add.onclick = openPicker;
  strip.appendChild(add);
}

/* ------------------------------------------------------------------ history */
function commit(fn) {
  cur.undo.push(JSON.stringify(cur.s));
  if (cur.undo.length > 100) cur.undo.shift();
  cur.redo = [];
  fn(cur.s);
  afterChange();
}
function undo() { if (!cur?.undo.length) return; cur.redo.push(JSON.stringify(cur.s)); cur.s = JSON.parse(cur.undo.pop()); afterChange(); }
function redo() { if (!cur?.redo.length) return; cur.undo.push(JSON.stringify(cur.s)); cur.s = JSON.parse(cur.redo.pop()); afterChange(); }
let geomSig = '';
function afterChange() {
  syncUI(); schedule();
  const sig = JSON.stringify([cur.id, cur.s.rot, cur.s.fh, cur.s.fv, cur.s.crop]);
  if (sig !== geomSig) refreshPresetThumbs();
}

/* ------------------------------------------------------------------ UI <-> state */
const getPath = (o, p) => p.split('.').reduce((v, k) => v?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'), last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; }
function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range' || el.type === 'number') return el.value === '' ? 0 : +el.value;
  return el.value;
}
function showSliderValue(el) {
  const out = el.closest('.slider')?.querySelector('output');
  if (out) out.textContent = (+el.value > 0 && +el.min < 0 ? '+' : '') + el.value + (el.dataset.unit || '');
}

function syncUI() {
  const s = cur.s;
  for (const el of $$('[data-k]')) {
    const v = getPath(s, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.id === 'maxKB') el.value = v || '';
    else el.value = v;
    showSliderValue(el);
  }
  const r = s.resize, [W, H] = outputSize(cur);
  $('#rowWH').hidden = !(r.mode === 'px' || r.mode === 'fit');
  $('#rowPct').hidden = r.mode !== 'pct';
  $('#lockWrap').hidden = r.mode !== 'px';
  if (document.activeElement !== $('#rw')) $('#rw').value = r.mode === 'fit' ? (r.w || '') : W;
  if (document.activeElement !== $('#rh')) $('#rh').value = r.mode === 'fit' ? (r.h || '') : H;
  $('#rw').placeholder = $('#rh').placeholder = r.mode === 'fit' ? 'any' : '';
  $('#rowQuality').hidden = !isLossy(s.out.format) || !!s.out.maxKB;
  $('#rowMaxKB').hidden = !isLossy(s.out.format);
  $('#rowBg').hidden = s.out.format !== 'image/jpeg';
  $('#outExt').textContent = '.' + EXT[s.out.format];
  if (document.activeElement !== $('#outName')) $('#outName').value = cur.outName;
  $('#btnUndo').disabled = !cur.undo.length; $('#btnRedo').disabled = !cur.redo.length;
  $$('.preset').forEach((b) => b.classList.toggle('active', b.dataset.p === s.preset));
}

function bindInputs() {
  for (const el of $$('[data-k]')) {
    el.addEventListener('input', () => {
      if (!cur) return;
      if (!pendingSnap) pendingSnap = JSON.stringify(cur.s);
      const k = el.dataset.k;
      if (k === 'resize.mode') initResize(cur.s.resize, el.value);
      setPath(cur.s, k, readInput(el));
      showSliderValue(el);
      if (el.tagName === 'SELECT' || el.type === 'checkbox') finishInput();
      else { if (k === 'resize.pct') syncUI(); schedule(); }
    });
    el.addEventListener('change', finishInput);
    if (el.type === 'range' && el.closest('#adjust')) el.addEventListener('dblclick', () => { el.value = 0; el.dispatchEvent(new Event('input')); finishInput(); });
  }
}
function finishInput() {
  if (!cur || !pendingSnap) return;
  if (pendingSnap !== JSON.stringify(cur.s)) { cur.undo.push(pendingSnap); cur.redo = []; }
  pendingSnap = null;
  afterChange();
}
function initResize(r, mode) {
  const [W, H] = outputSize(cur);
  if (mode === 'px') { r.w = W; r.h = H; }
  if (mode === 'fit') { r.w = W; r.h = H; }
  if (mode === 'pct') r.pct = 100;
}
function onDimInput(which) {
  if (!cur) return;
  const r = cur.s.resize, v = clamp(Math.round(+$('#r' + which).value || 0), 0, MAX_DIM);
  if (!pendingSnap) pendingSnap = JSON.stringify(cur.s);
  const { w: cw, h: ch } = cropPx(cur);
  if (r.mode === 'px') {
    if (!v) return;
    if (which === 'w') { r.w = v; if (!r.lock) r.h = r.h || ch; }
    else if (r.lock) { r.w = Math.max(1, Math.round(v * cw / ch)); $('#rw').value = r.w; }
    else { r.h = v; r.w = r.w || cw; }
    if (r.lock) { const other = which === 'w' ? '#rh' : '#rw'; $(other).value = outputSize(cur)[which === 'w' ? 1 : 0]; }
  } else if (r.mode === 'fit') r[which] = v;
  updateInfo(); schedule();
}

/* ------------------------------------------------------------------ geometry actions */
function rotate(dir) {
  const [W, H] = outputSize(cur);
  commit((s) => {
    const c = s.crop;
    s.crop = dir > 0 ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
    // the flip is applied after the rotation, so with a single flip the stored angle turns the other way
    s.rot = (s.rot + ((dir > 0) !== (s.fh !== s.fv) ? 90 : 270)) % 360;
    if (s.resize.mode === 'px') { s.resize.w = H; s.resize.h = W; }
    if (s.resize.mode === 'fit') [s.resize.w, s.resize.h] = [s.resize.h, s.resize.w];
  });
}
function flip(horizontal) {
  commit((s) => {
    const c = s.crop;
    if (horizontal) { s.fh = !s.fh; c.x = 1 - (c.x + c.w); } else { s.fv = !s.fv; c.y = 1 - (c.y + c.h); }
  });
}

/* ------------------------------------------------------------------ crop mode */
const MIN_CROP = 0.02;
function aspectNorm() {
  const v = $('#cropAspect').value;
  if (v === 'free') return null;
  const [rw, rh] = orientedSize(cur);
  const ar = v === 'orig' ? rw / rh : v.split(':').reduce((a, b) => a / b);
  return ar * rh / rw;
}
function enterCrop() {
  setCompare(false);
  cropMode = true; tmpCrop = { ...cur.s.crop };
  $('#crop').hidden = false; $('#cropbar').hidden = false; $('#btnCrop').classList.add('active');
  schedule();
}
function exitCrop(apply) {
  if (apply && JSON.stringify(tmpCrop) !== JSON.stringify(cur.s.crop)) { const c = tmpCrop; commit((s) => { s.crop = c; }); }
  cropMode = false; tmpCrop = null;
  $('#crop').hidden = true; $('#cropbar').hidden = true; $('#btnCrop').classList.remove('active');
  schedule();
}
function positionCrop() {
  const el = $('#crop'), c = tmpCrop, [rw, rh] = orientedSize(cur);
  Object.assign(el.style, { left: c.x * 100 + '%', top: c.y * 100 + '%', width: c.w * 100 + '%', height: c.h * 100 + '%' });
  $('#cropSize').textContent = `${Math.round(c.w * rw)} × ${Math.round(c.h * rh)}`;
}
function fitAspect(ar) {
  let w = 1, h = 1;
  if (ar >= 1) h = 1 / ar; else w = ar;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}
function dragCrop(type, st, dx, dy, ar) {
  if (type === 'move') return { ...st, x: clamp(st.x + dx, 0, 1 - st.w), y: clamp(st.y + dy, 0, 1 - st.h) };
  let l = st.x, t = st.y, r = st.x + st.w, b = st.y + st.h;
  if (type.includes('w')) l = clamp(l + dx, 0, r - MIN_CROP);
  if (type.includes('e')) r = clamp(r + dx, l + MIN_CROP, 1);
  if (type.includes('n')) t = clamp(t + dy, 0, b - MIN_CROP);
  if (type.includes('s')) b = clamp(b + dy, t + MIN_CROP, 1);
  if (ar) {
    let w = r - l, h = b - t;
    if (type === 'n' || type === 's') w = h * ar; else h = w / ar;
    if (type === 'n' || type === 's') { const cx = (st.x + st.x + st.w) / 2; l = cx - w / 2; r = cx + w / 2; }
    else if (type.includes('w')) l = r - w; else r = l + w;
    if (type === 'e' || type === 'w') { const cy = (st.y + st.y + st.h) / 2; t = cy - h / 2; b = cy + h / 2; }
    else if (type.includes('n')) t = b - h; else b = t + h;
    if (l < -1e-9 || t < -1e-9 || r > 1 + 1e-9 || b > 1 + 1e-9) return null;
  }
  return { x: l, y: t, w: r - l, h: b - t };
}
function bindCrop() {
  const el = $('#crop');
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const type = e.target.dataset.h || 'move', start = { ...tmpCrop }, rect = $('#view').getBoundingClientRect(), ar = aspectNorm();
    const sx = e.clientX, sy = e.clientY;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const next = dragCrop(type, start, (ev.clientX - sx) / rect.width, (ev.clientY - sy) / rect.height, ar);
      if (next) { tmpCrop = next; positionCrop(); }
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  $('#cropAspect').addEventListener('change', () => { const ar = aspectNorm(); if (ar) { tmpCrop = fitAspect(ar); positionCrop(); } });
  $('#cropFull').onclick = () => { $('#cropAspect').value = 'free'; tmpCrop = { x: 0, y: 0, w: 1, h: 1 }; positionCrop(); };
  $('#cropApply').onclick = () => exitCrop(true);
  $('#cropCancel').onclick = () => exitCrop(false);
}

/* ------------------------------------------------------------------ presets */
let thumbTimer = 0;
function buildPresets() {
  const box = $('#presets');
  for (const [p, label] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'preset'; b.dataset.p = p;
    b.innerHTML = `<canvas width="1" height="1"></canvas><span>${label}</span>`;
    b.onclick = () => { if (cur && cur.s.preset !== p) commit((s) => { s.preset = p; }); };
    box.appendChild(b);
  }
}
function refreshPresetThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    if (!cur) return;
    geomSig = JSON.stringify([cur.id, cur.s.rot, cur.s.fh, cur.s.fv, cur.s.crop]);
    const { w, h } = cropPx(cur), scale = Math.min(1, 160 / Math.min(w, h));
    for (const b of $$('.preset')) {
      const fake = { ...cur, s: { ...cur.s, preset: b.dataset.p, adj: defaults().adj, wm: { ...cur.s.wm, text: '' }, resize: { mode: 'none' } } };
      render(fake, { scale, target: b.querySelector('canvas') });
    }
  }, 120);
}

/* ------------------------------------------------------------------ export */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const fileName = (it) => (it.outName.trim() || 'image').replace(/[\\/:*?"<>|]+/g, '_') + '.' + EXT[it.s.out.format];

async function busy(label, fn) {
  const btns = $$('#btnDownload, #btnDownload2, #btnZip, #btnCopy');
  btns.forEach((b) => (b.disabled = true));
  document.body.style.cursor = 'progress';
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 'warn'); }
  finally { btns.forEach((b) => (b.disabled = false)); document.body.style.cursor = ''; }
}
async function downloadCurrent() {
  if (!cur) return;
  if (cropMode) exitCrop(true);
  await busy('Saving', async () => {
    const r = await encode(cur);
    download(r.blob, fileName(cur));
    if (r.over) toast(`Couldn't get under ${cur.s.out.maxKB} KB even at the lowest quality — try making the image smaller.`, 'warn');
    else toast(`Saved ${fileName(cur)} (${fmtBytes(r.blob.size)})`);
  });
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
async function downloadZip() {
  if (cropMode) exitCrop(true);
  await busy('Zipping', async () => {
    if (!window.JSZip) await loadScript('lib/jszip.min.js');
    const zip = new JSZip(), used = new Set();
    for (const it of items) {
      let name = fileName(it), n = 2;
      while (used.has(name.toLowerCase())) name = fileName(it).replace(/(\.[^.]+)$/, `-${n++}$1`);
      used.add(name.toLowerCase());
      zip.file(name, (await encode(it)).blob);
    }
    download(await zip.generateAsync({ type: 'blob' }), 'images.zip');
    toast(`Saved ${items.length} images as images.zip`);
  });
}
async function copyCurrent() {
  if (!navigator.clipboard?.write || !window.ClipboardItem) return toast('Copying images isn\'t supported in this browser.', 'warn');
  await busy('Copying', async () => {
    const blob = await canvasToBlob(render(cur), 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied to clipboard (PNG)');
  });
}
function applyToAll() {
  const keep = JSON.stringify(cur.s);
  for (const it of items) {
    if (it === cur) continue;
    it.undo.push(JSON.stringify(it.s)); it.redo = [];
    const s = JSON.parse(keep);
    s.crop = { x: 0, y: 0, w: 1, h: 1 }; s.rot = 0; s.fh = s.fv = false;
    it.s = s;
  }
  toast(`Applied to ${items.length - 1} other image${items.length > 2 ? 's' : ''} (crop and rotation left as they were)`);
}

/* ------------------------------------------------------------------ misc */
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'warn' ? 6000 : 3000);
}
function openPicker() { const f = $('#file'); f.value = ''; f.click(); }

function bindUI() {
  for (const [k, label, min, max, unit] of ADJ) {
    $('#adjust').insertAdjacentHTML('beforeend',
      `<div class="slider"><label>${label} <output></output></label><input type="range" min="${min}" max="${max}" data-k="adj.${k}" data-unit="${unit || ''}"></div>`);
  }
  $('#fmt').innerHTML = FORMATS.map(([t, l]) => `<option value="${t}">${l}</option>`).join('');
  buildPresets(); bindInputs(); bindCrop();

  $('#btnOpen').onclick = $('#btnOpen2').onclick = openPicker;
  $('#file').onchange = (e) => addFiles(e.target.files);
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnReset').onclick = () => commit((s) => { const out = s.out; Object.assign(s, defaults(cur.type), { out }); });
  $('#btnCrop').onclick = () => (cropMode ? exitCrop(true) : enterCrop());
  $('#btnRotL').onclick = () => rotate(-1); $('#btnRotR').onclick = () => rotate(1);
  $('#btnFlipH').onclick = () => flip(true); $('#btnFlipV').onclick = () => flip(false);
  $('#btnDownload').onclick = $('#btnDownload2').onclick = downloadCurrent;
  $('#btnZip').onclick = downloadZip; $('#btnCopy').onclick = copyCurrent; $('#btnApplyAll').onclick = applyToAll;
  $('#outName').oninput = (e) => { if (cur) cur.outName = e.target.value; };
  $('#rw').addEventListener('input', () => onDimInput('w'));
  $('#rh').addEventListener('input', () => onDimInput('h'));
  $('#rw').addEventListener('change', finishInput); $('#rh').addEventListener('change', finishInput);
  $('#quick').onchange = (e) => {
    const v = e.target.value; e.target.value = '';
    if (!v || !cur) return;
    const [mode, arg] = v.split(':');
    commit((s) => {
      const r = s.resize; r.mode = mode;
      if (mode === 'pct') r.pct = +arg;
      else if (mode === 'fit') r.w = r.h = +arg;
      else { const [w, h] = arg.split('x').map(Number); r.w = w; r.h = h; r.lock = false; }
    });
  };

  // Compare: before/after slider; drag anywhere on the image (or the divider, or use arrow keys) to move it.
  $('#btnCompare').onclick = () => setCompare(comparing ? false : lastCompare);
  $('#cmpOverlay').onclick = () => setCompare('overlay');
  $('#cmpSplit').onclick = () => setCompare('split');
  bindOverlay();
  $('#cmpClose').onclick = () => setCompare(false);
  const wrap = $('#wrap');
  wrap.addEventListener('pointerdown', (e) => {
    if (comparing !== 'split') return;
    e.preventDefault();
    const rect = $('#view').getBoundingClientRect();
    const move = (ev) => setSplit((ev.clientX - rect.left) / rect.width * 100);
    const up = () => { wrap.removeEventListener('pointermove', move); wrap.removeEventListener('pointerup', up); wrap.removeEventListener('pointercancel', up); };
    wrap.setPointerCapture(e.pointerId);
    move(e);
    wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
  });
  $('#divider').addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 2;
    const next = { ArrowLeft: split - step, ArrowRight: split + step, Home: 0, End: 100 }[e.key];
    if (next !== undefined) { e.preventDefault(); setSplit(next); }
  });

  // drag & drop + paste
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}${i ? '-' + i : ''}.png`, { type: f.type })))); }
  });

  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && !['range', 'checkbox', 'color'].includes(e.target.type);
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'o') { e.preventDefault(); openPicker(); return; }
    if (!cur) return;
    if (mod && k === 's') { e.preventDefault(); downloadCurrent(); return; }
    if (typing) return;
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (comparing && e.key === 'Escape') setCompare(false);
    else if (cropMode && e.key === 'Escape') exitCrop(false);
    else if (cropMode && e.key === 'Enter') exitCrop(true);
  });
  new ResizeObserver(schedule).observe($('#viewport'));
}

bindUI();
