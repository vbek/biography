/*
 * Texlume compile worker — runs TeX Live (BusyTeX, WebAssembly) entirely in the browser.
 *
 * Messages in:
 *   { id, type: 'init' }
 *   { id, type: 'compile', project, files: [{ path, v, data? }], main, engine }
 * Messages out:
 *   { type: 'progress', phase, loaded, total, label }
 *   { type: 'status', text }
 *   { id, type: 'result', ... } | { id, type: 'error', message }
 *
 * Nothing leaves the browser: TeX Live files come from this site (and are cached with the Cache API);
 * project files only ever live in this worker's memory.
 */
'use strict';

const BASE = new URL('../vendor/texlive/', self.location.href).href;
const CACHE_PREFIX = 'texforge-texlive-';
const META_CACHE = `${CACHE_PREFIX}meta`;
let cacheName = `${CACHE_PREFIX}v1`; // becomes texforge-texlive-<build> once index.json is read
let buildId = '';
const JOB = 'output';
const MEM_HEADER = 2 ** 26;

importScripts(`${BASE}busytex.js`);

let index = null;
let Module = null;
let memSnapshot = null;
const nameToUnits = new Map();
const loadedUnits = new Set();
const chunkPromises = new Map();
const projects = new Map(); // project -> { dir, versions: Map(path -> v), bibSig, idxSig }
let initPromise = null;

const post = (msg, transfer = []) => self.postMessage(msg, transfer);
const status = text => post({ type: 'status', text });

/* ------------------------------------------------------------ fetching */

async function openCache(name = cacheName) {
  try { return await caches.open(name); } catch { return null; }
}

/** index.json: always try the network first (it names the current build), fall back to the cached copy offline. */
async function fetchIndex() {
  const url = `${BASE}index.json`;
  const meta = await openCache(META_CACHE);
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (meta) meta.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } })).catch(() => {});
    return JSON.parse(text);
  } catch (err) {
    const cached = meta ? await meta.match(url) : null;
    if (cached) return cached.json();
    throw new Error(`Could not load the TeX engine index (${err.message}). Check your connection.`);
  }
}

/** Drop cached files from earlier builds. */
async function pruneOldCaches() {
  try {
    for (const k of await caches.keys()) {
      if (k.startsWith(CACHE_PREFIX) && k !== cacheName && k !== META_CACHE) await caches.delete(k);
    }
  } catch { /* Cache API unavailable */ }
}

