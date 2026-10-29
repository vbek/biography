// IndexedDB persistence: projects (annotations + settings) and folder handles.
const DB_NAME = 'locallabel';
const DB_VERSION = 2;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'slot' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn, storeName = 'projects') {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const out = fn(store);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  put: (rec) => tx('readwrite', s => s.put(rec)),
  get: (id) => tx('readonly', s => s.get(id)),
  del: (id) => tx('readwrite', s => s.delete(id)),
  // the last AI model used (kept so it doesn't have to be picked again after a reload)
  putModel: (rec) => tx('readwrite', s => s.put({ slot: 'last', ...rec }), 'models'),
  getModel: () => tx('readonly', s => s.get('last'), 'models'),
  list: () => tx('readonly', s => s.getAll()).then(all =>
    (all || []).map(r => ({ id: r.id, name: r.name, updated: r.updated, hasHandle: !!r.handle, count: r.project?.media?.length || 0 }))
      .sort((a, b) => b.updated - a.updated)),
};
