// App shell: wires storage, media, canvas, panels, dialogs and keyboard shortcuts together.
import {
  S, on, emit, uid, newProject, media, labelById, addLabel, ann, objectsAt, findObject, commit, undo, redo,
  canUndo, canRedo, changed, createObject, setGeometry, updateObject, deleteObject, setOutside, deleteKeyframe,
  propagate, keyframesOf, allKeyframeFrames, objectCount, clearHistory, maxZ, defaultAttributes, ensureLabel, PALETTE,
} from './store.js';
import { db } from './db.js';
import {
  scanDirectory, sortPaths, kindOf, loadBitmap, openVideo, closeVideo, currentVideo, seekFrame, frameFromTime, ensureDims,
} from './media.js';
import { Viewer } from './canvas.js';
import * as F from './formats.js';
import { makeZip, readZip } from './zip.js';
import { model, loadModel, restoreModel, savedModelName, infer, describeModel, saveConfig, OUTPUT_KINDS } from './ai.js';
import { maskToPolygons, splitComponents } from './mask.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HAS_FSA = 'showDirectoryPicker' in window;

// toast
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
window.addEventListener('unhandledrejection', e => { console.error(e.reason); toast('Error: ' + (e.reason?.message || e.reason), 5000); });

// viewer
const viewer = new Viewer($('#canvas'), {
  onSelect: () => { renderObjects(); renderDetail(); },
  onCursor: p => { $('#stCursor').textContent = `x ${Math.round(p.x)}  y ${Math.round(p.y)}`; },
  onZoom: s => { $('#stZoom').textContent = `${Math.round(s * 100)}%`; },
  toast,
});
window.__viewer = viewer;

