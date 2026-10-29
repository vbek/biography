// AI assist (main thread): model loading, configurable preprocessing, and decoding of
// detection boxes, semantic segmentation, instance masks, query masks (Mask2Former-style) and YOLO-seg.
import { frameCanvas } from './media.js';
import { encodeFull } from './mask.js';
import { db } from './db.js';

export const COCO80 = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear',
  'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza',
  'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote',
  'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors',
  'teddy bear', 'hair drier', 'toothbrush'];

export const OUTPUT_KINDS = {
  auto: 'Auto-detect',
  boxes: 'Boxes (YOLO detection)',
  semantic: 'Semantic segmentation map',
  instance: 'Instance masks + scores + labels',
  queries: 'Query masks + class logits (Mask2Former-style)',
  yoloseg: 'YOLO-seg (boxes + mask prototypes)',
};

let worker = null, seq = 0;
const pending = new Map();
export const model = { loaded: false, name: '', names: COCO80, namesFromModel: false, backend: '', input: null, outputs: [], cfg: null };

function call(msg, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'AI worker failed to start'));
      pending.clear();
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...msg }, transfer);
  });
}

// Class names stored as ONNX metadata "names": "{0: 'person', 1: 'car'}" (Ultralytics style; easy to add to any model).
export function readClassNames(bytes) {
  const tail = bytes.subarray(Math.max(0, bytes.length - 512 * 1024));
  const text = new TextDecoder('latin1').decode(tail);
  const at = text.lastIndexOf('names');
  if (at < 0) return null;
  const start = text.indexOf('{', at);
  const end = text.indexOf('}', start);
  if (start < 0 || end < 0 || end - start > 200000) return null;
  const names = [];
  for (const m of text.slice(start, end + 1).matchAll(/(\d+)\s*:\s*['"]([^'"]*)['"]/g)) names[+m[1]] = m[2];
  return names.length ? names : null;
}

const num = v => (typeof v === 'number' && v > 0 ? v : null);

export function defaultConfig() {
  const sh = model.input?.shape || [1, 3, 640, 640];
  const r = sh.length;
  // NHWC when the last dim is 1 or 3 and the channel slot of NCHW isn't
  const nhwc = (sh[r - 1] === 3 || sh[r - 1] === 1) && !(sh[r - 3] === 3 || sh[r - 3] === 1);
  const h = num(nhwc ? sh[r - 3] : sh[r - 2]) || 640;
  const w = num(nhwc ? sh[r - 2] : sh[r - 1]) || h;
  const u8 = /uint8/.test(model.input?.type || '');
  return {
    width: w, height: h, layout: nhwc ? 'nhwc' : 'nchw', batch: r === 4,
    resize: 'letterbox', order: 'rgb', scale: u8 ? 1 : 1 / 255, mean: [0, 0, 0], std: [1, 1, 1],
    output: 'auto', bg: 0, maskThr: 0.5, as: 'polygon', split: false, names: model.names.join(', '),
  };
}

function loadSaved(name) {
  try { return JSON.parse(localStorage.getItem('aicfg:' + name) || 'null'); } catch { return null; }
}
export function saveConfig(cfg) {
  model.cfg = cfg;
  try { localStorage.setItem('aicfg:' + model.name, JSON.stringify(cfg)); } catch { /* storage unavailable */ }
}

export async function loadModel(file, preferGPU = true, remember = true) {
  const buf = await file.arrayBuffer();
  const copy = remember ? buf.slice(0) : null;
  const names = readClassNames(new Uint8Array(buf));
  const info = await call({ cmd: 'load', buffer: buf, preferGPU }, [buf]);
  Object.assign(model, {
    loaded: true, name: file.name, names: names || COCO80, namesFromModel: !!names, backend: info.backend,
    input: info.inputs[0], outputs: info.outputs,
  });
  model.cfg = { ...defaultConfig(), ...(loadSaved(file.name) || {}) };
  if (remember) db.putModel({ name: file.name, bytes: copy, saved: Date.now() }).catch(() => {});
  return model;
}

