// Learn hub: routing, curriculum drawer, workbench chrome and the bridge between lessons, controls and Python.
import { SUBJECTS, findLesson } from './registry.js';
import { Plot2D } from './core/plot2d.js';
import * as Py from './core/python.js';
import { setDataOptions } from './core/data.js';
import { TOURS } from './lessons/tours.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, html) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    if (html != null) e.innerHTML = html;
    return e;
};
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const DICE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/></svg>';

// ---------- persistence ----------
const STORE = 'learn.v1';
let store = { done: {}, ch: {}, ui: { collapsed: {} } };
try { store = { ...store, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch (e) { /* private mode */ }
store.ui ||= { collapsed: {} };
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (e) { /* ignore */ } };
const lessonKey = (s, l) => `${s}/${l}`;

// ---------- colors ----------
let colorCache = null;
function colors() {
    if (colorCache) return colorCache;
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    colorCache = {
        light,
        c: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => v('--c' + i)),
        text: v('--text'), muted: v('--text-muted'), faint: v('--text-faint'),
        accent: v('--accent'), ok: v('--ok'),
        grid: light ? 'rgba(15,23,42,.055)' : 'rgba(255,255,255,.045)',
        axis: light ? 'rgba(15,23,42,.2)' : 'rgba(255,255,255,.17)',
        ring: light ? 'rgba(255,255,255,.95)' : 'rgba(5,8,15,.85)',
        bgSolid: light ? '#f4f7fb' : '#0a0f1d',
        mono: v('--font-mono'),
    };
    return colorCache;
}

// ---------- tooltip ----------
const tipEl = $('#tooltip');
const stageEl = $('#stage');
const tooltip = {
    showAt(target, x, y, html) {
        const sr = stageEl.getBoundingClientRect(), tr = target.getBoundingClientRect();
        this._place(tr.left - sr.left + x, tr.top - sr.top + y, html);
    },
    show(clientX, clientY, html) {
        const sr = stageEl.getBoundingClientRect();
        this._place(clientX - sr.left, clientY - sr.top, html);
    },
    _place(x, y, html) {
        if (tipEl._html !== html) { tipEl.innerHTML = html; tipEl._html = html; }
        const w = tipEl.offsetWidth / 2 + 8;
        tipEl.style.left = Math.max(w, Math.min(stageEl.clientWidth - w, x)) + 'px';
        tipEl.style.top = Math.max(tipEl.offsetHeight + 20, y) + 'px';
        tipEl.classList.add('show');
    },
    hide() { tipEl.classList.remove('show'); },
};

// ---------- toast & confetti ----------
let toastTimer = 0;
function toast(msg, tick = true) {
    const t = $('#toast');
    t.innerHTML = (tick ? `<span class="tick">${CHECK}</span>` : '') + `<span>${msg}</span>`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function confetti(fromEl) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = fromEl.getBoundingClientRect();
    const C = colors().c;
    for (let i = 0; i < 18; i++) {
        const d = el('div', { class: 'confetti' });
        d.style.left = r.left + 14 + 'px'; d.style.top = r.top + r.height / 2 + 'px';
        d.style.background = C[i % 5];
        document.body.appendChild(d);
        const a = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 50;
        d.animate([
            { transform: 'translate(0,0) rotate(0)', opacity: 1 },
            { transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist - 20}px) rotate(${Math.random() * 360}deg)`, opacity: 0 },
        ], { duration: 700 + Math.random() * 400, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => d.remove();
    }
}

// ---------- theme ----------
$('#themeToggle').addEventListener('click', () => {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    if (light) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', 'light');
    try { localStorage.setItem('theme', light ? 'dark' : 'light'); } catch (e) { /* ignore */ }
    colorCache = null;
    if (three) three.applyTheme();
    if (current && current.inst.onTheme) current.inst.onTheme();
});

// ---------- drawer ----------
const shell = $('#shell');
if (innerWidth < 1100) shell.classList.add('drawer-closed');
function setDrawer(open) {
    shell.classList.toggle('drawer-closed', !open);
    $('#drawerToggle').setAttribute('aria-expanded', String(open));
}
$('#drawerToggle').addEventListener('click', () => setDrawer(shell.classList.contains('drawer-closed')));
$('#scrim').addEventListener('click', () => setDrawer(false));

// ---------- svg helper: presentation attributes cannot use var(), so move them into style ----------
function svgVars(s) {
    return s.replace(/<([a-z]+)([^>]*?)(\/?)>/g, (m, tag, attrs, close) => {
        const styles = [];
        attrs = attrs.replace(/\s(fill|stroke)="(var\([^)]+\))"/g, (_, k, v) => { styles.push(`${k}:${v}`); return ''; });
        return styles.length ? `<${tag}${attrs} style="${styles.join(';')}"${close}>` : m;
    });
}

// ---------- routing ----------
let subject = SUBJECTS[0];
function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { s: parts[0] || 'ml', l: parts[1] || null };
}
window.addEventListener('hashchange', route);

function route() {
    const { s, l } = parseHash();
    subject = SUBJECTS.find((x) => x.id === s) || SUBJECTS[0];
    renderSubjects();
    renderDrawer(l);
    const found = l && findLesson(subject.id, l);
    if (found) openLesson(found);
    else { closeLesson(); renderOverview(); }
}

function renderSubjects() {
    const nav = $('#subjects');
    nav.innerHTML = '';
    for (const s of SUBJECTS) {
        const b = el('button', { 'aria-current': String(s.id === subject.id), title: s.status === 'soon' ? s.name + ' — coming soon' : s.name },
            `<span class="full">${s.name}</span>${s.status === 'soon' ? '<span class="soon">SOON</span>' : ''}`);
        b.addEventListener('click', () => { location.hash = '#/' + s.id; });
        nav.appendChild(b);
    }
}

function doneCount(s) { return s.lessons.filter((l) => store.done[lessonKey(s.id, l.id)]).length; }

function renderDrawer(activeId) {
    $('#drawerTitle').textContent = subject.name;
    const total = subject.lessons.length, done = doneCount(subject);
    $('#progressFill').style.width = total ? (done / total) * 100 + '%' : '0';
    $('#progressText').textContent = total ? `${done} of ${total} lessons complete` : 'Lessons are on the way.';
    const list = $('#curriculum');
    list.innerHTML = '';
    let n = 0;
    for (const lv of subject.levels) {
        const ls = subject.lessons.filter((l) => l.level === lv.id);
        const gk = subject.id + lv.id;
        const g = el('li', { class: 'level-group' + (store.ui.collapsed[gk] ? ' collapsed' : '') });
        const d = ls.filter((l) => store.done[lessonKey(subject.id, l.id)]).length;
        const btn = el('button', { class: 'level-btn', 'aria-expanded': String(!store.ui.collapsed[gk]) },
            `${lv.id}. ${lv.name} <span class="lv-count">${d}/${ls.length}</span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`);
        btn.addEventListener('click', () => {
            store.ui.collapsed[gk] = !store.ui.collapsed[gk]; save();
            g.classList.toggle('collapsed'); btn.setAttribute('aria-expanded', String(!store.ui.collapsed[gk]));
        });
        const steps = el('ol', { class: 'steps' });
        for (const l of ls) {
            n++;
            const isDone = !!store.done[lessonKey(subject.id, l.id)];
            const li = el('li', { class: 'step' + (isDone ? ' done' : '') });
            const a = el('a', { href: `#/${subject.id}/${l.id}`, 'aria-current': l.id === activeId ? 'page' : false },
                `<span class="node">${isDone ? CHECK : n}</span><span>${l.title}</span><span class="tag">${l.tag}</span>`);
            a.addEventListener('click', () => { if (innerWidth < 1100) setDrawer(false); });
            li.appendChild(a); steps.appendChild(li);
        }
        g.append(btn, steps);
        list.appendChild(g);
    }
    if (!subject.levels.length) list.innerHTML = '<li class="progress-text" style="padding:8px">This track is being built. Machine Learning is ready now.</li>';
}

