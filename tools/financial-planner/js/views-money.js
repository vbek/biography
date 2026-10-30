/* Financial Planner — dashboard, transactions and the receipt scanner. */
(() => {
  'use strict';
  const { $, $$, esc, icon, money, store: S, domain: D, today, addDays, addMonths, monthStart, monthEnd, fmtDate, fmtDay, relDay, toast, charts: C } = FP;
  const st = S.state, A = FP.actions, V = FP.views;

  const catOptions = (type) => [...D.catsOf(type).map((c) => [c.id, c.name]), ['__new', '+ New category…']];
  // choosing "+ New category" in any form asks for a name, then selects it
  async function wireNewCategory(form, name, type) {
    const sel = form.elements[name];
    if (!sel) return;
    let prev = sel.value;
    sel.addEventListener('change', async () => {
      if (sel.value !== '__new') { prev = sel.value; return; }
      sel.value = prev;
      await FP.formDialog({
        title: `New ${type} category`, cls: 'narrow', submit: 'Add',
        fields: [{ name: 'name', label: 'Name', required: true, max: 40, full: true, validate: (v) => (D.catByName(type, v) ? 'That category already exists.' : '') }],
        onSubmit: (v) => {
          const c = S.add('categories', { type, name: v.name, color: `hsl(${Math.floor(Math.random() * 360)} 65% 50%)` });
          sel.insertBefore(new Option(c.name, c.id), sel.lastElementChild);
          sel.value = prev = c.id;
        },
      });
    });
  }
  FP.wireNewCategory = wireNewCategory;
  FP.catOptions = catOptions;

  /* ---------- dashboard ---------- */
  const stat = (label, value, cls, sub) => `<div class="stat ${cls}"><span>${esc(label)}</span><b>${esc(money(value))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  V.dashboard = (el) => {
    const now = today(), mFrom = monthStart(now), mTo = monthEnd(now), all = D.totals(), m = D.totals(mFrom, mTo), loans = D.loanTotals();
    const empty = !st.transactions.length && !st.tasks.length && !st.events.length && !st.loans.length;
    const warnings = D.budgetWarnings();
    const up = D.agenda(now, addDays(now, 14)).filter((r) => r.kind !== 'task' && r.kind !== 'bill' && r.kind !== 'income' && r.kind !== 'loan').slice(0, 6);
    const pay = D.upcomingRecurring(30).slice(0, 6);
    const dueLoans = st.loans.filter((l) => l.dueDate && D.outstanding(l)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4);
    const tasks = st.tasks.filter((t) => !t.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 6);
    const from6 = monthStart(addMonths(now, -5)), rows = D.summary(from6, mTo, 'month');
    el.innerHTML = `<div class="page-head"><h1>Dashboard</h1><p class="muted">${esc(FP.fmtMonth(now))}</p></div>
      ${empty ? `<div class="welcome card"><h2>Welcome to your planner</h2><p>Everything you enter stays on this device. There's no account, and nothing is uploaded. Start by adding an expense, or explore with sample data.</p><div class="btn-row"><button class="btn primary" data-act="txAddExpense">Add first expense</button><button class="btn" data-act="sampleLoad">Load sample data</button></div></div>` : ''}
      ${warnings.map(({ b, s }) => `<a class="alert ${s.level === 'over' ? 'bad' : 'warn'}" href="#budget">${icon('alert')}<span><b>${esc(D.budgetName(b))}</b>: ${s.level === 'over' ? `over budget by ${esc(money(-s.left))}` : `${Math.round(s.pct * 100)}% of budget used, ${esc(money(s.left))} left`}</span></a>`).join('')}
      <section class="stats" aria-label="Totals">
        ${stat('Available balance', D.balanceAt(), 'accent', 'Cash after savings and loans')}
        ${stat('Total income', all.income, 'good', `${money(m.income)} this month`)}
        ${stat('Total expenses', all.expense, 'bad', `${money(m.expense)} this month`)}
        ${stat('Savings', D.totalSavings(), 'violet', `${st.goals.length} goal${st.goals.length === 1 ? '' : 's'}`)}
        ${stat('You are owed', loans.lent, '', 'Outstanding lent')}
        ${stat('You owe', loans.borrowed, '', 'Outstanding borrowed')}
      </section>
      <section class="quick" aria-label="Quick actions">
        <button class="btn" data-act="txAddExpense">${icon('plus')}Expense</button><button class="btn" data-act="txAddIncome">${icon('plus')}Income</button>
        <a class="btn" href="#scan">${icon('scan')}Scan receipt</a><button class="btn" data-act="taskAdd">${icon('check')}Task</button>
        <button class="btn" data-act="eventAdd">${icon('cal')}Event</button><button class="btn" data-act="loanAdd">${icon('people')}Lend / borrow</button>
      </section>
      <div class="grid-2">
        <section class="card"><h2>Income vs expenses</h2><div id="dChart" class="chart"></div></section>
        <section class="card"><h2>This month's spending</h2><div id="dDonut" class="chart"></div></section>
        <section class="card"><div class="card-head"><h2>Upcoming events</h2><a href="#calendar">Calendar</a></div>
          ${up.length ? `<ul class="rows">${up.map((r) => `<li><a class="row-link" href="#calendar/${r.date}"><b>${esc(r.title)}</b><small>${esc(relDay(r.date))}${r.time ? ` · ${esc(FP.fmtTime(r.time))}` : ''} · ${esc(r.sub)}</small></a></li>`).join('')}</ul>` : '<p class="muted">Nothing in the next two weeks.</p>'}</section>
        <section class="card"><div class="card-head"><h2>Pending payments</h2><a href="#recurring">Recurring</a></div>
          ${pay.length || dueLoans.length ? `<ul class="rows">${pay.map(({ r, date, overdue }) => `<li class="row"><div><b>${esc(r.name)}</b><small class="${overdue ? 'text-bad' : ''}">${overdue ? 'Overdue · ' : ''}${esc(relDay(date))}</small></div><b class="${r.type === 'income' ? 'text-good' : ''}">${r.type === 'income' ? '+' : ''}${esc(money(r.amount))}</b></li>`).join('')}
            ${dueLoans.map((l) => `<li class="row"><div><a href="#people/${esc(l.personId)}"><b>${l.kind === 'lent' ? `${esc(S.get('people', l.personId)?.name)} owes you` : `Repay ${esc(S.get('people', l.personId)?.name)}`}</b></a><small class="${D.loanStatus(l) === 'overdue' ? 'text-bad' : ''}">${esc(relDay(l.dueDate))}</small></div><b>${esc(money(D.outstanding(l)))}</b></li>`).join('')}</ul>` : '<p class="muted">No payments due in the next 30 days.</p>'}</section>
        <section class="card"><div class="card-head"><h2>To-do</h2><a href="#tasks">All tasks</a></div>
          ${tasks.length ? `<ul class="rows">${tasks.map((t) => `<li class="row"><label class="task-check"><input type="checkbox" data-act="taskToggle" data-id="${esc(t.id)}"><span><b>${esc(t.title)}</b><small class="${t.due && t.due < now ? 'text-bad' : ''}">${t.due ? esc(relDay(t.due)) : 'No due date'}</small></span></label><span class="pill ${esc(t.priority)}">${esc(t.priority)}</span></li>`).join('')}</ul>` : '<p class="muted">All clear.</p>'}</section>
        <section class="card"><div class="card-head"><h2>Recent activity</h2><a href="#transactions">History</a></div>
          ${txRows(st.transactions.slice().sort(byDate).slice(0, 6)) || '<p class="muted">No transactions yet.</p>'}</section>
      </div>`;
    C.bars($('#dChart', el), { labels: rows.map((r) => r.label), series: [{ name: 'Income', color: '#22c55e', values: rows.map((r) => r.income) }, { name: 'Expenses', color: '#f43f5e', values: rows.map((r) => r.expense) }] });
    C.donut($('#dDonut', el), { rows: D.spendByCategory(mFrom, mTo), act: 'txByCategory' });
  };
  A.sampleLoad = () => { FP.loadSample(); toast('Sample data added. You can erase it in Settings.'); };

  /* ---------- transactions ---------- */
  const byDate = (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
  function txRows(rows) {
    if (!rows.length) return '';
    return `<ul class="rows">${rows.map((t) => `<li class="row tx"><i class="dot" style="background:${esc(D.catColor(t.categoryId))}"></i>
      <button class="row-main" data-act="txEdit" data-id="${esc(t.id)}"><b>${esc(t.desc || D.catName(t.categoryId))}</b><small>${esc(fmtDate(t.date))} · ${esc(D.catName(t.categoryId))}${t.receiptId ? ' · Receipt' : ''}</small></button>
      <b class="${t.type === 'income' ? 'text-good' : ''}">${t.type === 'income' ? '+' : '-'}${esc(money(t.amount))}</b></li>`).join('')}</ul>`;
  }
  const filters = { q: '', type: '', cat: '', from: '', to: '' };
  function filtered() {
    const q = filters.q.trim().toLowerCase();
    return st.transactions.filter((t) => (!filters.type || t.type === filters.type) && (!filters.cat || t.categoryId === filters.cat)
      && D.inRange(t.date, filters.from, filters.to)
      && (!q || `${t.desc} ${t.notes || ''} ${t.store || ''} ${D.catName(t.categoryId)}`.toLowerCase().includes(q))).sort(byDate);
  }
  let txLimit = 60;
  function drawTxList(el) {
    const rows = filtered(), sum = rows.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    $('#txSummary', el).textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} · Net ${money(sum)}`;
    $('#txList', el).innerHTML = rows.length
      ? txRows(rows.slice(0, txLimit)) + (rows.length > txLimit ? `<button class="btn wide" data-act="txMore">Show more</button>` : '')
      : FP.emptyState('swap', st.transactions.length ? 'No matches' : 'No transactions yet', st.transactions.length ? 'Try different filters.' : 'Add an expense or income to get started.');
  }
  V.transactions = (el) => {
    const cats = st.categories.slice().sort((a, b) => a.name.localeCompare(b.name));
    el.innerHTML = `<div class="page-head"><h1>Money</h1><div class="btn-row"><button class="btn" data-act="txAddIncome">${icon('plus')}Income</button><button class="btn primary" data-act="txAddExpense">${icon('plus')}Expense</button></div></div>
      <section class="card filters">
        <input id="fQ" type="search" placeholder="Search descriptions" aria-label="Search transactions" value="${esc(filters.q)}">
        <select id="fType" aria-label="Type"><option value="">Income and expenses</option><option value="expense"${filters.type === 'expense' ? ' selected' : ''}>Expenses</option><option value="income"${filters.type === 'income' ? ' selected' : ''}>Income</option></select>
        <select id="fCat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c.id)}"${filters.cat === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <label class="inline">From <input id="fFrom" type="date" value="${esc(filters.from)}"></label>
        <label class="inline">To <input id="fTo" type="date" value="${esc(filters.to)}"></label>
        <button class="btn subtle" data-act="txClear">Clear</button>
      </section>
      <section class="card"><p class="muted small" id="txSummary"></p><div id="txList"></div></section>`;
    const bind = (id, key, ev) => $(id, el).addEventListener(ev, (e) => { filters[key] = e.target.value; txLimit = 60; drawTxList(el); });
    bind('#fQ', 'q', 'input'); bind('#fType', 'type', 'change'); bind('#fCat', 'cat', 'change'); bind('#fFrom', 'from', 'change'); bind('#fTo', 'to', 'change');
    drawTxList(el);
  };
  A.txMore = () => { txLimit += 60; drawTxList($('#view')); };
  A.txClear = () => { Object.assign(filters, { q: '', type: '', cat: '', from: '', to: '' }); FP.render(); };
  A.txByCategory = ({ id }) => { Object.assign(filters, { q: '', type: '', cat: id, from: monthStart(today()), to: monthEnd(today()) }); FP.go('transactions'); };

  function budgetCheck(t, before) {
    if (t.type !== 'expense') return;
    for (const b of D.activeBudgets()) {
      if (b.categoryId && b.categoryId !== t.categoryId) continue;
      const [from, to] = D.budgetWindow(b);
      if (!D.inRange(t.date, from, to)) continue;
      const s = D.budgetStatus(b), was = before.get(b.id);
      if (s.level !== 'ok' && s.level !== was) toast(s.level === 'over' ? `${D.budgetName(b)} is over budget by ${money(-s.left)}.` : `${D.budgetName(b)} has reached ${Math.round(s.pct * 100)}% of its budget.`, s.level === 'over' ? 'bad' : 'warn', 6000);
    }
  }
  const budgetLevels = () => new Map(D.activeBudgets().map((b) => [b.id, D.budgetStatus(b).level]));
  FP.budgetLevels = budgetLevels;
  FP.budgetCheck = budgetCheck;

  async function txForm(type, t = null, preset = {}) {
    const v = t || preset;
    const events = st.events.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
    let receiptUrl = null;
    const fields = [
      { name: 'amount', label: 'Amount', type: 'money', required: true },
      { name: 'date', label: 'Date', type: 'date', required: true, value: today() },
      { name: 'desc', label: type === 'income' ? 'Source or description' : 'Description', required: true, max: 120, full: true },
      { name: 'categoryId', label: 'Category', type: 'select', options: catOptions(type), value: v.categoryId || D.catsOf(type)[0]?.id },
      { name: 'eventId', label: 'Calendar event', type: 'select', options: [['', 'None'], ...events.map((e) => [e.id, `${e.title} (${fmtDate(e.date)})`])] },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ];
    const extra = t?.receiptId ? `<div class="receipt-view"><h3>Receipt</h3><div data-receipt class="muted small">Loading image…</div>${t.items?.length ? `<table class="mini"><thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead><tbody>${t.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.qty)}</td><td>${esc(money(i.total))}</td></tr>`).join('')}${Number.isInteger(t.tax) ? `<tr><td>Tax</td><td></td><td>${esc(money(t.tax))}</td></tr>` : ''}</tbody></table>` : ''}</div>` : '';
    await FP.formDialog({
      title: t ? `Edit ${type}` : `Add ${type}`, fields, values: v, extra,
      footExtra: t ? `<button type="button" class="btn danger-text" data-del>Delete</button>` : '',
      onOpen: async (d, form) => {
        wireNewCategory(form, 'categoryId', type);
        const del = $('[data-del]', d);
        if (del) del.onclick = async () => {
          if (!await FP.confirmDialog(`Delete "${t.desc || 'this transaction'}" for ${money(t.amount)}?${t.receiptId ? ' Its receipt image will be deleted too.' : ''}`)) return;
          await D.deleteTransaction(t.id);
          d.close();
          toast('Transaction deleted.');
        };
        if (t?.receiptId) {
          const box = $('[data-receipt]', d);
          try {
            const blob = await S.getReceipt(t.receiptId);
            if (!blob) { box.textContent = 'The image is no longer available.'; return; }
            receiptUrl = URL.createObjectURL(blob);
            box.innerHTML = `<a href="${receiptUrl}" target="_blank" rel="noopener"><img src="${receiptUrl}" alt="Receipt photo"></a>`;
          } catch { box.textContent = 'The image could not be loaded.'; }
        }
        d.addEventListener('close', () => { if (receiptUrl) URL.revokeObjectURL(receiptUrl); });
      },
      onSubmit: (vals) => {
        const patch = { ...vals, eventId: vals.eventId || null };
        if (t) { S.update('transactions', t.id, patch); toast('Saved.'); return; }
        const before = budgetLevels();
        const rec = S.add('transactions', { type, ...patch, ...(preset.listId ? { listId: preset.listId } : {}) });
        toast(`${type === 'income' ? 'Income' : 'Expense'} added.`);
        budgetCheck(rec, before);
      },
    });
  }
  FP.txForm = txForm;
  A.txAddExpense = (d = {}) => txForm('expense', null, d.eventId ? { eventId: d.eventId, desc: d.desc, date: d.date } : {});
  A.txAddIncome = () => txForm('income');
  A.txEdit = ({ id }) => { const t = S.get('transactions', id); if (t) return txForm(t.type, t); };

  /* ---------- receipt scanner ---------- */
  let worker = null, workerIdle = 0;
  const OCR_BASE = new URL('vendor/tesseract/', location.href).href;
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('The text reader could not load. Check your connection and try again.'));
      document.head.append(s);
    });
  }
  async function getWorker(progress) {
    clearTimeout(workerIdle);
    if (worker) return worker;
    await loadScript('vendor/tesseract/tesseract.min.js');
    worker = await window.Tesseract.createWorker('eng', 1, {
      workerPath: `${OCR_BASE}worker.min.js`, corePath: OCR_BASE, langPath: OCR_BASE, workerBlobURL: false,
      // keeps the language file off-origin caches: it ships with the site
      cacheMethod: 'none',
      logger: (m) => { if (m.status) progress(m.status, m.progress); },
    });
    return worker;
  }
  const STAGES = { 'loading tesseract core': 'Loading the text reader', 'initializing tesseract': 'Starting the text reader', 'loading language traineddata': 'Loading language data', 'initializing api': 'Getting ready', 'recognizing text': 'Reading your receipt' };
  // drawn to a canvas to size it, which also strips camera metadata such as location before anything is stored
  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That image could not be opened. Try a JPEG or PNG. Some phones save HEIC photos, which this browser may not read.')); i.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function toCanvas(img, maxSide) {
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function forOcr(img) {
    const c = toCanvas(img, 2200), x = c.getContext('2d'), data = x.getImageData(0, 0, c.width, c.height), p = data.data;
    // greyscale with a contrast stretch: receipts are low-contrast and often shadowed
    let lo = 255, hi = 0;
    for (let i = 0; i < p.length; i += 4) { const g = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11; p[i] = g; if (g < lo) lo = g; if (g > hi) hi = g; }
    const k = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < p.length; i += 4) { const g = (p[i] - lo) * k; p[i] = p[i + 1] = p[i + 2] = g; }
    x.putImageData(data, 0, 0);
    return c;
  }
  const canvasBlob = (c, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('The image could not be processed.'))), 'image/jpeg', q));

  let scanListId = null;
  V.scan = (el, param) => {
    scanListId = param || null;
    const list = scanListId && S.get('groceryLists', scanListId);
    const recent = st.transactions.filter((t) => t.receiptId).sort(byDate).slice(0, 8);
    el.innerHTML = `<div class="page-head"><h1>Scan a receipt</h1></div>
      ${list ? `<div class="alert info">This receipt will finish your list "${esc(list.name)}" and update its prices.</div>` : ''}
      <section class="card scan-box">
        <p>Take a photo of a receipt or bill, or upload one. The store, date, items, tax and total are read <b>on this device</b>, and you can correct everything before saving.</p>
        <div class="btn-row">
          <label class="btn primary file-btn">${icon('camera')}Take photo<input id="scanCam" type="file" accept="image/*" capture="environment"></label>
          <label class="btn file-btn">${icon('upload')}Upload image<input id="scanFile" type="file" accept="image/*"></label>
          <button class="btn subtle" data-act="scanManual">Enter without a photo</button>
        </div>
        <div id="scanProgress" class="progress" hidden><div class="bar"><i></i></div><p role="status" class="muted small"></p></div>
        <p class="muted small">Tips: lay the receipt flat in good light and fill the frame. The first scan loads about 7 MB of reading tools from this site.</p>
      </section>
      <section class="card"><h2>Recent receipts</h2>${txRows(recent) || '<p class="muted">Receipts you save will appear here.</p>'}</section>`;
    for (const id of ['#scanCam', '#scanFile']) $(id, el).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) runScan(f); });
  };
  async function runScan(file) {
    if (!file.type.startsWith('image/')) return toast('Please choose an image file.', 'bad');
    if (file.size > 25 * 1048576) return toast('That image is over 25 MB. Please use a smaller one.', 'bad');
    const box = $('#scanProgress'), bar = $('i', box), msg = $('p', box);
    const progress = (status, p) => { msg.textContent = `${STAGES[status] || 'Working'}…`; bar.style.width = `${Math.round((status === 'recognizing text' ? p : (p || 0) * 0.1) * 100)}%`; };
    box.hidden = false;
    $$('.scan-box input').forEach((i) => { i.disabled = true; });
    progress('loading tesseract core', 0);
    let img, parsed = null, failure = '';
    try {
      img = await loadImage(file);
      const w = await getWorker(progress);
      const { data } = await w.recognize(forOcr(img));
      parsed = D.parseReceipt(data.text);
      parsed.raw = data.text;
      // the reader holds a lot of memory, so it is released if another scan doesn't follow soon
      workerIdle = setTimeout(() => { worker?.terminate(); worker = null; }, 120000);
    } catch (e) {
      console.error(e);
      if (!img) { toast(e.message, 'bad', 7000); finishScanUi(); return; }
      worker = null;
      failure = 'The text could not be read automatically, so please fill in the details below.';
    }
    finishScanUi();
    const receipt = await canvasBlob(toCanvas(img, 1600), 0.8).catch(() => null);
    if (parsed && !parsed.items.length && parsed.total === null) failure = 'No prices were found in this photo. Fill in the details below, or try a sharper photo.';
    reviewReceipt(parsed || { store: '', date: null, items: [], tax: null, total: null }, receipt, failure);
  }
  function finishScanUi() {
    const box = $('#scanProgress');
    if (box) box.hidden = true;
    $$('.scan-box input').forEach((i) => { i.disabled = false; });
  }
  A.scanManual = () => reviewReceipt({ store: '', date: null, items: [], tax: null, total: null }, null, '');

  function itemRow(it) {
    return `<tr data-row="${esc(it.id)}"><td><input aria-label="Item name" data-k="name" value="${esc(it.name)}" maxlength="80"></td>
      <td class="num"><input aria-label="Quantity" data-k="qty" inputmode="decimal" value="${esc(it.qty)}"></td>
      <td class="num"><input aria-label="Line price" data-k="total" inputmode="decimal" value="${esc(FP.centsToInput(it.total))}"></td>
      <td><button type="button" class="icon-btn" data-rm aria-label="Remove item">${icon('x')}</button></td></tr>`;
  }
  function reviewReceipt(p, receiptBlob, warning) {
    const list = scanListId && S.get('groceryLists', scanListId);
    const previewUrl = receiptBlob ? URL.createObjectURL(receiptBlob) : null;
    const defaultCat = D.groceryCat().id;
    const fields = [
      { name: 'store', label: 'Store', required: true, max: 80, value: p.store },
      { name: 'date', label: 'Purchase date', type: 'date', required: true, value: p.date || today(), hint: p.date ? '' : 'No date was found, so today is filled in.' },
      { name: 'categoryId', label: 'Category', type: 'select', options: catOptions('expense'), value: defaultCat },
      { name: 'tax', label: 'Tax', type: 'money', allowZero: true, value: p.tax },
      { name: 'total', label: 'Total', type: 'money', required: true, value: p.total },
      { name: 'remember', label: 'Remember items and prices for grocery planning', type: 'checkbox', value: true, full: true },
    ];
    const extra = `${previewUrl ? `<details class="receipt-peek"><summary>View photo</summary><img src="${previewUrl}" alt="Your receipt"></details>` : ''}
      <h3>Items</h3><div class="table-wrap"><table class="edit-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th></th></tr></thead><tbody data-items>${p.items.map(itemRow).join('')}</tbody></table></div>
      <button type="button" class="btn subtle" data-add-item>${icon('plus')}Add item</button>
      <p class="check-sum small" data-sum></p>`;
    const readItems = (d) => $$('[data-row]', d).map((r) => ({
      id: r.dataset.row, name: $('[data-k=name]', r).value.trim(), qty: Number($('[data-k=qty]', r).value) || 1, total: FP.toCents($('[data-k=total]', r).value),
    }));
    FP.formDialog({
      title: 'Check the details', cls: 'wide', submit: 'Save expense', fields, extra,
      onOpen: (d, form) => {
        wireNewCategory(form, 'categoryId', 'expense');
        if (warning) $('.modal-body', d).insertAdjacentHTML('afterbegin', `<div class="alert warn">${esc(warning)}</div>`);
        else $('.modal-body', d).insertAdjacentHTML('afterbegin', '<div class="alert info">Text reading can make mistakes. Please check these against your receipt.</div>');
        const check = () => {
          const items = readItems(d).filter((i) => Number.isFinite(i.total));
          const sum = items.reduce((s, i) => s + i.total, 0) + (FP.toCents(form.elements.tax.value) || 0);
          const total = FP.toCents(form.elements.total.value), el = $('[data-sum]', d);
          if (!items.length || !Number.isFinite(total)) { el.textContent = ''; return; }
          const ok = Math.abs(sum - total) <= 2;
          el.className = `check-sum small ${ok ? 'text-good' : 'text-warn'}`;
          el.textContent = ok ? `Items and tax add up to the total (${money(total)}).` : `Items and tax add up to ${money(sum)}, but the total says ${money(total)}. Check for a misread line.`;
        };
        d.addEventListener('input', check);
        check();
        d.addEventListener('click', (e) => {
          if (e.target.closest('[data-rm]')) { e.target.closest('[data-row]').remove(); check(); }
          if (e.target.closest('[data-add-item]')) { $('[data-items]', d).insertAdjacentHTML('beforeend', itemRow({ id: FP.uid(), name: '', qty: 1, total: NaN })); $('[data-items] tr:last-child input', d).focus(); }
        });
        d.addEventListener('close', () => { if (previewUrl) setTimeout(() => URL.revokeObjectURL(previewUrl), 500); });
      },
      onSubmit: async (v, d) => {
        const items = readItems(d).filter((i) => i.name);
        const bad = items.find((i) => !Number.isFinite(i.total) || i.total < 0);
        if (bad) throw new Error(`Check the price for "${bad.name}".`);
        let receiptId = null;
        if (receiptBlob) {
          try { receiptId = await S.saveReceipt(receiptBlob); } catch { throw new Error('The photo could not be stored. This device may be out of space.'); }
        }
        const before = budgetLevels();
        const t = S.add('transactions', { type: 'expense', amount: v.total, date: v.date, desc: v.store, store: v.store, categoryId: v.categoryId, receiptId, items, tax: v.tax, listId: list?.id || null, eventId: list?.eventId || null });
        if (list) {
          D.finishList(list, { txnId: t.id, date: v.date, store: v.store, receiptItems: v.remember ? items : [] });
        } else if (v.remember) {
          for (const i of items) D.recordPurchase({ name: i.name, qty: i.qty, price: Math.round(i.total / (i.qty || 1)), date: v.date, store: v.store, txnId: t.id });
        }
        toast(list ? 'Shopping finished and expense saved.' : 'Expense saved from receipt.');
        budgetCheck(t, before);
        FP.go(list ? `grocery/${list.id}` : 'transactions');
      },
    });
  }
  FP.txRows = txRows;
})();
