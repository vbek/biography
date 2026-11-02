/* Document Reader — app shell: importing, the library, the reading view, settings and the one-time voice download. */
import { ACCEPT, extract, fromText } from './extract.js';
import { saveDoc, getDoc, deleteDoc, listDocs, loadPrefs, savePrefs } from './store.js';
import { VoiceEngine, TIERS, modelKey as keyFor, languageName, isInstalled, storedBytes, removeModel, toPcm, wavBlob } from './voice.js';
import { Player, speakable } from './player.js';
import { FORMATS, compressedFormat, openWriter } from './audiofile.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const icon = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic'); s.innerHTML = `<use href="#i-${name}"/>`; return s; };
const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
const duration = (sec) => {
  if (!isFinite(sec) || sec <= 0) return '';
  const m = Math.round(sec / 60);
  if (m < 1) return 'under a minute';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const prefs = loadPrefs();
const engine = new VoiceEngine();
const player = new Player(engine);
if (!TIERS[prefs.tier]) prefs.tier = 'fast';
const currentVoice = () => { const list = TIERS[prefs.tier].voices, id = prefs.voices[prefs.tier]; return list.some((v) => v[0] === id) ? id : list[0][0]; };
const currentLang = () => (TIERS[prefs.tier].langs?.includes(prefs.lang) ? prefs.lang : 'en');
const modelKey = () => keyFor(prefs.tier, currentVoice());
engine.lang = currentLang();
player.voice = currentVoice(); player.systemVoice = prefs.systemVoice; player.tidy = prefs.tidy; player.mode = prefs.engine;
player.setRate(prefs.rate);
const setPref = (key, value) => { prefs[key] = value; savePrefs(prefs); };
const speechAvailable = 'speechSynthesis' in window;

let doc = null, spans = [];
const model = { state: 'unknown', progress: null, installed: {}, fastInstalled: new Set(), error: '', stored: 0 };

function toast(message) {
  const t = $('#toast');
  t.textContent = message; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ---------- service worker and processor threads ---------- */
async function setupWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    // The first visit isn't controlled by the worker yet, so reload once to pick up its isolation headers.
    if (!window.crossOriginIsolated && !navigator.serviceWorker.controller) {
      await new Promise((res) => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); setTimeout(res, 3000); });
    }
    if (!window.crossOriginIsolated && navigator.serviceWorker.controller && !sessionStorage.getItem('dr-isolate')) {
      sessionStorage.setItem('dr-isolate', '1');
      if (!doc && player.items.length === 0) location.reload();
    }
  } catch { /* still works online, just with one processor core */ }
}