// persistence
let saveTimer = 0;
function scheduleSave() {
  if (!S.project) return;
  $('#saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!S.project) return;
  try {
    await db.put({ id: S.projectId, name: S.project.name, updated: Date.now(), project: S.project, handle: S.dirHandle || null });
    S.dirty = false;
    $('#saveState').textContent = 'Saved in browser';
  } catch (e) {
    $('#saveState').textContent = 'Save failed';
    toast('Could not save: ' + e.message, 5000);
  }
}
window.addEventListener('beforeunload', () => { if (S.dirty) saveNow(); });

async function ensurePermission(handle, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function saveToFolder() {
  if (!S.project) return;
  if (!S.dirHandle) return toast('This project was opened read-only. Use Export → LocalLabel JSON instead.');
  if (!await ensurePermission(S.dirHandle)) return toast('Write permission was not granted.');
  const dir = await S.dirHandle.getDirectoryHandle('.locallabel', { create: true });
  const fh = await dir.getFileHandle('project.json', { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify({ ...S.project, saved: new Date().toISOString() }));
  await w.close();
  await saveNow();
  toast('Saved to .locallabel/project.json in the folder');
}

// opening projects
async function openFolder() {
  if (!HAS_FSA) return $('#dirInput').click();
  let handle;
  try { handle = await window.showDirectoryPicker({ id: 'locallabel', mode: 'readwrite' }); }
  catch (e) { if (e.name !== 'AbortError') toast(e.message); return; }
  await loadFromHandle(handle);
}

async function findRecordForHandle(handle) {
  const list = await db.list();
  for (const r of list) {
    if (!r.hasHandle) continue;
    const rec = await db.get(r.id);
    try { if (await rec.handle.isSameEntry(handle)) return rec; } catch { /* stale handle */ }
  }
  return null;
}

async function readFolderProject(handle) {
  try {
    const dir = await handle.getDirectoryHandle('.locallabel');
    const fh = await dir.getFileHandle('project.json');
    const j = JSON.parse(await (await fh.getFile()).text());
    return j.format === 'locallabel' ? j : null;
  } catch { return null; }
}

async function loadFromHandle(handle, rec = null) {
  toast('Scanning folder…', 10000);
  const entries = sortPaths(await scanDirectory(handle));
  rec = rec || await findRecordForHandle(handle);
  let project = rec?.project || await readFolderProject(handle) || newProject(handle.name);
  await openProject({ id: rec?.id || uid(), project, handle, entries });
}

async function openFromFileList(files) {
  const list = [...files].filter(f => kindOf(f.name));
  if (!list.length) return toast('No images or videos in that selection.');
  const root = (list[0].webkitRelativePath || '').split('/')[0] || 'files';
  const entries = sortPaths(list.map(f => ({ path: f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name, handle: f })));
  const id = 'files:' + root;
  const rec = await db.get(id);
  await openProject({ id, project: rec?.project || newProject(root), handle: null, entries });
}

async function openProject({ id, project, handle, entries }) {
  closeVideo();
  S.project = project;
  S.projectId = id;
  S.dirHandle = handle;
  S.sources = new Map(entries.map(e => [e.path, e.handle]));
  const old = new Map(project.media.map(m => [m.id, m]));
  project.media = entries.map(e => old.get(e.path) || { id: e.path, kind: kindOf(e.path) });
  project.annotations ||= {};
  S.activeLabel = project.labels[0]?.id || null;
  S.selected = null;
  S.mediaId = null;
  clearHistory();
  $('#welcome').hidden = true;
  $('#projName').textContent = project.name;
  document.title = `${project.name} – LocalLabel`;
  renderMediaList();
  renderLabels();
  if (project.media.length) await showMedia(project.lastMedia && S.sources.has(project.lastMedia) ? project.lastMedia : project.media[0].id);
  else toast('No images or videos found in this folder.');
  await saveNow();
  toast(`${project.media.length} file(s) loaded`);
}

async function renderRecent() {
  const list = await db.list();
  const el = $('#recent');
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<h2>Recent projects</h2><ul>${list.slice(0, 8).map(r => `
    <li data-id="${escH(r.id)}"><span class="rname">${escH(r.name)}</span>
    <span class="muted small">${r.count} files · ${new Date(r.updated).toLocaleString()}</span>
    <button data-del="${escH(r.id)}" title="Forget this project (annotations are deleted from the browser)">✕</button></li>`).join('')}</ul>`;
  el.onclick = async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (await confirmDlg('Forget project?', 'Annotations stored in the browser for this project will be deleted. Files on disk are untouched.')) {
        await db.del(del.dataset.del); renderRecent();
      }
      return;
    }
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const rec = await db.get(li.dataset.id);
    if (rec?.handle) {
      try {
        if (!await ensurePermission(rec.handle)) return toast('Permission to the folder was not granted.');
        await loadFromHandle(rec.handle, rec);
      } catch (err) { toast('Folder is no longer available: ' + err.message, 5000); }
    } else {
      toast('Pick the same folder again to reconnect its annotations.');
      $('#dirInput').click();
    }
  };
}

// media
let seekToken = 0;
async function showMedia(id, { noAuto = false } = {}) {
  const m = S.project.media.find(x => x.id === id);
  if (!m) return;
  pause();
  viewer.cancelDraft();
  S.mediaId = id;
  S.selected = null;
  S.project.lastMedia = id;
  S.frame = m.kind === 'video' ? Math.min(m.lastFrame || 0, (m.frames || 1) - 1) : 0;
  $$('#mediaList li').forEach(li => li.classList.toggle('active', li.dataset.id === id));
  $('#mediaList li.active')?.scrollIntoView({ block: 'nearest' });
  try {
    if (m.kind === 'image') {
      closeVideo();
      const bmp = await loadBitmap(id);
      if (S.mediaId !== id) return;
      m.width = bmp.width; m.height = bmp.height;
      viewer.setSource(bmp, bmp.width, bmp.height, true);
      $('#player').hidden = true;
    } else {
      const v = await openVideo(m);
      if (S.mediaId !== id) return;
      S.frame = Math.min(S.frame, m.frames - 1);
      await seekFrame(m, S.frame);
      viewer.setSource(v, m.width, m.height, true);
      $('#player').hidden = false;
      setupPlayer();
    }
  } catch (e) {
    toast(e.message, 5000);
    viewer.setSource(null, 0, 0);
  }
  updateStatus();
  renderObjects();
  renderDetail();
  renderLabels();
  syncUndo();
  if (!noAuto) maybeAutoRun();
}

async function goFrame(f, { noAuto = false } = {}) {
  const m = media();
  if (!m || m.kind !== 'video') return;
  f = Math.max(0, Math.min(m.frames - 1, f | 0));
  if (f === S.frame && !playing) return;
  S.frame = f;
  m.lastFrame = f;
  viewer.cancelDraft();
  const tok = ++seekToken;
  updatePlayer();
  await seekFrame(m, f);
  if (tok !== seekToken) return;
  viewer.request();
  renderObjects();
  renderDetail();
  updateStatus();
  if (!noAuto) maybeAutoRun();
}

function stepMedia(delta) {
  const items = visibleMedia();
  const i = items.findIndex(m => m.id === S.mediaId);
  const n = items[Math.max(0, Math.min(items.length - 1, i + delta))];
  if (n && n.id !== S.mediaId) showMedia(n.id);
}

function visibleMedia() {
  const q = $('#mediaFilter').value.trim().toLowerCase();
  return S.project.media.filter(m => !q || m.id.toLowerCase().includes(q));
}

function renderMediaList() {
  const items = visibleMedia();
  $('#mediaCount').textContent = `${items.length}${items.length !== S.project.media.length ? ' / ' + S.project.media.length : ''}`;
  $('#mediaList').innerHTML = items.map(m => {
    const n = objectCount(m.id);
    return `<li data-id="${escH(m.id)}" class="${m.id === S.mediaId ? 'active' : ''}" title="${escH(m.id)}">
      <span class="kind">${m.kind === 'video' ? '▶' : '▣'}</span><span class="name">${escH(m.id)}</span>
      <span class="badge ${n ? '' : 'zero'}">${n}</span></li>`;
  }).join('') || '<li class="empty">No files</li>';
}
function updateMediaBadge() {
  const li = $(`#mediaList li[data-id="${CSS.escape(S.mediaId || '')}"] .badge`);
  if (!li) return;
  const n = objectCount(S.mediaId);
  li.textContent = n;
  li.classList.toggle('zero', !n);
}

// player
let playing = false;
function setupPlayer() {
  const m = media();
  $('#pSlider').max = m.frames - 1;
  $('#pFrame').max = m.frames - 1;
  $('#pTotal').textContent = `/ ${m.frames - 1}`;
  $('#pFps').value = m.fps;
  updatePlayer();
}
function updatePlayer() {
  const m = media();
  if (!m || m.kind !== 'video') return;
  $('#pSlider').value = S.frame;
  if (document.activeElement !== $('#pFrame')) $('#pFrame').value = S.frame;
  $('#pPlay').textContent = playing ? '❚❚' : '▶';
  $('#pTrack').classList.toggle('on', S.trackMode);
  drawTimelineMarks();
}
function drawTimelineMarks() {
  const m = media();
  const c = $('#tlMarks');
  const w = c.clientWidth, h = 8, dpr = devicePixelRatio || 1;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  if (!m?.frames) return;
  const x = f => 8 + (f / Math.max(1, m.frames - 1)) * (w - 16);
  ctx.fillStyle = 'rgba(64,210,190,.7)';
  const a = S.project.annotations[m.id];
  for (const s of a?.shapes || []) ctx.fillRect(x(s.frame || 0) - 0.5, 4, 1, 4);
  ctx.fillStyle = '#ffb02e';
  const kf = S.selected ? keyframesOf(S.selected) : [...allKeyframeFrames()];
  for (const f of kf) ctx.fillRect(x(f) - 1, 0, 2, 5);
}

function play() {
  const m = media(), v = currentVideo();
  if (!m || m.kind !== 'video' || !v) return;
  if (S.frame >= m.frames - 1) S.frame = 0;
  playing = true;
  viewer.cancelDraft();
  v.currentTime = (S.frame + 0.5) / m.fps;
  v.play();
  const tick = (_, meta) => {
    if (!playing) return;
    S.frame = frameFromTime(m, meta.mediaTime);
    viewer.request();
    updatePlayer();
    $('#stFrame').textContent = `frame ${S.frame} / ${m.frames - 1}`;
    v.requestVideoFrameCallback(tick);
  };
  v.requestVideoFrameCallback(tick);
  v.onended = () => pause();
  updatePlayer();
}
async function pause() {
  if (!playing) return;
  playing = false;
  const v = currentVideo(), m = media();
  if (v) v.pause();
  if (m?.kind === 'video') {
    S.frame = frameFromTime(m, v.currentTime);
    await seekFrame(m, S.frame);
    m.lastFrame = S.frame;
  }
  viewer.request();
  updatePlayer();
  updateStatus();
  renderObjects();
  renderDetail();
  maybeAutoRun();
}
function togglePlay() { playing ? pause() : play(); }

function jumpKeyframe(dir) {
  const frames = [...(S.selected && keyframesOf(S.selected).length ? keyframesOf(S.selected) : allKeyframeFrames())].sort((a, b) => a - b);
  const target = dir > 0 ? frames.find(f => f > S.frame) : frames.reverse().find(f => f < S.frame);
  if (target !== undefined) goFrame(target);
}

// labels
function renderLabels() {
  const labels = S.project?.labels || [];
  const counts = new Map();
  const a = S.project?.annotations[S.mediaId];
  for (const o of a ? objectsAt() : []) counts.set(o.label, (counts.get(o.label) || 0) + 1);
  $('#labelList').innerHTML = labels.length ? labels.map((l, i) => `
    <li data-id="${l.id}" class="${l.id === S.activeLabel ? 'active' : ''}" title="${i < 9 ? 'Shortcut ' + (i + 1) : ''}">
      <span class="swatch" style="background:${l.color}"></span>
      <span class="lname">${escH(l.name)}${l.skeleton ? ' <small class="muted">skeleton</small>' : ''}</span>
      <span class="muted small">${counts.get(l.id) || ''}</span>
      ${i < 9 ? `<kbd>${i + 1}</kbd>` : '<span></span>'}
      <button data-edit="${l.id}" title="Edit label">✎</button>
    </li>`).join('') : '<li class="empty">No labels yet. Add one to start drawing.</li>';
}

$('#labelList').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]');
  if (ed) return editLabel(labelById(ed.dataset.edit));
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  S.activeLabel = li.dataset.id;
  renderLabels();
});
$('#btnAddLabel').onclick = () => editLabel(null);

