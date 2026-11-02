/* Document Reader — turns a file into headings, paragraphs and sentences. Everything is parsed here in the browser.
   Parsed text is only ever shown with textContent, so markup inside a document can't run on this page. */
const PDF_LIB = new URL('../../pdf-editor/lib/', import.meta.url).href;
const OCR_BASE = new URL('../../financial-planner/vendor/tesseract/', import.meta.url).href;
const MAX_FILE = 300 * 1024 * 1024;
const MAX_CHUNK = 280; // the voice model cuts off at about 500 phonemes, so longer sentences are split first

export const ACCEPT = '.pdf,.docx,.odt,.pptx,.epub,.xlsx,.rtf,.txt,.text,.log,.md,.markdown,.html,.htm,.xhtml,.csv,.tsv,.json,.xml,.yaml,.yml,.srt,.vtt,image/*';

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = () => { loaded.delete(src); rej(new Error('A part of the reader could not load. Check your connection and try again.')); };
      document.head.append(s);
    }));
  }
  return loaded.get(src);
}
async function openZip(file) {
  await loadScript(`${PDF_LIB}jszip.min.js`);
  try { return await window.JSZip.loadAsync(file); }
  catch { throw new Error('This file looks damaged, or is not really the format its name says.'); }
}
// Workers from other tools' folders start from a blob, so this page's isolation applies to them too.
const blobWorker = (url) => URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(url)});`], { type: 'text/javascript' }));
const clean = (t) => t.replace(/­/g, '').replace(/[\s ]+/g, ' ').trim();
const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const byLocal = (root, name) => [...root.getElementsByTagNameNS('*', name)];
const naturalOrder = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/* ---------- sentences ---------- */
const ABBREV = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|cf|al|Fig|Figs|Eq|No|Vol|Ch|Sec|pp?|Inc|Ltd|Co|Corp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|[A-Z])\.\s*$/;
const segmenter = 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null;

function splitLong(text) {
  const out = [];
  let rest = text;
  while (rest.length > MAX_CHUNK) {
    const head = rest.slice(0, MAX_CHUNK);
    const cut = Math.max(head.lastIndexOf('; '), head.lastIndexOf(', '), head.lastIndexOf(': '), head.lastIndexOf(' – '), head.lastIndexOf(' — '));
    const at = cut > MAX_CHUNK * 0.4 ? cut + 1 : head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : MAX_CHUNK;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}
export function sentences(text) {
  const parts = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [text];
  const merged = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (ABBREV.test(last) || /^\s*[a-z]/.test(part))) merged[merged.length - 1] = last + part;
    else merged.push(part);
  }
  return merged.map((s) => s.trim()).filter(Boolean).flatMap(splitLong);
}

function finish(title, format, blocks) {
  const out = blocks.map((b) => ({ ...b, text: b.kind === 'code' ? b.text.trimEnd() : clean(b.text) })).filter((b) => b.text);
  if (!out.length) throw new Error('No readable text was found in this document.');
  let chars = 0;
  for (const b of out) {
    if (b.kind !== 'code') { b.s = sentences(b.text); chars += b.text.length; }
  }
  return { title: title || 'Untitled', format, blocks: out, chars };
}

/* ---------- plain text ---------- */
function decode(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('windows-1252').decode(b); }
}
export function textBlocks(text) {
  const blocks = [];
  for (const chunk of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    // Hard-wrapped lines belong together, but a run of short lines or bullets is a list.
    const listy = lines.length > 1 && lines.filter((l) => /^([-*•–]|\d+[.)])\s/.test(l) || l.length < 48).length > lines.length * 0.7;
    if (listy) lines.forEach((l) => blocks.push({ kind: /^([-*•–]|\d+[.)])\s/.test(l) ? 'li' : 'p', text: l.replace(/^[-*•–]\s+/, '') }));
    else blocks.push({ kind: 'p', text: lines.join(' ') });
  }
  return blocks;
}
function markdownBlocks(text) {
  const inline = (s) => s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/(\*\*|__|\*|_|~~|`)(?=\S)(.+?)(?<=\S)\1/g, '$2');
  const blocks = [];
  let para = [], code = null;
  const flush = () => { if (para.length) { blocks.push({ kind: 'p', text: inline(para.join(' ')) }); para = []; } };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (code) { blocks.push({ kind: 'code', text: code.join('\n') }); code = null; } else { flush(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    let m;
    if (!line.trim()) flush();
    else if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) { flush(); blocks.push({ kind: `h${Math.min(3, m[1].length)}`, text: inline(m[2]) }); }
    else if ((m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)/))) { flush(); blocks.push({ kind: 'li', text: inline(m[1]) }); }
    else if ((m = line.match(/^\s*>\s?(.*)/))) { flush(); blocks.push({ kind: 'quote', text: inline(m[1]) }); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')) flush();
    else if (line.includes('|')) { flush(); blocks.push({ kind: 'p', text: inline(line.split('|').map((c) => c.trim()).filter(Boolean).join(', ')) }); }
    else para.push(line.trim());
  }
  flush();
  if (code) blocks.push({ kind: 'code', text: code.join('\n') });
  return blocks;
}
function delimitedBlocks(text, sep) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows.map((r) => ({ kind: 'p', text: r.map((v) => v.trim()).filter(Boolean).join(', ') }));
}
const subtitleBlocks = (text) => textBlocks(text.replace(/\r\n?/g, '\n').replace(/^WEBVTT.*$/m, '').replace(/^\d+\s*$/gm, '')
  .replace(/^[\d:.,]+\s*-->.*$/gm, '').replace(/<[^>]+>/g, ''));

