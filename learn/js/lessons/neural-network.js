import { CLASS_SETS, classification } from '../core/data.js';
import { paintField } from '../core/plot2d.js';
import { rng, hexToRgb, fmt, pct, clamp } from '../core/math.js';
import { THREE, halo } from '../core/scene3d.js';
import { regionImage, drawClassPoints, classData, classEditor, swatch, accMetric } from './common.js';

const nClasses = (kind) => (kind === 'blobs' ? 3 : 2);
const POS = 0x22d3ee, NEG = 0xff6b57;
const OUT_COL = [0x22d3ee, 0xff6b57, 0xfbbf24];
const ACT = {
    tanh: { f: Math.tanh, d: (a) => 1 - a * a },
    relu: { f: (z) => (z > 0 ? z : 0), d: (a) => (a > 0 ? 1 : 0) },
    logistic: { f: (z) => 1 / (1 + Math.exp(-z)), d: (a) => a * (1 - a) },
};

export default {
    views: [{ id: 'split', label: 'Split' }, { id: '2d', label: '2D' }, { id: '3d', label: '3D network' }],
    datasets: CLASS_SETS,
    defaultDataset: 'circles',
    classes: 2,
    playback: { sps: 60 },
    hint: 'Press Play to train · hover the heatmap to light up the network · hover a neuron to see what it detects',
    params: [
        { key: 'layers', label: 'Hidden layers', py: 'n_layers', type: 'range', min: 1, max: 3, step: 1, value: 1 },
        { key: 'width', label: 'Neurons per layer', py: 'width', type: 'range', min: 1, max: 8, step: 1, value: 4 },
        { key: 'activation', label: 'Activation', py: 'activation', type: 'select', value: 'tanh', options: [{ value: 'tanh', label: 'tanh' }, { value: 'relu', label: 'ReLU' }, { value: 'logistic', label: 'sigmoid' }] },
        { key: 'lr', label: 'Learning rate', py: 'learning_rate', type: 'range', log: true, min: 0.001, max: 1, step: 0.001, value: 0.03, digits: 3, group: 'Training', help: 'Adam step size. Very high values make the loss jump around.' },
        { key: 'alpha', label: 'L2 penalty α', py: 'alpha', type: 'range', log: true, min: 0.0001, max: 1, step: 0.0001, value: 0.0001, digits: 4, group: 'Training', help: 'Pulls weights toward zero for smoother boundaries.' },
    ],
    actions: [{ id: 'reinit', label: 'New random weights', secondary: true }],
    presets: [
        { label: 'Tiny (1×1)', values: { layers: 1, width: 1 } },
        { label: 'Small (1×4)', values: { layers: 1, width: 4 } },
        { label: 'Deep (3×6)', values: { layers: 3, width: 6 } },
        { label: 'Too hot (lr 0.8)', values: { lr: 0.8, width: 8 } },
    ],
    legend: `<span><i style="background:#22d3ee"></i>positive weight / activation</span><span><i style="background:#ff6b57"></i>negative</span><span>Edge thickness = |weight|</span><span>Node glow = |activation|</span>`,
    how: 'Press <b>Play</b> to train with Adam. Left: the network’s prediction for every spot. Right: the network itself. Hover the heatmap to send that point through the network and watch the neurons light up. Hover a neuron to paint the heatmap with what that one neuron responds to.',
    challenges: [
        { id: 'circles', title: 'Solve Circles: test accuracy ≥ 95%', hint: 'Circles needs a curved boundary. With 1 hidden layer of 3+ tanh neurons, train for a few hundred epochs.', check: (s) => s.dataset === 'circles' && s.test >= 0.95 },
        { id: 'underfit', title: 'Underfit with one neuron', hint: 'Use the Tiny preset (1 layer, 1 neuron) on Circles and train past 300 epochs. One neuron can only draw one straight line, so accuracy stays poor.', check: (s, P) => s.dataset === 'circles' && P.layers === 1 && P.width === 1 && s.epoch >= 300 && s.train < 0.8 },
        { id: 'hot', title: 'Cause the learning rate to overshoot', hint: 'Raise the learning rate to 0.5 or more and train. Instead of sliding smoothly down, the loss line keeps jumping back up as the steps overshoot. (Wider layers jump more.)', check: (s) => s.spike },
    ],
    code: String.raw`# A neural network (multi-layer perceptron) with scikit-learn
# X, y -> training points on the canvas, X_test, y_test -> hollow test points
import warnings
from sklearn.neural_network import MLPClassifier

n_layers = 1             # hidden layers
width = 4                # neurons in each hidden layer
activation = 'tanh'      # 'tanh', 'relu' or 'logistic'
learning_rate = 0.03
alpha = 0.0001           # L2 penalty
epochs = 400

model = MLPClassifier(hidden_layer_sizes=(width,) * n_layers,
                      activation=activation, solver="adam",
                      learning_rate_init=learning_rate, alpha=alpha,
                      max_iter=epochs, random_state=0)
with warnings.catch_warnings():
    warnings.simplefilter("ignore")      # hide "did not converge" notes
    model.fit(X, y)

print("final loss    :", round(model.loss_, 4))
print("train accuracy:", round(model.score(X, y), 3))
print("test accuracy :", round(model.score(X_test, y_test), 3))
print("weight shapes :", [w.shape for w in model.coefs_])

# send the trained weights to the canvas (you can keep training them there)
result = {"coefs": model.coefs_, "intercepts": model.intercepts_,
          "loss_curve": model.loss_curve_, "classes": model.classes_}
`,
    explain: String.raw`
<h3>The idea</h3>
<p>A neuron takes a weighted sum of its inputs and passes it through a bend, the <b>activation</b>. One neuron can only draw a straight line. Stack a layer of them, then another, and the bends combine into curves that can wrap around any shape.</p>
<div class="eq">\mathbf{h} = \sigma(W\mathbf{x} + \mathbf{b})</div>
<p>Here <span class="tx">W</span> holds the weights (the <span class="t0">edges</span> in the 3D view; thickness shows size, <span class="t0">cyan</span> positive, <span class="t1">coral</span> negative) and <span class="tx">\sigma</span> is tanh, ReLU or sigmoid.</p>
<h3>From scores to probabilities</h3>
<p>The last layer produces one score per class, turned into probabilities by the softmax:</p>
<div class="eq">p_c = \frac{e^{z_c}}{\sum_j e^{z_j}}</div>
<h3>Learning</h3>
<p>Training lowers the cross-entropy loss (plus a small L2 penalty that keeps weights modest):</p>
<div class="eq">L = -\frac1n\sum_{i}\log p_{y_i}(\mathbf{x}_i) + \frac{\alpha}{2n}\sum W^2</div>
<p><b>Backpropagation</b> uses the chain rule to get the gradient of <span class="tx">L</span> for every weight in one backward pass. Adam then nudges each weight downhill, exactly like the ball in the gradient-descent lesson, only in many more dimensions.</p>
<h3>What hidden neurons learn</h3>
<p>Hover a hidden neuron. The heatmap switches to show where that neuron fires. Each first-layer neuron is a soft straight edge; later layers combine edges into curved regions.</p>
<ul>
<li><b>Too few neurons:</b> not enough edges to wrap the data (underfitting).</li>
<li><b>Learning rate too high:</b> steps overshoot and the loss jumps around.</li>
</ul>
`,

    create(ctx) {
        const P = ctx.params;
        const plot = ctx.plot;
        const th = ctx.three;
        const st = { kind: 'circles', pts: [], sizes: [], W: [], B: [], m: [], v: [], t: 0, epoch: 0, losses: [], minLoss: Infinity, spike: false, seed: 1, probe: null, probeNode: null, field: null, fieldEpoch: -1, py: false };

        // ---------- network ----------
        function initNet() {
            const K = nClasses(st.kind);
            st.sizes = [2, ...new Array(P.layers).fill(P.width), K];
            const r = rng(st.seed * 101 + P.layers * 7 + P.width);
            st.W = []; st.B = []; st.m = []; st.v = [];
            for (let l = 0; l < st.sizes.length - 1; l++) {
                const nin = st.sizes[l], nout = st.sizes[l + 1];
                const lim = Math.sqrt(6 / (nin + nout)) * (P.activation === 'logistic' ? 2 : 1);
                st.W.push(Array.from({ length: nout }, () => Array.from({ length: nin }, () => (r() * 2 - 1) * lim)));
                st.B.push(Array.from({ length: nout }, () => (r() * 2 - 1) * lim * 0.5));
            }
            st.m = zerosLike(); st.v = zerosLike(); st.t = 0;
            st.epoch = 0; st.losses = []; st.minLoss = Infinity; st.spike = false; st.jumps = 0; st.py = false; st.fieldEpoch = -1;
            T3 && T3.sig !== sig() && build3d();
        }
        const zerosLike = () => ({ W: st.W.map((w) => w.map((r) => r.map(() => 0))), B: st.B.map((b) => b.map(() => 0)) });
        const sig = () => st.sizes.join('-');

        function forward(x, y) {
            const act = ACT[P.activation];
            const A = [[x, y]];
            for (let l = 0; l < st.W.length; l++) {
                const W = st.W[l], B = st.B[l], a = A[l], out = new Array(W.length);
                for (let j = 0; j < W.length; j++) { let z = B[j]; for (let i = 0; i < a.length; i++) z += W[j][i] * a[i]; out[j] = z; }
                if (l < st.W.length - 1) for (let j = 0; j < out.length; j++) out[j] = act.f(out[j]);
                else { const mx = Math.max(...out); let s = 0; for (let j = 0; j < out.length; j++) { out[j] = Math.exp(out[j] - mx); s += out[j]; } for (let j = 0; j < out.length; j++) out[j] /= s; }
                A.push(out);
            }
            return A;
        }
        const predict = (x, y) => { const p = forward(x, y).at(-1); return p.indexOf(Math.max(...p)); };

        function trainEpoch() {
            const train = st.pts.filter((p) => !p.test);
            if (!train.length) return false;
            const act = ACT[P.activation];
            const gW = st.W.map((w) => w.map((r) => r.map(() => 0))), gB = st.B.map((b) => b.map(() => 0));
            let loss = 0;
            const n = train.length;
            for (const p of train) {
                const A = forward(p.x, p.y);
                const out = A.at(-1);
                loss -= Math.log(Math.max(1e-12, out[p.c]));
                let delta = out.map((v, c) => (v - (c === p.c ? 1 : 0)) / n);
                for (let l = st.W.length - 1; l >= 0; l--) {
                    const a = A[l];
                    for (let j = 0; j < delta.length; j++) { gB[l][j] += delta[j]; for (let i = 0; i < a.length; i++) gW[l][j][i] += delta[j] * a[i]; }
                    if (l === 0) break;
                    const prev = new Array(a.length).fill(0);
                    for (let i = 0; i < a.length; i++) { let s = 0; for (let j = 0; j < delta.length; j++) s += st.W[l][j][i] * delta[j]; prev[i] = s * act.d(a[i]); }
                    delta = prev;
                }
            }
            let reg = 0;
            for (let l = 0; l < st.W.length; l++) for (let j = 0; j < st.W[l].length; j++) for (let i = 0; i < st.W[l][j].length; i++) {
                reg += st.W[l][j][i] ** 2; gW[l][j][i] += (P.alpha / n) * st.W[l][j][i];
            }
            loss = loss / n + (P.alpha / (2 * n)) * reg;
            // Adam
            st.t++;
            const b1 = 0.9, b2 = 0.999, eps = 1e-8, lr = P.lr * Math.sqrt(1 - b2 ** st.t) / (1 - b1 ** st.t);
            for (let l = 0; l < st.W.length; l++) {
                for (let j = 0; j < st.W[l].length; j++) {
                    for (let i = 0; i < st.W[l][j].length; i++) {
                        const g = gW[l][j][i];
                        st.m.W[l][j][i] = b1 * st.m.W[l][j][i] + (1 - b1) * g;
                        st.v.W[l][j][i] = b2 * st.v.W[l][j][i] + (1 - b2) * g * g;
                        st.W[l][j][i] -= (lr * st.m.W[l][j][i]) / (Math.sqrt(st.v.W[l][j][i]) + eps);
                    }
                    const g = gB[l][j];
                    st.m.B[l][j] = b1 * st.m.B[l][j] + (1 - b1) * g;
                    st.v.B[l][j] = b2 * st.v.B[l][j] + (1 - b2) * g * g;
                    st.B[l][j] -= (lr * st.m.B[l][j]) / (Math.sqrt(st.v.B[l][j]) + eps);
                }
            }
            st.epoch++;
            if (!Number.isFinite(loss)) { ctx.flash('The loss blew up. Resetting weights.', ctx.colors().c[1]); st.spike = true; initNet(); return false; }
            st.losses.push(loss);
            if (st.losses.length > 600) st.losses.shift();
            const prev = st.losses.at(-2);
            if (st.epoch > 5 && prev != null && loss > prev * 1.08 && loss - prev > 0.003) st.jumps++;
            if (st.jumps >= 3) st.spike = true;
            st.minLoss = Math.min(st.minLoss, loss);
            return st.epoch < 20000;
        }

        function scores() {
            let tr = 0, trN = 0, te = 0, teN = 0;
            for (const p of st.pts) { const ok = predict(p.x, p.y) === p.c ? 1 : 0; if (p.test) { te += ok; teN++; } else { tr += ok; trN++; } }
            return { train: trN ? tr / trN : NaN, test: teN ? te / teN : NaN };
        }

        // ---------- 2D ----------
        const editor = classEditor(plot, ctx, () => st.pts, {
            onChange: () => { st.fieldEpoch = -1; ctx.pyCleared(); },
            hover: (p) => { st.probe = p ? [p.x, p.y] : null; },
            info: (p) => { const C = ctx.colors(); const pr = forward(p.x, p.y).at(-1); const k = pr.indexOf(Math.max(...pr)); return `${swatch(C.c[p.c])}<span class="k">${p.test ? 'test' : 'training'} point</span><br>network says ${swatch(C.c[k])}<b>${pct(pr[k])}</b>`; },
        });
        plot.on('hover', (p) => {
            if (editor.hot) return;
            const C = ctx.colors();
            const pr = forward(p.x, p.y).at(-1);
            ctx.tooltip.showAt(plot.canvas, p.px, p.py - 10, `<span class="k">(${fmt(p.x, 2)}, ${fmt(p.y, 2)})</span><br>${pr.map((v, c) => `${swatch(C.c[c])}<b>${pct(v)}</b>`).join(' &nbsp;')}`);
        });

        function neuronField() {
            const [l, j] = st.probeNode;
            const g = plot.sampleGrid(70);
            const vals = new Float32Array(g.cols * g.rows);
            let mx = 1e-9;
            for (let k = 0; k < vals.length; k++) { const a = forward(g.pts[2 * k], g.pts[2 * k + 1])[l][j]; vals[k] = a; mx = Math.max(mx, Math.abs(a)); }
            const C = ctx.colors(), pos = hexToRgb(C.c[0]), neg = hexToRgb(C.c[1]);
            const center = P.activation === 'logistic' || (P.activation === 'relu') ? 0 : 0;
            return paintField(g.cols, g.rows, (i, jj, k) => { const v = (vals[k] - center) / mx; const c = v >= 0 ? pos : neg; return [c[0], c[1], c[2], 200 * Math.min(1, Math.abs(v))]; });
        }

        function draw2d() {
            const C = ctx.colors();
            const g = plot.begin(C);
            if (ctx.hidden('heatmap')) { /* revealed later in the guided tour */ }
            else if (st.probeNode && st.probeNode[0] > 0 && st.probeNode[0] < st.sizes.length - 1) plot.field(neuronField());
            else {
                if (st.fieldEpoch !== st.epoch || !st.field || st.field.version !== plot.version) { st.field = regionImage(plot, 72, (x, y) => forward(x, y).at(-1), C, { alpha: 0.5 }); st.fieldEpoch = st.epoch; }
                plot.field(st.field.img);
            }
            plot.grid({ labels: false });
            drawClassPoints(plot, st.pts, C, editor.hot);
            if (st.probe) { g.strokeStyle = C.text; g.lineWidth = 2; g.beginPath(); g.arc(plot.sx(st.probe[0]), plot.sy(st.probe[1]), 7, 0, Math.PI * 2); g.stroke(); }
            plot.drawRipples();
        }

        // loss sparkline
        const spark = document.createElement('div');
        spark.className = 'spark glass';
        spark.innerHTML = '<canvas></canvas>';
        ctx.hud.appendChild(spark);
        const probeLabel = document.createElement('div');
        probeLabel.className = 'glass hint';
        probeLabel.style.cssText = 'position:absolute;top:56px;left:12px;display:none';
        ctx.hud.appendChild(probeLabel);
        const scv = spark.querySelector('canvas'), sg = scv.getContext('2d');
        function drawSpark() {
            const r = scv.getBoundingClientRect(); if (!r.width) return;
            const dpr = Math.min(2, devicePixelRatio || 1);
            if (scv.width !== Math.round(r.width * dpr)) { scv.width = Math.round(r.width * dpr); scv.height = Math.round(r.height * dpr); }
            sg.setTransform(dpr, 0, 0, dpr, 0, 0); sg.clearRect(0, 0, r.width, r.height);
            const C = ctx.colors();
            sg.fillStyle = C.muted; sg.font = '600 10.5px ' + C.mono; sg.fillText('loss', 8, 13);
            const L = st.losses; if (L.length < 2) return;
            const mx = Math.max(...L) || 1;
            sg.strokeStyle = C.c[2]; sg.lineWidth = 1.8; sg.beginPath();
            L.forEach((v, i) => { const x = 6 + (i / (L.length - 1)) * (r.width - 12), y = r.height - 6 - (v / mx) * (r.height - 22); if (i) sg.lineTo(x, y); else sg.moveTo(x, y); });
            sg.stroke();
            sg.fillStyle = C.text; sg.textAlign = 'right'; sg.fillText(fmt(L.at(-1), 3), r.width - 8, 13); sg.textAlign = 'left';
        }

        // ---------- 3D network ----------
        let T3 = null;
        function build3d() {
            const scene = th.newScene({ grid: true, size: 10, camera: [0.4, 1.6, 8.6], target: [0, 1.3, 0] });
            th.grid.position.y = -0.6;
            const nodes = [], edges = [];
            const L = st.sizes.length;
            const pos = (l, i) => {
                const n = st.sizes[l];
                return new THREE.Vector3((l - (L - 1) / 2) * 2.1, 1.3 + (i - (n - 1) / 2) * 0.62, -0.18 * (i - (n - 1) / 2) ** 2 * 0.3 + (l % 2 ? 0.25 : -0.25));
            };
            const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
            const up = new THREE.Vector3(0, 1, 0);
            for (let l = 0; l < L - 1; l++) for (let j = 0; j < st.sizes[l + 1]; j++) for (let i = 0; i < st.sizes[l]; i++) {
                const a = pos(l, i), b = pos(l + 1, j);
                const m = new THREE.Mesh(cyl, new THREE.MeshBasicMaterial({ color: POS, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
                m.position.copy(a).add(b).multiplyScalar(0.5);
                m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
                m.userData = { l, j, i, len: a.distanceTo(b) };
                scene.add(m); edges.push(m);
            }
            const sph = new THREE.SphereGeometry(1, 24, 18);
            for (let l = 0; l < L; l++) for (let i = 0; i < st.sizes[l]; i++) {
                const out = l === L - 1;
                const base = out ? OUT_COL[i] : 0xcbd5e1;
                const m = new THREE.Mesh(sph, new THREE.MeshStandardMaterial({ color: base, emissive: base, emissiveIntensity: 0.2, roughness: 0.35 }));
                m.scale.setScalar(l === 0 || out ? 0.16 : 0.13);
                m.position.copy(pos(l, i));
                m.userData = { l, i, base };
                const h = halo(base, 0.8, 0.5); h.position.copy(m.position);
                scene.add(m, h); nodes.push({ m, h });
            }
            T3 = { nodes, edges, sig: sig(), aspect: 0 };
            fitCamera(true);
        }
        /** Frame the whole network, whatever the pane's shape (unless the visitor has orbited). */
        function fitCamera(force) {
            const aspect = th.camera.aspect || 1;
            if (!force && (th.orbited || Math.abs(aspect - T3.aspect) < 0.01)) return;
            T3.aspect = aspect;
            const L = st.sizes.length, maxN = Math.max(...st.sizes);
            const halfW = ((L - 1) * 2.1) / 2 + 0.7, halfH = ((maxN - 1) * 0.62) / 2 + 0.7;
            const vf = (th.camera.fov * Math.PI) / 180 / 2;
            const hf = Math.atan(Math.tan(vf) * aspect);
            const dist = Math.max(halfW / Math.tan(hf), halfH / Math.tan(vf)) * 1.08 + 0.6;
            th.camera.position.set(dist * 0.12, 1.3 + dist * 0.12, dist);
            th.controls.target.set(0, 1.3, 0);
            th.controls.update();
        }
        function update3d() {
            if (!T3 || T3.sig !== sig()) build3d();
            fitCamera(false);
            let mx = 1e-6;
            for (const w of st.W) for (const r of w) for (const v of r) mx = Math.max(mx, Math.abs(v));
            for (const e of T3.edges) {
                const { l, j, i, len } = e.userData;
                const w = st.W[l][j][i], a = Math.abs(w) / mx;
                e.scale.set(0.006 + 0.04 * a, len, 0.006 + 0.04 * a);
                e.material.color.set(w >= 0 ? POS : NEG);
                e.material.opacity = 0.08 + 0.8 * a;
            }
            const probe = st.probe || [0.3, 0.3];
            const A = forward(probe[0], probe[1]);
            const col = new THREE.Color();
            for (const { m, h } of T3.nodes) {
                const { l, i, base } = m.userData;
                const a = A[l][i];
                const out = l === st.sizes.length - 1;
                const mag = out ? a : l === 0 ? Math.min(1, Math.abs(a)) : Math.min(1, Math.abs(P.activation === 'logistic' ? (a - 0.5) * 2 : a));
                if (!out && l > 0) col.set(a >= (P.activation === 'logistic' ? 0.5 : 0) ? POS : NEG); else col.set(base);
                m.material.color.copy(col); m.material.emissive.copy(col);
                m.material.emissiveIntensity = 0.15 + 1.1 * mag;
                h.material.color.copy(col); h.material.opacity = 0.1 + 0.9 * mag;
                const hot = st.probeNode && st.probeNode[0] === l && st.probeNode[1] === i;
                h.scale.setScalar((hot ? 1.5 : 0.7) + 0.5 * mag);
            }
        }
        th.on('hover', (e) => {
            if (!T3 || ctx.view === '2d') return;
            const hit = th.pick(T3.nodes.map((n) => n.m), e)[0];
            if (!hit) { st.probeNode = null; probeLabel.style.display = 'none'; return ctx.tooltip.hide(); }
            const { l, i } = hit.object.userData;
            st.probeNode = [l, i];
            const probe = st.probe || [0.3, 0.3];
            const a = forward(probe[0], probe[1])[l][i];
            const L = st.sizes.length - 1;
            const name = l === 0 ? `input ${'xy'[i]}` : l === L ? `output · class ${'ABC'[i]}` : `hidden layer ${l} · neuron ${i + 1}`;
            const extra = l > 0 ? `<br><span class="k">bias</span> <b>${fmt(st.B[l - 1][i], 2)}</b>` : '';
            ctx.tooltip.show(e.clientX, e.clientY - 8, `<span class="k">${name}</span><br><span class="k">activation</span> <b>${fmt(a, 3)}</b>${extra}`);
            if (l > 0 && l < L) { probeLabel.textContent = `Heatmap: what hidden neuron ${l}·${i + 1} responds to`; probeLabel.style.display = ''; }
        });
        th.on('leave', () => { st.probeNode = null; probeLabel.style.display = 'none'; ctx.tooltip.hide(); });

        function load(kind) {
            st.kind = kind;
            st.pts = classification(kind, { n: 200, seed: 23, noise: kind === 'moons' ? 1.5 : 1.2 });
            ctx.setClasses(nClasses(kind));
            initNet();
        }
        load('circles');
        build3d();

        return {
            setParam(key) { if (key === 'layers' || key === 'width' || key === 'activation') initNet(); },
            setDataset(kind) { load(kind); },
            setView() { st.fieldEpoch = -1; if (T3) T3.aspect = 0; },
            action(id) { if (id === 'reinit') { st.seed++; initNet(); } },
            step: trainEpoch,
            reset() { initNet(); },
            frame() {
                if (ctx.view !== '3d') draw2d();
                if (ctx.view !== '2d') update3d();
                drawSpark();
            },
            metrics() {
                const s = scores();
                return [{ k: 'Epoch', v: st.epoch }, { k: 'Loss', v: st.losses.length ? fmt(st.losses.at(-1), 4) : '—', cls: st.spike ? 'bad' : '' }, accMetric('Train', s.train), accMetric('Test', s.test)];
            },
            state() { const s = scores(); return { ...s, epoch: st.epoch, spike: st.spike }; },
            pyData() { return classData(st.pts); },
            onPython(r) {
                if (!r || !r.coefs) throw new Error('expected result = {"coefs": ..., "intercepts": ...}');
                const K = nClasses(st.kind);
                const hidden = r.coefs.slice(0, -1).map((w) => w[0].length);
                if (hidden.some((h) => h !== hidden[0])) throw new Error('the canvas can only draw networks whose hidden layers have equal width');
                if (hidden.length < 1 || hidden.length > 3 || hidden[0] > 8) throw new Error('the canvas can draw 1 to 3 hidden layers of up to 8 neurons');
                st.sizes = [2, ...hidden, K];
                st.W = r.coefs.map((w) => w[0].map((_, j) => w.map((row) => row[j])));
                st.B = r.intercepts.map((b) => b.slice());
                const cls = r.classes || [0, 1];
                if (st.W.at(-1).length === 1 && K === 2) { st.W[st.W.length - 1] = [st.W.at(-1)[0].map(() => 0), st.W.at(-1)[0]]; st.B[st.B.length - 1] = [0, st.B.at(-1)[0]]; }
                else if (cls.length === K) {
                    const W = st.W.at(-1), B = st.B.at(-1), W2 = new Array(K), B2 = new Array(K);
                    cls.forEach((c, q) => { W2[c] = W[q]; B2[c] = B[q]; });
                    st.W[st.W.length - 1] = W2; st.B[st.B.length - 1] = B2;
                }
                st.m = zerosLike(); st.v = zerosLike(); st.t = 0;
                st.losses = (r.loss_curve || []).slice(-600); st.epoch = (r.loss_curve || []).length; st.minLoss = Math.min(...st.losses, Infinity);
                st.fieldEpoch = -1; st.py = true;
                return `Python: MLPClassifier ${st.sizes.join('→')}`;
            },
            clearPython() { st.py = false; },
            destroy() { editor.destroy(); },
        };
    },
};
