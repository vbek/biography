import { PCA_SETS, pcaCloud } from '../core/data.js';
import { eigSym, fmt, pct, clamp, easeOut } from '../core/math.js';
import { THREE, halo } from '../core/scene3d.js';

const S = 2.2;
const PC_COL = [0xff6b57, 0x22d3ee, 0xfbbf24];
const PC_CSS = ['var(--c1)', 'var(--c0)', 'var(--c2)'];

export default {
    views: [{ id: '3d', label: '3D' }],
    datasets: PCA_SETS,
    defaultDataset: 'pancake',
    spread: false,
    playback: { sps: 20 },
    hint: 'Press Play to collapse the cloud · drag to orbit · hover a point',
    params: [
        { key: 'k', label: 'Components kept', py: 'n_components', type: 'range', min: 1, max: 3, step: 1, value: 2, help: '3 keeps everything. 2 flattens onto a plane. 1 squashes onto a line.' },
        { key: 'collapse', label: 'Collapse', type: 'range', min: 0, max: 1, step: 0.01, value: 0, help: 'Slide to physically move each point onto its projection.' },
        { key: 'thick', label: 'Thickness of the cloud', type: 'range', min: 0, max: 1, step: 0.05, value: 0.25, help: 'How much the data spreads in its thinnest direction.', group: 'Data' },
    ],
    presets: [
        { label: '3D → 2D', values: { k: 2, collapse: 1 } },
        { label: '3D → 1D', values: { k: 1, collapse: 1 } },
        { label: 'Original', values: { collapse: 0 } },
    ],
    legend: `<span><i style="background:var(--c1)"></i>PC1 (most variance)</span><span><i style="background:var(--c0)"></i>PC2</span><span><i style="background:var(--c2)"></i>PC3 (least)</span>`,
    how: 'The arrows are the <b>principal components</b>: the directions in which the cloud is most stretched, longest first. Choose how many to keep, then press <b>Play</b> (or drag <b>Collapse</b>) to flatten every point onto them. The meter shows how much of the spread survives.',
    challenges: [
        { id: 'keep95', title: 'Go 3D → 2D and keep 95% of the variance', hint: 'With 2 components kept, collapse all the way. On a thin cloud (Pancake) almost nothing is lost: the third direction was mostly noise.', check: (s, P) => P.k === 2 && P.collapse >= 0.99 && s.vr >= 0.95 },
        { id: 'line', title: 'Squash everything onto a line', hint: 'Keep just 1 component and collapse fully. Every point lands on the PC1 axis. Try it on the Cigar.', check: (s, P) => P.k === 1 && P.collapse >= 0.99 },
        { id: 'ball', title: 'Find data where 2 components lose a lot', hint: 'PCA helps when the data is stretched. Pick a dataset (or thickness) where keeping 2 components retains less than 80% of the variance.', check: (s, P) => P.k === 2 && s.vr < 0.8 },
    ],
    code: String.raw`# Principal Component Analysis with scikit-learn
# X -> the 3D point cloud on the canvas (one row per point, columns x, y, z)
import numpy as np
from sklearn.decomposition import PCA

n_components = 2   # how many directions to keep (1, 2 or 3)

pca = PCA().fit(X)                     # find all 3 directions, longest first
ratio = pca.explained_variance_ratio_
print("variance share per component:", np.round(ratio, 3))
print(f"kept with {n_components}: {ratio[:n_components].sum():.1%}")

# the coordinates of each point along the kept directions
Z = pca.transform(X)[:, :n_components]
print("projected shape:", Z.shape)

result = {"components": pca.components_, "ratio": ratio,
          "variance": pca.explained_variance_, "mean": pca.mean_}
`,
    explain: String.raw`
<h3>The idea</h3>
<p>Real data often has more columns than it really needs. PCA finds the directions along which the data actually varies and lets you drop the rest, losing as little as possible.</p>
<div class="callout">A pancake in 3D is "really" 2D. PCA finds the plane of the pancake.</div>
<h3>Finding the directions</h3>
<p>Center the data by subtracting the mean, then build the <b>covariance matrix</b>:</p>
<div class="eq">\Sigma = \frac{1}{n-1}\sum_{i=1}^{n}(\mathbf{x}_i-\boldsymbol\mu)(\mathbf{x}_i-\boldsymbol\mu)^\top</div>
<p>Its eigenvectors <span class="tx">\mathbf{v}_1, \mathbf{v}_2, \mathbf{v}_3</span> are the arrows, <span class="t1">PC1</span>, <span class="t0">PC2</span>, <span class="t2">PC3</span>. Each eigenvalue <span class="tx">\lambda_j</span> is the variance along its arrow:</p>
<div class="eq">\Sigma\,\mathbf{v}_j = \lambda_j\,\mathbf{v}_j, \qquad \lambda_1 \ge \lambda_2 \ge \lambda_3</div>
<h3>Projecting</h3>
<p>Keeping <span class="tx">k</span> components replaces each point by its shadow on the span of the first <span class="tx">k</span> arrows:</p>
<div class="eq">\hat{\mathbf{x}} = \boldsymbol\mu + \sum_{j=1}^{k} \big((\mathbf{x}-\boldsymbol\mu)\cdot\mathbf{v}_j\big)\,\mathbf{v}_j</div>
<p>The numbers <span class="tx">(\mathbf{x}-\boldsymbol\mu)\cdot\mathbf{v}_j</span> are the new coordinates, shown in the 2D inset.</p>
<h3>How much survives</h3>
<div class="eq">\text{variance retained} = \frac{\lambda_1 + \dots + \lambda_k}{\lambda_1 + \lambda_2 + \lambda_3}</div>
<p>PCA only finds <b>straight</b> directions. On the <b>Swirl</b>, the structure is curved, so no flat plane captures it well.</p>
`,

    create(ctx) {
        const P = ctx.params;
        const th = ctx.three;
        const st = { kind: 'pancake', pts: [], mean: [0, 0, 0], comps: [], vals: [], py: false };
        let T = null;

        function analyse() {
            const n = st.pts.length;
            const m = [0, 0, 0];
            for (const p of st.pts) { m[0] += p.x; m[1] += p.y; m[2] += p.z; }
            m.forEach((_, i) => { m[i] /= n; });
            const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            for (const p of st.pts) {
                const d = [p.x - m[0], p.y - m[1], p.z - m[2]];
                for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (d[a] * d[b]) / (n - 1);
            }
            const e = eigSym(C);
            st.mean = m; st.comps = e.map((x) => x.vector); st.vals = e.map((x) => Math.max(0, x.value));
        }
        const total = () => st.vals.reduce((a, b) => a + b, 0) || 1;
        const vr = () => st.vals.slice(0, P.k).reduce((a, b) => a + b, 0) / total();
        const scores = (p) => { const d = [p.x - st.mean[0], p.y - st.mean[1], p.z - st.mean[2]]; return st.comps.map((v) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2]); };
        const w3 = (x, y, z) => new THREE.Vector3(x * S, y * S, z * S);

        // HUD: variance meter + 2D projection inset + PC labels
        const hud = ctx.hud;
        const meter = document.createElement('div');
        meter.className = 'meter glass';
        meter.style.top = '56px';
        hud.appendChild(meter);
        const inset = document.createElement('div');
        inset.className = 'inset glass';
        inset.innerHTML = '<span class="cap">Projection: PC1 × PC2</span><canvas></canvas>';
        hud.appendChild(inset);
        const icv = inset.querySelector('canvas'), ig = icv.getContext('2d');
        const labels = [0, 1, 2].map((i) => { const l = document.createElement('div'); l.className = 'floating-label'; l.style.background = PC_CSS[i]; hud.appendChild(l); return l; });

        function build() {
            const scene = th.newScene({ size: 8, camera: [5.4, 3.4, 5.8], target: [0, 0, 0] });
            th.grid.position.y = -2.0;
            const n = st.pts.length;
            const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshStandardMaterial({ roughness: 0.4 }), n);
            inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
            scene.add(inst);
            const arrows = PC_COL.map((c) => {
                const g = new THREE.Group();
                const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.7, transparent: true });
                const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1, 12), mat);
                const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 18), mat);
                const back = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 8), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35 }));
                const glow = halo(c, 0.7, 0.9);
                g.add(shaft, head, back, glow);
                scene.add(g);
                return { g, shaft, head, back, glow, mat };
            });
            const planeMat = new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
            const planeEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x818cf8, transparent: true, opacity: 0.5 }));
            scene.add(plane, planeEdge);
            T = { inst, arrows, plane, planeEdge, n };
        }

        function updateArrows() {
            const up = new THREE.Vector3(0, 1, 0);
            const o = w3(...st.mean);
            st.comps.forEach((v, i) => {
                const a = T.arrows[i];
                const dir = new THREE.Vector3(v[0], v[1], v[2]).normalize();
                const len = Math.max(0.15, 2.2 * Math.sqrt(st.vals[i]) * S);
                const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
                a.shaft.scale.set(1, len, 1); a.shaft.position.copy(o).addScaledVector(dir, len / 2); a.shaft.quaternion.copy(q);
                a.head.position.copy(o).addScaledVector(dir, len + 0.1); a.head.quaternion.copy(q);
                a.back.scale.set(1, len, 1); a.back.position.copy(o).addScaledVector(dir, -len / 2); a.back.quaternion.copy(q);
                a.glow.position.copy(a.head.position);
                const kept = i < P.k;
                a.mat.opacity = kept ? 1 : 0.28; a.glow.material.opacity = kept ? 0.9 : 0.15;
                a.tip = a.head.position.clone();
                a.g.visible = !ctx.hidden('arrows');
            });
            // the kept subspace
            const [v1, v2] = st.comps.map((v) => new THREE.Vector3(...v).normalize());
            const s1 = 2.6 * Math.sqrt(st.vals[0]) * S * 2, s2 = (P.k >= 2 ? 2.6 * Math.sqrt(st.vals[1]) * S * 2 : 0.04);
            const basis = new THREE.Matrix4().makeBasis(v1, v2, new THREE.Vector3().crossVectors(v1, v2));
            for (const m of [T.plane, T.planeEdge]) {
                m.position.copy(o); m.quaternion.setFromRotationMatrix(basis); m.scale.set(s1, s2, 1);
                m.visible = P.k < 3 && !ctx.hidden('plane');
            }
        }

        function draw() {
            if (!T || T.n !== st.pts.length) build();
            updateArrows();
            const m = new THREE.Matrix4(), col = new THREE.Color();
            const c1 = new THREE.Color(0x22d3ee), c2 = new THREE.Color(0xff6b57);
            const sd1 = Math.sqrt(st.vals[0]) || 1;
            const t = easeOut(P.collapse);
            st.pts.forEach((p, i) => {
                const sc = scores(p);
                const proj = [...st.mean];
                for (let j = 0; j < P.k; j++) for (let a = 0; a < 3; a++) proj[a] += sc[j] * st.comps[j][a];
                const x = p.x + (proj[0] - p.x) * t, y = p.y + (proj[1] - p.y) * t, z = p.z + (proj[2] - p.z) * t;
                m.setPosition(w3(x, y, z)); T.inst.setMatrixAt(i, m);
                col.copy(c1).lerp(c2, clamp(0.5 + sc[0] / (4 * sd1), 0, 1)); T.inst.setColorAt(i, col);
            });
            T.inst.instanceMatrix.needsUpdate = true; T.inst.instanceColor.needsUpdate = true;
            // floating labels at the arrow tips
            const tot = total();
            T.arrows.forEach((a, i) => {
                const s = th.project(a.tip);
                const l = labels[i];
                l.style.display = s.behind || ctx.hidden('arrows') ? 'none' : '';
                l.style.left = s.x + 'px'; l.style.top = s.y - 16 + 'px';
                l.style.opacity = i < P.k ? 1 : 0.45;
                l.textContent = `PC${i + 1} · ${pct(st.vals[i] / tot)}`;
            });
            drawMeter(); drawInset();
        }

        function drawMeter() {
            const tot = total(), v = vr();
            const bars = st.vals.map((x, i) => `<i style="width:${(x / tot) * 100}%;background:${PC_CSS[i]};opacity:${i < P.k ? 1 : 0.22}"></i>`).join('');
            const html = `Variance retained <b>${(v * 100).toFixed(1)}%</b> with ${P.k} of 3<div class="bar">${bars}</div>`;
            if (meter._h !== html) { meter.innerHTML = html; meter._h = html; }
        }
        function drawInset() {
            const r = icv.getBoundingClientRect();
            const dpr = Math.min(2, devicePixelRatio || 1);
            if (icv.width !== Math.round(r.width * dpr)) { icv.width = Math.round(r.width * dpr); icv.height = Math.round(r.height * dpr); }
            const C = ctx.colors();
            ig.setTransform(dpr, 0, 0, dpr, 0, 0);
            ig.clearRect(0, 0, r.width, r.height);
            const cx = r.width / 2, cy = r.height / 2 + 8;
            const sc = Math.min(r.width, r.height - 20) / (6 * Math.sqrt(st.vals[0] || 1));
            ig.strokeStyle = C.axis; ig.lineWidth = 1;
            ig.beginPath(); ig.moveTo(8, cy); ig.lineTo(r.width - 8, cy); ig.moveTo(cx, 22); ig.lineTo(cx, r.height - 6); ig.stroke();
            const sd1 = Math.sqrt(st.vals[0]) || 1;
            for (const p of st.pts) {
                const s = scores(p);
                const yv = P.k >= 2 ? s[1] : 0;
                const t = clamp(0.5 + s[0] / (4 * sd1), 0, 1);
                ig.fillStyle = t > 0.5 ? C.c[1] : C.c[0];
                ig.globalAlpha = 0.35 + Math.abs(t - 0.5);
                ig.beginPath(); ig.arc(cx + s[0] * sc, cy - yv * sc, 1.8, 0, Math.PI * 2); ig.fill();
            }
            ig.globalAlpha = 1;
        }

        th.on('hover', (e) => {
            if (!T) return;
            const hit = th.pick([T.inst], e)[0];
            if (!hit) return ctx.tooltip.hide();
            const p = st.pts[hit.instanceId], s = scores(p);
            ctx.tooltip.show(e.clientX, e.clientY - 8, `<span class="k">original</span> (${fmt(p.x, 2)}, ${fmt(p.y, 2)}, ${fmt(p.z, 2)})<br><span class="k">PC scores</span> <b>${s.map((v, i) => (i < P.k ? fmt(v, 2) : `<s>${fmt(v, 2)}</s>`)).join(', ')}</b>`);
        });
        th.on('leave', () => ctx.tooltip.hide());

        function load(kind) { st.kind = kind; st.pts = pcaCloud(kind, { thick: P.thick }); st.py = false; analyse(); T = null; }
        load('pancake');

        return {
            setParam(key) { if (key === 'thick') load(st.kind); },
            setDataset(kind) { load(kind); },
            step() { const v = Math.min(1, +(P.collapse + 0.02).toFixed(2)); ctx.set('collapse', v); return v < 1; },
            reset() { ctx.set('collapse', 0); },
            canPlay: () => P.collapse < 1,
            frame() { draw(); },
            metrics() { return [{ k: 'Variance retained', v: pct(vr()), cls: vr() >= 0.95 ? 'good' : vr() < 0.8 ? 'bad' : '' }, { k: 'Dimensions', v: `3 → ${P.k}` }, { k: 'Collapse', v: pct(P.collapse) }]; },
            state() { return { vr: vr() }; },
            pyData() { return { X: st.pts.map((p) => [p.x, p.y, p.z]) }; },
            onPython(r) {
                if (!r || !r.components) throw new Error('expected result = {"components": ..., "variance": ...}');
                st.comps = r.components.map((v) => v.slice(0, 3));
                st.vals = (r.variance || st.vals).slice(0, 3);
                if (r.mean) st.mean = r.mean.slice(0, 3);
                st.py = true;
                return 'Python: PCA components';
            },
            clearPython() { if (st.py) { analyse(); st.py = false; } },
            destroy() { hud.innerHTML = ''; },
        };
    },
};
