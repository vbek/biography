import { THREE, halo } from '../core/scene3d.js';
import { paintField, rgba } from '../core/plot2d.js';
import { contour, ramp, fmt, clamp } from '../core/math.js';

const E = Math.exp;
const SURF = {
    bowl: { label: 'Bowl', f: (x, y) => 0.5 * (x * x + 2.5 * y * y), start: [2.6, 2.1], min: [[0, 0]] },
    saddle: { label: 'Saddle', f: (x, y) => 0.5 * x * x - 0.5 * y * y + 0.06 * y ** 4, start: [2.6, 0.04], min: [[0, 2.04], [0, -2.04]] },
    local: { label: 'Local minima', f: (x, y) => 0.12 * (x * x + y * y) - E(-((x - 1.4) ** 2 + (y - 1.3) ** 2) / 0.7) - 1.9 * E(-((x + 1.3) ** 2 + (y + 1.1) ** 2) / 1.3), start: [2.7, 2.6], min: [[-1.2, -1.02]] },
    ravine: { label: 'Ravine', f: (x, y) => 0.2 * (1 - x) ** 2 + 3 * (y - 0.5 * x * x) ** 2, start: [-2.2, 2.4], min: [[1, 0.5]] },
};
const D = 3;           // domain is [-D, D]^2
const HMAX = 2.6;      // tallest point of the mesh

