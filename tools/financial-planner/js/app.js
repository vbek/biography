/* Financial Planner — app shell: start-up, unlock screen, navigation, global search, notifications and sample data. */
(() => {
  'use strict';
  const { $, $$, esc, icon, store: S, domain: D, today, addDays, addMonths, toast } = FP;
  const st = S.state;

  const NAV = [
    ['dashboard', 'Dashboard', 'home'], ['transactions', 'Money', 'swap'], ['scan', 'Scan receipt', 'scan'], ['calendar', 'Calendar', 'cal'],
    ['tasks', 'To-do', 'check'], ['grocery', 'Groceries', 'cart'], ['people', 'People', 'people'], ['budget', 'Budgets & goals', 'target'],
    ['recurring', 'Recurring', 'repeat'], ['reports', 'Reports', 'chart'], ['settings', 'Settings', 'gear'],
  ];
  const TABS = ['dashboard', 'transactions', 'calendar', 'grocery'];
  let route = 'dashboard', param = '';

  function renderShell() {
    const link = ([id, label, ic]) => `<a href="#${id}" class="${route === id ? 'on' : ''}"${route === id ? ' aria-current="page"' : ''}>${icon(ic)}<span>${esc(label)}</span></a>`;
    $('#nav').innerHTML = NAV.map(link).join('');
    $('#tabs').innerHTML = TABS.map((id) => link(NAV.find((n) => n[0] === id))).join('')
      + `<button data-act="openMore" class="${TABS.includes(route) ? '' : 'on'}">${icon('more')}<span>More</span></button>`;
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    $('#btnTheme').innerHTML = icon(dark ? 'sun' : 'moon');
    const unread = st.notifications.filter((n) => !n.read).length;
    $('#btnBell').innerHTML = icon('bell') + (unread ? `<span class="badge">${unread > 9 ? '9+' : unread}</span>` : '');
    $('#btnBell').setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
    const warn = [];
    if (S.memoryOnly) warn.push('<div class="alert bad">This browser is blocking storage (often a private window), so nothing will be kept after you close this tab.</div>');
    $('#alerts').innerHTML = warn.join('');
  }
  function render() {
    renderShell();
    const view = FP.views[route] || FP.views.dashboard;
    const el = $('#view');
    const y = window.scrollY;
    try {
      view(el, param);
    } catch (e) {
      console.error(e);
      el.innerHTML = `<div class="alert bad">This screen hit a problem: ${esc(e.message)}. Your data is safe. Try reloading the page.</div>`;
    }
    window.scrollTo(0, y);
  }
  let queued = false;
  // a dialog can be open while data changes; the screen behind it just catches up
  FP.scheduleRender = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); } };
  FP.render = render;
  FP.go = (hash) => { if (location.hash === `#${hash}`) render(); else location.hash = hash; };
  function onRoute() {
    const [r, p] = location.hash.slice(1).split('/');
    route = NAV.some((n) => n[0] === r) ? r : 'dashboard';
    param = decodeURIComponent(p || '');
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- click routing: the security policy forbids inline handlers, so everything goes through data-act ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = FP.actions[el.dataset.act];
    if (!fn) return;
    Promise.resolve(fn(el.dataset, el, e)).catch((err) => { console.error(err); toast(err?.message || 'Something went wrong.', 'bad'); });
  });
  const A = FP.actions;
  A.toggleTheme = () => {
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    if (dark) document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch {}
    render();
  };
  A.openMore = () => {
    const d = FP.openDialog(`<div class="modal-head"><h2>Menu</h2><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
      <div class="more-grid">${NAV.map(([id, label, ic]) => `<a href="#${id}" data-x>${icon(ic)}<span>${esc(label)}</span></a>`).join('')}<a href="../index.html">${icon('back')}<span>All tools</span></a></div>`);
    $$('[data-x]', d).forEach((x) => x.addEventListener('click', () => d.close()));
  };
  A.quickAdd = () => {
    const opts = [['txAddExpense', 'Expense', 'swap'], ['txAddIncome', 'Income', 'plus'], ['goScan', 'Scan receipt', 'scan'], ['taskAdd', 'Task', 'check'], ['eventAdd', 'Event', 'cal'], ['loanAdd', 'Lend or borrow', 'people']];
    const d = FP.openDialog(`<div class="modal-head"><h2>Add</h2><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
      <div class="more-grid">${opts.map(([a, l, ic]) => `<button data-act="${a}" data-x>${icon(ic)}<span>${esc(l)}</span></button>`).join('')}</div>`, 'narrow');
    $$('[data-x]', d).forEach((x) => x.addEventListener('click', () => d.close()));
  };
  A.goScan = () => FP.go('scan');

  /* ---------- global search ---------- */
  const box = $('#globalSearch'), results = $('#searchResults');
  function runSearch() {
    const q = box.value;
    if (q.trim().length < 2) { results.hidden = true; return; }
    const rows = D.search(q), groups = new Map();
    for (const r of rows) { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push(r); }
    results.innerHTML = rows.length ? [...groups].map(([g, list]) => `<h4>${esc(g)} <small>${list.length}</small></h4>${list.slice(0, 6).map((r) => {
      const i = rows.indexOf(r);
      return `<button data-act="searchPick" data-i="${i}"><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></button>`;
    }).join('')}`).join('') : `<p class="muted pad">Nothing matches "${esc(q)}".</p>`;
    results.hidden = false;
    A.searchPick = ({ i }) => {
      const r = rows[Number(i)];
      results.hidden = true;
      box.value = '';
      FP.go(r.route);
      if (r.act) A[r.act]({ id: r.id });
    };
  }
  box.addEventListener('input', runSearch);
  box.addEventListener('focus', runSearch);
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { results.hidden = true; box.blur(); } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) results.hidden = true; });

  /* ---------- reminders: a static site can't push to a closed browser, so they fire while open, and missed ones on the next visit ---------- */
  async function notifySystem(title, body) {
    if (!st.settings.notifyOn || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg) await reg.showNotification(title, { body, icon: 'icon.svg', tag: title });
      else new Notification(title, { body, icon: 'icon.svg' });
    } catch {}
  }
  function checkReminders() {
    const due = D.dueReminders();
    if (!due.length) return;
    const fired = { ...st.settings.fired };
    for (const r of due) {
      fired[r.key] = Date.now();
      S.add('notifications', { title: r.title, body: r.body, link: r.link, at: Date.now(), read: false });
      notifySystem(r.title, r.body);
    }
    // old entries can't fire again, because reminders only look back a week
    const cutoff = Date.now() - 40 * 86400000;
    for (const k of Object.keys(fired)) if (fired[k] < cutoff) delete fired[k];
    S.setSetting('fired', fired);
    if (st.notifications.length > 60) st.notifications = st.notifications.slice(-60);
    toast(due.length === 1 ? `${due[0].title}: ${due[0].body}` : `${due.length} new reminders. Open the bell to see them.`, 'info', 6000);
  }
  FP.checkReminders = checkReminders;
  A.openBell = () => {
    const rows = st.notifications.slice().sort((a, b) => b.at - a.at);
    const d = FP.openDialog(`<div class="modal-head"><h2>Notifications</h2><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${rows.length ? `<ul class="rows">${rows.map((n) => `<li class="${n.read ? '' : 'unread'}"><a class="row-link" href="#${esc(n.link || 'dashboard')}" data-x><b>${esc(n.title)}</b><small>${esc(n.body)} · ${esc(new Date(n.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</small></a></li>`).join('')}</ul>` : FP.emptyState('bell', 'No notifications', 'Reminders for events, tasks, payments and loans will appear here.')}
      ${st.settings.notifyOn ? '' : '<p class="muted small">To get alerts outside this tab, turn on notifications in Settings.</p>'}</div>
      <div class="modal-foot"><span class="grow"></span>${rows.length ? '<button class="btn" data-clear>Clear all</button>' : ''}<button class="btn primary" data-x>Close</button></div>`);
    $$('[data-x]', d).forEach((x) => x.addEventListener('click', () => d.close()));
    const clear = $('[data-clear]', d);
    if (clear) clear.onclick = () => { st.notifications = []; S.touch('notifications'); d.close(); };
    st.notifications.forEach((n) => { n.read = true; });
    S.touch('notifications');
  };

  /* ---------- sample data, so a visitor can see every screen with something in it ---------- */
  FP.loadSample = () => {
    const now = today(), cat = (type, name) => D.catByName(type, name)?.id;
    const txn = (type, c, amount, date, desc) => { if (date <= now) S.add('transactions', { type, amount, date, desc, categoryId: cat(type, c), sample: true }); };
    const ITEMS = [['Milk', 1, 349], ['Eggs', 1, 429], ['Bread', 1, 279], ['Bananas', 2, 129], ['Rice', 1, 899], ['Chicken breast', 1, 1149], ['Coffee', 1, 1099]];
    for (let m = 5; m >= 0; m--) {
      const first = FP.monthStart(addMonths(now, -m));
      txn('income', 'Salary', 420000, addDays(first, 0), 'Monthly salary');
      if (m % 2 === 0) txn('income', 'Freelance', 65000 + m * 4000, addDays(first, 13), 'Website project');
      txn('expense', 'Housing', 130000, addDays(first, 1), 'Rent');
      txn('expense', 'Utilities', 12400 + m * 650, addDays(first, 8), 'Electricity and water');
      txn('expense', 'Subscriptions', 1599, addDays(first, 4), 'Streaming service');
      txn('expense', 'Transport', 8200 + m * 500, addDays(first, 11), 'Fuel');
      txn('expense', 'Dining out', 5400 + m * 900, addDays(first, 17), 'Dinner with friends');
      for (const wk of [2, 9, 16, 23]) {
        const date = addDays(first, wk);
        if (date > now) continue;
        const bought = ITEMS.filter((_, i) => (i + wk + m) % 3 !== 0);
        const total = bought.reduce((s, it) => s + it[1] * (it[2] + m * -6), 0);
        const t = S.add('transactions', { type: 'expense', amount: total, date, desc: 'Weekly groceries', store: 'Fresh Market', categoryId: cat('expense', 'Groceries'), sample: true });
        for (const it of bought) D.recordPurchase({ name: it[0], qty: it[1], price: it[2] + m * -6, date, store: 'Fresh Market', txnId: t.id });
      }
    }
    S.add('tasks', { title: 'Renew car insurance', priority: 'high', due: addDays(now, 3), category: 'Finance', done: false });
    S.add('tasks', { title: 'Compare phone plans', priority: 'medium', due: addDays(now, 9), category: 'Finance', done: false });
    S.add('tasks', { title: 'Book dentist appointment', priority: 'low', due: '', category: 'Health', done: false });
    S.add('recurring', { type: 'expense', name: 'Rent', amount: 130000, categoryId: cat('expense', 'Housing'), freq: 'monthly', start: FP.monthStart(addMonths(now, 1)), remindDays: 3 });
    S.add('recurring', { type: 'expense', name: 'Streaming service', amount: 1599, categoryId: cat('expense', 'Subscriptions'), freq: 'monthly', start: addDays(now, 5), remindDays: 1 });
    S.add('recurring', { type: 'income', name: 'Salary', amount: 420000, categoryId: cat('income', 'Salary'), freq: 'monthly', start: FP.monthStart(addMonths(now, 1)), remindDays: 0 });
    S.add('budgets', { categoryId: cat('expense', 'Groceries'), amount: 42000, period: 'monthly' });
    S.add('budgets', { categoryId: cat('expense', 'Dining out'), amount: 6000, period: 'monthly' });
    S.add('budgets', { categoryId: null, amount: 300000, period: 'monthly' });
    S.add('goals', { name: 'Emergency fund', target: 1000000, deadline: addMonths(now, 10), contributions: [{ id: FP.uid(), amount: 150000, date: addMonths(now, -4) }, { id: FP.uid(), amount: 180000, date: addMonths(now, -1) }] });
    const sam = S.add('people', { name: 'Sam Rivera', phone: '555-0142', email: '', notes: '' });
    const ana = S.add('people', { name: 'Ana Gupta', phone: '', email: 'ana@example.com', notes: '' });
    S.add('loans', { personId: sam.id, kind: 'lent', amount: 50000, date: addMonths(now, -2), desc: 'Car repair', dueDate: addDays(now, 12), repayments: [{ id: FP.uid(), amount: 20000, date: addMonths(now, -1), note: 'First part' }] });
    S.add('loans', { personId: ana.id, kind: 'borrowed', amount: 30000, date: addDays(now, -20), desc: 'Concert tickets', dueDate: addDays(now, 5), repayments: [] });
    const ev = S.add('events', { title: 'Weekly grocery shop', type: 'grocery', date: addDays(now, 2), time: '10:00', recur: 'weekly', notifyAt: `${addDays(now, 2)}T08:00`, notes: '' });
    D.ensureEventList(ev, ev.date);
    S.add('events', { title: 'Accountant meeting', type: 'appointment', date: addDays(now, 6), time: '14:30', notes: 'Bring last year\'s statements', recur: '' });
    S.setSetting('seeded', true);
  };

  /* ---------- auto-lock: a passcode only protects data while the planner is closed or locked ---------- */
  let lastUse = Date.now();
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true });
  setInterval(async () => {
    if (S.locked && Date.now() - lastUse > 10 * 60000) { await S.flush(); location.reload(); }
  }, 30000);

  /* ---------- start ---------- */
  function showApp() {
    D.seedCategories();
    const posted = D.autoPostRecurring();
    D.ensureUpcomingLists();
    $('#boot').hidden = true;
    $('#app').hidden = false;
    $('#btnMenu').innerHTML = icon('more');
    $('#searchIcon').innerHTML = icon('search');
    $('#fab').innerHTML = icon('plus');
    window.addEventListener('hashchange', onRoute);
    onRoute();
    if (posted) toast(`${posted} scheduled ${posted === 1 ? 'entry was' : 'entries were'} recorded automatically.`, 'info');
    checkReminders();
    setInterval(() => { checkReminders(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });
  }
  function unlockScreen() {
    const boot = $('#boot');
    boot.innerHTML = `<form class="unlock" novalidate>${icon('lock')}<h1>Planner locked</h1><p class="muted">Enter your passcode. Your records are encrypted on this device.</p>
      <input type="password" id="pass" aria-label="Passcode" autocomplete="current-password" autofocus>
      <p class="form-err" role="alert" hidden></p><button class="btn primary">Unlock</button></form>`;
    const form = $('form', boot), err = $('.form-err', boot), btn = $('button', boot);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true; btn.classList.add('loading');
      let ok = false;
      try { ok = await S.unlock($('#pass', boot).value); } catch { ok = false; }
      if (!ok) {
        err.textContent = 'That passcode is not correct.';
        err.hidden = false;
        btn.disabled = false; btn.classList.remove('loading');
        return;
      }
      await S.readAll();
      showApp();
    });
    $('#pass', boot).focus();
  }
  S.onError((e) => toast(e?.name === 'QuotaExceededError' ? 'This device is out of storage, so your latest change was not saved.' : 'Your latest change could not be saved. Please try again.', 'bad', 8000));
  (async () => {
    const { locked } = await S.init();
    if (locked) { unlockScreen(); } else { await S.readAll(); showApp(); }
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  })().catch((e) => {
    console.error(e);
    $('#boot').innerHTML = `<div class="alert bad">The planner could not start: ${esc(e.message)}. Reload the page to try again.</div>`;
  });
  let resizeT = 0, lastW = innerWidth;
  // phones fire resize when the keyboard opens, so only a width change redraws
  window.addEventListener('resize', () => { if (innerWidth === lastW) return; lastW = innerWidth; clearTimeout(resizeT); resizeT = setTimeout(render, 200); });
})();
