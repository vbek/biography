/* Financial Planner — shared helpers: dates, money, escaping, dialogs, forms and toasts.
   Every piece of user text goes through esc() before it reaches innerHTML, including OCR output and restored backups. */
(function () {
  try {
    if (localStorage.getItem('theme') !== 'dark') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();

window.FP = { actions: {}, views: {} };
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  /* ---------- dates: stored as local YYYY-MM-DD, so a record never shifts a day between time zones ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => toISO(new Date());
  const isDate = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && toISO(parse(iso)) === iso;
  const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const addMonths = (iso, n) => {
    const d = parse(iso), day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return toISO(d);
  };
  const monthStart = (iso) => iso.slice(0, 8) + '01';
  const monthEnd = (iso) => addDays(addMonths(monthStart(iso), 1), -1);
  const weekStart = (iso) => addDays(iso, -((parse(iso).getDay() + 6) % 7));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const fmtDate = (iso, opts) => (isDate(iso) ? parse(iso).toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtDay = (iso) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtMonth = (iso) => fmtDate(iso, { month: 'long', year: 'numeric' });
  const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };
  const relDay = (iso) => {
    const n = daysBetween(today(), iso);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    if (n < 0) return `${-n} days ago`;
    return n < 7 ? parse(iso).toLocaleDateString(undefined, { weekday: 'long' }) : fmtDate(iso, { day: 'numeric', month: 'short' });
  };

  /* ---------- money: always whole cents, so totals never pick up floating-point errors ---------- */
  function toCents(input) {
    let s = String(input ?? '').trim().replace(/[^\d.,-]/g, '');
    if (!/\d/.test(s)) return NaN;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      s = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    } else if (lastComma >= 0) {
      s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }
  const centsToInput = (c) => (Number.isFinite(c) ? (c / 100).toFixed(2) : '');
  let currency = 'USD', fmtCache = null;
  const setCurrency = (code) => { currency = code || 'USD'; fmtCache = null; };
  function money(c) {
    fmtCache ||= new Intl.NumberFormat(undefined, { style: 'currency', currency });
    return fmtCache.format((c || 0) / 100);
  }

  /* ---------- icons ---------- */
  const ICONS = {
    home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
    list: 'M4 5h16M4 12h16M4 19h10',
    swap: 'M7 4v15M3 8l4-4 4 4M17 20V5M13 16l4 4 4-4',
    scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16',
    cal: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
    check: 'M4 12l5 5L20 6',
    cart: 'M3 4h3l2.5 12h10L21 8H7M9 21h.01M18 21h.01',
    people: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21c0-4 3-7 7-7s7 3 7 7M17 4a4 4 0 010 7M18 14c2.500.7 4 3.500 4 7',
    target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8z',
    repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
    chart: 'M4 20V4M4 20h16M8 16v-5M13 16V7M18 16v-8',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
    plus: 'M12 5v14M5 12h14',
    search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4-4',
    bell: 'M6 16V10a6 6 0 0112 0v6l2 2H4zM10 21h4',
    sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2',
    moon: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
    edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    back: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    x: 'M6 6l12 12M18 6L6 18',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
    camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 16a3 3 0 100-6 3 3 0 000 6z',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
    alert: 'M12 3L2 20h20zM12 10v5M12 18h.01',
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

  /* ---------- toasts ---------- */
  function toast(message, kind = 'ok', ms = 3600) {
    const host = $('#toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    host.append(el);
    setTimeout(() => el.remove(), ms);
  }

  /* ---------- dialogs ---------- */
  function openDialog(html, cls = '') {
    const d = document.createElement('dialog');
    d.className = `modal ${cls}`;
    d.innerHTML = html;
    document.body.append(d);
    d.addEventListener('close', () => d.remove());
    // a click on the backdrop lands on the dialog element itself
    d.addEventListener('mousedown', (e) => { if (e.target === d && !d.dataset.busy) d.close(); });
    d.addEventListener('cancel', (e) => { if (d.dataset.busy) e.preventDefault(); });
    d.showModal();
    return d;
  }
  function confirmDialog(message, { title = 'Are you sure?', yes = 'Delete', danger = true } = {}) {
    return new Promise((resolve) => {
      const d = openDialog(`<div class="modal-head"><h2>${esc(title)}</h2></div>
        <p class="modal-text">${esc(message)}</p>
        <div class="modal-foot"><button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(yes)}</button></div>`, 'narrow');
      let answer = false;
      $('[data-no]', d).onclick = () => d.close();
      $('[data-yes]', d).onclick = () => { answer = true; d.close(); };
      d.addEventListener('close', () => resolve(answer));
      $('[data-no]', d).focus();
    });
  }

  /* ---------- forms: every add/edit screen is described as a list of fields ---------- */
  function fieldHTML(f, value) {
    const id = `f_${f.name}_${uid().slice(0, 6)}`, v = value ?? f.value ?? '', req = f.required ? ' <b aria-hidden="true">*</b>' : '';
    let input;
    if (f.type === 'select') {
      input = `<select id="${id}" name="${esc(f.name)}">${(f.options || []).map(([val, label]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" name="${esc(f.name)}" rows="2" maxlength="${f.max || 2000}">${esc(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<label class="field check ${f.full ? 'full' : ''}" data-field="${esc(f.name)}"><input id="${id}" type="checkbox" name="${esc(f.name)}"${v ? ' checked' : ''}><span>${esc(f.label)}</span></label>`;
    } else if (f.type === 'money') {
      input = `<input id="${id}" name="${esc(f.name)}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(typeof v === 'number' ? centsToInput(v) : v)}">`;
    } else {
      const list = f.list ? ` list="${id}_l"` : '';
      input = `<input id="${id}" type="${esc(f.type || 'text')}" name="${esc(f.name)}" value="${esc(v)}"${list} maxlength="${f.type && f.type !== 'text' ? 524288 : f.max || 200}"${f.min !== undefined ? ` min="${esc(f.min)}"` : ''}${f.step ? ` step="${esc(f.step)}"` : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''} autocomplete="off">`
        + (f.list ? `<datalist id="${id}_l">${f.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
    }
    return `<div class="field ${f.full ? 'full' : ''}" data-field="${esc(f.name)}"><label for="${id}">${esc(f.label)}${req}</label>${input}${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}<small class="err" role="alert"></small></div>`;
  }
  function readForm(form, fields) {
    const out = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (!el) continue;
      if (f.type === 'checkbox') out[f.name] = el.checked;
      else if (f.type === 'money') out[f.name] = el.value.trim() ? toCents(el.value) : null;
      else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
      else out[f.name] = el.value.trim();
    }
    return out;
  }
  function validateField(f, v, all) {
    if (f.type === 'checkbox') return '';
    if (f.required && (v === '' || v === null || v === undefined)) return `${f.label} is required.`;
    if ((v === '' || v === null) && !f.checkEmpty) return '';
    if (f.type === 'money') {
      if (!Number.isFinite(v)) return 'Enter a valid amount, for example 12.50.';
      if (v < 0 || (v === 0 && !f.allowZero)) return 'Enter an amount above zero.';
      if (v > 1e13) return 'That amount is too large.';
    }
    if (f.type === 'number' && (!Number.isFinite(v) || (f.min !== undefined && v < Number(f.min)))) return `Enter ${f.min !== undefined ? `at least ${f.min}` : 'a number'}.`;
    if (f.type === 'date' && v && !isDate(v)) return 'Enter a valid date.';
    return f.validate ? f.validate(v, all) || '' : '';
  }
  /* onSubmit(values) saves the record. It can throw to show an error, and a loading state covers slow saves. */
  function formDialog({ title, fields, values = {}, submit = 'Save', onSubmit, extra = '', footExtra = '', onOpen, cls = '' }) {
    return new Promise((resolve) => {
      const d = openDialog(`<form novalidate>
        <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body"><div class="form-grid">${fields.map((f) => fieldHTML(f, values[f.name])).join('')}</div>${extra}<p class="form-err" role="alert" hidden></p></div>
        <div class="modal-foot">${footExtra}<span class="grow"></span><button type="button" class="btn" data-x>Cancel</button><button class="btn primary" data-save>${esc(submit)}</button></div>
      </form>`, cls);
      const form = $('form', d);
      let saved = null;
      const sync = () => {
        const v = readForm(form, fields);
        for (const f of fields) if (f.when) { const box = $(`[data-field="${f.name}"]`, form); if (box) box.hidden = !f.when(v); }
      };
      form.addEventListener('change', sync);
      sync();
      $$('[data-x]', d).forEach((b) => { b.onclick = () => d.close(); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readForm(form, fields);
        let firstBad = null;
        for (const f of fields) {
          const box = $(`[data-field="${f.name}"]`, form);
          if (!box || box.hidden) continue;
          const msg = validateField(f, v[f.name], v), err = $('.err', box);
          if (err) err.textContent = msg;
          box.classList.toggle('bad', !!msg);
          if (msg && !firstBad) firstBad = form.elements[f.name];
        }
        if (firstBad) { firstBad.focus(); return; }
        const btn = $('[data-save]', d), note = $('.form-err', d);
        btn.disabled = true; btn.classList.add('loading'); d.dataset.busy = '1'; note.hidden = true;
        try {
          saved = (await onSubmit(v, d)) ?? true;
          delete d.dataset.busy;
          d.close();
        } catch (err) {
          delete d.dataset.busy;
          note.textContent = err?.message || 'That could not be saved. Please try again.';
          note.hidden = false;
          btn.disabled = false; btn.classList.remove('loading');
        }
      });
      d.addEventListener('close', () => resolve(saved));
      onOpen?.(d, form);
      form.querySelector('input:not([type=hidden]),select,textarea')?.focus();
    });
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  // a leading = + - or @ would run as a formula when the file is opened in a spreadsheet
  const csvCell = (v) => {
    if (typeof v === 'number') return String(v);
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const emptyState = (ic, title, text, btn = '') => `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${btn}</div>`;

  Object.assign(FP, {
    $, $$, esc, uid, toISO, parse, today, isDate, addDays, addMonths, monthStart, monthEnd, weekStart, daysBetween,
    fmtDate, fmtDay, fmtMonth, fmtTime, relDay, toCents, centsToInput, setCurrency, money, icon, toast,
    openDialog, confirmDialog, formDialog, download, toCSV, emptyState,
  });
})();