/* ---------- the voice model ---------- */
function renderModelPanels() {
  for (const host of $$('[data-model-panel]')) {
    host.textContent = '';
    if (model.state === 'downloading' || model.state === 'starting') {
      const p = model.progress;
      const tier = TIERS[prefs.tier];
      if (p && model.state === 'downloading') {
        const pct = p.total ? (p.loaded / p.total) * 100 : 0;
        const left = p.bytesPerSec > 0 ? (p.total - p.loaded) / p.bytesPerSec : 0;
        host.append(
          el('strong', { textContent: `Downloading ${tier.name} voice…` }),
          el('div', { className: 'bar' }, el('i', { style: `width:${pct.toFixed(1)}%` })),
          el('div', { className: 'dl-stats muted small' },
            el('span', { textContent: `${mb(p.loaded)} of ${mb(p.total)}` }),
            el('span', { textContent: p.bytesPerSec > 0 ? `${(p.bytesPerSec / 1e6).toFixed(1)} MB/s` : '' }),
            el('span', { textContent: left > 0 ? `${left < 60 ? `${Math.ceil(left)} s` : `${Math.ceil(left / 60)} min`} left` : '' })),
          el('div', { className: 'model-actions' }, el('button', { className: 'btn small', textContent: 'Cancel' , onclick: cancelModel })),
          el('p', { className: 'muted small', textContent: 'This only happens once. You can keep reading the document while it finishes.' }),
        );
      } else host.append(el('div', { className: 'row' }, el('span', { className: 'spinner' }), el('span', { textContent: 'Starting the voice…' })));
      continue;
    }
    for (const [key, tier] of Object.entries(TIERS)) {
      const input = el('input', { type: 'radio', name: `tier-${$$('[data-model-panel]').indexOf(host)}`, value: key, checked: prefs.tier === key, onchange: () => selectTier(key) });
      const title = el('strong', { textContent: `${tier.name} · ${mb(tier.bytes)}${tier.perVoice ? ' per voice' : ''}` });
      if (model.installed[key]) title.append(el('span', { className: 'badge good', textContent: 'Downloaded' }));
      else if (key === 'fast') title.append(el('span', { className: 'badge', textContent: 'Recommended' }));
      const licence = tier.restricted ? el('a', { href: 'vendor/LICENSE-supertonic.txt', target: '_blank', rel: 'noopener', textContent: tier.licence }) : tier.licence;
      host.append(el('label', { className: 'tier' }, input, el('span', {}, title, el('span', { className: 'muted small' }, `${tier.note} Licence: `, licence, '.'))));
    }
    const actions = el('div', { className: 'model-actions' });
    if (model.installed[prefs.tier]) {
      actions.append(el('span', { className: 'muted small', textContent: model.state === 'ready' ? 'Ready. Works offline, with nothing more to download.' : 'Downloaded. Works offline, with nothing more to download.' }));
    } else {
      actions.append(el('button', { className: 'btn primary', textContent: `Download once (${mb(TIERS[prefs.tier].bytes)})`, onclick: () => startModel() }));
    }
    if (model.stored) {
      actions.append(el('button', { className: 'btn small danger', textContent: model.stored ? `Remove downloads (${mb(model.stored)})` : 'Remove downloads', onclick: forgetModel }));
    }
    host.append(actions);
    if (model.error) host.append(el('div', { className: 'alert', style: 'margin-top:10px', textContent: model.error, role: 'alert' }));
  }
  renderStrip();
}
function renderStrip() {
  const strip = $('#modelStrip');
  const needs = prefs.engine === 'neural' && !model.installed[prefs.tier] && model.state !== 'ready';
  strip.hidden = !needs && model.state !== 'downloading';
  strip.textContent = '';
  if (strip.hidden) return;
  if (model.state === 'downloading' && model.progress) {
    const p = model.progress;
    strip.append(`Downloading voice: ${mb(p.loaded)} of ${mb(p.total)}${p.bytesPerSec > 0 ? ` · ${(p.bytesPerSec / 1e6).toFixed(1)} MB/s` : ''}`,
      el('div', { className: 'bar' }, el('i', { style: `width:${p.total ? (p.loaded / p.total) * 100 : 0}%` })));
  } else if (model.state !== 'starting') {
    strip.append(el('span', { className: 'muted', textContent: `The natural voice is a one-time ${mb(TIERS[prefs.tier].bytes)} download. ` }),
      el('button', { className: 'btn small primary', textContent: 'Download', onclick: () => startModel() }));
    if (speechAvailable) strip.append(' ', el('button', { className: 'btn small', textContent: 'Use browser\'s voice', onclick: () => setEngine('system') }));
  }
}
async function refreshModel() {
  for (const tier of Object.keys(TIERS)) model.installed[tier] = await isInstalled(tier, tier === prefs.tier ? currentVoice() : (prefs.voices[tier] || TIERS[tier].voices[0][0]));
  model.fastInstalled = new Set();
  for (const [id] of TIERS.fast.voices) if (await isInstalled('fast', id)) model.fastInstalled.add(id);
  model.stored = await storedBytes();
  renderModelPanels();
  refreshVoiceLists();
}
function selectTier(key) {
  if (prefs.tier === key) return;
  setPref('tier', key);
  engine.lang = currentLang();
  swapModel(false);
}
// Called when the chosen model changes. Reading carries on with the new voice once it's ready.
function swapModel(explicit) {
  const resume = player.playing || wantsPlay;
  player.stop();
  player.flush();
  engine.dispose();
  modelStart = null;
  player.voice = currentVoice();
  model.state = 'unknown';
  model.error = '';
  wantsPlay = resume;
  refreshVoiceLists();
  refreshLanguages();
  renderModelPanels();
  syncTransport();
  if (prefs.engine === 'neural' && (resume || (doc && (explicit || model.installed[prefs.tier])))) startModel();
  else wantsPlay = false;
}
let modelStart = null;
function startModel() {
  if (engine.ready && engine.key === modelKey() && modelStart) return modelStart;
  const tier = prefs.tier;
  // This licence requires its use restrictions to be passed on to whoever uses the model.
  if (TIERS[tier].restricted && !model.installed[tier] && !window.confirm(`The ${TIERS[tier].name} voice is under the OpenRAIL-M licence (linked beside it). By downloading you agree to its use restrictions: for example, no unlawful or harmful use, no impersonating people, no medical advice, and audio you share must be disclosed as machine generated.`)) {
    wantsPlay = false;
    syncTransport();
    return Promise.resolve();
  }
  model.error = '';
  model.state = 'starting';
  model.progress = null;
  renderModelPanels();
  if (!model.installed[tier]) navigator.storage?.persist?.().catch?.(() => {});
  const start = engine.load(tier, currentVoice(), (p) => {
    // Files that come from the cache report progress too, so only a missing model counts as a download.
    if (!model.installed[tier]) { model.state = 'downloading'; model.progress = p; throttledPanels(); syncTransport(); }
  }).then(async () => {
    model.state = 'ready';
    await refreshModel();
    syncTransport();
    if (wantsPlay) { wantsPlay = false; player.play(); }
  }, (err) => {
    if (err.name === 'AbortError') return;
    model.state = 'unknown';
    wantsPlay = false;
    model.error = friendlyModelError(err, tier);
    renderModelPanels();
    syncTransport();
    throw err;
  });
  modelStart = start.catch(() => {});
  return modelStart;
}
function friendlyModelError(err, tier) {
  const text = String(err?.message || err);
  if (!navigator.onLine || /fetch|network|load failed/i.test(text)) return 'The voice could not be downloaded. Check your connection and try again.';
  if (/quota/i.test(text)) return 'There isn\'t enough free storage to keep the voice. Free up some space and try again.';
  return `The voice could not start: ${text}`;
}
const throttledPanels = (() => {
  let at = 0;
  return () => { const now = performance.now(); if (now - at > 200) { at = now; renderModelPanels(); } };
})();
function cancelModel() {
  wantsPlay = false;
  engine.dispose();
  modelStart = null;
  model.state = 'unknown';
  renderModelPanels();
  syncTransport();
}
async function forgetModel() {
  if (!window.confirm('Remove the downloaded voice from this browser? You can download it again whenever you like.')) return;
  player.stop(); player.flush();
  engine.dispose();
  modelStart = null;
  await removeModel();
  model.state = 'unknown';
  await refreshModel();
  syncTransport();
  toast('The downloaded voice was removed.');
}
function setEngine(mode) {
  setPref('engine', mode);
  player.setMode(mode);
  $$('input[name=engine]').forEach((r) => { r.checked = r.value === mode; });
  $('#neuralOptions').hidden = mode !== 'neural';
  $('#systemOptions').hidden = mode !== 'system';
  $('#engineNote').textContent = mode === 'neural'
    ? 'Sounds natural and works offline. Natural and Many languages read beyond English; the others are English only.'
    : 'No download, and it reads other languages if your device has voices for them. Quality depends on your device.';
  $('#voiceQuick').replaceChildren(...(mode === 'neural' ? voiceOptions() : systemOptions()));
  $('#voiceQuick').value = mode === 'neural' ? currentVoice() : prefs.systemVoice;
  renderStrip();
  syncTransport();
  if (mode === 'neural' && doc && model.installed[prefs.tier]) startModel();
}