/** Fetch a file from the site, keeping a copy in the Cache API so later visits work offline. */
async function fetchBytes(file, { label, expected = 0, onBytes } = {}) {
  const url = `${BASE}${file}${buildId ? `?v=${buildId}` : ''}`;
  const cache = await openCache();
  let res = cache ? await cache.match(url) : null;
  if (res) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (onBytes) onBytes(buf.length, true);
    return buf;
  }
  res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not download ${file} (${res.status})`);
  const total = Number(res.headers.get('Content-Length')) || expected;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (onBytes) onBytes(value.length, false, total);
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  if (cache) cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  if (label) status(label);
  return buf;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Progress across a batch of downloads. */
function progressTracker(phase, total, label) {
  let loaded = 0;
  let last = 0;
  const report = force => {
    const now = Date.now();
    if (!force && now - last < 120) return;
    last = now;
    post({ type: 'progress', phase, loaded, total, label });
  };
  report(true);
  return {
    add(n) { loaded += n; report(false); },
    done() { loaded = total; report(true); },
  };
}

/* ---------------------------------------------------------------- init */

async function init() {
  status('Loading TeX Live index…');
  index = await fetchIndex();
  buildId = index.build || '';
  cacheName = `${CACHE_PREFIX}${buildId || 'v1'}`;
  pruneOldCaches();
  index.units.forEach((u, id) => {
    for (const [p] of u.f) {
      const b = p.slice(p.lastIndexOf('/') + 1);
      if (!nameToUnits.has(b)) nameToUnits.set(b, []);
      nameToUnits.get(b).push(id);
    }
  });

  const coreChunks = new Set(index.core.map(id => index.units[id].c));
  const wasmGz = index.wasmGz || 12.3e6;
  const coreBytes = [...coreChunks].reduce((s, c) => s + index.chunks[c].gz, 0);
  const tracker = progressTracker('engine', wasmGz + coreBytes, 'Downloading TeX engine');

  const wasmPromise = fetchBytes('busytex.wasm.gz', { onBytes: n => tracker.add(n) })
    .then(gunzip)
    .then(bytes => WebAssembly.compile(bytes));
  const corePromise = Promise.all([...coreChunks].map(async c => { chunkData.set(c, await loadChunk(c, tracker)); }));

  const wasmModule = await wasmPromise;
  status('Starting TeX engine…');
  const M = {
    thisProgram: '/bin/busytex',
    noInitialRun: true,
    out: '',
    err: '',
    print(text) { M.out += `${text}\n`; },
    printErr(text) { M.err += `${text}\n`; },
    preRun: [() => {
      Object.assign(M.ENV, index.env, { TEXMFLOG: '/tmp/texmf.log' });
    }],
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(wasmModule, imports).then(instance => done(instance));
      return {};
    },
  };
  Module = await busytex(M);
  memSnapshot = Uint8Array.from(Module.HEAPU8.subarray(0, MEM_HEADER));

  await corePromise;
  for (const id of index.core) writeUnit(id);
  releaseChunks();
  tracker.done();
  status('TeX engine ready');
  return { units: index.units.length };
}

function loadChunk(c, tracker) {
  if (!chunkPromises.has(c)) {
    const meta = index.chunks[c];
    chunkPromises.set(c, fetchBytes(meta.file, { expected: meta.gz, onBytes: n => tracker && tracker.add(n) })
      .then(gunzip)
      .catch(err => { chunkPromises.delete(c); throw err; }));
  }
  return chunkPromises.get(c);
}

const madeDirs = new Set();
function mkdirp(dir) {
  if (!dir || madeDirs.has(dir)) return;
  try { Module.FS.mkdirTree(dir); } catch { /* exists */ }
  madeDirs.add(dir);
}

const chunkData = new Map();
function writeUnit(id) {
  if (loadedUnits.has(id)) return;
  const u = index.units[id];
  const data = chunkData.get(u.c);
  for (const [p, off, len] of u.f) {
    mkdirp(p.slice(0, p.lastIndexOf('/')));
    Module.FS.writeFile(p, data.subarray(off, off + len));
  }
  loadedUnits.add(id);
}

/** Load units (plus their dependencies) into the virtual file system. */
async function ensureUnits(ids, label) {
  const want = new Set();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop();
    if (want.has(id) || loadedUnits.has(id)) continue;
    want.add(id);
    for (const d of index.units[id].d) stack.push(d);
  }
  if (!want.size) return [];
  const chunks = [...new Set([...want].map(id => index.units[id].c))];
  const total = chunks.reduce((s, c) => s + index.chunks[c].gz, 0);
  const tracker = progressTracker('packages', total, label || 'Loading packages');
  await Promise.all(chunks.map(async c => { chunkData.set(c, await loadChunk(c, tracker)); }));
  if (tracker) tracker.done();
  for (const id of want) writeUnit(id);
  releaseChunks();
  return [...want].map(id => index.units[id].k);
}

/** Decompressed chunks are only needed while writing; the compressed copy stays in the Cache API. */
function releaseChunks() {
  chunkData.clear();
  chunkPromises.clear();
}

/* -------------------------------------------------------- name lookup */

function unitsForNames(names) {
  const ids = new Set();
  for (const n of names) {
    for (const cand of [n, `${n}.sty`, `${n}.cls`, `${n}.tex`, `${n}.tfm`, `${n}.vf`, `${n}.pfb`, `${n}.def`, `${n}.fd`, `${n}.bst`, `${n}.otf`]) {
      const hits = nameToUnits.get(cand);
      if (hits) {
        const notLoaded = hits.filter(h => !loadedUnits.has(h));
        if (hits.some(h => loadedUnits.has(h))) break; // already available
        if (notLoaded.length) { ids.add(notLoaded[0]); break; }
      }
    }
  }
  return [...ids];
}

/** Packages the sources ask for, so they can be fetched before the first run. */
function scanSources(texts) {
  const names = new Set();
  const add = (list, f = x => x) => list.split(',').map(s => s.trim()).filter(Boolean).forEach(s => names.add(f(s)));
  for (const t of texts) {
    const src = t.replace(/(^|[^\\])%.*$/gm, '$1');
    for (const m of src.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) add(m[1], s => `${s}.sty`);
    for (const m of src.matchAll(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) add(m[1], s => `${s}.cls`);
    for (const m of src.matchAll(/\\use(color|font|inner|outer)?theme\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) add(m[2], s => `beamer${m[1] || ''}theme${s}.sty`);
    for (const m of src.matchAll(/\\usetikzlibrary\s*\{([^}]+)\}/g)) add(m[1], s => `tikzlibrary${s}.code.tex`);
    for (const m of src.matchAll(/\\usepgfplotslibrary\s*\{([^}]+)\}/g)) add(m[1], s => `pgfplotslibrary${s}.code.tex`);
    for (const m of src.matchAll(/\\bibliographystyle\s*\{([^}]+)\}/g)) add(m[1], s => `${s}.bst`);
  }
  return [...names];
}

/** Files TeX / dvipdfmx said they could not find. */
function missingFromLog(text) {
  const names = new Set();
  const pats = [
    /File `([^']+)' not found/g,
    /I can't find file `([^']+)'/g,
    /Font [^=]+=([^\s]+)(?: at [^\s]+)? not loadable: Metric \(TFM\) file not found/g,
    /\(file ([^)\s]+\.(?:pfb|enc|map|otf|ttf|vf|tfm))\): cannot open/gi,
    /\(file ([^)\s/]+)\): Font \S+ at \d+ not found/g,
    /\(file ([^)\s]+)\): cannot (?:open|find)/g,
    /cannot open (?:Type 1 font file|encoding file|font file)[^\n]*?([A-Za-z0-9_.-]+\.(?:pfb|enc|otf|ttf))/gi,
    /kpathsea: Running mktex(?:tfm|pk|mf)[^\n]*?\s([A-Za-z0-9_.-]+)\s*$/gm,
    /Could not (?:locate|find)[^"\n]*"([^"]+)"/g,
    /Unable to find TFM file "([^"]+)"/g,
    /This font is mapped to a physical font "([^"]+)"/g,
    /could not find the font file "?([^"\s]+)"?/gi,
  ];
  for (const re of pats) for (const m of text.matchAll(re)) names.add(m[1].replace(/^.*\//, ''));
  return [...names].filter(n => !/\.(png|jpe?g|pdf|eps|bib)$/i.test(n));
}

/* ------------------------------------------------------------ fonts */

// pdfTeX stops at the FIRST font file it cannot open. Rather than rerunning once per font, read the
// recorder file (every .tfm the run used), look each one up in pdftex.map and fetch all their
// outline fonts and encodings in one go.
const PDFTEX_MAP = '/texlive/texmf-dist/texmf-var/fonts/map/pdftex/updmap/pdftex.map';
let fontMap = null;
function fontMapIndex() {
  if (fontMap) return fontMap;
  fontMap = new Map();
  const text = FSx.read(PDFTEX_MAP, true) || '';
  for (const line of text.split('\n')) {
    if (!line || line[0] === '%') continue;
    const tfm = line.split(/\s+/)[0];
    const files = [...line.matchAll(/<[<[]?([^\s<"]+\.(?:pfb|pfa|enc|ttf|otf))/g)].map(m => m[1]);
    if (files.length && !fontMap.has(tfm)) fontMap.set(tfm, files);
  }
  return fontMap;
}
const FONT_FAILURE = /Font \S+ at \d+ not found|cannot open Type 1 font|cannot open encoding file|mktexpk|Could not locate a virtual\/physical font|This font is mapped to a physical font/;
function fontFilesFromRecorder(dir) {
  const fls = FSx.read(`${dir}/${JOB}.fls`, true) || '';
  const map = fontMapIndex();
  const out = new Set();
  for (const m of fls.matchAll(/^INPUT (.+)\.tfm$/gm)) {
    const tfm = m[1].slice(m[1].lastIndexOf('/') + 1);
    for (const f of map.get(tfm) || []) out.add(f);
  }
  return [...out];
}

/* ----------------------------------------------------------- running */

function runTool(args) {
  Module.out = '';
  Module.err = '';
  let code;
  try {
    code = Module.callMain(args.slice()); // callMain prepends argv[0] in place
  } catch (e) {
    code = typeof e === 'number' ? e : (e && e.status !== undefined ? e.status : -1);
    if (code === -1) Module.err += `\n${e && e.message ? e.message : e}`;
  }
  try { Module._flush_streams && Module._flush_streams(); } catch { /* ignore */ }
  // TeX programs aren't re-entrant: restore pristine memory for the next run.
  Module.HEAPU8.fill(0);
  Module.HEAPU8.set(memSnapshot);
  return { code, out: Module.out, err: Module.err };
}

const FSx = {
  exists(p) { try { Module.FS.stat(p); return true; } catch { return false; } },
  read(p, enc) { try { return Module.FS.readFile(p, enc ? { encoding: 'utf8' } : undefined); } catch { return null; } },
  rm(p) { try { Module.FS.unlink(p); } catch { /* none */ } },
  rmTree(p) {
    let st;
    try { st = Module.FS.stat(p); } catch { return; }
    if (Module.FS.isDir(st.mode)) {
      for (const n of Module.FS.readdir(p)) if (n !== '.' && n !== '..') FSx.rmTree(`${p}/${n}`);
      Module.FS.rmdir(p);
    } else Module.FS.unlink(p);
  },
  list(dir, base = '') {
    const out = [];
    let names = [];
    try { names = Module.FS.readdir(dir); } catch { return out; }
    for (const n of names) {
      if (n === '.' || n === '..') continue;
      const full = `${dir}/${n}`;
      const rel = base ? `${base}/${n}` : n;
      const st = Module.FS.stat(full);
      if (Module.FS.isDir(st.mode)) out.push(...FSx.list(full, rel));
      else out.push(rel);
    }
    return out;
  },
};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

const OUTPUT_EXT = /^output\.(aux|log|toc|lof|lot|out|bbl|blg|bcf|run\.xml|nav|snm|vrb|idx|ind|ilg|synctex\.gz|synctex|pdf|xdv|fls|brf|glo|gls|ist|loa|thm)$/;

async function compile({ project, files, main, engine, draft = false }) {
  await ensureInit();
  const started = Date.now();
  const steps = [];
  const logParts = [];

  // ---- project directory
  let proj = projects.get(project);
  if (!proj) {
    proj = { dir: `/home/web_user/p${projects.size}`, versions: new Map(), bibSig: '', idxSig: '' };
    projects.set(project, proj);
    mkdirp(proj.dir);
  }
  const dir = proj.dir;
  const keep = new Set(files.map(f => f.path));
  for (const [p] of proj.versions) {
    if (!keep.has(p)) { FSx.rm(`${dir}/${p}`); proj.versions.delete(p); }
  }
  const needed = [];
  for (const f of files) {
    if (f.data === undefined) {
      if (proj.versions.get(f.path) !== f.v) needed.push(f.path);
      continue;
    }
    const abs = `${dir}/${f.path}`;
    mkdirp(abs.slice(0, abs.lastIndexOf('/')));
    Module.FS.writeFile(abs, typeof f.data === 'string' ? f.data : new Uint8Array(f.data));
    proj.versions.set(f.path, f.v);
  }
  if (needed.length) return { type: 'need', paths: needed };

  // ---- packages
  const eng = engine === 'xelatex' ? 'xetex' : 'pdftex';
  if (eng === 'xetex') await ensureUnits(index.engines.xetex, 'Downloading XeLaTeX (first time only)');
  const texts = files.filter(f => /\.(tex|sty|cls|ltx)$/i.test(f.path)).map(f => FSx.read(`${dir}/${f.path}`, true) || '');
  const loaded = await ensureUnits(unitsForNames(scanSources(texts)));
  if (loaded.length) logParts.push(`[Texlume] Loaded packages: ${loaded.join(', ')}`);

  // ---- run
  Module.FS.chdir(dir);
  const base = ['--no-shell-escape', '--interaction=nonstopmode', '--file-line-error', '--synctex=1', '--recorder', `--jobname=${JOB}`, '--fmt', index.fmt[eng]];
  const hadAux = FSx.exists(`${dir}/${JOB}.aux`);
  // Fast (draft) mode: graphicx draws a labelled frame instead of decoding and embedding each image.
  const input = draft
    ? `\\PassOptionsToPackage{draft}{graphicx}\\PassOptionsToPackage{draft}{graphics}\\input{${main}}`
    : main;
  const texArgs = eng === 'pdftex'
    ? ['pdflatex', ...base, input]
    : ['xelatex', ...base, '--no-pdf', input];

  FSx.rm(`${dir}/${JOB}.pdf`);
  FSx.rm(`${dir}/${JOB}.xdv`);

  let log = '';
  let lastOut = '';
  const runTex = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const t0 = Date.now();
      const r = runTool(texArgs);
      log = FSx.read(`${dir}/${JOB}.log`, true) || '';
      lastOut = r.out + r.err;
      steps.push({ cmd: texArgs[0], code: r.code, ms: Date.now() - t0 });
      const text = `${log}\n${lastOut}`;
      const missing = missingFromLog(text);
      if (FONT_FAILURE.test(text)) missing.push(...fontFilesFromRecorder(dir));
      const ids = unitsForNames(missing);
      if (!ids.length) return r;
      const names = await ensureUnits(ids, 'Downloading packages');
      logParts.push(`[Texlume] Fetched on demand: ${names.join(', ')}`);
      status('Compiling…');
    }
    return null;
  };

  // LaTeX doesn't ask for a rerun when the table of contents / lists change, but their page numbers
  // only become right on the next pass. Track them the way latexmk does.
  const listsSig = () => hash(['toc', 'lof', 'lot'].map(e => FSx.read(`${dir}/${JOB}.${e}`, true) || '').join('\u0000'));
  let lastLists = listsSig();
  const listsChanged = () => { const s = listsSig(); const changed = s !== lastLists; lastLists = s; return changed; };

  await runTex();
  let rerun = listsChanged();

  // bibliography (bibtex8)
  const aux = FSx.read(`${dir}/${JOB}.aux`, true) || '';
  if (/\\bibdata\{/.test(aux)) {
    const bibs = files.filter(f => /\.(bib|bst)$/i.test(f.path)).map(f => `${f.path}@${f.v}`).join('|');
    const sig = hash(`${bibs}\n${(aux.match(/^\\(citation|bibdata|bibstyle)\{.*$/gm) || []).join('\n')}`);
    if (sig !== proj.bibSig || !FSx.exists(`${dir}/${JOB}.bbl`)) {
      const styles = (aux.match(/\\bibstyle\{([^}]+)\}/g) || []).map(s => `${s.slice(10, -1)}.bst`);
      // .bib databases that aren't project files come from TeX Live (e.g. IEEEabrv)
      const bibdata = ((aux.match(/\\bibdata\{([^}]+)\}/) || [])[1] || '').split(',').map(s => `${s.trim().replace(/\.bib$/i, '')}.bib`)
        .filter(n => n !== '.bib' && !files.some(f => f.path === n || f.path.endsWith(`/${n}`)));
      await ensureUnits(unitsForNames([...styles, ...bibdata]));
      const t0 = Date.now();
      const r = runTool(['bibtex8', '--8bit', `${JOB}.aux`]);
      steps.push({ cmd: 'bibtex', code: r.code, ms: Date.now() - t0 });
      logParts.push(`===== bibtex =====\n${FSx.read(`${dir}/${JOB}.blg`, true) || r.out}`);
      proj.bibSig = sig;
      rerun = true;
    }
  }
  // index
  const idx = FSx.read(`${dir}/${JOB}.idx`, true);
  if (idx !== null) {
    const sig = hash(idx);
    if (sig !== proj.idxSig) {
      const r = runTool(['makeindex', `${JOB}.idx`]);
      steps.push({ cmd: 'makeindex', code: r.code, ms: 0 });
      proj.idxSig = sig;
      rerun = true;
    }
  }
  // Draft mode normally stays at one pass (the previous .aux supplies references). On a project's
  // first compile there is no .aux yet, so let it settle like a normal compile.
  let passes = 1;
  const settle = !draft || !hadAux;
  const maxPasses = settle ? 4 : 2;
  while (passes < maxPasses && (rerun || (settle && /Rerun to get|Label\(s\) may have changed|Rerun LaTeX/i.test(log)))) {
    passes++;
    await runTex();
    rerun = listsChanged();
  }

  // XeTeX writes .xdv; convert to PDF
  if (eng === 'xetex' && FSx.exists(`${dir}/${JOB}.xdv`)) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const t0 = Date.now();
      const r = runTool(['xdvipdfmx', '-q', '-o', `${JOB}.pdf`, `${JOB}.xdv`]);
      steps.push({ cmd: 'xdvipdfmx', code: r.code, ms: Date.now() - t0 });
      const failed = r.out + r.err;
      const names = missingFromLog(failed);
      if (FONT_FAILURE.test(failed)) names.push(...fontFilesFromRecorder(dir));
      const ids = unitsForNames(names);
      if (r.out.trim() || r.err.trim()) logParts.push(`===== xdvipdfmx =====\n${r.out}${r.err}`);
      if (!ids.length) break;
      await ensureUnits(ids, 'Downloading fonts');
    }
  }

  const pdf = FSx.read(`${dir}/${JOB}.pdf`);
  let synctex = null;
  const gz = FSx.read(`${dir}/${JOB}.synctex.gz`);
  if (gz) {
    try { synctex = new TextDecoder().decode(await gunzip(gz)); } catch { synctex = null; }
  } else {
    synctex = FSx.read(`${dir}/${JOB}.synctex`, true);
  }

  const result = {
    type: 'result',
    pdf: pdf && pdf.length ? pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) : null,
    synctex,
    log: log + (logParts.length ? `\n\n${logParts.join('\n\n')}` : '') +
      ((!pdf || !log) && lastOut.trim() ? `\n\n===== engine output =====\n${lastOut.slice(-6000)}` : ''),
    dir,
    ms: Date.now() - started,
    passes,
    steps,
    engine,
    draft,
  };
  return result;
}

function ensureInit() {
  if (!initPromise) initPromise = init().catch(err => { initPromise = null; throw err; });
  return initPromise;
}

/* ------------------------------------------------------------- inbox */

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === 'init') {
        const r = await ensureInit();
        post({ id: data.id, type: 'ready', ...r });
      } else if (data.type === 'compile') {
        const r = await compile(data);
        post({ id: data.id, ...r }, r.pdf ? [r.pdf] : []);
      } else if (data.type === 'forget') {
        const p = projects.get(data.project);
        if (p) { FSx.rmTree(p.dir); projects.delete(data.project); }
        post({ id: data.id, type: 'ok' });
      }
    } catch (err) {
      post({ id: data.id, type: 'error', message: err && err.message ? err.message : String(err) });
    }
  });
};
