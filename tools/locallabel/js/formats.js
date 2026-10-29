// Import/export codecs: LocalLabel JSON, CVAT XML 1.1, COCO, YOLO (detect/OBB/seg), Pascal VOC.
import { S, objectsAt, uid, ensureLabel, labelById, upsertKeyframe, defaultAttributes } from './store.js';
import { ensureDims, frameCanvas, getFile, stem, basename } from './media.js';
import { rectCorners, boxParams } from './canvas.js';
import { toCocoRLE, fromCocoRLE, maskArea, maskToPolygons, polygonToMask } from './mask.js';

const pad6 = n => String(n).padStart(6, '0');
const r2 = v => Math.round(v * 100) / 100;
const fx = v => (Math.round(v * 1e6) / 1e6).toString();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

export const FORMATS = {
  json: { name: 'LocalLabel JSON', ext: '.json', import: true, export: true },
  cvat: { name: 'CVAT for images/video 1.1 (XML)', ext: '.xml', import: true, export: true },
  coco: { name: 'COCO 1.0 (instances JSON)', ext: '.json', import: true, export: true },
  yolo: { name: 'YOLO detection (txt)', ext: '.zip', import: true, export: true },
  yolo_obb: { name: 'YOLO OBB (rotated boxes)', ext: '.zip', import: true, export: true },
  yolo_seg: { name: 'YOLO segmentation', ext: '.zip', import: true, export: true },
  voc: { name: 'Pascal VOC 1.1 (XML)', ext: '.zip', import: true, export: true },
};

// shared helpers
function annotatedFrames(m) {
  if (m.kind === 'image') return [0];
  const a = S.project.annotations[m.id];
  if (!a) return [];
  const frames = new Set(a.shapes.map(s => s.frame || 0));
  for (const t of a.tracks) {
    for (let f = 0; f < (m.frames || 1); f++) if (objectsAt(m.id, f).some(o => o.id === t.id)) frames.add(f);
  }
  return [...frames].sort((x, y) => x - y);
}

function frameFile(m, f, ext = null) {
  if (m.kind === 'image') return ext ? m.id.replace(/\.[^.]+$/, ext) : m.id;
  return `${dirOf(m.id)}${stem(m.id)}_${pad6(f)}${ext || '.jpg'}`;
}

function ellipsePoly(o, n = 36) {
  const { cx, cy, w, h, rot } = boxParams(o);
  const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const lx = Math.cos(t) * w / 2, ly = Math.sin(t) * h / 2;
    out.push(cx + lx * c - ly * s, cy + lx * s + ly * c);
  }
  return out;
}
function bboxOf(pts) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x1 = Math.min(x1, pts[i]); x2 = Math.max(x2, pts[i]);
    y1 = Math.min(y1, pts[i + 1]); y2 = Math.max(y2, pts[i + 1]);
  }
  return [x1, y1, x2, y2];
}
function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) a += (pts[j] + pts[i]) * (pts[j + 1] - pts[i + 1]);
  return Math.abs(a / 2);
}
function aabb(o) {
  if (o.type === 'rectangle') return bboxOf(rectCorners(o).flat());
  if (o.type === 'ellipse') return bboxOf(ellipsePoly(o));
  if (o.type === 'mask') return [o.mask.left, o.mask.top, o.mask.left + o.mask.width, o.mask.top + o.mask.height];
  return bboxOf(o.points);
}
function asPolygons(o) {
  if (o.type === 'polygon') return [o.points];
  if (o.type === 'rectangle') return [rectCorners(o).flat()];
  if (o.type === 'ellipse') return [ellipsePoly(o)];
  if (o.type === 'mask') return maskToPolygons(o.mask);
  return [];
}

async function frameImageFiles(m, frames, prefix) {
  const files = [];
  if (m.kind === 'image') {
    const f = await getFile(m.id);
    files.push({ name: prefix + m.id, data: new Uint8Array(await f.arrayBuffer()) });
  } else {
    for (const f of frames) {
      const c = await frameCanvas(m, f);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
      files.push({ name: prefix + frameFile(m, f), data: new Uint8Array(await blob.arrayBuffer()) });
    }
  }
  return files;
}

// Map an annotation file name to {m, frame}
function makeResolver() {
  const byPath = new Map(), byBase = new Map(), byStem = new Map(), videoByStem = new Map();
  for (const m of S.project.media) {
    byPath.set(m.id.toLowerCase(), m);
    byBase.set(basename(m.id).toLowerCase(), m);
    const st = stem(m.id).toLowerCase();
    byStem.set(st, m);
    if (m.kind === 'video') videoByStem.set(st, m);
  }
  return (name) => {
    if (!name) return null;
    let n = String(name).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    for (const pre of ['images/', 'obj_train_data/', 'jpegimages/', 'labels/']) if (n.startsWith(pre)) n = n.slice(pre.length);
    let m = byPath.get(n) || byBase.get(basename(n));
    if (m && m.kind === 'image') return { m, frame: 0 };
    const st = stem(n);
    const vf = st.match(/^(.*?)[_-](?:frame_?)?(\d+)$/);
    if (vf && videoByStem.has(vf[1])) return { m: videoByStem.get(vf[1]), frame: parseInt(vf[2], 10) };
    m = byStem.get(st);
    if (m && m.kind === 'image') return { m, frame: 0 };
    return null;
  };
}

