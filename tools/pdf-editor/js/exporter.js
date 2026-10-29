'use strict';
/* Folio PDF Editor — exporters (PDF, flattened PDF, split, DOCX, PNG/JPEG/WEBP, HTML, Markdown, TXT, project) */

const FORMATS = [
  { id: 'pdf', label: 'PDF', ext: 'pdf', tag: 'Edited', desc: 'Your edits on the original PDF. Text stays selectable, forms keep working.', opts: ['flatten', 'annots'] },
  { id: 'pdf-image', label: 'Flattened PDF', ext: 'pdf', tag: 'Secure', desc: 'Every page becomes an image. Permanently burns in redactions and shrinks scans.', opts: ['dpi', 'quality', 'annots'] },
  { id: 'split', label: 'Split PDFs', ext: 'zip', tag: 'One per page', desc: 'Each selected page saved as its own PDF, bundled in a .zip.', opts: ['flatten', 'annots'] },
  { id: 'docx', label: 'Word', ext: 'docx', tag: '.docx', desc: 'Editable text with headings, or exact page images inside a Word file.', opts: ['mode', 'dpi', 'annots'] },
  { id: 'png', label: 'PNG', ext: 'png', tag: 'Lossless', desc: 'Crisp page images. Best for text and line art.', opts: ['dpi', 'annots', 'zip'] },
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', tag: 'Small', desc: 'Compact page images for photos and sharing.', opts: ['dpi', 'quality', 'annots', 'zip'] },
  { id: 'webp', label: 'WebP', ext: 'webp', tag: 'Web', desc: 'Modern, very small images for websites.', opts: ['dpi', 'quality', 'annots', 'zip'] },
  { id: 'html', label: 'HTML', ext: 'html', tag: 'Web page', desc: 'A single self-contained web page — reflowed text or page images.', opts: ['mode', 'dpi', 'annots'] },
  { id: 'md', label: 'Markdown', ext: 'md', tag: '.md', desc: 'Plain text with # headings — great for notes, wikis and AI tools.', opts: [] },
  { id: 'txt', label: 'Plain text', ext: 'txt', tag: '.txt', desc: 'Just the words, in reading order.', opts: [] },
  { id: 'project', label: 'Folio project', ext: 'folio.json', tag: 'Re-editable', desc: 'Saves the original files plus every edit so you can reopen and keep editing later.', opts: [], noRange: true },
];