function renderOverview() {
    $('#overview').hidden = false;
    $('#workbench').hidden = true;
    document.title = `Learn ${subject.name} Interactively — Bibek Koirala`;
    $('#ovKicker').textContent = subject.status === 'live' ? `Interactive track · ${subject.lessons.length} lessons` : 'Coming soon';
    $('#ovTitle').innerHTML = subject.headline;
    $('#ovLead').textContent = subject.lead;
    const first = subject.lessons.find((l) => !store.done[lessonKey(subject.id, l.id)]) || subject.lessons[0];
    const start = $('#ovStart');
    start.hidden = !first;
    if (first) {
        start.href = `#/${subject.id}/${first.id}`;
        start.firstChild.textContent = doneCount(subject) ? `Continue: ${first.title} ` : 'Start learning ';
    }
    const wrap = $('#ovLevels');
    wrap.innerHTML = '';
    if (subject.status !== 'live') {
        wrap.innerHTML = `<div class="ov-level"><p>Want to start now? <a href="#/ml">Try the Machine Learning track →</a></p></div>`;
        return;
    }
    for (const lv of subject.levels) {
        const sec = el('section', { class: 'ov-level' }, `<h2><span class="lv">${lv.id}</span>${lv.name}</h2><p>${lv.blurb}</p>`);
        const cards = el('div', { class: 'ov-cards' });
        for (const l of subject.lessons.filter((x) => x.level === lv.id)) {
            const done = store.done[lessonKey(subject.id, l.id)];
            const nCh = (store.ch[lessonKey(subject.id, l.id)] || []).length;
            cards.appendChild(el('a', { class: 'ov-card' + (done ? ' done' : ''), href: `#/${subject.id}/${l.id}` },
                `<div class="thumb">${svgVars(l.thumb)}</div><h3>${l.title}</h3><p>${l.blurb}</p>
                 <div class="meta"><span class="badge">${done ? '✓ DONE' : l.tag}</span>${nCh ? `<span>${nCh} challenge${nCh > 1 ? 's' : ''} solved</span>` : ''}</div>`));
        }
        sec.appendChild(cards);
        wrap.appendChild(sec);
    }
}

// ---------- shared stage objects ----------
let plot = null;
let three = null;
let threeLoading = null;
async function getThree() {
    if (three) return three;
    if (!threeLoading) threeLoading = import('./core/scene3d.js').then((m) => { three = new m.Scene3D($('#pane3d')); return three; });
    return threeLoading;
}

// ---------- lesson lifecycle ----------
let current = null; // { def, inst, key, P, found, view, done:Set }
let openToken = 0;

function closeLesson() {
    stopTour();
    if (!current) return;
    try { current.inst && current.inst.destroy && current.inst.destroy(); } catch (e) { console.error(e); }
    if (plot) plot.handlers = {};
    if (three) { three.handlers = {}; three.container.classList.remove('grab'); }
    $('#lessonHud').innerHTML = '';
    $('#pyResult').hidden = true;
    tooltip.hide();
    playing(false);
    current = null;
}

