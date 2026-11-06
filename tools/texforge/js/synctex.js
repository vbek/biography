/*
 * Minimal SyncTeX reader for TeXForge.
 *
 *   const s = SyncTeX.parse(text, { projectDir: '/home/web_user/p0' });
 *   s.forward('main.tex', 42)        → [{ page, h, v, W, H, D }]  (boxes in PDF points, top-left origin)
 *   s.inverse(page, x, y)            → { file, line } | null
 *
 * Coordinates in the file are TeX scaled points; they are converted to PDF big points (bp).
 */
(function (root) {
  'use strict';

  function parse(text, { projectDir = '' } = {}) {
    const inputs = new Map();   // tag -> relative project path (or null for system files)
    let unit = 1;
    let mag = 1000;
    let xOff = 0;
    let yOff = 0;
    const pages = new Map();    // page -> { boxes: [], nodes: [] }

    const normDir = projectDir.replace(/\/+$/, '');
    const relPath = p => {
      let s = p.replace(/\\/g, '/');
      if (normDir && s.startsWith(`${normDir}/`)) s = s.slice(normDir.length + 1);
      else if (/^(\/|[A-Za-z]:\/)/.test(s)) return null;
      s = s.replace(/^(\.\/)+/, '').replace(/\/\.\//g, '/');
      return s;
    };

    const lines = text.split('\n');
    let i = 0;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith('Input:')) {
        const m = /^Input:(\d+):(.*)$/.exec(l);
        if (m) inputs.set(Number(m[1]), relPath(m[2].replace(/\r$/, '')));
      } else if (l.startsWith('Unit:')) unit = Number(l.slice(5)) || 1;
      else if (l.startsWith('Magnification:')) mag = Number(l.slice(14)) || 1000;
      else if (l.startsWith('X Offset:')) xOff = Number(l.slice(9)) || 0;
      else if (l.startsWith('Y Offset:')) yOff = Number(l.slice(9)) || 0;
      else if (l.startsWith('Content:')) { i++; break; }
    }
    const k = unit * (mag / 1000) / 65536 * (72 / 72.27);
    const X = v => (Number(v) + xOff) * k;
    const Y = v => (Number(v) + yOff) * k;
    const S = v => Number(v) * k;

    let page = null;
    const stack = []; // open boxes (indexes into page.boxes)
    const rec = /^([[(vhxkg$r])(\d+),(\d+):(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;
    for (; i < lines.length; i++) {
      const l = lines[i];
      const c = l[0];
      if (c === '{') {
        const n = Number(l.slice(1));
        page = { boxes: [], nodes: [] };
        pages.set(n, page);
        stack.length = 0;
        continue;
      }
      if (c === '}') { page = null; continue; }
      if (!page) {
        if (l.startsWith('Postamble:')) break;
        continue;
      }
      if (c === ']' || c === ')') { stack.pop(); continue; }
      const m = rec.exec(l);
      if (!m) continue;
      const type = m[1];
      const parent = stack.length ? stack[stack.length - 1] : -1;
      const item = {
        type,
        tag: Number(m[2]),
        line: Number(m[3]),
        h: X(m[4]),
        v: Y(m[5]),
        W: m[6] !== undefined ? S(m[6]) : 0,
        H: m[7] !== undefined ? S(m[7]) : 0,
        D: m[8] !== undefined ? S(m[8]) : 0,
        parent,
      };
      if (type === '[' || type === '(') {
        page.boxes.push(item);
        stack.push(page.boxes.length - 1);
      } else if (type === 'h' || type === 'v') {
        page.boxes.push(item);
      } else {
        page.nodes.push(item);
      }
    }

    const tagsFor = file => {
      const want = file.replace(/^(\.\/)+/, '');
      const out = [];
      for (const [tag, p] of inputs) if (p === want) out.push(tag);
      if (!out.length) {
        const base = want.slice(want.lastIndexOf('/') + 1);
        for (const [tag, p] of inputs) if (p && p.slice(p.lastIndexOf('/') + 1) === base) out.push(tag);
      }
      return out;
    };

    /** Source line → boxes in the PDF (the hboxes that contain material from that line). */
    function forwardExact(tags, line) {
      for (const [n, pg] of [...pages].sort((a, b) => a[0] - b[0])) {
        const hits = [];
        const seen = new Set();
        const consider = (item, boxIndex) => {
          const b = boxIndex >= 0 ? pg.boxes[boxIndex] : item;
          const key = `${b.h.toFixed(2)}|${b.v.toFixed(2)}|${b.W.toFixed(2)}`;
          if (seen.has(key)) return;
          seen.add(key);
          // same convention as the synctex CLI: v is the bottom edge, H the full height
          hits.push({ page: n, h: b.h, v: b.v + b.D, W: b.W, H: b.H + b.D, x: item.h, y: item.v });
        };
        for (const node of pg.nodes) {
          if (node.line !== line || !tags.includes(node.tag)) continue;
          let p = node.parent;
          while (p >= 0 && pg.boxes[p].type !== '(') p = pg.boxes[p].parent;
          consider(node, p);
        }
        pg.boxes.forEach((b, bi) => {
          if (b.line !== line || !tags.includes(b.tag)) return;
          if (b.W > 0 && b.H + b.D > 0 && b.type !== '[') consider(b, bi);
        });
        if (hits.length) {
          // drop page-sized containers (floats, the text block) when tighter boxes exist
          const tight = hits.filter(h => h.H < 380);
          return tight.length ? tight : hits;
        }
      }
      return [];
    }

    function forward(file, line) {
      const tags = tagsFor(file);
      if (!tags.length) return [];
      for (let d = 0; d <= 12; d++) {
        for (const ln of d ? [line - d, line + d] : [line]) {
          if (ln < 1) continue;
          const r = forwardExact(tags, ln);
          if (r.length) return r.map(x => ({ ...x, line: ln }));
        }
      }
      return [];
    }

    /** PDF point → source location. x, y in bp from the page's top-left corner. */
    function inverse(pageNo, x, y) {
      const pg = pages.get(pageNo);
      if (!pg) return null;
      // innermost hbox containing the point
      let best = -1;
      let bestArea = Infinity;
      pg.boxes.forEach((b, bi) => {
        if (b.type !== '(' || b.W <= 0 || b.H + b.D <= 0) return;
        const top = b.v - b.H;
        const bottom = b.v + Math.max(b.D, b.H * 0.35); // many line boxes record no depth
        if (x >= b.h - 1 && x <= b.h + b.W + 1 && y >= top - 1 && y <= bottom + 1) {
          const area = Math.max(b.W, 0.1) * Math.max(b.H + b.D, 0.1);
          if (area <= bestArea) { bestArea = area; best = bi; }
        }
      });
      const inProject = item => item && inputs.get(item.tag);
      const isBbl = item => /\.bbl$/.test(inputs.get(item.tag) || '');
      const pick = item => ({ file: inputs.get(item.tag), line: item.line });

      if (best >= 0) {
        const descends = n => { let p = n.parent; while (p >= 0) { if (p === best) return true; p = pg.boxes[p].parent; } return false; };
        // bibliography entries come from the generated .bbl — report that so the UI can jump to \bibliography
        if (pg.nodes.some(n => descends(n) && isBbl(n))) return { file: inputs.get(pg.nodes.find(n => descends(n) && isBbl(n)).tag), line: 1, bibliography: true };
        let nearest = null;
        let nd = Infinity;
        for (const n of pg.nodes) {
          if (!inProject(n) || !descends(n)) continue;
          const d = n.h <= x ? x - n.h : (n.h - x) * 3; // prefer the node just left of the click
          if (d < nd) { nd = d; nearest = n; }
        }
        if (nearest) return pick(nearest);
        if (inProject(pg.boxes[best])) return pick(pg.boxes[best]);
      }
      // fall back to the closest node (glyph run, glue, kern, math) from a project file
      let nearest = null;
      let nd = Infinity;
      for (const n of pg.nodes) {
        if (!inProject(n)) continue;
        const dy = Math.abs(y - (n.v - 3));
        const dx = x < n.h ? n.h - x : Math.max(0, x - (n.h + Math.max(n.W, 40)));
        const d = dy * 4 + dx;
        if (d < nd) { nd = d; nearest = n; }
      }
      return nearest ? pick(nearest) : null;
    }

    return { forward, inverse, inputs, pages };
  }

  const api = { parse };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SyncTeX = api;
})(typeof self !== 'undefined' ? self : this);
