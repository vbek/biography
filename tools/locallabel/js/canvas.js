// Canvas engine: rendering, hit testing and all pointer interaction for drawing/editing.
import { S, objectsAt, labelById, createObject, setGeometry, updateObject, deleteObject, media } from './store.js';
import { maskCanvas, maskHit, decodeFull, encodeFull, translateMask, maskContours, setMaskContours, polygonsToMask } from './mask.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HPOS = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
const DEG = Math.PI / 180;

export function boxParams(o) {
  if (o.type === 'ellipse') {
    const [cx, cy, rx, ry] = o.points;
    return { cx, cy, w: rx * 2, h: ry * 2, rot: o.rotation || 0 };
  }
  const [x1, y1, x2, y2] = o.points;
  return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), rot: o.rotation || 0 };
}
function boxPoints(type, cx, cy, w, h) {
  return type === 'ellipse' ? [cx, cy, w / 2, h / 2] : [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}
export function rectCorners(o) {
  const { cx, cy, w, h, rot } = boxParams(o);
  const c = Math.cos(rot * DEG), s = Math.sin(rot * DEG);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const lx = a * w / 2, ly = b * h / 2;
    return [cx + lx * c - ly * s, cy + lx * s + ly * c];
  });
}
function toLocal(p, cx, cy, rot) {
  const c = Math.cos(-rot * DEG), s = Math.sin(-rot * DEG);
  const dx = p.x - cx, dy = p.y - cy;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
function fromLocal(lx, ly, cx, cy, rot) {
  const c = Math.cos(rot * DEG), s = Math.sin(rot * DEG);
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
}
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
}