function pushShape(mediaId, shape) {
  const a = S.project.annotations[mediaId] || (S.project.annotations[mediaId] = { shapes: [], tracks: [] });
  const z = shape.z ?? (a.shapes.length + a.tracks.length);
  a.shapes.push({
    id: uid(), rotation: 0, occluded: false, source: 'manual', frame: 0, z,
    ...shape, attributes: { ...defaultAttributes(shape.label), ...(shape.attributes || {}) },
  });
}

function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Invalid XML: ' + err.textContent.slice(0, 120));
  return doc;
}
const num = (el, a, d = 0) => { const v = parseFloat(el.getAttribute(a)); return Number.isFinite(v) ? v : d; };
const parsePts = s => (s || '').split(';').filter(Boolean).flatMap(p => p.split(',').map(Number));
const fmtPts = pts => { const o = []; for (let i = 0; i < pts.length; i += 2) o.push(`${r2(pts[i])},${r2(pts[i + 1])}`); return o.join(';'); };

function counter() {
  const c = {};
  return { add: k => { c[k] = (c[k] || 0) + 1; }, list: () => Object.entries(c).map(([k, v]) => `${v} ${k}`) };
}

// LocalLabel JSON
export function exportJSON() {
  const p = { ...S.project, exported: new Date().toISOString() };
  return { files: [{ name: `${S.project.name || 'project'}.locallabel.json`, data: JSON.stringify(p, null, 1) }], warnings: [] };
}

export function importJSON(text) {
  const j = JSON.parse(text);
  if (j.format !== 'locallabel') throw new Error('Not a LocalLabel project file.');
  const labelMap = new Map();
  for (const l of j.labels || []) {
    const ex = ensureLabel(l.name);
    if (!ex.attributes.length && l.attributes?.length) ex.attributes = l.attributes;
    if (!ex.skeleton && l.skeleton) ex.skeleton = l.skeleton;
    if (l.color) ex.color = l.color;
    labelMap.set(l.id, ex.id);
  }
  const resolve = makeResolver();
  let n = 0, missing = 0;
  for (const [mid, a] of Object.entries(j.annotations || {})) {
    const target = S.project.media.find(m => m.id === mid) || resolve(mid)?.m;
    if (!target) { missing++; continue; }
    const srcMedia = (j.media || []).find(m => m.id === mid);
    if (srcMedia?.fps && !target.fps) target.fps = srcMedia.fps;
    const dst = S.project.annotations[target.id] || (S.project.annotations[target.id] = { shapes: [], tracks: [] });
    for (const s of a.shapes || []) { dst.shapes.push({ ...s, id: uid(), label: labelMap.get(s.label) || s.label }); n++; }
    for (const t of a.tracks || []) { dst.tracks.push({ ...t, id: uid(), label: labelMap.get(t.label) || t.label }); n++; }
  }
  return { count: n, warnings: missing ? [`${missing} media item(s) in the file are not in this folder`] : [] };
}