/* ---------- voices ---------- */
const voiceOptions = () => TIERS[prefs.tier].voices.map(([id, name, tag]) => {
  const size = TIERS[prefs.tier].perVoice && !model.fastInstalled.has(id) ? ` · ${mb(TIERS[prefs.tier].bytes)}` : '';
  return el('option', { value: id, textContent: `${name}${tag ? ` · ${tag}` : ''}${size}` });
});
function refreshLanguages() {
  const langs = TIERS[prefs.tier].langs;
  $('#langField').hidden = !langs;
  $('#langSelect').replaceChildren(...(langs || []).map((code) => el('option', { value: code, textContent: languageName(code) })));
  if (langs) $('#langSelect').value = currentLang();
}
function systemOptions() {
  if (!speechAvailable) return [el('option', { value: '', textContent: 'Not available in this browser' })];
  const voices = speechSynthesis.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  return [el('option', { value: '', textContent: 'Device default' }), ...voices.map((v) => el('option', { value: v.voiceURI, textContent: `${v.name} (${v.lang})` }))];
}
function refreshVoiceLists() {
  $('#voiceSelect').replaceChildren(...voiceOptions());
  $('#voiceSelect').value = currentVoice();
  $('#systemVoiceSelect').replaceChildren(...systemOptions());
  $('#systemVoiceSelect').value = prefs.systemVoice;
  $('#voiceQuick').replaceChildren(...(prefs.engine === 'neural' ? voiceOptions() : systemOptions()));
  $('#voiceQuick').value = prefs.engine === 'neural' ? currentVoice() : prefs.systemVoice;
}
function chooseVoice(id) {
  if (prefs.engine === 'neural') {
    if (id === currentVoice()) return;
    setPref('voices', { ...prefs.voices, [prefs.tier]: id });
    // A Fast voice is its own file, and the list says what choosing one will download.
    if (TIERS[prefs.tier].perVoice) {
      model.installed[prefs.tier] = model.fastInstalled.has(id);
      swapModel(true);
    } else {
      player.setVoice(id);
      $('#voiceSelect').value = id;
      $('#voiceQuick').value = id;
    }
    return;
  }
  setPref('systemVoice', id); player.setSystemVoice(id); $('#systemVoiceSelect').value = id;
  $('#voiceQuick').value = id;
}
async function preview() {
  const button = $('[data-act=preview]');
  button.disabled = true;
  try {
    await startModel();
    if (engine.key !== modelKey() || !engine.ready) throw new DOMException('cancelled', 'AbortError');
    player.pause();
    const { audio, sampleRate } = await engine.synth('Hello. This is how your documents will sound when I read them to you.', currentVoice());
    const url = URL.createObjectURL(wavBlob([toPcm(audio, 0, sampleRate)], audio.length, sampleRate));
    const a = new Audio(url);
    a.playbackRate = prefs.rate;
    a.onended = () => URL.revokeObjectURL(url);
    await a.play();
  } catch (err) { if (err.name !== 'AbortError') toast('The preview could not play.'); }
  button.disabled = false;
}

