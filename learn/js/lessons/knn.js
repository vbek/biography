import { CLASS_SETS, classification } from '../core/data.js';
import { paintField, rgba } from '../core/plot2d.js';
import { hexToRgb } from '../core/math.js';
import { regionImage, drawClassPoints, classData, pyGrid, classEditor, swatch, accMetric, fmt, pct } from './common.js';

const nClasses = (kind) => (kind === 'blobs' ? 3 : 2);

export default {
    views: [{ id: '2d', label: '2D' }],
    datasets: CLASS_SETS,
    defaultDataset: 'moons',
    classes: 2,
    hint: 'Hover to see the vote · click to add a point (pick its color top-left) · drag to move',
    params: [
        { key: 'k', label: 'K (neighbours)', py: 'k', type: 'range', min: 1, max: 30, step: 1, value: 5, help: 'How many of the closest training points get a vote.' },
        { key: 'metric', label: 'Distance', py: 'metric', type: 'select', value: 'euclidean', options: [{ value: 'euclidean', label: 'Euclidean' }, { value: 'manhattan', label: 'Manhattan' }], help: 'Euclidean is the straight-line distance. Manhattan walks along the grid, so "circles" become diamonds.' },
        { key: 'weights', label: 'Vote weighting', py: 'weights', type: 'select', value: 'uniform', options: [{ value: 'uniform', label: 'Equal votes' }, { value: 'distance', label: 'Closer = louder' }] },
        { key: 'regions', label: 'Decision regions', type: 'toggle', value: true, group: 'Display' },
    ],
    presets: [
        { label: 'K = 1 (Voronoi)', values: { k: 1, weights: 'uniform' }, title: 'Every region belongs to its single nearest point' },
        { label: 'K = 7', values: { k: 7 } },
        { label: 'K = 25 (smooth)', values: { k: 25 } },
    ],
    legend: `<span><i style="background:var(--c0)"></i>class A</span><span><i style="background:var(--c1)"></i>class B</span><span><i style="background:var(--c2)"></i>class C (Blobs)</span><span><i style="border:2px solid var(--text-muted)"></i>hollow = test point (never votes)</span>`,
    how: 'Move your cursor over the canvas: glowing lines connect to the <b>K</b> nearest training points, and the dashed ring shows how far the vote reaches. Click to add a point of the selected color (keys <kbd>1</kbd>–<kbd>3</kbd> switch color). Drag points, double-click to delete.',
    challenges: [
        { id: 'k1', title: 'Make it overfit with K = 1', hint: 'Set K to 1. Every training point now wins its own little island, so training accuracy hits 100%, but the hollow test points are scored lower.', check: (s, P) => P.k === 1 && s.train === 1 && s.test < 1 },
        { id: 'beat', title: 'Find a K that beats K = 1 on test data', hint: 'First try K = 1, then slide K up. Averaging over more neighbours smooths out noise. Find a K whose test accuracy is higher than K = 1’s. (Moons and Circles have the most noise to smooth.)', check: (s, P) => s.triedK1 && P.k > 1 && s.test > s.testK1 + 1e-9 },
        { id: 'plant', title: 'Plant 5 points of your own', hint: 'Pick a color top-left and click on the canvas five times. Try planting points of the "wrong" color inside a region and watch it bend.', check: (s) => s.spawned >= 5 },
    ],
    code: String.raw`# K-Nearest Neighbors with scikit-learn
# X, y          -> training points on the canvas (filled dots)
# X_test, y_test -> test points (hollow dots)
# grid          -> a grid of locations covering the canvas, to paint the regions
from sklearn.neighbors import KNeighborsClassifier

k = 5                  # how many neighbours vote
metric = 'euclidean'   # or 'manhattan'
weights = 'uniform'    # or 'distance' (closer neighbours count more)

model = KNeighborsClassifier(n_neighbors=k, metric=metric, weights=weights)
model.fit(X, y)        # "training" just memorises the points

print("train accuracy:", round(model.score(X, y), 3))
print("test accuracy :", round(model.score(X_test, y_test), 3))

# predict a probability for every grid location and send it to the canvas
result = {"proba": model.predict_proba(grid), "classes": model.classes_}
`,
    explain: String.raw`
<h3>The idea</h3>
<p>To classify a new point, KNN does not learn a formula. It looks at the <b>K</b> closest <span class="t0">training</span> <span class="t1">points</span> and lets them vote. The majority wins.</p>
<div class="callout">Hover over the canvas. The glowing lines are the voters; the dashed ring is the distance to the K-th closest one.</div>
<h3>Distance</h3>
<p>"Closest" needs a distance. The usual choice is the straight line (Euclidean):</p>
<div class="eq">d(\mathbf{a},\mathbf{b}) = \sqrt{(a_1-b_1)^2 + (a_2-b_2)^2}</div>
<p>Manhattan distance adds up the steps along each axis instead: <span class="tx">|a_1-b_1| + |a_2-b_2|</span>.</p>
<h3>The vote</h3>
<p>For a point <span class="tx">x</span> with neighbours <span class="tx">N_K(x)</span>, the predicted probability of class <span class="tx">c</span> is the share of votes it gets:</p>
<div class="eq">P(c \mid x) = \frac{1}{K}\sum_{i \in N_K(x)} \mathbf{1}[y_i = c]</div>
<p>With <i>Closer = louder</i>, each vote is weighted by <span class="tx">1/d</span>.</p>
<h3>Choosing K</h3>
<ul>
<li><b>K = 1</b> splits the plane into one cell per point (a Voronoi diagram). It gets every training point right but follows every bit of noise: <b>overfitting</b>.</li>
<li><b>Large K</b> averages over many points: smooth regions, but small details get washed out: <b>underfitting</b>.</li>
</ul>
<p>The sweet spot sits in between, and the hollow <b>test</b> points tell you where.</p>
`,

    create(ctx) {
        const P = ctx.params;
        const plot = ctx.plot;
        const st = { kind: 'moons', pts: [], cur: null, field: null, dirty: true, py: null, spawned: 0, lastCalc: 0, ver: 0 };

        function load(kind) {
            st.kind = kind;
            st.pts = classification(kind, { n: kind === 'blobs' ? 150 : 160, seed: kind === 'moons' ? 13 : 7, noise: kind === 'moons' || kind === 'circles' ? 3.5 : 1.6 });
            ctx.setClasses(nClasses(kind));
            st.dirty = true; st.py = null; st.ver++;
        }

        const dist = (ax, ay, bx, by) => (P.metric === 'manhattan' ? Math.abs(ax - bx) + Math.abs(ay - by) : Math.hypot(ax - bx, ay - by));

        /** K nearest training points (optionally skipping one point). */
        function neighbours(x, y, K = P.k, skip = null) {
            const best = [];
            for (const p of st.pts) {
                if (p.test || p === skip) continue;
                const d = dist(x, y, p.x, p.y);
                if (best.length < K) { best.push({ p, d }); best.sort((a, b) => a.d - b.d); }
                else if (d < best[K - 1].d) { best[K - 1] = { p, d }; best.sort((a, b) => a.d - b.d); }
            }
            return best;
        }
        function proba(x, y, K = P.k, nb = null) {
            const n = nClasses(st.kind);
            const v = new Array(n).fill(0);
            nb = nb || neighbours(x, y, K);
            let tot = 0;
            for (const { p, d } of nb) { const w = P.weights === 'distance' ? 1 / Math.max(d, 1e-6) : 1; v[p.c] += w; tot += w; }
            return tot ? v.map((a) => a / tot) : v.map(() => 1 / n);
        }
        const argmax = (a) => a.reduce((bi, v, i) => (v > a[bi] ? i : bi), 0);
        const predict = (x, y, K) => argmax(proba(x, y, K));

        function scores(K = P.k) {
            let tr = 0, trN = 0, te = 0, teN = 0;
            for (const p of st.pts) {
                const ok = predict(p.x, p.y, K) === p.c ? 1 : 0;
                if (p.test) { te += ok; teN++; } else { tr += ok; trN++; }
            }
            return { train: trN ? tr / trN : NaN, test: teN ? te / teN : NaN };
        }

        const editor = classEditor(plot, ctx, () => st.pts, {
            onChange: (kind) => { st.dirty = true; st.ver++; st.py = null; ctx.pyCleared(); if (kind === 'spawn') st.spawned++; },
            hover: (p) => { st.cur = p ? { x: p.x, y: p.y } : null; },
            info: (p) => {
                const C = ctx.colors();
                const pr = proba(p.x, p.y, P.k, p.test ? null : neighbours(p.x, p.y, P.k));
                const k = argmax(pr);
                return `${swatch(C.c[p.c])}<span class="k">${p.test ? 'test' : 'training'} point · class ${'ABC'[p.c]}</span><br>(${fmt(p.x, 2)}, ${fmt(p.y, 2)}) → predicted ${swatch(C.c[k])}<b>${'ABC'[k]}</b> ${pct(pr[k])}`;
            },
        });
        // tooltip for empty space: the vote
        plot.on('hover', (p) => {
            if (editor.hot || editor.dragging) return;
            const C = ctx.colors();
            const nb = neighbours(p.x, p.y);
            const pr = proba(p.x, p.y, P.k, nb);
            const counts = pr.map((_, c) => nb.filter((q) => q.p.c === c).length);
            const k = argmax(pr);
            const parts = counts.map((n, c) => (n ? `${swatch(C.c[c])}<b>${n}</b>` : '')).filter(Boolean).join(' &nbsp;');
            ctx.tooltip.showAt(plot.canvas, p.px, p.py - 10, `<span class="k">K = ${P.k} vote</span> ${parts}<br>→ ${swatch(C.c[k])}<b>class ${'ABC'[k]}</b> <span class="k">(${pct(pr[k])})</span>`);
        });

        function computeField() {
            const C = ctx.colors();
            const cols = editor.dragging ? 70 : 120;
            st.field = regionImage(plot, cols, (x, y) => proba(x, y), C, { alpha: 0.38 });
            st.dirty = false;
        }

        function drawRadar(g, C) {
            if (!st.cur) return;
            const { x, y } = st.cur;
            const nb = neighbours(x, y);
            if (!nb.length) return;
            const X = plot.sx(x), Y = plot.sy(y);
            const t = performance.now();
            const R = nb[nb.length - 1].d * plot.scale;
            // reach ring
            g.save();
            g.setLineDash([5, 6]); g.lineDashOffset = -t / 50;
            g.strokeStyle = rgba(C.c[2], 0.75); g.lineWidth = 1.5;
            g.beginPath();
            if (P.metric === 'manhattan') { g.moveTo(X, Y - R); g.lineTo(X + R, Y); g.lineTo(X, Y + R); g.lineTo(X - R, Y); g.closePath(); }
            else g.arc(X, Y, R, 0, Math.PI * 2);
            g.stroke();
            g.restore();
            // radar sweep
            g.save();
            const ang = (t / 900) % (Math.PI * 2);
            const grad = g.createConicGradient ? g.createConicGradient(ang, X, Y) : null;
            if (grad) {
                grad.addColorStop(0, rgba(C.c[2], 0.16)); grad.addColorStop(0.12, rgba(C.c[2], 0)); grad.addColorStop(1, rgba(C.c[2], 0));
                g.fillStyle = grad; g.beginPath(); g.arc(X, Y, R, 0, Math.PI * 2); g.fill();
            }
            g.restore();
            // glowing links
            for (const { p, d } of nb) {
                const px = plot.sx(p.x), py = plot.sy(p.y), col = C.c[p.c];
                g.save();
                g.shadowColor = col; g.shadowBlur = 12;
                g.strokeStyle = rgba(col, 0.85); g.lineWidth = 2;
                g.beginPath(); g.moveTo(X, Y); g.lineTo(px, py); g.stroke();
                g.restore();
                // pulse travelling outwards
                const f = ((t / 700) + d * 3) % 1;
                g.fillStyle = col;
                g.beginPath(); g.arc(X + (px - X) * f, Y + (py - Y) * f, 2.6, 0, Math.PI * 2); g.fill();
                g.strokeStyle = col; g.lineWidth = 2;
                g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.stroke();
            }
            // cursor: pie of the vote
            const pr = proba(x, y, P.k, nb);
            let a0 = -Math.PI / 2;
            pr.forEach((v, c) => { if (!v) return; g.fillStyle = C.c[c]; g.beginPath(); g.moveTo(X, Y); g.arc(X, Y, 9, a0, a0 + v * Math.PI * 2); g.closePath(); g.fill(); a0 += v * Math.PI * 2; });
            g.strokeStyle = C.ring; g.lineWidth = 2; g.beginPath(); g.arc(X, Y, 9, 0, Math.PI * 2); g.stroke();
        }

        load('moons');
        let lastVersion = -1;

        return {
            setParam() { st.dirty = true; st.ver++; },
            setDataset(kind) { load(kind); },
            frame() {
                const C = ctx.colors();
                if (plot.version !== lastVersion) { st.dirty = true; lastVersion = plot.version; }
                if (st.dirty && P.regions) computeField();
                const g = plot.begin(C);
                if (P.regions && !ctx.hidden('regions')) plot.field(st.py ? st.py.img : st.field.img);
                plot.grid({ labels: false });
                drawClassPoints(plot, st.pts, C, editor.hot);
                if (!ctx.hidden('radar')) drawRadar(g, C);
                plot.drawRipples();
            },
            metrics() {
                const s = scores();
                return [{ k: 'K', v: P.k }, accMetric('Train acc', s.train), accMetric('Test acc', s.test)];
            },
            state() {
                const s = scores();
                if (P.k === 1) st.triedK1 = true;
                if (st.testK1 == null || st.k1Ver !== st.ver) { st.testK1 = scores(1).test; st.k1Ver = st.ver; }
                return { train: s.train, test: s.test, testK1: st.testK1, spawned: st.spawned, triedK1: !!st.triedK1 };
            },
            pyData() {
                const g = pyGrid(plot, 80);
                st.pyGrid = g;
                return { ...classData(st.pts), grid: g.grid };
            },
            onPython(r) {
                if (!r || !r.proba) throw new Error('expected result = {"proba": ..., "classes": ...}');
                const C = ctx.colors();
                const rgb = C.c.map(hexToRgb);
                const { cols, rows } = st.pyGrid;
                const cls = r.classes || r.proba[0].map((_, i) => i);
                const img = paintField(cols, rows, (i, j, k) => {
                    const pr = r.proba[k] || [];
                    let R = 0, G = 0, B = 0, best = 0, second = 0;
                    pr.forEach((v, c) => { const col = rgb[cls[c]] || rgb[0]; R += col[0] * v; G += col[1] * v; B += col[2] * v; if (v > best) { second = best; best = v; } else if (v > second) second = v; });
                    return [R, G, B, 255 * 0.38 * (0.3 + 0.7 * Math.min(1, (best - second) * 1.4))];
                });
                st.py = { img };
                return `Python: KNeighborsClassifier (k=${P.k})`;
            },
            clearPython() { st.py = null; },
            destroy() { editor.destroy(); },
        };
    },
};
