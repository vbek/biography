import { CLUSTER_SETS, clusters, TRUE_BLOBS } from '../core/data.js';
import { paintField, pointEditor, rgba } from '../core/plot2d.js';
import { rng, hexToRgb, easeOut, fmt } from '../core/math.js';
import { THREE, halo } from '../core/scene3d.js';
import { swatch } from './common.js';

const PAL3 = [0x22d3ee, 0xff6b57, 0xfbbf24, 0xa78bfa, 0x34d399, 0xf472b6, 0x60a5fa, 0xa3e635];
const S3 = 2.4;

export default {
    views: [{ id: '2d', label: '2D' }, { id: '3d', label: '3D' }],
    datasets: CLUSTER_SETS,
    defaultDataset: 'blobs',
    playback: { sps: 2.2 },
    hint: 'Step through assign → update · drag the ✕ centroids · click to add points',
    params: [
        { key: 'k', label: 'Number of clusters K', py: 'k', type: 'range', min: 1, max: 8, step: 1, value: 3, help: 'K-means must be told how many groups to look for.' },
        { key: 'init', label: 'Starting centroids', py: 'init', type: 'select', value: 'random', options: [{ value: 'random', label: 'Random points' }, { value: 'k-means++', label: 'k-means++' }], help: 'k-means++ spreads the starting centroids out, which usually avoids bad solutions.' },
        { key: 'regions', label: 'Cluster territories', type: 'toggle', value: true, group: 'Display' },
    ],
    actions: [{ id: 'reseed', label: 'New random start', secondary: true }],
    presets: [
        { label: 'K = 4 on blobs', values: { k: 4 }, dataset: 'blobs' },
        { label: 'K = 2 on moons', values: { k: 2 }, dataset: 'moons' },
        { label: '3D blobs', values: { k: 4 }, dataset: 'blobs', view: '3d' },
    ],
    legend: `<span><b>✕</b> centroid (cluster centre)</span><span><i style="background:var(--text-faint)"></i>not assigned yet</span><span>Colored shading = which centroid is closest</span>`,
    how: 'K-means alternates two moves. <b>Assign:</b> every point joins its nearest centroid. <b>Update:</b> every centroid jumps to the average of its points. Press <b>Step</b> to do one move at a time, or <b>Play</b>. Drag a centroid to give it a bad start and see what happens.',
    challenges: [
        { id: 'converge', title: 'Run K-means until it converges', hint: 'Press Play (or keep pressing Step) until the assignments stop changing. The status pill turns green.', check: (s) => s.converged },
        { id: 'match', title: 'Find the true number of blobs', hint: 'On Blobs, set K to the number of groups you can see and run to convergence. Watch the inertia (total squared distance) drop sharply at the right K.', check: (s, P) => s.dataset === 'blobs' && P.k === TRUE_BLOBS && s.converged },
        { id: 'cloud', title: 'Converge in 3D', hint: 'Switch to the 3D view and run K-means on the point cloud. Orbit around to check each cluster really is one group.', check: (s) => s.view === '3d' && s.converged },
    ],
    code: String.raw`# K-means clustering with scikit-learn
# X -> the points on the canvas (2 columns in 2D view, 3 in 3D view)
# no labels needed: k-means finds the groups by itself
from sklearn.cluster import KMeans

k = 3              # how many clusters to look for
init = 'random'    # or 'k-means++'

model = KMeans(n_clusters=k, init=init, n_init=1, random_state=seed)
model.fit(X)

print("iterations :", model.n_iter_)
print("inertia    :", round(model.inertia_, 3), "(sum of squared distances)")
print("cluster sizes:", [int((model.labels_ == c).sum()) for c in range(k)])

result = {"centers": model.cluster_centers_, "labels": model.labels_,
          "inertia": model.inertia_}
`,
    explain: String.raw`
<h3>The idea</h3>
<p>Here nobody tells the model which group a point belongs to. K-means invents <b>K</b> group centres, called <b>centroids</b>, and moves them until each sits in the middle of its own crowd.</p>
<h3>Two moves, repeated</h3>
<ol>
<li><b>Assign</b>: each point joins the nearest centroid. The colored territories show who is nearest to what.</li>
<li><b>Update</b>: each centroid moves to the mean of the points that joined it:
<div class="eq">\boldsymbol{\mu}_k = \frac{1}{|C_k|}\sum_{\mathbf{x}\in C_k}\mathbf{x}</div></li>
</ol>
<p>When an assign step changes nothing, the algorithm has <b>converged</b>.</p>
<h3>What it minimises</h3>
<p>Both moves can only lower the <b>inertia</b>, the total squared distance from points to their centroid:</p>
<div class="eq">J = \sum_{k=1}^{K}\sum_{\mathbf{x}\in C_k}\lVert \mathbf{x}-\boldsymbol{\mu}_k\rVert^2</div>
<p>So it always stops, but not always at the best answer. A bad start can leave two centroids sharing one blob while another blob is split. Try <i>New random start</i> a few times, or switch to <b>k-means++</b>.</p>
<h3>Its blind spots</h3>
<p>Territories are always split by straight lines halfway between centroids, so k-means looks for round, similar-sized blobs. On <b>Moons</b> or <b>Circles</b> it cuts the shapes in the wrong place, even with the "right" K.</p>
`,

    create(ctx) {
        const P = ctx.params;
        const plot = ctx.plot;
        const st = { kind: 'blobs', pts: [], cents: [], labels: [], phase: 'assign', iter: 0, converged: false, seed: 1, flashT: 0, py: false };
        const dims = () => (ctx.view === '3d' ? 3 : 2);
        const d2 = (p, c) => { const dx = p.x - c.x, dy = p.y - c.y, dz = dims() === 3 ? p.z - c.z : 0; return dx * dx + dy * dy + dz * dz; };

        function init() {
            const r = rng(st.seed * 7919 + P.k * 31);
            const pts = st.pts;
            const cents = [];
            if (P.init === 'k-means++' && pts.length) {
                cents.push({ ...pts[Math.floor(r() * pts.length)] });
                while (cents.length < P.k) {
                    const ds = pts.map((p) => Math.min(...cents.map((c) => d2(p, c))));
                    let t = r() * ds.reduce((a, b) => a + b, 0), i = 0;
                    while (i < ds.length - 1 && (t -= ds[i]) > 0) i++;
                    cents.push({ ...pts[i] });
                }
            } else {
                const used = new Set();
                while (cents.length < Math.min(P.k, pts.length)) { const i = Math.floor(r() * pts.length); if (!used.has(i)) { used.add(i); cents.push({ ...pts[i] }); } }
            }
            st.cents = cents.map((c) => ({ x: c.x, y: c.y, z: c.z, fx: c.x, fy: c.y, fz: c.z, t0: 0 }));
            st.labels = pts.map(() => -1);
            st.phase = 'assign'; st.iter = 0; st.converged = false; st.py = false;
            ctx.changed();
        }

        function assign() {
            let changed = 0;
            st.pts.forEach((p, i) => {
                let best = 0, bd = Infinity;
                st.cents.forEach((c, k) => { const d = d2(p, c); if (d < bd) { bd = d; best = k; } });
                if (st.labels[i] !== best) changed++;
                st.labels[i] = best;
            });
            st.flashT = performance.now();
            return changed;
        }
        function update() {
            const now = performance.now();
            st.cents.forEach((c, k) => {
                let sx = 0, sy = 0, sz = 0, n = 0;
                st.pts.forEach((p, i) => { if (st.labels[i] === k) { sx += p.x; sy += p.y; sz += p.z; n++; } });
                const cur = shown(c);
                c.fx = cur.x; c.fy = cur.y; c.fz = cur.z; c.t0 = now;
                if (n) { c.x = sx / n; c.y = sy / n; c.z = sz / n; }
            });
        }
        function step() {
            if (st.converged) return false;
            if (st.phase === 'assign') {
                const ch = assign();
                st.phase = 'update';
                if (ch === 0 && st.iter > 0) { st.converged = true; ctx.flash('Converged ✓', ctx.colors().ok); return false; }
            } else { update(); st.iter++; st.phase = 'assign'; }
            return true;
        }
        const shown = (c) => {
            const t = c.t0 ? Math.min(1, (performance.now() - c.t0) / 480) : 1, e = easeOut(t);
            return { x: c.fx + (c.x - c.fx) * e, y: c.fy + (c.y - c.fy) * e, z: c.fz + (c.z - c.fz) * e };
        };
        const inertia = () => {
            let s = 0;
            st.pts.forEach((p, i) => { const k = st.labels[i]; if (k >= 0 && st.cents[k]) s += d2(p, st.cents[k]); });
            return s;
        };

        // ---------- 2D ----------
        let dragC = null;
        const editor = pointEditor(plot, ctx, {
            points: () => (ctx.view === '2d' ? st.pts : []),
            grabExtra: (p) => {
                if (ctx.view !== '2d') return null;
                const c = st.cents.find((c) => { const s = shown(c); return Math.hypot(plot.sx(s.x) - p.px, plot.sy(s.y) - p.py) < 14; });
                if (!c) return null;
                c.t0 = 0; dragC = c;
                return c;
            },
            spawn: (x, y) => { const p = { x, y, z: (Math.random() - 0.5) * 0.4, t: -1 }; st.pts.push(p); st.labels.push(-1); return p; },
            remove: (p) => { const i = st.pts.indexOf(p); st.pts.splice(i, 1); st.labels.splice(i, 1); },
            color: () => ctx.colors().muted,
            changed: (kind) => { if (dragC) { dragC.fx = dragC.x; dragC.fy = dragC.y; } if (kind === 'dragend') dragC = null; st.converged = false; st.phase = 'assign'; st.py = false; ctx.pyCleared(); ctx.changed(); },
            info: (p) => { const k = st.labels[st.pts.indexOf(p)]; const C = ctx.colors(); return `${k >= 0 ? swatch(C.c[k]) + `<span class="k">cluster ${k + 1}</span>` : '<span class="k">not assigned yet</span>'}<br>(${fmt(p.x, 2)}, ${fmt(p.y, 2)})`; },
        });

        function draw2d() {
            const C = ctx.colors();
            const g = plot.begin(C);
            const sc = st.cents.map(shown);
            if (P.regions && sc.length && !ctx.hidden('regions')) {
                const rgb = C.c.map(hexToRgb);
                const grid = plot.sampleGrid(90);
                const img = paintField(grid.cols, grid.rows, (i, j, k) => {
                    const x = grid.pts[2 * k], y = grid.pts[2 * k + 1];
                    let best = 0, bd = Infinity;
                    sc.forEach((c, q) => { const d = (x - c.x) ** 2 + (y - c.y) ** 2; if (d < bd) { bd = d; best = q; } });
                    const col = rgb[best % 8];
                    return [col[0], col[1], col[2], 52];
                });
                plot.field(img);
            }
            plot.grid({ labels: false });
            // assignment flash lines
            const fa = Math.max(0, 1 - (performance.now() - st.flashT) / 700);
            if (fa > 0) {
                st.pts.forEach((p, i) => {
                    const k = st.labels[i]; if (k < 0) return;
                    g.strokeStyle = rgba(C.c[k % 8], 0.45 * fa); g.lineWidth = 1;
                    g.beginPath(); g.moveTo(plot.sx(p.x), plot.sy(p.y)); g.lineTo(plot.sx(sc[k].x), plot.sy(sc[k].y)); g.stroke();
                });
            }
            st.pts.forEach((p, i) => { const k = st.labels[i]; plot.point(p.x, p.y, k >= 0 ? C.c[k % 8] : C.faint, { r: 4.5, hot: p === editor.hot }); });
            if (!ctx.hidden('centroids')) sc.forEach((c, k) => {
                const X = plot.sx(c.x), Y = plot.sy(c.y), col = C.c[k % 8];
                g.save(); g.shadowColor = col; g.shadowBlur = 20;
                g.fillStyle = col; g.beginPath(); g.arc(X, Y, 11, 0, Math.PI * 2); g.fill(); g.restore();
                g.strokeStyle = C.ring; g.lineWidth = 2.5; g.beginPath(); g.arc(X, Y, 11, 0, Math.PI * 2); g.stroke();
                g.strokeStyle = '#fff'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(X - 4.5, Y - 4.5); g.lineTo(X + 4.5, Y + 4.5); g.moveTo(X + 4.5, Y - 4.5); g.lineTo(X - 4.5, Y + 4.5); g.stroke();
            });
            plot.drawRipples();
        }

        // ---------- 3D ----------
        const th = ctx.three;
        let T = null;
        function build3d() {
            const scene = th.newScene({ size: 6, camera: [4.6, 3.6, 5.4], target: [0, 0, 0] });
            th.grid.position.y = -S3 * 0.55;
            const n = st.pts.length;
            const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshStandardMaterial({ roughness: 0.4 }), Math.max(1, n));
            inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
            scene.add(inst);
            const centG = new THREE.OctahedronGeometry(0.13, 0);
            const cents = [], halos = [];
            for (let k = 0; k < 8; k++) {
                const m = new THREE.Mesh(centG, new THREE.MeshStandardMaterial({ color: PAL3[k], emissive: PAL3[k], emissiveIntensity: 0.8 }));
                const h = halo(PAL3[k], 0.9, 0.8);
                scene.add(m, h); cents.push(m); halos.push(h);
            }
            const lg = new THREE.BufferGeometry();
            const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }));
            scene.add(lines);
            T = { inst, cents, halos, lg, lines, n };
        }
        const w3 = (p) => new THREE.Vector3(p.x * S3, p.z * S3, -p.y * S3);
        function draw3d() {
            if (!T || T.n !== st.pts.length) build3d();
            const m = new THREE.Matrix4(), col = new THREE.Color();
            st.pts.forEach((p, i) => {
                m.setPosition(w3(p)); T.inst.setMatrixAt(i, m);
                const k = st.labels[i];
                col.set(k >= 0 ? PAL3[k % 8] : 0x64748b); T.inst.setColorAt(i, col);
            });
            T.inst.instanceMatrix.needsUpdate = true; T.inst.instanceColor.needsUpdate = true;
            const sc = st.cents.map(shown);
            const t = performance.now() / 1000;
            T.cents.forEach((c, k) => {
                const on = k < sc.length && !ctx.hidden('centroids'); c.visible = on; T.halos[k].visible = on;
                if (!on) return;
                const v = w3(sc[k]); c.position.copy(v); T.halos[k].position.copy(v);
                c.rotation.y = t * 1.2 + k; c.rotation.x = t * 0.7;
            });
            const fa = Math.max(0, 1 - (performance.now() - st.flashT) / 700);
            const segs = [], cols = [];
            if (fa > 0) st.pts.forEach((p, i) => {
                const k = st.labels[i]; if (k < 0) return;
                const a = w3(p), b = w3(sc[k]); segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
                col.set(PAL3[k % 8]).multiplyScalar(fa); cols.push(col.r, col.g, col.b, col.r, col.g, col.b);
            });
            T.lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
            T.lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        }
        th.on('hover', (e) => {
            if (ctx.view !== '3d' || !T) return;
            const hit = th.pick([T.inst], e)[0];
            if (!hit) return ctx.tooltip.hide();
            const p = st.pts[hit.instanceId], k = st.labels[hit.instanceId];
            ctx.tooltip.show(e.clientX, e.clientY - 8, `${k >= 0 ? `<span class="k">cluster ${k + 1}</span>` : '<span class="k">not assigned yet</span>'}<br>(${fmt(p.x, 2)}, ${fmt(p.y, 2)}, ${fmt(p.z, 2)})`);
        });
        th.on('leave', () => ctx.tooltip.hide());

        function load(kind) { st.kind = kind; st.pts = clusters(kind); T = null; if (ctx.view === '3d') build3d(); init(); }
        load('blobs');

        return {
            setParam(key) { if (key === 'k' || key === 'init') init(); },
            setDataset(kind) { load(kind); },
            setView(v) { if (v === '3d') build3d(); init(); },
            action(id) { if (id === 'reseed') { st.seed++; init(); ctx.pyCleared(); } },
            step,
            reset() { init(); },
            canPlay: () => !st.converged,
            frame() { if (ctx.view === '3d') draw3d(); else draw2d(); },
            metrics() {
                const I = inertia();
                return [{ k: 'Iteration', v: st.iter }, { k: 'Next', v: st.converged ? 'done' : st.phase }, { k: 'Inertia', v: st.labels.some((l) => l >= 0) ? fmt(I, 2) : '—' }, { k: 'Status', v: st.converged ? 'Converged' : 'Running', cls: st.converged ? 'good' : '' }];
            },
            state() { return { converged: st.converged, inertia: inertia(), phase: st.phase, iter: st.iter }; },
            pyData() { return { X: st.pts.map((p) => (dims() === 3 ? [p.x, p.y, p.z] : [p.x, p.y])), seed: st.seed }; },
            onPython(r) {
                if (!r || !r.centers) throw new Error('expected result = {"centers": ..., "labels": ...}');
                const now = performance.now();
                st.cents = r.centers.map((c, k) => { const old = st.cents[k] ? shown(st.cents[k]) : { x: c[0], y: c[1], z: c[2] || 0 }; return { x: c[0], y: c[1], z: c[2] ?? 0, fx: old.x, fy: old.y, fz: old.z ?? 0, t0: now }; });
                if (r.labels) st.labels = r.labels.slice();
                st.flashT = now; st.converged = true; st.phase = 'assign'; st.py = true;
                return `Python: KMeans (k=${r.centers.length})`;
            },
            clearPython() { if (st.py) init(); },
            destroy() { editor.destroy(); },
        };
    },
};