/* ---------- RTF ---------- */
function rtfText(rtf) {
  const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'themedata', 'latentstyles', 'datastore', 'generator']);
  const stack = [];
  let out = '', skip = false, uc = 1, ansiSkip = 0, i = 0;
  while (i < rtf.length) {
    const c = rtf[i];
    if (c === '{') { stack.push({ skip, uc }); i++; continue; }
    if (c === '}') { const top = stack.pop(); if (top) ({ skip, uc } = top); i++; continue; }
    if (c === '\\') {
      const next = rtf[i + 1];
      if (next === "'") {
        if (ansiSkip > 0) ansiSkip--;
        else if (!skip) out += new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(rtf.substr(i + 2, 2), 16) || 32]));
        i += 4; continue;
      }
      if (next === '*') { skip = true; i += 2; continue; }
      if (!/[a-z]/i.test(next || '')) {
        if (!skip && '\\{}'.includes(next)) out += next;
        if (!skip && next === '~') out += ' ';
        i += 2; continue;
      }
      const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));
      const word = m[1], arg = m[2] === undefined ? null : +m[2];
      i += m[0].length;
      if (SKIP.has(word)) skip = true;
      else if (word === 'uc') uc = arg ?? 1;
      else if (word === 'u' && !skip) { out += String.fromCharCode(arg < 0 ? arg + 65536 : arg); ansiSkip = uc; }
      else if (!skip && (word === 'par' || word === 'line' || word === 'sect' || word === 'page')) out += '\n\n';
      else if (!skip && (word === 'tab' || word === 'cell')) out += ' ';
      else if (!skip && word === 'row') out += '\n\n';
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (ansiSkip > 0) ansiSkip--;
    else if (!skip) out += c;
    i++;
  }
  return out;
}

