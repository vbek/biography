import { CLASS_SETS, classification } from '../core/data.js';
import { paintField, rgba } from '../core/plot2d.js';
import { solve, contour, hexToRgb, fmt, pct, clamp, ease } from '../core/math.js';
import { THREE, halo } from '../core/scene3d.js';
import { classEditor, swatch } from './common.js';

const S = 2.4;   // 3D: horizontal scale
const H = 1.6;   // 3D: lift height scale
const CAM_TOP = [0, 9.5, 0.001];
const CAM_SIDE = [5.6, 3.6, 6.2];

export default {
    views: [{ id: '2d', label: '2D' }, { id: '3d', label: '3D' }],
    datasets: CLASS_SETS,
    defaultDataset: 'circles',
    classes: 2,
    hint: 'Press “Lift to 3D” · drag points · click to add',
    params: [
        { key: 'lift', label: 'Lift amount t', py: 'lift', type: 'range', min: 0, max: 1, step: 0.01, value: 0, help: 'Adds a third feature z = t·(x² + y²). At 0 the data is flat; at 1 it sits on a bowl.' },
        { key: 'C', label: 'C (strictness)', py: 'C', type: 'range', log: true, min: 0.01, max: 100, step: 0.01, value: 1, digits: 2, help: 'High C punishes every point inside the margin: narrow margin, fewer support vectors. Low C tolerates mistakes for a wider, calmer margin.' },
        { key: 'margins', label: 'Margin lines', type: 'toggle', value: true, group: 'Display' },
    ],
    actions: [{ id: 'lift', label: 'Lift to 3D ▲' }, { id: 'drop', label: 'Flatten ▼', secondary: true }],
    presets: [
        { label: 'Flat (no kernel)', values: { lift: 0 } },
        { label: 'Fully lifted', values: { lift: 1 } },
        { label: 'Soft margin', values: { C: 0.05 } },
        { label: 'Hard margin', values: { C: 100 } },
    ],
    legend: `<span><i style="background:var(--c0)"></i>class −1</span><span><i style="background:var(--c1)"></i>class +1</span><span>Dashed rings = support vectors</span><span><i style="background:var(--c2)"></i>decision boundary</span>`,
    how: 'A linear SVM can only draw straight lines. Press <b>Lift to 3D</b>: each point rises by its squared distance from the centre, <b>z = x² + y²</b>. The inner circle stays low, the outer ring rises, and a flat plane can now slice between them. Back in 2D, that flat cut becomes a circle.',
    challenges: [
        { id: 'lift', title: 'Separate the circles perfectly', hint: 'On Circles, a straight line can only get about half the points right. Press “Lift to 3D” (or slide the lift to 1) and reach 100% accuracy.', check: (s, P) => s.dataset === 'circles' && P.lift >= 0.99 && s.acc === 1 },
        { id: 'soft', title: 'Widen the margin', hint: 'After lifting, lower C. The margin (dashed lines) widens and more points fall inside it and become support vectors. Get 100 or more support vectors.', check: (s, P) => P.lift >= 0.99 && s.sv >= 100 },
        { id: 'orbit', title: 'Orbit around the lifted data', hint: 'After lifting, drag on the 3D view to swing the camera around. Look along the plane edge-on to see the gap between the classes.', check: (s, P) => s.view === '3d' && P.lift >= 0.99 && s.orbited },
    ],
    code: String.raw`# The kernel trick by hand: lift 2D points into 3D, then fit a flat plane
# X, y -> the points on the canvas (y is 0 or 1)
import numpy as np
from sklearn.svm import SVC

lift = 0.0   # 0 = flat data, 1 = full lift  z = x^2 + y^2
C = 1.0      # strictness: high C = narrow margin

def phi(P):
    """(x, y) -> (x, y, lift * (x^2 + y^2))"""
    x, y2 = P[:, 0], P[:, 1]
    return np.column_stack([x, y2, lift * (x**2 + y2**2)])

model = SVC(kernel="linear", C=C).fit(phi(X), y)
print("accuracy       :", round(model.score(phi(X), y), 3))
print("support vectors:", len(model.support_))
print("plane weights  :", np.round(model.coef_[0], 3), "bias", round(float(model.intercept_[0]), 3))

# The shortcut: SVC(kernel="rbf") or kernel="poly" does a lift like this
# implicitly, without ever building the 3D points.

result = {"w": model.coef_[0], "b": model.intercept_[0], "support": model.support_}
`,
    explain: String.raw`
<h3>The idea</h3>
<p>A <b>support vector machine</b> draws the straight line that separates two classes with the widest possible gap, or <b>margin</b>. Only the points on the edge of the gap, the <b>support vectors</b>, decide where the line goes.</p>
<p>The decision rule is the sign of a linear function:</p>
<div class="eq">f(\mathbf{x}) = \mathbf{w}\cdot\mathbf{x} + b, \qquad \text{class} = \operatorname{sign} f(\mathbf{x})</div>
<p>The margin lines are <span class="tx">f = \pm 1</span>, so the gap is <span class="tx">2/\lVert\mathbf{w}\rVert</span> wide. Training trades a wide gap against points that violate it:</p>
<div class="eq">\min_{\mathbf{w},b}\ \tfrac12\lVert\mathbf{w}\rVert^2 + C\sum_i \max\big(0,\ 1 - y_i f(\mathbf{x}_i)\big)^2</div>
<h3>When a line is not enough</h3>
<p>No straight line separates a ring of <span class="t1">red</span> points around a core of <span class="t0">cyan</span> ones. So we add a feature. Map each point up into 3D:</p>
<div class="eq">\phi(x, y) = \big(x,\ y,\ x^2 + y^2\big)</div>
<p>Points near the centre stay low; the ring rises. Now a <b>flat plane</b> slices cleanly between them. Where that plane cuts the bowl is a circle, and that circle is the curved boundary you see back in 2D.</p>
<div class="callout">The model is still linear: it is linear in the lifted features. All the bending comes from the lift.</div>
<h3>The kernel trick</h3>
<p>The SVM only ever needs dot products between points, <span class="tx">\phi(\mathbf{a})\cdot\phi(\mathbf{b})</span>. A <b>kernel</b> computes that dot product directly, without building the lifted points. The RBF kernel <span class="tx">K(\mathbf{a},\mathbf{b}) = e^{-\gamma\lVert\mathbf{a}-\mathbf{b}\rVert^2}</span> corresponds to a lift into infinitely many dimensions.</p>
`,

    create(ctx) {
        const P = ctx.params;
        const plot = ctx.plot;
        const th = ctx.three;
        const st = { kind: 'circles', pts: [], w: [0, 0, 0], b: 0, liftTo: null, orbited: false, py: false, segs: [] };
        const sgn = (p) => (p.c === 1 ? 1 : -1);
        const phi = (x, y) => [x, y, P.lift * (x * x + y * y)];
        const fval = (x, y) => { const f = phi(x, y); return st.w[0] * f[0] + st.w[1] * f[1] + st.w[2] * f[2] + st.b; };

        /** Primal Newton for the L2-loss SVM (exact for this piecewise-quadratic objective). */
        function fit() {
            if (st.py) return;
            const pts = st.pts;
            let v = [...st.w, st.b];
            for (let it = 0; it < 40; it++) {
                const Hm = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1e-6]];
                const g = [v[0], v[1], v[2], 0];
                for (const p of pts) {
                    const f = [...phi(p.x, p.y), 1], s = sgn(p);
                    const out = f[0] * v[0] + f[1] * v[1] + f[2] * v[2] + v[3];
                    if (s * out >= 1) continue;
                    for (let a = 0; a < 4; a++) {
                        g[a] += 2 * P.C * (out - s) * f[a];
                        for (let c = 0; c < 4; c++) Hm[a][c] += 2 * P.C * f[a] * f[c];
                    }
                }
                const d = solve(Hm, g);
                if (!d) break;
                v = v.map((x, i) => x - d[i]);
                if (Math.hypot(...d) < 1e-9) break;
            }
            st.w = v.slice(0, 3); st.b = v[3];
            buildContours();
        }
        const svs = () => st.pts.filter((p) => sgn(p) * fval(p.x, p.y) <= 1 + 1e-6);
        const accuracy = () => st.pts.length ? st.pts.filter((p) => sgn(p) * fval(p.x, p.y) > 0).length / st.pts.length : NaN;

        function buildContours() {
            const [x0, x1, y0, y1] = [-1.6, 1.6, -1.6, 1.6];
            const n = 110, vals = new Float32Array((n + 1) * (n + 1));
            for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) vals[j * (n + 1) + i] = fval(x0 + ((x1 - x0) * i) / n, y1 - ((y1 - y0) * j) / n);
            const conv = (s) => [x0 + ((x1 - x0) * s[0]) / n, y1 - ((y1 - y0) * s[1]) / n, x0 + ((x1 - x0) * s[2]) / n, y1 - ((y1 - y0) * s[3]) / n];
            st.segs = contour(vals, n, n, 0).map(conv);
            st.mPlus = contour(vals, n, n, 1).map(conv);
            st.mMinus = contour(vals, n, n, -1).map(conv);
            st.fieldDirty = true;
        }

        const editor = classEditor(plot, ctx, () => st.pts, {
            onChange: () => { st.py = false; ctx.pyCleared(); fit(); },
            info: (p) => {
                const C = ctx.colors(), f = fval(p.x, p.y), z = P.lift * (p.x * p.x + p.y * p.y);
                return `${swatch(C.c[p.c])}<span class="k">class ${sgn(p) > 0 ? '+1' : '−1'}${sgn(p) * f <= 1 + 1e-6 ? ' · support vector' : ''}</span><br>(x, y) = (${fmt(p.x, 2)}, ${fmt(p.y, 2)}) → z = <b>${fmt(z, 2)}</b><br>f(x) = <b>${fmt(f, 2)}</b>`;
            },
        });

        let field = null;
        function draw2d() {
            const C = ctx.colors();
            const g = plot.begin(C);
            if (!field || st.fieldDirty || field.v !== plot.version) {
                const grid = plot.sampleGrid(110);
                const a = hexToRgb(C.c[0]), b = hexToRgb(C.c[1]);
                field = { v: plot.version, img: paintField(grid.cols, grid.rows, (i, j, k) => {
                    const f = fval(grid.pts[2 * k], grid.pts[2 * k + 1]);
                    const col = f > 0 ? b : a;
                    const inMargin = Math.abs(f) < 1;
                    return [col[0], col[1], col[2], inMargin ? 40 : 30 + 70 * Math.min(1, (Math.abs(f) - 1) / 2.5)];
                }) };
                st.fieldDirty = false;
            }
            const hideB = ctx.hidden('boundary');
            if (!hideB) plot.field(field.img);
            plot.grid({ labels: false });
            const line = (segs) => { g.beginPath(); for (const s of segs) { g.moveTo(plot.sx(s[0]), plot.sy(s[1])); g.lineTo(plot.sx(s[2]), plot.sy(s[3])); } g.stroke(); };
            if (P.margins && !hideB) {
                g.setLineDash([6, 5]); g.lineWidth = 1.5;
                g.strokeStyle = rgba(C.c[1], 0.9); line(st.mPlus);
                g.strokeStyle = rgba(C.c[0], 0.9); line(st.mMinus);
                g.setLineDash([]);
            }
            if (!hideB) { g.save(); g.shadowColor = C.c[2]; g.shadowBlur = 14; g.strokeStyle = C.c[2]; g.lineWidth = 3; line(st.segs); g.restore(); }
            const sv = new Set(svs());
            for (const p of st.pts) {
                plot.point(p.x, p.y, C.c[p.c], { hot: p === editor.hot });
                if (sv.has(p) && !hideB) { g.setLineDash([3, 3]); g.strokeStyle = C.text; g.lineWidth = 1.3; g.beginPath(); g.arc(plot.sx(p.x), plot.sy(p.y), 9.5, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
            }
            plot.drawRipples();
        }

        // ---------- 3D ----------
        let T = null;
        const w3 = (x, y, z) => new THREE.Vector3(x * S, z * H, -y * S);
        function build3d() {
            const scene = th.newScene({ size: 8, camera: CAM_SIDE, target: [0, 0.8, 0] });
            th.grid.position.y = -0.01;
            const sg = new THREE.SphereGeometry(0.065, 16, 12);
            const mats = [0x22d3ee, 0xff6b57].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, roughness: 0.35 }));
            const balls = st.pts.map((p) => { const m = new THREE.Mesh(sg, mats[p.c]); m.userData.p = p; scene.add(m); return m; });
            const svRing = new THREE.TorusGeometry(0.11, 0.012, 6, 24);
            const svMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
            const rings = st.pts.map(() => { const r = new THREE.Mesh(svRing, svMat); scene.add(r); return r; });
            // the bowl z = t(x^2 + y^2), as a faint wireframe
            const bowlG = new THREE.PlaneGeometry(3.2 * S, 3.2 * S, 28, 28); bowlG.rotateX(-Math.PI / 2);
            const bowl = new THREE.Mesh(bowlG, new THREE.MeshBasicMaterial({ color: 0x818cf8, wireframe: true, transparent: true, opacity: 0.16 }));
            scene.add(bowl);
            // separating plane, clipped to a box
            const box = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 1.7 * S), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1.7 * S),
                new THREE.Plane(new THREE.Vector3(0, 0, 1), 1.7 * S), new THREE.Plane(new THREE.Vector3(0, 0, -1), 1.7 * S),
                new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.02), new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.6 * H)];
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.25, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: box }));
            const planeEdge = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 40, 40), new THREE.MeshBasicMaterial({ color: 0xfbbf24, wireframe: true, transparent: true, opacity: 0.12, clippingPlanes: box }));
            scene.add(plane, planeEdge);
            const curveG = new THREE.BufferGeometry();
            const curve = new THREE.LineSegments(curveG, new THREE.LineBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending }));
            scene.add(curve);
            const shadowG = new THREE.BufferGeometry();
            const shadow = new THREE.LineSegments(shadowG, new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.6 }));
            scene.add(shadow);
            T = { balls, rings, bowl, bowlG, plane, planeEdge, curveG, shadowG, shadow, n: st.pts.length };
        }
        function draw3d() {
            if (!T || T.n !== st.pts.length) build3d();
            const t = P.lift;
            const sv = new Set(svs());
            T.balls.forEach((m, i) => {
                const p = st.pts[i];
                m.userData.p = p;
                m.position.copy(w3(p.x, p.y, t * (p.x * p.x + p.y * p.y)));
                T.rings[i].visible = sv.has(p) && !ctx.hidden('boundary');
                T.rings[i].position.copy(m.position);
                T.rings[i].quaternion.copy(th.camera.quaternion);
            });
            const pos = T.bowlG.attributes.position;
            for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / S, y = -pos.getZ(i) / S; pos.setY(i, Math.min(2.6, t * (x * x + y * y)) * H); }
            pos.needsUpdate = true;
            T.bowl.visible = t > 0.01;
            // plane w·φ + b = 0 in world coordinates
            const n = new THREE.Vector3(st.w[0] / S, st.w[2] / H, -st.w[1] / S);
            const len = n.length();
            if (len > 1e-9) {
                const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
                const o = n.clone().multiplyScalar(-st.b / (len * len));
                for (const m of [T.plane, T.planeEdge]) { m.quaternion.copy(q); m.position.copy(o); m.visible = !ctx.hidden('boundary'); }
            } else { T.plane.visible = T.planeEdge.visible = false; }
            // boundary drawn on the bowl, and its shadow on the floor
            const cs = [], ss = [];
            for (const s of ctx.hidden('boundary') ? [] : st.segs) {
                const a = w3(s[0], s[1], t * (s[0] ** 2 + s[1] ** 2)), b = w3(s[2], s[3], t * (s[2] ** 2 + s[3] ** 2));
                cs.push(a.x, a.y, a.z, b.x, b.y, b.z);
                ss.push(a.x, 0.01, a.z, b.x, 0.01, b.z);
            }
            T.curveG.setAttribute('position', new THREE.Float32BufferAttribute(cs, 3));
            T.shadowG.setAttribute('position', new THREE.Float32BufferAttribute(ss, 3));
            T.shadow.computeLineDistances();
        }
        th.on('hover', (e) => {
            if (ctx.view !== '3d' || !T) return;
            const hit = th.pick(T.balls, e)[0];
            if (!hit) return ctx.tooltip.hide();
            const p = hit.object.userData.p, z = P.lift * (p.x * p.x + p.y * p.y);
            ctx.tooltip.show(e.clientX, e.clientY - 8, `<span class="k">class ${sgn(p) > 0 ? '+1' : '−1'}</span><br>φ = (${fmt(p.x, 2)}, ${fmt(p.y, 2)}, <b>${fmt(z, 2)}</b>)<br>f = <b>${fmt(fval(p.x, p.y), 2)}</b>`);
        });
        th.on('leave', () => ctx.tooltip.hide());

        function load(kind) {
            st.kind = kind;
            st.pts = classification(kind, { n: 150, seed: 17, classes: 2, noise: kind === 'moons' ? 1.2 : 1 });
            st.pts.forEach((p) => { p.test = false; });
            st.py = false; st.w = [0, 0, 0]; st.b = 0;
            T = null;
            fit();
        }
        function animateLift(to) {
            st.liftTo = to; st.liftFrom = P.lift; st.liftT0 = performance.now();
            st.py = false; ctx.pyCleared();
            if (to > 0.5 && ctx.view !== '3d') {
                ctx.setView('3d');
                th.camera.position.set(...CAM_TOP); th.controls.target.set(0, 0, 0); th.controls.update();
            }
            th.tweenCamera(to > 0.5 ? CAM_SIDE : CAM_TOP, [0, to > 0.5 ? 0.8 : 0, 0], 1800);
            th.orbited = false; st.orbitArm = performance.now() + 1900;
        }

        load('circles');

        return {
            setParam() { st.py = false; fit(); },
            setDataset(kind) { load(kind); },
            setView(v) { if (v === '3d' && !T) build3d(); },
            action(id) { animateLift(id === 'lift' ? 1 : 0); },
            frame() {
                if (st.liftTo != null) {
                    const k = Math.min(1, (performance.now() - st.liftT0) / 1700);
                    P.lift = +(st.liftFrom + (st.liftTo - st.liftFrom) * ease(k)).toFixed(3);
                    fit();
                    if (k >= 1) { const to = st.liftTo; st.liftTo = null; P.lift = -1; ctx.set('lift', to); P.lift = to; fit(); if (to === 0) ctx.setView('2d'); }
                }
                if (st.orbitArm && performance.now() > st.orbitArm) { th.orbited = false; st.orbitArm = 0; }
                if (ctx.view === '3d') draw3d(); else draw2d();
            },
            metrics() {
                const a = accuracy(), w = Math.hypot(...st.w);
                return [{ k: 'Accuracy', v: pct(a), cls: a === 1 ? 'good' : '' }, { k: 'Support vectors', v: svs().length }, { k: 'Margin', v: w > 1e-9 ? fmt(2 / w, 3) : '∞' }, { k: 'Lift t', v: (+P.lift).toFixed(2) }];
            },
            state() { return { acc: accuracy(), sv: svs().length, orbited: !!th.orbited && !st.orbitArm && st.liftTo == null }; },
            pyData() { return { X: st.pts.map((p) => [p.x, p.y]), y: st.pts.map((p) => p.c) }; },
            onPython(r) {
                if (!r || !r.w) throw new Error('expected result = {"w": ..., "b": ...}');
                st.w = r.w.slice(0, 3); while (st.w.length < 3) st.w.push(0);
                st.b = r.b || 0; st.py = true;
                buildContours();
                return `Python: SVC(kernel="linear"), ${r.support ? r.support.length : '?'} support vectors`;
            },
            clearPython() { if (st.py) { st.py = false; fit(); } },
            destroy() { editor.destroy(); },
        };
    },
};