export default {
    views: [{ id: '3d', label: '3D surface' }, { id: '2d', label: 'Contour map' }],
    datasets: Object.entries(SURF).map(([id, s]) => ({ id, label: s.label })),
    defaultDataset: 'bowl',
    random: false,
    bounds: [-D, D, -D, D],
    playback: { sps: 12 },
    hint: 'Click the surface to drop the ball somewhere new · Play to roll · drag to orbit',
    params: [
        { key: 'lr', label: 'Learning rate η', py: 'lr', type: 'range', log: true, min: 0.005, max: 1.2, step: 0.001, value: 0.1, digits: 3, help: 'The size of each step downhill. Too small crawls; too big overshoots and can blow up.' },
        { key: 'momentum', label: 'Momentum β', py: 'momentum', type: 'range', min: 0, max: 0.97, step: 0.01, value: 0, help: 'How much of the previous step carries over. Like a heavy ball, it can roll through small dips.' },
    ],
    presets: [
        { label: 'Careful', values: { lr: 0.05, momentum: 0 } },
        { label: 'Just right', values: { lr: 0.3, momentum: 0 }, dataset: 'bowl' },
        { label: 'Heavy ball', values: { lr: 0.1, momentum: 0.9 } },
        { label: 'Too eager', values: { lr: 0.85, momentum: 0 }, dataset: 'bowl' },
    ],
    legend: `<span><i style="background:var(--c2)"></i>the ball (current weights)</span><span><i style="background:linear-gradient(90deg,#1f5fae,#8fe3c8,#fb9a5b)"></i>low → high loss</span>`,
    how: 'The surface is a <b>loss landscape</b>: each spot is one choice of two weights, and its height is how wrong the model would be. Press <b>Play</b> to let gradient descent roll the ball downhill. <b>Click</b> the surface to choose a new start.',
    challenges: [
        { id: 'overshoot', title: 'Cause the learning rate to overshoot', hint: 'On the Bowl, push the learning rate above about 0.8 with no momentum and press Play. Each step jumps past the bottom to a higher spot on the other side, and the ball flies off.', check: (s) => s.diverged || s.ups >= 3 },
        { id: 'escape', title: 'Escape the local minimum with momentum', hint: 'Pick Local minima. Without momentum the ball gets stuck in the small dip near the start. Add momentum (around 0.9) so it rolls through into the deeper valley.', check: (s) => s.dataset === 'local' && s.reachedGlobal && s.startInLocal },
        { id: 'fast', title: 'Reach the bowl’s bottom in ≤ 25 steps', hint: 'On the Bowl, find a learning rate that gets the loss below 0.001 in 25 steps or fewer. Too small is slow; too big zig-zags.', check: (s) => s.dataset === 'bowl' && s.loss < 1e-3 && s.steps <= 25 && !s.diverged },
    ],
    code: String.raw`# Gradient descent, written from scratch with numpy
# surface -> which landscape is selected ('bowl', 'saddle', 'local', 'ravine')
# start   -> where the ball starts, (x, y)
import numpy as np

lr = 0.1          # learning rate (step size)
momentum = 0.0    # 0 = plain gradient descent, 0.9 = heavy ball
steps = 80

surfaces = {
    "bowl":   lambda x, y: 0.5 * (x**2 + 2.5 * y**2),
    "saddle": lambda x, y: 0.5 * x**2 - 0.5 * y**2 + 0.06 * y**4,
    "local":  lambda x, y: 0.12 * (x**2 + y**2)
                           - np.exp(-((x - 1.4)**2 + (y - 1.3)**2) / 0.7)
                           - 1.9 * np.exp(-((x + 1.3)**2 + (y + 1.1)**2) / 1.3),
    "ravine": lambda x, y: 0.2 * (1 - x)**2 + 3 * (y - 0.5 * x**2)**2,
}
f = surfaces[surface]

def grad(p, h=1e-5):
    """Slope in each direction, measured numerically."""
    x, y = p
    return np.array([(f(x + h, y) - f(x - h, y)) / (2 * h),
                     (f(x, y + h) - f(x, y - h)) / (2 * h)])

p = np.array(start, dtype=float)
v = np.zeros(2)
path = [p.copy()]
for i in range(steps):
    v = momentum * v - lr * grad(p)   # remember part of the last step
    p = p + v
    path.append(p.copy())
    if np.abs(p).max() > 6:
        print(f"step {i}: diverged!")
        break

print("final point:", np.round(p, 3), " loss:", round(float(f(*p)), 5))
result = {"path": np.array(path)}
`,
    explain: String.raw`
<h3>The idea</h3>
<p>Training a model means finding weights that make the loss small. Picture every possible pair of weights as a spot on a map, with the loss as the height. Learning is then just <b>walking downhill</b>.</p>
<p>The <b>gradient</b> <span class="tx">\nabla f</span> points in the direction the surface rises fastest. So we step the other way:</p>
<div class="eq">\mathbf{w}_{t+1} = \mathbf{w}_t - \eta\,\nabla f(\mathbf{w}_t)</div>
<p>The <span class="t2">ball</span> is the current guess and its glowing trail is the path so far.</p>
<h3>The learning rate <span class="tx">\eta</span></h3>
<ul>
<li><b>Too small:</b> tiny steps; it gets there, eventually.</li>
<li><b>Too big:</b> each step lands past the bottom, higher up the other wall. On a bowl with curvature <span class="tx">\lambda</span>, plain gradient descent diverges once <span class="tx">\eta &gt; 2/\lambda</span>.</li>
</ul>
<h3>Momentum <span class="tx">\beta</span></h3>
<p>A heavy ball keeps rolling. Momentum keeps a running velocity <span class="tx">\mathbf{v}</span>:</p>
<div class="eq">\mathbf{v}_{t+1} = \beta\,\mathbf{v}_t - \eta\,\nabla f(\mathbf{w}_t), \qquad \mathbf{w}_{t+1} = \mathbf{w}_t + \mathbf{v}_{t+1}</div>
<p>It speeds up along long gentle valleys (try the Ravine) and can carry the ball through small dips that would trap plain descent (try Local minima).</p>
<h3>Hard places</h3>
<ul>
<li><b>Saddle points</b> are flat in one direction and curved in another. Starting exactly on the ridge, the gradient never points off it, so descent stalls.</li>
<li><b>Local minima</b> are dips that are not the lowest point. Gradient descent only sees the slope where it stands, so it can settle in the wrong one.</li>
</ul>
`,

    create(ctx) {
        const P = ctx.params;
        const plot = ctx.plot;
        const st = { surf: 'bowl', x: 0, y: 0, vx: 0, vy: 0, path: [], steps: 0, diverged: false, ups: 0, start: [0, 0], fmin: 0, fmax: 1, pyPath: null, pyIdx: 0, disp: new THREE.Vector3() };
        const S = () => SURF[st.surf];
        const f = (x, y) => S().f(x, y);
        const grad = (x, y, h = 1e-5) => [(f(x + h, y) - f(x - h, y)) / (2 * h), (f(x, y + h) - f(x, y - h)) / (2 * h)];
        const hOf = (v) => clamp(((v - st.fmin) / (st.fmax - st.fmin)) * HMAX, -0.5, HMAX * 3);

        // ---------- 3D ----------
        const th = ctx.three;
        let T = null;
        function build3d() {
            const scene = th.newScene({ grid: true, size: 8, camera: [6.4, 5.6, 6.8], target: [0, 0.6, 0] });
            th.grid.position.y = -0.02;
            const N = 110;
            const geo = new THREE.PlaneGeometry(2 * D, 2 * D, N, N);
            geo.rotateX(-Math.PI / 2);
            const pos = geo.attributes.position;
            let lo = Infinity, hi = -Infinity;
            for (let i = 0; i < pos.count; i++) { const v = f(pos.getX(i), -pos.getZ(i)); lo = Math.min(lo, v); hi = Math.max(hi, v); }
            st.fmin = lo; st.fmax = hi;
            const col = new Float32Array(pos.count * 3);
            for (let i = 0; i < pos.count; i++) {
                const v = f(pos.getX(i), -pos.getZ(i));
                const t = (v - lo) / (hi - lo);
                pos.setY(i, t * HMAX);
                const c = ramp(Math.pow(t, 0.6));
                col[3 * i] = (c[0] / 255) ** 2.2; col[3 * i + 1] = (c[1] / 255) ** 2.2; col[3 * i + 2] = (c[2] / 255) ** 2.2;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.94 }));
            scene.add(mesh);
            // contour lines draped on the surface
            const cols = 120, vals = new Float32Array((cols + 1) * (cols + 1));
            for (let j = 0; j <= cols; j++) for (let i = 0; i <= cols; i++) vals[j * (cols + 1) + i] = f(-D + (2 * D * i) / cols, D - (2 * D * j) / cols);
            const segs = [];
            for (let k = 1; k < 14; k++) {
                const lvl = lo + (hi - lo) * Math.pow(k / 14, 1 / 0.6);
                for (const s of contour(vals, cols, cols, lvl)) {
                    const y = ((lvl - lo) / (hi - lo)) * HMAX + 0.012;
                    segs.push(-D + (2 * D * s[0]) / cols, y, -(D - (2 * D * s[1]) / cols), -D + (2 * D * s[2]) / cols, y, -(D - (2 * D * s[3]) / cols));
                }
            }
            const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
            scene.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })));
            // minima markers
            for (const [mx, my] of S().min) {
                const ring = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.18, 40), new THREE.MeshBasicMaterial({ color: 0x34d399, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
                ring.rotation.x = -Math.PI / 2; ring.position.set(mx, hOf(f(mx, my)) + 0.03, -my);
                scene.add(ring);
            }
            // ball + glow + trail
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 28, 20), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.9, roughness: 0.3 }));
            const glow = halo(0xfbbf24, 1.1, 0.95);
            scene.add(ball, glow);
            const MAXP = 1200;
            const tg = new THREE.BufferGeometry();
            tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
            tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
            const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
            trail.frustumCulled = false;
            scene.add(trail);
            const dots = new THREE.Points(tg, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
            dots.frustumCulled = false;
            scene.add(dots);
            T = { mesh, ball, glow, trail, tg, MAXP };
        }

        const worldOf = (x, y) => new THREE.Vector3(x, hOf(f(x, y)) + 0.13, -y);

        function updateTrail() {
            if (!T) return;
            const path = st.pyPath ? st.pyPath.slice(0, st.pyIdx + 1) : st.path;
            const n = Math.min(path.length, T.MAXP);
            const off = path.length - n;
            const pos = T.tg.attributes.position.array, col = T.tg.attributes.color.array;
            for (let i = 0; i < n; i++) {
                const [x, y] = path[off + i];
                const w = worldOf(clamp(x, -8, 8), clamp(y, -8, 8));
                pos[3 * i] = w.x; pos[3 * i + 1] = w.y - 0.08; pos[3 * i + 2] = w.z;
                const a = 0.25 + 0.75 * (i / Math.max(1, n - 1));
                col[3 * i] = 1 * a; col[3 * i + 1] = 0.75 * a; col[3 * i + 2] = 0.15 * a;
            }
            T.tg.setDrawRange(0, n);
            T.tg.attributes.position.needsUpdate = true;
            T.tg.attributes.color.needsUpdate = true;
        }

        th.on('click', (e) => {
            if (ctx.view !== '3d' || !T) return;
            const hit = th.pick([T.mesh], e)[0];
            if (!hit) return;
            setStart(hit.point.x, -hit.point.z);
            th.addRipple(hit.point.clone().add(new THREE.Vector3(0, 0.03, 0)), 0xfbbf24, hit.face ? hit.face.normal : null);
        });
        th.on('hover', (e) => {
            if (ctx.view !== '3d' || !T) return;
            const hit = th.pick([T.mesh], e)[0];
            if (!hit) return ctx.tooltip.hide();
            const x = hit.point.x, y = -hit.point.z, g = grad(x, y);
            ctx.tooltip.show(e.clientX, e.clientY - 8, `<span class="k">weights</span> (${fmt(x, 2)}, ${fmt(y, 2)})<br><span class="k">loss</span> <b>${fmt(f(x, y), 3)}</b> · <span class="k">slope</span> <b>${fmt(Math.hypot(...g), 2)}</b><br><span class="k">click to start here</span>`);
        });
        th.on('leave', () => ctx.tooltip.hide());

        // ---------- 2D contour map ----------
        let field = null;
        function buildField() {
            const cols = 160;
            const g = plot.sampleGrid(cols);
            const vals = new Float32Array(g.cols * g.rows);
            let lo = Infinity, hi = -Infinity;
            for (let k = 0; k < vals.length; k++) { vals[k] = f(g.pts[2 * k], g.pts[2 * k + 1]); }
            for (let j = 0; j < 101; j++) for (let i = 0; i < 101; i++) { const v = f(-D + 0.06 * i, -D + 0.06 * j); lo = Math.min(lo, v); hi = Math.max(hi, v); }
            const img = paintField(g.cols, g.rows, (i, j, k) => { const c = ramp(Math.pow(clamp((vals[k] - lo) / (hi - lo), 0, 1), 0.6)); return [c[0], c[1], c[2], 150]; });
            // contour lines on corners grid
            const cc = 120, cr = Math.round(cc * plot.h / plot.w);
            const [x0, x1, y0, y1] = plot.view();
            const cv = new Float32Array((cc + 1) * (cr + 1));
            for (let j = 0; j <= cr; j++) for (let i = 0; i <= cc; i++) cv[j * (cc + 1) + i] = f(x0 + ((x1 - x0) * i) / cc, y1 - ((y1 - y0) * j) / cr);
            const segs = [];
            for (let k = 1; k < 16; k++) for (const s of contour(cv, cc, cr, lo + (hi - lo) * Math.pow(k / 16, 1 / 0.6))) segs.push(s.map((v, q) => (q % 2 === 0 ? (v / cc) * plot.w : (v / cr) * plot.h)));
            field = { img, segs, version: plot.version, surf: st.surf };
        }
        plot.on('click', (p) => { if (ctx.view === '2d') { setStart(p.x, p.y); plot.addRipple(p.x, p.y, ctx.colors().c[2]); } });
        plot.on('hover', (p) => {
            if (ctx.view !== '2d') return;
            const g = grad(p.x, p.y);
            ctx.tooltip.showAt(plot.canvas, p.px, p.py - 10, `<span class="k">weights</span> (${fmt(p.x, 2)}, ${fmt(p.y, 2)}) · <span class="k">loss</span> <b>${fmt(f(p.x, p.y), 3)}</b><br><span class="k">slope</span> <b>${fmt(Math.hypot(...g), 2)}</b> · <span class="k">click to start here</span>`);
        });
        plot.on('leave', () => ctx.tooltip.hide());

        function draw2d() {
            if (!field || field.version !== plot.version || field.surf !== st.surf) buildField();
            const C = ctx.colors();
            const g = plot.begin(C);
            plot.field(field.img);
            g.strokeStyle = C.light ? 'rgba(15,23,42,.22)' : 'rgba(255,255,255,.25)'; g.lineWidth = 1;
            g.beginPath(); for (const s of field.segs) { g.moveTo(s[0], s[1]); g.lineTo(s[2], s[3]); } g.stroke();
            for (const [mx, my] of S().min) { g.strokeStyle = C.ok; g.lineWidth = 2.5; g.beginPath(); g.arc(plot.sx(mx), plot.sy(my), 8, 0, Math.PI * 2); g.stroke(); }
            const path = st.pyPath ? st.pyPath.slice(0, st.pyIdx + 1) : st.path;
            g.save(); g.shadowColor = C.c[2]; g.shadowBlur = 10; g.strokeStyle = C.c[2]; g.lineWidth = 2.4; g.lineJoin = 'round';
            g.beginPath(); path.forEach(([x, y], i) => { const X = plot.sx(clamp(x, -9, 9)), Y = plot.sy(clamp(y, -9, 9)); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.stroke(); g.restore();
            for (const [x, y] of path) { g.fillStyle = C.c[2]; g.beginPath(); g.arc(plot.sx(x), plot.sy(y), 2.4, 0, Math.PI * 2); g.fill(); }
            const [bx, by] = path[path.length - 1];
            g.save(); g.shadowColor = C.c[2]; g.shadowBlur = 24; g.fillStyle = C.c[2]; g.beginPath(); g.arc(plot.sx(bx), plot.sy(by), 8, 0, Math.PI * 2); g.fill(); g.restore();
            g.strokeStyle = C.ring; g.lineWidth = 2; g.beginPath(); g.arc(plot.sx(bx), plot.sy(by), 8, 0, Math.PI * 2); g.stroke();
            plot.drawRipples();
        }

        // ---------- optimisation ----------
        function setStart(x, y) {
            st.start = [x, y]; st.x = x; st.y = y; st.vx = 0; st.vy = 0;
            st.path = [[x, y]]; st.steps = 0; st.diverged = false; st.ups = 0; st.pyPath = null;
            ctx.pyCleared();
            st.reachedGlobal = false;
            if (T) st.disp.copy(worldOf(x, y));
            ctx.changed();
        }
        function step() {
            if (st.pyPath) { st.pyIdx = Math.min(st.pyPath.length - 1, st.pyIdx + 1); return st.pyIdx < st.pyPath.length - 1; }
            if (st.diverged) return false;
            const before = f(st.x, st.y);
            const [gx, gy] = grad(st.x, st.y);
            st.vx = P.momentum * st.vx - P.lr * gx;
            st.vy = P.momentum * st.vy - P.lr * gy;
            st.x += st.vx; st.y += st.vy; st.steps++;
            st.path.push([st.x, st.y]);
            const L = f(st.x, st.y);
            st.ups = P.momentum < 0.05 && L > before + 1e-9 ? st.ups + 1 : 0;
            const [gm] = S().min;
            if (st.surf === 'local' && Math.hypot(st.x - gm[0], st.y - gm[1]) < 0.35) st.reachedGlobal = true;
            if (!Number.isFinite(L) || Math.abs(st.x) > 6 || Math.abs(st.y) > 6) {
                st.diverged = true;
                ctx.flash('Overshoot! The ball flew off the landscape.', ctx.colors().c[1]);
                return false;
            }
            const g2 = Math.hypot(gx, gy);
            if (g2 < 1e-4 && Math.hypot(st.vx, st.vy) < 1e-4) return false;
            return st.steps < 1500;
        }

        function load(id) {
            st.surf = id;
            field = null;
            build3d();
            setStart(...S().start);
        }
        load('bowl');

        return {
            setParam() { setStart(...st.start); },
            setDataset(id) { load(id); },
            setView(v) { if (v === '3d') th.resize(); },
            step,
            reset() { setStart(...st.start); },
            canPlay: () => !st.diverged && !(st.pyPath && st.pyIdx >= st.pyPath.length - 1),
            frame(dt) {
                if (st.pyPath && st.pyIdx < st.pyPath.length - 1) { st.pyAcc = (st.pyAcc || 0) + dt * 14; while (st.pyAcc >= 1) { st.pyAcc--; st.pyIdx = Math.min(st.pyPath.length - 1, st.pyIdx + 1); } }
                if (ctx.view === '2d') { draw2d(); return; }
                const path = st.pyPath ? st.pyPath.slice(0, st.pyIdx + 1) : st.path;
                const [x, y] = path[path.length - 1];
                const target = worldOf(clamp(x, -9, 9), clamp(y, -9, 9));
                st.disp.lerp(target, 0.25);
                T.ball.position.copy(st.disp);
                T.glow.position.copy(st.disp);
                T.glow.material.opacity = 0.7 + 0.25 * Math.sin(performance.now() / 300);
                updateTrail();
            },
            metrics() {
                const path = st.pyPath ? st.pyPath.slice(0, st.pyIdx + 1) : st.path;
                const [x, y] = path[path.length - 1];
                const L = f(x, y), g = grad(x, y);
                return [{ k: 'Step', v: path.length - 1 }, { k: 'Loss', v: fmt(L, 4), cls: st.diverged ? 'bad' : L - st.fmin < 1e-3 ? 'good' : '' }, { k: '|∇f|', v: fmt(Math.hypot(...g), 3) }, { k: 'Weights', v: `(${fmt(x, 2)}, ${fmt(y, 2)})` }];
            },
            state() {
                return {
                    diverged: st.diverged, ups: st.ups, steps: st.steps, loss: f(st.x, st.y),
                    reachedGlobal: st.reachedGlobal, startInLocal: st.start[0] > 0.2 && st.start[1] > 0.2,
                };
            },
            pyData() { return { surface: st.surf, start: st.start }; },
            onPython(r) {
                if (!r || !r.path) throw new Error('expected result = {"path": ...}');
                st.pyPath = r.path.filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
                st.pyIdx = 0;
                return `Python: ${st.pyPath.length - 1} steps`;
            },
            clearPython() { st.pyPath = null; },
            destroy() {},
        };
    },
};
