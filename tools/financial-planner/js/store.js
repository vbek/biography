/* Financial Planner — storage. Everything stays in this browser's IndexedDB. An optional passcode encrypts it at rest
   with AES-256-GCM, and the same scheme protects backup files. */
(() => {
  'use strict';
  const DB_NAME = 'fp-planner', ITER = 310000;
  const COLS = ['transactions', 'categories', 'tasks', 'events', 'people', 'loans', 'budgets', 'goals', 'recurring', 'groceryItems', 'groceryLists', 'notifications'];
  const SETTING_KEYS = ['currency', 'openingBalance', 'fired', 'notifyOn', 'seeded'];
  const state = { settings: { currency: 'USD', openingBalance: 0, fired: {}, notifyOn: false } };
  COLS.forEach((c) => { state[c] = []; });

  let db = null, key = null, lockInfo = null, memoryOnly = false, receiptsMem = new Map();
  const dirty = new Set();
  let timer = 0, onError = () => {};
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('fp-planner') : null;

  /* ---------- IndexedDB wrappers ---------- */
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { for (const s of ['data', 'receipts', 'meta']) r.result.createObjectStore(s); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('The planner is open in another tab that needs closing.'));
    });
  }
  const tx = (store, mode = 'readonly') => db.transaction(store, mode).objectStore(store);
  const put = (store, k, v) => new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(v, k);
    t.oncomplete = res;
    t.onerror = t.onabort = () => rej(t.error);
  });
  const del = (store, k) => new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).delete(k);
    t.oncomplete = res;
    t.onerror = t.onabort = () => rej(t.error);
  });
  const getAll = async (store) => {
    const [keys, vals] = await Promise.all([req(tx(store).getAllKeys()), req(tx(store).getAll())]);
    return keys.map((k, i) => [k, vals[i]]);
  };

  /* ---------- encryption ---------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriveKey(pass, salt, iterations = ITER) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(k, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv, ct: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes) };
  }
  const unseal = (k, box) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, k, box.ct);
  const encodeVal = async (v) => (key ? seal(key, enc.encode(JSON.stringify(v))) : v);
  const decodeVal = async (v) => (lockInfo ? JSON.parse(dec.decode(await unseal(key, v))) : v);

  /* ---------- load and save ---------- */
  async function init() {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    try {
      db = await open();
      lockInfo = (await req(tx('meta').get('lock'))) || null;
    } catch (e) {
      // private windows can refuse IndexedDB: the app still works, and the shell warns that nothing will be kept
      memoryOnly = true;
    }
    channel && (channel.onmessage = async () => { if (!lockInfo || key) { await readAll(); FP.render?.(); } });
    return { locked: !!lockInfo, memoryOnly };
  }
  async function unlock(pass) {
    const k = await deriveKey(pass, lockInfo.salt, lockInfo.iter);
    try { await unseal(k, lockInfo.check); } catch { return false; }
    key = k;
    return true;
  }
  async function readAll() {
    if (memoryOnly) return;
    for (const [name, value] of await getAll('data')) {
      const v = await decodeVal(value);
      if (name === 'settings') state.settings = { ...state.settings, ...v };
      else if (COLS.includes(name)) state[name] = v;
    }
    FP.setCurrency(state.settings.currency);
  }
  async function flush() {
    clearTimeout(timer);
    if (memoryOnly || !dirty.size) return;
    const names = [...dirty];
    dirty.clear();
    try {
      for (const n of names) await put('data', n, await encodeVal(n === 'settings' ? state.settings : state[n]));
      channel?.postMessage('changed');
    } catch (e) {
      names.forEach((n) => dirty.add(n));
      onError(e);
    }
  }
  function touch(name) {
    dirty.add(name);
    clearTimeout(timer);
    timer = setTimeout(flush, 120);
    FP.scheduleRender?.();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);

  /* ---------- records ---------- */
  const get = (col, id) => state[col].find((r) => r.id === id);
  function add(col, rec) {
    const r = { id: FP.uid(), createdAt: Date.now(), ...rec };
    state[col].push(r);
    touch(col);
    return r;
  }
  function update(col, id, patch) {
    const r = get(col, id);
    if (r) { Object.assign(r, patch, { updatedAt: Date.now() }); touch(col); }
    return r;
  }
  function remove(col, id) {
    state[col] = state[col].filter((r) => r.id !== id);
    touch(col);
  }
  function setSetting(k, v) {
    state.settings[k] = v;
    if (k === 'currency') FP.setCurrency(v);
    touch('settings');
  }

  /* ---------- receipt images ---------- */
  async function saveReceipt(blob) {
    const id = FP.uid();
    if (memoryOnly) { receiptsMem.set(id, blob); return id; }
    await put('receipts', id, await encodeBlob(blob));
    return id;
  }
  async function encodeBlob(blob) {
    if (!key) return blob;
    return { type: blob.type, ...(await seal(key, await blob.arrayBuffer())) };
  }
  async function decodeBlob(v) {
    if (v instanceof Blob) return v;
    return new Blob([await unseal(key, v)], { type: v.type });
  }
  async function getReceipt(id) {
    if (memoryOnly) return receiptsMem.get(id) || null;
    const v = await req(tx('receipts').get(id));
    return v ? decodeBlob(v) : null;
  }
  async function removeReceipt(id) {
    if (memoryOnly) { receiptsMem.delete(id); return; }
    await del('receipts', id);
  }

  /* ---------- passcode ---------- */
  async function rewriteAll(nextKey, nextLock) {
    await flush();
    const receipts = [];
    for (const [id, v] of await getAll('receipts')) receipts.push([id, await decodeBlob(v)]);
    key = nextKey;
    if (nextLock) await put('meta', 'lock', nextLock); else await del('meta', 'lock');
    lockInfo = nextLock;
    for (const n of [...COLS, 'settings']) await put('data', n, await encodeVal(n === 'settings' ? state.settings : state[n]));
    for (const [id, blob] of receipts) await put('receipts', id, await encodeBlob(blob));
  }
  async function setPasscode(pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k = await deriveKey(pass, salt);
    await rewriteAll(k, { salt, iter: ITER, check: await seal(k, enc.encode('ok')) });
  }
  const removePasscode = () => rewriteAll(null, null);

  /* ---------- backup and restore ---------- */
  async function buildBackup(password) {
    await flush();
    const receipts = [];
    if (!memoryOnly) {
      for (const [id, v] of await getAll('receipts')) {
        const blob = await decodeBlob(v);
        receipts.push({ id, type: blob.type, data: b64(await blob.arrayBuffer()) });
      }
    }
    const data = {};
    COLS.forEach((c) => { data[c] = state[c]; });
    const payload = { app: 'financial-planner', version: 1, exportedAt: new Date().toISOString(), data, settings: state.settings, receipts };
    if (!password) return JSON.stringify(payload);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k = await deriveKey(password, salt);
    const box = await seal(k, enc.encode(JSON.stringify(payload)));
    return JSON.stringify({ app: 'financial-planner', version: 1, encrypted: true, salt: b64(salt), iter: ITER, iv: b64(box.iv), ct: b64(box.ct) });
  }
  const isEncrypted = (obj) => obj?.app === 'financial-planner' && obj.encrypted === true;
  async function decryptBackup(obj, password) {
    if (!Number.isInteger(obj.iter) || obj.iter < 1000 || obj.iter > 5e6) throw new Error('This backup file is damaged.');
    const k = await deriveKey(password, unb64(obj.salt), obj.iter);
    try {
      return JSON.parse(dec.decode(await unseal(k, { iv: unb64(obj.iv), ct: unb64(obj.ct) })));
    } catch { throw new Error('That password is not correct.'); }
  }
  // backups are untrusted input: only well-formed records from known collections are accepted
  function sanitizeBackup(p) {
    if (p?.app !== 'financial-planner' || typeof p.data !== 'object' || !p.data) throw new Error('This is not a Financial Planner backup file.');
    if (p.version > 1) throw new Error('This backup was made by a newer version of the planner.');
    const clean = { data: {}, settings: {}, receipts: [] };
    for (const c of COLS) {
      const rows = p.data[c] ?? [];
      if (!Array.isArray(rows)) throw new Error(`The backup's ${c} section is damaged.`);
      clean.data[c] = rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string');
    }
    clean.data.transactions = clean.data.transactions.filter((t) => Number.isInteger(t.amount) && FP.isDate(t.date) && (t.type === 'income' || t.type === 'expense'));
    clean.data.loans = clean.data.loans.filter((l) => Number.isInteger(l.amount) && (l.kind === 'lent' || l.kind === 'borrowed'))
      .map((l) => ({ ...l, repayments: Array.isArray(l.repayments) ? l.repayments.filter((r) => Number.isInteger(r?.amount)) : [] }));
    for (const k of SETTING_KEYS) if (p.settings?.[k] !== undefined) clean.settings[k] = p.settings[k];
    if (!/^[A-Z]{3}$/.test(clean.settings.currency || '')) delete clean.settings.currency;
    if (!Number.isInteger(clean.settings.openingBalance)) delete clean.settings.openingBalance;
    for (const r of Array.isArray(p.receipts) ? p.receipts : []) {
      if (typeof r?.id === 'string' && /^image\//.test(r.type) && typeof r.data === 'string') clean.receipts.push(r);
    }
    return clean;
  }
  async function restore(clean) {
    clearTimeout(timer);
    dirty.clear();
    for (const c of COLS) state[c] = clean.data[c];
    state.settings = { currency: 'USD', openingBalance: 0, fired: {}, notifyOn: false, ...clean.settings };
    FP.setCurrency(state.settings.currency);
    if (memoryOnly) return;
    const old = await getAll('receipts');
    for (const [id] of old) await del('receipts', id);
    for (const n of [...COLS, 'settings']) await put('data', n, await encodeVal(n === 'settings' ? state.settings : state[n]));
    for (const r of clean.receipts) await put('receipts', r.id, await encodeBlob(new Blob([unb64(r.data)], { type: r.type })));
    channel?.postMessage('changed');
  }
  async function eraseAll() {
    clearTimeout(timer);
    dirty.clear();
    if (!memoryOnly) {
      db.close();
      await new Promise((res, rej) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; });
    }
  }

  FP.store = {
    state, COLS, init, unlock, readAll, flush, get, add, update, remove, touch, setSetting,
    saveReceipt, getReceipt, removeReceipt, setPasscode, removePasscode,
    buildBackup, isEncrypted, decryptBackup, sanitizeBackup, restore, eraseAll,
    get locked() { return !!lockInfo; }, get memoryOnly() { return memoryOnly; },
    onError(fn) { onError = fn; },
  };
})();