/* ---------- importing and the library ---------- */
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
async function importFiles(files) {
  const list = [...files];
  if (!list.length) return;
  const label = $('#importLabel'), bar = $('#importBar'), box = $('#importing'), err = $('#homeError');
  box.hidden = false; err.hidden = true;
  let first = null;
  const problems = [];
  for (const file of list) {
    try {
      const result = await extract(file, (text, fraction) => {
        label.textContent = list.length > 1 ? `${file.name}: ${text}` : text;
        bar.style.width = fraction == null ? '100%' : `${Math.round(fraction * 100)}%`;
      });
      const item = { ...result, id: newId(), addedAt: Date.now(), openedAt: Date.now(), pos: 0, total: 0 };
      item.total = item.blocks.reduce((n, b) => n + (b.s?.length || 0), 0);
      await saveDoc(item).catch(() => { toast('Your browser\'s storage is full, so this document won\'t be kept after you close it.'); });
      first = first || item;
    } catch (e) { problems.push(list.length > 1 ? `${file.name}: ${e.message}` : e.message); }
  }
  box.hidden = true;
  if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; }
  await renderLibrary();
  if (first) openDoc(first);
}
async function renderLibrary() {
  let docs = [];
  try { docs = await listDocs(); } catch { /* private browsing can block storage; the reader still works */ }
  $('#librarySection').hidden = !docs.length;
  $('#library').replaceChildren(...docs.map((d) => {
    const pct = d.total ? Math.min(100, Math.round((d.pos / Math.max(1, d.total - 1)) * 100)) : 0;
    const open = el('button', { className: 'lib-open', onclick: async () => { const full = await getDoc(d.id); if (full) openDoc(full); } },
      icon('file'),
      el('span', { className: 'grow' },
        el('strong', { textContent: d.title }),
        el('span', { className: 'meta muted small', textContent: `${d.format} · ${duration(d.chars * 0.07) || 'short'} at normal speed${pct ? ` · ${pct}% read` : ''}` }),
        el('div', { className: 'lib-progress' }, el('i', { style: `width:${pct}%` }))));
    const remove = el('button', { className: 'icon-btn', title: 'Remove from library', ariaLabel: `Remove ${d.title} from library`, onclick: async () => { if (window.confirm(`Remove "${d.title}" from your library?`)) { await deleteDoc(d.id); renderLibrary(); } } }, icon('trash'));
    return el('li', {}, open, remove);
  }));
}

/* ---------- reading view ---------- */
function looksNonEnglish(item) {
  let letters = 0, latin = 0;
  outer: for (const b of item.blocks) {
    for (const ch of b.text || '') {
      if (/\p{L}/u.test(ch)) { letters++; if (/\p{Script=Latin}/u.test(ch)) latin++; }
      if (letters > 4000) break outer;
    }
  }
  return letters > 20 && latin / letters < 0.6;
}
function openDoc(item) {
  doc = item;
  doc.openedAt = Date.now();
  saveDoc(doc).catch(() => {});
  const article = $('#article');
  const items = [];
  const frag = document.createDocumentFragment();
  spans = [];
  let lastPage = 0;
  doc.blocks.forEach((b, bi) => {
    if (b.page && b.page !== lastPage && doc.format === 'PDF') {
      if (lastPage) frag.append(el('span', { className: 'pg', textContent: `Page ${b.page}` }));
      lastPage = b.page;
    }
    if (b.kind === 'code') { frag.append(el('pre', { className: 'b', textContent: b.text })); return; }
    const tag = /^h[123]$/.test(b.kind) ? b.kind : 'p';
    const node = el(tag, { className: `b ${b.kind}` });
    b.s.forEach((text, si) => {
      const i = items.length;
      const span = el('span', { className: 's', textContent: text });
      span.dataset.i = i;
      spans.push(span);
      if (si) node.append(' ');
      node.append(span);
      items.push({ text, block: bi, blockEnd: si === b.s.length - 1 });
    });
    b.first = items.length - b.s.length;
    frag.append(node);
  });
  article.replaceChildren(frag);
  $('#docTitle').textContent = doc.title;
  $('#docMeta').textContent = `${doc.format} · ${items.length.toLocaleString()} sentences`;
  document.title = `${doc.title} — Document Reader`;
  renderOutline();
  $('#home').hidden = true;
  $('#reader').hidden = false;
  $('#progress').max = Math.max(0, items.length - 1);
  player.setItems(items, doc.pos || 0);
  if (speechAvailable && looksNonEnglish(doc) && prefs.engine === 'neural' && !TIERS[prefs.tier].langs) {
    setEngine('system');
    toast('This document doesn\'t look English, so the browser\'s voice is selected. In Settings, the Natural and Many languages voices read other languages.');
  } else if (prefs.engine === 'neural' && model.installed[prefs.tier]) startModel();
  renderStrip();
  syncTransport();
  $('#page').scrollTop = 0;
  scrollToCurrent(true);
  $('#page').focus({ preventScroll: true });
}
function renderOutline() {
  const nav = $('#outline');
  const heads = doc.blocks.filter((b) => /^h[123]$/.test(b.kind) && b.s?.length);
  let entries;
  if (heads.length) entries = heads.map((b) => ({ label: b.text, level: +b.kind[1], first: b.first }));
  else {
    const pages = new Map();
    doc.blocks.forEach((b) => { if (b.page && b.s?.length && !pages.has(b.page)) pages.set(b.page, b.first); });
    entries = [...pages].map(([page, first]) => ({ label: `Page ${page}`, level: 1, first }));
  }
  outlineEntries = entries;
  nav.replaceChildren(...(entries.length ? entries.map((e, i) => {
    const b = el('button', { className: `l${e.level}`, textContent: e.label, onclick: () => { player.seek(e.first); if (innerWidth <= 720) nav.hidden = true; } });
    b.dataset.n = i;
    return b;
  }) : [el('p', { className: 'muted small', style: 'padding:8px', textContent: 'This document has no headings or pages to list.' })]));
}
let outlineEntries = [], currentSpan = null, lastSave = 0, userScrolledAt = 0;

