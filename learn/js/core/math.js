// Small numeric helpers shared by the lessons. Everything is plain arrays so it is easy to read.

export function rng(seed = 1) {
    let a = seed >>> 0;
    const r = () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.gauss = () => {
        let u = 0, v = 0;
        while (u === 0) u = r();
        while (v === 0) v = r();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return r;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Solve A x = b (A is n×n, copied) with partial pivoting. Returns null if singular. */
export function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        if (Math.abs(M[p][c]) < 1e-12) return null;
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = c + 1; r < n; r++) {
            const f = M[r][c] / M[c][c];
            if (f === 0) continue;
            for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let s = M[r][n];
        for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
        x[r] = s / M[r][r];
    }
    return x;
}

/** Least squares with a tiny ridge for stability: rows of features F, targets y. */
export function lstsq(F, y, ridge = 1e-8) {
    const d = F[0].length;
    const A = Array.from({ length: d }, () => new Array(d).fill(0));
    const b = new Array(d).fill(0);
    for (let i = 0; i < F.length; i++) {
        const f = F[i];
        for (let j = 0; j < d; j++) {
            b[j] += f[j] * y[i];
            for (let k = j; k < d; k++) A[j][k] += f[j] * f[k];
        }
    }
    for (let j = 0; j < d; j++) { for (let k = 0; k < j; k++) A[j][k] = A[k][j]; A[j][j] += ridge; }
    return solve(A, b) || new Array(d).fill(0);
}

/** Eigen-decomposition of a symmetric 3×3 (or n×n) matrix by Jacobi rotations. Sorted descending. */
export function eigSym(S) {
    const n = S.length;
    const A = S.map((r) => r.slice());
    const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 60; sweep++) {
        let off = 0;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
        if (off < 1e-18) break;
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
            if (Math.abs(A[p][q]) < 1e-15) continue;
            const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
            const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
            const c = 1 / Math.sqrt(t * t + 1), s = t * c;
            for (let k = 0; k < n; k++) {
                const akp = A[k][p], akq = A[k][q];
                A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
            }
            for (let k = 0; k < n; k++) {
                const apk = A[p][k], aqk = A[q][k];
                A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
            }
            for (let k = 0; k < n; k++) {
                const vkp = V[k][p], vkq = V[k][q];
                V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
            }
        }
    }
    const out = [];
    for (let i = 0; i < n; i++) out.push({ value: A[i][i], vector: V.map((r) => r[i]) });
    out.sort((a, b) => b.value - a.value);
    return out;
}

/**
 * Marching squares: values is a Float32Array of (cols+1)×(rows+1) corner samples (row-major).
 * Returns line segments in grid units [x1, y1, x2, y2] where the field crosses `level`.
 */
export function contour(values, cols, rows, level = 0) {
    const segs = [];
    const W = cols + 1;
    const at = (i, j) => values[j * W + i] - level;
    const interp = (a, b) => (Math.abs(a - b) < 1e-12 ? 0.5 : a / (a - b));
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        let code = 0;
        if (a > 0) code |= 1; if (b > 0) code |= 2; if (c > 0) code |= 4; if (d > 0) code |= 8;
        if (code === 0 || code === 15) continue;
        const top = [i + interp(a, b), j], right = [i + 1, j + interp(b, c)];
        const bottom = [i + interp(d, c), j + 1], left = [i, j + interp(a, d)];
        const add = (p, q) => segs.push([p[0], p[1], q[0], q[1]]);
        switch (code) {
            case 1: case 14: add(left, top); break;
            case 2: case 13: add(top, right); break;
            case 3: case 12: add(left, right); break;
            case 4: case 11: add(right, bottom); break;
            case 6: case 9: add(top, bottom); break;
            case 7: case 8: add(left, bottom); break;
            case 5: add(left, top); add(right, bottom); break;
            case 10: add(top, right); add(left, bottom); break;
        }
    }
    return segs;
}

export function hexToRgb(hex) {
    hex = hex.trim().replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Sequential colormap for loss surfaces: deep blue → cyan → sand → coral (readable for CVD). */
const RAMP = ['#14215c', '#1f5fae', '#1fb5d6', '#8fe3c8', '#fde68a', '#fb9a5b', '#ef4f4f'].map(hexToRgb);
export function ramp(t) {
    t = clamp(t, 0, 1) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
    const a = RAMP[i], b = RAMP[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function fmt(v, d = 3) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1);
    return (+v.toFixed(d)).toString();
}
export const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '—');
