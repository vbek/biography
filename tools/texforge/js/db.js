/*
 * TeXForge local storage (IndexedDB). Projects never leave this browser.
 *
 *   projects : { id, name, settings: { main, engine }, created, updated }
 *   files    : { project, path, kind: 'text'|'blob'|'dir', text?, blob?, size, mtime, v }
 *   outputs  : { project, pdf: Blob, synctex, log, dir, items, at }
 */
(function (root) {
  'use strict';

  const DB_NAME = 'texforge';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('files')) {
            const s = db.createObjectStore('files', { keyPath: ['project', 'path'] });
            s.createIndex('project', 'project');
          }
          if (!db.objectStoreNames.contains('outputs')) db.createObjectStore('outputs', { keyPath: 'project' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('Close other TeXForge tabs and reload.'));
      });
    }
    return dbPromise;
  }

  const done = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

  /** Run fn(stores) inside one transaction; resolves with fn's return value after commit. */
  async function tx(names, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(names, mode);
      const stores = Object.fromEntries([].concat(names).map(n => [n, t.objectStore(n)]));
      let value;
      let failed = null;
      Promise.resolve()
        .then(() => fn(stores, t))
        .then(v => { value = v; }, e => { failed = e; try { t.abort(); } catch { /* already done */ } });
      t.oncomplete = () => (failed ? reject(failed) : resolve(value));
      t.onerror = () => reject(failed || t.error);
      t.onabort = () => reject(failed || t.error || new Error('Transaction aborted'));
    });
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

  function record(project, path, data) {
    const now = Date.now();
    if (data === null) return { project, path, kind: 'dir', size: 0, mtime: now, v: 1 };
    if (typeof data === 'string') return { project, path, kind: 'text', text: data, size: data.length, mtime: now, v: 1 };
    const blob = data instanceof Blob ? data : new Blob([data]);
    return { project, path, kind: 'blob', blob, size: blob.size, mtime: now, v: 1 };
  }

  const api = {
    async listProjects() {
      const all = await tx('projects', 'readonly', s => done(s.projects.getAll()));
      return all.sort((a, b) => b.updated - a.updated);
    },
    getProject(id) { return tx('projects', 'readonly', s => done(s.projects.get(id))); },

    async createProject(name, files = [], settings = {}) {
      const id = uid();
      const now = Date.now();
      // draft: true → new projects start in fast compile mode (images as placeholders)
      const project = { id, name, settings: { main: 'main.tex', engine: 'pdflatex', draft: true, ...settings }, created: now, updated: now };
      await tx(['projects', 'files'], 'readwrite', s => {
        s.projects.put(project);
        for (const f of files) s.files.put(record(id, f.path, f.data));
      });
      return project;
    },

    async updateProject(id, patch) {
      return tx('projects', 'readwrite', async s => {
        const p = await done(s.projects.get(id));
        if (!p) throw new Error('Project not found');
        const next = { ...p, ...patch, settings: { ...p.settings, ...(patch.settings || {}) }, updated: Date.now() };
        s.projects.put(next);
        return next;
      });
    },

    touch(id) {
      return tx('projects', 'readwrite', async s => {
        const p = await done(s.projects.get(id));
        if (p) { p.updated = Date.now(); s.projects.put(p); }
      });
    },

    async deleteProject(id) {
      await tx(['projects', 'files', 'outputs'], 'readwrite', async s => {
        s.projects.delete(id);
        s.outputs.delete(id);
        const keys = await done(s.files.index('project').getAllKeys(id));
        for (const k of keys) s.files.delete(k);
      });
    },

    listFiles(project) {
      return tx('files', 'readonly', s => done(s.files.index('project').getAll(project)));
    },
    getFile(project, path) { return tx('files', 'readonly', s => done(s.files.get([project, path]))); },

    /** Write a file (string → text, Blob/ArrayBuffer → binary, null → folder). Returns the new version. */
    putFile(project, path, data) {
      return tx('files', 'readwrite', async s => {
        const prev = await done(s.files.get([project, path]));
        const rec = record(project, path, data);
        rec.v = prev ? (prev.v || 0) + 1 : 1;
        s.files.put(rec);
        return rec;
      });
    },

    /** Save several text files at once (editor autosave). */
    putTexts(project, entries) {
      return tx('files', 'readwrite', async s => {
        const out = [];
        for (const [path, text] of entries) {
          const prev = await done(s.files.get([project, path]));
          const rec = record(project, path, text);
          rec.v = prev ? (prev.v || 0) + 1 : 1;
          s.files.put(rec);
          out.push(rec);
        }
        return out;
      });
    },

    /** Delete a file or a folder (and everything under it). */
    deletePath(project, path) {
      return tx('files', 'readwrite', async s => {
        const all = await done(s.files.index('project').getAll(project));
        for (const f of all) if (f.path === path || f.path.startsWith(`${path}/`)) s.files.delete([project, f.path]);
      });
    },

    /** Rename / move a file or folder. */
    renamePath(project, from, to) {
      return tx('files', 'readwrite', async s => {
        const all = await done(s.files.index('project').getAll(project));
        if (all.some(f => f.path === to || f.path.startsWith(`${to}/`))) throw new Error('Something with that name already exists');
        let moved = 0;
        for (const f of all) {
          if (f.path !== from && !f.path.startsWith(`${from}/`)) continue;
          s.files.delete([project, f.path]);
          s.files.put({ ...f, path: to + f.path.slice(from.length), v: (f.v || 0) + 1, mtime: Date.now() });
          moved++;
        }
        if (!moved) throw new Error('Nothing to rename');
      });
    },

    getOutput(project) { return tx('outputs', 'readonly', s => done(s.outputs.get(project))); },
    putOutput(project, out) { return tx('outputs', 'readwrite', s => { s.outputs.put({ project, ...out, at: Date.now() }); }); },

    async usage() {
      try { return await navigator.storage.estimate(); } catch { return null; }
    },
    async persist() {
      try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
    },
  };

  root.TFDB = api;
})(self);
