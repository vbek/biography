#!/usr/bin/env node
/*
 * Repackages the BusyTeX WebAssembly TeX Live build into lazily loadable bundles for TeXForge.
 *
 *   node build-texlive.js <busytex-download-dir> <output-dir>
 *
 * Input: busytex.js, busytex.wasm and the Emscripten data packages (texlive-basic + ubuntu-texlive-*)
 * from https://github.com/busytex/busytex/releases (build_wasm_4499aa69…).
 *
 * Output:
 *   busytex.js, busytex.wasm.gz
 *   index.json            — every file, grouped into "units" (one CTAN package / font family each),
 *                           with dependencies between units and the chunk that stores them
 *   chunk-NNN.bin.gz      — concatenated file bytes for several units (each ≤ ~4 MB raw)
 *
 * The browser loads the "core" units once (enough for pdfLaTeX), the engine units when XeLaTeX or
 * LuaLaTeX is picked, and everything else on demand — from \usepackage scanning, unit dependencies,
 * or "file not found" messages in the log.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parsePackage } = require('./texlive-extract');

const [srcDir, outDir, ctanDir] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error('usage: node build-texlive.js <busytex-dir> <out-dir> [ctan-tds-dir]');
  console.error('  ctan-tds-dir: optional folder of extracted CTAN .tds.zip trees (e.g. pgf/, pgfplots/),');
  console.error('                each with tex/ fonts/ … at its root. Added under /texmf/texmf-dist.');
  process.exit(1);
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

const PACKAGES = [
  'texlive-basic',
  'ubuntu-texlive-latex-base',
  'ubuntu-texlive-latex-recommended',
  'ubuntu-texlive-fonts-recommended',
  'ubuntu-texlive-science',
  'ubuntu-texlive-latex-extra',
];

// Things a browser editor never needs.
const EXCLUDE = [
  /\/texmf-dist\/source\//,
  /\/texmf-dist\/doc\//,
  /\/texmf-dist\/fonts\/afm\//,
  /\/texmf-dist\/fonts\/source\//,
  /\/texmf-dist\/fonts\/pk\//,
  /\/texmf-dist\/tex\/latex-dev\//,
  /\/texmf-dist\/tex\/optex\//,
  /-dev\.fmt$/,
  /\/web2c\/pdftex\/(latex|mptopdf|etex|pdfetex|pdftex)\.fmt$/,
  /\/web2c\/xetex\/xetex\.fmt$/,
  // LuaHBTeX in this BusyTeX build overflows its 64 KiB wasm stack, so LuaLaTeX is not offered.
  /\/web2c\/luahbtex\//,
  /\/texmf-dist\/tex\/luatex\/luaotfload\//,
  /\/README(\.md|\.txt)?$/i,
  /\/(CHANGES|ChangeLog|NEWS|LICENSE|COPYING|INSTALL)(\.[a-z]+)?$/i,
  /\.(html|dtx|ins)$/i,
  /^(?!.*\/texmf-dist\/tex\/).*\.pdf$/i,   // keep PDFs inside tex/ (beamer icons, logos), drop documentation
  /\/scripts\//,
];

// Units every compile starts with (pdfLaTeX).
const CORE_RULES = [
  p => !/\/texmf-dist\//.test(p),                                  // /etc, /texlive/texmf.cnf
  p => /\/ls-R$/.test(p),                                          // kpathsea searches /texlive via ls-R only (!!)
  p => /\/texmf-dist\/web2c\/(?!.*\.fmt$)/.test(p),                // texmf.cnf, updmap.cfg …
  p => /\/web2c\/pdftex\/pdflatex\.fmt$/.test(p),
  p => /\/texmf-var\/(fonts\/map\/(pdftex|dvipdfmx)|fonts\/conf)/.test(p),
  p => /\/texmf-dist\/dvipdfmx\//.test(p),
  p => /^\/texlive\/texmf-dist\/fonts\/(enc|map)\//.test(p),
  p => /^\/texlive\/texmf-dist\/tex\/(latex|generic|plain)\//.test(p) && !/\/(tex\/generic\/unicode-data)\//.test(p),
  p => /^\/texlive\/texmf-dist\/fonts\/tfm\/public\/(cm|amsfonts|latex-fonts)\//.test(p),
  p => /^\/texlive\/texmf-dist\/fonts\/type1\/public\/amsfonts\/(cm|symbols)\//.test(p),
  p => /^\/texlive\/texmf-dist\/bibtex\/bst\/(base|natbib)\//.test(p),
];

const ENGINE_RULES = {
  xetex: [
    p => /\/web2c\/xetex\/xelatex\.fmt$/.test(p),
    p => /\/tex\/(xelatex|xetex)\//.test(p),
    p => /\/fonts\/opentype\/public\/lm(-math)?\//.test(p),
    p => /\/fonts\/misc\/xetex\//.test(p),
    p => /\/tex\/generic\/unicode-data\//.test(p),
  ],
};

function unitKey(abs) {
  const i = abs.indexOf('/texmf-dist/');
  if (i < 0) return `sys${path.posix.dirname(abs)}`;
  const rel = abs.slice(i + '/texmf-dist/'.length);
  const parts = rel.split('/');
  let depth;
  // fonts/<kind>/<supplier>/<family>: tfm, vf, type1 … of one family travel together
  // cm-super is 421 large Type 1 files of which a document uses a handful: one unit per font file
  if (parts[0] === 'fonts' && parts[1] === 'type1' && parts[3] === 'cm-super') {
    return `fonts/type1/public/cm-super/${parts[parts.length - 1].replace(/\.[^.]+$/, '')}`;
  }
  if (parts[0] === 'fonts' && /^(tfm|vf|type1|opentype|truetype|ofm|ovf|ovp)$/.test(parts[1]) && parts.length > 4) {
    return `fonts/*/${parts[2]}/${parts[3]}`;
  }
  if (parts[0] === 'fonts') depth = 4;
  else if (parts[0] === 'tex') depth = 3;                             // tex/<format>/<package>
  else if (parts[0] === 'bibtex') depth = 3;                          // bibtex/<bst|bib>/<package>
  else if (parts[0] === 'texmf-var') depth = 4;
  else depth = 2;
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/') || parts[0];
}

// ---------------------------------------------------------------- collect files
const files = new Map(); // abs path -> Buffer
const seenRel = new Set();
for (const name of PACKAGES) {
  const js = path.join(srcDir, `${name}.js`);
  const data = path.join(srcDir, `${name}.data`);
  if (!fs.existsSync(js) || !fs.existsSync(data)) { console.warn(`skip ${name} (missing)`); continue; }
  const pkg = parsePackage(js, data);
  let kept = 0;
  for (const [abs, buf] of pkg) {
    if (EXCLUDE.some(r => r.test(abs))) continue;
    const i = abs.indexOf('/texmf-dist/');
    const rel = i >= 0 ? abs.slice(i) : abs;
    if (seenRel.has(rel)) continue; // texlive-basic wins over the older Ubuntu copies
    seenRel.add(rel);
    files.set(abs, Buffer.from(buf));
    kept++;
  }
  console.log(`${name}: kept ${kept} files`);
}

// Extra CTAN packages missing from BusyTeX's Ubuntu bundles (PGF/TikZ, pgfplots, tikz-cd …).
if (ctanDir) {
  for (const pkg of fs.readdirSync(ctanDir)) {
    const root = path.join(ctanDir, pkg);
    if (!fs.statSync(root).isDirectory()) continue;
    let kept = 0;
    for (const rel of walk(root)) {
      const abs = `/texmf/texmf-dist/${rel}`;
      if (EXCLUDE.some(r => r.test(abs))) continue;
      const key = `/texmf-dist/${rel}`;
      if (seenRel.has(key)) continue;
      seenRel.add(key);
      files.set(abs, fs.readFileSync(path.join(root, rel)));
      kept++;
    }
    console.log(`ctan/${pkg}: kept ${kept} files`);
  }
}

// pdfTeX only knows fonts that updmap saw. Append the Type 1 map lines shipped by the extra font
// packages so \usepackage{helvet}, {mathptmx}, {esint}, … embed real fonts.
{
  const mapPath = [...files.keys()].find(p => p.endsWith('/fonts/map/pdftex/updmap/pdftex.map'));
  const base = files.get(mapPath).toString('latin1');
  const known = new Set(base.split('\n').map(l => l.split(/\s+/)[0]).filter(Boolean));
  const extra = [];
  for (const [abs, buf] of files) {
    if (!abs.startsWith('/texmf/') || !/\/fonts\/map\/dvips\/.*\.map$/.test(abs)) continue;
    for (const line of buf.toString('latin1').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('%')) continue;
      const tfm = t.split(/\s+/)[0];
      if (known.has(tfm)) continue;
      known.add(tfm);
      extra.push(t);
    }
  }
  files.set(mapPath, Buffer.from(`${base}\n% --- added by TeXForge from extra font packages ---\n${extra.join('\n')}\n`, 'latin1'));
  console.log(`pdftex.map: +${extra.length} entries`);
}

// ---------------------------------------------------------------- units
const units = new Map(); // key -> { key, files: [abs], size, core, engines:Set }
for (const [abs, buf] of files) {
  const key = (abs.startsWith('/texmf/') ? 'x:' : '') + unitKey(abs);
  let u = units.get(key);
  if (!u) { u = { key, files: [], size: 0, core: false, engines: new Set() }; units.set(key, u); }
  u.files.push(abs);
  u.size += buf.length;
}
for (const u of units.values()) {
  if (u.files.every(f => CORE_RULES.some(r => r(f)))) u.core = true;
  for (const [eng, rules] of Object.entries(ENGINE_RULES)) if (u.files.some(f => rules.some(r => r(f)))) u.engines.add(eng);
}
// Units with mixed core/non-core files: split the core files into their own unit.
for (const u of [...units.values()]) {
  if (u.core) continue;
  const coreFiles = u.files.filter(f => CORE_RULES.some(r => r(f)));
  if (!coreFiles.length) continue;
  const key = `${u.key}#core`;
  units.set(key, { key, files: coreFiles, size: coreFiles.reduce((s, f) => s + files.get(f).length, 0), core: true, engines: new Set() });
  u.files = u.files.filter(f => !coreFiles.includes(f));
  u.size -= units.get(key).size;
  if (!u.files.length) units.delete(u.key);
}

