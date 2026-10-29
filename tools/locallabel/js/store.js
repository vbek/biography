// Project state, per-frame object views, track interpolation, undo/redo.
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

const listeners = new Map();
export function on(ev, fn) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(fn);
}
export function emit(ev, data) {
  for (const fn of listeners.get(ev) || []) fn(data);
}

export const PALETTE = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#22b8cf', '#f06595',
  '#94d82d', '#845ef7', '#20c997', '#fab005', '#5c7cfa', '#e64980', '#82c91e', '#15aabf'];

export const SHAPE_TYPES = ['rectangle', 'polygon', 'polyline', 'points', 'ellipse', 'skeleton', 'mask'];

export const S = {
  project: null,
  projectId: null,
  dirHandle: null,          // FileSystemDirectoryHandle when opened via the picker
  sources: new Map(),       // media path -> File | FileSystemFileHandle
  mediaId: null,
  frame: 0,
  selected: null,           // object id
  tool: 'select',
  activeLabel: null,
  trackMode: false,
  brushRadius: 12,
  showLabels: true,
  fillOpacity: 0.2,
  dirty: false,
};

export function newProject(name) {
  return { format: 'locallabel', version: 1, name, labels: [], media: [], annotations: {} };
}

export function media(id = S.mediaId) {
  return S.project?.media.find(m => m.id === id) || null;
}
export function labelById(id) {
  return S.project?.labels.find(l => l.id === id) || null;
}
export function labelByName(name) {
  const n = String(name).trim().toLowerCase();
  return S.project?.labels.find(l => l.name.toLowerCase() === n) || null;
}
export function ann(mediaId = S.mediaId) {
  const p = S.project;
  if (!p.annotations[mediaId]) p.annotations[mediaId] = { shapes: [], tracks: [] };
  return p.annotations[mediaId];
}

export function addLabel(name, color, extra = {}) {
  const used = new Set(S.project.labels.map(l => l.color));
  const c = color || PALETTE.find(x => !used.has(x)) || PALETTE[S.project.labels.length % PALETTE.length];
  const label = { id: uid(), name, color: c, attributes: [], skeleton: null, ...extra };
  S.project.labels.push(label);
  if (!S.activeLabel) S.activeLabel = label.id;
  changed('labels');
  return label;
}

export function ensureLabel(name, create = true) {
  return labelByName(name) || (create ? addLabel(String(name)) : null);
}

export function defaultAttributes(labelId) {
  const l = labelById(labelId);
  const out = {};
  for (const a of l?.attributes || []) out[a.name] = a.default ?? (a.type === 'checkbox' ? false : a.values?.[0] ?? '');
  return out;
}