async function openLesson(found) {
    const token = ++openToken;
    $('#overview').hidden = true;
    $('#workbench').hidden = false;
    const { subject: s, lesson: meta, index } = found;
    const key = lessonKey(s.id, meta.id);
    if (current && current.key === key) return;
    closeLesson();
    document.title = `${meta.title} — Learn ${s.name} · Bibek Koirala`;
    $('#levelChip').textContent = `${meta.level}. ${s.levels.find((l) => l.id === meta.level).name}`;
    $('#lessonTitle').textContent = meta.title;
    $('#stageLoading').textContent = 'Loading lesson…';
    $('#stageLoading').classList.remove('gone');
    $('#main').scrollTop = 0;
    renderLessonNav(s, index);

    const mod = await meta.load();
    if (token !== openToken) return;
    const def = mod.default;
    if (!def.tour && TOURS[meta.id]) def.tour = TOURS[meta.id];
    const P = {};
    for (const p of def.params || []) P[p.key] = p.value;

    if (!plot) plot = new Plot2D($('#plot'));
    plot.handlers = {};
    plot.bounds = def.bounds || [-1.25, 1.25, -1.25, 1.25];
    plot.resize();
    const needs3d = (def.views || []).some((v) => v.id !== '2d');
    const th = needs3d ? await getThree() : null;
    if (token !== openToken) return;

    const view = def.defaultView || (def.views && def.views[0].id) || '2d';
    setStageView(view);
    const ctx = makeCtx(def, P, th);
    current = { def, P, key, found, view, ctx, done: new Set(store.ch[key] || []), state: {}, touched: false };
    setDataOptions({ shift: 0, noise: 1 });
    current.spread = 1;
    current.hidden = new Set();
    let inst;
    try { inst = def.create(ctx); } catch (e) {
        console.error(e);
        current = null;
        $('#stageLoading').textContent = 'This lesson failed to start. Try reloading the page.';
        return;
    }
    current.inst = inst;
    if (th) th.resize();

    buildHud(def);
    buildControls(def);
    buildChallenges(def);
    buildExplain(def);
    buildPython(def);
    $('#playbar').hidden = !def.playback;
    stageEl.classList.toggle('has-playbar', !!def.playback);
    $('#stageHint').innerHTML = def.hint || '';
    stageEl.classList.remove('touched');
    updateMarkDone();
    $('#stageLoading').classList.add('gone');
    pyResult(null);
    lastMetrics = '';
    $('#tourBtn').hidden = !def.tour;
    if (def.tour && !(store.tour && store.tour[key])) startTour();
    schedulePython();
}

function makeCtx(def, P, th) {
    return {
        params: P,
        plot,
        three: th,
        hud: $('#lessonHud'),
        stage: stageEl,
        colors,
        tooltip,
        toast,
        get view() { return current ? current.view : def.defaultView; },
        get spawnClass() { return spawnClass; },
        set(key, value) { setParam(key, value, { fromLesson: true }); },
        setView(v) { selectView(v); },
        changed() { checkSoon(); },
        flash(text, color) {
            const f = el('div', { class: 'badge-flash glass' }, text);
            if (color) f.style.color = color;
            stageEl.appendChild(f);
            setTimeout(() => f.remove(), 1700);
        },
        pyShown(label) { pyResult(label || 'Showing Python result'); },
        pyCleared() { pyResult(null); },
        refreshControls() { refreshVisibility(); },
        setClasses(n) { buildClassPick(n); },
        /** true while the guided tour hides a layer (e.g. 'model') so it can be revealed step by step */
        hidden(name) { return !!(current && current.hidden && current.hidden.has(name)); },
    };
}

function renderLessonNav(s, i) {
    const nav = $('#lessonNav');
    nav.innerHTML = '';
    const prev = s.lessons[i - 1], next = s.lessons[i + 1];
    if (prev) nav.appendChild(el('a', { href: `#/${s.id}/${prev.id}` }, `<small>← Previous</small>${prev.title}`));
    if (next) nav.appendChild(el('a', { class: 'next', href: `#/${s.id}/${next.id}` }, `<small>Next →</small>${next.title}`));
    else nav.appendChild(el('a', { class: 'next', href: `#/${s.id}` }, `<small>Track</small>Back to overview`));
}

// ---------- stage HUD ----------
let spawnClass = 0;
function setStageView(v) {
    stageEl.classList.remove('view-2d', 'view-3d', 'view-split');
    stageEl.classList.add('view-' + v);
    requestAnimationFrame(() => { if (plot) plot.resize(); if (three) three.resize(); });
}
function selectView(v) {
    if (!current || current.view === v) return;
    current.view = v;
    setStageView(v);
    tooltip.hide();
    for (const b of $('#viewSeg').children) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    current.inst.setView && current.inst.setView(v);
    pyResult(null);
    checkSoon();
}

function buildHud(def) {
    const ds = $('#datasetSeg');
    ds.innerHTML = '';
    if (def.datasets) {
        current.dataset = def.defaultDataset || def.datasets[0].id;
        for (const d of def.datasets) {
            const b = el('button', { 'aria-pressed': String(d.id === current.dataset), 'data-v': d.id, title: d.title || d.label }, d.label);
            b.addEventListener('click', () => {
                current.dataset = d.id;
                for (const x of ds.children) x.setAttribute('aria-pressed', String(x === b));
                current.inst.setDataset(d.id);
                pyResult(null);
                checkSoon();
            });
            ds.appendChild(b);
        }
        if (def.random !== false) {
            const dice = el('button', { class: 'dice', title: 'New random points (N)', 'aria-label': 'New random points' }, DICE);
            dice.addEventListener('click', () => randomizeData());
            ds.appendChild(dice);
        }
    }
    const vs = $('#viewSeg');
    vs.innerHTML = '';
    if (def.views && def.views.length > 1) {
        for (const v of def.views) {
            const b = el('button', { 'aria-pressed': String(v.id === current.view), 'data-v': v.id }, v.label);
            b.addEventListener('click', () => selectView(v.id));
            vs.appendChild(b);
        }
    }
    buildClassPick(def.classes || 0);
}

function buildClassPick(n) {
    const cp = $('#classPick');
    cp.innerHTML = '';
    cp.hidden = !n;
    if (!n) return;
    spawnClass = 0;
    cp.appendChild(el('span', {}, 'Add:'));
    for (let i = 0; i < n; i++) {
        const b = el('button', { 'aria-pressed': String(i === 0), 'aria-label': 'Add class ' + (i + 1), title: `Click the canvas to add class ${i + 1} (or press ${i + 1})` });
        b.style.setProperty('--sw', `var(--c${i})`);
        b.addEventListener('click', () => pickClass(i));
        cp.appendChild(b);
    }
}
function pickClass(i) {
    const cp = $('#classPick');
    const btns = cp.querySelectorAll('button');
    if (i >= btns.length) return;
    spawnClass = i;
    btns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
}

