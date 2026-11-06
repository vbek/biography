/*
 * Reads BusyTeX's Emscripten data packages (LZ4-compressed .data + .js metadata)
 * and returns their files as { path -> Buffer }.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CHUNK_SIZE = 2048; // Emscripten MiniLZ4.CHUNK_SIZE

/** Decode one raw LZ4 block (no frame header). */
function lz4DecodeBlock(src, dst) {
  let si = 0;
  let di = 0;
  while (si < src.length) {
    const token = src[si++];
    let lit = token >> 4;
    if (lit === 15) {
      let b;
      do { b = src[si++]; lit += b; } while (b === 255);
    }
    for (let k = 0; k < lit; k++) dst[di++] = src[si++];
    if (si >= src.length) break;
    const offset = src[si] | (src[si + 1] << 8);
    si += 2;
    let mlen = token & 15;
    if (mlen === 15) {
      let b;
      do { b = src[si++]; mlen += b; } while (b === 255);
    }
    mlen += 4;
    let from = di - offset;
    for (let k = 0; k < mlen; k++) dst[di++] = dst[from++];
  }
  return di;
}

function parsePackage(jsPath, dataPath) {
  const js = fs.readFileSync(jsPath, 'utf8');
  const data = fs.readFileSync(dataPath);
  const filesMatch = [...js.matchAll(/"filename": *"([^"]+)", *"start": *(\d+), *"end": *(\d+)/g)]
    .map(m => ({ path: m[1], start: Number(m[2]), end: Number(m[3]) }));
  const cm = /var compressedData = (\{.*\})\s*;/.exec(js);
  let raw;
  if (cm) {
    const meta = JSON.parse(cm[1]);
    const total = Math.max(...filesMatch.map(f => f.end), 0);
    raw = Buffer.alloc(Math.ceil(total / CHUNK_SIZE) * CHUNK_SIZE);
    const tmp = Buffer.alloc(CHUNK_SIZE);
    for (let i = 0; i < meta.offsets.length; i++) {
      const off = meta.offsets[i];
      const size = meta.sizes[i];
      const src = data.subarray(off, off + size);
      const at = i * CHUNK_SIZE;
      if (meta.successes[i]) {
        const n = lz4DecodeBlock(src, tmp);
        tmp.copy(raw, at, 0, n);
      } else {
        src.copy(raw, at);
      }
    }
  } else {
    raw = data;
  }
  const files = new Map();
  for (const f of filesMatch) files.set(f.path, raw.subarray(f.start, f.end));
  return files;
}

module.exports = { parsePackage, lz4DecodeBlock };

if (require.main === module) {
  const dir = process.argv[2];
  const name = process.argv[3] || 'texlive-basic';
  const files = parsePackage(path.join(dir, `${name}.js`), path.join(dir, `${name}.data`));
  const by = {};
  for (const [p, b] of files) {
    const k = p.split('/').slice(0, Number(process.argv[4] || 5)).join('/');
    by[k] = (by[k] || 0) + b.length;
  }
  Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log((v / 1e6).toFixed(2).padStart(7), k));
  const probe = process.argv[5];
  if (probe && files.has(probe)) console.log(files.get(probe).toString('latin1').slice(0, 1500));
}