// COCO
export async function exportCOCO({ includeImages } = {}) {
  const warn = counter();
  const catId = new Map();
  const categories = S.project.labels.map((l, i) => {
    catId.set(l.id, i + 1);
    const c = { id: i + 1, name: l.name, supercategory: '' };
    if (l.skeleton) { c.keypoints = l.skeleton.nodes; c.skeleton = l.skeleton.edges.map(([a, b]) => [a + 1, b + 1]); }
    return c;
  });
  const images = [], annotations = [], files = [];
  let imgId = 0, annId = 0;
  for (const m of S.project.media) {
    await ensureDims(m);
    const frames = annotatedFrames(m);
    const list = m.kind === 'image' ? [0] : frames;
    for (const f of list) {
      const id = ++imgId;
      images.push({ id, file_name: frameFile(m, f), width: m.width, height: m.height, license: 0, flickr_url: '', coco_url: '', date_captured: 0 });
      for (const o of objectsAt(m.id, f)) {
        const base = {
          id: ++annId, image_id: id, category_id: catId.get(o.label), iscrowd: 0,
          attributes: { occluded: o.occluded, ...o.attributes, ...(o.rotation ? { rotation: o.rotation } : {}), ...(o.kind === 'track' ? { track_id: o.id, keyframe: !!o.keyframe } : {}) },
        };
        const [x1, y1, x2, y2] = aabb(o);
        const bbox = [r2(x1), r2(y1), r2(x2 - x1), r2(y2 - y1)];
        if (o.type === 'rectangle') {
          annotations.push({ ...base, segmentation: o.rotation ? [rectCorners(o).flat().map(r2)] : [], area: r2(boxParams(o).w * boxParams(o).h), bbox });
        } else if (o.type === 'ellipse' || o.type === 'polygon') {
          const poly = o.type === 'polygon' ? o.points : ellipsePoly(o);
          annotations.push({ ...base, segmentation: [poly.map(r2)], area: r2(polyArea(poly)), bbox });
        } else if (o.type === 'mask') {
          annotations.push({ ...base, segmentation: toCocoRLE(o.mask, m.width, m.height), area: maskArea(o.mask), bbox });
        } else if (o.type === 'skeleton') {
          const kp = [];
          for (let i = 0; i < o.points.length; i += 2) kp.push(r2(o.points[i]), r2(o.points[i + 1]), 2);
          annotations.push({ ...base, segmentation: [], area: r2(bbox[2] * bbox[3]), bbox, keypoints: kp, num_keypoints: kp.length / 3 });
        } else warn.add(`${o.type} objects skipped (COCO has no ${o.type} type)`);
      }
    }
    if (includeImages) files.push(...await frameImageFiles(m, frames, 'images/'));
  }
  const coco = {
    licenses: [{ name: '', id: 0, url: '' }],
    info: { contributor: '', date_created: new Date().toISOString(), description: S.project.name, url: '', version: '1.0', year: String(new Date().getFullYear()) },
    categories, images, annotations,
  };
  const json = JSON.stringify(coco);
  if (includeImages) files.unshift({ name: 'annotations/instances_default.json', data: json });
  else files.push({ name: 'instances_default.json', data: json });
  return { files, warnings: warn.list() };
}

export async function importCOCO(text) {
  const j = JSON.parse(text);
  if (!Array.isArray(j.images) || !Array.isArray(j.annotations)) throw new Error('Not a COCO instances file.');
  const cat = new Map();
  for (const c of j.categories || []) {
    const l = ensureLabel(c.name);
    if (c.keypoints?.length && !l.skeleton) l.skeleton = { nodes: c.keypoints, edges: (c.skeleton || []).map(([a, b]) => [a - 1, b - 1]) };
    cat.set(c.id, l);
  }
  const resolve = makeResolver();
  const img = new Map();
  let unmatched = 0;
  for (const im of j.images) {
    const t = resolve(im.file_name);
    if (t) img.set(im.id, { ...t, w: im.width, h: im.height }); else unmatched++;
  }
  let n = 0;
  for (const a of j.annotations) {
    const t = img.get(a.image_id), l = cat.get(a.category_id);
    if (!t || !l) continue;
    const attrs = { ...(a.attributes || {}) };
    const occluded = !!attrs.occluded; delete attrs.occluded;
    const rotation = +attrs.rotation || 0; delete attrs.rotation; delete attrs.track_id; delete attrs.keyframe;
    const common = { label: l.id, frame: t.frame, occluded, attributes: attrs };
    const seg = a.segmentation;
    if (a.keypoints?.length && l.skeleton) {
      const pts = [];
      for (let i = 0; i < a.keypoints.length; i += 3) pts.push(a.keypoints[i], a.keypoints[i + 1]);
      pushShape(t.m.id, { ...common, type: 'skeleton', points: pts });
    } else if (seg && !Array.isArray(seg) && seg.counts) {
      const [H, W] = seg.size || [t.h, t.w];
      const mask = fromCocoRLE(seg.counts, H, W);
      if (mask) pushShape(t.m.id, { ...common, type: 'mask', mask, points: [mask.left, mask.top, mask.left + mask.width, mask.top + mask.height] });
    } else if (Array.isArray(seg) && seg.length && rotation && seg[0].length === 8) {
      const [x, y, w, h] = a.bbox;
      const p = seg[0];
      const rw = Math.hypot(p[2] - p[0], p[3] - p[1]), rh = Math.hypot(p[4] - p[2], p[5] - p[3]);
      const cx = x + w / 2, cy = y + h / 2;
      pushShape(t.m.id, { ...common, type: 'rectangle', rotation, points: [cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2] });
    } else if (Array.isArray(seg) && seg.some(s => s.length >= 6)) {
      for (const poly of seg) if (poly.length >= 6) pushShape(t.m.id, { ...common, type: 'polygon', points: poly });
    } else if (a.bbox) {
      const [x, y, w, h] = a.bbox;
      pushShape(t.m.id, { ...common, type: 'rectangle', points: [x, y, x + w, y + h] });
    } else continue;
    n++;
  }
  return { count: n, warnings: unmatched ? [`${unmatched} image(s) in the file did not match any file in this folder`] : [] };
}

