// Crisp, DPR-aware 2D plot with equal-aspect world coordinates, ripples, and a reusable point editor.
import { easeOut, hexToRgb } from './math.js';

export class Plot2D {
    constructor(canvas, { bounds = [-1.25, 1.25, -1.25, 1.25] } = {}) {
        this.canvas = canvas;
        this.g = canvas.getContext('2d');
        this.bounds = bounds;
        this.ripples = [];
        this.handlers = {};
        this.w = 1; this.h = 1; this.dpr = 1;
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(canvas);
        this.resize();
        this._bind();
    }
    resize() {
        const r = this.canvas.getBoundingClientRect();
        this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
        this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
        this.canvas.width = Math.round(this.w * this.dpr);
        this.canvas.height = Math.round(this.h * this.dpr);
        const [x0, x1, y0, y1] = this.bounds;
        const pad = Math.min(34, this.w / 8, this.h / 8);
        // never let the scale collapse (a hidden or tiny canvas would make the visible world infinite)
        this.scale = Math.max(4, Math.min((this.w - pad * 2) / (x1 - x0), (this.h - pad * 2) / (y1 - y0)));
        this.cx = this.w / 2 - ((x0 + x1) / 2) * this.scale;
        this.cy = this.h / 2 + ((y0 + y1) / 2) * this.scale;
        this.version = (this.version || 0) + 1;
        this.emit('resize');
    }
    sx(x) { return this.cx + x * this.scale; }
    sy(y) { return this.cy - y * this.scale; }
    wx(px) { return (px - this.cx) / this.scale; }
    wy(py) { return (this.cy - py) / this.scale; }
    /** World rectangle currently visible (whole canvas, not just the bounds). */
    view() { return [this.wx(0), this.wx(this.w), this.wy(this.h), this.wy(0)]; }

    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return () => { this.handlers[ev] = this.handlers[ev].filter((f) => f !== fn); }; }
    emit(ev, ...a) { let r; for (const f of this.handlers[ev] || []) { const v = f(...a); if (v) r = v; } return r; }

    _bind() {
        const c = this.canvas;
        let down = null;
        const pos = (e) => { const r = c.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; return { px, py, x: this.wx(px), y: this.wy(py), e }; };
        c.addEventListener('pointerdown', (e) => {
            if (e.button > 0) return;
            const p = pos(e);
            down = { ...p, t: performance.now(), captured: !!this.emit('down', p), moved: false };
            c.setPointerCapture(e.pointerId);
        });
        c.addEventListener('pointermove', (e) => {
            const p = pos(e);
            if (down) {
                if (Math.hypot(p.px - down.px, p.py - down.py) > 4) down.moved = true;
                if (down.captured) this.emit('drag', p);
            }
            this.emit('hover', p);
        });
        const up = (e) => {
            if (!down) return;
            const p = pos(e);
            if (down.captured) this.emit('up', p);
            else if (!down.moved) this.emit('click', p);
            down = null;
        };
        c.addEventListener('pointerup', up);
        c.addEventListener('pointercancel', up);
        c.addEventListener('pointerleave', () => { if (!down) this.emit('leave'); });
        c.addEventListener('dblclick', (e) => this.emit('dblclick', pos(e)));
    }

    begin(colors) {
        const g = this.g;
        g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        g.clearRect(0, 0, this.w, this.h);
        this.colors = colors;
        return g;
    }

    grid({ step = 0.25, axes = true, labels = true } = {}) {
        const g = this.g, C = this.colors;
        const [vx0, vx1, vy0, vy1] = this.view();
        g.lineWidth = 1;
        g.strokeStyle = C.grid;
        g.beginPath();
        if ((vx1 - vx0) / step > 400) step = (vx1 - vx0) / 400;
        for (let x = Math.ceil(vx0 / step) * step; x <= vx1; x += step) { const X = Math.round(this.sx(x)) + 0.5; g.moveTo(X, 0); g.lineTo(X, this.h); }
        for (let y = Math.ceil(vy0 / step) * step; y <= vy1; y += step) { const Y = Math.round(this.sy(y)) + 0.5; g.moveTo(0, Y); g.lineTo(this.w, Y); }
        g.stroke();
        if (axes) {
            g.strokeStyle = C.axis; g.beginPath();
            const X = Math.round(this.sx(0)) + 0.5, Y = Math.round(this.sy(0)) + 0.5;
            g.moveTo(X, 0); g.lineTo(X, this.h); g.moveTo(0, Y); g.lineTo(this.w, Y); g.stroke();
        }
        if (labels) {
            g.fillStyle = C.faint; g.font = '10.5px ' + C.mono; g.textAlign = 'center'; g.textBaseline = 'top';
            for (let x = -1; x <= 1; x += 0.5) if (x) g.fillText(x.toFixed(1), this.sx(x), this.sy(0) + 5);
            g.textAlign = 'right'; g.textBaseline = 'middle';
            for (let y = -1; y <= 1; y += 0.5) if (y) g.fillText(y.toFixed(1), this.sx(0) - 6, this.sy(y));
        }
    }

    /** Draws an offscreen field image (cols×rows) stretched over the visible world rect. */
    field(img) { const g = this.g; g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, this.w, this.h); g.restore(); }

    /** Grid of sample centres covering the whole canvas, `cols` across. */
    sampleGrid(cols) {
        const [x0, x1, y0, y1] = this.view();
        const rows = Math.max(2, Math.round(cols * (this.h / this.w)));
        const pts = new Float32Array(cols * rows * 2);
        let k = 0;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            pts[k++] = x0 + ((i + 0.5) / cols) * (x1 - x0);
            pts[k++] = y1 - ((j + 0.5) / rows) * (y1 - y0);
        }
        return { cols, rows, pts };
    }

    addRipple(x, y, color) { this.ripples.push({ x, y, color, t0: performance.now() }); }
    drawRipples() {
        const g = this.g, now = performance.now();
        this.ripples = this.ripples.filter((r) => now - r.t0 < 700);
        for (const r of this.ripples) {
            const t = (now - r.t0) / 700, e = easeOut(t);
            g.strokeStyle = r.color; g.globalAlpha = 1 - t; g.lineWidth = 2.5 * (1 - t) + 0.5;
            g.beginPath(); g.arc(this.sx(r.x), this.sy(r.y), 6 + e * 28, 0, Math.PI * 2); g.stroke();
            g.globalAlpha = (1 - t) * 0.25; g.fillStyle = r.color;
            g.beginPath(); g.arc(this.sx(r.x), this.sy(r.y), 6 + e * 16, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
    }

    /** A data point: filled for training data, hollow ring for test data. */
    point(x, y, color, { r = 5.5, test = false, hot = false, alpha = 1 } = {}) {
        const g = this.g, X = this.sx(x), Y = this.sy(y);
        g.globalAlpha = alpha;
        if (hot) { g.fillStyle = color; g.globalAlpha = 0.22 * alpha; g.beginPath(); g.arc(X, Y, r + 7, 0, Math.PI * 2); g.fill(); g.globalAlpha = alpha; }
        g.beginPath(); g.arc(X, Y, r, 0, Math.PI * 2);
        if (test) { g.lineWidth = 2.2; g.strokeStyle = color; g.fillStyle = this.colors.bgSolid; g.fill(); g.stroke(); }
        else { g.fillStyle = color; g.fill(); g.lineWidth = 1.5; g.strokeStyle = this.colors.ring; g.stroke(); }
        g.globalAlpha = 1;
    }

    destroy() { this._ro.disconnect(); this.handlers = {}; }
}

/** Creates an RGBA field image from a callback giving [r,g,b,a] for each sample. */
export function paintField(cols, rows, fn) {
    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(cols, rows);
    const d = img.data;
    for (let j = 0, k = 0; j < rows; j++) for (let i = 0; i < cols; i++, k += 4) {
        const c = fn(i, j, j * cols + i);
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = c[3];
    }
    ctx.putImageData(img, 0, 0);
    return cv;
}

/**
 * Drag, spawn, delete and hover-inspect points on a Plot2D.
 * opts: points() → array of {x,y,...}; spawn(x,y) → new point or null; changed(kind); info(p) → html; hover(w|null)
 */
export function pointEditor(plot, ctx, opts) {
    let dragging = null;
    let hot = null;
    const hitR = 11;
    const find = (px, py) => {
        let best = null, bd = hitR;
        for (const p of opts.points()) {
            const d = Math.hypot(plot.sx(p.x) - px, plot.sy(p.y) - py);
            if (d < bd) { bd = d; best = p; }
        }
        return best;
    };
    const offs = [
        plot.on('down', (p) => {
            const extra = opts.grabExtra && opts.grabExtra(p);
            if (extra) { dragging = extra; plot.canvas.classList.add('grabbing'); return true; }
            const q = find(p.px, p.py);
            if (q && opts.draggable !== false) { dragging = q; plot.canvas.classList.add('grabbing'); ctx.tooltip.hide(); return true; }
            return false;
        }),
        plot.on('drag', (p) => {
            if (!dragging) return;
            const [x0, x1, y0, y1] = plot.view();
            dragging.x = Math.max(x0 + 0.02, Math.min(x1 - 0.02, p.x));
            dragging.y = Math.max(y0 + 0.02, Math.min(y1 - 0.02, p.y));
            opts.changed && opts.changed('drag', dragging);
        }),
        plot.on('up', () => {
            if (dragging) { opts.changed && opts.changed('dragend', dragging); }
            dragging = null; plot.canvas.classList.remove('grabbing');
        }),
        plot.on('click', (p) => {
            if (!opts.spawn) return;
            const q = opts.spawn(p.x, p.y);
            if (q) { plot.addRipple(q.x, q.y, opts.color ? opts.color(q) : ctx.colors().c0); opts.changed && opts.changed('spawn', q); }
        }),
        plot.on('dblclick', (p) => {
            if (!opts.remove) return;
            const q = find(p.px, p.py);
            if (q) { opts.remove(q); opts.changed && opts.changed('remove', q); }
        }),
        plot.on('hover', (p) => {
            const q = dragging || find(p.px, p.py);
            hot = q;
            plot.canvas.classList.toggle('grab', !!q && !dragging);
            if (opts.hover) opts.hover(p);
            if (q && opts.info) ctx.tooltip.showAt(plot.canvas, plot.sx(q.x), plot.sy(q.y), opts.info(q));
            else if (opts.hoverInfo) { const h = opts.hoverInfo(p); if (h) ctx.tooltip.showAt(plot.canvas, p.px, p.py - 4, h); else ctx.tooltip.hide(); }
            else ctx.tooltip.hide();
        }),
        plot.on('leave', () => { hot = null; ctx.tooltip.hide(); if (opts.hover) opts.hover(null); }),
    ];
    return {
        get hot() { return hot; },
        get dragging() { return dragging; },
        destroy() { offs.forEach((f) => f()); },
    };
}

export function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