// ---------------------------------------------------------------- dependencies
const nameToUnits = new Map();
const unitList = [...units.values()].sort((a, b) => a.key.localeCompare(b.key));
unitList.forEach((u, i) => { u.id = i; });
for (const u of unitList) {
  for (const f of u.files) {
    const b = path.posix.basename(f);
    if (!nameToUnits.has(b)) nameToUnits.set(b, []);
    nameToUnits.get(b).push(u.id);
  }
}
const DEP_RE = /\\(?:RequirePackage|usepackage|RequirePackageWithOptions|LoadClass|LoadClassWithOptions)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}|\\(?:input|InputIfFileExists)\s*\{([^}]+)\}|\\usetikzlibrary\s*\{([^}]+)\}|\\usepgflibrary\s*\{([^}]+)\}|\\input\s+([A-Za-z0-9_.-]+\.tex)\b/g;
for (const u of unitList) {
  const deps = new Set();
  for (const f of u.files) {
    if (!/\.(sty|cls|tex|def|cfg|clo)$/.test(f)) continue;
    const text = files.get(f).toString('latin1');
    for (const m of text.matchAll(DEP_RE)) {
      const candidates = [];
      if (m[1]) for (const n of m[1].split(',')) { const s = n.trim(); if (s && !/[#\\]/.test(s)) candidates.push(`${s}.sty`, `${s}.cls`); }
      if (m[2]) { const s = m[2].trim(); if (s && !/[#\\]/.test(s)) candidates.push(s, `${s}.tex`); }
      if (m[3]) for (const n of m[3].split(',')) { const s = n.trim(); if (s) candidates.push(`tikzlibrary${s}.code.tex`, `pgflibrary${s}.code.tex`); }
      if (m[4]) for (const n of m[4].split(',')) { const s = n.trim(); if (s) candidates.push(`pgflibrary${s}.code.tex`); }
      if (m[5]) candidates.push(m[5]);
      for (const c of candidates) {
        const ids = nameToUnits.get(c);
        if (ids && !ids.includes(u.id)) { deps.add(ids[0]); break; }
      }
    }
  }
  u.deps = [...deps].filter(d => !unitList[d].core).sort((a, b) => a - b);
}

// ---------------------------------------------------------------- chunks
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (/^chunk-\d+\.bin\.gz$|^index\.json$/.test(f)) fs.rmSync(path.join(outDir, f));

const CHUNK_TARGET = 4 * 1024 * 1024;
const chunks = [];
let cur = null;
const flush = () => { if (cur && cur.parts.length) chunks.push(cur); cur = null; };
// keep core units together in the first chunks, then engine bundles, then the rest
const isPerFontUnit = u => u.key.includes('fonts/type1/public/cm-super/');
const groupOf = u => (u.core ? 0 : u.engines.has('xetex') ? 1 : isPerFontUnit(u) ? 3 : 2);
const ordered = [...unitList].sort((a, b) => groupOf(a) - groupOf(b) || a.key.localeCompare(b.key));
let lastGroup = -1;
for (const u of ordered) {
  const g = groupOf(u);
  if (g !== lastGroup) { flush(); lastGroup = g; }
  // per-font units go into small chunks so fetching one font downloads ~1 MB, not 4
  const target = g === 3 ? 1024 * 1024 : CHUNK_TARGET;
  if (!cur || (cur.size + u.size > target && cur.size > 0)) { flush(); cur = { parts: [], size: 0 }; }
  u.chunk = chunks.length;
  u.offset = cur.size;
  const entries = [];
  for (const f of u.files.sort()) {
    const b = files.get(f);
    entries.push([f, cur.size, b.length]);
    cur.parts.push(b);
    cur.size += b.length;
  }
  u.entries = entries;
}
flush();

let total = 0;
const buildHash = require('crypto').createHash('sha1');
const chunkMeta = chunks.map((c, i) => {
  const raw = Buffer.concat(c.parts);
  const gz = zlib.gzipSync(raw, { level: 9 });
  const name = `chunk-${String(i).padStart(3, '0')}.bin.gz`;
  fs.writeFileSync(path.join(outDir, name), gz);
  buildHash.update(gz);
  total += gz.length;
  return { file: name, size: raw.length, gz: gz.length };
});

const index = {
  version: 1,
  source: 'busytex build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993 (TeX Live 2023 + Ubuntu lunar texlive packages)',
  env: {
    TEXMFDIST: '/texlive/texmf-dist:/texmf/texmf-dist',
    TEXMFVAR: '/texlive/texmf-dist/texmf-var',
    TEXMFCNF: '/texlive/texmf-dist/web2c',
    FONTCONFIG_PATH: '/etc/fonts',
  },
  fmt: {
    pdftex: '/texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt',
    xetex: '/texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt',
  },
  wasmGz: 0,
  chunks: chunkMeta,
  core: unitList.filter(u => u.core).map(u => u.id),
  engines: {
    xetex: unitList.filter(u => u.engines.has('xetex')).map(u => u.id),
  },
  units: unitList.map(u => ({ k: u.key, c: u.chunk, d: u.deps, f: u.entries.map(([p, o, l]) => [p, o, l]) })),
};
// engine binaries
fs.copyFileSync(path.join(srcDir, 'busytex.js'), path.join(outDir, 'busytex.js'));
const wasmGz = zlib.gzipSync(fs.readFileSync(path.join(srcDir, 'busytex.wasm')), { level: 9 });
fs.writeFileSync(path.join(outDir, 'busytex.wasm.gz'), wasmGz);
index.wasmGz = wasmGz.length;
// Browsers cache chunks by URL; the build id versions those URLs so a rebuild never mixes old and new chunks.
buildHash.update(wasmGz);
index.build = buildHash.digest('hex').slice(0, 12);
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));

const sum = ids => ids.reduce((s, id) => s + chunkMeta[unitList[id].chunk].gz * 0 + unitList[id].size, 0);
const chunkSet = ids => [...new Set(ids.map(id => unitList[id].chunk))];
const gzOf = ids => chunkSet(ids).reduce((s, c) => s + chunkMeta[c].gz, 0);
console.log(`units: ${unitList.length}, chunks: ${chunks.length}, total gz: ${(total / 1e6).toFixed(1)} MB`);
console.log(`core: ${index.core.length} units, ${(sum(index.core) / 1e6).toFixed(1)} MB raw, ${(gzOf(index.core) / 1e6).toFixed(1)} MB gz`);
for (const [e, ids] of Object.entries(index.engines)) console.log(`${e}: ${ids.length} units, ${(gzOf(ids) / 1e6).toFixed(1)} MB gz`);
console.log(`largest chunk: ${(Math.max(...chunkMeta.map(c => c.gz)) / 1e6).toFixed(1)} MB gz`);
console.log(`index.json: ${(fs.statSync(path.join(outDir, 'index.json')).size / 1e6).toFixed(2)} MB`);
