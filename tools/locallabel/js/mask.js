// Mask utilities. Internal mask = {left, top, width, height, rle}
// rle: row-major run lengths inside the bounding box, starting with a background (0) run.
// This matches CVAT's own mask encoding.

export function encodeFull(buf, W, H) {
  let minx = W, miny = H, maxx = -1, maxy = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (buf[row + x]) {
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < 0) return null;
  return encodeRegion(buf, W, minx, miny, maxx - minx + 1, maxy - miny + 1);
}

function encodeRegion(buf, W, left, top, width, height) {
  const rle = [];
  let cur = 0, run = 0;
  for (let y = top; y < top + height; y++) {
    const row = y * W;
    for (let x = left; x < left + width; x++) {
      const v = buf[row + x] ? 1 : 0;
      if (v === cur) run++;
      else { rle.push(run); cur = v; run = 1; }
    }
  }
  rle.push(run);
  return { left, top, width, height, rle };
}

export function decodeLocal(mask) {
  const out = new Uint8Array(mask.width * mask.height);
  let p = 0, v = 0;
  for (const run of mask.rle) {
    if (v) out.fill(1, p, p + run);
    p += run;
    v ^= 1;
  }
  return out;
}

export function decodeFull(mask, W, H) {
  const buf = new Uint8Array(W * H);
  if (!mask) return buf;
  const local = decodeLocal(mask);
  for (let y = 0; y < mask.height; y++) {
    const gy = mask.top + y;
    if (gy < 0 || gy >= H) continue;
    for (let x = 0; x < mask.width; x++) {
      const gx = mask.left + x;
      if (gx < 0 || gx >= W) continue;
      if (local[y * mask.width + x]) buf[gy * W + gx] = 1;
    }
  }
  return buf;
}

export function maskArea(mask) {
  let a = 0;
  for (let i = 1; i < mask.rle.length; i += 2) a += mask.rle[i];
  return a;
}

export function maskBBox(mask) {
  return [mask.left, mask.top, mask.left + mask.width, mask.top + mask.height];
}

export function translateMask(mask, dx, dy) {
  return { ...mask, left: Math.round(mask.left + dx), top: Math.round(mask.top + dy) };
}

const localCache = new WeakMap();
export function localBits(mask) {
  let v = localCache.get(mask);
  if (!v) { v = decodeLocal(mask); localCache.set(mask, v); }
  return v;
}

export function maskHit(mask, x, y) {
  const lx = Math.floor(x - mask.left), ly = Math.floor(y - mask.top);
  if (lx < 0 || ly < 0 || lx >= mask.width || ly >= mask.height) return false;
  return !!localBits(mask)[ly * mask.width + lx];
}