function scrollToCurrent(force = false) {
  if (!currentSpan) return;
  if (!force && !prefs.follow) return;
  if (!force && performance.now() - userScrolledAt < 6000) { $('#resync').hidden = false; return; }
  $('#resync').hidden = true;
  const page = $('#page');
  const box = currentSpan.getBoundingClientRect(), view = page.getBoundingClientRect();
  if (force || box.top < view.top + 40 || box.bottom > view.bottom - 60) {
    programmaticScrollUntil = performance.now() + 700;
    page.scrollTo({ top: page.scrollTop + box.top - view.top - view.height * 0.3, behavior: force || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}
let programmaticScrollUntil = 0;
function savePosition() {
  if (!doc) return;
  doc.pos = player.idx;
  const now = Date.now();
  if (now - lastSave > 3000) { lastSave = now; saveDoc(doc).catch(() => {}); }
}
player.addEventListener('position', ({ detail }) => {
  currentSpan?.classList.remove('cur');
  currentSpan = spans[detail.idx] || null;
  currentSpan?.classList.add('cur');
  $('#progress').value = detail.idx;
  scrollToCurrent();
  savePosition();
  updateTime();
  const outlineNow = outlineEntries.reduce((best, e, n) => (e.first <= detail.idx ? n : best), -1);
  $$('#outline button').forEach((b) => b.classList.toggle('current', +b.dataset.n === outlineNow));
  if ('mediaSession' in navigator && doc) navigator.mediaSession.metadata = new MediaMetadata({ title: doc.title, artist: 'Document Reader' });
});
player.addEventListener('state', syncTransport);
player.addEventListener('time', updateTime);
player.addEventListener('finished', () => {
  if (doc) { doc.pos = 0; saveDoc(doc).catch(() => {}); }
  toast('Finished reading.');
});
player.addEventListener('failure', ({ detail }) => { $('#status').textContent = detail.message; toast('Reading stopped. Press play to try again.'); });
function updateTime() {
  const left = player.secondsLeft();
  $('#timeLeft').textContent = duration(left) ? `${duration(left)} left` : '';
  syncStatus();
}
function syncStatus() {
  const status = $('#status');
  if (exporting) status.textContent = `Saving audio: ${exporting.percent || 0}%`;
  else if (prefs.engine === 'neural' && model.state === 'downloading') status.textContent = 'Downloading the voice…';
  else if (prefs.engine === 'neural' && model.state === 'starting') status.textContent = 'Starting the voice…';
  else if (player.waiting || wantsPlay) status.textContent = 'Preparing audio…';
  else if (player.mode === 'neural' && player.generationSpeed) {
    const x = player.generationSpeed;
    status.textContent = `Voice speed ${x.toFixed(1)}× real time${x < player.rate ? (prefs.tier === 'fast' ? ' · slower than playback, so short pauses are possible' : ' · too slow for this speed: the Fast voice in Settings will keep up') : ''}`;
  } else status.textContent = player.mode === 'system' ? 'Browser\'s voice' : '';
}
function syncTransport() {
  const btn = $('#playBtn');
  const busy = player.waiting || wantsPlay;
  btn.setAttribute('aria-label', player.playing || wantsPlay ? 'Pause' : 'Play');
  $('.ic', btn).innerHTML = `<use href="#i-${player.playing || wantsPlay ? 'pause' : 'play'}"/>`;
  $('.ic', btn).toggleAttribute('hidden', busy);
  $('.spinner', btn).hidden = !busy;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused';
  syncStatus();
}
let wantsPlay = false;
function togglePlay() {
  if (exporting) return;
  if (player.playing || wantsPlay) {
    wantsPlay = false;
    player.pause();
    syncTransport();
    return;
  }
  if (prefs.engine === 'system') {
    if (!speechAvailable) { toast('This browser has no built-in voice.'); return; }
    player.play();
    return;
  }
  if (model.state === 'ready' && engine.ready) { player.play(); return; }
  wantsPlay = true;
  syncTransport();
  startModel();
}
function setRate(value) {
  const rate = Math.round(Math.min(3, Math.max(0.5, value)) * 20) / 20;
  setPref('rate', rate);
  player.setRate(rate);
  $('#rate').value = rate;
  $('#rateLabel').textContent = `${rate.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}×`;
}

/* ---------- search ---------- */
let found = [], foundAt = -1;
function runSearch() {
  found.forEach((i) => spans[i]?.classList.remove('found'));
  const q = $('#searchInput').value.trim().toLowerCase();
  found = [];
  if (q) spans.forEach((s, i) => { if (s.textContent.toLowerCase().includes(q)) { found.push(i); s.classList.add('found'); } });
  foundAt = -1;
  $('#searchCount').textContent = q ? `${found.length} ${found.length === 1 ? 'match' : 'matches'}` : '';
  if (found.length) stepSearch(1);
}
function stepSearch(dir) {
  if (!found.length) return;
  if (foundAt < 0) {
    foundAt = found.findIndex((i) => i >= player.idx);
    if (foundAt < 0) foundAt = 0;
  } else foundAt = (foundAt + dir + found.length) % found.length;
  $('#searchCount').textContent = `${foundAt + 1} of ${found.length}`;
  userScrolledAt = performance.now();
  spans[found[foundAt]].scrollIntoView({ block: 'center' });
}
function toggleSearch(force) {
  const bar = $('#searchBar');
  bar.hidden = force === undefined ? !bar.hidden : !force;
  if (!bar.hidden) { $('#searchInput').focus(); $('#searchInput').select(); }
  else { found.forEach((i) => spans[i]?.classList.remove('found')); found = []; $('#searchInput').value = ''; $('#searchCount').textContent = ''; $('#page').focus({ preventScroll: true }); }
}

/* ---------- saving audio ---------- */
let exporting = null;
function saveRange() {
  const total = player.items.length, value = $('#saveRange').value;
  if (value === 'here') return [player.idx, total];
  if (value === 'section') {
    const at = outlineEntries.reduce((best, e, n) => (e.first <= player.idx ? n : best), 0);
    return [outlineEntries[at].first, outlineEntries[at + 1]?.first ?? total];
  }
  return [0, total];
}
function updateSaveSummary() {
  const summary = $('#saveSummary'), button = $('#exportBtn');
  button.disabled = !!exporting || prefs.engine !== 'neural';
  if (prefs.engine !== 'neural') { summary.textContent = 'Saving needs a natural voice, because a browser\'s built-in voice can\'t be recorded. Choose one in Settings.'; return; }
  const [from, to] = saveRange();
  let chars = 0;
  for (let i = from; i < to; i++) chars += player.say(i).length;
  const seconds = chars * player.secondsPerChar;
  const compressed = FORMATS[$('#saveFormat').value];
  const bytes = seconds * (compressed ? compressed.bitrate / 8 : TIERS[prefs.tier].rate * 2);
  const voice = TIERS[prefs.tier].voices.find((v) => v[0] === currentVoice())[1];
  const length = duration(seconds);
  summary.textContent = `${length && length !== 'under a minute' ? `About ${length}` : 'Under a minute'} of audio, ${bytes < 1e6 ? 'under 1 MB' : `about ${mb(bytes)}`}. Voice: ${voice}. Recorded at normal speed for the clearest sound: your audio player can speed it up.`;
}
async function openSaveDialog() {
  const range = $('#saveRange'), format = $('#saveFormat');
  const hasSections = outlineEntries.length > 1;
  range.replaceChildren(
    el('option', { value: 'all', textContent: 'The whole document' }),
    el('option', { value: 'here', textContent: 'From the current sentence to the end' }),
    ...(hasSections ? [el('option', { value: 'section', textContent: 'The current section or page' })] : []),
  );
  $('#saveDialog').showModal();
  const previous = format.value;
  const small = await compressedFormat();
  format.replaceChildren(
    ...(small ? [el('option', { value: small, textContent: FORMATS[small].label })] : []),
    el('option', { value: 'wav', textContent: 'WAV: largest, no quality loss' }),
  );
  if (previous && [...format.options].some((o) => o.value === previous)) format.value = previous;
  updateSaveSummary();
}
async function exportAudio() {
  if (!doc || prefs.engine !== 'neural' || exporting) return;
  const job = { cancelled: false, percent: 0 };
  exporting = job;
  player.pause();
  player.flush();
  const [from, to] = saveRange();
  const items = player.items, title = doc.title, voice = currentVoice();
  // Always normal speed: asking a model for 2× can make it drop words, as Supertonic did in testing.
  // Spoken text is fixed now, so reopening the library or changing a setting can't alter the file part-way.
  const lines = [];
  for (let i = from; i < to; i++) { const text = player.say(i); if (text) lines.push([text, items[i].blockEnd ? 0.32 : 0.06]); }
  $('#exportBtn').disabled = true; $('#exportCancel').hidden = false; $('#exportProgress').hidden = false;
  const label = $('#exportLabel'), bar = $('#exportBar');
  bar.style.width = '0';
  label.textContent = 'Starting…';
  syncStatus();
  let writer = null;
  try {
    await startModel();
    if (engine.key !== modelKey() || !engine.ready) throw new DOMException('cancelled', 'AbortError');
    writer = await openWriter($('#saveFormat').value, title);
    const started = performance.now();
    for (let i = 0; i < lines.length && !job.cancelled; i++) {
      const [text, pause] = lines[i];
      const out = await engine.synth(text, voice);
      const samples = new Float32Array(out.audio.length + Math.round(pause * out.sampleRate));
      samples.set(out.audio);
      await writer.add(samples, out.sampleRate);
      job.percent = Math.round(((i + 1) / lines.length) * 100);
      bar.style.width = `${job.percent}%`;
      const left = duration((((performance.now() - started) / (i + 1)) * (lines.length - i - 1)) / 1000);
      label.textContent = `Sentence ${i + 1} of ${lines.length}${left ? ` · about ${left} left` : ''}`;
      syncStatus();
    }
    if (job.cancelled) throw new DOMException('cancelled', 'AbortError');
    if (!lines.length) throw new Error('There is nothing to read in this part of the document.');
    const { blob, seconds } = await writer.finish();
    const url = URL.createObjectURL(blob);
    const safeName = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'document';
    const link = el('a', { href: url, download: `${safeName}.${writer.ext}` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    label.textContent = `Saved to your downloads: ${duration(seconds) || 'under a minute'}, ${blob.size < 1e6 ? 'under 1 MB' : mb(blob.size)}.`;
    toast('Your audio file is saved.');
  } catch (err) {
    await writer?.cancel();
    label.textContent = err.name === 'AbortError' ? 'Cancelled, and nothing was saved.' : `The audio could not be saved: ${err.message}`;
  }
  exporting = null;
  $('#exportCancel').hidden = true;
  updateSaveSummary();
  syncStatus();
}

/* ---------- sleep timer ---------- */
let sleepTimer = 0;
function setSleep(minutes) {
  clearTimeout(sleepTimer);
  if (!minutes) return;
  sleepTimer = setTimeout(() => {
    if (player.playing || wantsPlay) { wantsPlay = false; player.pause(); syncTransport(); toast('Stopped by the sleep timer.'); }
    $('#sleep').value = '0';
  }, minutes * 60000);
  toast(`Reading will stop in ${minutes} minutes.`);
}

/* ---------- actions ---------- */
const actions = {
  paste: () => { $('#pasteText').value = ''; $('#pasteTitle').value = ''; $('#pasteDialog').showModal(); },
  home: async () => {
    wantsPlay = false;
    player.stop();
    if (doc) { doc.pos = player.idx; await saveDoc(doc).catch(() => {}); }
    doc = null;
    $('#reader').hidden = true;
    $('#home').hidden = false;
    document.title = 'Document Reader — Bibek Koirala';
    toggleSearch(false);
    $('#outline').hidden = true;
    renderLibrary();
    renderModelPanels();
  },
  toggleOutline: () => { const n = $('#outline'); n.hidden = !n.hidden; },
  toggleSearch: () => toggleSearch(),
  settings: () => $('#settingsDialog').showModal(),
  saveAudio: openSaveDialog,
  closeSave: () => $('#saveDialog').close(),
  closeSettings: () => $('#settingsDialog').close(),
  searchNext: () => stepSearch(1),
  searchPrev: () => stepSearch(-1),
  playPause: togglePlay,
  prev: () => player.skip(-1),
  next: () => player.skip(1),
  prevBlock: () => player.skipBlock(-1),
  nextBlock: () => player.skipBlock(1),
  resync: () => { userScrolledAt = 0; scrollToCurrent(true); },
  preview,
  exportAudio,
  exportCancel: () => { if (exporting) { exporting.cancelled = true; engine.clear(); } },
};
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn) { e.preventDefault(); actions[btn.dataset.act]?.(); }
});
$('#article').addEventListener('click', (e) => {
  const span = e.target.closest('.s');
  if (!span || String(getSelection())) return;
  userScrolledAt = 0;
  player.seek(+span.dataset.i);
  if (!player.playing && !wantsPlay) togglePlay();
});
$('#page').addEventListener('scroll', () => {
  if (performance.now() > programmaticScrollUntil) { userScrolledAt = performance.now(); if (player.playing) $('#resync').hidden = false; }
}, { passive: true });
$('#progress').addEventListener('input', (e) => {
  const i = +e.target.value;
  spans[i]?.scrollIntoView({ block: 'center' });
  userScrolledAt = performance.now();
});
$('#progress').addEventListener('change', (e) => { userScrolledAt = 0; player.seek(+e.target.value); });
$('#rate').addEventListener('input', (e) => setRate(+e.target.value));
$('#voiceQuick').addEventListener('change', (e) => chooseVoice(e.target.value));
$('#voiceSelect').addEventListener('change', (e) => chooseVoice(e.target.value));
$('#langSelect').addEventListener('change', (e) => { setPref('lang', e.target.value); engine.lang = currentLang(); player.setVoice(player.voice); });
$('#systemVoiceSelect').addEventListener('change', (e) => chooseVoice(e.target.value));
$$('input[name=engine]').forEach((r) => r.addEventListener('change', () => setEngine(r.value)));
$('#tidy').addEventListener('change', (e) => { setPref('tidy', e.target.checked); player.setTidy(e.target.checked); });
$('#follow').addEventListener('change', (e) => { setPref('follow', e.target.checked); if (e.target.checked) { userScrolledAt = 0; scrollToCurrent(true); } });
$('#textSize').addEventListener('input', (e) => { setPref('textSize', +e.target.value); document.documentElement.style.setProperty('--text-size', `${e.target.value}px`); });
$('#saveRange').addEventListener('change', updateSaveSummary);
$('#saveFormat').addEventListener('change', updateSaveSummary);
$('#sleep').addEventListener('change', (e) => setSleep(+e.target.value));
$('#darkMode').addEventListener('change', (e) => {
  try { localStorage.setItem('theme', e.target.checked ? 'dark' : 'light'); } catch { /* applies to this visit only */ }
  if (e.target.checked) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'light');
});
$('#searchInput').addEventListener('input', () => { clearTimeout(runSearch.t); runSearch.t = setTimeout(runSearch, 200); });
$('#searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') toggleSearch(false);
});
$('#pasteDialog').addEventListener('close', async () => {
  if ($('#pasteDialog').returnValue !== 'ok') return;
  const text = $('#pasteText').value;
  if (!text.trim()) return;
  const item = { ...fromText(text, $('#pasteTitle').value.trim() || 'Pasted text'), id: newId(), addedAt: Date.now(), openedAt: Date.now(), pos: 0 };
  item.total = item.blocks.reduce((n, b) => n + b.s.length, 0);
  await saveDoc(item).catch(() => {});
  openDoc(item);
});

