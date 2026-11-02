/* Document Reader — your library lives in this browser's IndexedDB: extracted text and reading position, never the original file. */
const DB = 'document-reader', STORE = 'docs';
let open = null;
function db() {
  if (!open) {
    open = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => { open = null; rej(r.error); };
    });
  }
  return open;
}
async function run(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}
export const saveDoc = (doc) => run('readwrite', (s) => s.put(doc));
export const getDoc = (id) => run('readonly', (s) => s.get(id));
export const deleteDoc = (id) => run('readwrite', (s) => s.delete(id));
export async function listDocs() {
  const all = await run('readonly', (s) => s.getAll());
  return all.map(({ blocks, ...meta }) => meta).sort((a, b) => b.openedAt - a.openedAt);
}

const PREFS = 'document-reader-prefs';
export const DEFAULTS = { engine: 'neural', tier: 'fast', voices: {}, lang: 'en', systemVoice: '', rate: 1, textSize: 19, follow: true, tidy: true };
export function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function savePrefs(prefs) {
  try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* the settings just won't be remembered */ }
}
