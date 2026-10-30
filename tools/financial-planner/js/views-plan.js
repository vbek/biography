/* Financial Planner — to-do list, calendar and the grocery planner. */
(() => {
  'use strict';
  const { $, $$, esc, icon, money, store: S, domain: D, today, addDays, addMonths, monthStart, monthEnd, weekStart, fmtDate, fmtDay, fmtTime, relDay, toast } = FP;
  const st = S.state, A = FP.actions, V = FP.views;

  /* ---------- to-do ---------- */
  const PRIORITY = { high: 0, medium: 1, low: 2 };
  const tf = { show: 'pending', cat: '', sort: 'due', q: '' };
  const taskCats = () => [...new Set(st.tasks.map((t) => t.category).filter(Boolean))].sort();
  function drawTasks(el) {
    const now = today(), q = tf.q.toLowerCase();
    const rows = st.tasks.filter((t) => (tf.show === 'all' || (tf.show === 'done') === !!t.done) && (!tf.cat || t.category === tf.cat) && (!q || `${t.title} ${t.notes || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => (tf.sort === 'priority' ? PRIORITY[a.priority] - PRIORITY[b.priority] : tf.sort === 'title' ? a.title.localeCompare(b.title) : (a.due || '9').localeCompare(b.due || '9')) || (PRIORITY[a.priority] - PRIORITY[b.priority]));
    $('#taskList', el).innerHTML = rows.length ? `<ul class="rows">${rows.map((t) => `<li class="row ${t.done ? 'done' : ''}">
      <label class="task-check"><input type="checkbox" data-act="taskToggle" data-id="${esc(t.id)}"${t.done ? ' checked' : ''} aria-label="Mark ${esc(t.title)} ${t.done ? 'not done' : 'done'}"></label>
      <button class="row-main" data-act="taskEdit" data-id="${esc(t.id)}"><b>${esc(t.title)}</b><small class="${!t.done && t.due && t.due < now ? 'text-bad' : ''}">${t.due ? `${t.due < now && !t.done ? 'Overdue · ' : ''}${esc(relDay(t.due))}` : 'No due date'}${t.category ? ` · ${esc(t.category)}` : ''}</small></button>
      <span class="pill ${esc(t.priority)}">${esc(t.priority)}</span></li>`).join('')}</ul>`
      : FP.emptyState('check', st.tasks.length ? 'Nothing here' : 'No tasks yet', st.tasks.length ? 'Try a different filter.' : 'Add your first task to get started.');
  }
  V.tasks = (el) => {
    const pending = st.tasks.filter((t) => !t.done).length, done = st.tasks.length - pending;
    el.innerHTML = `<div class="page-head"><h1>To-do</h1><button class="btn primary" data-act="taskAdd">${icon('plus')}Add task</button></div>
      <p class="muted">${pending} pending · ${done} completed${done ? ` · <button class="link" data-act="taskClearDone">Clear completed</button>` : ''}</p>
      <section class="card filters">
        <input id="tQ" type="search" placeholder="Search tasks" aria-label="Search tasks" value="${esc(tf.q)}">
        <select id="tShow" aria-label="Status">${[['pending', 'Pending'], ['done', 'Completed'], ['all', 'All']].map(([v, l]) => `<option value="${v}"${tf.show === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <select id="tCat" aria-label="Category"><option value="">All categories</option>${taskCats().map((c) => `<option${tf.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="tSort" aria-label="Sort by">${[['due', 'Sort by due date'], ['priority', 'Sort by priority'], ['title', 'Sort by name']].map(([v, l]) => `<option value="${v}"${tf.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </section>
      <section class="card" id="taskList"></section>`;
    for (const [id, key, ev] of [['#tQ', 'q', 'input'], ['#tShow', 'show', 'change'], ['#tCat', 'cat', 'change'], ['#tSort', 'sort', 'change']]) $(id, el).addEventListener(ev, (e) => { tf[key] = e.target.value; drawTasks(el); });
    drawTasks(el);
  };
  function taskForm(t, preset = {}) {
    return FP.formDialog({
      title: t ? 'Edit task' : 'Add task',
      values: t || preset,
      fields: [
        { name: 'title', label: 'Task', required: true, max: 140, full: true },
        { name: 'due', label: 'Due date', type: 'date' },
        { name: 'priority', label: 'Priority', type: 'select', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], value: 'medium' },
        { name: 'category', label: 'Category', list: taskCats(), max: 40, placeholder: 'Home, Work, Finance…' },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true },
        ...(t ? [{ name: 'done', label: 'Completed', type: 'checkbox' }] : []),
      ],
      footExtra: t ? '<button type="button" class="btn danger-text" data-del>Delete</button>' : '',
      onOpen: (d) => {
        const del = $('[data-del]', d);
        if (del) del.onclick = async () => { if (await FP.confirmDialog(`Delete the task "${t.title}"?`)) { S.remove('tasks', t.id); d.close(); toast('Task deleted.'); } };
      },
      onSubmit: (v) => {
        if (t) S.update('tasks', t.id, { ...v, doneAt: v.done ? t.doneAt || Date.now() : null });
        else S.add('tasks', { ...v, done: false });
      },
    });
  }
  A.taskAdd = (d = {}) => taskForm(null, d.date ? { due: d.date } : {});
  A.taskEdit = ({ id }) => { const t = S.get('tasks', id); if (t) return taskForm(t); };
  A.taskToggle = ({ id }) => { const t = S.get('tasks', id); if (t) S.update('tasks', id, { done: !t.done, doneAt: t.done ? null : Date.now() }); };
  A.taskClearDone = async () => {
    const n = st.tasks.filter((t) => t.done).length;
    if (await FP.confirmDialog(`Delete ${n} completed task${n === 1 ? '' : 's'}?`, { yes: 'Clear' })) { st.tasks = st.tasks.filter((t) => !t.done); S.touch('tasks'); }
  };

  /* ---------- calendar ---------- */
  let calMode = 'month', calDate = null;
  const KIND = { event: ['Event', 'k-event'], grocery: ['Groceries', 'k-grocery'], bill: ['Bill', 'k-bill'], income: ['Income', 'k-income'], task: ['Task', 'k-task'], loan: ['Loan', 'k-loan'] };
  const chip = (r) => `<button class="cal-item ${KIND[r.kind][1]}" data-act="calOpen" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}" data-date="${esc(r.date)}" data-rec="${r.recurring ? 1 : ''}" title="${esc(r.title)}">${r.time ? `<small>${esc(fmtTime(r.time))}</small> ` : ''}${esc(r.title)}</button>`;
  function agendaRow(r) {
    return `<li class="row"><button class="row-main" data-act="calOpen" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}" data-date="${esc(r.date)}" data-rec="${r.recurring ? 1 : ''}"><b>${esc(r.title)}</b><small>${r.time ? `${esc(fmtTime(r.time))} · ` : ''}${esc(r.sub)}</small></button><span class="pill ${KIND[r.kind][1]}">${esc(KIND[r.kind][0])}</span></li>`;
  }
  V.calendar = (el, param) => {
    if (param && FP.isDate(param) && param !== V.calendar.lastParam) { calDate = param; calMode = 'day'; }
    V.calendar.lastParam = param;
    calDate ||= today();
    const now = today();
    let title, body;
    if (calMode === 'month') {
      const first = monthStart(calDate), start = weekStart(first), last = monthEnd(calDate), end = addDays(weekStart(last), 6);
      const items = D.agenda(start, end), by = new Map();
      for (const r of items) { if (!by.has(r.date)) by.set(r.date, []); by.get(r.date).push(r); }
      title = FP.fmtMonth(calDate);
      const days = [];
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const list = by.get(d) || [];
        days.push(`<div class="cal-day ${d < first || d > last ? 'out' : ''} ${d === now ? 'today' : ''}">
          <button class="cal-num" data-act="calDay" data-date="${d}" aria-label="${esc(fmtDate(d, { dateStyle: 'full' }))}, ${list.length} item${list.length === 1 ? '' : 's'}">${FP.parse(d).getDate()}</button>
          <div class="cal-items">${list.slice(0, 3).map(chip).join('')}${list.length > 3 ? `<button class="cal-more" data-act="calDay" data-date="${d}">+${list.length - 3} more</button>` : ''}</div>
          <button class="cal-dots" data-act="calDay" data-date="${d}" tabindex="-1" aria-hidden="true">${list.slice(0, 4).map((r) => `<i class="${KIND[r.kind][1]}"></i>`).join('')}</button></div>`);
      }
      const names = [0, 1, 2, 3, 4, 5, 6].map((i) => fmtDate(addDays('2024-01-01', i), { weekday: 'short' }));
      body = `<div class="cal-grid" role="grid">${names.map((n) => `<div class="cal-name">${esc(n)}</div>`).join('')}${days.join('')}</div>`;
    } else if (calMode === 'week') {
      const start = weekStart(calDate), end = addDays(start, 6), items = D.agenda(start, end);
      title = `${fmtDate(start, { day: 'numeric', month: 'short' })} – ${fmtDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
      const cols = [];
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const list = items.filter((r) => r.date === d);
        cols.push(`<div class="week-day ${d === now ? 'today' : ''}"><button class="week-head" data-act="calDay" data-date="${d}">${esc(fmtDay(d))}</button>${list.length ? list.map(chip).join('') : '<small class="muted">Free</small>'}</div>`);
      }
      body = `<div class="week-grid">${cols.join('')}</div>`;
    } else {
      const items = D.agenda(calDate, calDate);
      title = fmtDate(calDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      body = items.length ? `<ul class="rows">${items.map(agendaRow).join('')}</ul>` : FP.emptyState('cal', 'Nothing planned', 'This day is free.', `<button class="btn primary" data-act="eventAdd" data-date="${calDate}">Add event</button>`);
    }
    const upcoming = D.agenda(now, addDays(now, 21)).slice(0, 10);
    el.innerHTML = `<div class="page-head"><h1>Calendar</h1><div class="btn-row"><button class="btn" data-act="eventAddGrocery" data-date="${calDate}">${icon('cart')}Grocery shop</button><button class="btn primary" data-act="eventAdd" data-date="${calDate}">${icon('plus')}Event</button></div></div>
      <section class="card">
        <div class="cal-bar">
          <div class="btn-row"><button class="icon-btn" data-act="calMove" data-n="-1" aria-label="Previous">${icon('back')}</button><button class="btn subtle" data-act="calToday">Today</button><button class="icon-btn" data-act="calMove" data-n="1" aria-label="Next">${icon('next')}</button></div>
          <h2 aria-live="polite">${esc(title)}</h2>
          <div class="seg" role="group" aria-label="Calendar view">${[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([m, l]) => `<button data-act="calMode" data-m="${m}" class="${calMode === m ? 'on' : ''}" aria-pressed="${calMode === m}">${l}</button>`).join('')}</div>
        </div>
        ${body}
        <div class="legend cal-legend">${Object.values(KIND).map(([l, c]) => `<span><i class="${c}"></i>${esc(l)}</span>`).join('')}</div>
      </section>
      <section class="card"><h2>Coming up</h2>${upcoming.length ? `<ul class="rows">${upcoming.map((r) => agendaRow({ ...r, sub: `${relDay(r.date)} · ${r.sub}` })).join('')}</ul>` : '<p class="muted">Nothing in the next three weeks.</p>'}</section>`;
  };
  A.calMode = ({ m }) => { calMode = m; FP.render(); };
  A.calToday = () => { calDate = today(); FP.render(); };
  A.calDay = ({ date }) => { calDate = date; calMode = 'day'; FP.render(); };
  A.calMove = ({ n }) => {
    const k = Number(n);
    calDate = calMode === 'month' ? addMonths(monthStart(calDate), k) : addDays(calDate, calMode === 'week' ? 7 * k : k);
    FP.render();
  };
  A.calOpen = ({ kind, id, date, rec }) => {
    if (kind === 'task') return A.taskEdit({ id });
    if (kind === 'loan') return FP.go(`people/${id}`);
    if (rec) return FP.go('recurring');
    return eventDetail(id, date);
  };
  function eventForm(ev, preset = {}) {
    const templates = st.groceryLists.filter((l) => l.isTemplate);
    const recent = st.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
    const linkedNow = ev ? st.transactions.find((t) => t.eventId === ev.id) : null;
    return FP.formDialog({
      title: ev ? 'Edit event' : 'Add event',
      values: ev ? { ...ev, linkTxn: linkedNow?.id || '' } : preset,
      fields: [
        { name: 'title', label: 'Title', required: true, max: 120, full: true },
        { name: 'type', label: 'Type', type: 'select', options: D.EVENT_TYPES, value: 'event' },
        { name: 'date', label: 'Date', type: 'date', required: true, value: today() },
        { name: 'time', label: 'Time', type: 'time', hint: 'Leave empty for all day.' },
        { name: 'recur', label: 'Repeats', type: 'select', options: [['', 'Does not repeat'], ...D.FREQS] },
        { name: 'until', label: 'Repeat until', type: 'date', when: (v) => !!v.recur, validate: (u, all) => (u && u < all.date ? 'This must be after the start date.' : '') },
        { name: 'notifyAt', label: 'Notify me on', type: 'datetime-local', hint: 'Date and time of the reminder.' },
        { name: 'templateId', label: 'Start from reusable list', type: 'select', options: [['', 'Recommendations only'], ...templates.map((l) => [l.id, l.name])], when: (v) => v.type === 'grocery' },
        { name: 'linkTxn', label: 'Linked transaction', type: 'select', options: [['', 'None'], ...recent.map((t) => [t.id, `${t.desc || D.catName(t.categoryId)} · ${money(t.amount)} · ${fmtDate(t.date)}`])], when: (v) => v.type !== 'grocery' },
        { name: 'notes', label: 'Notes', type: 'textarea', full: true },
      ],
      onSubmit: (v) => {
        const { linkTxn, ...data } = v;
        data.templateId ||= null;
        const rec = ev ? S.update('events', ev.id, data) : S.add('events', { ...data, skips: [] });
        if (linkedNow && linkedNow.id !== linkTxn) S.update('transactions', linkedNow.id, { eventId: null });
        if (linkTxn) S.update('transactions', linkTxn, { eventId: rec.id });
        if (rec.type === 'grocery') {
          const next = D.eventOccurrences(rec, today(), addDays(today(), 400))[0] || rec.date;
          const fresh = !st.groceryLists.some((l) => l.eventId === rec.id && l.date === next);
          const list = D.ensureEventList(rec, next);
          if (fresh) toast(list.items.length ? `Shopping list created with ${list.items.length} recommended item${list.items.length === 1 ? '' : 's'}.` : 'Shopping list created. It will fill with recommendations as you shop.');
          FP.go(`grocery/${list.id}`);
        } else toast('Saved to your calendar.');
      },
    });
  }
  A.eventAdd = (d = {}) => eventForm(null, { date: d.date || today() });
  A.eventAddGrocery = (d = {}) => eventForm(null, { date: d.date || today(), type: 'grocery', title: 'Grocery shopping' });
  function eventDetail(id, date) {
    const ev = S.get('events', id);
    if (!ev) return;
    const linked = st.transactions.filter((t) => t.eventId === id);
    const list = ev.type === 'grocery' ? D.ensureEventList(ev, date) : null;
    const d = FP.openDialog(`<div class="modal-head"><h2>${esc(ev.title)}</h2><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body"><p>${esc(fmtDate(date, { dateStyle: 'full' }))}${ev.time ? ` at ${esc(fmtTime(ev.time))}` : ''}</p>
      <p class="muted small">${esc(D.EVENT_TYPES.find((x) => x[0] === ev.type)?.[1] || 'Event')}${ev.recur ? ` · Repeats ${esc(D.freqLabel(ev.recur).toLowerCase())}` : ''}${ev.notifyAt ? ` · Reminder set` : ''}</p>
      ${ev.notes ? `<p class="pre">${esc(ev.notes)}</p>` : ''}
      ${list ? `<a class="btn wide primary" href="#grocery/${esc(list.id)}" data-x>${icon('cart')}Open shopping list (${list.items.length})</a>` : ''}
      <h3>Linked transactions</h3>${FP.txRows(linked) || '<p class="muted small">None yet.</p>'}
      <button class="btn subtle" data-add-exp>${icon('plus')}Add expense for this event</button></div>
      <div class="modal-foot"><button class="btn danger-text" data-del>Delete</button>${ev.recur ? '<button class="btn subtle" data-skip>Skip this date</button>' : ''}<span class="grow"></span><button class="btn primary" data-edit>Edit</button></div>`);
    $$('[data-x]', d).forEach((x) => x.addEventListener('click', () => d.close()));
    $('[data-edit]', d).onclick = () => { d.close(); eventForm(ev); };
    $('[data-add-exp]', d).onclick = () => { d.close(); FP.txForm('expense', null, { eventId: id, desc: ev.title, date, ...(ev.type === 'grocery' ? { categoryId: D.groceryCat().id } : {}) }); };
    const skip = $('[data-skip]', d);
    if (skip) skip.onclick = async () => { if (await FP.confirmDialog(`Skip ${fmtDate(date)} only? Later dates stay on your calendar.`, { yes: 'Skip', danger: false })) { S.update('events', id, { skips: [...(ev.skips || []), date] }); d.close(); } };
    $('[data-del]', d).onclick = async () => {
      if (!await FP.confirmDialog(`Delete "${ev.title}"${ev.recur ? ' and all its repeats' : ''}? Linked transactions and finished shopping lists are kept.`)) return;
      st.groceryLists = st.groceryLists.filter((l) => !(l.eventId === id && l.status !== 'done'));
      S.touch('groceryLists');
      for (const t of linked) S.update('transactions', t.id, { eventId: null });
      S.remove('events', id);
      d.close();
      toast('Event deleted.');
    };
  }

  /* ---------- grocery planner ---------- */
  const listTotal = (l) => l.items.reduce((s, i) => s + (Number.isInteger(i.price) ? Math.round(i.price * (i.qty || 1)) : 0), 0);
  let groceryTab = 'lists';
  V.grocery = (el, param) => {
    const list = param && S.get('groceryLists', param);
    if (list) return drawList(el, list);
    const open = st.groceryLists.filter((l) => !l.isTemplate && l.status !== 'done').sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
    const done = st.groceryLists.filter((l) => !l.isTemplate && l.status === 'done').sort((a, b) => (b.doneOn || '').localeCompare(a.doneOn || '')).slice(0, 12);
    const tpl = st.groceryLists.filter((l) => l.isTemplate);
    const card = (l) => `<li class="row"><a class="row-main" href="#grocery/${esc(l.id)}"><b>${esc(l.name)}</b><small>${l.isTemplate ? 'Reusable' : l.status === 'done' ? `Finished ${esc(fmtDate(l.doneOn))}` : l.date ? esc(relDay(l.date)) : 'No date'} · ${l.items.length} item${l.items.length === 1 ? '' : 's'}${l.eventId ? ' · On calendar' : ''}</small></a>${listTotal(l) ? `<b>~${esc(money(listTotal(l)))}</b>` : ''}</li>`;
    const items = st.groceryItems.slice().sort((a, b) => a.name.localeCompare(b.name));
    el.innerHTML = `<div class="page-head"><h1>Groceries</h1><div class="btn-row"><button class="btn" data-act="listNew">${icon('plus')}New list</button><button class="btn primary" data-act="eventAddGrocery">${icon('cal')}Plan a shop</button></div></div>
      <div class="seg tabs-inline" role="group">${[['lists', 'Lists'], ['items', `Remembered items (${items.length})`]].map(([t, l]) => `<button data-act="groceryTab" data-t="${t}" class="${groceryTab === t ? 'on' : ''}" aria-pressed="${groceryTab === t}">${esc(l)}</button>`).join('')}</div>
      ${groceryTab === 'lists' ? `
        <section class="card"><h2>To shop</h2>${open.length ? `<ul class="rows">${open.map(card).join('')}</ul>` : FP.emptyState('cart', 'No open lists', 'Plan a shop on the calendar, and a list is built from what you usually buy.', '<button class="btn primary" data-act="eventAddGrocery">Plan a shop</button>')}</section>
        <section class="card"><h2>Reusable lists</h2>${tpl.length ? `<ul class="rows">${tpl.map(card).join('')}</ul>` : '<p class="muted">Open any list and choose "Save as reusable" to keep it for later.</p>'}</section>
        <section class="card"><h2>Finished</h2>${done.length ? `<ul class="rows">${done.map(card).join('')}</ul>` : '<p class="muted">Finished shops will appear here.</p>'}</section>` : `
        <section class="card">${items.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th>Usual qty</th><th>Last price</th><th>Average</th><th>Bought</th><th></th></tr></thead><tbody>${items.map((i) => {
    const p = D.priceStats(i);
    return `<tr><td>${esc(i.name)}</td><td>${esc(i.qty)} ${esc(i.unit || '')}</td><td>${p ? esc(money(p.last)) : '–'}</td><td>${p ? esc(money(p.avg)) : '–'}</td><td>${(i.history || []).length}×</td><td class="right"><button class="icon-btn" data-act="itemEdit" data-id="${esc(i.id)}" aria-label="Edit ${esc(i.name)}">${icon('edit')}</button></td></tr>`;
  }).join('')}</tbody></table></div>` : FP.emptyState('cart', 'Nothing remembered yet', 'Items from lists and scanned receipts are remembered here.')}</section>`}`;
  };
  A.groceryTab = ({ t }) => { groceryTab = t; FP.render(); };
  A.listNew = () => {
    const tpl = st.groceryLists.filter((l) => l.isTemplate);
    return FP.formDialog({
      title: 'New shopping list', submit: 'Create',
      fields: [
        { name: 'name', label: 'Name', required: true, max: 80, value: 'Shopping list', full: true },
        { name: 'templateId', label: 'Start from', type: 'select', options: [['', 'Empty list'], ...tpl.map((l) => [l.id, l.name])] },
        { name: 'rec', label: 'Add recommended items', type: 'checkbox', value: true },
      ],
      onSubmit: (v) => { const l = D.makeList({ name: v.name, date: today(), templateId: v.templateId || null, withRecommendations: v.rec }); FP.go(`grocery/${l.id}`); },
    });
  };
  A.itemEdit = ({ id }) => {
    const i = S.get('groceryItems', id);
    if (!i) return;
    const history = (i.history || []).slice().reverse().slice(0, 12);
    return FP.formDialog({
      title: i.name, values: i,
      fields: [
        { name: 'qty', label: 'Usual quantity', type: 'number', min: 0.01, step: 'any', required: true },
        { name: 'unit', label: 'Unit', max: 16, placeholder: 'kg, pack…' },
        { name: 'note', label: 'Note', full: true, max: 200 },
        { name: 'skipRecommend', label: 'Stop recommending this item', type: 'checkbox', full: true },
      ],
      extra: history.length ? `<h3>Purchase history</h3><div class="table-wrap"><table class="mini"><thead><tr><th>Date</th><th>Qty</th><th>Unit price</th><th>Store</th></tr></thead><tbody>${history.map((h) => `<tr><td>${esc(fmtDate(h.date))}</td><td>${esc(h.qty)}</td><td>${Number.isInteger(h.price) ? esc(money(h.price)) : '–'}</td><td>${esc(h.store)}</td></tr>`).join('')}</tbody></table></div>` : '',
      footExtra: '<button type="button" class="btn danger-text" data-del>Forget item</button>',
      onOpen: (d) => { $('[data-del]', d).onclick = async () => { if (await FP.confirmDialog(`Forget "${i.name}" and its price history? Your expenses are not affected.`, { yes: 'Forget' })) { S.remove('groceryItems', id); d.close(); } }; },
      onSubmit: (v) => { S.update('groceryItems', id, v); },
    });
  };

  function priceHint(it) {
    if (!Number.isInteger(it.lastPrice)) return '';
    if (Number.isInteger(it.price) && it.price !== it.lastPrice) {
      const up = it.price > it.lastPrice;
      return `<small class="${up ? 'text-bad' : 'text-good'}">Was ${esc(money(it.lastPrice))} (${up ? '+' : '-'}${esc(money(Math.abs(it.price - it.lastPrice)))})</small>`;
    }
    return `<small class="muted">Last paid ${esc(money(it.lastPrice))}</small>`;
  }
  function drawList(el, l) {
    const items = l.items.slice().sort((a, b) => Number(a.purchased) - Number(b.purchased));
    const bought = l.items.filter((i) => i.purchased).length, known = st.groceryItems.map((i) => i.name);
    const locked = l.status === 'done';
    el.innerHTML = `<a class="back-link" href="#grocery">${icon('back')}All lists</a>
      <div class="page-head"><div><h1>${esc(l.name)}</h1><p class="muted">${l.isTemplate ? 'Reusable list' : l.date ? esc(fmtDate(l.date, { dateStyle: 'full' })) : 'No date'}${l.eventId ? ` · <a href="#calendar/${esc(l.date)}">On your calendar</a>` : ''}${locked ? ' · Finished' : ''}</p></div>
        <div class="btn-row">${!l.isTemplate && !locked ? `<button class="btn primary" data-act="listFinish" data-id="${esc(l.id)}">${icon('check')}Finish shopping</button>` : ''}<button class="btn" data-act="listReuse" data-id="${esc(l.id)}">${l.isTemplate ? 'Use this list' : 'Save as reusable'}</button><button class="btn danger-text" data-act="listDelete" data-id="${esc(l.id)}">Delete</button></div></div>
      <section class="stats small-stats"><div class="stat"><span>Items</span><b>${bought} / ${l.items.length}</b><small>In the cart</small></div><div class="stat"><span>Estimated</span><b>${esc(money(listTotal(l)))}</b><small>From entered prices</small></div></section>
      ${locked ? '' : `<form class="card add-item" id="addItem" novalidate><input name="name" list="knownItems" placeholder="Add an item" aria-label="Item name" maxlength="80" autocomplete="off"><datalist id="knownItems">${known.map((n) => `<option value="${esc(n)}">`).join('')}</datalist><input name="qty" inputmode="decimal" value="1" aria-label="Quantity"><input name="unit" placeholder="Unit" aria-label="Unit" maxlength="16"><button class="btn primary">${icon('plus')}Add</button></form>
      ${l.isTemplate ? '' : `<div class="btn-row"><button class="btn subtle" data-act="listRefresh" data-id="${esc(l.id)}">Refresh recommendations</button></div>`}`}
      <section class="card">${items.length ? `<ul class="g-items">${items.map((i) => `<li class="g-item ${i.purchased ? 'bought' : ''}" data-item="${esc(i.id)}">
        <label class="task-check"><input type="checkbox" data-k="purchased"${i.purchased ? ' checked' : ''}${locked ? ' disabled' : ''} aria-label="Mark ${esc(i.name)} as purchased"></label>
        <div class="g-main"><b>${esc(i.name)}</b>${i.recommended ? `<small class="muted">${esc(i.reason || 'Recommended')}</small>` : ''}${priceHint(i)}
          <input class="g-note" data-k="note" value="${esc(i.note)}" placeholder="Add a note" aria-label="Note for ${esc(i.name)}" maxlength="200"${locked ? ' disabled' : ''}></div>
        <div class="g-fields"><label>Qty<input data-k="qty" inputmode="decimal" value="${esc(i.qty)}"${locked ? ' disabled' : ''}></label><label>Each<input data-k="price" inputmode="decimal" value="${esc(FP.centsToInput(i.price))}" placeholder="0.00"${locked ? ' disabled' : ''}></label></div>
        ${locked ? '' : `<button class="icon-btn" data-remove aria-label="Remove ${esc(i.name)}">${icon('x')}</button>`}</li>`).join('')}</ul>` : FP.emptyState('cart', 'This list is empty', 'Add what you need above.')}</section>`;
    const form = $('#addItem', el);
    if (form) form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim(), qty = Number(form.elements.qty.value), unit = form.elements.unit.value.trim();
      if (!name) { form.elements.name.focus(); return toast('Enter an item name.', 'warn'); }
      if (!(qty > 0)) { form.elements.qty.focus(); return toast('Enter a quantity above zero.', 'warn'); }
      if (l.items.some((i) => D.normName(i.name) === D.normName(name))) return toast(`${name} is already on this list.`, 'warn');
      const memory = D.rememberItem(name, { qty, ...(unit ? { unit } : {}) });
      l.items.push({ ...D.listItemFrom(memory, ''), qty, unit: unit || memory.unit || '' });
      S.touch('groceryLists');
      setTimeout(() => $('#addItem [name=name]')?.focus(), 40);
    });
    // edits save as they happen, so a shopper with a poor signal or a locked phone loses nothing
    $$('.g-item', el).forEach((row) => {
      const it = l.items.find((x) => x.id === row.dataset.item);
      row.addEventListener('change', (e) => {
        const k = e.target.dataset.k;
        if (!k) return;
        if (k === 'purchased') it.purchased = e.target.checked;
        else if (k === 'note') { it.note = e.target.value.trim(); D.rememberItem(it.name, { note: it.note }); }
        else if (k === 'qty') {
          const q = Number(e.target.value);
          if (!(q > 0)) { e.target.value = it.qty; return toast('Enter a quantity above zero.', 'warn'); }
          it.qty = q;
          D.rememberItem(it.name, { qty: q });
        } else if (k === 'price') {
          const c = e.target.value.trim() ? FP.toCents(e.target.value) : null;
          if (c !== null && !(c >= 0)) { e.target.value = FP.centsToInput(it.price); return toast('Enter a valid price.', 'warn'); }
          it.price = c;
        }
        S.touch('groceryLists');
      });
      const rm = $('[data-remove]', row);
      if (rm) rm.onclick = () => { l.items = l.items.filter((x) => x.id !== it.id); S.touch('groceryLists'); };
    });
  }
  A.listRefresh = ({ id }) => {
    const l = S.get('groceryLists', id);
    const have = new Set(l.items.map((i) => D.normName(i.name)));
    const add = D.recommend(l.date || today()).filter((r) => !have.has(r.item.key));
    add.forEach((r) => l.items.push(D.listItemFrom(r.item, r.reason)));
    S.touch('groceryLists');
    toast(add.length ? `${add.length} item${add.length === 1 ? '' : 's'} added.` : 'No new recommendations right now.', 'info');
  };
  A.listReuse = ({ id }) => {
    const l = S.get('groceryLists', id);
    if (l.isTemplate) { const n = D.makeList({ name: l.name, date: today(), templateId: id, withRecommendations: false }); return FP.go(`grocery/${n.id}`); }
    return FP.formDialog({
      title: 'Save as reusable list', cls: 'narrow', submit: 'Save',
      fields: [{ name: 'name', label: 'Name', required: true, max: 80, value: l.name, full: true }],
      onSubmit: (v) => {
        S.add('groceryLists', { name: v.name, isTemplate: true, status: 'open', date: null, eventId: null, items: l.items.map((i) => ({ ...i, id: FP.uid(), purchased: false, recommended: false, reason: '' })) });
        toast('Saved. You can use it when planning a shop.');
      },
    });
  };
  A.listDelete = async ({ id }) => {
    const l = S.get('groceryLists', id);
    if (!await FP.confirmDialog(`Delete the list "${l.name}"?${l.status === 'done' ? ' Its expense and price history are kept.' : ''}`)) return;
    S.remove('groceryLists', id);
    FP.go('grocery');
    toast('List deleted.');
  };
  A.listFinish = ({ id }) => {
    const l = S.get('groceryLists', id);
    const d = FP.openDialog(`<div class="modal-head"><h2>Finish shopping</h2><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body"><p>Scan the receipt to record exact prices, or save the expense using the prices on your list.</p>
      <a class="btn primary wide" href="#scan/${esc(id)}" data-x>${icon('scan')}Scan the receipt</a>
      <button class="btn wide" data-manual>Save without a receipt</button></div>`, 'narrow');
    $$('[data-x]', d).forEach((x) => x.addEventListener('click', () => d.close()));
    $('[data-manual]', d).onclick = () => {
      d.close();
      const bought = l.items.filter((i) => i.purchased);
      if (!bought.length) return toast('Tick the items you bought first, or scan your receipt.', 'warn');
      const est = bought.reduce((s, i) => s + (Number.isInteger(i.price) ? Math.round(i.price * i.qty) : 0), 0);
      return FP.formDialog({
        title: 'Save the shop', submit: 'Save expense', cls: 'narrow',
        fields: [
          { name: 'amount', label: 'Total paid', type: 'money', required: true, value: est || null, full: true },
          { name: 'store', label: 'Store', max: 80, full: true },
          { name: 'date', label: 'Date', type: 'date', required: true, value: today(), full: true },
        ],
        onSubmit: (v) => {
          const before = FP.budgetLevels();
          const t = S.add('transactions', { type: 'expense', amount: v.amount, date: v.date, desc: v.store ? `Groceries at ${v.store}` : l.name, store: v.store, categoryId: D.groceryCat().id, listId: l.id, eventId: l.eventId || null, items: bought.map((i) => ({ id: i.id, name: i.name, qty: i.qty, total: Number.isInteger(i.price) ? Math.round(i.price * i.qty) : 0 })) });
          D.finishList(l, { txnId: t.id, date: v.date, store: v.store });
          FP.budgetCheck(t, before);
          toast('Shopping finished and expense saved.');
        },
      });
    };
  };
})();
