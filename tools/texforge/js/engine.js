/*
 * Talks to js/tex-worker.js. Keeps track of which file versions the worker already has so each
 * recompile only transfers what changed, and restarts the worker if a run hangs.
 */
(function (root) {
  'use strict';

  const WORKER_URL = new URL('tex-worker.js', document.currentScript.src).href;
  const TIMEOUT = 150000;

  let worker = null;
  let seq = 0;
  const pending = new Map();
  const sent = new Map(); // project -> Map(path -> v)
  const listeners = { progress: [], status: [] };
  let ready = null;

  function emit(type, data) { for (const fn of listeners[type]) try { fn(data); } catch { /* ignore */ } }

  function spawn() {
    worker = new Worker(WORKER_URL);
    sent.clear();
    ready = null;
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return emit('progress', data);
      if (data.type === 'status') return emit('status', data.text);
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      clearTimeout(p.timer);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data);
    };
    worker.onerror = e => {
      const err = new Error(e.message || 'The TeX engine crashed');
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
      pending.clear();
      restart();
    };
  }

  function restart() {
    try { worker && worker.terminate(); } catch { /* gone */ }
    worker = null;
    ready = null;
  }

  function call(msg, timeout = 0, transfer = []) {
    if (!worker) spawn();
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const entry = { resolve, reject, timer: null };
      if (timeout) {
        entry.timer = setTimeout(() => {
          pending.delete(id);
          restart();
          reject(new Error(`Compilation took longer than ${Math.round(timeout / 1000)} s and was stopped. Check for an infinite loop.`));
        }, timeout);
      }
      pending.set(id, entry);
      worker.postMessage({ ...msg, id }, transfer);
    });
  }

  function init() {
    if (!worker) spawn();
    if (!ready) ready = call({ type: 'init' }).catch(err => { ready = null; throw err; });
    return ready;
  }

  /**
   * files: [{ path, v, load: () => Promise<string|ArrayBuffer> }]
   */
  /** timeout: ms before the run is stopped automatically; 0 = never (the UI asks the user instead). */
  async function compile(project, files, main, engine, { draft = false, timeout = TIMEOUT } = {}) {
    await init();
    const have = sent.get(project) || new Map();
    const build = async all => Promise.all(files.map(async f => {
      if (!all && have.get(f.path) === f.v) return { path: f.path, v: f.v };
      return { path: f.path, v: f.v, data: await f.load() };
    }));
    let payload = await build(false);
    let res = await call({ type: 'compile', project, files: payload, main, engine, draft }, timeout);
    if (res.type === 'need') {
      payload = await build(true);
      res = await call({ type: 'compile', project, files: payload, main, engine, draft }, timeout);
    }
    const next = new Map();
    for (const f of files) next.set(f.path, f.v);
    sent.set(project, next);
    return res;
  }

  /** Stop whatever the engine is doing (only when the user asked). The worker restarts on the next compile. */
  function abort() {
    const err = new Error('Compilation stopped');
    err.cancelled = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
    restart();
  }

  function forget(project) {
    sent.delete(project);
    if (worker) call({ type: 'forget', project }).catch(() => {});
  }

  async function clearCache() {
    restart();
    try {
      for (const k of await caches.keys()) if (k.startsWith('texforge-texlive-')) await caches.delete(k);
    } catch { /* unsupported */ }
  }

  root.TexEngine = {
    init,
    compile,
    abort,
    forget,
    clearCache,
    on(type, fn) { listeners[type].push(fn); },
  };
})(self);