// tracks
function lerpAngle(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

export function trackAt(track, frame) {
  const k = track.keyframes;
  let a = null, b = null;
  for (const kf of k) {
    if (kf.frame <= frame) a = kf;
    else { b = kf; break; }
  }
  if (!a || a.outside) return null;
  if (a.frame === frame) return { ...a, keyframe: true };
  if (b && !b.outside && b.points.length === a.points.length && track.type !== 'mask') {
    const t = (frame - a.frame) / (b.frame - a.frame);
    return {
      frame, outside: false, occluded: a.occluded, keyframe: false,
      points: a.points.map((v, i) => v + (b.points[i] - v) * t),
      rotation: lerpAngle(a.rotation || 0, b.rotation || 0, t),
    };
  }
  return { ...a, frame, keyframe: false };
}

export function upsertKeyframe(track, kf) {
  const i = track.keyframes.findIndex(k => k.frame === kf.frame);
  if (i >= 0) track.keyframes[i] = { ...track.keyframes[i], ...kf };
  else {
    track.keyframes.push(kf);
    track.keyframes.sort((a, b) => a.frame - b.frame);
  }
}

// per-frame view
export function objectsAt(mediaId = S.mediaId, frame = S.frame) {
  const a = S.project?.annotations[mediaId];
  if (!a) return [];
  const out = [];
  for (const s of a.shapes) {
    if ((s.frame || 0) !== frame) continue;
    out.push({
      id: s.id, kind: 'shape', type: s.type, label: s.label, points: s.points, rotation: s.rotation || 0,
      mask: s.mask, occluded: !!s.occluded, z: s.z || 0, attributes: s.attributes || {}, hidden: !!s.hidden,
      locked: !!s.locked, source: s.source || 'manual', ref: s,
    });
  }
  for (const t of a.tracks) {
    const st = trackAt(t, frame);
    if (!st) continue;
    out.push({
      id: t.id, kind: 'track', type: t.type, label: t.label, points: st.points, rotation: st.rotation || 0,
      occluded: !!st.occluded, z: t.z || 0, attributes: t.attributes || {}, hidden: !!t.hidden, locked: !!t.locked,
      keyframe: st.keyframe, source: t.source || 'manual', ref: t,
    });
  }
  out.sort((x, y) => x.z - y.z);
  return out;
}

export function findObject(id, frame = S.frame) {
  return objectsAt(S.mediaId, frame).find(o => o.id === id) || null;
}

export function maxZ() {
  const a = S.project.annotations[S.mediaId];
  if (!a) return 0;
  let z = 0;
  for (const s of a.shapes) z = Math.max(z, s.z || 0);
  for (const t of a.tracks) z = Math.max(z, t.z || 0);
  return z;
}

// mutations (all go through commit for undo)
const history = new Map(); // mediaId -> {undo:[], redo:[]}
function hist(m = S.mediaId) {
  if (!history.has(m)) history.set(m, { undo: [], redo: [] });
  return history.get(m);
}
export function clearHistory() { history.clear(); }

export function commit(fn, mediaId = S.mediaId) {
  const a = ann(mediaId);
  const before = JSON.stringify(a);
  const result = fn(a);
  const h = hist(mediaId);
  h.undo.push(before);
  if (h.undo.length > 200) h.undo.shift();
  h.redo = [];
  changed('annotations');
  return result;
}

export function undo() {
  const h = hist();
  if (!h.undo.length) return false;
  h.redo.push(JSON.stringify(ann()));
  S.project.annotations[S.mediaId] = JSON.parse(h.undo.pop());
  changed('annotations');
  return true;
}
export function redo() {
  const h = hist();
  if (!h.redo.length) return false;
  h.undo.push(JSON.stringify(ann()));
  S.project.annotations[S.mediaId] = JSON.parse(h.redo.pop());
  changed('annotations');
  return true;
}
export function canUndo() { return hist().undo.length > 0; }
export function canRedo() { return hist().redo.length > 0; }

export function changed(kind) {
  S.dirty = true;
  emit('change', kind);
}

const round = v => Math.round(v * 100) / 100;
export const roundPts = pts => pts.map(round);

export function createObject(type, points, extra = {}) {
  const m = media();
  if (!m) return null;
  const label = extra.label || S.activeLabel;
  if (!label) return null;
  const base = {
    id: uid(), type, label, z: maxZ() + 1, attributes: { ...defaultAttributes(label), ...(extra.attributes || {}) },
    source: extra.source || 'manual',
  };
  const asTrack = (extra.track ?? (S.trackMode && m.kind === 'video')) && type !== 'mask';
  return commit(a => {
    if (asTrack) {
      const t = { ...base, keyframes: [{ frame: S.frame, points: roundPts(points), rotation: extra.rotation || 0, occluded: false, outside: false }] };
      a.tracks.push(t);
      return t;
    }
    const s = { ...base, frame: extra.frame ?? S.frame, points: roundPts(points), rotation: extra.rotation || 0, occluded: !!extra.occluded };
    if (type === 'mask') s.mask = extra.mask;
    a.shapes.push(s);
    return s;
  });
}

// Apply a geometry change to an object at the current frame.
export function setGeometry(obj, geom) {
  commit(a => {
    if (obj.kind === 'shape') {
      const s = a.shapes.find(x => x.id === obj.id);
      if (!s) return;
      if (geom.points) s.points = roundPts(geom.points);
      if (geom.rotation !== undefined) s.rotation = round(geom.rotation);
      if (geom.mask) s.mask = geom.mask;
    } else {
      const t = a.tracks.find(x => x.id === obj.id);
      if (!t) return;
      const cur = trackAt(t, S.frame) || {};
      upsertKeyframe(t, {
        frame: S.frame, outside: false, occluded: !!cur.occluded,
        points: roundPts(geom.points || cur.points), rotation: round(geom.rotation ?? cur.rotation ?? 0),
      });
    }
  });
}

export function updateObject(id, patch, opts = {}) {
  commit(a => {
    const s = a.shapes.find(x => x.id === id);
    if (s) { Object.assign(s, patch); return; }
    const t = a.tracks.find(x => x.id === id);
    if (!t) return;
    if ('occluded' in patch) {
      const cur = trackAt(t, S.frame);
      if (cur) upsertKeyframe(t, { frame: S.frame, points: cur.points, rotation: cur.rotation || 0, outside: false, occluded: patch.occluded });
      const { occluded, ...rest } = patch;
      Object.assign(t, rest);
    } else Object.assign(t, patch);
  });
}

export function deleteObject(id) {
  commit(a => {
    a.shapes = a.shapes.filter(s => s.id !== id);
    a.tracks = a.tracks.filter(t => t.id !== id);
  });
  if (S.selected === id) S.selected = null;
}

export function setOutside(id) {
  commit(a => {
    const t = a.tracks.find(x => x.id === id);
    if (!t) return;
    const cur = trackAt(t, S.frame) || t.keyframes[t.keyframes.length - 1];
    upsertKeyframe(t, { frame: S.frame, points: cur.points, rotation: cur.rotation || 0, occluded: false, outside: true });
  });
  if (S.selected === id) S.selected = null;
}

export function deleteKeyframe(id) {
  commit(a => {
    const t = a.tracks.find(x => x.id === id);
    if (!t || t.keyframes.length <= 1) return;
    t.keyframes = t.keyframes.filter(k => k.frame !== S.frame);
  });
}

export function propagate(id, count) {
  const obj = findObject(id);
  const m = media();
  if (!obj || !m) return 0;
  const last = Math.min((m.frames || 1) - 1, S.frame + count);
  let n = 0;
  commit(a => {
    for (let f = S.frame + 1; f <= last; f++) {
      const copy = {
        id: uid(), type: obj.type, label: obj.label, frame: f, points: [...obj.points], rotation: obj.rotation,
        occluded: obj.occluded, z: obj.z, attributes: { ...obj.attributes }, source: obj.source,
      };
      if (obj.mask) copy.mask = obj.mask;
      a.shapes.push(copy);
      n++;
    }
  });
  return n;
}

export function keyframesOf(id) {
  const t = S.project.annotations[S.mediaId]?.tracks.find(x => x.id === id);
  return t ? t.keyframes.map(k => k.frame) : [];
}

export function allKeyframeFrames() {
  const a = S.project.annotations[S.mediaId];
  const set = new Set();
  if (!a) return set;
  for (const t of a.tracks) for (const k of t.keyframes) set.add(k.frame);
  return set;
}

export function annotatedFrames(mediaId) {
  const a = S.project.annotations[mediaId];
  if (!a) return new Set();
  const s = new Set(a.shapes.map(x => x.frame || 0));
  return s;
}

export function objectCount(mediaId) {
  const a = S.project.annotations[mediaId];
  return a ? a.shapes.length + a.tracks.length : 0;
}
