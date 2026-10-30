/* Financial Planner — calculations with no drawing in them: totals, recurrence, budgets, loans, grocery recommendations,
   the receipt text parser and global search. */
(() => {
  'use strict';
  const { store: S, today, addDays, addMonths, monthStart, monthEnd, weekStart, daysBetween, uid } = FP;
  const st = S.state;

  /* ---------- categories ---------- */
  const DEFAULTS = {
    expense: [['Groceries', '#22c55e'], ['Housing', '#6366f1'], ['Utilities', '#0ea5e9'], ['Transport', '#f59e0b'], ['Dining out', '#ef4444'], ['Health', '#14b8a6'], ['Entertainment', '#a855f7'], ['Shopping', '#ec4899'], ['Education', '#3b82f6'], ['Subscriptions', '#8b5cf6'], ['Other', '#64748b']],
    income: [['Salary', '#22c55e'], ['Freelance', '#06b6d4'], ['Business', '#6366f1'], ['Investments', '#f59e0b'], ['Gifts', '#ec4899'], ['Other income', '#64748b']],
  };
  function seedCategories() {
    if (st.categories.length) return;
    for (const type of ['expense', 'income']) for (const [name, color] of DEFAULTS[type]) S.add('categories', { type, name, color });
  }
  const catsOf = (type) => st.categories.filter((c) => c.type === type).sort((a, b) => a.name.localeCompare(b.name));
  const catName = (id) => S.get('categories', id)?.name || 'Uncategorised';
  const catColor = (id) => S.get('categories', id)?.color || '#64748b';
  const catByName = (type, name) => st.categories.find((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase());
  const groceryCat = () => catByName('expense', 'Groceries') || S.add('categories', { type: 'expense', name: 'Groceries', color: '#22c55e' });

  /* ---------- totals ---------- */
  const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);
  function totals(from, to) {
    let income = 0, expense = 0;
    for (const t of st.transactions) {
      if (!inRange(t.date, from, to)) continue;
      if (t.type === 'income') income += t.amount; else expense += t.amount;
    }
    return { income, expense, net: income - expense };
  }
  const repaid = (l) => (l.repayments || []).reduce((s, r) => s + r.amount, 0);
  const outstanding = (l) => Math.max(0, l.amount - repaid(l));
  const loanStatus = (l) => {
    const left = outstanding(l);
    if (!left) return 'settled';
    if (l.dueDate && l.dueDate < today()) return 'overdue';
    return repaid(l) ? 'partial' : 'open';
  };
  function loanTotals() {
    let lent = 0, borrowed = 0;
    for (const l of st.loans) if (l.kind === 'lent') lent += outstanding(l); else borrowed += outstanding(l);
    return { lent, borrowed };
  }
  function personBalance(id) {
    let lent = 0, borrowed = 0;
    for (const l of st.loans) if (l.personId === id) { if (l.kind === 'lent') lent += outstanding(l); else borrowed += outstanding(l); }
    return { lent, borrowed, net: lent - borrowed };
  }
  const goalSaved = (g) => (g.contributions || []).reduce((s, c) => s + c.amount, 0);
  const totalSavings = () => st.goals.reduce((s, g) => s + goalSaved(g), 0);
  // cash in hand: money set aside in goals has left the balance, and loans move real cash
  function balanceAt(date) {
    let b = st.settings.openingBalance || 0;
    for (const t of st.transactions) if (!date || t.date <= date) b += t.type === 'income' ? t.amount : -t.amount;
    for (const g of st.goals) for (const c of g.contributions || []) if (!date || c.date <= date) b -= c.amount;
    for (const l of st.loans) {
      const sign = l.kind === 'lent' ? -1 : 1;
      if (!date || l.date <= date) b += sign * l.amount;
      for (const r of l.repayments || []) if (!date || r.date <= date) b -= sign * r.amount;
    }
    return b;
  }
  const savingsAt = (date) => st.goals.reduce((s, g) => s + (g.contributions || []).reduce((n, c) => n + (c.date <= date ? c.amount : 0), 0), 0);
  function spendByCategory(from, to, type = 'expense') {
    const map = new Map();
    for (const t of st.transactions) if (t.type === type && inRange(t.date, from, to)) map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
    return [...map.entries()].map(([id, value]) => ({ id, label: catName(id), color: catColor(id), value })).sort((a, b) => b.value - a.value);
  }

  /* ---------- buckets for charts and summaries ---------- */
  const bucketOf = (iso, g) => (g === 'day' ? iso : g === 'week' ? weekStart(iso) : g === 'month' ? iso.slice(0, 7) : iso.slice(0, 4));
  function bucketRange(from, to, g) {
    const out = [];
    let d = g === 'week' ? weekStart(from) : g === 'month' ? monthStart(from) : g === 'year' ? `${from.slice(0, 4)}-01-01` : from;
    while (d <= to && out.length < 800) {
      const last = g === 'day' ? d : g === 'week' ? addDays(d, 6) : g === 'month' ? monthEnd(d) : `${d.slice(0, 4)}-12-31`;
      out.push({ key: bucketOf(d, g), start: d, end: last });
      d = g === 'day' ? addDays(d, 1) : g === 'week' ? addDays(d, 7) : g === 'month' ? addMonths(d, 1) : addMonths(d, 12);
    }
    return out;
  }
  function bucketLabel(b, g) {
    if (g === 'day') return FP.fmtDate(b.start, { day: 'numeric', month: 'short' });
    if (g === 'week') return FP.fmtDate(b.start, { day: 'numeric', month: 'short' });
    if (g === 'month') return FP.fmtDate(b.start, { month: 'short', year: '2-digit' });
    return b.start.slice(0, 4);
  }
  function summary(from, to, g) {
    const rows = bucketRange(from, to, g).map((b) => ({ ...b, label: bucketLabel(b, g), income: 0, expense: 0 }));
    const idx = new Map(rows.map((r) => [r.key, r]));
    for (const t of st.transactions) {
      if (!inRange(t.date, from, to)) continue;
      const r = idx.get(bucketOf(t.date, g));
      if (r) r[t.type === 'income' ? 'income' : 'expense'] += t.amount;
    }
    return rows;
  }

  /* ---------- recurrence ---------- */
  const FREQS = [['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['quarterly', 'Every 3 months'], ['yearly', 'Yearly']];
  const freqLabel = (f) => FREQS.find((x) => x[0] === f)?.[1] || 'Once';
  // worked out from the start date each time, so a monthly date of the 31st doesn't drift after a short month
  function nthDate(start, freq, n) {
    switch (freq) {
      case 'weekly': return addDays(start, 7 * n);
      case 'biweekly': return addDays(start, 14 * n);
      case 'monthly': return addMonths(start, n);
      case 'quarterly': return addMonths(start, 3 * n);
      case 'yearly': return addMonths(start, 12 * n);
      default: return n ? '9999-12-31' : start;
    }
  }
  function occurrences(start, freq, from, to, end) {
    const out = [];
    if (!start) return out;
    let n = 0;
    if (freq === 'weekly' || freq === 'biweekly') {
      const step = freq === 'weekly' ? 7 : 14;
      n = Math.max(0, Math.floor(daysBetween(start, from) / step));
    } else if (freq) {
      const months = { monthly: 1, quarterly: 3, yearly: 12 }[freq] || 1;
      n = Math.max(0, Math.floor(((+from.slice(0, 4) - +start.slice(0, 4)) * 12 + (+from.slice(5, 7) - +start.slice(5, 7))) / months) - 1);
    }
    for (let i = 0; i < 2000; i++, n++) {
      const d = nthDate(start, freq, n);
      if (d > to || (end && d > end)) break;
      if (d >= from) out.push(d);
      if (!freq) break;
    }
    return out;
  }
  // the next unpaid date of a recurring item
  function recurNext(r) {
    const after = r.paidThrough ? addDays(r.paidThrough, 1) : r.start;
    return occurrences(r.start, r.freq, after, '2200-01-01', r.end)[0] || null;
  }
  function postRecurring(r, date, overrideAmount) {
    const t = S.add('transactions', { type: r.type, amount: overrideAmount ?? r.amount, date, desc: r.name, categoryId: r.categoryId, recurringId: r.id });
    S.update('recurring', r.id, { paidThrough: date });
    return t;
  }
  function autoPostRecurring() {
    let posted = 0;
    const now = today();
    for (const r of st.recurring) {
      if (!r.autoPost || r.paused) continue;
      for (let i = 0; i < 120; i++) {
        const next = recurNext(r);
        if (!next || next > now) break;
        postRecurring(r, next);
        posted++;
      }
    }
    return posted;
  }
  function upcomingRecurring(days = 30) {
    const until = addDays(today(), days), rows = [];
    for (const r of st.recurring) {
      if (r.paused) continue;
      const next = recurNext(r);
      if (next && next <= until) rows.push({ r, date: next, overdue: next < today() });
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ---------- budgets ---------- */
  function budgetWindow(b, on = today()) {
    return b.period === 'custom' ? [b.start, b.end] : [monthStart(on), monthEnd(on)];
  }
  function budgetStatus(b) {
    const [from, to] = budgetWindow(b);
    let spent = 0;
    for (const t of st.transactions) if (t.type === 'expense' && inRange(t.date, from, to) && (!b.categoryId || t.categoryId === b.categoryId)) spent += t.amount;
    const pct = b.amount ? spent / b.amount : 0;
    return { from, to, spent, pct, left: b.amount - spent, level: pct > 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok' };
  }
  const activeBudgets = () => st.budgets.filter((b) => b.period !== 'custom' || (b.start <= today() && b.end >= today()));
  const budgetName = (b) => b.name || (b.categoryId ? catName(b.categoryId) : 'All spending');
  function budgetWarnings() {
    return activeBudgets().map((b) => ({ b, s: budgetStatus(b) })).filter((x) => x.s.level !== 'ok').sort((a, b) => b.s.pct - a.s.pct);
  }

  /* ---------- grocery memory ---------- */
  const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const findItem = (name) => { const n = normName(name); return st.groceryItems.find((i) => i.key === n); };
  function rememberItem(name, patch = {}) {
    const key = normName(name);
    if (!key) return null;
    const hit = findItem(name);
    if (hit) { Object.assign(hit, patch); S.touch('groceryItems'); return hit; }
    return S.add('groceryItems', { key, name: name.trim(), qty: 1, unit: '', note: '', history: [], ...patch });
  }
  function recordPurchase({ name, qty, unit, price, date, store, txnId, listId }) {
    const item = rememberItem(name, { qty: qty || 1, ...(unit ? { unit } : {}) });
    if (!item) return null;
    item.history.push({ date, qty: qty || 1, price: price ?? null, store: store || '', txnId: txnId || null, listId: listId || null });
    item.history.sort((a, b) => a.date.localeCompare(b.date));
    S.touch('groceryItems');
    return item;
  }
  function forgetPurchases(txnId) {
    for (const i of st.groceryItems) i.history = i.history.filter((h) => h.txnId !== txnId);
    S.touch('groceryItems');
  }
  const priced = (i) => (i.history || []).filter((h) => Number.isInteger(h.price));
  const lastPrice = (i) => { const p = priced(i); return p.length ? p[p.length - 1].price : null; };
  function priceStats(i) {
    const p = priced(i);
    if (!p.length) return null;
    const vals = p.map((h) => h.price), last = vals[vals.length - 1], prev = vals.length > 1 ? vals[vals.length - 2] : null;
    return { last, prev, avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), min: Math.min(...vals), max: Math.max(...vals), change: prev ? (last - prev) / prev : null, count: vals.length, lastStore: p[p.length - 1].store };
  }
  // an item is recommended when it is due again, judged from how often it has actually been bought
  function recommend(on = today(), limit = 30) {
    const rows = [];
    for (const i of st.groceryItems) {
      const dates = [...new Set((i.history || []).map((h) => h.date))].filter((d) => d <= on);
      if (i.skipRecommend) continue;
      if (!dates.length) { rows.push({ item: i, score: 0.5, reason: 'You added this before' }); continue; }
      const last = dates[dates.length - 1], since = daysBetween(last, on);
      if (dates.length === 1) {
        if (since >= 3 && since <= 90) rows.push({ item: i, score: 0.6, reason: `Bought ${since} days ago` });
        continue;
      }
      const gap = daysBetween(dates[0], last) / (dates.length - 1), ratio = since / Math.max(gap, 1);
      if (ratio >= 0.75) rows.push({ item: i, score: 1 + Math.min(ratio, 3) + dates.length * 0.05, reason: `Usually every ${Math.max(1, Math.round(gap))} days, last ${since} days ago` });
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const listItemFrom = (i, reason) => ({ id: uid(), name: i.name, qty: i.qty || 1, unit: i.unit || '', note: i.note || '', purchased: false, price: lastPrice(i), lastPrice: lastPrice(i), recommended: !!reason, reason: reason || '' });
  function makeList({ name, date = null, eventId = null, templateId = null, withRecommendations = true }) {
    const items = [];
    const seen = new Set();
    const push = (it) => { const k = normName(it.name); if (k && !seen.has(k)) { seen.add(k); items.push(it); } };
    const template = templateId && S.get('groceryLists', templateId);
    if (template) for (const t of template.items) {
      const known = findItem(t.name);
      push({ ...t, id: uid(), purchased: false, price: known ? lastPrice(known) : t.price ?? null, lastPrice: known ? lastPrice(known) : null });
    }
    if (withRecommendations) for (const r of recommend(date || today())) push(listItemFrom(r.item, r.reason));
    return S.add('groceryLists', { name, date, eventId, items, status: 'open', isTemplate: false });
  }
  function ensureEventList(ev, date) {
    const hit = st.groceryLists.find((l) => l.eventId === ev.id && l.date === date);
    return hit || makeList({ name: ev.title, date, eventId: ev.id, templateId: ev.templateId || null });
  }
  // a recurring shopping schedule always has its next list ready
  function ensureUpcomingLists() {
    for (const ev of st.events) {
      if (ev.type !== 'grocery') continue;
      const finished = new Set(st.groceryLists.filter((l) => l.eventId === ev.id && l.status === 'done').map((l) => l.date));
      const next = eventOccurrences(ev, today(), addDays(today(), 400)).find((d) => !finished.has(d));
      if (next) ensureEventList(ev, next);
    }
  }
  const tokens = (s) => normName(s).split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w));
  function nameMatch(a, b) {
    const ta = tokens(a), tb = tokens(b);
    if (!ta.length || !tb.length) return 0;
    let hits = 0;
    // receipts abbreviate, so a shared 3-letter start counts: "ORG MLK" won't match but "BANAN" matches "banana"
    for (const w of ta) if (tb.some((x) => x === w || (w.length >= 3 && x.length >= 3 && (x.startsWith(w) || w.startsWith(x))))) hits++;
    return hits / Math.max(ta.length, tb.length);
  }
  // marks the list as bought and records every price, once, whichever route the shopper took
  function finishList(list, { txnId, date, store, receiptItems = [] }) {
    const free = list.items.slice();
    for (const it of receiptItems) {
      let best = null, bestScore = 0.5;
      for (const li of free) { const s = nameMatch(li.name, it.name); if (s >= bestScore) { bestScore = s; best = li; } }
      const unit = it.qty ? Math.round(it.total / it.qty) : it.total;
      if (best) {
        free.splice(free.indexOf(best), 1);
        best.purchased = true; best.price = unit; best.qty = it.qty || best.qty;
        recordPurchase({ name: best.name, qty: best.qty, unit: best.unit, price: unit, date, store, txnId, listId: list.id });
      } else {
        list.items.push({ id: uid(), name: it.name, qty: it.qty || 1, unit: '', note: '', purchased: true, price: unit, lastPrice: null, recommended: false, reason: '' });
        recordPurchase({ name: it.name, qty: it.qty, price: unit, date, store, txnId, listId: list.id });
      }
    }
    for (const li of free) {
      if (li.purchased) recordPurchase({ name: li.name, qty: li.qty, unit: li.unit, price: li.price, date, store, txnId, listId: list.id });
    }
    S.update('groceryLists', list.id, { items: list.items, status: 'done', txnId, doneOn: date });
    const ev = list.eventId && S.get('events', list.eventId);
    if (ev) ensureUpcomingLists();
  }
  function groceryMonthly(from, to) {
    const cat = catByName('expense', 'Groceries');
    return bucketRange(from, to, 'month').map((b) => ({
      label: bucketLabel(b, 'month'),
      value: cat ? st.transactions.reduce((s, t) => s + (t.type === 'expense' && t.categoryId === cat.id && t.date >= b.start && t.date <= b.end ? t.amount : 0), 0) : 0,
    }));
  }

  /* ---------- removing a transaction everywhere it is referenced ---------- */
  async function deleteTransaction(id) {
    const t = S.get('transactions', id);
    if (!t) return;
    if (t.receiptId && !st.transactions.some((x) => x.id !== id && x.receiptId === t.receiptId)) await S.removeReceipt(t.receiptId).catch(() => {});
    forgetPurchases(id);
    const list = st.groceryLists.find((l) => l.txnId === id);
    if (list) S.update('groceryLists', list.id, { status: 'open', txnId: null });
    S.remove('transactions', id);
  }

  /* ---------- calendar ---------- */
  function eventOccurrences(ev, from, to) {
    return occurrences(ev.date, ev.recur || '', from, to, ev.until).filter((d) => !(ev.skips || []).includes(d));
  }
  const EVENT_TYPES = [['event', 'Event'], ['appointment', 'Appointment'], ['reminder', 'Reminder'], ['bill', 'Bill payment'], ['grocery', 'Grocery shopping'], ['other', 'Other']];
  // one list of everything with a date: events, tasks, recurring money and loan due dates
  function agenda(from, to) {
    const rows = [];
    for (const ev of st.events) {
      for (const d of eventOccurrences(ev, from, to)) rows.push({ kind: ev.type === 'grocery' ? 'grocery' : ev.type === 'bill' ? 'bill' : 'event', date: d, time: ev.allDay ? '' : ev.time || '', title: ev.title, id: ev.id, sub: EVENT_TYPES.find((t) => t[0] === ev.type)?.[1] || 'Event' });
    }
    for (const t of st.tasks) if (t.due && !t.done && inRange(t.due, from, to)) rows.push({ kind: 'task', date: t.due, time: '', title: t.title, id: t.id, sub: 'Task' });
    for (const r of st.recurring) {
      if (r.paused) continue;
      const after = r.paidThrough ? addDays(r.paidThrough, 1) : r.start;
      for (const d of occurrences(r.start, r.freq, from > after ? from : after, to, r.end)) rows.push({ kind: r.type === 'income' ? 'income' : 'bill', date: d, time: '', title: r.name, id: r.id, sub: `${r.type === 'income' ? 'Expected income' : 'Payment'} · ${FP.money(r.amount)}`, recurring: true });
    }
    for (const l of st.loans) {
      if (l.dueDate && outstanding(l) && inRange(l.dueDate, from, to)) {
        const who = S.get('people', l.personId)?.name || 'Someone';
        rows.push({ kind: 'loan', date: l.dueDate, time: '', title: l.kind === 'lent' ? `${who} owes you` : `Repay ${who}`, id: l.personId, sub: FP.money(outstanding(l)) });
      }
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
  }

  /* ---------- reminders: every item whose moment has arrived and hasn't been announced yet ---------- */
  function dueReminders(now = new Date()) {
    const out = [], fired = st.settings.fired || {}, day = FP.toISO(now), from = addDays(day, -7);
    const add = (key, title, body, link) => { if (!fired[key]) out.push({ key, title, body, link }); };
    for (const ev of st.events) {
      if (!ev.notifyAt) continue;
      const lead = new Date(`${ev.date}T${ev.time || '09:00'}`) - new Date(ev.notifyAt);
      for (const d of eventOccurrences(ev, from, addDays(day, 60))) {
        const when = new Date(new Date(`${d}T${ev.time || '09:00'}`).getTime() - lead);
        if (when <= now && d >= from) add(`e|${ev.id}|${d}`, ev.title, `${FP.fmtDay(d)}${ev.time ? ` at ${FP.fmtTime(ev.time)}` : ''}`, 'calendar');
      }
    }
    for (const t of st.tasks) if (t.due && !t.done && t.due <= day && t.due >= from) add(`t|${t.id}|${t.due}`, `Task due: ${t.title}`, t.due === day ? 'Due today' : `Was due ${FP.fmtDate(t.due)}`, 'tasks');
    for (const { r, date } of upcomingRecurring(60)) {
      if (daysBetween(day, date) <= (r.remindDays ?? 2) && date >= from) add(`r|${r.id}|${date}`, `${r.type === 'income' ? 'Income expected' : 'Payment due'}: ${r.name}`, `${FP.money(r.amount)} on ${FP.fmtDay(date)}`, 'recurring');
    }
    for (const l of st.loans) {
      if (l.dueDate && outstanding(l) && daysBetween(day, l.dueDate) <= 2 && l.dueDate >= from) {
        const who = S.get('people', l.personId)?.name || 'Someone';
        add(`l|${l.id}|${l.dueDate}`, l.kind === 'lent' ? `${who} is due to repay you` : `Repayment due to ${who}`, `${FP.money(outstanding(l))} on ${FP.fmtDay(l.dueDate)}`, 'people');
      }
    }
    return out;
  }

  /* ---------- receipt text parser ---------- */
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const SUMMARY = /\b(sub\s*-?\s*total|total|tax|vat|gst|hst|pst|change|cash|card|visa|master\s*card|amex|debit|credit|balance|tender|tendered|amount\s+due|amt\s+due|payment|paid|rounding|savings?|you\s+saved|points|auth|approval|ref|tel|phone|invoice|receipt|account|acct)\b/i;
  const NOT_STORE = /^(receipt|invoice|tax invoice|welcome|thank|date|time|tel|phone|www\.|http|store\s*#|\d)/i;
  const AMOUNT = /(-?\d{1,6}(?:[.,]\d{3})*[.,]\s?\d{2})(?!\d)/g;
  const cents = (s) => FP.toCents(String(s).replace(/\s/g, ''));
  // OCR commonly reads digits in a price as letters
  const fixDigits = (line) => line.replace(/\b([\dOoIlSB]{1,5})[.,]\s?([\dOoIlSB]{2})\b(?=\s*[A-Z*]{0,2}\s*$)/, (m, a, b) => {
    const f = (x) => x.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
    return /\d/.test(a + b) ? `${f(a)}.${f(b)}` : m;
  });
  function findDate(text) {
    const valid = (y, m, d) => {
      if (y < 100) y += 2000;
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return FP.isDate(iso) && iso <= addDays(today(), 1) && y >= 2000 ? iso : null;
    };
    let m;
    if ((m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) { const r = valid(+m[1], +m[2], +m[3]); if (r) return r; }
    if ((m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) {
      // day/month order is ambiguous, so take the reading that's valid and most recent
      const a = valid(+m[3], +m[1], +m[2]), b = valid(+m[3], +m[2], +m[1]), r = [a, b].filter(Boolean).sort().pop();
      if (r) return r;
    }
    // month names must be whole words on one line, or "MARKET" above "123 Main St" reads as 1 March 2023
    const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    if ((m = text.match(new RegExp(`\\b(\\d{1,2})[ -]?${MONTH}\\.?[ ,-]*(\\d{2,4})\\b`, 'i')))) { const r = valid(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]); if (r) return r; }
    if ((m = text.match(new RegExp(`\\b${MONTH}\\.? ?(\\d{1,2})(?:st|nd|rd|th)?,? ?(\\d{2,4})\\b`, 'i')))) { const r = valid(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]); if (r) return r; }
    return null;
  }
  function parseReceipt(raw) {
    const lines = String(raw || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const res = { store: '', date: findDate(lines.join('\n')), items: [], tax: null, subtotal: null, total: null };
    res.store = (lines.slice(0, 6).find((l) => /[a-z]{3}/i.test(l) && !NOT_STORE.test(l) && !/\d[.,]\d{2}/.test(l)) || '').replace(/[^\p{L}\p{N} &'.-]/gu, '').trim().slice(0, 60);
    let pendingQty = null, pendingName = '', totalRank = -1, largest = 0;
    for (let line of lines) {
      line = fixDigits(line);
      const amounts = [...line.matchAll(AMOUNT)].map((m) => cents(m[1]));
      // "2 @ 1.50" on its own line belongs to the item line beside it
      const qtyOnly = line.match(/^(\d+(?:\.\d+)?)\s*(?:x|@|ea)\s*\$?\s*\d/i);
      if (!amounts.length) {
        // a name alone on its line can belong to a "2 @ 1.50  3.00" line just below it
        pendingName = /\p{L}{2}/u.test(line) && !SUMMARY.test(line) ? line : '';
        continue;
      }
      const nameAbove = pendingName;
      pendingName = '';
      const value = amounts[amounts.length - 1];
      if (Number.isFinite(value) && value > largest) largest = value;
      if (/\b(sub\s*-?\s*total)\b/i.test(line)) { res.subtotal = value; continue; }
      if (/\b(tax|vat|gst|hst|pst)\b/i.test(line)) { res.tax = (res.tax || 0) + value; continue; }
      const rank = /\b(grand\s+total|total\s+due|amount\s+due|amt\s+due|balance\s+due)\b/i.test(line) ? 2 : /\btotal\b/i.test(line) ? 1 : -1;
      if (rank >= 0) { if (rank >= totalRank) { res.total = value; totalRank = rank; } continue; }
      if (SUMMARY.test(line)) continue;
      if (/\d{1,2}[/:-]\d{1,2}[/:-]\d{2,4}/.test(line) && amounts.length < 2) continue;
      if (qtyOnly && !line.replace(/^(\d+(?:\.\d+)?)\s*(?:x|@|ea)[^a-z]*$/i, '').trim()) {
        const prev = res.items[res.items.length - 1];
        if (nameAbove) {
          res.items.push({ id: uid(), name: nameAbove.slice(0, 80), qty: Number(qtyOnly[1]), total: value });
        } else if (prev && prev.qty === 1 && amounts.length >= 2) {
          // the quantity line carries the line total, and the item above had the unit price or none
          prev.qty = Number(qtyOnly[1]); prev.total = value;
        } else if (prev && prev.qty === 1 && amounts.length === 1 && prev.total === value * Number(qtyOnly[1])) {
          prev.qty = Number(qtyOnly[1]);
        } else pendingQty = Number(qtyOnly[1]);
        continue;
      }
      let name = line.slice(0, line.search(AMOUNT) < 0 ? line.length : line.search(AMOUNT)).trim();
      let qty = pendingQty || 1;
      pendingQty = null;
      const lead = name.match(/^(\d{1,3})\s*(?:x|@)?\s+(?=\p{L})/iu);
      if (lead) { qty = Number(lead[1]); name = name.slice(lead[0].length); }
      const trail = name.match(/\s+(\d{1,3})\s*(?:x|@|ea)?\s*$/i);
      if (trail) { qty = Number(trail[1]); name = name.slice(0, trail.index); }
      name = name.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})%]+$/gu, '').trim();
      if (!/\p{L}{2}/u.test(name) || !Number.isFinite(value) || value <= 0) continue;
      res.items.push({ id: uid(), name: name.slice(0, 80), qty: qty || 1, total: value });
    }
    if (res.total === null && largest) res.total = largest;
    return res;
  }

  /* ---------- global search ---------- */
  function search(q) {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    const has = (...v) => v.some((x) => String(x ?? '').toLowerCase().includes(n));
    const out = [];
    for (const t of st.transactions) if (has(t.desc, t.notes, catName(t.categoryId), t.store)) out.push({ group: 'Transactions', title: t.desc || catName(t.categoryId), sub: `${FP.fmtDate(t.date)} · ${t.type === 'income' ? '+' : '-'}${FP.money(t.amount)}`, route: 'transactions', act: 'txEdit', id: t.id, date: t.date });
    for (const p of st.people) if (has(p.name, p.phone, p.email, p.notes)) out.push({ group: 'People', title: p.name, sub: p.phone || p.email || 'Person', route: `people/${p.id}` });
    for (const e of st.events) if (has(e.title, e.notes)) out.push({ group: 'Events', title: e.title, sub: FP.fmtDate(e.date), route: `calendar/${e.date}` });
    for (const i of st.groceryItems) if (has(i.name, i.note)) { const p = lastPrice(i); out.push({ group: 'Grocery items', title: i.name, sub: p !== null ? `Last price ${FP.money(p)}` : 'No price yet', route: 'grocery' }); }
    for (const l of st.groceryLists) if (has(l.name) || l.items.some((i) => has(i.name))) out.push({ group: 'Grocery lists', title: l.name, sub: l.date ? FP.fmtDate(l.date) : 'Reusable list', route: `grocery/${l.id}` });
    for (const t of st.tasks) if (has(t.title, t.notes, t.category)) out.push({ group: 'Tasks', title: t.title, sub: t.done ? 'Done' : t.due ? `Due ${FP.fmtDate(t.due)}` : 'Pending', route: 'tasks' });
    return out;
  }

  FP.domain = {
    seedCategories, catsOf, catName, catColor, catByName, groceryCat, inRange, totals, repaid, outstanding, loanStatus, loanTotals, personBalance,
    goalSaved, totalSavings, balanceAt, savingsAt, spendByCategory, summary, bucketRange, bucketLabel, FREQS, freqLabel, nthDate, occurrences, recurNext,
    postRecurring, autoPostRecurring, upcomingRecurring, budgetWindow, budgetStatus, activeBudgets, budgetName, budgetWarnings, normName, findItem,
    rememberItem, recordPurchase, forgetPurchases, lastPrice, priceStats, recommend, listItemFrom, makeList, ensureEventList, ensureUpcomingLists,
    nameMatch, finishList, groceryMonthly, deleteTransaction, eventOccurrences, EVENT_TYPES, agenda, dueReminders, parseReceipt, search,
  };
})();