// Re-load the last used model from the browser (no file picker needed).
export async function restoreModel(preferGPU = true) {
  if (model.loaded) return model;
  const rec = await db.getModel().catch(() => null);
  if (!rec?.bytes) return null;
  return loadModel(new File([rec.bytes], rec.name), preferGPU, false);
}
export async function savedModelName() {
  return (await db.getModel().catch(() => null))?.name || null;
}

export function describeModel() {
  if (!model.loaded) return '';
  const io = o => `${o.name} [${(o.shape || ['?']).join(',')}] ${o.type}`;
  return `in: ${io(model.input)} · out: ${model.outputs.map(io).join(', ')}`;
}

// preprocessing
async function preprocess(m, frame, cfg) {
  const src = await frameCanvas(m, frame);
  const W = m.width, H = m.height, iw = cfg.width, ih = cfg.height;
  let g;
  if (cfg.resize === 'stretch') {
    g = { iw, ih, toImg: (x, y) => [x * W / iw, y * H / ih] };
  } else {
    const r = Math.min(iw / W, ih / H);
    const nw = Math.round(W * r), nh = Math.round(H * r);
    const px = Math.floor((iw - nw) / 2), py = Math.floor((ih - nh) / 2);
    g = { iw, ih, px, py, nw, nh, toImg: (x, y) => [(x - px) / r, (y - py) / r] };
  }
  const c = new OffscreenCanvas(iw, ih);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, iw, ih);
  if (cfg.resize === 'stretch') ctx.drawImage(src, 0, 0, iw, ih);
  else ctx.drawImage(src, g.px, g.py, g.nw, g.nh);
  const rgba = ctx.getImageData(0, 0, iw, ih).data;
  const N = iw * ih;
  const u8 = /uint8/.test(model.input?.type || '');
  const data = u8 ? new Uint8Array(3 * N) : new Float32Array(3 * N);
  const order = cfg.order === 'bgr' ? [2, 1, 0] : [0, 1, 2];
  for (let i = 0; i < N; i++) {
    for (let c2 = 0; c2 < 3; c2++) {
      const v = rgba[i * 4 + order[c2]];
      const val = u8 ? v : (v * cfg.scale - cfg.mean[c2]) / cfg.std[c2];
      if (cfg.layout === 'nhwc') data[i * 3 + c2] = val; else data[c2 * N + i] = val;
    }
  }
  const core = cfg.layout === 'nhwc' ? [ih, iw, 3] : [3, ih, iw];
  return { g, data, dims: cfg.batch ? [1, ...core] : core, type: u8 ? 'uint8' : 'float32' };
}

// helpers
const sigmoid = v => 1 / (1 + Math.exp(-v));
const numel = d => d.reduce((a, b) => a * b, 1);
function needsSigmoid(arr) {
  const n = Math.min(arr.length, 20000);
  for (let i = 0; i < n; i++) if (arr[i] < 0 || arr[i] > 1) return true;
  return false;
}
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u > 0 ? inter / u : 0;
}
function nms(dets, thr, max = 300) {
  dets.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of dets) {
    if (keep.some(k => k.cls === d.cls && iou(k.box, d.box) > thr)) continue;
    keep.push(d);
    if (keep.length >= max) break;
  }
  return keep;
}