// YOLO (detect / obb / seg)
export async function exportYOLO({ variant = 'detect', includeImages } = {}) {
  const warn = counter();
  const idx = new Map(S.project.labels.map((l, i) => [l.id, i]));
  const files = [];
  const names = S.project.labels.map((l, i) => `  ${i}: ${l.name}`).join('\n');
  files.push({ name: 'data.yaml', data: `# Exported by LocalLabel\npath: .\ntrain: images\nval: images\nnames:\n${names}\n` });
  files.push({ name: 'classes.txt', data: S.project.labels.map(l => l.name).join('\n') + '\n' });
  for (const m of S.project.media) {
    await ensureDims(m);
    const W = m.width, H = m.height;
    const frames = annotatedFrames(m);
    for (const f of m.kind === 'image' ? [0] : frames) {
      const lines = [];
      for (const o of objectsAt(m.id, f)) {
        const c = idx.get(o.label);
        if (variant === 'detect') {
          if (o.type !== 'rectangle') { warn.add(`${o.type} objects skipped (detection format holds boxes only)`); continue; }
          const [x1, y1, x2, y2] = aabb(o);
          lines.push(`${c} ${fx((x1 + x2) / 2 / W)} ${fx((y1 + y2) / 2 / H)} ${fx((x2 - x1) / W)} ${fx((y2 - y1) / H)}`);
        } else if (variant === 'obb') {
          if (o.type !== 'rectangle') { warn.add(`${o.type} objects skipped (OBB format holds rotated boxes only)`); continue; }
          lines.push(`${c} ` + rectCorners(o).map(([x, y]) => `${fx(x / W)} ${fx(y / H)}`).join(' '));
        } else {
          const polys = asPolygons(o);
          if (!polys.length) { warn.add(`${o.type} objects skipped (segmentation format holds areas only)`); continue; }
          for (const p of polys) {
            const xy = [];
            for (let i = 0; i < p.length; i += 2) xy.push(fx(p[i] / W), fx(p[i + 1] / H));
            lines.push(`${c} ${xy.join(' ')}`);
          }
        }
      }
      files.push({ name: 'labels/' + frameFile(m, f, '.txt'), data: lines.join('\n') + (lines.length ? '\n' : '') });
    }
    if (includeImages) files.push(...await frameImageFiles(m, frames, 'images/'));
  }
  return { files, warnings: warn.list(), zip: true };
}

