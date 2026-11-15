// Main-thread side of the Pyodide worker: lazy start, progress events, queued runs, and a Stop button.
const listeners = new Set();
let worker = null;
let state = { status: 'idle', stage: '', pct: 0 };
let nextId = 1;
const pending = new Map();
let readyWaiters = [];

function set(s) { state = { ...state, ...s }; listeners.forEach((f) => f(state)); }
export function onStatus(f) { listeners.add(f); f(state); return () => listeners.delete(f); }
export function status() { return state; }

export function start() {
    if (worker) return;
    set({ status: 'loading', stage: 'Starting Python', pct: 3 });
    worker = new Worker(new URL('../py-worker.js', import.meta.url));
    worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'status') set({ status: 'loading', stage: m.stage, pct: m.pct });
        else if (m.type === 'ready') { set({ status: 'ready', stage: 'Python Ready', pct: 100 }); readyWaiters.forEach((f) => f()); readyWaiters = []; }
        else if (m.type === 'error') { set({ status: 'error', stage: 'Python failed to load', error: m.message }); readyWaiters = []; }
        else if (m.type === 'result') {
            const p = pending.get(m.id);
            if (p) { pending.delete(m.id); set({ status: 'ready', stage: 'Python Ready' }); p.resolve(m); }
        }
    };
    worker.onerror = (e) => set({ status: 'error', stage: 'Python failed to load', error: e.message });
}

function whenReady() {
    if (state.status === 'ready' || state.status === 'busy') return Promise.resolve();
    start();
    return new Promise((res, rej) => {
        readyWaiters.push(res);
        const off = onStatus((s) => { if (s.status === 'error') { off(); rej(new Error(s.error || 'Python failed to load')); } });
    });
}

export async function run(code, data) {
    await whenReady();
    const id = nextId++;
    set({ status: 'busy', stage: 'Running…' });
    return new Promise((resolve) => {
        pending.set(id, { resolve });
        worker.postMessage({ type: 'run', id, code, data });
    });
}

/** Kills a runaway script by restarting the worker (Python reloads from the browser cache). */
export function stop() {
    if (!worker) return;
    worker.terminate();
    worker = null;
    pending.forEach((p) => p.resolve({ error: 'Stopped. Python is restarting…', stdout: '', ms: 0, stopped: true }));
    pending.clear();
    set({ status: 'idle', stage: '' });
    start();
}