// Probability map (model space, w×h covering the whole input canvas) -> image-space mask.
function probToMask(prob, w, h, thr, g, m) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (prob[y * w + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const a = new OffscreenCanvas(bw, bh), actx = a.getContext('2d');
  const img = actx.createImageData(bw, bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const j = (y * bw + x) * 4, p = prob[(y + y0) * w + x + x0];
    img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
    img.data[j + 3] = Math.max(0, Math.min(1, p)) * 255;
  }
  actx.putImageData(img, 0, 0);
  const fx = g.iw / w, fy = g.ih / h;
  const [ix0f, iy0f] = g.toImg(x0 * fx, y0 * fy), [ix1f, iy1f] = g.toImg((x1 + 1) * fx, (y1 + 1) * fy);
  const left = Math.max(0, Math.floor(ix0f)), top = Math.max(0, Math.floor(iy0f));
  const right = Math.min(m.width, Math.ceil(ix1f)), bottom = Math.min(m.height, Math.ceil(iy1f));
  const dw = right - left, dh = bottom - top;
  if (dw < 1 || dh < 1) return null;
  const b = new OffscreenCanvas(dw, dh), bctx = b.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  // place the (unclipped) source rect so clipping to the image keeps alignment
  bctx.drawImage(a, ix0f - left, iy0f - top, ix1f - ix0f, iy1f - iy0f);
  const px = bctx.getImageData(0, 0, dw, dh).data;
  const bits = new Uint8Array(dw * dh);
  const t255 = Math.min(254, Math.max(1, thr * 255));
  for (let i = 0; i < bits.length; i++) bits[i] = px[i * 4 + 3] > t255 ? 1 : 0;
  const mk = encodeFull(bits, dw, dh);
  return mk ? { ...mk, left: mk.left + left, top: mk.top + top } : null;
}

// format detection
export function detectKind(outs) {
  const four = outs.filter(o => o.dims.length === 4), three = outs.filter(o => o.dims.length === 3);
  if (four.length === 1 && three.length) {
    const M = four[0].dims[1];
    if (three.some(o => (o.dims[1] < o.dims[2] && o.dims[1] > 4 + M) || o.dims[2] === 6 + M)) return 'yoloseg';
    const Q = four[0].dims[1];
    if (Q > 1 && three.some(o => o.dims[0] === 1 && o.dims[1] === Q && o.dims[2] >= 2 && o.dims[2] < 2000)) return 'queries';
  }
  if (outs.length >= 2 && outs.some(o => o.dims.length >= 3 && numel(o.dims) > 4096)) return 'instance';
  if (outs.length === 1) {
    const d = outs[0].dims;
    if (d.length === 4) return 'semantic';
    if (d.length === 3) {
      const [, a, b] = d;
      if (b === 6 || a / b > 20 || b / a > 20) return 'boxes';
      return 'semantic'; // [1,H,W] class map
    }
  }
  return 'boxes';
}

// decoders (return items in image coords)
function decodeBoxes(o, g, m, conf, iouThr, names) {
  const d = o.data, dims = o.dims;
  const toImgBox = ([x1, y1, x2, y2]) => {
    const [a, b] = g.toImg(x1, y1), [c, e] = g.toImg(x2, y2);
    const cl = (v, mx) => Math.max(0, Math.min(mx, v));
    return [cl(a, m.width), cl(b, m.height), cl(c, m.width), cl(e, m.height)];
  };
  let dets = [];
  if (dims.length === 3 && dims[2] === 6 && dims[1] <= 1000) {
    for (let i = 0; i < dims[1]; i++) {
      const k = i * 6;
      if (d[k + 4] >= conf) dets.push({ box: [d[k], d[k + 1], d[k + 2], d[k + 3]], score: d[k + 4], cls: Math.round(d[k + 5]) });
    }
  } else {
    if (dims.length !== 3) throw new Error('Unsupported box output shape ' + JSON.stringify(dims));
    const tr = dims[1] < dims[2];
    const C = tr ? dims[1] : dims[2], A = tr ? dims[2] : dims[1];
    const at = (a, c) => (tr ? d[c * A + a] : d[a * C + c]);
    const hasObj = !tr, first = hasObj ? 5 : 4;
    for (let a = 0; a < A; a++) {
      let best = 0, cls = -1;
      for (let c = first; c < C; c++) { const v = at(a, c); if (v > best) { best = v; cls = c - first; } }
      const score = hasObj ? best * at(a, 4) : best;
      if (score < conf) continue;
      const cx = at(a, 0), cy = at(a, 1), w = at(a, 2), h = at(a, 3);
      dets.push({ box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], score, cls });
    }
    dets = nms(dets, iouThr);
  }
  return dets.map(x => ({ type: 'box', cls: x.cls, name: names[x.cls] ?? `class_${x.cls}`, score: x.score, box: toImgBox(x.box) }))
    .filter(x => x.box[2] - x.box[0] > 1 && x.box[3] - x.box[1] > 1);
}