// ---------- controls ----------
const ctlRefs = new Map();
function fmtVal(p, v) {
    if (p.format) return p.format(v);
    if (p.type === 'select') return (p.options.find((o) => o.value === v) || {}).label || v;
    if (p.type === 'toggle') return v ? 'On' : 'Off';
    const d = p.digits ?? (p.step >= 1 ? 0 : String(p.step).split('.')[1]?.length || 2);
    return (+v).toFixed(d);
}
const toSlider = (p, v) => (p.log ? ((Math.log(v) - Math.log(p.min)) / (Math.log(p.max) - Math.log(p.min))) * 1000 : v);
const fromSlider = (p, s) => {
    if (!p.log) return +s;
    const v = Math.exp(Math.log(p.min) + (s / 1000) * (Math.log(p.max) - Math.log(p.min)));
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / mag) * mag;
};

function buildControls(def) {
    const root = $('#controls');
    root.innerHTML = '';
    ctlRefs.clear();
    if (def.how) root.appendChild(el('div', { class: 'ctl-section' }, `<div class="how">${def.how}</div>`));
    if (def.presets && def.presets.length) {
        const sec = el('div', { class: 'ctl-section' }, '<h3>Presets</h3>');
        const row = el('div', { class: 'presets' });
        for (const pr of def.presets) {
            const b = el('button', { class: 'chip-btn', title: pr.title || '' }, pr.label);
            b.addEventListener('click', () => {
                for (const [k, v] of Object.entries(pr.values)) setParam(k, v);
                if (pr.dataset) $(`#datasetSeg [data-v="${pr.dataset}"]`)?.click();
                if (pr.view) selectView(pr.view);
            });
            row.appendChild(b);
        }
        sec.appendChild(row);
        root.appendChild(sec);
    }
    const groups = {};
    for (const p of def.params || []) (groups[p.group || 'Parameters'] ||= []).push(p);
    for (const [g, ps] of Object.entries(groups)) {
        const sec = el('div', { class: 'ctl-section' }, `<h3>${g}</h3>`);
        for (const p of ps) sec.appendChild(buildControl(p));
        root.appendChild(sec);
    }
    if (def.actions && def.actions.length) {
        const sec = el('div', { class: 'ctl-section' }, '<h3>Actions</h3>');
        for (const a of def.actions) {
            const b = el('button', { class: 'action-btn' + (a.secondary ? ' secondary' : ''), 'data-action': a.id }, a.label);
            b.addEventListener('click', () => { current.inst.action(a.id, b); checkSoon(); });
            sec.appendChild(b);
        }
        root.appendChild(sec);
    }
    if (def.datasets && def.random !== false) {
        const sec = el('div', { class: 'ctl-section' }, '<h3>Data</h3>');
        const b = el('button', { class: 'action-btn secondary' }, `${DICE}<span>New random points</span>`);
        b.addEventListener('click', () => randomizeData());
        sec.appendChild(b);
        if (def.spread !== false) {
        const wrap = el('div', { class: 'ctl' });
        const val = el('span', { class: 'ctl-val' }, current.spread.toFixed(1) + '×');
        const top = el('div', { class: 'ctl-top' }, '<label for="ctl-spread">Spread (how scattered the points are)</label>');
        top.appendChild(val);
        const input = el('input', { type: 'range', id: 'ctl-spread', min: 0.3, max: 2.5, step: 0.1, value: current.spread });
        const fill = () => input.style.setProperty('--p', ((input.value - 0.3) / 2.2) * 100 + '%');
        fill();
        input.addEventListener('input', () => { fill(); val.textContent = (+input.value).toFixed(1) + '×'; setSpread(+input.value); });
        wrap.append(top, input, el('div', { class: 'ctl-help' }, 'Low spread: tidy, well-separated groups. High spread: messy, overlapping data, closer to real life.'));
        sec.appendChild(wrap);
        }
        root.appendChild(sec);
    }
    if (def.legend) root.appendChild(el('div', { class: 'ctl-section' }, `<h3>Legend</h3><div class="legend">${def.legend}</div>`));
    refreshVisibility();
}

function buildControl(p) {
    const P = current.P;
    const wrap = el('div', { class: 'ctl' });
    const id = 'ctl-' + p.key;
    const top = el('div', { class: 'ctl-top' }, `<label for="${id}">${p.label}${p.py ? `<code>${p.py}</code>` : ''}</label>`);
    const val = el('span', { class: 'ctl-val' }, fmtVal(p, P[p.key]));
    top.appendChild(val);
    wrap.appendChild(top);
    let input;
    if (p.type === 'select' || p.type === 'toggle') {
        const opts = p.type === 'toggle' ? [{ value: true, label: 'On' }, { value: false, label: 'Off' }] : p.options;
        input = el('div', { class: 'opts', role: 'group', 'aria-label': p.label });
        for (const o of opts) {
            const b = el('button', { class: 'chip-btn', 'aria-pressed': String(o.value === P[p.key]) }, o.label);
            b._v = o.value;
            b.addEventListener('click', () => setParam(p.key, o.value));
            input.appendChild(b);
        }
        val.hidden = true;
    } else {
        input = el('input', { type: 'range', id, min: p.log ? 0 : p.min, max: p.log ? 1000 : p.max, step: p.log ? 1 : p.step, value: toSlider(p, P[p.key]) });
        const fill = () => { input.style.setProperty('--p', ((input.value - input.min) / (input.max - input.min)) * 100 + '%'); };
        fill();
        input.addEventListener('input', () => { fill(); setParam(p.key, fromSlider(p, +input.value), { fromSlider: true }); });
        input._fill = fill;
    }
    wrap.appendChild(input);
    if (p.help) wrap.appendChild(el('div', { class: 'ctl-help' }, p.help));
    ctlRefs.set(p.key, { p, wrap, input, val });
    return wrap;
}

function refreshVisibility() {
    if (!current) return;
    for (const { p, wrap } of ctlRefs.values()) if (p.visible) wrap.hidden = !p.visible(current.P, current);
}

