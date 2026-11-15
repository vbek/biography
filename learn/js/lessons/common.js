// Helpers shared by the 2D classification lessons.
import { paintField, pointEditor } from '../core/plot2d.js';
import { hexToRgb, fmt, pct } from '../core/math.js';

export const swatch = (color) => `<span class="sw" style="background:${color}"></span>`;

/** Class-probability field → image. probs(x, y) returns an array of class probabilities. */
export function regionImage(plot, cols, probs, C, { alpha = 0.34, boundary = true } = {}) {
    const g = plot.sampleGrid(cols);
    const rgb = C.c.map(hexToRgb);
    const out = new Array(g.cols * g.rows);
    for (let k = 0; k < out.length; k++) out[k] = probs(g.pts[2 * k], g.pts[2 * k + 1]);
    const img = paintField(g.cols, g.rows, (i, j, k) => {
        const p = out[k];
        let r = 0, gg = 0, b = 0, best = 0, second = 0;
        for (let c = 0; c < p.length; c++) {
            r += rgb[c][0] * p[c]; gg += rgb[c][1] * p[c]; b += rgb[c][2] * p[c];
            if (p[c] > best) { second = best; best = p[c]; } else if (p[c] > second) second = p[c];
        }
        const conf = Math.min(1, (best - second) * 1.4);
        return [r, gg, b, 255 * alpha * (0.3 + 0.7 * conf)];
    });
    return { img, probs: out, cols: g.cols, rows: g.rows, version: plot.version };
}

export function drawClassPoints(plot, pts, C, hot) {
    for (const p of pts) plot.point(p.x, p.y, C.c[p.c], { test: p.test, hot: p === hot });
}

export function accuracy(pts, predict) {
    let tr = 0, trN = 0, te = 0, teN = 0;
    for (const p of pts) {
        const ok = predict(p.x, p.y) === p.c ? 1 : 0;
        if (p.test) { te += ok; teN++; } else { tr += ok; trN++; }
    }
    return { train: trN ? tr / trN : NaN, test: teN ? te / teN : NaN };
}

export function classData(pts) {
    const tr = pts.filter((p) => !p.test), te = pts.filter((p) => p.test);
    return { X: tr.map((p) => [p.x, p.y]), y: tr.map((p) => p.c), X_test: te.map((p) => [p.x, p.y]), y_test: te.map((p) => p.c) };
}

/** Sample grid for Python (coarse) plus what is needed to paint it back. */
export function pyGrid(plot, cols = 70) {
    const g = plot.sampleGrid(cols);
    const grid = [];
    for (let k = 0; k < g.cols * g.rows; k++) grid.push([+g.pts[2 * k].toFixed(4), +g.pts[2 * k + 1].toFixed(4)]);
    return { grid, cols: g.cols, rows: g.rows };
}

/** Standard editor for labelled 2D points: drag, click to add the selected class, double-click to delete. */
export function classEditor(plot, ctx, getPts, { onChange, info, hover } = {}) {
    return pointEditor(plot, ctx, {
        points: getPts,
        spawn: (x, y) => { const p = { x, y, c: ctx.spawnClass, test: false, spawned: true }; getPts().push(p); return p; },
        remove: (p) => { const a = getPts(); const i = a.indexOf(p); if (i >= 0) a.splice(i, 1); },
        color: (p) => ctx.colors().c[p.c],
        changed: (kind, p) => { onChange && onChange(kind, p); ctx.changed(); },
        info,
        hover,
    });
}

export const accMetric = (k, v) => ({ k, v: pct(v), cls: v >= 0.95 ? 'good' : '' });
export { fmt, pct };