const fileInput = $('#fileInput');
fileInput.accept = ACCEPT;
fileInput.addEventListener('change', () => { importFiles(fileInput.files); fileInput.value = ''; });
const drop = $('#drop');
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || !e.relatedTarget) drop.classList.remove('over'); }));
document.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });

document.addEventListener('keydown', (e) => {
  if (!doc) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleSearch(true); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') return;
  const map = { ' ': togglePlay, ArrowLeft: actions.prev, ArrowRight: actions.next, ArrowUp: actions.prevBlock, ArrowDown: actions.nextBlock, '+': () => setRate(prefs.rate + 0.1), '=': () => setRate(prefs.rate + 0.1), '-': () => setRate(prefs.rate - 0.1) };
  const fn = map[e.key];
  if (!fn) return;
  if (e.key === ' ' && e.target.tagName === 'BUTTON') return;
  e.preventDefault();
  fn();
});
if ('mediaSession' in navigator) {
  const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch { /* not supported here */ } };
  set('play', () => { if (!player.playing) togglePlay(); });
  set('pause', () => { if (player.playing || wantsPlay) togglePlay(); });
  set('previoustrack', actions.prev);
  set('nexttrack', actions.next);
}
window.addEventListener('beforeunload', (e) => { if (exporting) e.preventDefault(); });
window.addEventListener('pagehide', () => { if (doc) { doc.pos = player.idx; saveDoc(doc).catch(() => {}); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && doc) { doc.pos = player.idx; saveDoc(doc).catch(() => {}); } });

/* ---------- start ---------- */
if (speechAvailable) speechSynthesis.addEventListener?.('voiceschanged', refreshVoiceLists);
$('#tidy').checked = prefs.tidy;
$('#follow').checked = prefs.follow;
$('#textSize').value = prefs.textSize;
$('#darkMode').checked = document.documentElement.getAttribute('data-theme') !== 'light';
document.documentElement.style.setProperty('--text-size', `${prefs.textSize}px`);
refreshVoiceLists();
refreshLanguages();
setRate(prefs.rate);
setEngine(prefs.engine);
renderLibrary();
await refreshModel();
setupWorker();