function setParam(key, value, { fromSlider = false, fromCode = false, fromLesson = false } = {}) {
    if (!current) return;
    if (!fromLesson) current.touched = true;
    const ref = ctlRefs.get(key);
    const p = ref ? ref.p : (current.def.params || []).find((x) => x.key === key);
    if (!p) return;
    if (p.type !== 'select' && p.type !== 'toggle') {
        value = Math.max(p.min, Math.min(p.max, +value));
        if (!p.log && p.step >= 1) value = Math.round(value);
    }
    const changed = current.P[key] !== value;
    current.P[key] = value;
    if (ref) {
        ref.val.textContent = fmtVal(p, value);
        if (changed) { ref.val.classList.add('bump'); setTimeout(() => ref.val.classList.remove('bump'), 140); }
        if (p.type === 'select' || p.type === 'toggle') for (const b of ref.input.children) b.setAttribute('aria-pressed', String(b._v === value));
        else if (!fromSlider) { ref.input.value = toSlider(p, value); ref.input._fill(); }
    }
    if (!changed) return;
    if (!fromCode && p.py) writeCodeVar(p, value);
    if (!fromLesson || p.notifyLesson) current.inst.setParam && current.inst.setParam(key, value);
    if (!fromLesson) pyResult(null);
    refreshVisibility();
    checkSoon();
}

// ---------- intuition ----------
function buildExplain(def) {
    const root = $('#explain');
    root.innerHTML = def.explain || '';
    const render = () => {
        if (!window.katex) return setTimeout(render, 60);
        root.querySelectorAll('.eq, .tx').forEach((n) => {
            try { window.katex.render(n.textContent, n, { displayMode: n.classList.contains('eq'), throwOnError: false, trust: false }); } catch (e) { /* leave raw */ }
        });
    };
    render();
}

// ---------- challenges ----------
let openHint = null;
function buildChallenges(def) {
    const root = $('#challenges');
    root.innerHTML = '';
    for (const ch of def.challenges || []) {
        const b = el('button', { class: 'chal' + (current.done.has(ch.id) ? ' done' : ''), 'data-id': ch.id, 'aria-label': 'Challenge: ' + ch.title },
            `<span class="ck">${CHECK}</span><span><b>Try this:</b> ${ch.title}</span>`);
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = openHint && openHint.parentNode === b;
            closeHint();
            root.querySelectorAll('.chal').forEach((x) => x.classList.remove('active'));
            if (wasOpen) return;
            b.classList.add('active');
            openHint = el('div', { class: 'chal-hint' }, `<strong>${current.done.has(ch.id) ? '✓ Solved! ' : 'Goal: '}${ch.title}</strong>${ch.hint}`);
            b.appendChild(openHint);
        });
        root.appendChild(b);
    }
}
function closeHint() { if (openHint) { openHint.remove(); openHint = null; } }
document.addEventListener('click', (e) => { if (openHint && !e.target.closest('.chal')) { closeHint(); document.querySelectorAll('.chal.active').forEach((x) => x.classList.remove('active')); } });

let checkPending = false;
function checkSoon() { checkPending = true; }
function checkChallenges() {
    if (!current || !current.inst.state || !current.touched || tour) return;
    let s;
    try { s = current.inst.state(); } catch (e) { return; }
    s.view = current.view;
    s.dataset = current.dataset;
    for (const ch of current.def.challenges || []) {
        if (current.done.has(ch.id)) continue;
        let ok = false;
        try { ok = ch.check(s, current.P); } catch (e) { ok = false; }
        if (!ok) continue;
        current.done.add(ch.id);
        store.ch[current.key] = [...current.done];
        const pill = $(`#challenges .chal[data-id="${ch.id}"]`);
        if (pill) { pill.classList.add('done', 'pop'); confetti(pill); setTimeout(() => pill.classList.remove('pop'), 800); }
        const all = (current.def.challenges || []).every((c) => current.done.has(c.id));
        if (all && !store.done[current.key]) {
            store.done[current.key] = true;
            toast(`All challenges solved. ${current.found.lesson.title} complete!`);
            renderDrawer(current.found.lesson.id);
            updateMarkDone();
        } else toast(`Challenge complete: ${ch.title}`);
        save();
    }
}
function updateMarkDone() {
    const b = $('#markDone');
    const on = !!(current && store.done[current.key]);
    b.classList.toggle('on', on);
    b.querySelector('span').textContent = on ? 'Completed' : 'Mark complete';
}
$('#markDone').addEventListener('click', () => {
    if (!current) return;
    if (store.done[current.key]) delete store.done[current.key]; else { store.done[current.key] = true; toast(`${current.found.lesson.title} marked complete`); }
    save(); updateMarkDone(); renderDrawer(current.found.lesson.id);
});

// ---------- metrics ----------
let lastMetrics = '';
function renderMetrics() {
    if (!current || !current.inst.metrics) return;
    const ms = current.inst.metrics();
    const html = ms.map((m) => `<span class="metric glass${m.cls ? ' ' + m.cls : ''}">${m.k}<b>${m.v}</b></span>`).join('');
    if (html !== lastMetrics) { $('#metrics').innerHTML = html; lastMetrics = html; }
}

// ---------- playback ----------
const SPEEDS = [0.25, 0.5, 1, 2, 4];
let speedIdx = 2, isPlaying = false, acc = 0;
function playing(on) {
    isPlaying = on;
    $('#playbar').classList.toggle('playing', on);
    $('#pbPlay').setAttribute('aria-label', on ? 'Pause' : 'Play');
}
function stepOnce() {
    if (!current || !current.inst.step) return false;
    const r = current.inst.step();
    checkSoon();
    return r !== false;
}
$('#pbPlay').addEventListener('click', () => {
    if (!current) return;
    if (!isPlaying && current.inst.canPlay && !current.inst.canPlay()) current.inst.reset();
    playing(!isPlaying); acc = 1; pyResult(null);
});
$('#pbStep').addEventListener('click', () => { playing(false); pyResult(null); stepOnce(); });
$('#pbReset').addEventListener('click', () => { playing(false); pyResult(null); current && current.inst.reset && current.inst.reset(); checkSoon(); });
$('#pbSpeed').addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; $('#pbSpeed').textContent = SPEEDS[speedIdx] + '×'; });