function parseNames(text) {
  const names = [];
  const lines = text.split(/\r?\n/);
  const inline = text.match(/names\s*:\s*\[([^\]]*)\]/);
  if (inline) return inline[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  let inNames = false;
  for (const ln of lines) {
    if (/^names\s*:/.test(ln)) { inNames = true; continue; }
    if (inNames) {
      let mm = ln.match(/^\s+(\d+)\s*:\s*(.+)$/);
      if (mm) { names[+mm[1]] = mm[2].trim().replace(/^['"]|['"]$/g, ''); continue; }
      mm = ln.match(/^\s*-\s*(.+)$/);
      if (mm) { names.push(mm[1].trim().replace(/^['"]|['"]$/g, '')); continue; }
      if (ln.trim() && !/^\s/.test(ln)) inNames = false;
    }
  }
  return names;
}

// files: [{name, text}]
export async function importYOLO(files) {
  let names = [];
  const yaml = files.find(f => /\.ya?ml$/i.test(f.name));
  const plain = files.find(f => /(^|\/)(classes\.txt|obj\.names|.*\.names)$/i.test(f.name));
  if (yaml) names = parseNames(yaml.text);
  else if (plain) names = plain.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const resolve = makeResolver();
  let n = 0, unmatched = 0;
  for (const f of files) {
    if (!/\.txt$/i.test(f.name) || f === plain || /(^|\/)(train|val|test)\.txt$/i.test(f.name)) continue;
    const t = resolve(f.name.replace(/\.txt$/i, '.jpg')) || resolve(f.name);
    if (!t) { if (f.text.trim()) unmatched++; continue; }
    await ensureDims(t.m);
    const W = t.m.width, H = t.m.height;
    for (const line of f.text.split(/\r?\n/)) {
      const v = line.trim().split(/\s+/).map(Number);
      if (v.length < 5 || v.some(x => !Number.isFinite(x))) continue;
      const cls = v[0];
      const label = ensureLabel(names[cls] ?? `class_${cls}`);
      const vals = v.slice(1);
      if (vals.length === 4 || vals.length === 5) {
        const [cx, cy, w, h] = vals;
        pushShape(t.m.id, { label: label.id, frame: t.frame, type: 'rectangle', points: [(cx - w / 2) * W, (cy - h / 2) * H, (cx + w / 2) * W, (cy + h / 2) * H] });
      } else if (vals.length === 8) {
        const pts = vals.map((x, i) => (i % 2 ? x * H : x * W));
        const ccx = (pts[0] + pts[4]) / 2, ccy = (pts[1] + pts[5]) / 2;
        const w = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]), h = Math.hypot(pts[4] - pts[2], pts[5] - pts[3]);
        const rot = (Math.atan2(pts[3] - pts[1], pts[2] - pts[0]) * 180 / Math.PI + 360) % 360;
        pushShape(t.m.id, { label: label.id, frame: t.frame, type: 'rectangle', rotation: rot, points: [ccx - w / 2, ccy - h / 2, ccx + w / 2, ccy + h / 2] });
      } else if (vals.length >= 6 && vals.length % 2 === 0) {
        pushShape(t.m.id, { label: label.id, frame: t.frame, type: 'polygon', points: vals.map((x, i) => (i % 2 ? x * H : x * W)) });
      } else continue;
      n++;
    }
  }
  return { count: n, warnings: unmatched ? [`${unmatched} label file(s) did not match any file in this folder`] : [] };
}

// Pascal VOC
export async function exportVOC({ includeImages } = {}) {
  const warn = counter();
  const files = [], ids = [];
  for (const m of S.project.media) {
    await ensureDims(m);
    const frames = annotatedFrames(m);
    for (const f of m.kind === 'image' ? [0] : frames) {
      const name = frameFile(m, f);
      const objs = [];
      for (const o of objectsAt(m.id, f)) {
        if (o.type !== 'rectangle') { warn.add(`${o.type} objects skipped (VOC holds boxes only)`); continue; }
        const [x1, y1, x2, y2] = aabb(o);
        const attrs = Object.entries(o.attributes || {}).map(([k, v]) => `<attribute><name>${esc(k)}</name><value>${esc(v)}</value></attribute>`).join('');
        objs.push(`  <object>\n    <name>${esc(labelById(o.label)?.name)}</name>\n    <pose>Unspecified</pose>\n    <truncated>0</truncated>\n    <difficult>0</difficult>\n    <occluded>${o.occluded ? 1 : 0}</occluded>\n    <bndbox><xmin>${r2(x1)}</xmin><ymin>${r2(y1)}</ymin><xmax>${r2(x2)}</xmax><ymax>${r2(y2)}</ymax></bndbox>\n${attrs ? `    <attributes>${attrs}</attributes>\n` : ''}  </object>`);
      }
      const xml = `<?xml version="1.0" encoding="utf-8"?>\n<annotation>\n  <folder></folder>\n  <filename>${esc(basename(name))}</filename>\n  <path>${esc(name)}</path>\n  <source><database>Unknown</database></source>\n  <size><width>${m.width}</width><height>${m.height}</height><depth>3</depth></size>\n  <segmented>0</segmented>\n${objs.join('\n')}\n</annotation>\n`;
      const id = name.replace(/\.[^.]+$/, '');
      ids.push(id);
      files.push({ name: `Annotations/${id}.xml`, data: xml });
    }
    if (includeImages) files.push(...await frameImageFiles(m, frames, 'JPEGImages/'));
  }
  files.push({ name: 'ImageSets/Main/default.txt', data: ids.join('\n') + '\n' });
  files.push({ name: 'labelmap.txt', data: '# label:color_rgb:parts:actions\n' + S.project.labels.map(l => {
    const n = parseInt(l.color.slice(1), 16);
    return `${l.name}:${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}::`;
  }).join('\n') + '\n' });
  return { files, warnings: warn.list(), zip: true };
}

export async function importVOC(files) {
  const resolve = makeResolver();
  let n = 0, unmatched = 0;
  for (const f of files) {
    if (!/\.xml$/i.test(f.name)) continue;
    const doc = parseXML(f.text);
    const root = doc.querySelector('annotation');
    if (!root) continue;
    const fname = root.querySelector(':scope > path')?.textContent || root.querySelector(':scope > filename')?.textContent || f.name.replace(/\.xml$/i, '.jpg');
    const t = resolve(fname) || resolve(root.querySelector(':scope > filename')?.textContent) || resolve(f.name.replace(/^Annotations\//, '').replace(/\.xml$/i, '.jpg'));
    if (!t) { unmatched++; continue; }
    for (const ob of root.querySelectorAll(':scope > object')) {
      const label = ensureLabel(ob.querySelector('name')?.textContent?.trim() || 'object');
      const bb = ob.querySelector('bndbox');
      if (!bb) continue;
      const g = k => parseFloat(bb.querySelector(k)?.textContent);
      const attributes = {};
      for (const at of ob.querySelectorAll('attributes > attribute')) {
        attributes[at.querySelector('name')?.textContent] = at.querySelector('value')?.textContent;
      }
      pushShape(t.m.id, {
        label: label.id, frame: t.frame, type: 'rectangle', occluded: ob.querySelector('occluded')?.textContent === '1',
        points: [g('xmin'), g('ymin'), g('xmax'), g('ymax')], attributes,
      });
      n++;
    }
  }
  return { count: n, warnings: unmatched ? [`${unmatched} XML file(s) did not match any file in this folder`] : [] };
}

// CVAT XML 1.1
function cvatMeta(name, size, source) {
  const labels = S.project.labels.map(l => {
    const attrs = (l.attributes || []).map(a => `<attribute><name>${esc(a.name)}</name><mutable>False</mutable><input_type>${a.type === 'select' ? 'select' : a.type}</input_type><default_value>${esc(a.default ?? '')}</default_value><values>${esc((a.values || []).join('\n'))}</values></attribute>`).join('');
    let svg = '', type = 'any';
    if (l.skeleton) {
      type = 'skeleton';
      const n = l.skeleton.nodes.length;
      const pos = l.skeleton.nodes.map((_, i) => [50 + 35 * Math.cos(i / n * 2 * Math.PI), 50 + 35 * Math.sin(i / n * 2 * Math.PI)]);
      svg = '<svg>' + esc(l.skeleton.edges.map(([a, b]) => `<line x1="${r2(pos[a][0])}" y1="${r2(pos[a][1])}" x2="${r2(pos[b][0])}" y2="${r2(pos[b][1])}" data-type="edge" data-node-from="${a + 1}" data-node-to="${b + 1}"></line>`).join('') +
        l.skeleton.nodes.map((nm, i) => `<circle r="1.5" cx="${r2(pos[i][0])}" cy="${r2(pos[i][1])}" data-type="element node" data-element-id="${i + 1}" data-node-id="${i + 1}" data-label-name="${nm}"></circle>`).join('')) + '</svg>';
    }
    const main = `<label><name>${esc(l.name)}</name><color>${l.color}</color><type>${type}</type>${svg}<attributes>${attrs}</attributes></label>`;
    const subs = l.skeleton ? l.skeleton.nodes.map(nm => `<label><name>${esc(nm)}</name><color>${l.color}</color><type>points</type><attributes></attributes><parent>${esc(l.name)}</parent></label>`).join('') : '';
    return main + subs;
  }).join('\n');
  return `<meta>\n<task><name>${esc(name)}</name><size>${size}</size><mode>${source ? 'interpolation' : 'annotation'}</mode><overlap>0</overlap><flipped>False</flipped>${source ? `<source>${esc(source)}</source>` : ''}\n<labels>\n${labels}\n</labels>\n</task>\n<dumped>${new Date().toISOString()}</dumped>\n</meta>`;
}

function attrXml(o) {
  return Object.entries(o.attributes || {}).map(([k, v]) => `<attribute name="${esc(k)}">${esc(v)}</attribute>`).join('');
}

// Geometry element; extra = frame-level attributes for tracks
function cvatShape(o, extra = '') {
  const lab = labelById(o.label);
  const common = `${extra}occluded="${o.occluded ? 1 : 0}" z_order="${o.z || 0}"`;
  const lbl = extra ? '' : `label="${esc(lab?.name)}" source="${o.source || 'manual'}" `;
  const at = extra ? '' : attrXml(o);
  switch (o.type) {
    case 'rectangle': {
      const { cx, cy, w, h } = boxParams(o);
      return `<box ${lbl}${common} xtl="${r2(cx - w / 2)}" ytl="${r2(cy - h / 2)}" xbr="${r2(cx + w / 2)}" ybr="${r2(cy + h / 2)}"${o.rotation ? ` rotation="${r2(o.rotation)}"` : ''}>${at}</box>`;
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = o.points;
      return `<ellipse ${lbl}${common} cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}"${o.rotation ? ` rotation="${r2(o.rotation)}"` : ''}>${at}</ellipse>`;
    }
    case 'polygon': case 'polyline': case 'points':
      return `<${o.type} ${lbl}${common} points="${fmtPts(o.points)}">${at}</${o.type}>`;
    case 'mask': {
      const k = o.mask;
      return `<mask ${lbl}${common} rle="${k.rle.join(', ')}" left="${k.left}" top="${k.top}" width="${k.width}" height="${k.height}">${at}</mask>`;
    }
    case 'skeleton': {
      const nodes = lab?.skeleton?.nodes || [];
      const kids = nodes.map((nm, i) => `<points label="${esc(nm)}" ${extra}occluded="0" outside="0" points="${r2(o.points[i * 2])},${r2(o.points[i * 2 + 1])}"></points>`).join('');
      return `<skeleton ${lbl}${extra}z_order="${o.z || 0}">${kids}${at}</skeleton>`;
    }
  }
  return '';
}

export async function exportCVAT() {
  const files = [];
  const images = S.project.media.filter(m => m.kind === 'image');
  const videos = S.project.media.filter(m => m.kind === 'video');
  if (images.length || !videos.length) {
    const parts = [];
    let id = 0;
    for (const m of images) {
      await ensureDims(m);
      const shapes = objectsAt(m.id, 0).map(o => cvatShape(o)).join('\n    ');
      parts.push(`  <image id="${id++}" name="${esc(m.id)}" width="${m.width}" height="${m.height}">\n    ${shapes}\n  </image>`);
    }
    files.push({ name: 'annotations.xml', data: `<?xml version="1.0" encoding="utf-8"?>\n<annotations>\n<version>1.1</version>\n${cvatMeta(S.project.name, images.length, null)}\n${parts.join('\n')}\n</annotations>\n` });
  }
  for (const m of videos) {
    await ensureDims(m);
    const a = S.project.annotations[m.id] || { shapes: [], tracks: [] };
    const tracks = [];
    let tid = 0;
    for (const t of a.tracks) {
      const lab = labelById(t.label);
      const els = t.keyframes.map(k => {
        const o = { ...t, points: k.points, rotation: k.rotation, occluded: k.occluded };
        return cvatShape(o, `frame="${k.frame}" keyframe="1" outside="${k.outside ? 1 : 0}" `);
      });
      tracks.push(`  <track id="${tid++}" label="${esc(lab?.name)}" source="${t.source || 'manual'}">\n    ${els.join('\n    ')}\n    ${attrXml(t)}\n  </track>`);
    }
    for (const s of a.shapes) {
      const lab = labelById(s.label);
      const o = { ...s };
      const f = s.frame || 0;
      const els = [cvatShape(o, `frame="${f}" keyframe="1" outside="0" `)];
      if (f + 1 < m.frames) els.push(cvatShape(o, `frame="${f + 1}" keyframe="1" outside="1" `));
      tracks.push(`  <track id="${tid++}" label="${esc(lab?.name)}" source="${s.source || 'manual'}">\n    ${els.join('\n    ')}\n    ${attrXml(s)}\n  </track>`);
    }
    files.push({ name: `${stem(m.id)}.xml`, data: `<?xml version="1.0" encoding="utf-8"?>\n<annotations>\n<version>1.1</version>\n${cvatMeta(stem(m.id), m.frames, m.id)}\n${tracks.join('\n')}\n</annotations>\n` });
  }
  return { files, warnings: videos.length && images.length ? ['Images and each video were written as separate CVAT XML files (CVAT uses one file per task)'] : [], zip: files.length > 1 };
}

function readCvatGeom(el, label) {
  const tag = el.tagName;
  const g = { occluded: el.getAttribute('occluded') === '1', z: num(el, 'z_order', 0), rotation: num(el, 'rotation', 0) };
  if (tag === 'box') return { ...g, type: 'rectangle', points: [num(el, 'xtl'), num(el, 'ytl'), num(el, 'xbr'), num(el, 'ybr')] };
  if (tag === 'ellipse') return { ...g, type: 'ellipse', points: [num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry')] };
  if (tag === 'polygon' || tag === 'polyline' || tag === 'points') return { ...g, type: tag, points: parsePts(el.getAttribute('points')) };
  if (tag === 'mask') {
    const mask = { left: num(el, 'left'), top: num(el, 'top'), width: num(el, 'width'), height: num(el, 'height'), rle: el.getAttribute('rle').split(',').map(s => parseInt(s, 10)) };
    return { ...g, type: 'mask', mask, points: [mask.left, mask.top, mask.left + mask.width, mask.top + mask.height] };
  }
  if (tag === 'skeleton') {
    const kids = [...el.querySelectorAll(':scope > points')];
    if (!label.skeleton) label.skeleton = { nodes: kids.map(k => k.getAttribute('label')), edges: [] };
    const pts = [];
    for (const nm of label.skeleton.nodes) {
      const k = kids.find(x => x.getAttribute('label') === nm);
      const p = k ? parsePts(k.getAttribute('points')) : [0, 0];
      pts.push(p[0] ?? 0, p[1] ?? 0);
    }
    return { ...g, type: 'skeleton', points: pts };
  }
  return null;
}
function readAttrs(el) {
  const out = {};
  for (const a of el.querySelectorAll(':scope > attribute')) out[a.getAttribute('name')] = a.textContent;
  return out;
}

export function importCVAT(text) {
  const doc = parseXML(text);
  // labels from meta (incl. skeleton structure)
  const metaLabels = [...doc.querySelectorAll('meta labels > label')];
  for (const ml of metaLabels) {
    if (ml.querySelector(':scope > parent')) continue;
    const name = ml.querySelector(':scope > name')?.textContent;
    if (!name) continue;
    const l = ensureLabel(name);
    const color = ml.querySelector(':scope > color')?.textContent;
    if (color && /^#[0-9a-f]{6}$/i.test(color)) l.color = color;
    if (!l.attributes.length) {
      l.attributes = [...ml.querySelectorAll(':scope > attributes > attribute')].map(a => {
        const type = a.querySelector('input_type')?.textContent || 'text';
        return {
          name: a.querySelector('name')?.textContent, type: ['select', 'radio'].includes(type) ? 'select' : type === 'checkbox' ? 'checkbox' : type === 'number' ? 'number' : 'text',
          values: (a.querySelector('values')?.textContent || '').split('\n').filter(Boolean), default: a.querySelector('default_value')?.textContent ?? '',
        };
      });
    }
    if (ml.querySelector(':scope > type')?.textContent === 'skeleton' && !l.skeleton) {
      const subs = metaLabels.filter(x => x.querySelector(':scope > parent')?.textContent === name).map(x => x.querySelector(':scope > name').textContent);
      const svgText = ml.querySelector(':scope > svg')?.textContent || '';
      const edges = [...svgText.matchAll(/data-node-from="(\d+)"\s+data-node-to="(\d+)"/g)].map(m => [+m[1] - 1, +m[2] - 1]);
      const order = [...svgText.matchAll(/data-node-id="(\d+)"[^>]*data-label-name="([^"]+)"/g)].sort((a, b) => a[1] - b[1]).map(m => m[2]);
      l.skeleton = { nodes: order.length ? order : subs, edges };
    }
  }
  const resolve = makeResolver();
  let n = 0, unmatched = 0;
  for (const im of doc.querySelectorAll('annotations > image')) {
    const t = resolve(im.getAttribute('name'));
    if (!t) { unmatched++; continue; }
    for (const el of im.children) {
      const label = ensureLabel(el.getAttribute('label'));
      const g = readCvatGeom(el, label);
      if (!g) continue;
      pushShape(t.m.id, { ...g, label: label.id, frame: t.frame, source: el.getAttribute('source') || 'manual', attributes: readAttrs(el) });
      n++;
    }
  }
  const trackEls = doc.querySelectorAll('annotations > track');
  if (trackEls.length) {
    const src = doc.querySelector('meta source')?.textContent;
    const videos = S.project.media.filter(m => m.kind === 'video');
    const target = (src && (S.project.media.find(m => m.id === src) || resolve(src)?.m)) ||
      (S.project.media.find(m => m.id === S.mediaId && m.kind === 'video')) || videos[0];
    if (!target) throw new Error('This CVAT file contains video tracks but no video is open in this project.');
    const a = S.project.annotations[target.id] || (S.project.annotations[target.id] = { shapes: [], tracks: [] });
    for (const tr of trackEls) {
      const label = ensureLabel(tr.getAttribute('label'));
      const els = [...tr.children].filter(e => e.tagName !== 'attribute');
      if (!els.length) continue;
      const hasKf = els.some(e => e.hasAttribute('keyframe'));
      const track = { id: uid(), type: null, label: label.id, z: 0, source: tr.getAttribute('source') || 'manual', attributes: { ...defaultAttributes(label.id), ...readAttrs(tr) }, keyframes: [] };
      for (const el of els) {
        if (hasKf && el.getAttribute('keyframe') === '0' && el.getAttribute('outside') !== '1') continue;
        const g = readCvatGeom(el, label);
        if (!g) continue;
        track.type = g.type; track.z = g.z;
        Object.assign(track.attributes, readAttrs(el));
        upsertKeyframe(track, { frame: num(el, 'frame'), points: g.points, rotation: g.rotation, occluded: g.occluded, outside: el.getAttribute('outside') === '1' });
        if (g.type === 'mask') track.mask = g.mask;
      }
      if (!track.type) continue;
      const vis = track.keyframes.filter(k => !k.outside);
      if (track.type === 'mask' || vis.length === 1) {
        for (const k of vis) pushShape(target.id, { type: track.type, label: label.id, frame: k.frame, points: k.points, rotation: k.rotation, occluded: k.occluded, mask: track.mask, attributes: track.attributes, source: track.source });
      } else a.tracks.push(track);
      n++;
    }
  }
  return { count: n, warnings: unmatched ? [`${unmatched} image(s) did not match any file in this folder`] : [] };
}

// Convert a polygon/ellipse/rectangle object to a mask (used by the "to mask" action)
export function objectToMask(o, W, H) {
  const polys = asPolygons(o);
  if (!polys.length) return null;
  return polygonToMask(polys[0], W, H);
}
