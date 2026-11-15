import { CLASS_SETS, classification } from '../core/data.js';
import { rgba } from '../core/plot2d.js';
import { clamp, easeOut } from '../core/math.js';
import { drawClassPoints, classData, classEditor, swatch, accMetric, fmt, pct } from './common.js';

const nClasses = (kind) => (kind === 'blobs' ? 3 : 2);
const AX = ['x', 'y'];

export default {
    views: [{ id: '2d', label: '2D' }],
    datasets: CLASS_SETS,
    defaultDataset: 'moons',
    classes: 2,
    playback: { sps: 1.4 },
    hint: 'Press Play to grow the tree level by level · hover a region to read its rule',
    params: [
        { key: 'depth', label: 'Max depth', py: 'max_depth', type: 'range', min: 1, max: 12, step: 1, value: 3, help: 'How many questions in a row the tree may ask. Each level can split every box in two.' },
        { key: 'minLeaf', label: 'Min samples per leaf', py: 'min_samples_leaf', type: 'range', min: 1, max: 25, step: 1, value: 1, help: 'A split is only allowed if both sides keep at least this many training points.' },
        { key: 'criterion', label: 'Split quality', py: 'criterion', type: 'select', value: 'gini', options: [{ value: 'gini', label: 'Gini' }, { value: 'entropy', label: 'Entropy' }] },
    ],
    presets: [
        { label: 'Stump (depth 1)', values: { depth: 1, minLeaf: 1 } },
        { label: 'Balanced', values: { depth: 4, minLeaf: 4 } },
        { label: 'Overgrown', values: { depth: 12, minLeaf: 1 } },
    ],
    legend: `<span><i style="background:var(--c0)"></i>class A</span><span><i style="background:var(--c1)"></i>class B</span><span><i style="background:var(--c2)"></i>class C</span><span>Region shade = how pure the box is</span>`,
    how: 'Each split line is one yes/no question like <b>“is x ≤ 0.3?”</b>. Press <b>Reset</b> then <b>Play</b> (or <b>Step</b>) to watch the tree carve the plane one level at a time. Drag points and the tree regrows instantly.',
    challenges: [
        { id: 'stump', title: 'Underfit with a single split', hint: 'Set Max depth to 1. One straight cut is all the tree gets, so it cannot follow the curved classes. That is underfitting.', check: (s, P) => P.depth === 1 && s.shown === 1 },
        { id: 'overfit', title: 'Make it overfit', hint: 'Raise Max depth and set Min samples per leaf to 1. When every training point sits in a perfectly pure box (100% train accuracy) but test accuracy is lower, the tree has memorised noise.', check: (s) => s.train === 1 && s.test < 0.999 },
        { id: 'sweet', title: 'Beat the overgrown tree on test data', hint: 'Find a smaller tree (lower depth, or a bigger minimum leaf) whose test accuracy is higher than the fully grown tree’s.', check: (s) => s.test > s.testDeep + 1e-9 },
    ],
    code: String.raw`# Decision tree with scikit-learn
# X, y -> training points; X_test, y_test -> hollow test points
from sklearn.tree import DecisionTreeClassifier, export_text

max_depth = 3          # how many questions in a row
min_samples_leaf = 1   # smallest allowed box
criterion = 'gini'     # or 'entropy'

model = DecisionTreeClassifier(max_depth=max_depth,
                               min_samples_leaf=min_samples_leaf,
                               criterion=criterion, random_state=0)
model.fit(X, y)

print(export_text(model, feature_names=["x", "y"], max_depth=3))
print("depth :", model.get_depth(), " leaves:", model.get_n_leaves())
print("train accuracy:", round(model.score(X, y), 3))
print("test accuracy :", round(model.score(X_test, y_test), 3))

# send the tree's structure back so the canvas can draw its splits
t = model.tree_
result = {"feature": t.feature, "threshold": t.threshold,
          "left": t.children_left, "right": t.children_right,
          "value": t.value[:, 0, :], "samples": t.n_node_samples,
          "classes": model.classes_}
`,
    explain: String.raw`
<h3>The idea</h3>
<p>A decision tree plays twenty questions with your data. Each question looks at one feature and a threshold, like <span class="tx">x \le 0.3</span>, and sends the point left or right. After a few questions, every point lands in a box (a <b>leaf</b>) that predicts the majority class inside it.</p>
<div class="callout">Every split line on the canvas is axis-aligned, because each question looks at only one feature. That is why trees draw "staircase" boundaries.</div>
<h3>Picking the best question</h3>
<p>At each box the tree tries every feature and every threshold, and keeps the split that makes the two halves as <b>pure</b> as possible. Purity is measured by the Gini impurity:</p>
<div class="eq">G = 1 - \sum_{c} p_c^2</div>
<p>where <span class="tx">p_c</span> is the share of class <span class="tx">c</span> in the box. A box with only <span class="t0">A</span> points has <span class="tx">G = 0</span>; a 50/50 mix has <span class="tx">G = 0.5</span>. The split is chosen to minimise the size-weighted impurity of the children:</p>
<div class="eq">\frac{n_L}{n}\,G_L + \frac{n_R}{n}\,G_R</div>
<p>Entropy, <span class="tx">-\sum_c p_c \log_2 p_c</span>, is an alternative purity measure that usually picks similar splits.</p>
<h3>Depth = flexibility</h3>
<ul>
<li><b>Shallow trees</b> ask few questions: big boxes, simple boundaries, <b>underfitting</b>.</li>
<li><b>Deep trees</b> keep splitting until every box is pure, even around single noisy points: <b>overfitting</b>.</li>
</ul>
<p>Limiting the depth or requiring a minimum number of samples per leaf are the two simplest ways to keep a tree honest.</p>
`,

    create(ctx) {
        const P = ctx.params;
        const plot = ctx.plot;
        const st = { kind: 'moons', pts: [], tree: null, shown: 0, target: 0, py: false, testDeep: 0 };

        function load(kind) {
            st.kind = kind;
            st.pts = classification(kind, { n: 200, seed: 13, noise: kind === 'moons' || kind === 'circles' ? 3.5 : 1.6 });
            ctx.setClasses(nClasses(kind));
            rebuild(true);
        }

        const impurity = (cnt, n) => {
            if (!n) return 0;
            let s = P.criterion === 'entropy' ? 0 : 1;
            for (const c of cnt) { const p = c / n; if (P.criterion === 'entropy') { if (p > 0) s -= p * Math.log2(p); } else s -= p * p; }
            return s;
        };

        function grow(pts, depth, maxDepth, minLeaf) {
            const K = nClasses(st.kind);
            const counts = new Array(K).fill(0);
            for (const p of pts) counts[p.c]++;
            const node = { depth, counts, n: pts.length, pred: counts.indexOf(Math.max(...counts)) };
            if (depth >= maxDepth || pts.length < 2 * minLeaf || Math.max(...counts) === pts.length) return node;
            const parent = impurity(counts, pts.length);
            let best = null;
            for (let f = 0; f < 2; f++) {
                const key = AX[f];
                const s = pts.slice().sort((a, b) => a[key] - b[key]);
                const L = new Array(K).fill(0), R = counts.slice();
                for (let i = 0; i < s.length - 1; i++) {
                    L[s[i].c]++; R[s[i].c]--;
                    const nl = i + 1, nr = s.length - nl;
                    if (s[i][key] === s[i + 1][key] || nl < minLeaf || nr < minLeaf) continue;
                    const score = (nl * impurity(L, nl) + nr * impurity(R, nr)) / s.length;
                    if (!best || score < best.score - 1e-12) best = { score, f, thr: (s[i][key] + s[i + 1][key]) / 2 };
                }
            }
            if (!best || best.score >= parent - 1e-12) return node;
            node.feature = best.f; node.thr = best.thr;
            const key = AX[best.f];
            node.left = grow(pts.filter((p) => p[key] <= best.thr), depth + 1, maxDepth, minLeaf);
            node.right = grow(pts.filter((p) => p[key] > best.thr), depth + 1, maxDepth, minLeaf);
            return node;
        }
        const treeDepth = (n) => (n.left ? 1 + Math.max(treeDepth(n.left), treeDepth(n.right)) : 0);
        const leaves = (n, lim) => (n.left && n.depth < lim ? leaves(n.left, lim) + leaves(n.right, lim) : 1);

        function predictNode(node, x, y, lim) {
            let n = node;
            while (n.left && n.depth < lim) n = (n.feature === 0 ? x : y) <= n.thr ? n.left : n.right;
            return n;
        }
        function scores(tree, lim) {
            let tr = 0, trN = 0, te = 0, teN = 0;
            for (const p of st.pts) {
                const ok = predictNode(tree, p.x, p.y, lim).pred === p.c ? 1 : 0;
                if (p.test) { te += ok; teN++; } else { tr += ok; trN++; }
            }
            return { train: trN ? tr / trN : NaN, test: teN ? te / teN : NaN };
        }

        function rebuild(dataChanged) {
            const train = st.pts.filter((p) => !p.test);
            st.tree = grow(train, 0, P.depth, P.minLeaf);
            st.py = false;
            st.target = treeDepth(st.tree);
            if (st.shown > st.target) st.shown = st.target;
            if (dataChanged || true) {
                const deep = grow(train, 0, 30, 1);
                st.testDeep = scores(deep, 99).test;
            }
        }

        const editor = classEditor(plot, ctx, () => st.pts, {
            onChange: () => { ctx.pyCleared(); rebuild(true); st.shown = st.target; },
            info: (p) => {
                const C = ctx.colors();
                const leaf = predictNode(st.tree, p.x, p.y, Math.floor(st.shown + 1e-6));
                return `${swatch(C.c[p.c])}<span class="k">${p.test ? 'test' : 'training'} point</span> (${fmt(p.x, 2)}, ${fmt(p.y, 2)})<br>leaf predicts ${swatch(C.c[leaf.pred])}<b>${'ABC'[leaf.pred]}</b>`;
            },
        });
        let hoverPt = null;
        plot.on('hover', (p) => {
            hoverPt = p;
            if (editor.hot || editor.dragging) return;
            const C = ctx.colors();
            const lim = Math.floor(st.shown + 1e-6);
            const rules = [];
            let n = st.tree;
            while (n.left && n.depth < lim) {
                const v = n.feature === 0 ? p.x : p.y;
                const goLeft = v <= n.thr;
                rules.push(`${AX[n.feature]} ${goLeft ? '≤' : '>'} ${fmt(n.thr, 2)}`);
                n = goLeft ? n.left : n.right;
            }
            const purity = n.n ? Math.max(...n.counts) / n.n : 0;
            ctx.tooltip.showAt(plot.canvas, p.px, p.py - 10,
                `<span class="k">${rules.length ? rules.join(' → ') : 'root (no questions yet)'}</span><br>${swatch(C.c[n.pred])}<b>class ${'ABC'[n.pred]}</b> <span class="k">· ${n.counts.join(' / ')} points · ${pct(purity)} pure</span>`);
        });
        plot.on('leave', () => { hoverPt = null; });

        function drawTree(g, C) {
            const [vx0, vx1, vy0, vy1] = plot.view();
            const lim = st.shown;
            const hoverLeaf = hoverPt && !editor.hot ? predictNode(st.tree, hoverPt.x, hoverPt.y, Math.floor(lim + 1e-6)) : null;
            const lines = [];
            const visit = (n, x0, x1, y0, y1, fade) => {
                const open = n.left && n.depth < lim;
                if (!open) {
                    const purity = n.n ? Math.max(...n.counts) / n.n : 0;
                    const a = (0.1 + 0.32 * purity) * fade + (n === hoverLeaf ? 0.12 : 0);
                    g.fillStyle = rgba(C.c[n.pred], a);
                    g.fillRect(plot.sx(x0), plot.sy(y1), plot.sx(x1) - plot.sx(x0), plot.sy(y0) - plot.sy(y1));
                    if (n === hoverLeaf) { g.strokeStyle = C.c[n.pred]; g.lineWidth = 2; g.strokeRect(plot.sx(x0) + 1, plot.sy(y1) + 1, plot.sx(x1) - plot.sx(x0) - 2, plot.sy(y0) - plot.sy(y1) - 2); }
                    return;
                }
                const prog = easeOut(clamp(lim - n.depth, 0, 1));
                lines.push({ n, x0, x1, y0, y1, prog });
                if (n.feature === 0) { visit(n.left, x0, n.thr, y0, y1, prog); visit(n.right, n.thr, x1, y0, y1, prog); }
                else { visit(n.left, x0, x1, y0, n.thr, prog); visit(n.right, x0, x1, n.thr, y1, prog); }
            };
            visit(st.tree, vx0, vx1, vy0, vy1, 1);
            plot.grid({ labels: false });
            for (const L of lines) {
                const { n, prog } = L;
                g.save();
                g.strokeStyle = C.text; g.globalAlpha = 0.85; g.lineWidth = Math.max(1.2, 3 - n.depth * 0.35);
                g.shadowColor = C.accent; g.shadowBlur = prog < 1 ? 16 : 4;
                g.beginPath();
                if (n.feature === 0) {
                    const X = plot.sx(n.thr), mid = (L.y0 + L.y1) / 2, h = ((L.y1 - L.y0) / 2) * prog;
                    g.moveTo(X, plot.sy(mid - h)); g.lineTo(X, plot.sy(mid + h));
                } else {
                    const Y = plot.sy(n.thr), mid = (L.x0 + L.x1) / 2, w = ((L.x1 - L.x0) / 2) * prog;
                    g.moveTo(plot.sx(mid - w), Y); g.lineTo(plot.sx(mid + w), Y);
                }
                g.stroke();
                g.restore();
            }
        }

        load('moons');
        st.shown = st.target;
        let animTarget = st.target;

        return {
            setParam() { ctx.pyCleared(); rebuild(false); animTarget = st.target; },
            setDataset(kind) { load(kind); st.shown = 0; animTarget = st.target; },
            step() {
                const next = Math.min(st.target, Math.floor(st.shown + 1e-6) + 1);
                animTarget = next;
                return next < st.target;
            },
            reset() { st.shown = 0; animTarget = 0; },
            canPlay: () => Math.floor(st.shown + 1e-6) < st.target,
            frame(dt) {
                if (st.shown < animTarget) st.shown = Math.min(animTarget, st.shown + dt * 2.2);
                else if (st.shown > animTarget) st.shown = Math.max(animTarget, st.shown - dt * 6);
                const C = ctx.colors();
                const g = plot.begin(C);
                drawTree(g, C);
                drawClassPoints(plot, st.pts, C, editor.hot);
                plot.drawRipples();
            },
            metrics() {
                const lim = Math.floor(st.shown + 1e-6);
                const s = scores(st.tree, lim);
                return [{ k: 'Depth', v: `${lim} / ${st.target}` }, { k: 'Leaves', v: leaves(st.tree, lim) }, accMetric('Train acc', s.train), accMetric('Test acc', s.test)];
            },
            state() {
                const lim = Math.floor(st.shown + 1e-6);
                const s = scores(st.tree, lim);
                return { shown: lim, full: lim === st.target, train: s.train, test: s.test, testDeep: st.testDeep };
            },
            pyData() { return classData(st.pts); },
            onPython(r) {
                if (!r || !r.feature) throw new Error('expected the tree arrays in result');
                const cls = r.classes || [0, 1, 2];
                const K = nClasses(st.kind);
                const make = (i, depth) => {
                    const val = r.value[i];
                    const tot = val.reduce((a, b) => a + b, 0) || 1;
                    const n = r.samples ? r.samples[i] : Math.round(tot);
                    const counts = new Array(K).fill(0);
                    val.forEach((v, c) => { counts[cls[c]] = Math.round((v / tot) * n); });
                    const node = { depth, counts, n, pred: cls[val.indexOf(Math.max(...val))] };
                    if (r.left[i] >= 0) {
                        node.feature = r.feature[i]; node.thr = r.threshold[i];
                        node.left = make(r.left[i], depth + 1); node.right = make(r.right[i], depth + 1);
                    }
                    return node;
                };
                st.tree = make(0, 0);
                st.target = treeDepth(st.tree);
                st.shown = 0; animTarget = st.target;
                st.py = true;
                return `Python: DecisionTreeClassifier (depth ${st.target})`;
            },
            clearPython() { if (st.py) { rebuild(false); st.shown = st.target; animTarget = st.target; } },
            destroy() { editor.destroy(); },
        };
    },
};
