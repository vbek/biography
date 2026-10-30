/* Financial Planner — people and loans, budgets and goals, recurring items, reports and settings. */
(() => {
  'use strict';
  const { $, $$, esc, icon, money, store: S, domain: D, today, addDays, addMonths, monthStart, monthEnd, fmtDate, relDay, toast, charts: C } = FP;
  const st = S.state, A = FP.actions, V = FP.views;
  const bar = (pct, level = 'ok') => `<div class="meter ${level}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(pct * 100))}"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i></div>`;

  /* ---------- people ---------- */
  const STATUS = { open: 'Open', partial: 'Part repaid', overdue: 'Overdue', settled: 'Settled' };
  V.people = (el, param) => {
    const person = param && S.get('people', param);
    if (person) return drawPerson(el, person);
    const t = D.loanTotals();
    const rows = st.people.slice().sort((a, b) => a.name.localeCompare(b.name));
    el.innerHTML = `<div class="page-head"><h1>People</h1><div class="btn-row"><button class="btn" data-act="personAdd">${icon('plus')}Person</button><button class="btn primary" data-act="loanAdd">${icon('plus')}Lend or borrow</button></div></div>
      <section class="stats small-stats"><div class="stat good"><span>You are owed</span><b>${esc(money(t.lent))}</b></div><div class="stat bad"><span>You owe</span><b>${esc(money(t.borrowed))}</b></div></section>
      <section class="card">${rows.length ? `<ul class="rows">${rows.map((p) => {
    const b = D.personBalance(p.id);
    return `<li class="row"><a class="row-main" href="#people/${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.phone || p.email || 'No contact details')}</small></a><span class="right">${b.net > 0 ? `<b class="text-good">Owes you ${esc(money(b.net))}</b>` : b.net < 0 ? `<b class="text-bad">You owe ${esc(money(-b.net))}</b>` : '<small class="muted">Settled</small>'}</span></li>`;
  }).join('')}</ul>` : FP.emptyState('people', 'No people yet', 'Add someone you lend money to or borrow money from.', '<button class="btn primary" data-act="personAdd">Add person</button>')}</section>`;
  };
  function drawPerson(el, p) {
    const b = D.personBalance(p.id);
    const loans = st.loans.filter((l) => l.personId === p.id).sort((x, y) => y.date.localeCompare(x.date));
    const history = [];
    for (const l of loans) {
      history.push({ date: l.date, text: `${l.kind === 'lent' ? 'You lent' : 'You borrowed'}${l.desc ? `: ${l.desc}` : ''}`, amount: l.amount, sign: l.kind === 'lent' ? '-' : '+' });
      for (const r of l.repayments || []) history.push({ date: r.date, text: `${l.kind === 'lent' ? 'They repaid you' : 'You repaid them'}${r.note ? `: ${r.note}` : ''}`, amount: r.amount, sign: l.kind === 'lent' ? '+' : '-' });
    }
    history.sort((x, y) => y.date.localeCompare(x.date));
    el.innerHTML = `<a class="back-link" href="#people">${icon('back')}All people</a>
      <div class="page-head"><div><h1>${esc(p.name)}</h1><p class="muted">${[p.phone, p.email].filter(Boolean).map(esc).join(' · ') || 'No contact details'}</p></div>
      <div class="btn-row"><button class="btn" data-act="personEdit" data-id="${esc(p.id)}">${icon('edit')}Edit</button><button class="btn primary" data-act="loanAdd" data-person="${esc(p.id)}">${icon('plus')}Lend or borrow</button></div></div>
      <section class="stats small-stats"><div class="stat good"><span>Owes you</span><b>${esc(money(b.lent))}</b></div><div class="stat bad"><span>You owe</span><b>${esc(money(b.borrowed))}</b></div><div class="stat accent"><span>Net</span><b>${esc(money(b.net))}</b></div></section>
      ${p.notes ? `<p class="pre muted">${esc(p.notes)}</p>` : ''}
      <section class="card"><h2>Loans</h2>${loans.length ? `<ul class="loan-list">${loans.map((l) => {
    const left = D.outstanding(l), status = D.loanStatus(l);
    return `<li class="loan"><div class="row"><div><b>${l.kind === 'lent' ? 'Lent' : 'Borrowed'} ${esc(money(l.amount))}</b><small>${esc(fmtDate(l.date))}${l.desc ? ` · ${esc(l.desc)}` : ''}${l.dueDate ? ` · Due ${esc(fmtDate(l.dueDate))}` : ''}</small></div><span class="pill s-${status}">${STATUS[status]}</span></div>
        ${bar(D.repaid(l) / l.amount)}<div class="row"><small class="muted">${esc(money(left))} outstanding</small><span class="btn-row">${left ? `<button class="btn subtle" data-act="repayAdd" data-id="${esc(l.id)}">Record repayment</button>` : ''}<button class="btn subtle" data-act="loanEdit" data-id="${esc(l.id)}">Edit</button></span></div></li>`;
  }).join('')}</ul>` : '<p class="muted">No loans recorded.</p>'}</section>
      <section class="card"><h2>History</h2>${history.length ? `<ul class="rows">${history.map((h) => `<li class="row"><div><b>${esc(h.text)}</b><small>${esc(fmtDate(h.date))}</small></div><b>${esc(h.sign)}${esc(money(h.amount))}</b></li>`).join('')}</ul>` : '<p class="muted">Nothing yet.</p>'}</section>`;
  }
  function personForm(p) {
    return FP.formDialog({
      title: p ? 'Edit person' : 'Add person', values: p || {},
      fields: [
        { name: 'name', label: 'Name', required: true, max: 80, full: true },
        { name: 'phone', label: 'Phone', type: 'tel', max: 30 },
        { name: 'email', label: 'Email', type: 'email', validate: (v) => (/^\S+@\S+\.\S+$/.test(v) ? '' : 'Enter a valid email address.') },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true },
      ],
      footExtra: p ? '<button type="button" class="btn danger-text" data-del>Delete</button>' : '',
      onOpen: (d) => {
        const del = $('[data-del]', d);
        if (del) del.onclick = async () => {
          const n = st.loans.filter((l) => l.personId === p.id).length;
          if (!await FP.confirmDialog(`Delete ${p.name}${n ? ` and ${n} loan record${n === 1 ? '' : 's'}` : ''}? This changes your balance if the loans are unsettled.`)) return;
          st.loans = st.loans.filter((l) => l.personId !== p.id);
          S.touch('loans');
          S.remove('people', p.id);
          d.close();
          FP.go('people');
        };
      },
      onSubmit: (v) => { if (p) S.update('people', p.id, v); else { const n = S.add('people', v); return n; } },
    });
  }
  A.personAdd = () => personForm();
  A.personEdit = ({ id }) => personForm(S.get('people', id));
  function loanForm(l, preset = {}) {
    const options = [...st.people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.id, p.name]), ['__new', '+ New person…']];
    return FP.formDialog({
      title: l ? 'Edit loan' : 'Lend or borrow', values: l || preset,
      fields: [
        { name: 'kind', label: 'Type', type: 'select', options: [['lent', 'I lent money'], ['borrowed', 'I borrowed money']], value: 'lent' },
        { name: 'personId', label: 'Person', type: 'select', options, value: preset.personId || options[0][0], required: true },
        { name: 'newName', label: 'New person\'s name', max: 80, when: (v) => v.personId === '__new', checkEmpty: true, validate: (n, all) => (all.personId === '__new' && !n ? 'Enter a name.' : '') },
        { name: 'amount', label: 'Amount', type: 'money', required: true, validate: (v) => (l && v < D.repaid(l) ? `${money(D.repaid(l))} has already been repaid, so the loan can't be less than that.` : '') },
        { name: 'date', label: 'Date', type: 'date', required: true, value: today() },
        { name: 'dueDate', label: 'Due date', type: 'date', validate: (v, all) => (v < all.date ? 'The due date must be on or after the loan date.' : '') },
        { name: 'desc', label: 'Description', max: 120, full: true },
      ],
      footExtra: l ? '<button type="button" class="btn danger-text" data-del>Delete</button>' : '',
      onOpen: (d) => {
        const del = $('[data-del]', d);
        if (del) del.onclick = async () => { if (await FP.confirmDialog(`Delete this ${money(l.amount)} loan and its repayments?`)) { S.remove('loans', l.id); d.close(); } };
        const box = $('[data-field=newName]', d), sel = d.querySelector('[name=personId]');
        if (box && sel.value === '__new') box.hidden = false;
      },
      onSubmit: (v) => {
        const { newName, ...data } = v;
        if (data.personId === '__new') data.personId = S.add('people', { name: newName, phone: '', email: '', notes: '' }).id;
        if (l) S.update('loans', l.id, data); else S.add('loans', { ...data, repayments: [] });
        toast('Saved.');
      },
    });
  }
  A.loanAdd = ({ person } = {}) => loanForm(null, person ? { personId: person } : {});
  A.loanEdit = ({ id }) => loanForm(S.get('loans', id));
  A.repayAdd = ({ id }) => {
    const l = S.get('loans', id), left = D.outstanding(l);
    return FP.formDialog({
      title: 'Record repayment', cls: 'narrow', values: { amount: left },
      fields: [
        { name: 'amount', label: `Amount (${money(left)} outstanding)`, type: 'money', required: true, full: true, validate: (v) => (v > left ? `That is more than the ${money(left)} still outstanding.` : '') },
        { name: 'date', label: 'Date', type: 'date', required: true, value: today(), full: true, validate: (v) => (v < l.date ? 'This is before the loan was made.' : '') },
        { name: 'note', label: 'Note', max: 120, full: true },
      ],
      onSubmit: (v) => { S.update('loans', id, { repayments: [...(l.repayments || []), { id: FP.uid(), ...v }] }); toast(v.amount === left ? 'Loan settled.' : 'Repayment recorded.'); },
    });
  };

  /* ---------- budgets and goals ---------- */
  V.budget = (el) => {
    const budgets = st.budgets.slice().map((b) => ({ b, s: D.budgetStatus(b) })).sort((x, y) => y.s.pct - x.s.pct);
    el.innerHTML = `<div class="page-head"><h1>Budgets &amp; goals</h1></div>
      <section class="card"><div class="card-head"><h2>Budgets</h2><button class="btn primary" data-act="budgetAdd">${icon('plus')}Budget</button></div>
      ${budgets.length ? `<ul class="meters">${budgets.map(({ b, s }) => `<li><button class="row-main" data-act="budgetEdit" data-id="${esc(b.id)}"><span class="row"><b>${esc(D.budgetName(b))}</b><b class="${s.level === 'over' ? 'text-bad' : s.level === 'near' ? 'text-warn' : ''}">${esc(money(s.spent))} / ${esc(money(b.amount))}</b></span>
        ${bar(s.pct, s.level)}<small class="muted">${b.period === 'custom' ? `${esc(fmtDate(s.from))} – ${esc(fmtDate(s.to))}` : 'This month'} · ${s.left >= 0 ? `${esc(money(s.left))} left` : `${esc(money(-s.left))} over`}</small></button></li>`).join('')}</ul>` : FP.emptyState('target', 'No budgets yet', 'Set a limit for a category or for all your spending.')}</section>
      <section class="card"><div class="card-head"><h2>Savings goals</h2><button class="btn primary" data-act="goalAdd">${icon('plus')}Goal</button></div>
      ${st.goals.length ? `<ul class="meters">${st.goals.map((g) => {
    const saved = D.goalSaved(g), pct = g.target ? saved / g.target : 0, left = g.target - saved;
    const months = g.deadline ? Math.max(1, Math.ceil(FP.daysBetween(today(), g.deadline) / 30.4)) : 0;
    return `<li><div class="row"><button class="row-main" data-act="goalEdit" data-id="${esc(g.id)}"><b>${esc(g.name)}</b></button><b>${esc(money(saved))} / ${esc(money(g.target))}</b></div>${bar(pct, pct >= 1 ? 'done' : 'ok')}
        <div class="row"><small class="muted">${pct >= 1 ? 'Goal reached' : g.deadline ? (g.deadline < today() ? `Deadline passed on ${esc(fmtDate(g.deadline))}` : `By ${esc(fmtDate(g.deadline))} · about ${esc(money(Math.ceil(left / months)))} a month`) : `${esc(money(left))} to go`}</small><button class="btn subtle" data-act="goalMove" data-id="${esc(g.id)}">Add or withdraw</button></div></li>`;
  }).join('')}</ul>` : FP.emptyState('target', 'No goals yet', 'Create a goal to track what you are saving for.')}</section>`;
  };
  function budgetForm(b) {
    return FP.formDialog({
      title: b ? 'Edit budget' : 'Add budget', values: b ? { ...b, categoryId: b.categoryId || '' } : {},
      fields: [
        { name: 'categoryId', label: 'Applies to', type: 'select', options: [['', 'All spending'], ...D.catsOf('expense').map((c) => [c.id, c.name])], validate: () => '' },
        { name: 'amount', label: 'Limit', type: 'money', required: true },
        { name: 'period', label: 'Period', type: 'select', options: [['monthly', 'Every month'], ['custom', 'Custom dates']], value: 'monthly' },
        { name: 'name', label: 'Name (optional)', max: 60 },
        { name: 'start', label: 'From', type: 'date', when: (v) => v.period === 'custom', checkEmpty: true, validate: (v, a) => (a.period === 'custom' && !v ? 'Choose a start date.' : '') },
        { name: 'end', label: 'To', type: 'date', when: (v) => v.period === 'custom', checkEmpty: true, validate: (v, a) => (a.period === 'custom' && (!v || v < a.start) ? 'Choose an end date after the start.' : '') },
      ],
      footExtra: b ? '<button type="button" class="btn danger-text" data-del>Delete</button>' : '',
      onOpen: (d) => { const del = $('[data-del]', d); if (del) del.onclick = async () => { if (await FP.confirmDialog(`Delete the budget for ${D.budgetName(b)}? Your transactions are not affected.`)) { S.remove('budgets', b.id); d.close(); } }; },
      onSubmit: (v) => {
        const data = { ...v, categoryId: v.categoryId || null };
        const clash = v.period === 'monthly' && st.budgets.find((x) => x.id !== b?.id && x.period === 'monthly' && (x.categoryId || null) === data.categoryId);
        if (clash) throw new Error(`${D.budgetName(clash)} already has a monthly budget. Edit that one instead.`);
        if (b) S.update('budgets', b.id, data); else S.add('budgets', data);
      },
    });
  }
  A.budgetAdd = () => budgetForm();
  A.budgetEdit = ({ id }) => budgetForm(S.get('budgets', id));
  function goalForm(g) {
    return FP.formDialog({
      title: g ? 'Edit goal' : 'Add savings goal', values: g || {},
      fields: [
        { name: 'name', label: 'Goal', required: true, max: 80, full: true, placeholder: 'Emergency fund, new laptop…' },
        { name: 'target', label: 'Target amount', type: 'money', required: true },
        { name: 'deadline', label: 'Deadline', type: 'date' },
      ],
      footExtra: g ? '<button type="button" class="btn danger-text" data-del>Delete</button>' : '',
      onOpen: (d) => { const del = $('[data-del]', d); if (del) del.onclick = async () => { if (await FP.confirmDialog(`Delete "${g.name}"? ${money(D.goalSaved(g))} saved in it returns to your available balance.`)) { S.remove('goals', g.id); d.close(); } }; },
      onSubmit: (v) => { if (g) S.update('goals', g.id, v); else S.add('goals', { ...v, contributions: [] }); },
    });
  }
  A.goalAdd = () => goalForm();
  A.goalEdit = ({ id }) => goalForm(S.get('goals', id));
  A.goalMove = ({ id }) => {
    const g = S.get('goals', id), saved = D.goalSaved(g);
    return FP.formDialog({
      title: g.name, cls: 'narrow', submit: 'Save',
      fields: [
        { name: 'dir', label: 'Action', type: 'select', options: [['in', 'Add to savings'], ['out', 'Withdraw']], full: true },
        { name: 'amount', label: 'Amount', type: 'money', required: true, full: true, validate: (v, a) => (a.dir === 'out' && v > saved ? `Only ${money(saved)} is saved in this goal.` : '') },
        { name: 'date', label: 'Date', type: 'date', required: true, value: today(), full: true },
      ],
      onSubmit: (v) => { S.update('goals', id, { contributions: [...(g.contributions || []), { id: FP.uid(), amount: v.dir === 'out' ? -v.amount : v.amount, date: v.date }] }); },
    });
  };

  /* ---------- recurring ---------- */
  V.recurring = (el) => {
    const groups = [['expense', 'Payments'], ['income', 'Income']];
    const up = D.upcomingRecurring(30);
    const out = up.filter((x) => x.r.type === 'expense').reduce((s, x) => s + x.r.amount, 0), inc = up.filter((x) => x.r.type === 'income').reduce((s, x) => s + x.r.amount, 0);
    el.innerHTML = `<div class="page-head"><h1>Recurring</h1><div class="btn-row"><button class="btn" data-act="recurAdd" data-type="income">${icon('plus')}Income</button><button class="btn primary" data-act="recurAdd" data-type="expense">${icon('plus')}Payment</button></div></div>
      <section class="stats small-stats"><div class="stat bad"><span>Due in 30 days</span><b>${esc(money(out))}</b></div><div class="stat good"><span>Expected in 30 days</span><b>${esc(money(inc))}</b></div></section>
      ${groups.map(([type, label]) => {
    const rows = st.recurring.filter((r) => r.type === type).map((r) => ({ r, next: D.recurNext(r) })).sort((a, b) => (a.next || '9').localeCompare(b.next || '9'));
    return `<section class="card"><h2>${label}</h2>${rows.length ? `<ul class="rows">${rows.map(({ r, next }) => `<li class="row wrap"><button class="row-main" data-act="recurEdit" data-id="${esc(r.id)}"><b>${esc(r.name)}${r.paused ? ' <span class="pill low">Paused</span>' : ''}</b><small class="${next && next < today() ? 'text-bad' : ''}">${esc(D.freqLabel(r.freq))}${next ? ` · ${next < today() ? 'Overdue, ' : 'Next '}${esc(relDay(next))}` : ' · Finished'}${r.autoPost ? ' · Records itself' : ''}</small></button>
        <b>${esc(money(r.amount))}</b>${next && !r.paused && !r.autoPost ? `<span class="btn-row"><button class="btn subtle" data-act="recurPay" data-id="${esc(r.id)}">${type === 'income' ? 'Received' : 'Paid'}</button><button class="btn subtle" data-act="recurSkip" data-id="${esc(r.id)}">Skip</button></span>` : ''}</li>`).join('')}</ul>` : `<p class="muted">Nothing here yet.</p>`}</section>`;
  }).join('')}`;
  };
  function recurForm(r, type) {
    const t = r?.type || type;
    return FP.formDialog({
      title: `${r ? 'Edit' : 'Add'} recurring ${t === 'income' ? 'income' : 'payment'}`, values: r || {},
      fields: [
        { name: 'name', label: 'Name', required: true, max: 80, full: true, placeholder: t === 'income' ? 'Salary' : 'Rent, internet, phone…' },
        { name: 'amount', label: 'Amount', type: 'money', required: true },
        { name: 'categoryId', label: 'Category', type: 'select', options: FP.catOptions(t), value: D.catsOf(t)[0]?.id },
        { name: 'freq', label: 'How often', type: 'select', options: D.FREQS, value: 'monthly' },
        { name: 'start', label: 'First date', type: 'date', required: true, value: today() },
        { name: 'end', label: 'Last date', type: 'date', validate: (v, a) => (v < a.start ? 'This must be after the first date.' : '') },
        { name: 'remindDays', label: 'Remind me (days before)', type: 'number', min: 0, value: 2 },
        { name: 'autoPost', label: 'Record automatically on the due date', type: 'checkbox', full: true },
        ...(r ? [{ name: 'paused', label: 'Paused', type: 'checkbox', full: true }] : []),
      ],
      footExtra: r ? '<button type="button" class="btn danger-text" data-del>Delete</button>' : '',
      onOpen: (d, form) => {
        FP.wireNewCategory(form, 'categoryId', t);
        const del = $('[data-del]', d);
        if (del) del.onclick = async () => { if (await FP.confirmDialog(`Delete "${r.name}"? Transactions it already recorded are kept.`)) { S.remove('recurring', r.id); d.close(); } };
      },
      onSubmit: (v) => {
        const data = { ...v, remindDays: v.remindDays ?? 2 };
        if (r) S.update('recurring', r.id, data); else S.add('recurring', { ...data, type: t });
        D.autoPostRecurring();
      },
    });
  }
  A.recurAdd = ({ type }) => recurForm(null, type);
  A.recurEdit = ({ id }) => recurForm(S.get('recurring', id));
  A.recurPay = ({ id }) => {
    const r = S.get('recurring', id), date = D.recurNext(r);
    return FP.formDialog({
      title: `${r.type === 'income' ? 'Received' : 'Paid'}: ${r.name}`, cls: 'narrow', submit: 'Record', values: { amount: r.amount, date: date > today() ? today() : date },
      fields: [
        { name: 'amount', label: 'Amount', type: 'money', required: true, full: true },
        { name: 'date', label: 'Date', type: 'date', required: true, full: true },
      ],
      onSubmit: (v) => {
        const before = FP.budgetLevels();
        const t = S.add('transactions', { type: r.type, amount: v.amount, date: v.date, desc: r.name, categoryId: r.categoryId, recurringId: r.id });
        S.update('recurring', id, { paidThrough: date });
        FP.budgetCheck(t, before);
        toast('Recorded.');
      },
    });
  };
  A.recurSkip = async ({ id }) => {
    const r = S.get('recurring', id), date = D.recurNext(r);
    if (await FP.confirmDialog(`Skip ${r.name} on ${fmtDate(date)}? Nothing will be recorded for that date.`, { yes: 'Skip', danger: false })) S.update('recurring', id, { paidThrough: date });
  };

  /* ---------- reports ---------- */
  const rp = { range: '6m', from: '', to: '', gran: 'month' };
  function reportRange() {
    const now = today();
    switch (rp.range) {
      case 'month': return [monthStart(now), monthEnd(now)];
      case '30d': return [addDays(now, -29), now];
      case '6m': return [monthStart(addMonths(now, -5)), monthEnd(now)];
      case 'year': return [`${now.slice(0, 4)}-01-01`, `${now.slice(0, 4)}-12-31`];
      case 'all': {
        const dates = st.transactions.map((t) => t.date).sort();
        return [dates[0] || monthStart(now), now];
      }
      default: return [rp.from || monthStart(now), rp.to || now];
    }
  }
  function reportData() {
    const [from, to] = reportRange();
    let gran = rp.gran;
    // daily bars across several years would be unreadable and slow
    const span = FP.daysBetween(from, to);
    if (gran === 'day' && span > 120) gran = 'week';
    if (gran === 'week' && span > 800) gran = 'month';
    const rows = D.summary(from, to, gran);
    return { from, to, gran, rows, totals: D.totals(from, to), cats: D.spendByCategory(from, to), inc: D.spendByCategory(from, to, 'income') };
  }
  V.reports = (el) => {
    const r = reportData();
    const items = st.groceryItems.map((i) => ({ i, p: D.priceStats(i) })).filter((x) => x.p).sort((a, b) => Math.abs(b.p.change || 0) - Math.abs(a.p.change || 0));
    const trend = r.rows.map((b) => ({ label: b.label, balance: D.balanceAt(b.end > today() ? today() : b.end), savings: D.savingsAt(b.end > today() ? today() : b.end) }));
    const people = st.people.map((p) => ({ p, b: D.personBalance(p.id) })).filter((x) => x.b.lent || x.b.borrowed);
    const lb = D.loanTotals();
    const rate = r.totals.income ? (r.totals.net / r.totals.income) * 100 : 0;
    el.innerHTML = `<div class="page-head"><h1>Reports</h1><div class="btn-row"><button class="btn" data-act="exportCsv">${icon('download')}CSV</button><button class="btn" data-act="exportPdf">${icon('download')}PDF</button></div></div>
      <section class="card filters">
        <select id="rRange" aria-label="Period">${[['month', 'This month'], ['30d', 'Last 30 days'], ['6m', 'Last 6 months'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom dates']].map(([v, l]) => `<option value="${v}"${rp.range === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${rp.range === 'custom' ? `<label class="inline">From <input id="rFrom" type="date" value="${esc(r.from)}"></label><label class="inline">To <input id="rTo" type="date" value="${esc(r.to)}"></label>` : ''}
        <div class="seg" role="group" aria-label="Group by">${[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']].map(([g, l]) => `<button data-act="rpGran" data-g="${g}" class="${r.gran === g ? 'on' : ''}" aria-pressed="${r.gran === g}">${l}</button>`).join('')}</div>
      </section>
      <section class="stats"><div class="stat good"><span>Income</span><b>${esc(money(r.totals.income))}</b></div><div class="stat bad"><span>Expenses</span><b>${esc(money(r.totals.expense))}</b></div><div class="stat accent"><span>Net</span><b>${esc(money(r.totals.net))}</b><small>${r.totals.net < 0 ? 'Spent more than earned' : r.totals.income ? `${rate.toFixed(0)}% of income kept` : ''}</small></div></section>
      <div class="grid-2">
        <section class="card span-2"><h2>Income vs expenses</h2><div id="rBars" class="chart"></div></section>
        <section class="card"><h2>Spending by category</h2><div id="rCats" class="chart"></div></section>
        <section class="card"><h2>Income by category</h2><div id="rInc" class="chart"></div></section>
        <section class="card span-2"><h2>Balance and savings trend</h2><div id="rTrend" class="chart"></div></section>
        <section class="card"><h2>Borrowed vs lent</h2><div id="rLoans" class="chart"></div>
          ${people.length ? `<ul class="rows">${people.map(({ p, b }) => `<li class="row"><a href="#people/${esc(p.id)}">${esc(p.name)}</a><small>${b.lent ? `Owes ${esc(money(b.lent))}` : ''}${b.lent && b.borrowed ? ' · ' : ''}${b.borrowed ? `Owed ${esc(money(b.borrowed))}` : ''}</small></li>`).join('')}</ul>` : ''}</section>
        <section class="card"><h2>Grocery spending</h2><div id="rGroc" class="chart"></div></section>
        <section class="card span-2"><h2>Grocery price changes</h2>${items.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th>Latest</th><th>Previous</th><th>Change</th><th>Average</th><th>Lowest</th></tr></thead><tbody>${items.slice(0, 25).map(({ i, p }) => `<tr><td>${esc(i.name)}</td><td>${esc(money(p.last))}</td><td>${p.prev !== null ? esc(money(p.prev)) : '–'}</td><td class="${p.change > 0 ? 'text-bad' : p.change < 0 ? 'text-good' : ''}">${p.change !== null ? `${p.change > 0 ? '+' : ''}${(p.change * 100).toFixed(0)}%` : '–'}</td><td>${esc(money(p.avg))}</td><td>${esc(money(p.min))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Prices appear here once you have recorded groceries with prices.</p>'}</section>
        <section class="card span-2"><h2>Summary table</h2><div class="table-wrap"><table class="data"><thead><tr><th>Period</th><th>Income</th><th>Expenses</th><th>Net</th></tr></thead><tbody>${r.rows.slice().reverse().slice(0, 60).map((b) => `<tr><td>${esc(b.label)}</td><td>${esc(money(b.income))}</td><td>${esc(money(b.expense))}</td><td class="${b.income - b.expense < 0 ? 'text-bad' : ''}">${esc(money(b.income - b.expense))}</td></tr>`).join('')}</tbody></table></div></section>
      </div>`;
    C.bars($('#rBars', el), { labels: r.rows.map((b) => b.label), series: [{ name: 'Income', color: '#22c55e', values: r.rows.map((b) => b.income) }, { name: 'Expenses', color: '#f43f5e', values: r.rows.map((b) => b.expense) }] });
    C.donut($('#rCats', el), { rows: r.cats });
    C.donut($('#rInc', el), { rows: r.inc });
    C.lines($('#rTrend', el), { labels: trend.map((t) => t.label), series: [{ name: 'Balance', color: '#22d3ee', values: trend.map((t) => t.balance) }, { name: 'Savings', color: '#a855f7', values: trend.map((t) => t.savings) }] });
    C.donut($('#rLoans', el), { rows: [{ id: 'l', label: 'Lent (owed to you)', value: lb.lent, color: '#22c55e' }, { id: 'b', label: 'Borrowed (you owe)', value: lb.borrowed, color: '#f43f5e' }].filter((x) => x.value) });
    const g = D.groceryMonthly(r.from, r.to);
    C.bars($('#rGroc', el), { labels: g.map((x) => x.label), series: [{ name: 'Groceries', color: '#22c55e', values: g.map((x) => x.value) }], height: 200 });
    $('#rRange', el).addEventListener('change', (e) => { rp.range = e.target.value; if (rp.range === 'custom') { rp.from = r.from; rp.to = r.to; } FP.render(); });
    $('#rFrom', el)?.addEventListener('change', (e) => { if (!e.target.value) return; if (rp.to && e.target.value > rp.to) return toast('The start date must be before the end date.', 'warn'); rp.from = e.target.value; FP.render(); });
    $('#rTo', el)?.addEventListener('change', (e) => { if (!e.target.value) return; if (e.target.value < rp.from) return toast('The end date must be after the start date.', 'warn'); rp.to = e.target.value; FP.render(); });
  };
  A.rpGran = ({ g }) => { rp.gran = g; FP.render(); };
  A.exportCsv = () => {
    const { from, to } = reportData();
    const cents = (c) => Number((c / 100).toFixed(2));
    const rows = [['Type', 'Date', 'Description', 'Category', 'Amount', 'Currency', 'Store', 'Notes']];
    for (const t of st.transactions.filter((x) => D.inRange(x.date, from, to)).sort((a, b) => a.date.localeCompare(b.date))) rows.push([t.type, t.date, t.desc, D.catName(t.categoryId), cents(t.amount), st.settings.currency, t.store || '', t.notes || '']);
    for (const l of st.loans) rows.push([`loan ${l.kind}`, l.date, l.desc || '', S.get('people', l.personId)?.name || '', cents(l.amount), st.settings.currency, '', `Outstanding ${cents(D.outstanding(l))}`]);
    FP.download(`financial-report-${from}-to-${to}.csv`, `﻿${FP.toCSV(rows)}`, 'text/csv;charset=utf-8');
    toast('CSV report downloaded.');
  };
  A.exportPdf = async (_, btn) => {
    btn.disabled = true; btn.classList.add('loading');
    try {
      if (!window.jspdf) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jspdf/jspdf.umd.min.js'; s.onload = res; s.onerror = () => rej(new Error('The PDF maker could not load. Check your connection and try again.')); document.head.append(s); });
      const r = reportData(), cur = st.settings.currency;
      // PDF's built-in fonts lack many currency symbols, so amounts use the code: "NPR 1,250.00"
      const amt = (c) => `${cur} ${((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const clean = (s) => String(s ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?');
      const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' }), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 44;
      let y = M;
      const room = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };
      const heading = (t) => { room(40); y += 14; doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(15, 23, 42).text(t, M, y); y += 16; };
      const table = (head, rows, widths) => {
        const line = (cells, bold) => {
          room(16);
          doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(9).setTextColor(30, 41, 59);
          let x = M;
          cells.forEach((c, i) => {
            const w = widths[i] * (W - 2 * M), text = doc.splitTextToSize(clean(c), w - 6)[0] || '';
            if (i === 0) doc.text(text, x, y); else doc.text(text, x + w - 6, y, { align: 'right' });
            x += w;
          });
          y += 14;
        };
        line(head, true);
        doc.setDrawColor(203, 213, 225).line(M, y - 10, W - M, y - 10);
        rows.forEach((row) => line(row));
      };
      doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(15, 23, 42).text('Financial report', M, y + 6);
      y += 26;
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(71, 85, 105).text(`${fmtDate(r.from)} to ${fmtDate(r.to)}. Created ${fmtDate(today())}.`, M, y);
      y += 8;
      heading('Overview');
      table(['', 'Amount'], [['Income', amt(r.totals.income)], ['Expenses', amt(r.totals.expense)], ['Net', amt(r.totals.net)], ['Available balance today', amt(D.balanceAt())], ['Savings in goals', amt(D.totalSavings())], ['Owed to you', amt(D.loanTotals().lent)], ['You owe', amt(D.loanTotals().borrowed)]], [0.65, 0.35]);
      heading('Spending by category');
      table(['Category', 'Share', 'Amount'], r.cats.map((c) => [c.label, r.totals.expense ? `${Math.round((c.value / r.totals.expense) * 100)}%` : '', amt(c.value)]), [0.5, 0.15, 0.35]);
      heading(`Summary by ${r.gran}`);
      table(['Period', 'Income', 'Expenses', 'Net'], r.rows.map((b) => [b.label, amt(b.income), amt(b.expense), amt(b.income - b.expense)]), [0.28, 0.24, 0.24, 0.24]);
      const open = st.loans.filter((l) => D.outstanding(l));
      if (open.length) {
        heading('Outstanding loans');
        table(['Person', 'Type', 'Due', 'Outstanding'], open.map((l) => [S.get('people', l.personId)?.name || '', l.kind, l.dueDate ? fmtDate(l.dueDate) : '-', amt(D.outstanding(l))]), [0.34, 0.16, 0.22, 0.28]);
      }
      const tx = st.transactions.filter((t) => D.inRange(t.date, r.from, r.to)).sort((a, b) => a.date.localeCompare(b.date));
      heading(`Transactions (${tx.length})`);
      table(['Description', 'Date', 'Category', 'Amount'], tx.map((t) => [t.desc || '', t.date, D.catName(t.categoryId), `${t.type === 'income' ? '+' : '-'}${amt(t.amount)}`]), [0.38, 0.16, 0.2, 0.26]);
      FP.download(`financial-report-${r.from}-to-${r.to}.pdf`, doc.output('blob'));
      toast('PDF report downloaded.');
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  };

  /* ---------- settings ---------- */
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'NPR', 'INR', 'AUD', 'CAD', 'JPY', 'CNY', 'SGD', 'AED', 'ZAR', 'BRL', 'MXN', 'CHF', 'SEK', 'NOK', 'NZD', 'KRW', 'PKR', 'BDT', 'LKR'];
  V.settings = (el) => {
    const notif = 'Notification' in window ? Notification.permission : 'unsupported';
    el.innerHTML = `<div class="page-head"><h1>Settings</h1></div>
      <section class="card"><h2>General</h2><form id="genForm" class="form-grid" novalidate>
        <div class="field"><label for="setCur">Currency</label><select id="setCur">${CURRENCIES.map((c) => `<option${st.settings.currency === c ? ' selected' : ''}>${c}</option>`).join('')}</select><small class="hint">Changes the symbol shown. Amounts aren't converted.</small></div>
        <div class="field"><label for="setOpen">Opening balance</label><input id="setOpen" inputmode="decimal" value="${esc(FP.centsToInput(st.settings.openingBalance || 0))}"><small class="hint">Cash you had before your first entry.</small></div>
      </form></section>
      <section class="card"><div class="card-head"><h2>Categories</h2><button class="btn" data-act="catAdd">${icon('plus')}Category</button></div>
        ${['expense', 'income'].map((type) => `<h3>${type === 'expense' ? 'Expenses' : 'Income'}</h3><ul class="chips">${D.catsOf(type).map((c) => `<li><button class="chip" data-act="catEdit" data-id="${esc(c.id)}"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</button></li>`).join('')}</ul>`).join('')}</section>
      <section class="card"><h2>Notifications</h2>
        <p>Reminders always appear under the bell while the planner is open, and any you missed appear the next time you open it.</p>
        <p class="muted small">This is a private site with no server, so it can't wake a closed browser to alert you. Keep the planner open in a tab, or installed on your phone, for the best chance of timely alerts.</p>
        ${notif === 'unsupported' ? '<p class="muted">This browser does not support system notifications.</p>' : notif === 'denied' ? '<p class="text-warn">Notifications are blocked for this site. Allow them in your browser settings.</p>' : `<button class="btn" data-act="notifyToggle">${st.settings.notifyOn && notif === 'granted' ? 'Turn off system notifications' : 'Turn on system notifications'}</button>`}</section>
      <section class="card"><h2>Privacy &amp; security</h2>
        <ul class="ticks"><li>Your records and receipt photos are stored only in this browser, on this device.</li><li>Receipts are read on this device, with nothing sent anywhere. The page's security policy blocks connections to other sites.</li><li>Location and other camera details are removed from receipt photos before saving.</li></ul>
        <h3>Passcode</h3><p class="muted small">Encrypts everything stored here with AES-256, and locks after 10 idle minutes. <b>If you forget it, your data can't be recovered</b>, so keep a backup.</p>
        ${S.locked ? `<div class="btn-row"><button class="btn" data-act="passSet">Change passcode</button><button class="btn" data-act="passOff">Remove passcode</button></div>` : `<button class="btn" data-act="passSet" ${S.memoryOnly ? 'disabled' : ''}>${icon('lock')}Set a passcode</button>`}</section>
      <section class="card"><h2>Backup &amp; other devices</h2>
        <div class="alert info">Your data lives on this device only and does not sync by itself. To use another device, download a backup here and restore it there. Restoring replaces what is on that device, so use one device at a time and move the latest backup across.</div>
        <p class="muted small">Without a backup, clearing browser data or losing this device erases your records.</p>
        <div class="btn-row"><button class="btn primary" data-act="backupMake">${icon('download')}Download backup</button><label class="btn file-btn">${icon('upload')}Restore backup<input id="restoreFile" type="file" accept=".json,application/json"></label></div></section>
      <section class="card danger-zone"><h2>Your data</h2><div class="btn-row">
        ${st.transactions.length ? '' : '<button class="btn" data-act="sampleLoad">Load sample data</button>'}
        <button class="btn danger" data-act="eraseAll">${icon('trash')}Erase everything</button></div></section>`;
    $('#setCur', el).addEventListener('change', (e) => { S.setSetting('currency', e.target.value); toast('Currency updated.'); });
    $('#setOpen', el).addEventListener('change', (e) => {
      const c = e.target.value.trim() ? FP.toCents(e.target.value) : 0;
      if (!Number.isFinite(c)) { e.target.value = FP.centsToInput(st.settings.openingBalance || 0); return toast('Enter a valid amount.', 'warn'); }
      S.setSetting('openingBalance', c);
      toast('Opening balance updated.');
    });
    $('#restoreFile', el).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreFrom(f).catch((err) => toast(err.message || 'That backup could not be restored.', 'bad', 7000)); });
  };
  A.catAdd = () => FP.formDialog({
    title: 'New category', cls: 'narrow', submit: 'Add',
    fields: [
      { name: 'type', label: 'Type', type: 'select', options: [['expense', 'Expense'], ['income', 'Income']], full: true },
      { name: 'name', label: 'Name', required: true, max: 40, full: true, validate: (v, a) => (D.catByName(a.type, v) ? 'That category already exists.' : '') },
      { name: 'color', label: 'Colour', type: 'color', value: '#6366f1', full: true },
    ],
    onSubmit: (v) => { S.add('categories', v); },
  });
  A.catEdit = ({ id }) => {
    const c = S.get('categories', id);
    const used = st.transactions.filter((t) => t.categoryId === id).length + st.recurring.filter((r) => r.categoryId === id).length;
    const hex = /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#6366f1';
    return FP.formDialog({
      title: 'Edit category', cls: 'narrow', values: { ...c, color: hex },
      fields: [
        { name: 'name', label: 'Name', required: true, max: 40, full: true, validate: (v) => { const x = D.catByName(c.type, v); return x && x.id !== id ? 'That category already exists.' : ''; } },
        { name: 'color', label: 'Colour', type: 'color', full: true },
      ],
      footExtra: '<button type="button" class="btn danger-text" data-del>Delete</button>',
      onOpen: (d) => {
        $('[data-del]', d).onclick = async () => {
          const others = D.catsOf(c.type).filter((x) => x.id !== id);
          if (!others.length) return toast('Keep at least one category of each type.', 'warn');
          const fallback = others.find((x) => /^other/i.test(x.name)) || others[0];
          if (!await FP.confirmDialog(`Delete "${c.name}"?${used ? ` ${used} entr${used === 1 ? 'y' : 'ies'} will move to "${fallback.name}".` : ''}`)) return;
          st.transactions.forEach((t) => { if (t.categoryId === id) t.categoryId = fallback.id; });
          st.recurring.forEach((r) => { if (r.categoryId === id) r.categoryId = fallback.id; });
          st.budgets = st.budgets.filter((b) => b.categoryId !== id);
          for (const n of ['transactions', 'recurring', 'budgets']) S.touch(n);
          S.remove('categories', id);
          d.close();
        };
      },
      onSubmit: (v) => { S.update('categories', id, v); },
    });
  };
  A.notifyToggle = async () => {
    if (st.settings.notifyOn && Notification.permission === 'granted') { S.setSetting('notifyOn', false); return; }
    const p = await Notification.requestPermission();
    S.setSetting('notifyOn', p === 'granted');
    FP.render();
    toast(p === 'granted' ? 'System notifications are on.' : 'Notifications were not allowed.', p === 'granted' ? 'ok' : 'warn');
  };
  A.passSet = () => FP.formDialog({
    title: S.locked ? 'Change passcode' : 'Set a passcode', cls: 'narrow', submit: 'Encrypt my data',
    fields: [
      { name: 'p1', label: 'New passcode', type: 'password', required: true, full: true, hint: 'At least 8 characters.', validate: (v) => (v.length < 8 ? 'Use at least 8 characters.' : '') },
      { name: 'p2', label: 'Repeat it', type: 'password', required: true, full: true, validate: (v, a) => (v !== a.p1 ? 'The two passcodes do not match.' : '') },
      { name: 'ok', label: 'I understand that a forgotten passcode means my data is lost', type: 'checkbox', full: true },
    ],
    onSubmit: async (v) => {
      if (!v.ok) throw new Error('Please confirm that you understand this first.');
      await S.setPasscode(v.p1);
      toast('Your data is now encrypted.');
      FP.render();
    },
  });
  A.passOff = async () => {
    if (!await FP.confirmDialog('Remove the passcode? Your data will be stored unencrypted on this device.', { yes: 'Remove' })) return;
    await S.removePasscode();
    toast('Passcode removed.');
    FP.render();
  };
  A.backupMake = () => FP.formDialog({
    title: 'Download backup', submit: 'Download', cls: 'narrow',
    fields: [
      { name: 'p1', label: 'Backup password', type: 'password', full: true, hint: 'Recommended, because backups hold all your financial records. There is no way to recover a lost password.', validate: (v) => (v.length < 8 ? 'Use at least 8 characters, or leave this empty.' : '') },
      { name: 'p2', label: 'Repeat password', type: 'password', full: true, checkEmpty: true, validate: (v, a) => (v !== a.p1 ? 'The passwords do not match.' : '') },
    ],
    onSubmit: async (v) => {
      const text = await S.buildBackup(v.p1 || null);
      FP.download(`financial-planner-backup-${today()}.json`, text, 'application/json');
      toast(v.p1 ? 'Encrypted backup downloaded.' : 'Backup downloaded. It is not encrypted, so store it safely.', v.p1 ? 'ok' : 'warn', 6000);
    },
  });
  async function restoreFrom(file) {
    if (file.size > 500 * 1048576) throw new Error('That file is too large to be a backup.');
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { throw new Error('This file is not a valid backup.'); }
    if (S.isEncrypted(obj)) {
      await FP.formDialog({
        title: 'This backup is encrypted', submit: 'Unlock', cls: 'narrow',
        fields: [{ name: 'p', label: 'Backup password', type: 'password', required: true, full: true }],
        onSubmit: async (v) => { obj = await S.decryptBackup(obj, v.p); },
      });
      if (S.isEncrypted(obj)) return;
    }
    const clean = S.sanitizeBackup(obj);
    const when = obj.exportedAt ? fmtDate(FP.toISO(new Date(obj.exportedAt))) : 'an unknown date';
    if (!await FP.confirmDialog(`Replace everything on this device with this backup from ${when}? It holds ${clean.data.transactions.length} transactions and ${clean.receipts.length} receipt images. What's here now will be lost.`, { title: 'Restore backup?', yes: 'Replace my data' })) return;
    await S.restore(clean);
    D.seedCategories();
    toast('Backup restored.');
    FP.render();
  }
  A.eraseAll = async () => {
    if (!await FP.confirmDialog('Erase every record, receipt and setting on this device? This cannot be undone. Download a backup first if you may want them later.', { title: 'Erase everything?', yes: 'Erase everything' })) return;
    await S.eraseAll();
    location.hash = '';
    location.reload();
  };
})();