async function editLabel(label) {
  if (!S.project) return toast('Open a folder first.');
  const isNew = !label;
  const l = label || { name: '', color: PALETTE[S.project.labels.length % PALETTE.length], attributes: [], skeleton: null };
  const attrRow = (a = { name: '', type: 'select', values: [], default: '' }) => `
    <div class="attr-row">
      <input type="text" name="an" placeholder="name" value="${escH(a.name)}">
      <select name="at">${['select', 'checkbox', 'text', 'number'].map(t => `<option ${a.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input type="text" name="av" placeholder="values, comma separated" value="${escH((a.values || []).join(', '))}">
      <input type="text" name="ad" placeholder="default" value="${escH(a.default ?? '')}">
      <button type="button" class="icon" data-rm>✕</button>
    </div>`;
  const sk = l.skeleton;
  const body = `
    <div class="row"><label class="f" style="flex:1"><span>Name</span><input type="text" name="name" value="${escH(l.name)}" required autofocus></label>
    <label class="f"><span>Color</span><input type="color" name="color" value="${l.color}"></label></div>
    <div class="f"><span>Attributes</span><div class="attr-rows" id="attrRows">${(l.attributes || []).map(attrRow).join('')}</div>
      <button type="button" id="addAttr" class="small" style="justify-self:start">+ Attribute</button></div>
    <details ${sk ? 'open' : ''}><summary class="muted">Skeleton (for keypoint labels)</summary>
      <div class="db" style="padding:8px 0 0">
        <label class="f"><span>Nodes, in click order (comma separated)</span><input type="text" name="nodes" value="${escH(sk?.nodes.join(', ') || '')}" placeholder="nose, left_eye, right_eye"></label>
        <label class="f"><span>Edges (node names or 1-based numbers)</span><input type="text" name="edges" value="${escH(sk ? sk.edges.map(([a, b]) => `${sk.nodes[a]}-${sk.nodes[b]}`).join(', ') : '')}" placeholder="nose-left_eye, nose-right_eye"></label>
      </div></details>`;
  const res = await modal(isNew ? 'New label' : 'Edit label', body, [
    ...(isNew ? [] : [{ id: 'delete', text: 'Delete label', cls: 'danger', left: true }]),
    { id: 'cancel', text: 'Cancel' }, { id: 'ok', text: isNew ? 'Add' : 'Save', cls: 'primary' },
  ], form => {
    $('#addAttr', form).onclick = () => $('#attrRows', form).insertAdjacentHTML('beforeend', attrRow());
    $('#attrRows', form).onclick = e => { if (e.target.matches('[data-rm]')) e.target.closest('.attr-row').remove(); };
  }, form => {
    const name = form.name.value.trim();
    if (!name) return 'Name is required.';
    const clash = S.project.labels.find(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== label?.id);
    if (clash) return 'A label with that name exists.';
    const nodes = form.nodes.value.split(',').map(s => s.trim()).filter(Boolean);
    if (new Set(nodes).size !== nodes.length) return 'Skeleton node names must be unique.';
    for (const e of form.edges.value.split(',').map(s => s.trim()).filter(Boolean)) {
      const [a, b] = e.split('-').map(s => s.trim());
      const ix = v => (/^\d+$/.test(v) ? +v - 1 : nodes.indexOf(v));
      if (ix(a) < 0 || ix(b) < 0 || ix(a) >= nodes.length || ix(b) >= nodes.length) return `Edge "${e}" refers to an unknown node.`;
    }
  });
  if (!res) return;
  if (res.action === 'delete') {
    const used = Object.values(S.project.annotations).reduce((n, a) => n + a.shapes.filter(s => s.label === label.id).length + a.tracks.filter(t => t.label === label.id).length, 0);
    if (used && !await confirmDlg('Delete label?', `${used} object(s) use "${label.name}" and will be deleted too.`)) return;
    for (const a of Object.values(S.project.annotations)) {
      a.shapes = a.shapes.filter(s => s.label !== label.id);
      a.tracks = a.tracks.filter(t => t.label !== label.id);
    }
    S.project.labels = S.project.labels.filter(x => x.id !== label.id);
    if (S.activeLabel === label.id) S.activeLabel = S.project.labels[0]?.id || null;
    clearHistory();
    changed('labels');
    return;
  }
  const f = res.form;
  const attributes = $$('.attr-row', f).map(r => {
    const [an, at, av, ad] = $$('input,select', r).map(x => x.value.trim());
    if (!an) return null;
    const values = av.split(',').map(s => s.trim()).filter(Boolean);
    const def = at === 'checkbox' ? ad === 'true' : at === 'number' ? (ad === '' ? 0 : Number(ad)) : (ad || values[0] || '');
    return { name: an, type: at, values, default: def };
  }).filter(Boolean);
  const nodes = f.nodes.value.split(',').map(s => s.trim()).filter(Boolean);
  const ix = v => (/^\d+$/.test(v) ? +v - 1 : nodes.indexOf(v));
  const edges = f.edges.value.split(',').map(s => s.trim()).filter(Boolean).map(e => e.split('-').map(s => ix(s.trim())));
  const patch = { name: f.name.value.trim(), color: f.color.value, attributes, skeleton: nodes.length ? { nodes, edges } : null };
  if (isNew) addLabel(patch.name, patch.color, patch);
  else { Object.assign(label, patch); changed('labels'); }
}

// objects panel
const TYPE_ICON = { rectangle: '▭', polygon: '⬠', polyline: '〰', points: '⁘', ellipse: '◯', skeleton: '✱', mask: '▦' };
function renderObjects() {
  if (!S.project || !S.mediaId) { $('#objList').innerHTML = ''; return; }
  const objs = objectsAt().slice().reverse();
  $('#objCount').textContent = objs.length || '';
  $('#objList').innerHTML = objs.length ? objs.map((o, i) => {
    const l = labelById(o.label);
    const tr = o.kind === 'track' ? (o.keyframe ? ' ◆' : ' ◇') : '';
    return `<li data-id="${o.id}" class="${o.id === S.selected ? 'sel' : ''} ${o.hidden ? 'hidden-obj' : ''}">
      <span class="dot" style="background:${l?.color || '#888'}"></span>
      <span class="oname">${TYPE_ICON[o.type]} ${escH(l?.name || '?')}<small>${o.kind === 'track' ? 'track' : ''}${tr}${o.source === 'auto' ? ' AI' : ''}</small></span>
      <span class="acts">
        <button data-act="hidden" class="${o.hidden ? 'on' : ''}" title="Hide (H)">${o.hidden ? '◌' : '◉'}</button>
        <button data-act="locked" class="${o.locked ? 'on' : ''}" title="Lock (Shift+L)">${o.locked ? '🔒' : '🔓'}</button>
        <button data-act="occluded" class="${o.occluded ? 'on' : ''}" title="Occluded (Q)">◐</button>
        <button data-act="delete" title="Delete (Del)">✕</button>
      </span></li>`;
  }).join('') : '<li class="empty">No objects on this frame.</li>';
  renderLabels();
}
$('#objList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const id = li.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'delete') return deleteObject(id);
  if (act) {
    const o = findObject(id);
    return updateObject(id, { [act]: !o[act] });
  }
  S.selected = id;
  if (S.tool !== 'select') setTool('select');
  viewer.request(); renderObjects(); renderDetail(); drawTimelineMarks();
});
$('#objList').addEventListener('mouseover', e => {
  const id = e.target.closest('li[data-id]')?.dataset.id || null;
  if (viewer.hover !== id) { viewer.hover = id; viewer.request(); }
});

function renderDetail() {
  const o = S.selected ? findObject(S.selected) : null;
  $('#detailPanel').hidden = !o;
  if (!o) return;
  const l = labelById(o.label);
  $('#detailTitle').textContent = `${o.type}${o.kind === 'track' ? ' track' : ''}`;
  const attrs = (l?.attributes || []).map(a => {
    const v = o.attributes?.[a.name] ?? a.default;
    let input;
    if (a.type === 'select') input = `<select data-attr="${escH(a.name)}">${a.values.map(x => `<option ${String(v) === x ? 'selected' : ''}>${escH(x)}</option>`).join('')}</select>`;
    else if (a.type === 'checkbox') input = `<input type="checkbox" data-attr="${escH(a.name)}" ${v === true || v === 'true' ? 'checked' : ''}>`;
    else input = `<input type="${a.type === 'number' ? 'number' : 'text'}" data-attr="${escH(a.name)}" value="${escH(v)}">`;
    return `<label class="field"><span title="${escH(a.name)}">${escH(a.name)}</span>${input}</label>`;
  }).join('');
  const isVideo = media()?.kind === 'video';
  $('#detail').innerHTML = `
    <label class="field"><span>Label</span><select id="dLabel">${S.project.labels.map(x => `<option value="${x.id}" ${x.id === o.label ? 'selected' : ''}>${escH(x.name)}</option>`).join('')}</select></label>
    ${attrs}
    <div class="field"><span>Flags</span><div class="row">
      <label><input type="checkbox" id="dOcc" ${o.occluded ? 'checked' : ''}> occluded</label>
      <label><input type="checkbox" id="dLock" ${o.locked ? 'checked' : ''}> locked</label></div></div>
    ${o.rotation ? `<div class="field"><span>Rotation</span><span>${Math.round(o.rotation * 10) / 10}°</span></div>` : ''}
    ${o.kind === 'track' ? `<div class="field"><span>Track</span><span>${o.keyframe ? 'keyframe' : 'interpolated'} · ${keyframesOf(o.id).length} keyframes</span></div>` : ''}
    <div class="btns">
      <button data-d="up" title="PageUp">Raise</button><button data-d="down" title="PageDown">Lower</button>
      ${['polygon', 'rectangle', 'ellipse'].includes(o.type) && o.kind === 'shape' ? '<button data-d="tomask">To mask</button>' : ''}
      ${o.type === 'mask' && o.kind === 'shape' ? '<button data-d="topoly" title="Replace the mask with editable polygons">To polygons</button>' : ''}
      ${o.kind === 'track' ? '<button data-d="kfdel">Delete keyframe</button><button data-d="outside" title="Shift+O">Outside from here</button>' : ''}
      ${isVideo && o.kind === 'shape' && o.type !== 'mask' ? '<button data-d="totrack">Make track</button>' : ''}
      <button data-d="delete" class="danger">Delete</button>
    </div>`;
}
$('#detail').addEventListener('change', e => {
  const o = findObject(S.selected);
  if (!o) return;
  if (e.target.id === 'dLabel') {
    const attributes = { ...defaultAttributes(e.target.value) };
    return updateObject(o.id, { label: e.target.value, attributes });
  }
  if (e.target.id === 'dOcc') return updateObject(o.id, { occluded: e.target.checked });
  if (e.target.id === 'dLock') return updateObject(o.id, { locked: e.target.checked });
  const name = e.target.dataset.attr;
  if (name !== undefined) {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    updateObject(o.id, { attributes: { ...o.attributes, [name]: v } });
  }
});
$('#detail').addEventListener('click', e => {
  const d = e.target.closest('[data-d]')?.dataset.d;
  const o = findObject(S.selected);
  if (!d || !o) return;
  const m = media();
  if (d === 'delete') deleteObject(o.id);
  else if (d === 'up') updateObject(o.id, { z: maxZ() + 1 });
  else if (d === 'down') updateObject(o.id, { z: Math.min(...objectsAt().map(x => x.z)) - 1 });
  else if (d === 'kfdel') deleteKeyframe(o.id);
  else if (d === 'outside') setOutside(o.id);
  else if (d === 'tomask') {
    const mask = F.objectToMask(o, m.width, m.height);
    if (!mask) return;
    commit(a => {
      const s = a.shapes.find(x => x.id === o.id);
      Object.assign(s, { type: 'mask', mask, rotation: 0, points: [mask.left, mask.top, mask.left + mask.width, mask.top + mask.height] });
    });
  } else if (d === 'topoly') {
    const polys = maskToPolygons(o.mask);
    if (!polys.length) return;
    const ids = [];
    commit(a => {
      const s = a.shapes.find(x => x.id === o.id);
      a.shapes = a.shapes.filter(x => x !== s);
      for (const p of polys) {
        const id = uid(); ids.push(id);
        a.shapes.push({ ...s, id, type: 'polygon', points: p.map(v => Math.round(v * 100) / 100), mask: undefined, rotation: 0 });
      }
    });
    S.selected = ids[0]; renderObjects(); renderDetail(); viewer.request();
  } else if (d === 'totrack') {
    commit(a => {
      const s = a.shapes.find(x => x.id === o.id);
      a.shapes = a.shapes.filter(x => x !== s);
      a.tracks.push({ id: s.id, type: s.type, label: s.label, z: s.z, attributes: s.attributes, source: s.source,
        keyframes: [{ frame: s.frame || 0, points: s.points, rotation: s.rotation || 0, occluded: !!s.occluded, outside: false }] });
    });
  }
});

// tools
function setTool(t) {
  if (S.tool !== t) viewer.cancelDraft();
  S.tool = t;
  $$('#tools [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  $('#brushPanel').hidden = !(t === 'brush' || t === 'eraser');
  $('#stTool').textContent = t;
  viewer.c.style.cursor = t === 'select' ? 'default' : 'crosshair';
  viewer.request();
}
$('#tools').addEventListener('click', e => {
  const b = e.target.closest('[data-tool]');
  if (b) setTool(b.dataset.tool);
});
$('#btnFit').onclick = () => viewer.fit();
$('#brushRadius').oninput = e => { S.brushRadius = +e.target.value; $('#brushVal').textContent = S.brushRadius; viewer.request(); };
$('#fillOpacity').oninput = e => { S.fillOpacity = +e.target.value / 100; viewer.request(); };
$('#showLabels').onchange = e => { S.showLabels = e.target.checked; viewer.request(); };

// status / sync
function updateStatus() {
  const m = media();
  $('#stMedia').textContent = m ? `${m.id} · ${m.width || '?'}×${m.height || '?'}` : '';
  $('#stFrame').textContent = m?.kind === 'video' ? `frame ${S.frame} / ${m.frames - 1} · ${m.fps} fps` : '';
}
function syncUndo() {
  $('#btnUndo').disabled = !S.mediaId || !canUndo();
  $('#btnRedo').disabled = !S.mediaId || !canRedo();
}

on('change', kind => {
  if (S.selected && !findObject(S.selected)) S.selected = null;
  viewer.request();
  renderObjects();
  renderDetail();
  updateMediaBadge();
  drawTimelineMarks();
  syncUndo();
  if (kind === 'labels' || kind === 'import') renderLabels();
  if (kind === 'import') renderMediaList();
  scheduleSave();
});

// dialogs
// buttons: [{id, text, cls, left}] ; setup(form) ; validate(form) -> error string
function modal(title, bodyHtml, buttons, setup, validate) {
  const dlg = $('#dlg'), form = $('#dlgForm');
  form.innerHTML = `<div class="dh">${escH(title)}</div><div class="db">${bodyHtml}<p class="note" id="dlgErr" style="color:var(--danger)"></p></div>
    <div class="df"><div class="left-btns">${buttons.filter(b => b.left).map(b => `<button type="button" value="${b.id}" class="${b.cls || ''}">${escH(b.text)}</button>`).join('')}</div>
    ${buttons.filter(b => !b.left).map(b => `<button type="button" value="${b.id}" class="${b.cls || ''}">${escH(b.text)}</button>`).join('')}</div>`;
  setup?.(form);
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; dlg.close(); resolve(v); };
    form.querySelectorAll('.df button').forEach(b => b.onclick = () => {
      if (b.value === 'cancel') return finish(null);
      if (b.value === 'ok' && validate) {
        const err = validate(form);
        if (err) { $('#dlgErr').textContent = err; return; }
      }
      finish({ action: b.value, form });
    });
    form.onsubmit = e => { e.preventDefault(); form.querySelector('.df button.primary')?.click(); };
    dlg.oncancel = () => finish(null);
    dlg.showModal();
  });
}
async function confirmDlg(title, text) {
  const r = await modal(title, `<p class="note" style="font-size:13px;color:var(--text)">${escH(text)}</p>`, [{ id: 'cancel', text: 'Cancel' }, { id: 'ok', text: 'Continue', cls: 'primary' }]);
  return !!r;
}

function showHelp() {
  const rows = [
    ['V R P L O E K', 'Select, rectangle, polygon, polyline, points, ellipse, skeleton'],
    ['B / X', 'Mask brush / eraser · [ ] radius'],
    ['Enter / Esc', 'Finish / cancel drawing (Esc also deselects)'],
    ['Shift + move', 'Freehand polygon/polyline: hold Shift and move to trace; releasing Shift completes the shape'],
    ['Backspace', 'Remove last drawn point'],
    ['1 – 9', 'Pick label (in Select mode, also relabels the selected object)'],
    ['D / F', 'Previous / next frame (video) or file (images) · Shift = ±10'],
    ['Space', 'Play / pause video'],
    ['T', 'Toggle track mode'],
    ['Shift+O', 'Selected track is outside from this frame'],
    ['Ctrl+B', 'Propagate selected shape forward'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
    ['Del, Ctrl+C, Ctrl+V', 'Delete, copy, paste'],
    ['H, Q, Shift+L', 'Hide, occluded, lock'],
    ['PageUp / PageDown', 'Raise / lower'],
    ['Tab', 'Select next object'],
    ['Wheel, right/middle drag, 0', 'Zoom, pan, fit'],
    ['Double-click edge', 'Add a polygon or mask-outline point · Alt+click a point removes it'],
    ['Ctrl+S', 'Save to folder'],
  ];
  modal('Keyboard shortcuts', `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`, [{ id: 'ok', text: 'Close', cls: 'primary' }]);
}

// export / import
async function deliver(files, zipName, forceZip) {
  const single = files.length === 1 && !forceZip;
  const blob = single ? new Blob([files[0].data]) : makeZip(files);
  const name = single ? files[0].name.split('/').pop() : zipName;
  return { blob, name };
}
async function exportDialog() {
  if (!S.project) return toast('Open a folder first.');
  const res = await modal('Export annotations', `
    <label class="f"><span>Format</span><select name="fmt">${Object.entries(F.FORMATS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
    <label class="row"><input type="checkbox" name="images"> Include images (video frames are written as JPEG)</label>
    <label class="f"><span>Destination</span><select name="dest"><option value="download">Download</option>${S.dirHandle ? '<option value="folder">Save into the folder (exports/)</option>' : ''}</select></label>
    <div class="progress" hidden><div></div></div>
    <p class="note">Only formats that can hold a shape type keep it; anything skipped is listed after export.</p>`,
  [{ id: 'cancel', text: 'Cancel' }, { id: 'ok', text: 'Export', cls: 'primary' }]);
  if (!res) return;
  const fmt = res.form.fmt.value, includeImages = res.form.images.checked, dest = res.form.dest.value;
  await saveNow();
  toast('Exporting…', 60000);
  const keep = S.mediaId;
  let out;
  try {
    if (fmt === 'json') out = F.exportJSON();
    else if (fmt === 'coco') out = await F.exportCOCO({ includeImages });
    else if (fmt === 'cvat') out = await F.exportCVAT();
    else if (fmt.startsWith('yolo')) out = await F.exportYOLO({ variant: fmt === 'yolo' ? 'detect' : fmt === 'yolo_obb' ? 'obb' : 'seg', includeImages });
    else if (fmt === 'voc') out = await F.exportVOC({ includeImages });
  } finally {
    if (media(keep)?.kind === 'video') await showMedia(keep);
  }
  const base = `${S.project.name}_${fmt}`;
  const { blob, name } = await deliver(out.files, `${base}.zip`, out.zip || includeImages);
  if (dest === 'folder') {
    if (!await ensurePermission(S.dirHandle)) return toast('Write permission was not granted.');
    const dir = await S.dirHandle.getDirectoryHandle('exports', { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(blob); await w.close();
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  toast(`Exported ${name}${dest === 'folder' ? ' to exports/' : ''}` + (out.warnings.length ? `\nSkipped: ${out.warnings.join('; ')}` : ''), out.warnings.length ? 7000 : 3000);
}

async function importDialog() {
  if (!S.project) return toast('Open a folder first.');
  const res = await modal('Import annotations', `
    <label class="f"><span>Format</span><select name="fmt">${Object.entries(F.FORMATS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
    <label class="f"><span>File(s) — a .zip or the individual files</span><input type="file" name="files" multiple></label>
    <p class="note">Annotations are matched to files in this folder by name (images) or by <code>video_000123</code> frame names. Imported objects are added to what you already have.</p>`,
  [{ id: 'cancel', text: 'Cancel' }, { id: 'ok', text: 'Import', cls: 'primary' }], null, f => (f.files.files.length ? null : 'Choose at least one file.'));
  if (!res) return;
  const fmt = res.form.fmt.value;
  let files = [];
  for (const file of res.form.files.files) {
    if (/\.zip$/i.test(file.name)) {
      for (const z of await readZip(await file.arrayBuffer())) files.push({ name: z.name, text: new TextDecoder().decode(z.bytes) });
    } else files.push({ name: file.name, text: await file.text() });
  }
  const pick = re => files.find(f => re.test(f.name));
  let r;
  if (fmt === 'json') r = F.importJSON((pick(/\.json$/i) || files[0]).text);
  else if (fmt === 'coco') r = await F.importCOCO((pick(/instances.*\.json$/i) || pick(/\.json$/i) || files[0]).text);
  else if (fmt === 'cvat') {
    r = { count: 0, warnings: [] };
    for (const f of files.filter(f => /\.xml$/i.test(f.name))) { const x = F.importCVAT(f.text); r.count += x.count; r.warnings.push(...x.warnings); }
  } else if (fmt.startsWith('yolo')) r = await F.importYOLO(files);
  else if (fmt === 'voc') r = await F.importVOC(files);
  clearHistory();
  if (!S.activeLabel) S.activeLabel = S.project.labels[0]?.id || null;
  changed('import');
  if (media()?.kind === 'video') await showMedia(S.mediaId);
  toast(`Imported ${r.count} object(s)` + (r.warnings.length ? `\n${r.warnings.join('\n')}` : ''), r.warnings.length ? 7000 : 3000);
}

// AI assist
let aiCancel = false;
function aiSettingsHtml() {
  return `
    <details id="aiSettings"><summary class="muted">Model settings (custom / segmentation models)</summary>
      <div class="db" style="padding:8px 0 0">
        <div class="row">
          <label class="f" style="flex:1"><span>Input width</span><input type="number" name="in_w" min="8"></label>
          <label class="f" style="flex:1"><span>Input height</span><input type="number" name="in_h" min="8"></label>
          <label class="f" style="flex:1"><span>Layout</span><select name="layout"><option value="nchw">NCHW</option><option value="nhwc">NHWC</option></select></label>
        </div>
        <div class="row">
          <label class="f" style="flex:1"><span>Resize</span><select name="resize"><option value="letterbox">Letterbox (keep aspect)</option><option value="stretch">Stretch</option></select></label>
          <label class="f" style="flex:1"><span>Channels</span><select name="order"><option value="rgb">RGB</option><option value="bgr">BGR</option></select></label>
          <label class="f" style="flex:1"><span>Pixel range</span><select name="scale"><option value="255">0–1 (÷255)</option><option value="1">0–255</option></select></label>
        </div>
        <div class="row">
          <label class="f" style="flex:1"><span>Mean (R,G,B)</span><input type="text" name="mean"></label>
          <label class="f" style="flex:1"><span>Std (R,G,B)</span><input type="text" name="std"></label>
          <button type="button" class="small" id="presetImagenet" style="align-self:end">ImageNet</button>
          <button type="button" class="small" id="presetNone" style="align-self:end">None</button>
        </div>
        <label class="f"><span>Output</span><select name="output">${Object.entries(OUTPUT_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <div class="row">
          <label class="f" style="flex:1"><span>Background class index (semantic; −1 = none)</span><input type="number" name="bg" min="-1"></label>
          <label class="f" style="flex:1"><span>Mask threshold</span><input type="number" name="maskthr" step="0.05" min="0.05" max="0.95"></label>
        </div>
        <div class="row">
          <label class="f" style="flex:1"><span>Save masks as</span><select name="as"><option value="mask">Masks</option><option value="polygon">Polygons (traced)</option></select></label>
          <label class="row" style="flex:1;align-self:end"><input type="checkbox" name="split"> Split into separate objects (connected regions)</label>
        </div>
        <label class="f"><span>Class names, in output order (comma separated)</span><textarea name="names" rows="2"></textarea></label>
      </div>
    </details>`;
}
function fillAiSettings(f, c) {
  f.in_w.value = c.width; f.in_h.value = c.height; f.layout.value = c.layout; f.resize.value = c.resize; f.order.value = c.order;
  f.scale.value = c.scale === 1 ? '1' : '255'; f.mean.value = c.mean.join(', '); f.std.value = c.std.join(', ');
  f.output.value = c.output; f.bg.value = c.bg; f.maskthr.value = c.maskThr; f.as.value = c.as; f.split.checked = !!c.split; f.names.value = c.names;
}
function readAiSettings(f) {
  const three = (s, d) => { const v = s.split(',').map(x => parseFloat(x)); return v.length === 3 && v.every(Number.isFinite) ? v : d; };
  return {
    ...(model.cfg || {}), width: Math.max(8, +f.in_w.value | 0), height: Math.max(8, +f.in_h.value | 0), layout: f.layout.value,
    resize: f.resize.value, order: f.order.value, scale: f.scale.value === '1' ? 1 : 1 / 255,
    mean: three(f.mean.value, [0, 0, 0]), std: three(f.std.value, [1, 1, 1]).map(v => v || 1), output: f.output.value,
    bg: Number.isFinite(+f.bg.value) ? +f.bg.value : 0, maskThr: Math.min(0.95, Math.max(0.05, +f.maskthr.value || 0.5)),
    as: f.as.value, split: f.split.checked, names: f.names.value.trim(),
  };
}

// Run options (thresholds, label creation, auto-run) are remembered in this browser.
const RUN_DEFAULTS = { conf: 0.35, iou: 0.45, create: false, replace: true, gpu: true, auto: false };
function runOpts() {
  try { return { ...RUN_DEFAULTS, ...JSON.parse(localStorage.getItem('aiRun') || '{}') }; } catch { return { ...RUN_DEFAULTS }; }
}
function saveRunOpts(o) { try { localStorage.setItem('aiRun', JSON.stringify(o)); } catch { /* ignore */ } syncAutoButton(); }
function syncAutoButton() {
  const o = runOpts();
  const b = $('#btnAIAuto');
  b.classList.toggle('on', !!o.auto);
  b.title = o.auto ? `Auto-run is on${model.loaded ? ' · ' + model.name : ''}: the model runs on each image/frame you open (frames that already have AI results are skipped)` : 'Run the AI model automatically on each image/frame you open';
}

async function aiDialog() {
  if (!S.project || !S.mediaId) return toast('Open a folder first.');
  const m = media();
  const ro = runOpts();
  const lastName = model.loaded ? null : await savedModelName();
  const info = () => model.loaded
    ? `Loaded: <b>${escH(model.name)}</b> · ${model.backend}<br><span class="small">${escH(describeModel())}</span>`
    : lastName ? `Last model <b>${escH(lastName)}</b> will be reused (no need to pick it again), or choose another file.`
      : 'No model loaded. Pick an .onnx file (YOLO, or your own detection/segmentation model — see Model settings).';
  let loading = null;
  const res = await modal('AI assist · automatic annotation', `
    <label class="f"><span>Model (.onnx from your disk)</span><input type="file" name="model" accept=".onnx"></label>
    <p class="note" id="aiInfo">${info()}</p>
    ${aiSettingsHtml()}
    <label class="f"><span>Run on</span><select name="scope">
      <option value="frame">${m.kind === 'video' ? 'Current frame' : 'Current image'}</option>
      ${m.kind === 'image' ? '<option value="images">All images in the project</option>' : '<option value="video">This video, every Nth frame</option>'}
      <option value="none">Nothing now (just save settings)</option>
    </select></label>
    ${m.kind === 'video' ? '<label class="f"><span>Every Nth frame</span><input type="number" name="step" value="10" min="1"></label>' : ''}
    <div class="row"><label class="f" style="flex:1"><span>Confidence ≥ <b id="confV">${ro.conf}</b></span><input type="range" name="conf" min="0.05" max="0.95" step="0.05" value="${ro.conf}"></label>
    <label class="f" style="flex:1"><span>NMS IoU <b id="iouV">${ro.iou}</b></span><input type="range" name="iou" min="0.1" max="0.9" step="0.05" value="${ro.iou}"></label></div>
    <label class="row"><input type="checkbox" name="auto" ${ro.auto ? 'checked' : ''}> <b>Auto-run when I open another image or frame</b></label>
    <label class="row"><input type="checkbox" name="create" ${ro.create || !S.project.labels.length ? 'checked' : ''}> Create labels for detected classes that don't exist yet (otherwise they are skipped)</label>
    <label class="row"><input type="checkbox" name="replace" ${ro.replace ? 'checked' : ''}> Replace earlier AI results in the same frames</label>
    <label class="row"><input type="checkbox" name="gpu" ${ro.gpu ? 'checked' : ''}> Use WebGPU when available</label>`,
  [{ id: 'cancel', text: 'Close' }, { id: 'run', text: 'Run', cls: 'primary' }], form => {
    form.conf.oninput = () => { $('#confV').textContent = form.conf.value; };
    form.iou.oninput = () => { $('#iouV').textContent = form.iou.value; };
    $('#presetImagenet', form).onclick = () => { form.mean.value = '0.485, 0.456, 0.406'; form.std.value = '0.229, 0.224, 0.225'; form.scale.value = '255'; };
    $('#presetNone', form).onclick = () => { form.mean.value = '0, 0, 0'; form.std.value = '1, 1, 1'; };
    const loaded = () => { $('#aiInfo').innerHTML = info(); fillAiSettings(form, model.cfg); $('#aiSettings', form).open = !model.namesFromModel; };
    if (model.loaded) loaded();
    else if (lastName) loading = restoreModel(form.gpu.checked).then(r => { if (r) loaded(); }).catch(() => {});
    form.model.onchange = () => {
      const file = form.model.files[0];
      if (!file) return;
      $('#aiInfo').textContent = 'Loading model…';
      model.loaded = false;
      loading = loadModel(file, form.gpu.checked).then(loaded)
        .catch(e => { $('#aiInfo').textContent = 'Model failed to load: ' + e.message; throw e; });
    };
  });
  if (!res) return;
  const f = res.form;
  try {
    if (loading) await loading;
    else if (f.model.files[0] && !model.loaded) await loadModel(f.model.files[0], f.gpu.checked);
    if (!model.loaded) return toast('Choose a model file first.');
  } catch (e) { return toast('Model failed to load: ' + e.message, 6000); }
  saveConfig(readAiSettings(f));
  const opts = { conf: +f.conf.value, iou: +f.iou.value, create: f.create.checked, replace: f.replace.checked, gpu: f.gpu.checked, auto: f.auto.checked };
  saveRunOpts(opts);

  let jobs = [];
  if (f.scope.value === 'frame') jobs = [[m, S.frame]];
  else if (f.scope.value === 'images') jobs = S.project.media.filter(x => x.kind === 'image').map(x => [x, 0]);
  else if (f.scope.value === 'video') { const step = Math.max(1, +f.step.value || 10); for (let i = 0; i < m.frames; i += step) jobs.push([m, i]); }
  if (!jobs.length) return toast(opts.auto ? 'Settings saved · auto-run is on' : 'Settings saved');
  await runAI(jobs, opts);
}

// Run the loaded model on [media, frame] jobs and add the results as objects (one undo step per frame).
async function runAI(jobs, opts, { quiet = false } = {}) {
  const cfg = model.cfg;
  const keepMedia = S.mediaId, keepFrame = S.frame;
  const onlyCurrent = jobs.length === 1 && jobs[0][0].id === keepMedia && jobs[0][1] === keepFrame;
  aiCancel = false;
  let total = 0, msSum = 0, kind = '', error = null;
  const skipped = new Set();
  try {
    for (let j = 0; j < jobs.length; j++) {
      if (aiCancel) break;
      const [mm, fr] = jobs[j];
      if (!quiet) toast(`AI: ${j + 1} / ${jobs.length} (Esc to stop)`, 60000);
      const r = await infer(mm, fr, { conf: opts.conf, iou: opts.iou });
      msSum += r.ms; kind = r.kind;
      // resolve labels before the undo snapshot so label creation isn't half-undone
      const resolved = r.items.map(it => {
        const label = opts.create ? ensureLabel(it.name) : S.project.labels.find(l => l.name.toLowerCase() === String(it.name).toLowerCase());
        if (!label) skipped.add(it.name);
        return [it, label];
      });
      commit(a => {
        if (opts.replace) a.shapes = a.shapes.filter(s => !(s.source === 'auto' && (s.frame || 0) === fr));
        let z = a.shapes.length + a.tracks.length;
        const add = (label, type, points, extra = {}) => {
          a.shapes.push({ id: uid(), type, label: label.id, frame: fr, points: points.map(v => Math.round(v * 100) / 100), rotation: 0,
            occluded: false, z: ++z, source: 'auto', attributes: { ...defaultAttributes(label.id) }, ...extra });
          total++;
        };
        for (const [it, label] of resolved) {
          if (!label) continue;
          const score = Math.round(it.score * 1000) / 1000;
          if (it.type === 'box') { add(label, 'rectangle', it.box, { score }); continue; }
          const masks = cfg.split ? splitComponents(it.mask) : [it.mask];
          for (const mk of masks) {
            if (cfg.as === 'polygon') for (const poly of maskToPolygons(mk)) add(label, 'polygon', poly, { score });
            else add(label, 'mask', [mk.left, mk.top, mk.left + mk.width, mk.top + mk.height], { mask: mk, score });
          }
        }
      }, mm.id);
    }
  } catch (e) {
    error = e;
  }
  if (!S.activeLabel) S.activeLabel = S.project.labels[0]?.id || null;
  // other images/frames were decoded during the run, which can evict the one on screen, so show it again
  if (!onlyCurrent && media(keepMedia)) {
    await showMedia(keepMedia, { noAuto: true });
    if (media(keepMedia).kind === 'video') await goFrame(keepFrame, { noAuto: true });
  }
  changed('import');
  if (error) return toast('AI failed: ' + error.message + '\nCheck Model settings (input size, layout, output type).', 8000);
  if (total || !aiCancel) toast(`AI added ${total} object(s) · ${OUTPUT_KINDS[kind] || kind} · ${Math.round(msSum / Math.max(1, jobs.length))} ms/frame on ${model.backend}` +
    (skipped.size ? `\nSkipped classes without a label: ${[...skipped].slice(0, 8).join(', ')}${skipped.size > 8 ? '…' : ''}` : ''), quiet ? 2500 : 6000);
}

// Auto-run on the image/frame just opened (debounced; skipped while playing or if AI results already exist there).
let autoTimer = 0, autoBusy = false, autoNoModelWarned = false;
function maybeAutoRun() {
  const o = runOpts();
  if (!o.auto || playing) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    const m = media();
    if (!m || autoBusy || playing) return;
    const fr = S.frame;
    const a = S.project.annotations[m.id];
    if (a?.shapes.some(s => s.source === 'auto' && (s.frame || 0) === fr)) return;
    autoBusy = true;
    try {
      if (!model.loaded && !await restoreModel(o.gpu)) {
        if (!autoNoModelWarned) { autoNoModelWarned = true; toast('Auto-run is on but no model is loaded — open AI assist and pick one.', 5000); }
        return;
      }
      if (S.mediaId !== m.id || S.frame !== fr) return; // user moved on; the next change re-triggers
      await runAI([[m, fr]], o, { quiet: true });
    } finally { autoBusy = false; }
  }, 250);
}

// clipboard / misc actions
let clipboard = null;
function copySel() {
  const o = S.selected && findObject(S.selected);
  if (!o) return;
  clipboard = JSON.parse(JSON.stringify({ type: o.type, label: o.label, points: o.points, rotation: o.rotation, mask: o.mask, attributes: o.attributes, occluded: o.occluded }));
  toast('Copied');
}
function paste() {
  if (!clipboard || !media()) return;
  const c = clipboard;
  const obj = createObject(c.type, c.points, { label: c.label, rotation: c.rotation, mask: c.mask, attributes: c.attributes, occluded: c.occluded });
  if (obj) { S.selected = obj.id; renderObjects(); renderDetail(); }
}
async function propagateDlg() {
  const o = S.selected && findObject(S.selected);
  const m = media();
  if (!o || m?.kind !== 'video') return toast('Select a shape on a video frame first.');
  if (o.kind === 'track') return toast('Tracks already continue across frames.');
  const res = await modal('Propagate', `<label class="f"><span>Copy to the next N frames</span><input type="number" name="n" value="10" min="1" max="${m.frames}"></label>`,
    [{ id: 'cancel', text: 'Cancel' }, { id: 'ok', text: 'Propagate', cls: 'primary' }]);
  if (!res) return;
  const n = propagate(o.id, +res.form.n.value || 10);
  toast(`Copied to ${n} frame(s)`);
}
function cycleSelection(dir) {
  const objs = objectsAt().filter(o => !o.hidden);
  if (!objs.length) return;
  const i = objs.findIndex(o => o.id === S.selected);
  S.selected = objs[(i + dir + objs.length) % objs.length].id;
  viewer.request(); renderObjects(); renderDetail();
}

// keyboard
document.addEventListener('keydown', e => {
  if ($('#dlg').open) return;
  if (e.target.closest('input, select, textarea')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (!S.project) return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  const sel = S.selected ? findObject(S.selected) : null;
  const m = media();
  const toolKeys = { v: 'select', r: 'rectangle', p: 'polygon', l: 'polyline', o: 'points', e: 'ellipse', k: 'skeleton', b: 'brush', x: 'eraser' };
  let handled = true;
  if (ctrl && k.toLowerCase() === 'z') { e.shiftKey ? redo() : undo(); }
  else if (ctrl && k.toLowerCase() === 'y') redo();
  else if (ctrl && k.toLowerCase() === 's') saveToFolder();
  else if (ctrl && k.toLowerCase() === 'c') copySel();
  else if (ctrl && k.toLowerCase() === 'v') paste();
  else if (ctrl && k.toLowerCase() === 'b') propagateDlg();
  else if (ctrl) handled = false;
  else if (k === 'Escape') { aiCancel = true; if (viewer.draft) viewer.cancelDraft(); else if (S.selected) { S.selected = null; viewer.request(); renderObjects(); renderDetail(); } }
  else if (k === 'Enter') viewer.finishDraft();
  else if (k === 'Backspace') { if (!viewer.undoDraftPoint() && sel) deleteObject(sel.id); }
  else if (k === 'Delete') { if (sel) deleteObject(sel.id); }
  else if (k === 'Tab') cycleSelection(e.shiftKey ? -1 : 1);
  else if (k === ' ') { if (m?.kind === 'video') togglePlay(); }
  else if (k === 'O' && e.shiftKey) { if (sel?.kind === 'track') setOutside(sel.id); }
  else if (k === 'L' && e.shiftKey) { if (sel) updateObject(sel.id, { locked: !sel.locked }); }
  else if (k.toLowerCase() === 'd' || k.toLowerCase() === 'f') {
    const dir = k.toLowerCase() === 'd' ? -1 : 1;
    const step = e.shiftKey ? 10 : 1;
    if (m?.kind === 'video') goFrame(S.frame + dir * step); else stepMedia(dir * step);
  }
  else if (toolKeys[k]) setTool(toolKeys[k]);
  else if (k === 't') { S.trackMode = !S.trackMode; updatePlayer(); toast(`Track mode ${S.trackMode ? 'on' : 'off'}`, 1200); }
  else if (k === 'h') { if (sel) updateObject(sel.id, { hidden: !sel.hidden }); }
  else if (k === 'q') { if (sel) updateObject(sel.id, { occluded: !sel.occluded }); }
  else if (k === 'PageUp') { if (sel) updateObject(sel.id, { z: maxZ() + 1 }); }
  else if (k === 'PageDown') { if (sel) updateObject(sel.id, { z: Math.min(...objectsAt().map(x => x.z)) - 1 }); }
  else if (k === '[' || k === ']') { S.brushRadius = Math.max(1, Math.min(120, S.brushRadius + (k === ']' ? 2 : -2))); $('#brushRadius').value = S.brushRadius; $('#brushVal').textContent = S.brushRadius; viewer.request(); }
  else if (k === '0') viewer.fit();
  else if (k === '+' || k === '=') viewer.zoomBy(1.25);
  else if (k === '-') viewer.zoomBy(0.8);
  else if (k === '?') showHelp();
  else if (/^[1-9]$/.test(k)) {
    const l = S.project.labels[+k - 1];
    if (l) {
      S.activeLabel = l.id;
      if (S.tool === 'select' && sel && sel.label !== l.id) updateObject(sel.id, { label: l.id, attributes: defaultAttributes(l.id) });
      renderLabels();
    }
  }
  else handled = false;
  if (handled) e.preventDefault();
});

// wiring
$('#btnOpen').onclick = openFolder;
$('#wOpen').onclick = openFolder;
$('#btnOpenFiles').onclick = () => $('#dirInput').click();
$('#wOpenFiles').onclick = () => $('#dirInput').click();
$('#dirInput').onchange = e => { if (e.target.files.length) openFromFileList(e.target.files); e.target.value = ''; };
$('#btnSaveFolder').onclick = saveToFolder;
$('#btnExport').onclick = exportDialog;
$('#btnImport').onclick = importDialog;
$('#btnAI').onclick = aiDialog;
$('#btnAIAuto').onclick = async () => {
  const o = runOpts();
  if (!o.auto && !model.loaded && !await savedModelName()) return aiDialog(); // pick a model first
  saveRunOpts({ ...o, auto: !o.auto });
  autoNoModelWarned = false;
  toast(`AI auto-run ${!o.auto ? 'on' : 'off'}`, 1500);
  if (!o.auto) maybeAutoRun();
};
$('#btnUndo').onclick = () => undo();
$('#btnRedo').onclick = () => redo();
$('#btnHelp').onclick = showHelp;
$('#mediaFilter').oninput = renderMediaList;
$('#mediaList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]');
  if (li) showMedia(li.dataset.id);
});
$('#pPlay').onclick = togglePlay;
$('#pPrev').onclick = () => goFrame(S.frame - 1);
$('#pNext').onclick = () => goFrame(S.frame + 1);
$('#pPrevKf').onclick = () => jumpKeyframe(-1);
$('#pNextKf').onclick = () => jumpKeyframe(1);
$('#pSlider').oninput = e => { pause(); goFrame(+e.target.value); };
$('#pFrame').onchange = e => goFrame(+e.target.value);
$('#pFps').onchange = e => {
  const m = media();
  const fps = +e.target.value;
  if (!m || !(fps > 0)) return;
  m.fps = fps;
  m.frames = Math.max(1, Math.floor(m.duration * fps + 1e-6));
  setupPlayer(); goFrame(Math.min(S.frame, m.frames - 1)); changed('media');
};
$('#pTrack').onclick = () => { S.trackMode = !S.trackMode; updatePlayer(); };
$('#pPropagate').onclick = propagateDlg;
window.addEventListener('resize', () => drawTimelineMarks());

if (!HAS_FSA) { $('#fsaNote').hidden = false; $('#wOpen').textContent = 'Open folder'; }
setTool('select');
syncUndo();
syncAutoButton();
renderRecent();

window.LocalLabel = { S, openFromFileList, showMedia, goFrame, setTool, F, objectsAt, createObject, saveNow, undo, redo };