// Douglas-Peucker on a flat [x,y,...] list; keeps the first and last points.
export function simplifyFlat(flat, eps) {
  const n = flat.length / 2;
  if (n < 4) return flat;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const st = [[0, n - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let maxd = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(flat[i * 2], flat[i * 2 + 1], flat[a * 2], flat[a * 2 + 1], flat[b * 2], flat[b * 2 + 1]).d;
      if (d > maxd) { maxd = d; idx = i; }
    }
    if (maxd > eps && idx > 0) { keep[idx] = 1; st.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[i * 2], flat[i * 2 + 1]);
  return out;
}

export class Viewer {
  constructor(canvas, hooks = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.src = null; this.W = 0; this.H = 0;
    this.draft = null; this.drag = null; this.preview = null; this.stroke = null;
    this.cursor = null; this.hover = null; this.raf = 0;
    this.spaceDown = false;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointerleave', () => { this.cursor = null; this.request(); });
    canvas.addEventListener('dblclick', e => this.dbl(e));
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // Releasing Shift completes a freehand polygon/polyline.
    window.addEventListener('keyup', e => {
      if (e.key === 'Shift' && this.draft?.freehand && (this.draft.type === 'polygon' || this.draft.type === 'polyline')) {
        this.finishDraft();
      }
    });
  }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.c.style.width = r.width + 'px';
    this.c.style.height = r.height + 'px';
    if (!this.fitted && this.src) this.fit();
    this.request();
  }

  setSource(src, W, H, keepView = false) {
    const sizeChanged = W !== this.W || H !== this.H;
    this.src = src; this.W = W; this.H = H;
    if (!keepView || sizeChanged) this.fit();
    this.request();
  }

  fit() {
    if (!this.W) return;
    const cw = this.c.width / this.dpr, ch = this.c.height / this.dpr;
    if (cw < 2) return;
    this.scale = Math.min(cw / this.W, ch / this.H) * 0.94;
    this.ox = (cw - this.W * this.scale) / 2;
    this.oy = (ch - this.H * this.scale) / 2;
    this.fitted = true;
    this.hooks.onZoom?.(this.scale);
    this.request();
  }

  zoomAt(sx, sy, f) {
    const ns = Math.max(0.02, Math.min(64, this.scale * f));
    const k = ns / this.scale;
    this.ox = sx - (sx - this.ox) * k;
    this.oy = sy - (sy - this.oy) * k;
    this.scale = ns;
    this.hooks.onZoom?.(this.scale);
    this.request();
  }
  zoomBy(f) { this.zoomAt(this.c.width / this.dpr / 2, this.c.height / this.dpr / 2, f); }

  world(e) {
    const r = this.c.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale, sx, sy };
  }
  clampPt(p) {
    return { x: Math.max(0, Math.min(this.W, p.x)), y: Math.max(0, Math.min(this.H, p.y)) };
  }

  request() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  // object helpers
  objects() {
    const objs = objectsAt();
    if (this.preview) {
      return objs.map(o => o.id === this.preview.id ? { ...o, ...this.preview, id: o.id } : o);
    }
    return objs;
  }
  selectedObj() { return S.selected ? this.objects().find(o => o.id === S.selected) || null : null; }

  hit(p) {
    const tol = 6 / this.scale;
    const objs = this.objects().filter(o => !o.hidden);
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (this.hitObj(o, p, tol)) return o;
    }
    return null;
  }

  hitObj(o, p, tol) {
    const pts = o.points;
    switch (o.type) {
      case 'rectangle': {
        const { cx, cy, w, h, rot } = boxParams(o);
        const l = toLocal(p, cx, cy, rot);
        return Math.abs(l.x) <= w / 2 + tol && Math.abs(l.y) <= h / 2 + tol;
      }
      case 'ellipse': {
        const { cx, cy, w, h, rot } = boxParams(o);
        const l = toLocal(p, cx, cy, rot);
        const rx = w / 2 + tol, ry = h / 2 + tol;
        return (l.x * l.x) / (rx * rx) + (l.y * l.y) / (ry * ry) <= 1;
      }
      case 'polygon':
        if (pointInPoly(p.x, p.y, pts)) return true;
      // fall through: also near edges
      case 'polyline': {
        const n = pts.length / 2;
        const closed = o.type === 'polygon';
        for (let i = 0; i < (closed ? n : n - 1); i++) {
          const j = (i + 1) % n;
          if (segDist(p.x, p.y, pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]).d <= tol) return true;
        }
        return false;
      }
      case 'points':
      case 'skeleton':
        for (let i = 0; i < pts.length; i += 2) if (Math.hypot(p.x - pts[i], p.y - pts[i + 1]) <= tol * 1.5) return true;
        if (o.type === 'skeleton') {
          const sk = labelById(o.label)?.skeleton;
          for (const [a, b] of sk?.edges || []) {
            if (pts[a * 2] === undefined || pts[b * 2] === undefined) continue;
            if (segDist(p.x, p.y, pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1]).d <= tol) return true;
          }
        }
        return false;
      case 'mask':
        return o.mask ? maskHit(o.mask, p.x, p.y) : false;
    }
    return false;
  }

  handleAt(o, p) {
    if (!o || o.locked) return null;
    const tol = 7 / this.scale;
    if (o.type === 'rectangle' || o.type === 'ellipse') {
      const { cx, cy, w, h, rot } = boxParams(o);
      const rp = fromLocal(0, -h / 2 - 26 / this.scale, cx, cy, rot);
      if (Math.hypot(p.x - rp.x, p.y - rp.y) <= tol) return { kind: 'rotate' };
      for (const hname of HANDLES) {
        const [a, b] = HPOS[hname];
        const hp = fromLocal(a * w / 2, b * h / 2, cx, cy, rot);
        if (Math.hypot(p.x - hp.x, p.y - hp.y) <= tol) return { kind: 'resize', handle: hname };
      }
      return null;
    }
    if (o.type === 'mask' && o.mask) {
      const polys = this.contoursOf(o);
      for (let pi = 0; pi < polys.length; pi++) {
        const q = polys[pi];
        for (let i = 0; i < q.length; i += 2) {
          if (Math.hypot(p.x - q[i], p.y - q[i + 1]) <= tol) return { kind: 'mvertex', poly: pi, index: i / 2 };
        }
      }
      return null;
    }
    if (['polygon', 'polyline', 'points', 'skeleton'].includes(o.type)) {
      for (let i = 0; i < o.points.length; i += 2) {
        if (Math.hypot(p.x - o.points[i], p.y - o.points[i + 1]) <= tol) return { kind: 'vertex', index: i / 2 };
      }
    }
    return null;
  }

  // pointer
  down(e) {
    if (!this.src) return;
    this.c.setPointerCapture(e.pointerId);
    const p = this.world(e);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: 'pan', sx: p.sx, sy: p.sy, ox: this.ox, oy: this.oy };
      return;
    }
    if (e.button !== 0) return;
    const tool = S.tool;
    const cp = this.clampPt(p);

    if (tool === 'brush' || tool === 'eraser') return this.startStroke(cp, tool === 'eraser');

    if (tool === 'rectangle' || tool === 'ellipse') {
      if (!this.needLabel()) return;
      this.draft = { type: tool, start: cp, end: cp };
      this.drag = { kind: 'draw-box' };
      return this.request();
    }
    if (tool === 'polygon' || tool === 'polyline' || tool === 'points' || tool === 'skeleton') {
      if (!this.needLabel()) return;
      if (tool === 'skeleton') {
        const sk = labelById(S.activeLabel)?.skeleton;
        if (!sk?.nodes?.length) return this.hooks.toast?.('This label has no skeleton. Define nodes in the label editor.');
      }
      if (!this.draft || this.draft.type !== tool) this.draft = { type: tool, points: [] };
      const d = this.draft;
      if (tool === 'polygon' && d.points.length >= 6) {
        const tol = 8 / this.scale;
        if (Math.hypot(cp.x - d.points[0], cp.y - d.points[1]) <= tol) return this.finishDraft();
      }
      d.points.push(cp.x, cp.y);
      if (tool === 'skeleton') {
        const sk = labelById(S.activeLabel).skeleton;
        if (d.points.length / 2 >= sk.nodes.length) return this.finishDraft();
      }
      return this.request();
    }

    // select tool
    const sel = this.selectedObj();
    const h = this.handleAt(sel, p);
    if (h) {
      if (h.kind === 'vertex' && e.altKey) return this.deleteVertex(sel, h.index);
      if (h.kind === 'mvertex' && e.altKey) {
        const polys = maskContours(sel.mask).map(q => [...q]);
        if (polys[h.poly].length / 2 <= 3) polys.splice(h.poly, 1); else polys[h.poly].splice(h.index * 2, 2);
        return this.commitContours(sel, polys);
      }
      if (h.kind === 'mvertex') {
        this.drag = { kind: 'mvertex', obj: sel, poly: h.poly, index: h.index, polys: maskContours(sel.mask).map(q => [...q]) };
        return;
      }
      this.drag = { kind: h.kind, handle: h.handle, index: h.index, obj: sel, orig: { ...boxParams(sel), points: [...sel.points] } };
      return;
    }
    const o = this.hit(p);
    if (o) {
      S.selected = o.id;
      this.hooks.onSelect?.(o.id);
      if (!o.locked) this.drag = { kind: 'move', obj: o, start: p, points: [...o.points], mask: o.mask, moved: false };
    } else {
      if (S.selected) { S.selected = null; this.hooks.onSelect?.(null); }
      this.drag = { kind: 'pan', sx: p.sx, sy: p.sy, ox: this.ox, oy: this.oy };
    }
    this.request();
  }

  move(e) {
    if (!this.src) return;
    const p = this.world(e);
    this.cursor = p;
    this.hooks.onCursor?.(p);
    const d = this.drag;
    if (this.stroke) { this.continueStroke(this.clampPt(p)); return; }
    // Freehand: while a polygon/polyline is being drawn, holding Shift adds points as the mouse moves.
    // Shift + move with no drawing in progress starts one at the cursor (no click needed).
    if (!this.draft && !d && e.shiftKey && (S.tool === 'polygon' || S.tool === 'polyline') && S.activeLabel) {
      const cp = this.clampPt(p);
      this.draft = { type: S.tool, points: [cp.x, cp.y], freehand: true };
    }
    const dr = this.draft;
    if (dr && (dr.type === 'polygon' || dr.type === 'polyline') && e.shiftKey && dr.points.length) {
      const cp = this.clampPt(p), pts = dr.points, n = pts.length;
      if (Math.hypot(cp.x - pts[n - 2], cp.y - pts[n - 1]) * this.scale >= 4) {
        pts.push(cp.x, cp.y);
        dr.freehand = true;
      }
      this.c.style.cursor = 'crosshair';
      this.request();
      return;
    }
    if (!d) {
      if (S.tool === 'select') {
        const sel = this.selectedObj();
        const h = this.handleAt(sel, p);
        const o = h ? null : this.hit(p);
        this.c.style.cursor = h ? (h.kind === 'rotate' ? 'grab' : 'crosshair') : o ? (o.locked ? 'not-allowed' : 'move') : 'default';
        const hid = o?.id || null;
        if (hid !== this.hover) { this.hover = hid; }
      } else this.c.style.cursor = 'crosshair';
      this.request();
      return;
    }
    if (d.kind === 'pan') {
      this.ox = d.ox + (p.sx - d.sx);
      this.oy = d.oy + (p.sy - d.sy);
      return this.request();
    }
    if (d.kind === 'draw-box') {
      this.draft.end = this.clampPt(p);
      if (e.shiftKey) { // square
        const s = this.draft.start, en = this.draft.end;
        const m = Math.max(Math.abs(en.x - s.x), Math.abs(en.y - s.y));
        this.draft.end = { x: s.x + Math.sign(en.x - s.x) * m, y: s.y + Math.sign(en.y - s.y) * m };
      }
      return this.request();
    }
    const o = d.obj;
    if (d.kind === 'move') {
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (Math.hypot(dx, dy) * this.scale > 2) d.moved = true;
      if (!d.moved) return;
      let pts = d.points;
      if (o.type === 'ellipse') pts = [pts[0] + dx, pts[1] + dy, pts[2], pts[3]];
      else pts = pts.map((v, i) => v + (i % 2 ? dy : dx));
      this.preview = { id: o.id, points: pts };
      if (o.type === 'mask') { this.preview.mask = translateMask(d.mask, dx, dy); this.preview.dx = dx; this.preview.dy = dy; }
      return this.request();
    }
    if (d.kind === 'mvertex') {
      const cp = this.clampPt(p);
      const polys = d.polys.map(q => q);
      const q = [...polys[d.poly]];
      q[d.index * 2] = cp.x; q[d.index * 2 + 1] = cp.y;
      polys[d.poly] = q;
      this.preview = { id: o.id, polys };
      return this.request();
    }
    if (d.kind === 'vertex') {
      const cp = this.clampPt(p);
      const pts = [...d.orig.points];
      pts[d.index * 2] = cp.x; pts[d.index * 2 + 1] = cp.y;
      this.preview = { id: o.id, points: pts };
      return this.request();
    }
    if (d.kind === 'rotate') {
      const { cx, cy } = d.orig;
      let ang = Math.atan2(p.y - cy, p.x - cx) / DEG + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      ang = ((ang % 360) + 360) % 360;
      this.preview = { id: o.id, rotation: ang, points: d.orig.points };
      return this.request();
    }
    if (d.kind === 'resize') {
      const { cx, cy, w, h, rot } = d.orig;
      const l = toLocal(p, cx, cy, rot);
      let L = -w / 2, R = w / 2, T = -h / 2, B = h / 2;
      const [a, b] = HPOS[d.handle];
      if (a < 0) L = Math.min(l.x, R - 1); if (a > 0) R = Math.max(l.x, L + 1);
      if (b < 0) T = Math.min(l.y, B - 1); if (b > 0) B = Math.max(l.y, T + 1);
      const mc = fromLocal((L + R) / 2, (T + B) / 2, cx, cy, rot);
      this.preview = { id: o.id, rotation: rot, points: boxPoints(o.type, mc.x, mc.y, R - L, B - T) };
      return this.request();
    }
  }

  up(e) {
    if (this.stroke) { this.endStroke(); return; }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'draw-box') {
      const { start: s, end: en, type } = this.draft;
      this.draft = null;
      const x1 = Math.min(s.x, en.x), y1 = Math.min(s.y, en.y), x2 = Math.max(s.x, en.x), y2 = Math.max(s.y, en.y);
      if ((x2 - x1) * this.scale > 3 && (y2 - y1) * this.scale > 3) {
        const pts = type === 'ellipse' ? [(x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2] : [x1, y1, x2, y2];
        const obj = createObject(type, pts);
        if (obj) { S.selected = obj.id; this.hooks.onSelect?.(obj.id); }
      }
      return this.request();
    }
    if (this.preview && d.obj) {
      const pv = this.preview;
      this.preview = null;
      if (pv.polys) { this.commitContours(d.obj, pv.polys); return this.request(); }
      if (pv.mask && d.mask && d.moved) {
        const dx = Math.round(pv.dx), dy = Math.round(pv.dy);
        setMaskContours(pv.mask, maskContours(d.mask).map(q => q.map((v, i) => v + (i % 2 ? dy : dx))));
      }
      if (d.kind !== 'move' || d.moved) {
        const geom = { points: pv.points };
        if (pv.rotation !== undefined) geom.rotation = pv.rotation;
        if (pv.mask) geom.mask = pv.mask;
        setGeometry(d.obj, geom);
      }
    }
    this.preview = null;
    this.request();
  }

  dbl(e) {
    const p = this.world(e);
    if (this.draft && ['polygon', 'polyline', 'points'].includes(this.draft.type)) {
      // the second click of a dblclick already added a duplicate point
      const d = this.draft;
      if (d.points.length >= 4) {
        const n = d.points.length;
        if (Math.hypot(d.points[n - 2] - d.points[n - 4], d.points[n - 1] - d.points[n - 3]) < 3 / this.scale) d.points.splice(n - 2, 2);
      }
      return this.finishDraft();
    }
    if (S.tool !== 'select') return;
    const o = this.selectedObj();
    if (o && !o.locked && o.type === 'mask' && o.mask) {
      const polys = maskContours(o.mask).map(q => [...q]);
      let best = null;
      polys.forEach((q, pi) => {
        const n = q.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const r = segDist(p.x, p.y, q[i * 2], q[i * 2 + 1], q[j * 2], q[j * 2 + 1]);
          if (r.d <= 8 / this.scale && (!best || r.d < best.d)) best = { ...r, i, pi };
        }
      });
      if (!best) return;
      polys[best.pi].splice((best.i + 1) * 2, 0, p.x, p.y);
      return this.commitContours(o, polys);
    }
    if (!o || o.locked || (o.type !== 'polygon' && o.type !== 'polyline')) return;
    const n = o.points.length / 2;
    let best = null;
    for (let i = 0; i < (o.type === 'polygon' ? n : n - 1); i++) {
      const j = (i + 1) % n;
      const r = segDist(p.x, p.y, o.points[i * 2], o.points[i * 2 + 1], o.points[j * 2], o.points[j * 2 + 1]);
      if (r.d <= 8 / this.scale && (!best || r.d < best.d)) best = { ...r, i };
    }
    if (!best) return;
    const pts = [...o.points];
    pts.splice((best.i + 1) * 2, 0, p.x, p.y);
    setGeometry(o, { points: pts });
    this.request();
  }

  // Outline used to edit a mask with points (preview polygons while dragging, else traced contours)
  contoursOf(o) {
    if (this.preview?.id === o.id && this.preview.polys) return this.preview.polys;
    return o.mask ? maskContours(o.mask) : [];
  }
  commitContours(o, polys) {
    const mask = polygonsToMask(polys, this.W, this.H);
    if (!mask) return deleteObject(o.id);
    setMaskContours(mask, polys);
    setGeometry(o, { mask, points: [mask.left, mask.top, mask.left + mask.width, mask.top + mask.height] });
  }

  deleteVertex(o, index) {
    const min = o.type === 'polygon' ? 3 : o.type === 'polyline' ? 2 : 1;
    if (o.type === 'skeleton') return;
    if (o.points.length / 2 <= min) return this.hooks.toast?.('Too few points left; delete the object instead.');
    const pts = [...o.points];
    pts.splice(index * 2, 2);
    setGeometry(o, { points: pts });
  }

  wheel(e) {
    e.preventDefault();
    if (!this.src) return;
    const p = this.world(e);
    this.zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }

  needLabel() {
    if (!S.activeLabel) { this.hooks.toast?.('Create a label first (right panel → + Label).'); return false; }
    return true;
  }

  // drafts
  finishDraft() {
    const d = this.draft;
    if (!d) return;
    const n = (d.points || []).length / 2;
    const min = { polygon: 3, polyline: 2, points: 1, skeleton: 1 }[d.type] || 1;
    if (d.type === 'skeleton') {
      const sk = labelById(S.activeLabel)?.skeleton;
      if (!sk || n < sk.nodes.length) return this.hooks.toast?.(`Place all ${sk?.nodes.length} skeleton nodes.`);
    }
    let tooSmall = false;
    if (d.freehand) { // ignore accidental Shift wiggles: the trace must span at least 8 screen pixels
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i < d.points.length; i += 2) {
        x1 = Math.min(x1, d.points[i]); x2 = Math.max(x2, d.points[i]);
        y1 = Math.min(y1, d.points[i + 1]); y2 = Math.max(y2, d.points[i + 1]);
      }
      tooSmall = Math.max(x2 - x1, y2 - y1) * this.scale < 8;
    }
    if (n >= min && !tooSmall) {
      // Thin out freehand traces (sub-pixel jitter) so shapes stay light and editable.
      const pts = d.freehand ? simplifyFlat(d.points, 0.75 / this.scale) : d.points;
      const obj = createObject(d.type, pts.length / 2 >= min ? pts : d.points);
      if (obj) { S.selected = obj.id; this.hooks.onSelect?.(obj.id); }
    }
    this.draft = null;
    this.request();
  }
  cancelDraft() { this.draft = null; this.drag = null; this.preview = null; this.request(); }
  undoDraftPoint() {
    if (this.draft?.points?.length) { this.draft.points.splice(-2, 2); this.request(); return true; }
    return false;
  }

  // brush
  startStroke(p, erase) {
    const sel = this.selectedObj();
    let target = sel && sel.type === 'mask' ? sel : null;
    if (erase && !target) return this.hooks.toast?.('Select a mask to erase from.');
    if (!target && !this.needLabel()) return;
    const color = labelById(target ? target.label : S.activeLabel)?.color || '#ff0000';
    const off = document.createElement('canvas');
    off.width = this.W; off.height = this.H;
    const octx = off.getContext('2d');
    if (target) octx.drawImage(maskCanvas(target.mask, color), target.mask.left, target.mask.top);
    octx.fillStyle = color;
    octx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    const buf = target ? decodeFull(target.mask, this.W, this.H) : new Uint8Array(this.W * this.H);
    this.stroke = { buf, off, octx, target, erase, last: p };
    this.stamp(p.x, p.y);
    this.request();
  }
  stamp(x, y) {
    const r = S.brushRadius, { buf, octx, erase } = this.stroke;
    const W = this.W, H = this.H;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    const v = erase ? 0 : 1, r2 = r * r;
    for (let yy = y0; yy <= y1; yy++) {
      const dy = yy + 0.5 - y;
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x;
        if (dx * dx + dy * dy <= r2) buf[yy * W + xx] = v;
      }
    }
    octx.beginPath();
    octx.arc(x, y, r, 0, Math.PI * 2);
    octx.fill();
  }
  continueStroke(p) {
    const st = this.stroke;
    const dist = Math.hypot(p.x - st.last.x, p.y - st.last.y);
    const step = Math.max(1, S.brushRadius / 3);
    const n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) {
      this.stamp(st.last.x + (p.x - st.last.x) * i / n, st.last.y + (p.y - st.last.y) * i / n);
    }
    st.last = p;
    this.request();
  }
  endStroke() {
    const st = this.stroke;
    this.stroke = null;
    const mask = encodeFull(st.buf, this.W, this.H);
    if (st.target) {
      if (!mask) deleteObject(st.target.id);
      else setGeometry(st.target, { mask, points: [mask.left, mask.top, mask.left + mask.width, mask.top + mask.height] });
    } else if (mask) {
      const obj = createObject('mask', [mask.left, mask.top, mask.left + mask.width, mask.top + mask.height], { mask });
      if (obj) { S.selected = obj.id; this.hooks.onSelect?.(obj.id); }
    }
    this.request();
  }

  // drawing
  draw() {
    const ctx = this.ctx, dpr = this.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    if (!this.src) return;
    ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, this.ox * dpr, this.oy * dpr);
    ctx.imageSmoothingEnabled = this.scale < 2;
    try { ctx.drawImage(this.src, 0, 0, this.W, this.H); } catch { /* video not ready */ }

    const objs = this.objects();
    const lw = 1.6 / this.scale;
    for (const o of objs) {
      if (o.hidden) continue;
      if (this.stroke?.target?.id === o.id) continue;
      this.drawObj(o, lw, o.id === S.selected, o.id === this.hover);
    }
    if (this.stroke) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(this.stroke.off, 0, 0);
      ctx.globalAlpha = 1;
    }
    this.drawDraft(lw);
    const sel = objs.find(o => o.id === S.selected);
    if (sel && !sel.hidden) this.drawHandles(sel);

    // screen-space overlays: label tags, brush cursor
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.showLabels) for (const o of objs) if (!o.hidden) this.drawTag(o);
    if ((S.tool === 'brush' || S.tool === 'eraser') && this.cursor) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(this.cursor.sx, this.cursor.sy, S.brushRadius * this.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawObj(o, lw, selected, hover) {
    const ctx = this.ctx;
    const color = labelById(o.label)?.color || '#888';
    const fillA = selected ? Math.min(0.6, S.fillOpacity + 0.15) : S.fillOpacity;
    ctx.lineWidth = selected ? lw * 1.8 : hover ? lw * 1.4 : lw;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.setLineDash(o.occluded ? [6 / this.scale, 4 / this.scale] : []);
    const pts = o.points;
    switch (o.type) {
      case 'rectangle': {
        const { cx, cy, w, h, rot } = boxParams(o);
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot * DEG);
        ctx.globalAlpha = fillA; ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.globalAlpha = 1; ctx.strokeRect(-w / 2, -h / 2, w, h);
        if (rot) { ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 + Math.min(h / 4, 12 / this.scale)); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'ellipse': {
        const { cx, cy, w, h, rot } = boxParams(o);
        ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, rot * DEG, 0, Math.PI * 2);
        ctx.globalAlpha = fillA; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
        break;
      }
      case 'polygon':
      case 'polyline': {
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        if (o.type === 'polygon') { ctx.closePath(); ctx.globalAlpha = fillA; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.stroke();
        if (o.type === 'polyline') for (let i = 0; i < pts.length; i += 2) this.dot(pts[i], pts[i + 1], 2.2, color);
        break;
      }
      case 'points':
        for (let i = 0; i < pts.length; i += 2) this.dot(pts[i], pts[i + 1], selected ? 4.5 : 3.5, color, true);
        break;
      case 'skeleton': {
        const sk = labelById(o.label)?.skeleton;
        ctx.beginPath();
        for (const [a, b] of sk?.edges || []) {
          if (pts[a * 2] === undefined || pts[b * 2] === undefined) continue;
          ctx.moveTo(pts[a * 2], pts[a * 2 + 1]); ctx.lineTo(pts[b * 2], pts[b * 2 + 1]);
        }
        ctx.stroke();
        for (let i = 0; i < pts.length; i += 2) this.dot(pts[i], pts[i + 1], 3.5, color, true);
        break;
      }
      case 'mask': {
        if (this.preview?.id === o.id && this.preview.polys) {
          ctx.beginPath();
          for (const q of this.preview.polys) {
            ctx.moveTo(q[0], q[1]);
            for (let i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]);
            ctx.closePath();
          }
          ctx.globalAlpha = Math.min(0.85, fillA + 0.3); ctx.fill('nonzero'); ctx.globalAlpha = 1; ctx.stroke();
          break;
        }
        if (!o.mask) break;
        ctx.globalAlpha = Math.min(0.85, fillA + 0.3);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(maskCanvas(o.mask, color), o.mask.left, o.mask.top);
        ctx.globalAlpha = 1;
        if (selected || hover) {
          ctx.setLineDash([4 / this.scale, 3 / this.scale]);
          ctx.strokeRect(o.mask.left, o.mask.top, o.mask.width, o.mask.height);
        }
        break;
      }
    }
    ctx.setLineDash([]);
  }

  dot(x, y, r, color, outline) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r / this.scale, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    if (outline) { ctx.lineWidth = 1 / this.scale; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.strokeStyle = color; }
  }

  drawHandles(o) {
    if (o.locked) return;
    const ctx = this.ctx;
    const hs = 4.5 / this.scale;
    ctx.lineWidth = 1.2 / this.scale;
    const handle = (x, y, round) => {
      ctx.beginPath();
      if (round) ctx.arc(x, y, hs, 0, Math.PI * 2); else ctx.rect(x - hs, y - hs, hs * 2, hs * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.stroke();
    };
    if (o.type === 'rectangle' || o.type === 'ellipse') {
      const { cx, cy, w, h, rot } = boxParams(o);
      const top = fromLocal(0, -h / 2, cx, cy, rot);
      const rp = fromLocal(0, -h / 2 - 26 / this.scale, cx, cy, rot);
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rp.x, rp.y); ctx.strokeStyle = '#fff'; ctx.stroke();
      handle(rp.x, rp.y, true);
      for (const hname of HANDLES) {
        const [a, b] = HPOS[hname];
        const hp = fromLocal(a * w / 2, b * h / 2, cx, cy, rot);
        handle(hp.x, hp.y, false);
      }
    } else if (o.type === 'mask' && o.mask) {
      const polys = this.contoursOf(o);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2 / this.scale;
      ctx.beginPath();
      for (const q of polys) {
        ctx.moveTo(q[0], q[1]);
        for (let i = 2; i < q.length; i += 2) ctx.lineTo(q[i], q[i + 1]);
        ctx.closePath();
      }
      ctx.stroke();
      const small = 3.2 / this.scale;
      for (const q of polys) for (let i = 0; i < q.length; i += 2) {
        ctx.beginPath(); ctx.arc(q[i], q[i + 1], small, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1 / this.scale; ctx.stroke();
      }
    } else if (['polygon', 'polyline', 'points', 'skeleton'].includes(o.type)) {
      for (let i = 0; i < o.points.length; i += 2) handle(o.points[i], o.points[i + 1], true);
    }
  }

  drawDraft(lw) {
    const d = this.draft;
    if (!d) return;
    const ctx = this.ctx;
    const color = labelById(S.activeLabel)?.color || '#fff';
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw * 1.5;
    if (d.type === 'rectangle' || d.type === 'ellipse') {
      const x1 = Math.min(d.start.x, d.end.x), y1 = Math.min(d.start.y, d.end.y);
      const w = Math.abs(d.end.x - d.start.x), h = Math.abs(d.end.y - d.start.y);
      ctx.setLineDash([6 / this.scale, 4 / this.scale]);
      if (d.type === 'rectangle') ctx.strokeRect(x1, y1, w, h);
      else { ctx.beginPath(); ctx.ellipse(x1 + w / 2, y1 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.setLineDash([]);
      return;
    }
    const pts = d.points;
    if (!pts.length) return;
    if (d.type === 'skeleton') {
      const sk = labelById(S.activeLabel)?.skeleton;
      ctx.beginPath();
      for (const [a, b] of sk?.edges || []) {
        if (pts[a * 2] === undefined || pts[b * 2] === undefined) continue;
        ctx.moveTo(pts[a * 2], pts[a * 2 + 1]); ctx.lineTo(pts[b * 2], pts[b * 2 + 1]);
      }
      ctx.stroke();
      for (let i = 0; i < pts.length; i += 2) this.dot(pts[i], pts[i + 1], 4, color, true);
      return;
    }
    if (d.type !== 'points') {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      if (this.cursor) { const c = this.clampPt(this.cursor); ctx.lineTo(c.x, c.y); }
      if (d.type === 'polygon' && pts.length >= 4) {
        ctx.closePath();
        ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.stroke();
    }
    for (let i = 0; i < pts.length; i += 2) this.dot(pts[i], pts[i + 1], i === 0 && d.type === 'polygon' ? 5 : 3.5, color, true);
  }

  drawTag(o) {
    const lab = labelById(o.label);
    if (!lab) return;
    let ax, ay;
    if (o.type === 'rectangle' || o.type === 'ellipse') {
      const c = rectCorners(o);
      ax = Math.min(...c.map(p => p[0])); ay = Math.min(...c.map(p => p[1]));
    } else if (o.type === 'mask' && o.mask) { ax = o.mask.left; ay = o.mask.top; }
    else {
      ax = Infinity; ay = Infinity;
      for (let i = 0; i < o.points.length; i += 2) { ax = Math.min(ax, o.points[i]); ay = Math.min(ay, o.points[i + 1]); }
    }
    const sx = ax * this.scale + this.ox, sy = ay * this.scale + this.oy;
    const ctx = this.ctx;
    let text = lab.name;
    if (o.kind === 'track') text += o.keyframe ? ' ◆' : ' ◇';
    if (o.source === 'auto') text += ' ·AI';
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 8;
    const y = Math.max(0, sy - 17);
    ctx.fillStyle = lab.color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(sx, y, w, 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0b0d12';
    ctx.fillText(text, sx + 4, y + 12);
  }
}