const Exporter = (() => {
  const { PDFDocument, StandardFonts, degrees, rgb, LineCapStyle, BlendMode, PDFHexString, PDFString,
    PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } = PDFLib;
  const col = (hex) => rgb(...hexToRgb01(hex));
  const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer());
  const MAX_PX = 60e6;

  function safeScale(p, s) {
    const [w, h] = dims(p, s); let k = 1;
    if (w * h > MAX_PX) k = Math.sqrt(MAX_PX / (w * h));
    k = Math.min(k, 16000 / Math.max(w, h));
    return s * Math.min(1, k);
  }

  /* ---------------------------------------------------------- forms */
  const formChanges = (src) => Object.keys(S.formValues).filter((k) => k.startsWith(src.id + '::'));
  function applyForms(doc, src, flatten, warnings) {
    const keys = formChanges(src);
    if (!keys.length && !flatten) return;
    let form; try { form = doc.getForm(); } catch { return; }
    for (const k of keys) {
      const name = k.slice(String(src.id).length + 2); const val = S.formValues[k];
      const f = form.getFieldMaybe(name); if (!f) continue;
      try {
        if (f instanceof PDFTextField) f.setText(val == null ? '' : String(val));
        else if (f instanceof PDFCheckBox) (val ? f.check() : f.uncheck());
        else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { if (val == null || val === '') f.clear(); else f.select(Array.isArray(val) ? val : String(val)); }
        else if (f instanceof PDFRadioGroup) { if (val) f.select(String(val)); else f.clear(); }
      } catch (e) { warnings.add(`Couldn't set form field “${name}”: ${e.message}`); }
    }
    if (flatten) {
      try { form.flatten(); } catch (e) {
        try { form.updateFieldAppearances(); } catch { /* ignore */ }
        warnings.add('Some form fields could not be flattened (unsupported characters or fonts).');
      }
    }
  }

  async function loadLib(src, flatten, warnings) {
    try {
      const d = await PDFDocument.load(src.bytes, { updateMetadata: false });
      applyForms(d, src, flatten, warnings);
      return d;
    } catch (e) {
      warnings.add(/encrypt/i.test(e.message)
        ? `“${src.name}” is encrypted, so its pages were rasterized in the output.`
        : `“${src.name}” couldn't be parsed for editing (${e.message}); its pages were rasterized.`);
      return null;
    }
  }

  /* ---------------------------------------------------- annotations */
  function safeText(font, s, warnings) {
    try { font.encodeText(s); return s; } catch {
      warnings.add('Some characters aren’t supported by the built-in PDF fonts and were replaced with “?”. Load a .ttf font (Style → + Font) for full Unicode text.');
      return [...s].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
    }
  }
  async function getFont(doc, o, cache) {
    if (STD_FONTS[o.font] || !S.assets[o.font]) {
      const fam = STD_FONTS[o.font] ? o.font : 'Helvetica';
      const name = STD_FONTS[fam].pdf[(o.bold ? 1 : 0) + (o.italic ? 2 : 0)];
      if (!cache.fonts.has(name)) cache.fonts.set(name, await doc.embedFont(StandardFonts[name]));
      return cache.fonts.get(name);
    }
    if (!cache.fonts.has(o.font)) {
      if (!cache.fk) { doc.registerFontkit(window.fontkit); cache.fk = true; }
      cache.fonts.set(o.font, await doc.embedFont(b64ToBytes(S.assets[o.font].b64), { subset: false }));
    }
    return cache.fonts.get(o.font);
  }
  async function getImage(doc, assetId, cache) {
    if (cache.imgs.has(assetId)) return cache.imgs.get(assetId);
    const a = S.assets[assetId]; const [head, data] = a.dataUrl.split(',');
    const bytes = b64ToBytes(data);
    const img = /jpe?g/i.test(head) ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    cache.imgs.set(assetId, img); return img;
  }
  function smoothPath(pts) {
    if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]} L${pts[0][0] + 0.01} ${pts[0][1]}`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    const L = pts[pts.length - 1]; return d + ` L${L[0]} ${L[1]}`;
  }

  async function drawAnnots(doc, pg, p, view, cache, warnings) {
    const X = (u) => view[0] + u, Y = (v) => view[3] - v;
    for (const o of allObjs(p)) {
      const op = o.opacity ?? 1;
      switch (o.type) {
        case 'rect': case 'ellipse': {
          const opt = { opacity: op, borderOpacity: op };
          if (o.fill) opt.color = col(o.fill);
          if (o.sw > 0 && o.color) { opt.borderColor = col(o.color); opt.borderWidth = o.sw; }
          if (!opt.color && !opt.borderColor) break;
          if (o.type === 'rect') pg.drawRectangle({ ...opt, x: X(o.x), y: Y(o.y + o.h), width: o.w, height: o.h });
          else pg.drawEllipse({ ...opt, x: X(o.x + o.w / 2), y: Y(o.y + o.h / 2), xScale: o.w / 2, yScale: o.h / 2 });
          break;
        }
        case 'line': case 'arrow': {
          const end = o.type === 'arrow' ? arrowGeom(o).end : [o.x2, o.y2];
          pg.drawLine({ start: { x: X(o.x1), y: Y(o.y1) }, end: { x: X(end[0]), y: Y(end[1]) }, thickness: o.sw, color: col(o.color), opacity: op, lineCap: LineCapStyle.Round });
          if (o.type === 'arrow') {
            const g = arrowGeom(o);
            pg.drawSvgPath(`M${g.tip[0]} ${g.tip[1]} L${g.a[0]} ${g.a[1]} L${g.b[0]} ${g.b[1]} Z`, { x: view[0], y: view[3], color: col(o.color), opacity: op });
          }
          break;
        }
        case 'path': {
          pg.drawSvgPath(smoothPath(o.pts), { x: view[0], y: view[3], borderColor: col(o.color), borderWidth: o.sw, borderOpacity: op, borderLineCap: LineCapStyle.Round, blendMode: o.hl ? BlendMode.Multiply : undefined });
          break;
        }
        case 'text': {
          const font = await getFont(doc, o, cache);
          String(o.text || '').split('\n').forEach((line, i) => {
            if (!line) return;
            const [u, v] = l2p(o, 0, i * o.size * LH + o.size * ASC);
            pg.drawText(safeText(font, line, warnings), { x: X(u), y: Y(v), size: o.size, font, color: col(o.color), opacity: op, rotate: degrees(o.rot || 0) });
          });
          break;
        }
        case 'image': {
          if (!S.assets[o.asset]) break;
          const img = await getImage(doc, o.asset, cache);
          const [u, v] = l2p(o, 0, o.h);
          pg.drawImage(img, { x: X(u), y: Y(v), width: o.w, height: o.h, rotate: degrees(o.rot || 0), opacity: op });
          break;
        }
        case 'note': {
          const px = X(o.x), py = Y(o.y);
          const dict = doc.context.obj({
            Type: 'Annot', Subtype: 'Text', Rect: [px, py - 20, px + 20, py],
            Contents: PDFHexString.fromText(o.text || ''), T: PDFHexString.fromText(S.doc.author || 'Folio'),
            Name: 'Comment', C: hexToRgb01(o.color || '#facc15'), F: 4, Open: false, M: PDFString.fromDate(new Date()),
          });
          pg.node.addAnnot(doc.context.register(dict));
          break;
        }
      }
    }
  }

  function setMeta(doc) {
    const m = S.doc;
    if (m.title) doc.setTitle(m.title);
    if (m.author) doc.setAuthor(m.author);
    if (m.subject) doc.setSubject(m.subject);
    if (m.keywords) doc.setKeywords(m.keywords.split(',').map((k) => k.trim()).filter(Boolean));
    doc.setProducer('Folio PDF Editor'); doc.setCreator('Folio PDF Editor'); doc.setModificationDate(new Date());
  }

  /* ---------------------------------------------------------- PDF */
  async function buildPdf(pages, { flatten = false, annots = true, onProgress } = {}, warnings = new Set()) {
    if (annots) await ensureImagesLoaded();
    let out = null; let outPages = []; let views = [];
    const first = pages[0];
    const identity = first && first.src != null && pages.every((p, i) => p.src === first.src && (i === 0 || p.idx > pages[i - 1].idx));
    if (identity) {
      const d = await loadLib(srcById(first.src), flatten, warnings);
      if (d) {
        const keep = new Set(pages.map((p) => p.idx));
        for (let i = d.getPageCount() - 1; i >= 0; i--) if (!keep.has(i)) d.removePage(i);
        out = d; outPages = d.getPages(); views = pages.map((p) => p.view);
      }
    }
    if (!out) {
      out = await PDFDocument.create();
      const slots = new Array(pages.length); const bySrc = new Map();
      pages.forEach((p, i) => { if (p.src != null) { if (!bySrc.has(p.src)) bySrc.set(p.src, []); bySrc.get(p.src).push(i); } });
      for (const [sid, list] of bySrc) {
        const src = srcById(sid);
        const d = await loadLib(src, flatten || formChanges(src).length > 0, warnings);
        if (!d) continue;
        let remaining = list;
        while (remaining.length) {   // duplicates need separate copies
          const seen = new Set(), round = [], rest = [];
          for (const i of remaining) { const ix = pages[i].idx; if (seen.has(ix)) rest.push(i); else { seen.add(ix); round.push(i); } }
          const copied = await out.copyPages(d, round.map((i) => pages[i].idx));
          round.forEach((i, k) => { slots[i] = copied[k]; });
          remaining = rest;
        }
      }
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i]; let pg = slots[i]; let view = p.view;
        if (pg) out.addPage(pg);
        else if (p.src == null) { pg = out.addPage([p.W, p.H]); view = [0, 0, p.W, p.H]; }
        else {
          const cv = await renderPageCanvas(p, safeScale(p, 2.5), { annots: false, intent: 'print', rotation: 0 });
          const jpg = await out.embedJpg(await blobBytes(await canvasBlob(cv, 'image/jpeg', 0.92)));
          pg = out.addPage([p.W, p.H]); pg.drawImage(jpg, { x: 0, y: 0, width: p.W, height: p.H }); view = [0, 0, p.W, p.H];
        }
        outPages.push(pg); views.push(view);
        onProgress && onProgress(0.5 * (i + 1) / pages.length);
      }
    }
    const cache = { fonts: new Map(), imgs: new Map(), fk: false };
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i], pg = outPages[i];
      if (annots) await drawAnnots(out, pg, p, views[i], cache, warnings);
      pg.setRotation(degrees(rotOf(p)));
      onProgress && onProgress(0.5 + 0.5 * (i + 1) / pages.length);
    }
    setMeta(out);
    return out;
  }

  async function buildImagePdf(pages, { dpi, quality, annots, onProgress }) {
    if (annots) await ensureImagesLoaded();
    const out = await PDFDocument.create();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const cv = await renderPageCanvas(p, safeScale(p, dpi / 72), { annots, intent: 'print' });
      const jpg = await out.embedJpg(await blobBytes(await canvasBlob(cv, 'image/jpeg', quality)));
      const [w, h] = dims(p, 1);
      out.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
      cv.width = cv.height = 0;
      onProgress && onProgress((i + 1) / pages.length);
    }
    setMeta(out);
    return out.save();
  }

  async function saveSafe(doc, warnings) {
    try { return await doc.save(); } catch (e) {
      warnings.add('Form field appearances could not be regenerated (' + e.message + '); values are kept but may only show in some viewers.');
      return doc.save({ updateFieldAppearances: false });
    }
  }

  /* ------------------------------------------------------ runner */
  async function run(fmt, pages, o, progress) {
    const warnings = new Set(); const base = baseName(o.name);
    const prog = (f, label) => progress && progress(f, label);
    const files = []; // {name, blob}
    switch (fmt) {
      case 'pdf': {
        const doc = await buildPdf(pages, { flatten: o.flatten, annots: o.annots, onProgress: (f) => prog(f * 0.95, 'Building PDF…') }, warnings);
        files.push({ name: base + '.pdf', blob: new Blob([await saveSafe(doc, warnings)], { type: 'application/pdf' }) });
        break;
      }
      case 'pdf-image': {
        const bytes = await buildImagePdf(pages, { dpi: o.dpi, quality: o.quality, annots: o.annots, onProgress: (f) => prog(f, 'Rendering pages…') });
        files.push({ name: base + '.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) });
        break;
      }
      case 'split': {
        const full = await buildPdf(pages, { flatten: o.flatten, annots: o.annots, onProgress: (f) => prog(f * 0.5, 'Building pages…') }, warnings);
        const n = full.getPageCount(); const pad = String(n).length;
        for (let i = 0; i < n; i++) {
          const d = await PDFDocument.create(); const [cp] = await d.copyPages(full, [i]); d.addPage(cp); setMeta(d);
          files.push({ name: `${base}-page-${String(i + 1).padStart(pad, '0')}.pdf`, blob: new Blob([await d.save()], { type: 'application/pdf' }) });
          prog(0.5 + 0.5 * (i + 1) / n, 'Splitting…');
        }
        o.zip = true;
        break;
      }
      case 'png': case 'jpeg': case 'webp': {
        if (o.annots) await ensureImagesLoaded();
        const mime = 'image/' + fmt; const ext = fmt === 'jpeg' ? 'jpg' : fmt; const pad = String(pages.length).length;
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i]; const cv = await renderPageCanvas(p, safeScale(p, o.dpi / 72), { annots: o.annots, intent: 'print' });
          const blob = await canvasBlob(cv, mime, fmt === 'png' ? undefined : o.quality); cv.width = cv.height = 0;
          const n = S.pages.indexOf(p) + 1;
          files.push({ name: pages.length === 1 ? `${base}.${ext}` : `${base}-page-${String(n).padStart(pad, '0')}.${ext}`, blob });
          prog((i + 1) / pages.length, 'Rendering pages…');
        }
        break;
      }
      case 'docx': {
        let blocks = [];
        if (o.mode === 'images') {
          if (o.annots) await ensureImagesLoaded();
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i]; const cv = await renderPageCanvas(p, safeScale(p, o.dpi / 72), { annots: o.annots, intent: 'print' });
            const bytes = await blobBytes(await canvasBlob(cv, 'image/jpeg', 0.9));
            if (i) blocks.push({ type: 'pagebreak' });
            blocks.push({ type: 'image', ext: 'jpeg', bytes, wPx: cv.width, hPx: cv.height }); cv.width = cv.height = 0;
            prog(0.9 * (i + 1) / pages.length, 'Rendering pages…');
          }
        } else {
          const doc = await documentBlocks(pages, (f) => prog(f * 0.9, 'Extracting text…'));
          doc.forEach((pg, i) => { if (i) blocks.push({ type: 'pagebreak' }); blocks.push(...pg.blocks); });
          if (!doc.some((d) => d.blocks.length)) warnings.add('No selectable text was found — this looks like a scanned PDF. Try “Page images” layout instead.');
        }
        files.push({ name: base + '.docx', blob: await DocxWriter.build(blocks, S.doc, { imageMode: o.mode === 'images' }) });
        break;
      }
      case 'html': {
        const title = escHtml(S.doc.title || base);
        let body = '';
        if (o.mode === 'images') {
          if (o.annots) await ensureImagesLoaded();
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i]; const cv = await renderPageCanvas(p, safeScale(p, o.dpi / 72), { annots: o.annots, intent: 'print' });
            const url = await blobToDataUrl(await canvasBlob(cv, 'image/jpeg', 0.88)); const [w, h] = dims(p, 1);
            body += `<figure class="page" id="page-${i + 1}"><img src="${url}" width="${Math.round(w * BASE)}" height="${Math.round(h * BASE)}" alt="Page ${i + 1}" loading="lazy"><figcaption>${i + 1}</figcaption></figure>\n`;
            cv.width = cv.height = 0; prog((i + 1) / pages.length, 'Rendering pages…');
          }
        } else {
          const doc = await documentBlocks(pages, (f) => prog(f, 'Extracting text…'));
          body = doc.map((pg) => `<section class="page" id="page-${pg.page}">\n${pg.blocks.map((b) => `<${b.type}>${escHtml(b.text).replace(/\t/g, ' &emsp; ')}</${b.type}>`).join('\n')}\n</section>`).join('\n<hr>\n');
        }
        const css = o.mode === 'images'
          ? 'body{margin:0;background:#525659;font:13px system-ui,sans-serif}main{display:flex;flex-direction:column;align-items:center;gap:20px;padding:24px 12px}figure{margin:0;text-align:center;color:#ddd}img{max-width:100%;height:auto;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.4)}'
          : 'body{max-width:46rem;margin:3rem auto;padding:0 1.25rem;font:17px/1.65 Georgia,"Times New Roman",serif;color:#1f1f1f;background:#fff}h1,h2{font-family:system-ui,sans-serif;line-height:1.25}h1{font-size:1.9rem}h2{font-size:1.35rem}hr{border:0;border-top:1px solid #e5e5e5;margin:2.5rem 0}@media(prefers-color-scheme:dark){body{background:#161616;color:#e8e8e8}hr{border-color:#333}}';
        const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${title}</title>\n${S.doc.author ? `<meta name="author" content="${escHtml(S.doc.author)}">\n` : ''}<meta name="generator" content="Folio PDF Editor">\n<style>${css}</style>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`;
        files.push({ name: base + '.html', blob: new Blob([html], { type: 'text/html' }) });
        break;
      }
      case 'md': case 'txt': {
        const doc = await documentBlocks(pages, (f) => prog(f, 'Extracting text…'));
        let text;
        if (fmt === 'md') {
          const esc = (s) => s.replace(/^([#>*+\-]|\d+\.)\s/, '\\$1 ').replace(/\t/g, '    ');
          text = (S.doc.title ? `# ${S.doc.title}\n\n` : '') + doc.map((pg) => `<!-- page ${pg.page} -->\n\n` + pg.blocks.map((b) => (b.type === 'h1' ? '# ' : b.type === 'h2' ? '## ' : '') + (b.type === 'p' ? esc(b.text) : b.text)).join('\n\n')).join('\n\n---\n\n') + '\n';
        } else {
          text = doc.map((pg) => pg.blocks.map((b) => b.text).join('\n\n')).join('\n\n\n') + '\n';
        }
        if (!doc.some((d) => d.blocks.length)) warnings.add('No selectable text was found — this looks like a scanned PDF.');
        files.push({ name: `${base}.${fmt}`, blob: new Blob([text], { type: fmt === 'md' ? 'text/markdown' : 'text/plain' }) });
        break;
      }
      case 'project': {
        prog(0.3, 'Packing project…');
        const assets = {};
        for (const [k, a] of Object.entries(S.assets)) { const { _loaded, ...rest } = a; assets[k] = rest; }
        const data = {
          app: 'folio-pdf-editor', version: 1, savedAt: new Date().toISOString(), fileName: S.fileName,
          doc: S.doc, formValues: S.formValues, pages: S.pages, assets,
          sources: S.sources.map((s) => ({ id: s.id, name: s.name, b64: bytesToB64(s.bytes) })),
        };
        files.push({ name: base + '.folio.json', blob: new Blob([JSON.stringify(data)], { type: 'application/json' }) });
        break;
      }
      default: throw new Error('Unknown format ' + fmt);
    }

    prog(1, 'Saving…');
    if (files.length > 1 && o.zip) {
      const zip = new JSZip(); files.forEach((f) => zip.file(f.name, f.blob));
      const z = await zip.generateAsync({ type: 'blob', compression: fmt === 'split' ? 'DEFLATE' : 'STORE' });
      download(z, `${base}${fmt === 'split' ? '-split' : '-' + fmt}.zip`);
    } else {
      for (const f of files) { download(f.blob, f.name); if (files.length > 1) await new Promise((r) => setTimeout(r, 250)); }
    }
    return { warnings: [...warnings], count: files.length };
  }

  return { run, buildPdf };
})();