/* ---------- HTML and EPUB ---------- */
const LEAF = { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3', P: 'p', LI: 'li', BLOCKQUOTE: 'quote', PRE: 'code', DT: 'p', DD: 'p', FIGCAPTION: 'p', CAPTION: 'p', SUMMARY: 'p', ADDRESS: 'p' };
const CONTAINER = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dt,dd,figcaption,caption,table,tr,ul,ol,dl,div,section,article,main,aside,header,footer,figure,details,hr';
const IGNORE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'NAV', 'IFRAME', 'OBJECT', 'BUTTON', 'SELECT', 'TEXTAREA', 'HEAD', 'TITLE', 'FORM', 'MATH']);
function walkHtml(root, blocks, kind = 'p') {
  let run = '';
  const flush = () => { if (run.trim()) blocks.push({ kind, text: run }); run = ''; };
  for (const node of root.childNodes) {
    if (node.nodeType === 3) { run += node.nodeValue; continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toUpperCase();
    if (IGNORE.has(tag)) continue;
    if (tag === 'BR') { flush(); continue; }
    if (tag === 'TR') {
      flush();
      blocks.push({ kind: 'p', text: [...node.children].map((c) => clean(c.textContent)).filter(Boolean).join(', ') });
    } else if (!node.querySelector(CONTAINER) && !LEAF[tag] && !/^(DIV|SECTION|ARTICLE|MAIN|ASIDE|HEADER|FOOTER|FIGURE|DETAILS)$/.test(tag)) {
      run += node.textContent;
    } else {
      flush();
      if (tag === 'PRE') blocks.push({ kind: 'code', text: node.textContent });
      else walkHtml(node, blocks, LEAF[tag] || kind);
    }
  }
  flush();
}
function htmlBlocks(markup, type = 'text/html') {
  let doc = new DOMParser().parseFromString(markup, type);
  if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(markup, 'text/html');
  const blocks = [];
  if (doc.body) walkHtml(doc.body, blocks);
  return { blocks, title: clean(doc.querySelector('title')?.textContent || '') };
}
async function epub(file) {
  const zip = await openZip(file);
  const read = (p) => zip.file(p)?.async('string');
  if (/URI="[^"]+\.x?html?"/i.test(await read('META-INF/encryption.xml') || '')) throw new Error('This EPUB is copy-protected, so its text can\'t be read.');
  const container = await read('META-INF/container.xml');
  const opfPath = container && byLocal(parseXml(container), 'rootfile')[0]?.getAttribute('full-path');
  const opfText = opfPath && await read(opfPath);
  if (!opfText) throw new Error('This EPUB is missing its table of contents, so it can\'t be read.');
  const opf = parseXml(opfText);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map(byLocal(opf, 'item').map((i) => [i.getAttribute('id'), i.getAttribute('href')]));
  const blocks = [];
  for (const ref of byLocal(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const href = manifest.get(ref.getAttribute('idref'));
    if (!href) continue;
    const path = decodeURIComponent(new URL(href, `http://e/${base}`).pathname.slice(1));
    const page = await read(path);
    if (page) blocks.push(...htmlBlocks(page, 'application/xhtml+xml').blocks);
  }
  return { blocks, title: clean(byLocal(opf, 'title')[0]?.textContent || '') };
}

/* ---------- Office files ---------- */
function runText(p) {
  let out = '';
  const visit = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      const name = c.localName;
      if (name === 't') out += c.textContent;
      else if (name === 'tab' || name === 'br' || name === 'cr') out += ' ';
      else if (name !== 'pPr' && name !== 'rPr' && name !== 'instrText' && name !== 'drawing' && name !== 'pict' && name !== 'del') visit(c);
    }
  };
  visit(p);
  return out;
}
async function docx(file) {
  const zip = await openZip(file);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This Word file has no document body.');
  const blocks = byLocal(parseXml(xml), 'p').filter((p) => {
    // Text boxes are stored twice, once as a fallback for old versions of Word.
    for (let n = p.parentNode; n; n = n.parentNode) if (n.localName === 'Fallback') return false;
    return true;
  }).map((p) => {
    const pPr = [...p.children].find((c) => c.localName === 'pPr');
    const style = pPr && [...pPr.children].find((c) => c.localName === 'pStyle');
    const name = style ? (style.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val') || style.getAttribute('w:val') || '') : '';
    const level = /^title$/i.test(name) ? 1 : +(/^heading\s*(\d)/i.exec(name)?.[1] || 0);
    const list = pPr && [...pPr.children].some((c) => c.localName === 'numPr');
    return { kind: level ? `h${Math.min(3, level)}` : list ? 'li' : 'p', text: runText(p) };
  });
  const core = await zip.file('docProps/core.xml')?.async('string');
  return { blocks, title: core ? clean(byLocal(parseXml(core), 'title')[0]?.textContent || '') : '' };
}
async function odt(file) {
  const zip = await openZip(file);
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new Error('This OpenDocument file has no content.');
  const blocks = [];
  const flat = (n) => [...n.childNodes].map((c) => (c.nodeType === 3 ? c.nodeValue : c.localName === 's' || c.localName === 'tab' || c.localName === 'line-break' ? ' ' : c.localName === 'annotation' ? '' : flat(c))).join('');
  const visit = (n, inList) => {
    for (const c of n.children) {
      if (c.localName === 'h') blocks.push({ kind: `h${Math.min(3, +c.getAttribute('text:outline-level') || 1)}`, text: flat(c) });
      else if (c.localName === 'p') blocks.push({ kind: inList ? 'li' : 'p', text: flat(c) });
      else visit(c, inList || c.localName === 'list');
    }
  };
  const body = byLocal(parseXml(xml), 'text')[0];
  if (body) visit(body, false);
  return { blocks, title: '' };
}
async function pptx(file) {
  const zip = await openZip(file);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(naturalOrder);
  const blocks = [];
  for (let i = 0; i < names.length; i++) {
    const doc = parseXml(await zip.file(names[i]).async('string'));
    blocks.push({ kind: 'h2', text: `Slide ${i + 1}`, page: i + 1 });
    for (const shape of byLocal(doc, 'sp')) {
      const type = byLocal(shape, 'ph')[0]?.getAttribute('type') || '';
      for (const p of byLocal(shape, 'p')) {
        const text = byLocal(p, 't').map((t) => t.textContent).join('');
        if (text.trim()) blocks.push({ kind: /title/i.test(type) ? 'h3' : byLocal(p, 'buChar').length ? 'li' : 'p', text, page: i + 1 });
      }
    }
    const notes = zip.file(`ppt/notesSlides/notesSlide${/(\d+)\.xml$/.exec(names[i])[1]}.xml`);
    if (notes) {
      const parts = byLocal(parseXml(await notes.async('string')), 'sp')
        .filter((s) => byLocal(s, 'ph')[0]?.getAttribute('type') === 'body')
        .flatMap((s) => byLocal(s, 't').map((t) => t.textContent));
      if (parts.join('').trim()) blocks.push({ kind: 'quote', text: `Notes: ${parts.join(' ')}`, page: i + 1 });
    }
  }
  return { blocks, title: '' };
}
async function xlsx(file) {
  const zip = await openZip(file);
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const shared = sharedXml ? byLocal(parseXml(sharedXml), 'si').map((si) => byLocal(si, 't').map((t) => t.textContent).join('')) : [];
  const bookXml = await zip.file('xl/workbook.xml')?.async('string');
  const sheetNames = bookXml ? byLocal(parseXml(bookXml), 'sheet').map((s) => s.getAttribute('name')) : [];
  const names = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(naturalOrder);
  const blocks = [];
  for (let i = 0; i < names.length; i++) {
    blocks.push({ kind: 'h2', text: sheetNames[i] || `Sheet ${i + 1}` });
    for (const row of byLocal(parseXml(await zip.file(names[i]).async('string')), 'row')) {
      const cells = byLocal(row, 'c').map((c) => {
        const v = byLocal(c, 'v')[0]?.textContent;
        if (c.getAttribute('t') === 's') return shared[+v] ?? '';
        if (c.getAttribute('t') === 'inlineStr') return byLocal(c, 't').map((t) => t.textContent).join('');
        return v ?? '';
      }).filter((v) => v.trim?.() !== '');
      if (cells.length) blocks.push({ kind: 'p', text: cells.join(', ') });
    }
  }
  return { blocks, title: '' };
}

/* ---------- pictures of text ---------- */
let ocrWorker = null, ocrLogger = null;
async function ocr(image, onProgress, label) {
  await loadScript(`${OCR_BASE}tesseract.min.js`);
  if (!ocrWorker) {
    ocrWorker = window.Tesseract.createWorker('eng', 1, {
      workerPath: `${OCR_BASE}worker.min.js`, corePath: OCR_BASE, langPath: OCR_BASE, workerBlobURL: true, cacheMethod: 'none',
      logger: (m) => ocrLogger?.(m),
    });
  }
  const worker = await ocrWorker;
  ocrLogger = (m) => { if (m.status === 'recognizing text') onProgress(label, m.progress); };
  const { data } = await worker.recognize(image);
  ocrLogger = null;
  return data.text || '';
}
async function image(file, onProgress) {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('That image could not be opened. Try a JPEG or PNG.'); });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  onProgress('Finding text in the image', 0);
  return { blocks: textBlocks(await ocr(canvas, onProgress, 'Finding text in the image')), title: '' };
}

