// Toy datasets. Coordinates live roughly in [-1, 1] so every lesson can share the same plot bounds.
import { rng } from './math.js';

// "New random points" shifts every seed; "Spread" scales the random scatter. Reset when a lesson opens.
const opts = { shift: 0, noise: 1 };
export function setDataOptions(o) { Object.assign(opts, o); }

export const CLASS_SETS = [
    { id: 'linear', label: 'Linear' },
    { id: 'blobs', label: 'Blobs' },
    { id: 'circles', label: 'Circles' },
    { id: 'moons', label: 'Moons' },
];

/** Points {x, y, c} for classification. `classes` caps blobs at 2 for binary-only lessons. */
export function classification(kind, { n = 140, seed = 7, noise = 1, classes = 3 } = {}) {
    noise *= opts.noise;
    const r = rng(seed + opts.shift);
    const g = () => r.gauss();
    const pts = [];
    if (kind === 'linear') {
        for (let i = 0; i < n; i++) {
            const c = i % 2;
            const s = c ? 1 : -1;
            const t = (r() * 2 - 1) * 0.85;
            pts.push({ x: t * 0.8 + s * 0.32 + g() * 0.13 * noise, y: -t * 0.55 + s * 0.38 + g() * 0.13 * noise, c });
        }
    } else if (kind === 'blobs') {
        const k = Math.max(2, classes);
        const centers = k === 2 ? [[-0.45, -0.3], [0.45, 0.35]] : Array.from({ length: k }, (_, j) => {
            const a = -Math.PI / 2 + (j * 2 * Math.PI) / k + 0.3;
            return [Math.cos(a) * 0.55, Math.sin(a) * 0.55];
        });
        for (let i = 0; i < n; i++) {
            const c = i % k;
            pts.push({ x: centers[c][0] + g() * 0.17 * noise, y: centers[c][1] + g() * 0.17 * noise, c });
        }
    } else if (kind === 'circles') {
        for (let i = 0; i < n; i++) {
            const c = i % 2;
            const a = r() * Math.PI * 2;
            const rad = (c ? 0.36 : 0.86) + g() * 0.06 * noise;
            pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, c });
        }
    } else { // moons
        for (let i = 0; i < n; i++) {
            const c = i % 2;
            const t = r() * Math.PI;
            let x, y;
            if (c === 0) { x = Math.cos(t); y = Math.sin(t); } else { x = 1 - Math.cos(t); y = 0.5 - Math.sin(t); }
            pts.push({ x: (x - 0.5) * 0.78 + g() * 0.07 * noise, y: (y - 0.25) * 0.95 + g() * 0.07 * noise, c });
        }
    }
    return markTest(pts, 0.25, seed + 11);
}

/** Flags a fraction of points as held-out test data (drawn hollow). */
export function markTest(pts, frac = 0.25, seed = 3) {
    const r = rng(seed + opts.shift);
    for (const p of pts) p.test = r() < frac;
    return pts;
}

export const REG_SETS = [
    { id: 'linear', label: 'Linear' },
    { id: 'noisy', label: 'Noisy' },
    { id: 'outlier', label: 'Outlier' },
    { id: 'curve', label: 'Curve' },
];

/** Points {x, y} for 1-feature regression. */
export function regression(kind, { n = 26, seed = 5 } = {}) {
    const r = rng(seed + opts.shift);
    const pts = [];
    for (let i = 0; i < n; i++) {
        const x = -0.95 + (1.9 * (i + r() * 0.8)) / n;
        let y;
        if (kind === 'curve') y = 0.62 * Math.sin(2.4 * x) + 0.1 + r.gauss() * 0.09 * opts.noise;
        else if (kind === 'noisy') y = 0.55 * x + 0.05 + r.gauss() * 0.26 * opts.noise;
        else y = 0.6 * x + 0.08 + r.gauss() * 0.1 * opts.noise;
        pts.push({ x, y });
    }
    if (kind === 'outlier') { pts[Math.floor(n * 0.8)].y = -0.85; pts[Math.floor(n * 0.15)].y = 0.9; }
    return markTest(pts, 0.3, seed + 2);
}