const canvasCache = new WeakMap();
export function maskCanvas(mask, color) {
  const hit = canvasCache.get(mask);
  if (hit && hit.color === color) return hit.canvas;
  const c = document.createElement('canvas');
  c.width = Math.max(1, mask.width);
  c.height = Math.max(1, mask.height);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  const [r, g, b] = hexToRgb(color);
  const bits = localBits(mask);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) {
      const j = i * 4;
      img.data[j] = r; img.data[j + 1] = g; img.data[j + 2] = b; img.data[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  canvasCache.set(mask, { color, canvas: c });
  return c;
}

export function hexToRgb(hex) {
  const h = (hex || '#ff0000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Rasterise a polygon (flat points) into a full-image mask.
export function polygonToMask(points, W, H) {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fill();
  const data = ctx.getImageData(0, 0, W, H).data;
  const buf = new Uint8Array(W * H);
  for (let i = 0; i < buf.length; i++) buf[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return encodeFull(buf, W, H);
}

// COCO RLE (column-major, full image)
export function toCocoRLE(mask, W, H) {
  const full = decodeFull(mask, W, H);
  const counts = [];
  let cur = 0, run = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const v = full[y * W + x];
      if (v === cur) run++;
      else { counts.push(run); cur = v; run = 1; }
    }
  }
  counts.push(run);
  return { counts, size: [H, W] };
}

export function fromCocoRLE(counts, H, W) {
  if (typeof counts === 'string') counts = decodeCocoString(counts);
  const buf = new Uint8Array(W * H);
  let p = 0, v = 0;
  for (const run of counts) {
    if (v) {
      for (let k = p; k < p + run; k++) {
        const x = Math.floor(k / H), y = k % H;
        if (x < W) buf[y * W + x] = 1;
      }
    }
    p += run;
    v ^= 1;
  }
  return encodeFull(buf, W, H);
}

// pycocotools compressed RLE string -> counts
export function decodeCocoString(s) {
  const cnts = [];
  let p = 0, m = 0;
  while (p < s.length) {
    let x = 0, k = 0, more = 1;
    while (more) {
      const c = s.charCodeAt(p) - 48;
      x |= (c & 0x1f) << (5 * k);
      more = c & 0x20;
      p++; k++;
      if (!more && (c & 0x10)) x |= -1 << (5 * k);
    }
    if (m > 2) x += cnts[m - 2];
    cnts[m++] = x;
  }
  return cnts;
}

// Rasterise several polygons (union) into a mask. The outline is stroked too, so traced contours
// (which run through boundary pixel centres) round-trip without eroding the mask.
export function polygonsToMask(polys, W, H) {
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const p of polys) {
    if (p.length < 6) continue;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  const data = ctx.getImageData(0, 0, W, H).data;
  const buf = new Uint8Array(W * H);
  for (let i = 0; i < buf.length; i++) buf[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return encodeFull(buf, W, H);
}

// Editable outline of a mask (outer contours, simplified), cached per mask object.
const contourCache = new WeakMap();
export function maskContours(mask) {
  let v = contourCache.get(mask);
  if (!v) { v = maskToPolygons(mask, 4); contourCache.set(mask, v); }
  return v;
}
export function setMaskContours(mask, polys) { contourCache.set(mask, polys); }

// Split a mask into one mask per 8-connected component (drops specks smaller than minArea).
export function splitComponents(mask, minArea = 4) {
  const w = mask.width, h = mask.height;
  const bits = localBits(mask);
  const comp = new Int32Array(w * h);
  const out = [];
  const stack = [];
  let id = 0;
  for (let i = 0; i < bits.length; i++) {
    if (!bits[i] || comp[i]) continue;
    id++;
    const px = [];
    comp[i] = id; stack.push(i);
    while (stack.length) {
      const q = stack.pop(); px.push(q);
      const qx = q % w, qy = (q / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (bits[n] && !comp[n]) { comp[n] = id; stack.push(n); }
      }
    }
    if (px.length < minArea) continue;
    const buf = new Uint8Array(w * h);
    for (const q of px) buf[q] = 1;
    const m = encodeFull(buf, w, h);
    out.push({ ...m, left: m.left + mask.left, top: m.top + mask.top });
  }
  return out;
}

// Contour tracing: mask -> polygons (outer boundaries)
const DIRS = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

export function maskToPolygons(mask, minArea = 4) {
  const w = mask.width, h = mask.height;
  const bits = localBits(mask);
  const comp = new Int32Array(w * h);
  const polys = [];
  let id = 0;
  const stack = [];
  for (let i = 0; i < bits.length; i++) {
    if (!bits[i] || comp[i]) continue;
    id++;
    let area = 0;
    comp[i] = id; stack.push(i);
    while (stack.length) {
      const q = stack.pop(); area++;
      const qx = q % w, qy = (q / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (bits[n] && !comp[n]) { comp[n] = id; stack.push(n); }
      }
    }
    if (area < minArea) continue;
    const sx = i % w, sy = (i / w) | 0;
    const pts = trace(comp, w, h, id, sx, sy);
    const simp = simplify(pts, 0.8);
    if (simp.length >= 3) {
      polys.push(simp.flatMap(([x, y]) => [x + mask.left + 0.5, y + mask.top + 0.5]));
    }
  }
  return polys;
}

function trace(comp, w, h, id, sx, sy) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && comp[y * w + x] === id;
  const pts = [[sx, sy]];
  let cx = sx, cy = sy, back = 0; // background neighbour lies west of the first pixel
  const limit = 4 * w * h + 8;
  for (let it = 0; it < limit; it++) {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      if (inside(nx, ny)) {
        const pd = (back + k - 1) % 8;
        const px = cx + DIRS[pd][0], py = cy + DIRS[pd][1];
        const rx = px - nx, ry = py - ny;
        back = DIRS.findIndex(([a, b]) => a === rx && b === ry);
        if (back < 0) back = 0;
        cx = nx; cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cy === sy) break;
    pts.push([cx, cy]);
  }
  if (pts.length === 1) return [[sx - 0.5, sy - 0.5], [sx + 0.5, sy - 0.5], [sx + 0.5, sy + 0.5], [sx - 0.5, sy + 0.5]];
  return pts;
}

function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let maxd = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > maxd) { maxd = d; idx = i; }
    }
    if (maxd > eps && idx > 0) { keep[idx] = 1; st.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