document.addEventListener('keydown', (e) => {
    if (!current || e.target.closest('input, textarea, .CodeMirror, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' && current.def.playback && !e.target.closest('button')) { e.preventDefault(); $('#pbPlay').click(); }
    else if ((e.key === 's' || e.key === 'S') && current.def.playback) $('#pbStep').click();
    else if ((e.key === 'r' || e.key === 'R') && current.def.playback) $('#pbReset').click();
    else if (/^[1-8]$/.test(e.key)) pickClass(+e.key - 1);
    else if ((e.key === 'n' || e.key === 'N') && current.def.datasets && current.def.random !== false) randomizeData();
});

// any hand on the stage or the panel counts as the visitor starting to play
for (const t of [stageEl, $('#panel')]) t.addEventListener('pointerdown', () => { if (current) current.touched = true; }, true);
// the stage hint is onboarding: let it fade a few seconds after the first touch so it never hides the metrics
stageEl.addEventListener('pointerdown', () => { clearTimeout(stageEl._hintT); stageEl._hintT = setTimeout(() => stageEl.classList.add('touched'), 4000); }, true);

// ---------- data: random points & spread ----------
function randomizeData() {
    if (!current) return;
    setDataOptions({ shift: 1 + Math.floor(Math.random() * 1e6) });
    current.inst.setDataset(current.dataset);
    current.touched = true;
    pyResult(null);
}
function setSpread(v) {
    if (!current) return;
    current.spread = v;
    setDataOptions({ noise: v });
    current.inst.setDataset(current.dataset);
    current.touched = true;
    pyResult(null);
}

// ---------- pointer activity (for tour tasks like "drag a point") ----------
const ev = { drags: 0, clicks: 0, hovers: 0 };
let pdown = null;
for (const pane of [$('#pane2d'), $('#pane3d')]) {
    pane.addEventListener('pointerdown', (e) => { pdown = { x: e.clientX, y: e.clientY, moved: false }; }, true);
    pane.addEventListener('pointermove', (e) => {
        if (pdown) { if (Math.hypot(e.clientX - pdown.x, e.clientY - pdown.y) > 5) pdown.moved = true; }
        else ev.hovers++;
    }, true);
}
window.addEventListener('pointerup', () => { if (pdown) { if (pdown.moved) ev.drags++; else ev.clicks++; pdown = null; } }, true);

// ---------- guided tour ----------
// A lesson's `tour` is a list of steps: { title, text, do(api), hide: [layers], ui: ['metrics','playbar','classpick'],
// controls: [param keys shown inline], wait: { label, done, check(state, params, ev) } }.
let tour = null;
const panelEl = $('#panel');
const tourEl = el('section', { class: 'tour', 'aria-label': 'Guided tour', 'aria-live': 'polite' });
tourEl.hidden = true;
panelEl.appendChild(tourEl);

function tourApi() {
    return {
        set: (k, v) => setParam(k, v),
        dataset: (id) => { if (current.dataset !== id) { const b = $(`#datasetSeg [data-v="${id}"]`); if (b) b.click(); } },
        view: (id) => selectView(id),
        action: (id) => { current.inst.action && current.inst.action(id); },
        reset: () => { current.inst.reset && current.inst.reset(); },
        step: (n = 1) => { for (let i = 0; i < n; i++) stepOnce(); },
        inst: current.inst,
    };
}
const safeState = () => { try { const s = current.inst.state ? current.inst.state() : {}; s.view = current.view; s.dataset = current.dataset; return s; } catch (e) { return {}; } };

function startTour() {
    if (!current || !current.def.tour) return;
    playing(false);
    pyResult(null);
    tour = { steps: current.def.tour, i: 0 };
    stageEl.classList.add('touring');
    panelEl.classList.add('touring');
    tourEl.hidden = false;
    $('#tourBtn').classList.add('on');
    goStep(0);
}
function stopTour(seen) {
    if (!tour) return;
    if (seen && current) { store.tour ||= {}; store.tour[current.key] = true; save(); }
    tour = null;
    tourEl.hidden = true;
    stageEl.classList.remove('touring', 'ui-metrics', 'ui-playbar', 'ui-classpick');
    panelEl.classList.remove('touring');
    $('#tourBtn').classList.remove('on');
    playing(false);
    if (current) { current.hidden = new Set(); current.touched = false; }
    selectTab('controls');
}
function goStep(i) {
    const s = tour.steps[i];
    tour.i = i;
    tour.ok = !s.wait;
    ev.drags = ev.clicks = ev.hovers = 0;
    playing(false);
    current.hidden = new Set(s.hide || []);
    for (const u of ['metrics', 'playbar', 'classpick']) stageEl.classList.toggle('ui-' + u, (s.ui || []).includes(u));
    try { s.do && s.do(tourApi()); } catch (e) { console.error(e); }
    renderTour();
}
function tourControl(key) {
    const p = (current.def.params || []).find((x) => x.key === key);
    if (!p) return null;
    const wrap = el('div', { class: 'ctl' });
    const val = el('span', { class: 'ctl-val' }, fmtVal(p, current.P[key]));
    const top = el('div', { class: 'ctl-top' }, `<label>${p.label}</label>`);
    top.appendChild(val);
    wrap.appendChild(top);
    if (p.type === 'select' || p.type === 'toggle') {
        const opts = p.type === 'toggle' ? [{ value: true, label: 'On' }, { value: false, label: 'Off' }] : p.options;
        const row = el('div', { class: 'opts' });
        for (const o of opts) {
            const b = el('button', { class: 'chip-btn', 'aria-pressed': String(o.value === current.P[key]) }, o.label);
            b.addEventListener('click', () => { setParam(key, o.value); row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
            row.appendChild(b);
        }
        val.hidden = true;
        wrap.appendChild(row);
    } else {
        const input = el('input', { type: 'range', min: p.log ? 0 : p.min, max: p.log ? 1000 : p.max, step: p.log ? 1 : p.step, value: toSlider(p, current.P[key]) });
        const fill = () => input.style.setProperty('--p', ((input.value - input.min) / (input.max - input.min)) * 100 + '%');
        fill();
        input.addEventListener('input', () => { fill(); setParam(key, fromSlider(p, +input.value)); val.textContent = fmtVal(p, current.P[key]); });
        wrap.appendChild(input);
    }
    return wrap;
}
function renderTour() {
    const s = tour.steps[tour.i], n = tour.steps.length, last = tour.i === n - 1;
    tourEl.innerHTML = `
        <div class="tour-progress"><i style="width:${((tour.i + 1) / n) * 100}%"></i></div>
        <div class="tour-top"><span>Guided tour · step ${tour.i + 1} of ${n}</span>${last ? '' : '<button class="tour-skip">Skip tour</button>'}</div>
        <h2>${s.title}</h2>
        <div class="tour-text">${s.text}</div>
        <div class="tour-controls"></div>
        ${s.wait ? `<div class="tour-task${tour.ok ? ' ok' : ''}"><span class="ck">${CHECK}</span><span class="tt">${tour.ok ? (s.wait.done || 'Nice! Press Next.') : s.wait.label}</span>${tour.ok ? '' : '<button class="tour-pass">skip</button>'}</div>` : ''}
        <div class="tour-nav">
            <button class="ghost tour-back"${tour.i ? '' : ' disabled'}>Back</button>
            <button class="run tour-next"${tour.ok ? '' : ' disabled'}>${last ? 'Start exploring' : 'Next'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </div>`;
    const cbox = tourEl.querySelector('.tour-controls');
    for (const k of s.controls || []) { const c = tourControl(k); if (c) cbox.appendChild(c); }
    tourEl.querySelector('.tour-skip')?.addEventListener('click', () => stopTour(true));
    tourEl.querySelector('.tour-pass')?.addEventListener('click', () => { tour.ok = true; renderTour(); });
    tourEl.querySelector('.tour-back').addEventListener('click', () => goStep(tour.i - 1));
    tourEl.querySelector('.tour-next').addEventListener('click', () => { if (last) { stopTour(true); toast('Over to you! Try the challenges at the top.', false); } else goStep(tour.i + 1); });
    tourEl.scrollTop = 0;
}
function tourTick() {
    if (!tour || tour.ok) return;
    const s = tour.steps[tour.i];
    let ok = false;
    try { ok = !!s.wait.check(safeState(), current.P, ev); } catch (e) { ok = false; }
    if (ok) { tour.ok = true; renderTour(); tourEl.querySelector('.tour-task')?.classList.add('pop'); }
}
$('#tourBtn').addEventListener('click', () => { if (tour) stopTour(true); else startTour(); });

// ---------- tabs ----------
const tabs = document.querySelectorAll('.tabs [role="tab"]');
function selectTab(name) {
    tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.setAttribute('aria-selected', String(on));
        if (on) { const ink = $('#tabInk'); ink.style.left = t.offsetLeft + 'px'; ink.style.width = t.offsetWidth + 'px'; }
    });
    document.querySelectorAll('.tab-body').forEach((b) => { b.hidden = b.dataset.body !== name; });
    if (name === 'python') { Py.start(); if (cm) setTimeout(() => cm.refresh(), 0); }
}
tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
window.addEventListener('resize', () => selectTab(document.querySelector('.tabs [aria-selected="true"]').dataset.tab));
requestAnimationFrame(() => selectTab('controls'));

// ---------- Python sandbox ----------
let cm = null;
let template = '';
let errLine = null;

function pyLiteral(p, v) {
    if (p.pyFormat) return p.pyFormat(v);
    if (p.type === 'toggle') return v ? 'True' : 'False';
    if (p.type === 'select') return typeof v === 'number' ? String(v) : `'${v}'`;
    return fmtVal({ ...p, format: null }, v);
}
function parseLiteral(p, s) {
    s = s.trim();
    if (p.pyParse) return p.pyParse(s);
    if (p.type === 'toggle') return s === 'True' ? true : s === 'False' ? false : undefined;
    const q = s.match(/^(['"])(.*)\1$/);
    if (q) return q[2];
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return parseFloat(s);
    return undefined;
}
const varRe = (name) => new RegExp(`^(\\s*${name}\\s*=\\s*)([^#\\n]*?)(\\s*(#.*)?)$`);

function applyParamsToCode(text) {
    const lines = text.split('\n');
    for (const p of current.def.params || []) {
        if (!p.py) continue;
        const re = varRe(p.py);
        const i = lines.findIndex((l) => re.test(l));
        if (i >= 0) lines[i] = lines[i].replace(re, (_, a, _b, c) => a + pyLiteral(p, current.P[p.key]) + c);
    }
    return lines.join('\n');
}

function writeCodeVar(p, v) {
    if (!cm) return;
    const re = varRe(p.py);
    for (let i = 0; i < cm.lineCount(); i++) {
        const line = cm.getLine(i);
        const m = line.match(re);
        if (!m) continue;
        const from = m[1].length, to = from + m[2].length;
        const lit = pyLiteral(p, v);
        cm.replaceRange(lit, { line: i, ch: from }, { line: i, ch: to }, '+sync');
        const mark = cm.markText({ line: i, ch: from }, { line: i, ch: from + lit.length }, { className: 'cm-sync-flash' });
        setTimeout(() => mark.clear(), 900);
        return;
    }
}

function readCodeVars() {
    const text = cm.getValue().split('\n');
    for (const p of current.def.params || []) {
        if (!p.py) continue;
        const re = varRe(p.py);
        const line = text.find((l) => re.test(l));
        if (!line) continue;
        const v = parseLiteral(p, line.match(re)[2]);
        if (v === undefined) continue;
        if (p.type === 'select' && !p.options.some((o) => o.value === v)) continue;
        if (v !== current.P[p.key]) setParam(p.key, v, { fromCode: true });
    }
}

function buildPython(def) {
    template = def.code || '# This lesson has no Python script yet.\n';
    const text = applyParamsToCode(template);
    if (!cm) {
        const host = $('#editor');
        const make = () => {
            if (!window.CodeMirror) return setTimeout(make, 50);
            cm = window.CodeMirror(host, {
                value: text, mode: 'python', lineNumbers: true, indentUnit: 4, tabSize: 4,
                matchBrackets: true, autoCloseBrackets: true, viewportMargin: Infinity,
                extraKeys: {
                    'Ctrl-Enter': runCode, 'Cmd-Enter': runCode,
                    Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
                },
            });
            cm.on('change', (_, ch) => { if (ch.origin !== '+sync' && errLine != null) { cm.removeLineClass(errLine, 'background', 'cm-err-line'); errLine = null; } });
        };
        make();
    } else {
        cm.setValue(text);
        cm.clearHistory();
    }
    setConsole('Output from print() shows up here. Press Run Code (or Ctrl+Enter).', '');
}

function setConsole(html, meta) { $('#consoleBody').innerHTML = html; $('#consoleMeta').textContent = meta || ''; }
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function runCode() {
    if (!current || !cm) return;
    const runBtn = $('#runCode');
    if (runBtn.disabled) return;
    readCodeVars();
    const lessonAtRun = current;
    runBtn.disabled = true;
    $('#stopCode').hidden = false;
    const st = Py.status();
    if (st.status !== 'ready') setConsole('<span class="ok">Python is still loading. Your code will run as soon as it is ready…</span>', '');
    let data = {};
    try { data = current.inst.pyData ? current.inst.pyData() : {}; } catch (e) { console.error(e); }
    let res;
    try { res = await Py.run(cm.getValue(), data); } catch (e) { res = { error: e.message, stdout: '' }; }
    runBtn.disabled = false;
    $('#stopCode').hidden = true;
    if (current !== lessonAtRun) return;
    let html = res.stdout ? esc(res.stdout) + '\n' : '';
    if (res.error) {
        html += `<span class="err">${esc(res.error)}</span>`;
        setConsole(html, res.ms ? `${Math.round(res.ms)} ms` : '');
        if (res.line && cm) { errLine = res.line - 1; cm.addLineClass(errLine, 'background', 'cm-err-line'); }
        return;
    }
    if (res.result == null) html += `<span class="ok">✓ Done.</span> Set <b>result = {...}</b> at the end to send values back to the canvas.`;
    else {
        try {
            const label = current.inst.onPython ? current.inst.onPython(res.result) : null;
            html += `<span class="ok">✓ Ran in ${Math.round(res.ms)} ms. The canvas now shows the Python result.</span>`;
            pyResult(label || 'Showing Python result');
            checkSoon();
        } catch (e) {
            html += `<span class="err">The script ran, but its result could not be drawn: ${esc(e.message)}</span>`;
        }
    }
    setConsole(html, `${Math.round(res.ms)} ms`);
}
$('#runCode').addEventListener('click', runCode);
$('#stopCode').addEventListener('click', () => Py.stop());
$('#resetCode').addEventListener('click', () => { if (cm && current) { cm.setValue(applyParamsToCode(template)); setConsole('Script restored.', ''); } });
$('#consoleToggle').addEventListener('click', () => {
    const c = $('#console'); c.classList.toggle('collapsed');
    $('#consoleToggle').setAttribute('aria-expanded', String(!c.classList.contains('collapsed')));
});

function pyResult(label) {
    const chip = $('#pyResult');
    if (!label) {
        if (!chip.hidden && current && current.inst && current.inst.clearPython) current.inst.clearPython();
        chip.hidden = true;
        return;
    }
    $('#pyResultText').textContent = label;
    chip.hidden = false;
}
$('#pyResultClose').addEventListener('click', () => pyResult(null));

// Python pill + run label
Py.onStatus((s) => {
    const pill = $('#pyPill');
    pill.dataset.state = s.status;
    const label = pill.querySelector('.py-label');
    const run = $('#runLabel');
    if (s.status === 'loading') { label.textContent = `Python ${Math.round(s.pct)}%`; run.textContent = 'Run Code'; $('#pyStatus').textContent = `${s.stage}… ${Math.round(s.pct)}%`; }
    else if (s.status === 'ready') { label.textContent = 'Python Ready'; run.textContent = 'Run Code'; $('#pyStatus').textContent = 'Python Ready · runs on your device'; }
    else if (s.status === 'busy') { label.textContent = 'Running…'; run.textContent = 'Running…'; $('#pyStatus').textContent = 'Running…'; }
    else if (s.status === 'error') { label.textContent = 'Python unavailable'; $('#pyStatus').textContent = 'Python could not load in this browser. The interactive lesson still works.'; }
    else { label.textContent = 'Python'; $('#pyStatus').textContent = 'Python loads in the background (about 40 MB, cached after the first visit).'; }
    pill.title = s.status === 'error' ? (s.error || 'Python failed to load') : 'Python runs on your device with Pyodide. Click to open the sandbox.';
});
$('#pyPill').addEventListener('click', () => {
    if (current) selectTab('python');
    Py.start();
});

let pyScheduled = false;
function schedulePython() {
    if (pyScheduled) return;
    pyScheduled = true;
    const conn = navigator.connection;
    if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return; // wait for the visitor to ask
    if (/[?&]nopython/.test(location.search)) return; // dev/testing: only load Python on demand
    const go = () => Py.start();
    setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 4000 }) : go()), 1200);
}

// ---------- main loop ----------
let last = performance.now(), lastUi = 0;
function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (current && current.inst) {
        if (isPlaying && current.def.playback) {
            acc += dt * (current.def.playback.sps || 8) * SPEEDS[speedIdx];
            let n = 0;
            while (acc >= 1 && n < 60) {
                acc -= 1; n++;
                if (!stepOnce()) { playing(false); break; }
            }
        }
        try { current.inst.frame && current.inst.frame(dt, t); } catch (e) { console.error(e); }
        if (three && current.view !== '2d' && current.ctx.three) three.frame();
        if (t - lastUi > 140) {
            lastUi = t;
            renderMetrics();
            tourTick();
            checkPending = false;
            checkChallenges();
        }
    }
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// test/debug handle (same idea as games/cricket's window.__cricket)
window.__learn = { get current() { return current; }, setParam, selectView, stepOnce };

route();
if (!parseHash().l) schedulePython();