function decodeSemantic(o, g, m, cfg, names) {
  const d = o.data, dims = o.dims;
  let C, H, W, at;
  if (dims.length === 4) {
    const nhwc = dims[3] < dims[1] && dims[3] < dims[2];
    if (nhwc) { [, H, W, C] = dims; at = (c, i) => d[i * C + c]; }
    else { [, C, H, W] = dims; at = (c, i) => d[c * H * W + i]; }
  } else if (dims.length === 3) { [, H, W] = dims; C = 0; }
  else { [H, W] = dims.slice(-2); C = 0; }
  const N = H * W;
  const cls = new Int32Array(N);
  if (C === 0) for (let i = 0; i < N; i++) cls[i] = Math.round(d[i]);
  else if (C === 1) {
    const sig = needsSigmoid(d);
    for (let i = 0; i < N; i++) cls[i] = (sig ? sigmoid(d[i]) : d[i]) > cfg.maskThr ? 1 : -1;
  } else {
    for (let i = 0; i < N; i++) {
      let best = -Infinity, bi = 0;
      for (let c = 0; c < C; c++) { const v = at(c, i); if (v > best) { best = v; bi = c; } }
      cls[i] = bi;
    }
  }
  const present = new Set(cls);
  const items = [];
  for (const c of present) {
    if (c < 0 || c === cfg.bg) continue;
    const prob = new Float32Array(N);
    for (let i = 0; i < N; i++) prob[i] = cls[i] === c ? 1 : 0;
    const mask = probToMask(prob, W, H, 0.5, g, m);
    // single-channel (binary) models: foreground takes the first class name
    const ci = C === 1 ? 0 : c;
    if (mask) items.push({ type: 'mask', cls: ci, name: names[ci] ?? `class_${ci}`, score: 1, mask });
  }
  return items;
}

function decodeInstance(outs, g, m, cfg, conf, names) {
  const big = outs.filter(o => o.dims.length >= 3).sort((a, b) => numel(b.dims) - numel(a.dims));
  const mo = big[0];
  const md = mo.dims;
  let N;
  if (md.length === 4) N = md[0] === 1 && md[1] > 1 ? md[1] : md[0];
  else N = md[0] === 1 && md.length === 3 && outs.some(o => numel(o.dims) === md[1]) ? md[1] : md[0];
  const h = md[md.length - 2], w = md[md.length - 1];
  const vec = outs.filter(o => o !== mo && numel(o.dims) === N);
  const integral = o => /int/.test(o.type) || o.data.every(v => Number.isInteger(v));
  let labels = vec.find(o => /int/.test(o.type)) || vec.find(integral);
  let scores = vec.find(o => o !== labels && !integral(o)) || vec.find(o => o !== labels);
  if (!labels && vec.length === 2) labels = vec.find(o => o !== scores);
  const sig = needsSigmoid(mo.data.subarray(0, Math.min(mo.data.length, h * w * 4)));
  const items = [];
  for (let i = 0; i < N; i++) {
    const score = scores ? scores.data[i] : 1;
    if (score < conf) continue;
    const prob = mo.data.subarray(i * h * w, (i + 1) * h * w);
    const p = sig ? Float32Array.from(prob, sigmoid) : prob;
    const mask = probToMask(p, w, h, cfg.maskThr, g, m);
    const c = labels ? Math.round(labels.data[i]) : 0;
    if (mask) items.push({ type: 'mask', cls: c, name: names[c] ?? `class_${c}`, score, mask });
  }
  return items;
}

function decodeQueries(outs, g, m, cfg, conf, names) {
  const mo = outs.find(o => o.dims.length === 4);
  const Q = mo.dims[1], h = mo.dims[2], w = mo.dims[3];
  const lo = outs.find(o => o.dims.length === 3 && o.dims[1] === Q);
  const K = lo.dims[2];
  const sig = needsSigmoid(mo.data.subarray(0, Math.min(mo.data.length, h * w * 4)));
  const items = [];
  for (let q = 0; q < Q; q++) {
    const row = lo.data.subarray(q * K, (q + 1) * K);
    const mx = Math.max(...row);
    const ex = Array.from(row, v => Math.exp(v - mx));
    const sum = ex.reduce((a, b) => a + b, 0);
    let best = -1, bi = 0;
    for (let k = 0; k < K - 1; k++) if (ex[k] / sum > best) { best = ex[k] / sum; bi = k; } // last = "no object"
    if (best < conf) continue;
    const prob = mo.data.subarray(q * h * w, (q + 1) * h * w);
    const mask = probToMask(sig ? Float32Array.from(prob, sigmoid) : prob, w, h, cfg.maskThr, g, m);
    if (mask) items.push({ type: 'mask', cls: bi, name: names[bi] ?? `class_${bi}`, score: best, mask });
  }
  return items;
}