/* ---------- PDF ---------- */
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}
function pageLines(items) {
  const lines = [];
  let cur = null;
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.str) continue;
    const t = item.transform, x = t[4], y = t[5], h = Math.hypot(t[2], t[3]) || item.height || 10;
    if (!item.str.trim() && !cur) continue;
    if (cur && Math.abs(y - cur.y) < Math.max(cur.h, h) * 0.55 && x > cur.right - cur.h * 2) {
      if (x - cur.right > h * 0.18 && !cur.text.endsWith(' ') && !item.str.startsWith(' ')) cur.text += ' ';
      cur.text += item.str;
      cur.right = x + (item.width || 0);
      cur.h = Math.max(cur.h, item.str.trim() ? h : 0);
    } else {
      if (cur) lines.push(cur);
      cur = { text: item.str, x, y, h, right: x + (item.width || 0) };
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => ({ ...l, text: clean(l.text) })).filter((l) => l.text);
}
const repeatKey = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
function linesToBlocks(lines, bodySize, page) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) { const g = lines[i - 1].y - lines[i].y; if (g > 0) gaps.push(g); }
  const lineGap = median(gaps) || bodySize * 1.2;
  const widest = Math.max(...lines.map((l) => l.right - l.x), 1);
  const blocks = [];
  let para = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], prev = lines[i - 1];
    const heading = l.h >= bodySize * 1.18 && l.text.length < 130 && /\p{L}/u.test(l.text);
    const bullet = /^([•·▪◦‣–-]|\d+[.)])\s/.test(l.text);
    const kind = heading ? (l.h >= bodySize * 1.5 ? 'h1' : l.h >= bodySize * 1.3 ? 'h2' : 'h3') : bullet ? 'li' : 'p';
    const gap = prev ? prev.y - l.y : 0;
    const startsNew = !para || para.kind !== kind && !(para.kind === 'li' && kind === 'p') || heading && gap > l.h * 1.8 || bullet
      || gap > lineGap * 1.45 || gap < -lineGap || Math.abs(prev.h - l.h) > bodySize * 0.2
      || (/[.!?:"”)]$/.test(prev.text) && prev.right - prev.x < widest * 0.72)
      || (kind === 'p' && l.x - prev.x > bodySize * 1.2 && /[.!?:"”)]$/.test(prev.text));
    if (startsNew) {
      para = { kind, text: kind === 'li' ? l.text.replace(/^[•·▪◦‣–-]\s+/, '') : l.text, page };
      blocks.push(para);
    } else if (/\p{L}-$/u.test(para.text) && /^\p{Ll}/u.test(l.text)) para.text = para.text.slice(0, -1) + l.text;
    else para.text += ` ${l.text}`;
  }
  return blocks;
}
async function pdf(file, onProgress) {
  await loadScript(`${PDF_LIB}pdf.min.js`);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = blobWorker(`${PDF_LIB}pdf.worker.min.js`);
  const task = lib.getDocument({ data: await file.arrayBuffer(), cMapUrl: `${PDF_LIB}cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDF_LIB}standard_fonts/`, isEvalSupported: false });
  task.onPassword = (submit, reason) => {
    const value = window.prompt(reason === lib.PasswordResponses.INCORRECT_PASSWORD ? 'That password was wrong. Try again:' : 'This PDF is protected. Enter its password:');
    if (value === null) task.destroy(); else submit(value);
  };
  let doc;
  try { doc = await task.promise; }
  catch (e) {
    if (e?.name === 'PasswordException' || /destroy/i.test(e?.message || '')) throw new Error('This PDF needs a password to open.');
    throw new Error('This PDF could not be opened. It may be damaged.');
  }
  const pages = [];
  const count = {};
  for (let n = 1; n <= doc.numPages; n++) {
    onProgress(`Reading page ${n} of ${doc.numPages}`, n / doc.numPages);
    const page = await doc.getPage(n);
    const lines = pageLines((await page.getTextContent()).items);
    pages.push({ lines, chars: lines.reduce((a, l) => a + l.text.length, 0) });
    const edges = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map((l) => repeatKey(l.text)));
    edges.forEach((k) => { count[k] = (count[k] || 0) + 1; });
    page.cleanup();
  }
  const threshold = Math.max(3, doc.numPages * 0.5);
  const sizes = [];
  for (const p of pages) for (const l of p.lines) for (let i = 0; i < Math.min(l.text.length, 40); i += 4) sizes.push(l.h);
  const bodySize = median(sizes) || 11;
  for (const p of pages) {
    const edge = p.lines.length;
    p.lines = p.lines.filter((l, i) => {
      const atEdge = i < 2 || i >= edge - 2;
      // Large type repeating on every page is a heading such as "Section 3", not a running header.
      return !(atEdge && l.h < bodySize * 1.18 && (count[repeatKey(l.text)] >= threshold || /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?$/i.test(l.text)));
    });
  }
  const blocks = [];
  for (let n = 0; n < pages.length; n++) {
    const p = pages[n];
    let pageBlocks;
    if (p.chars < 25) {
      const label = `Scanned page: finding text on page ${n + 1} of ${pages.length}`;
      onProgress(label, 0);
      const page = await doc.getPage(n + 1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport }).promise;
      pageBlocks = textBlocks(await ocr(canvas, onProgress, label)).map((b) => ({ ...b, page: n + 1 }));
      canvas.width = canvas.height = 0;
      page.cleanup();
    } else pageBlocks = linesToBlocks(p.lines, bodySize, n + 1);
    // A paragraph running over a page break stays in one piece.
    const last = blocks[blocks.length - 1], first = pageBlocks[0];
    if (last?.kind === 'p' && first?.kind === 'p' && !/[.!?:"”)]$/.test(last.text) && /^\p{Ll}/u.test(first.text)) {
      last.text = /\p{L}-$/u.test(last.text) ? last.text.slice(0, -1) + first.text : `${last.text} ${first.text}`;
      pageBlocks.shift();
    }
    blocks.push(...pageBlocks);
  }
  let title = '';
  try { title = clean((await doc.getMetadata()).info?.Title || ''); } catch { /* the file name is used instead */ }
  doc.destroy();
  return { blocks, title: /^(untitled|microsoft word|document\d*)/i.test(title) ? '' : title };
}

/* ---------- entry point ---------- */
const FORMATS = { pdf: 'PDF', docx: 'Word', odt: 'OpenDocument', pptx: 'PowerPoint', epub: 'EPUB', xlsx: 'Excel', rtf: 'RTF', md: 'Markdown', markdown: 'Markdown', html: 'Web page', htm: 'Web page', xhtml: 'Web page', csv: 'CSV', tsv: 'TSV', json: 'JSON', xml: 'XML', yaml: 'YAML', yml: 'YAML', srt: 'Subtitles', vtt: 'Subtitles', txt: 'Text', text: 'Text', log: 'Log' };
const LEGACY = { doc: 'Word', xls: 'Excel', ppt: 'PowerPoint' };

export async function extract(file, onProgress = () => {}) {
  if (file.size > MAX_FILE) throw new Error('This file is over 300 MB, which is more than a browser can open comfortably.');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  if (LEGACY[ext]) throw new Error(`Old .${ext} files aren't supported. Open it in ${LEGACY[ext]} or Google Docs and save it as .${ext}x first.`);
  onProgress('Opening your document', null);
  let result;
  if (file.type.startsWith('image/') || /^(png|jpe?g|webp|gif|bmp)$/.test(ext)) return finish(baseName, 'Image', (await image(file, onProgress)).blocks);
  if (ext === 'pdf') result = await pdf(file, onProgress);
  else if (ext === 'docx') result = await docx(file);
  else if (ext === 'odt') result = await odt(file);
  else if (ext === 'pptx') result = await pptx(file);
  else if (ext === 'epub') result = await epub(file);
  else if (ext === 'xlsx') result = await xlsx(file);
  else {
    const text = decode(await file.arrayBuffer());
    if (ext === 'rtf') result = { blocks: textBlocks(rtfText(text)) };
    else if (ext === 'md' || ext === 'markdown') result = { blocks: markdownBlocks(text) };
    else if (ext === 'html' || ext === 'htm' || ext === 'xhtml') result = htmlBlocks(text);
    else if (ext === 'csv') result = { blocks: delimitedBlocks(text, ',') };
    else if (ext === 'tsv') result = { blocks: delimitedBlocks(text, '\t') };
    else if (ext === 'srt' || ext === 'vtt') result = { blocks: subtitleBlocks(text) };
    else if (/\0/.test(text.slice(0, 4096))) throw new Error(`.${ext || 'This'} files aren't supported. Try PDF, Word, EPUB, PowerPoint, Excel, text or an image.`);
    else result = { blocks: textBlocks(text) };
  }
  return finish(result.title || baseName, FORMATS[ext] || 'Text', result.blocks);
}
export const fromText = (text, title = 'Pasted text') => finish(title, 'Text', textBlocks(text));
