import { REG_SETS, regression, regression3d } from '../core/data.js';
import { pointEditor, rgba } from '../core/plot2d.js';
import { lstsq, fmt } from '../core/math.js';
import { THREE, halo } from '../core/scene3d.js';
import { swatch } from './common.js';

const S = 2.6;          // 3D: feature scale
const H = 1.35;         // 3D: target scale
const Y0 = 1.3;         // 3D: target offset so the floor sits under the data
const toY = (y) => (y + Y0) * H;

export default {
    views: [{ id: '2d', label: '2D' }, { id: '3d', label: '3D plane' }],
    datasets: REG_SETS,
    playback: { sps: 24 },
    hint: 'Drag points · click empty space to add · double-click to delete',
    params: [
        { key: 'degree', label: 'Polynomial degree', py: 'degree', type: 'range', min: 1, max: 12, step: 1, value: 1, help: '1 is a straight line. Higher degrees let the curve bend (2D view only).', visible: (P, cur) => cur.view === '2d' },
        { key: 'mode', label: 'How to fit', type: 'select', value: 'exact', options: [{ value: 'exact', label: 'Exact (least squares)' }, { value: 'gd', label: 'Gradient descent' }], help: 'Exact solves for the best line in one shot. Gradient descent walks there step by step: press Play.' },
        { key: 'lr', label: 'Learning rate', type: 'range', log: true, min: 0.001, max: 2.5, step: 0.001, value: 0.1, digits: 3, help: 'How big each gradient-descent step is. Too big and it overshoots.', visible: (P) => P.mode === 'gd' },
        { key: 'residuals', label: 'Residual lines', type: 'toggle', value: true, group: 'Display' },
        { key: 'squares', label: 'Squared-error boxes', type: 'toggle', value: false, group: 'Display', help: 'Each box has area = error². MSE is their average area.' },
    ],
    presets: [
        { label: 'Straight line', values: { degree: 1, mode: 'exact' }, view: '2d' },
        { label: 'Gentle curve', values: { degree: 3, mode: 'exact' }, dataset: 'curve', view: '2d' },
        { label: 'Wiggly overfit', values: { degree: 11, mode: 'exact' }, view: '2d' },
        { label: 'Watch it learn', values: { degree: 1, mode: 'gd', lr: 0.15 } },
    ],
    legend: `<span><i style="background:var(--c0)"></i>training point</span><span><i style="border:2px solid var(--c0)"></i>test point (unseen)</span><span><i style="background:var(--c3)"></i>model</span><span><i style="background:var(--c1)"></i>residual (error)</span>`,
    how: 'Grab any point and drag it: the fit updates instantly. Click empty space to add a point, double-click one to remove it. In <b>3D</b>, drag a ball up or down and orbit with the mouse.',
    challenges: [
        { id: 'overfit', title: 'Make the model overfit', hint: 'Raise the polynomial degree until the curve snakes through the filled points. You win when the test error (hollow points) is more than double the training error.', check: (s, P) => s.view === '2d' && P.degree >= 5 && s.trainMSE < 0.03 && s.testMSE > 2 * s.trainMSE },
        { id: 'overshoot', title: 'Cause the learning rate to overshoot', hint: 'Switch to Gradient descent, push the learning rate up past about 1, then press Play. Each step jumps past the bottom and the error explodes.', check: (s) => s.diverged },
        { id: 'tilt', title: 'Tilt the plane in 3D', hint: 'Open the 3D plane view and drag one of the balls up or down. The plane tilts to keep the total squared error as small as possible.', check: (s) => s.dragged3d },
    ],
    code: String.raw`# Linear regression with scikit-learn
# X and y are the points on the canvas:
#   2D view -> X has 1 column (x),  3D view -> X has 2 columns (x1, x2)
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures

degree = 1   # 1 = straight line; try 3 or 10 (2D view only)

if X.shape[1] == 1:
    # turn x into [x, x^2, ..., x^degree] so a "linear" model can bend
    features = PolynomialFeatures(degree, include_bias=False).fit_transform(X)
else:
    features = X   # 3D view: fit a flat plane over two features

model = LinearRegression().fit(features, y)

train_mse = np.mean((model.predict(features) - y) ** 2)
print("weights   :", np.round(model.coef_, 3))
print("intercept :", round(float(model.intercept_), 3))
print("train MSE :", round(float(train_mse), 4))

# Hand the fitted model back to the canvas
result = {"coef": model.coef_, "intercept": model.intercept_}
`,
    explain: String.raw`
<h3>The idea</h3>
<p>We want a <span class="t3">line</span> that passes as close as possible to the <span class="t0">points</span>. For each point, the vertical gap between the point and the line is its <span class="t1">residual</span>, the error the model makes there.</p>
<p>"Close" has a precise meaning: square every residual and take the average. That number is the <b>mean squared error</b> (MSE). The best-fit line is the one with the smallest MSE. Turn on <i>Squared-error boxes</i> to see it: MSE is the average area of the boxes.</p>
<div class="callout">Drag a point far away. Its box grows with the square of the distance, so one outlier can drag the whole line toward it.</div>
<h3>The model</h3>
<p>A line has a slope <span class="tx">w</span> and an intercept <span class="tx">b</span>:</p>
<div class="eq">\hat y = w\,x + b</div>
<p>With two input features it becomes a <span class="t3">plane</span> (the 3D view):</p>
<div class="eq">\hat y = w_1 x_1 + w_2 x_2 + b</div>
<h3>The loss</h3>
<div class="eq">\text{MSE}(w,b) = \frac{1}{n}\sum_{i=1}^{n}\big(\underbrace{y_i - \hat y_i}_{\color{#ff6b57}\text{residual}}\big)^2</div>
<h3>Two ways to find the best line</h3>
<ul>
<li><b>Exact:</b> set the gradient to zero and solve. With the features stacked in a matrix <span class="tx">X</span>: <span class="tx">w = (X^\top X)^{-1} X^\top y</span>.</li>
<li><b>Gradient descent:</b> start anywhere and repeatedly step downhill: <span class="tx">w \leftarrow w - \eta\,\nabla \text{MSE}</span>. The step size <span class="tx">\eta</span> is the learning rate.</li>
</ul>
<h3>Bending the line</h3>
<p>Feed the model <span class="tx">x, x^2, \dots, x^d</span> instead of just <span class="tx">x</span> and the same method fits a curve. A high degree can thread through every training point while missing the hollow <b>test</b> points it never saw. That is <b>overfitting</b>: low training error, high test error.</p>
`,

    create(ctx) {
        const P = ctx.params;
        const st = { kind: 'linear', pts: regression('linear'), pts3: regression3d('linear'), w: null, epoch: 0, diverged: false, pyW: null, dragged3d: false, losses: [] };
        const plot = ctx.plot;

        const feats = (x) => { const f = [1]; for (let d = 1; d <= P.degree; d++) f.push(f[d - 1] * x); return f; };
        const is3 = () => ctx.view === '3d';
        const featOf = (p) => (is3() ? [1, p.x1, p.x2] : feats(p.x));
        const yOf = (p) => p.y;
        const train = () => (is3() ? st.pts3 : st.pts).filter((p) => !p.test);
        const W = () => st.pyW || st.w;
        const predict = (p) => { const f = featOf(p), w = W(); let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * (w[i] || 0); return s; };
        const mse = (arr) => { if (!arr.length) return NaN; let s = 0; for (const p of arr) { const e = predict(p) - yOf(p); s += e * e; } return s / arr.length; };

        function fit() {
            const tr = train();
            const d = is3() ? 3 : P.degree + 1;
            if (P.mode === 'exact') {
                st.w = tr.length ? lstsq(tr.map(featOf), tr.map(yOf), 1e-7) : new Array(d).fill(0);
                st.diverged = false;
            } else if (!st.w || st.w.length !== d) resetGD();
        }
        function resetGD() { st.w = new Array(is3() ? 3 : P.degree + 1).fill(0); st.epoch = 0; st.diverged = false; st.losses = []; }

        function gdStep() {
            if (P.mode !== 'gd') { ctx.set('mode', 'gd'); resetGD(); }
            if (st.diverged) return false;
            const tr = train();
            if (!tr.length) return false;
            const w = st.w, g = new Array(w.length).fill(0);
            for (const p of tr) {
                const f = featOf(p);
                let e = -yOf(p); for (let i = 0; i < f.length; i++) e += f[i] * w[i];
                for (let i = 0; i < f.length; i++) g[i] += (2 / tr.length) * e * f[i];
            }
            for (let i = 0; i < w.length; i++) w[i] -= P.lr * g[i];
            st.epoch++;
            const L = mse(tr);
            st.losses.push(L);
            if (!Number.isFinite(L) || L > 50) { st.diverged = true; ctx.flash('Overshoot! The loss exploded.', ctx.colors().c[1]); return false; }
            return st.epoch < 3000;
        }

        // ---------- 2D ----------
        const editor = pointEditor(plot, ctx, {
            points: () => (is3() ? [] : st.pts),
            spawn: (x, y) => { if (is3()) return null; const p = { x, y, test: false }; st.pts.push(p); return p; },
            remove: (p) => st.pts.splice(st.pts.indexOf(p), 1),
            changed: () => { st.pyW = null; ctx.pyCleared(); if (P.mode === 'exact') fit(); ctx.changed(); },
            info: (p) => {
                const yh = predict(p);
                return `${swatch(ctx.colors().c[0])}<span class="k">${p.test ? 'test point' : 'training point'}</span><br>x <b>${fmt(p.x)}</b> · y <b>${fmt(p.y)}</b><br>ŷ <b>${fmt(yh)}</b> · residual <b style="color:${ctx.colors().c[1]}">${fmt(p.y - yh)}</b>`;
            },
        });

        function draw2d() {
            const C = ctx.colors();
            const g = plot.begin(C);
            plot.grid();
            const tr = st.pts.filter((p) => !p.test);
            // squared error boxes + residuals
            for (const p of tr) {
                const yh = predict(p);
                const X = plot.sx(p.x), Y = plot.sy(p.y), Yh = plot.sy(yh);
                if (P.squares && !ctx.hidden('residuals')) {
                    const s = Math.min(400, Math.abs(Y - Yh));
                    g.fillStyle = rgba(C.c[1], 0.12); g.strokeStyle = rgba(C.c[1], 0.45); g.lineWidth = 1;
                    g.fillRect(X, Math.min(Y, Yh), s, s * Math.sign(1)); g.strokeRect(X, Math.min(Y, Yh), s, s);
                }
                if (P.residuals && !ctx.hidden('residuals')) {
                    g.setLineDash([4, 4]); g.lineDashOffset = -performance.now() / 60;
                    g.strokeStyle = rgba(C.c[1], 0.9); g.lineWidth = 1.6;
                    g.beginPath(); g.moveTo(X, Y); g.lineTo(X, Math.max(-50, Math.min(plot.h + 50, Yh))); g.stroke();
                    g.setLineDash([]);
                }
            }
            // model curve with glow
            const [vx0, vx1] = plot.view();
            if (!ctx.hidden('model')) {
            g.save();
            g.shadowColor = C.c[3]; g.shadowBlur = 14;
            g.strokeStyle = C.c[3]; g.lineWidth = 3; g.lineJoin = 'round';
            g.beginPath();
            let pen = false;
            for (let i = 0; i <= 240; i++) {
                const x = vx0 + ((vx1 - vx0) * i) / 240;
                const y = predict({ x });
                const Y = plot.sy(y);
                if (!Number.isFinite(Y) || Y < -2000 || Y > plot.h + 2000) { pen = false; continue; }
                if (!pen) { g.moveTo(plot.sx(x), Y); pen = true; } else g.lineTo(plot.sx(x), Y);
            }
            g.stroke();
            g.restore();
            }
            for (const p of st.pts) plot.point(p.x, p.y, C.c[0], { test: p.test, hot: p === editor.hot });
            plot.drawRipples();
        }

        // ---------- 3D ----------
        let T = null;
        function build3d() {
            const th = ctx.three;
            const scene = th.newScene({ size: 6, camera: [5.6, 4.6, 6.4], target: [0, 1.4, 0] });
            const C = { pt: 0x22d3ee, plane: 0xa78bfa, res: 0xff6b57 };
            const sphereG = new THREE.SphereGeometry(0.085, 20, 14);
            const matTrain = new THREE.MeshStandardMaterial({ color: C.pt, emissive: C.pt, emissiveIntensity: 0.35, roughness: 0.35 });
            const matTest = new THREE.MeshStandardMaterial({ color: C.pt, transparent: true, opacity: 0.35, roughness: 0.4 });
            const balls = [];
            const group = new THREE.Group(); scene.add(group);
            const planeG = new THREE.PlaneGeometry(S * 2.2, S * 2.2, 12, 12);
            planeG.rotateX(-Math.PI / 2);
            const plane = new THREE.Mesh(planeG, new THREE.MeshStandardMaterial({ color: C.plane, transparent: true, opacity: 0.32, side: THREE.DoubleSide, roughness: 0.5, depthWrite: false }));
            const wire = new THREE.Mesh(planeG, new THREE.MeshBasicMaterial({ color: C.plane, wireframe: true, transparent: true, opacity: 0.35 }));
            scene.add(plane, wire);
            const resG = new THREE.BufferGeometry();
            const res = new THREE.LineSegments(resG, new THREE.LineDashedMaterial({ color: C.res, dashSize: 0.07, gapSize: 0.05 }));
            scene.add(res);
            const glow = halo(C.pt, 0.6, 0); scene.add(glow);
            T = { scene, sphereG, matTrain, matTest, balls, group, plane, wire, planeG, res, resG, glow };
            syncBalls();
        }
        function syncBalls() {
            if (!T) return;
            while (T.balls.length > st.pts3.length) T.group.remove(T.balls.pop());
            while (T.balls.length < st.pts3.length) { const m = new THREE.Mesh(T.sphereG, T.matTrain); T.group.add(m); T.balls.push(m); }
            st.pts3.forEach((p, i) => { const b = T.balls[i]; b.material = p.test ? T.matTest : T.matTrain; b.userData.p = p; b.position.set(p.x1 * S, toY(p.y), p.x2 * S); });
        }
        function update3d() {
            if (!T) return;
            syncBalls();
            const pos = T.planeG.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                const x1 = pos.getX(i) / S, x2 = pos.getZ(i) / S;
                pos.setY(i, Math.max(-1, Math.min(6, toY(predict({ x1, x2 })))));
            }
            pos.needsUpdate = true;
            T.planeG.computeVertexNormals();
            const segs = [];
            T.plane.visible = T.wire.visible = !ctx.hidden('model');
            if (P.residuals && !ctx.hidden('residuals')) for (const p of st.pts3) if (!p.test) { const y = toY(predict(p)); segs.push(p.x1 * S, toY(p.y), p.x2 * S, p.x1 * S, y, p.x2 * S); }
            T.resG.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
            T.res.computeLineDistances();
            T.glow.material.opacity = drag3 ? 0.9 : 0;
            if (drag3) T.glow.position.copy(T.balls[st.pts3.indexOf(drag3)].position);
        }

        let drag3 = null, dragPlane = new THREE.Plane();
        const th = ctx.three;
        th.on('down', (e) => {
            if (!is3() || !T) return false;
            const hit = th.pick(T.balls, e)[0];
            if (!hit) return false;
            drag3 = hit.object.userData.p;
            const n = new THREE.Vector3(); th.camera.getWorldDirection(n); n.y = 0; n.normalize();
            dragPlane.setFromNormalAndCoplanarPoint(n, hit.object.position);
            ctx.tooltip.hide();
            return true;
        });
        th.on('drag', (e) => {
            if (!drag3) return;
            const v = new THREE.Vector3();
            if (th.ray(e.clientX, e.clientY).ray.intersectPlane(dragPlane, v)) {
                drag3.y = Math.max(-1.25, Math.min(2.2, v.y / H - Y0));
                st.pyW = null; ctx.pyCleared();
                if (P.mode === 'exact') fit();
                st.dragged3d = true; ctx.changed();
            }
        });
        th.on('up', () => { drag3 = null; });
        th.on('click', (e) => {
            if (!is3() || !T) return;
            const v = new THREE.Vector3();
            if (!th.ray(e.clientX, e.clientY).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v)) return;
            const x1 = v.x / S, x2 = v.z / S;
            if (Math.abs(x1) > 1.1 || Math.abs(x2) > 1.1) return;
            const p = { x1, x2, y: predict({ x1, x2 }) + (Math.random() - 0.5) * 0.4, test: false };
            st.pts3.push(p);
            if (P.mode === 'exact') fit();
            th.addRipple(new THREE.Vector3(p.x1 * S, toY(p.y), p.x2 * S), 0x22d3ee, new THREE.Vector3(0, 1, 0));
            ctx.changed();
        });
        th.on('hover', (e) => {
            if (!is3() || !T || drag3) return;
            const hit = th.pick(T.balls, e)[0];
            th.container.classList.toggle('grab', !!hit);
            if (!hit) return ctx.tooltip.hide();
            const p = hit.object.userData.p, yh = predict(p);
            ctx.tooltip.show(e.clientX, e.clientY - 8, `<span class="k">${p.test ? 'test' : 'training'} point</span><br>x₁ <b>${fmt(p.x1)}</b> · x₂ <b>${fmt(p.x2)}</b><br>y <b>${fmt(p.y)}</b> · ŷ <b>${fmt(yh)}</b>`);
        });
        th.on('leave', () => ctx.tooltip.hide());

        if (ctx.view === '3d') build3d();
        fit();

        return {
            setParam(k) {
                if (k === 'degree' || k === 'mode') { st.pyW = null; if (P.mode === 'gd') resetGD(); fit(); }
            },
            setDataset(kind) { st.kind = kind; st.pts = regression(kind); st.pts3 = regression3d(kind); st.pyW = null; if (P.mode === 'gd') resetGD(); fit(); },
            setView(v) { if (v === '3d' && !T) build3d(); st.pyW = null; if (P.mode === 'gd') resetGD(); fit(); ctx.refreshControls(); },
            step: gdStep,
            reset() { st.pyW = null; resetGD(); if (P.mode === 'exact') fit(); },
            canPlay: () => !st.diverged,
            frame() { if (is3()) update3d(); else draw2d(); },
            metrics() {
                const arr = is3() ? st.pts3 : st.pts;
                const tr = arr.filter((p) => !p.test), te = arr.filter((p) => p.test);
                const out = [];
                if (P.mode === 'gd') out.push({ k: 'Epoch', v: st.epoch });
                const a = mse(tr), b = mse(te);
                out.push({ k: 'Train MSE', v: fmt(a, 4), cls: st.diverged ? 'bad' : '' }, { k: 'Test MSE', v: fmt(b, 4), cls: b > 2 * a && a < 0.03 ? 'bad' : '' });
                if (!is3() && P.degree === 1 || is3()) { const w = W(); out.push({ k: is3() ? 'Plane' : 'Line', v: is3() ? `${fmt(w[1], 2)}x₁ ${w[2] < 0 ? '−' : '+'} ${fmt(Math.abs(w[2]), 2)}x₂ ${w[0] < 0 ? '−' : '+'} ${fmt(Math.abs(w[0]), 2)}` : `${fmt(w[1], 2)}x ${w[0] < 0 ? '−' : '+'} ${fmt(Math.abs(w[0]), 2)}` }); }
                return out;
            },
            state() {
                const arr = is3() ? st.pts3 : st.pts;
                return { trainMSE: mse(arr.filter((p) => !p.test)), testMSE: mse(arr.filter((p) => p.test)), diverged: st.diverged, dragged3d: st.dragged3d, epoch: st.epoch };
            },
            pyData() {
                const arr = (is3() ? st.pts3 : st.pts);
                const X = (p) => (is3() ? [p.x1, p.x2] : [p.x]);
                const tr = arr.filter((p) => !p.test), te = arr.filter((p) => p.test);
                return { X: tr.map(X), y: tr.map(yOf), X_test: te.map(X), y_test: te.map(yOf) };
            },
            onPython(r) {
                if (!r || r.coef == null) throw new Error('expected result = {"coef": ..., "intercept": ...}');
                const coef = [].concat(r.coef).flat();
                st.pyW = [r.intercept || 0, ...coef];
                return `Python: LinearRegression${is3() ? ' plane' : coef.length > 1 ? ` (degree ${coef.length})` : ''}`;
            },
            clearPython() { st.pyW = null; },
            destroy() { editor.destroy(); },
        };
    },
};