function decodeYoloSeg(outs, g, m, cfg, conf, iouThr, names) {
  const po = outs.find(o => o.dims.length === 4);
  const [, M, mh, mw] = po.dims;
  const det = outs.find(o => o.dims.length === 3);
  const d = det.data, dims = det.dims;
  let dets = [];
  if (dims[2] === 6 + M) {
    for (let i = 0; i < dims[1]; i++) {
      const k = i * dims[2];
      if (d[k + 4] < conf) continue;
      dets.push({ box: [d[k], d[k + 1], d[k + 2], d[k + 3]], score: d[k + 4], cls: Math.round(d[k + 5]), coef: d.slice(k + 6, k + 6 + M) });
    }
  } else {
    const Cc = dims[1], A = dims[2], nc = Cc - 4 - M;
    const at = (a, c) => d[c * A + a];
    for (let a = 0; a < A; a++) {
      let best = 0, cls = -1;
      for (let c = 0; c < nc; c++) { const v = at(a, 4 + c); if (v > best) { best = v; cls = c; } }
      if (best < conf) continue;
      const cx = at(a, 0), cy = at(a, 1), w = at(a, 2), h = at(a, 3);
      const coef = new Float32Array(M);
      for (let k = 0; k < M; k++) coef[k] = at(a, 4 + nc + k);
      dets.push({ box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], score: best, cls, coef });
    }
    dets = nms(dets, iouThr, 100);
  }
  const P = po.data, S2 = mh * mw;
  const sx = mw / g.iw, sy = mh / g.ih;
  const items = [];
  for (const t of dets) {
    const prob = new Float32Array(S2);
    const bx0 = Math.max(0, Math.floor(t.box[0] * sx)), by0 = Math.max(0, Math.floor(t.box[1] * sy));
    const bx1 = Math.min(mw, Math.ceil(t.box[2] * sx)), by1 = Math.min(mh, Math.ceil(t.box[3] * sy));
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
      const i = y * mw + x;
      let s = 0;
      for (let k = 0; k < M; k++) s += t.coef[k] * P[k * S2 + i];
      prob[i] = sigmoid(s);
    }
    const mask = probToMask(prob, mw, mh, cfg.maskThr, g, m);
    if (mask) items.push({ type: 'mask', cls: t.cls, name: names[t.cls] ?? `class_${t.cls}`, score: t.score, mask });
  }
  return items;
}

// public: run on one frame
export async function infer(m, frame, { conf = 0.35, iou: iouThr = 0.45 } = {}) {
  const cfg = model.cfg || defaultConfig();
  const names = cfg.names ? cfg.names.split(',').map(s => s.trim()) : model.names;
  const pre = await preprocess(m, frame, cfg);
  const res = await call({ cmd: 'run', data: pre.data, dims: pre.dims, type: pre.type }, [pre.data.buffer]);
  const outs = res.outputs;
  const kind = cfg.output === 'auto' ? detectKind(outs) : cfg.output;
  let items;
  if (kind === 'boxes') items = decodeBoxes(outs[0], pre.g, m, conf, iouThr, names);
  else if (kind === 'semantic') items = decodeSemantic(outs.find(o => o.dims.length >= 3) || outs[0], pre.g, m, cfg, names);
  else if (kind === 'instance') items = decodeInstance(outs, pre.g, m, cfg, conf, names);
  else if (kind === 'queries') items = decodeQueries(outs, pre.g, m, cfg, conf, names);
  else if (kind === 'yoloseg') items = decodeYoloSeg(outs, pre.g, m, cfg, conf, iouThr, names);
  else throw new Error('Unknown output kind ' + kind);
  return { kind, items, ms: res.ms, backend: res.backend };
}