/** Points {x1, x2, y} for a 2-feature plane fit. */
export function regression3d(kind, { n = 34, seed = 9 } = {}) {
    const r = rng(seed + opts.shift);
    const pts = [];
    const noise = (kind === 'noisy' ? 0.28 : 0.09) * opts.noise;
    for (let i = 0; i < n; i++) {
        const x1 = r() * 1.9 - 0.95, x2 = r() * 1.9 - 0.95;
        let y = 0.45 * x1 - 0.35 * x2 + 0.1 + r.gauss() * noise;
        if (kind === 'curve') y = 0.5 * Math.sin(2.2 * x1) + 0.3 * x2 * x2 - 0.1 + r.gauss() * 0.06 * opts.noise;
        pts.push({ x1, x2, y });
    }
    if (kind === 'outlier') pts[3].y = 1.1;
    return markTest(pts, 0.3, seed + 4);
}

export const CLUSTER_SETS = [
    { id: 'blobs', label: 'Blobs' },
    { id: 'circles', label: 'Circles' },
    { id: 'moons', label: 'Moons' },
    { id: 'uniform', label: 'Uniform' },
];
export const TRUE_BLOBS = 4;

/** 3D points {x, y, z, t} (t = true group) for clustering. The 2D view only uses x and y. */
export function clusters(kind, { n = 220, seed = 21 } = {}) {
    const r = rng(seed + opts.shift);
    const g = () => r.gauss() * opts.noise;
    const pts = [];
    if (kind === 'blobs') {
        const C = [[-0.55, 0.5, 0.35], [0.55, 0.55, -0.4], [0.5, -0.5, 0.45], [-0.5, -0.45, -0.4]];
        const sd = [0.15, 0.13, 0.18, 0.12];
        for (let i = 0; i < n; i++) { const t = i % 4; pts.push({ x: C[t][0] + g() * sd[t], y: C[t][1] + g() * sd[t], z: C[t][2] + g() * sd[t], t }); }
    } else if (kind === 'circles') {
        for (let i = 0; i < n; i++) {
            const t = i % 2, a = r() * Math.PI * 2, rad = (t ? 0.35 : 0.85) + g() * 0.05;
            pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, z: g() * 0.12 + (t ? 0.25 : -0.25), t });
        }
    } else if (kind === 'moons') {
        for (const p of classification('moons', { n, seed })) pts.push({ x: p.x, y: p.y, z: g() * 0.12 + (p.c ? 0.2 : -0.2), t: p.c });
    } else {
        for (let i = 0; i < n; i++) pts.push({ x: r() * 1.8 - 0.9, y: r() * 1.8 - 0.9, z: r() * 1.6 - 0.8, t: 0 });
    }
    return pts;
}

export const PCA_SETS = [
    { id: 'pancake', label: 'Pancake' },
    { id: 'cigar', label: 'Cigar' },
    { id: 'ball', label: 'Ball' },
    { id: 'swirl', label: 'Swirl' },
];

/** 3D cloud for PCA. `thick` (0..1) controls how far it spreads along the weakest direction. */
export function pcaCloud(kind, { n = 260, seed = 31, thick = 0.25 } = {}) {
    const r = rng(seed + opts.shift);
    const g = () => r.gauss();
    const raw = [];
    for (let i = 0; i < n; i++) {
        let a, b, c;
        if (kind === 'pancake') { a = g() * 0.62; b = g() * 0.34; c = g() * (0.03 + thick * 0.3); }
        else if (kind === 'cigar') { a = g() * 0.7; b = g() * (0.05 + thick * 0.25); c = g() * (0.04 + thick * 0.2); }
        else if (kind === 'ball') { a = g() * 0.4; b = g() * 0.38; c = g() * (0.3 + thick * 0.08); }
        else { const t = r() * 3 * Math.PI; a = Math.cos(t) * t * 0.07; b = (r() - 0.5) * 0.9; c = Math.sin(t) * t * 0.07 + g() * thick * 0.08; }
        raw.push([a, b, c]);
    }
    // rotate so the principal axes are not aligned with x/y/z
    const R = rotation(0.6, -0.45, 0.35);
    return raw.map((v) => {
        const p = [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
        return { x: p[0] + 0.05, y: p[1] + 0.1, z: p[2] - 0.05 };
    });
}

function rotation(ax, ay, az) {
    const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
    const X = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]], Y = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], Z = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
    const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
    return mul(Z, mul(Y, X));
}
