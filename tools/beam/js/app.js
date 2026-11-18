/* Beam: send files, folders and text between devices, peer to peer.

   Pairing. Every device has its own PeerJS peer with a random id. One device in a room also holds the "door",
   a second peer named after the 6-letter room code. A newcomer knocks on the door, gets the ids of everyone in
   the room, and connects to each of them directly, so every pair of devices has its own data channel. If the
   device holding the door leaves, the remaining device with the smallest id opens it again.

   Transfer. On each data channel: JSON text messages for control, and binary chunks framed as
   [u32 transfer id][bytes]. The sender offers a file, the receiver accepts, the sender streams chunks and the
   receiver acknowledges what it has written, which keeps both the send buffer and the receiver's memory bounded. */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0 or 1, which are easy to misread
  const doorId = (code) => `vbek-bio-beam-${code}`.toLowerCase();
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('');
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const validCode = (s) => s.length === 6 && [...s].every((c) => ALPHABET.includes(c));

  const MAX_CHUNK = 256 * 1024;       // largest message we put on the channel (capped by what both ends support)
  const READ_BLOCK = 4 * 1024 * 1024; // how much of the file we read at a time
  const BUF_HIGH = 8 * 1024 * 1024;   // pause sending when the channel's buffer holds this much
  const BUF_LOW = 2 * 1024 * 1024;    // and resume when it drains to this
  const WINDOW = 24 * 1024 * 1024;    // most bytes in flight that the receiver hasn't written yet
  const BATCH = 4 * 1024 * 1024;      // the receiver writes (and acknowledges) in batches of this size
  const DISK_OVER = 32 * 1024 * 1024; // files bigger than this go to the browser's private storage while arriving
  const TEXT_MAX = 60000;             // longer text is sent as a .txt file

  const rtcOk = typeof RTCPeerConnection === 'function' && typeof Peer === 'function';

  /* ---------- helpers ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }

  function fmtBytes(n) {
    if (!(n > 0)) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const v = n / 1024 ** i;
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  }
  const fmtRate = (n) => `${fmtBytes(n)}/s`;
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '';
    if (s < 1) return 'under a second';
    if (s < 60) return `${Math.round(s)} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
    return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  }

  function deviceInfo() {
    const ua = navigator.userAgent;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return { label: 'iPad', kind: 'tablet' };
    if (/iPhone/.test(ua)) return { label: 'iPhone', kind: 'phone' };
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? { label: 'Android phone', kind: 'phone' } : { label: 'Android tablet', kind: 'tablet' };
    if (/CrOS/.test(ua)) return { label: 'Chromebook', kind: 'computer' };
    if (/Windows/.test(ua)) return { label: 'Windows PC', kind: 'computer' };
    if (/Macintosh/.test(ua)) return { label: 'Mac', kind: 'computer' };
    if (/Linux/.test(ua)) return { label: 'Linux', kind: 'computer' };
    return { label: 'Browser', kind: 'computer' };
  }
  const ME = deviceInfo();

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  function randomName() {
    const a = ['Amber', 'Azure', 'Brisk', 'Coral', 'Crimson', 'Golden', 'Jade', 'Lunar', 'Misty', 'Olive', 'Quiet', 'Rapid', 'Ruby', 'Sage', 'Silver', 'Sunny', 'Swift', 'Teal', 'Velvet', 'Violet'];
    const b = ['Otter', 'Falcon', 'Panda', 'Lynx', 'Heron', 'Koala', 'Fox', 'Owl', 'Tiger', 'Yak', 'Bison', 'Crane', 'Dolphin', 'Gecko', 'Ibis', 'Lemur', 'Moose', 'Puffin', 'Raven', 'Seal'];
    const r = crypto.getRandomValues(new Uint8Array(2));
    return `${a[r[0] % a.length]} ${b[r[1] % b.length]}`;
  }
  const cleanName = (s, fallback) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) || fallback;
  // Names and paths come from other devices: strip anything that could be read as a directory or a control character.
  const cleanFileName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>:"\\|?*]/g, '_').replace(/^\.+/, '_').slice(-180) || 'file';
  const cleanPath = (s) => String(s || '').split('/').map(cleanFileName).filter((x) => x && x !== '..').join('/').slice(-400);

  let myName = cleanName(store.get('beam-name'), '') || randomName();
  store.set('beam-name', myName);

  function qrImage(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text); qr.make();
    const n = qr.getModuleCount(), c = document.createElement('canvas'), g = c.getContext('2d');
    const scale = 8, q = 2;
    c.width = c.height = (n + q * 2) * scale;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#0f172a';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect((x + q) * scale, (y + q) * scale, scale, scale);
    return c.toDataURL();
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      t.remove();
      return ok;
    }
  }

  /* ---------- ZIP ----------
     Received files are stored as-is ("stored", no compression): most big files are already compressed, and it
     means the ZIP is just small headers around the files we already hold, so it's ready instantly at any size.
     The CRC each entry needs is worked out while the file arrives. ZIP64 kicks in past 4 GB or 65,535 files. */
  const CRC_T = (() => {
    const t = new Int32Array(256 * 8);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    for (let n = 0; n < 256; n++) { let c = t[n]; for (let k = 1; k < 8; k++) { c = t[c & 0xff] ^ (c >>> 8); t[k * 256 + n] = c; } }
    return t;
  })();
  function crc32(u8, crc = 0) {
    const T = CRC_T, n = u8.length;
    let c = ~crc, i = 0;
    for (; i + 8 <= n; i += 8) { // slicing-by-8: eight bytes per step
      const a = (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24)) ^ c;
      c = T[1792 + (a & 0xff)] ^ T[1536 + ((a >>> 8) & 0xff)] ^ T[1280 + ((a >>> 16) & 0xff)] ^ T[1024 + (a >>> 24)]
        ^ T[768 + u8[i + 4]] ^ T[512 + u8[i + 5]] ^ T[256 + u8[i + 6]] ^ T[u8[i + 7]];
    }
    for (; i < n; i++) c = T[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  }

  function dosTime(ms) {
    const d = new Date(ms || Date.now()), y = d.getFullYear();
    if (y < 1980) return [0, (1 << 5) | 1];
    return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
  }
  const setU64 = (v, o, n) => { v.setUint32(o, n % 4294967296, true); v.setUint32(o + 4, Math.floor(n / 4294967296), true); };

  // entries: [{ path, file, crc }] -> a ZIP Blob that references the files rather than copying them
  function makeZip(entries) {
    const enc = new TextEncoder(), parts = [], central = [], BIG = 0xffffffff;
    const used = new Set();
    let off = 0;
    for (const e of entries) {
      let path = e.path.replace(/^\/+/, '') || 'file';
      if (used.has(path.toLowerCase())) { // same name twice: "photo (2).jpg"
        const m = /^(.*?)(\.[^./]*)?$/.exec(path);
        let k = 2; while (used.has(`${m[1]} (${k})${m[2] || ''}`.toLowerCase())) k++;
        path = `${m[1]} (${k})${m[2] || ''}`;
      }
      used.add(path.toLowerCase());
      const name = enc.encode(path), size = e.file.size, z64 = size >= BIG || off >= BIG;
      const [tm, dt] = dosTime(e.file.lastModified);
      const v = new DataView(new ArrayBuffer(30 + name.length + (z64 ? 20 : 0)));
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, z64 ? 45 : 20, true); v.setUint16(6, 0x0800, true); // UTF-8 names
      v.setUint16(8, 0, true); v.setUint16(10, tm, true); v.setUint16(12, dt, true); v.setUint32(14, e.crc >>> 0, true);
      v.setUint32(18, z64 ? BIG : size, true); v.setUint32(22, z64 ? BIG : size, true);
      v.setUint16(26, name.length, true); v.setUint16(28, z64 ? 20 : 0, true);
      new Uint8Array(v.buffer).set(name, 30);
      if (z64) { const x = 30 + name.length; v.setUint16(x, 1, true); v.setUint16(x + 2, 16, true); setU64(v, x + 4, size); setU64(v, x + 12, size); }
      parts.push(v.buffer, e.file);
      central.push({ name, size, crc: e.crc >>> 0, tm, dt, off, z64 });
      off += v.byteLength + size;
    }
    const cdStart = off;
    for (const c of central) {
      const v = new DataView(new ArrayBuffer(46 + c.name.length + (c.z64 ? 28 : 0)));
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, c.z64 ? 45 : 20, true); v.setUint16(6, c.z64 ? 45 : 20, true);
      v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true); v.setUint16(12, c.tm, true); v.setUint16(14, c.dt, true);
      v.setUint32(16, c.crc, true); v.setUint32(20, c.z64 ? BIG : c.size, true); v.setUint32(24, c.z64 ? BIG : c.size, true);
      v.setUint16(28, c.name.length, true); v.setUint16(30, c.z64 ? 28 : 0, true);
      v.setUint32(42, c.z64 ? BIG : c.off, true);
      new Uint8Array(v.buffer).set(c.name, 46);
      if (c.z64) { const x = 46 + c.name.length; v.setUint16(x, 1, true); v.setUint16(x + 2, 24, true); setU64(v, x + 4, c.size); setU64(v, x + 12, c.size); setU64(v, x + 20, c.off); }
      parts.push(v.buffer);
      off += v.byteLength;
    }
    const cdSize = off - cdStart, n = central.length;
    const z64 = n >= 0xffff || cdStart >= BIG || cdSize >= BIG;
    if (z64) {
      const r = new DataView(new ArrayBuffer(56 + 20));
      r.setUint32(0, 0x06064b50, true); setU64(r, 4, 44); r.setUint16(12, 45, true); r.setUint16(14, 45, true);
      setU64(r, 24, n); setU64(r, 32, n); setU64(r, 40, cdSize); setU64(r, 48, cdStart);
      r.setUint32(56, 0x07064b50, true); setU64(r, 64, off); r.setUint32(72, 1, true);
      parts.push(r.buffer);
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Math.min(n, 0xffff), true); end.setUint16(10, Math.min(n, 0xffff), true);
    end.setUint32(12, z64 ? BIG : cdSize, true); end.setUint32(16, z64 ? BIG : cdStart, true);
    parts.push(end.buffer);
    return new Blob(parts, { type: 'application/zip' });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  }

  const ICONS = {
    phone: '<svg viewBox="0 0 48 48"><rect x="14" y="5" width="20" height="38" rx="4"/><path d="M21 37h6"/></svg>',
    tablet: '<svg viewBox="0 0 48 48"><rect x="8" y="6" width="32" height="36" rx="4"/><path d="M21 36h6"/></svg>',
    computer: '<svg viewBox="0 0 48 48"><rect x="8" y="9" width="32" height="22" rx="3"/><path d="M4 39h40M18 31l-2 8M30 31l2 8"/></svg>',
  };

  /* =====================================================================
     Received files: kept in the browser's private storage (OPFS) when big
     ===================================================================== */
  const SID = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  const hasOPFS = !!(navigator.storage && navigator.storage.getDirectory && window.FileSystemFileHandle && 'createWritable' in FileSystemFileHandle.prototype);
  let inboxP = null;
  function inbox() {
    if (!inboxP) inboxP = (async () => {
      const root = await navigator.storage.getDirectory();
      const top = await root.getDirectoryHandle('beam-inbox', { create: true });
      return top.getDirectoryHandle(SID, { create: true });
    })();
    return inboxP;
  }

  // Each open tab holds a lock named after its folder; folders whose tab is gone are left over and can go.
  async function cleanOldInboxes() {
    if (!hasOPFS || !navigator.locks) return;
    try {
      await new Promise((acquired) => { navigator.locks.request(`beam-${SID}`, () => { acquired(); return new Promise(() => {}); }); });
      const held = new Set(((await navigator.locks.query()).held || []).map((l) => l.name));
      const root = await navigator.storage.getDirectory();
      const top = await root.getDirectoryHandle('beam-inbox', { create: true });
      const stale = [];
      for await (const name of top.keys()) if (name !== SID && !held.has(`beam-${name}`)) stale.push(name);
      for (const name of stale) await top.removeEntry(name, { recursive: true }).catch(() => {});
    } catch {}
  }

  // A sink collects a file's bytes in batches. onWritten(bytes) fires as each batch lands.
  function batcher(write, onWritten) {
    let batch = new Uint8Array(BATCH), fill = 0, written = 0, err = null, chain = Promise.resolve();
    const flush = () => {
      if (!fill) return chain;
      const out = fill === BATCH ? batch : batch.slice(0, fill), n = fill;
      batch = new Uint8Array(BATCH); fill = 0;
      chain = chain.then(() => (err ? null : write(out))).then(() => { if (!err) { written += n; onWritten(written); } }).catch((e) => { err = err || e; });
      return chain;
    };
    return {
      push(u8) {
        if (err) throw err;
        for (let o = 0; o < u8.length;) {
          const n = Math.min(BATCH - fill, u8.length - o);
          batch.set(u8.subarray(o, o + n), fill);
          fill += n; o += n;
          if (fill === BATCH) flush();
        }
      },
      async end() { await flush(); if (err) throw err; },
    };
  }

  async function makeSink(meta, onWritten) {
    if (hasOPFS && meta.size > DISK_OVER) {
      try {
        const dir = await inbox();
        const fname = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const fh = await dir.getFileHandle(fname, { create: true });
        const w = await fh.createWritable();
        const b = batcher((u8) => w.write(u8), onWritten);
        return {
          opfsName: fname,
          push: b.push,
          async finish() { await b.end(); await w.close(); const f = await fh.getFile(); return new File([f], meta.name, { type: meta.type, lastModified: meta.lastModified || Date.now() }); },
          abort() { w.abort().catch(() => {}).then(() => dir.removeEntry(fname).catch(() => {})); },
        };
      } catch { /* fall back to memory */ }
    }
    const parts = [];
    const b = batcher((u8) => { parts.push(new Blob([u8])); }, onWritten);
    return {
      opfsName: null,
      push: b.push,
      async finish() { await b.end(); return new File(parts, meta.name, { type: meta.type, lastModified: meta.lastModified || Date.now() }); },
      abort() { parts.length = 0; },
    };
  }
  async function removeStored(name) { if (!name) return; try { (await inbox()).removeEntry(name); } catch {} }

  /* =====================================================================
     Connections
     ===================================================================== */
  let me = null, meReady = false;           // this device's own peer
  let door = null, doorReady = false;       // the room-code peer, if this device holds the door
  let room = '', joining = null, joinConn = null, joinTimer = null;
  let doorRetry = null;
  const peers = new Map();                  // peer id -> device
  let txSeq = 1;

  function sendCtl(p, m) {
    if (p.dc && p.dc.readyState === 'open') { try { p.dc.send(JSON.stringify(m)); return true; } catch {} }
    return false;
  }
  function broadcast(m) { for (const p of peers.values()) if (p.open) sendCtl(p, m); }
  const hello = () => ({ t: 'hello', name: myName, kind: ME.kind, label: ME.label, door: doorReady, room });

  function setUrl() { history.replaceState(null, '', room ? `${location.pathname}?code=${room}` : location.pathname); }

  function startMe() {
    meReady = false; renderPair();
    const p = new Peer({ debug: 0 });
    me = p;
    p.on('open', () => {
      if (p !== me) return;
      meReady = true;
      renderMe();
      if (!room) {
        const c = cleanCode(new URLSearchParams(location.search).get('code'));
        if (validCode(c)) join(c, { fromUrl: true }); else freshRoom();
      } else if (!door && !joining && !peers.size) openDoor(room, false);
      renderPair();
    });
    p.on('connection', (conn) => { if (p === me) addPeer(conn); });
    p.on('disconnected', () => { if (p === me) { meReady = false; renderMe(); renderPair(); } });
    p.on('error', (e) => {
      if (p !== me) return;
      if (e.type === 'peer-unavailable') {
        const m = String(e.message || '');
        if (joining && m.includes(doorId(joining))) { joinFailed(); return; }
        for (const d of peers.values()) if (!d.open && m.includes(d.id)) dropPeer(d, true);
      } else if (e.type === 'browser-incompatible' || e.type === 'webrtc') {
        $('#unsupported').hidden = false;
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        meReady = false; renderMe(); renderPair();
      }
    });
  }

  // Keep the link to the pairing service alive; devices that are already connected don't depend on it.
  setInterval(() => {
    if (!rtcOk) return;
    if (me && me.destroyed) startMe();
    else if (me && me.disconnected) { try { me.reconnect(); } catch {} }
    if (door && !door.destroyed && door.disconnected) { try { door.reconnect(); } catch {} }
  }, 4000);

  function freshRoom() {
    room = newCode(); setUrl();
    openDoor(room, true);
  }

  function openDoor(code, fresh, attempt = 0) {
    closeDoor();
    const d = new Peer(doorId(code), { debug: 0 });
    door = d; doorReady = false; renderPair();
    d.on('open', () => {
      if (d !== door) return;
      doorReady = true;
      broadcast({ t: 'door', open: true });
      renderPair();
    });
    d.on('connection', onKnock);
    d.on('disconnected', () => { if (d === door) { doorReady = false; renderPair(); } });
    d.on('error', (e) => {
      if (d !== door) return;
      if (e.type === 'unavailable-id') {
        closeDoor();
        if (fresh) { freshRoom(); return; }
        // The previous holder may still be registered for a few seconds after it left.
        if (attempt < 8) doorRetry = setTimeout(() => { if (room === code && !door && !joining) openDoor(code, false, attempt + 1); }, 3000);
        renderPair();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        doorReady = false; renderPair();
      }
    });
  }

  function closeDoor() {
    clearTimeout(doorRetry); doorRetry = null;
    if (door) { try { door.destroy(); } catch {} }
    const was = doorReady;
    door = null; doorReady = false;
    if (was) broadcast({ t: 'door', open: false });
  }

  // Someone knocked: tell them who is in the room, then hang up. They connect to each device themselves.
  function onKnock(c) {
    c.on('data', (d) => {
      let m; try { m = JSON.parse(d); } catch { return; }
      if (!m || m.t !== 'knock' || !me || !me.id) return;
      const ids = [me.id, ...[...peers.values()].filter((p) => p.open).map((p) => p.id)];
      try { c.send(JSON.stringify({ t: 'roster', room, ids })); } catch {}
      setTimeout(() => { try { c.close(); } catch {} }, 3000);
    });
    setTimeout(() => { try { c.close(); } catch {} }, 20000);
  }

  function join(code, { fromUrl = false } = {}) {
    showError($('#join-error'), '');
    if (!meReady) { toast('Still connecting to the pairing service…'); return; }
    if (code === room && (doorReady || peers.size)) { toast('This device is already in that room'); return; }
    if (peers.size && !confirm('Leave the devices you are connected to and join the other room?')) return;
    leaveRoom();
    room = code; joining = code; setUrl(); renderPair();
    const c = me.connect(doorId(code), { reliable: true, serialization: 'raw' });
    joinConn = c;
    joinTimer = setTimeout(() => { if (joining === code) joinFailed(); }, 15000);
    c.on('open', () => { try { c.send(JSON.stringify({ t: 'knock' })); } catch {} });
    c.on('data', (d) => {
      let m; try { m = JSON.parse(d); } catch { return; }
      if (!m || m.t !== 'roster' || joining !== code) return;
      clearTimeout(joinTimer);
      joining = null; joinConn = null;
      try { c.close(); } catch {}
      const ids = Array.isArray(m.ids) ? m.ids.filter((x) => typeof x === 'string' && x !== me.id).slice(0, 32) : [];
      for (const id of ids) if (!peers.has(id)) addPeer(me.connect(id, { reliable: true, serialization: 'raw' }));
      if (!ids.length) openDoor(code, false); // the room was empty apart from the door
      renderPair();
    });
    joinConn.fromUrl = fromUrl;
  }

  function joinFailed() {
    const code = joining, fromUrl = joinConn && joinConn.fromUrl;
    clearTimeout(joinTimer);
    if (joinConn) { try { joinConn.close(); } catch {} }
    joining = null; joinConn = null;
    if (fromUrl) {
      // Opening a saved or scanned link: nobody is in that room yet, so this device opens it and waits.
      openDoor(code, false);
      toast(`Room ${code} is open on this device`);
    } else {
      showError($('#join-error'), `No device is using code ${code}. Check the code on the other device.`);
      freshRoom();
    }
    renderPair();
  }

  function leaveRoom() {
    clearTimeout(joinTimer);
    if (joinConn) { try { joinConn.close(); } catch {} }
    joining = null; joinConn = null;
    closeDoor();
    room = ''; // first, so dropping the door holder below doesn't reopen the door
    for (const p of [...peers.values()]) { try { p.conn.close(); } catch {} dropPeer(p, true); }
  }

  function addPeer(conn) {
    const id = conn.peer;
    const old = peers.get(id);
    if (old) { if (old.open) { try { conn.close(); } catch {} return; } dropPeer(old, true); }
    const p = { id, conn, dc: null, open: false, greeted: false, name: 'Connecting…', kind: 'computer', label: '', door: false, route: '', rtt: null, queue: [], busy: false };
    peers.set(id, p);
    const timeout = setTimeout(() => { if (!p.open) { try { conn.close(); } catch {} dropPeer(p, true); } }, 25000);
    conn.on('open', () => {
      if (peers.get(id) !== p) return;
      clearTimeout(timeout);
      p.open = true;
      p.dc = conn.dataChannel;
      p.dc.binaryType = 'arraybuffer';
      p.dc.bufferedAmountLowThreshold = BUF_LOW;
      const pc = conn.peerConnection;
      const watch = () => { const s = pc.connectionState || pc.iceConnectionState; if (s === 'failed' || s === 'closed') dropPeer(p); };
      pc.addEventListener('connectionstatechange', watch);
      pc.addEventListener('iceconnectionstatechange', watch);
      sendCtl(p, hello());
      readRoute(p);
      renderDevices();
    });
    conn.on('data', (d) => onData(p, d));
    conn.on('close', () => dropPeer(p));
    conn.on('error', () => dropPeer(p));
    renderDevices();
  }

  function dropPeer(p, quiet) {
    if (peers.get(p.id) !== p) return;
    peers.delete(p.id);
    try { p.conn.close(); } catch {}
    for (const tr of items) if (tr.peer === p && !FINAL.has(tr.state)) failItem(tr, 'Device disconnected');
    p.queue.length = 0;
    for (const b of batches.values()) if (b.peer === p) renderBatch(b);
    if (!quiet && p.greeted) toast(`${p.name} left`);
    if (p.door) maybeTakeDoor();
    renderDevices();
  }

  // When the device holding the door leaves, the remaining one with the smallest id opens it again.
  function maybeTakeDoor() {
    if (door || joining || !room || !meReady) return;
    if ([...peers.values()].some((p) => p.door)) return;
    const ids = [me.id, ...peers.keys()].sort();
    if (ids[0] === me.id) openDoor(room, false);
  }

  async function readRoute(p) {
    if (peers.get(p.id) !== p || !p.open) return;
    try {
      const report = await p.conn.peerConnection.getStats();
      let pair = null;
      report.forEach((s) => { if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pair = s; });
      if (!pair) report.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId); });
      if (pair) {
        const l = report.get(pair.localCandidateId), r = report.get(pair.remoteCandidateId);
        const types = [l && (l.candidateType || l.type), r && (r.candidateType || r.type)];
        const addr = (c) => (c && (c.address || c.ip)) || '';
        const isPrivate = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.|f[cd]|fe80:|::1$)|\.local$/i.test(a);
        // Same public address on both ends means both devices sit behind the same router.
        const sameRouter = addr(l) && addr(l) === addr(r);
        const local = sameRouter || isPrivate(addr(r)) || (types[0] === 'host' && types[1] !== 'srflx');
        p.route = types.includes('relay') ? 'relay' : local ? 'lan' : 'net';
        p.rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : p.rtt;
        renderDevices();
      }
    } catch {}
  }
  setInterval(() => { for (const p of peers.values()) readRoute(p); }, 3000);

  /* =====================================================================
     Messages
     ===================================================================== */
  const tx = new Map(); // `${peerId}:${id}` -> outgoing item
  const rx = new Map(); // `${peerId}:${id}` -> incoming item

  function onData(p, d) {
    if (peers.get(p.id) !== p) return;
    if (typeof d !== 'string') { onChunk(p, d); return; }
    let m; try { m = JSON.parse(d); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const key = `${p.id}:${m.id}`;
    switch (m.t) {
      case 'hello': {
        const first = !p.greeted;
        p.greeted = true;
        p.name = cleanName(m.name, 'Device');
        p.kind = ICONS[m.kind] ? m.kind : 'computer';
        p.label = cleanName(m.label, '');
        p.door = !!m.door;
        if (first) toast(`${p.name} connected`);
        renderDevices();
        break;
      }
      case 'name': p.name = cleanName(m.name, p.name); renderDevices(); renderAllItems(); break;
      case 'door': p.door = !!m.open; if (!p.door) setTimeout(maybeTakeDoor, 500); break;
      case 'offer': onOffer(p, m); break;
      case 'accept': { const tr = tx.get(key); if (tr && tr.answer) tr.answer(true); break; }
      case 'ack': { const tr = tx.get(key); if (tr && Number.isFinite(m.bytes)) { tr.bytes = Math.max(tr.bytes, Math.min(tr.size, m.bytes)); if (tr.wake) tr.wake(); } break; }
      case 'done': { const tr = tx.get(key); if (tr) { tx.delete(key); tr.bytes = tr.size; finishItem(tr); } break; }
      case 'end': onEnd(p, key); break;
      case 'batchend': { const b = batches.get(`${p.id}:${m.batch}`); if (b) { b.ended = true; renderBatch(b); } break; }
      case 'cancel': {
        // side says which end the sender of this message was on for that transfer
        const tr = m.side === 'tx' ? rx.get(key) : tx.get(key);
        if (tr && !FINAL.has(tr.state)) cancelItem(tr, false, m.reason === 'full' ? 'Not enough space on the other device' : '');
        break;
      }
      case 'text': {
        if (typeof m.text !== 'string') return;
        const tr = newItem({ dir: 'in', kind: 'text', peer: p, name: 'Text', text: m.text.slice(0, TEXT_MAX), size: m.text.length, state: 'done' });
        tr.bytes = tr.size;
        toast(`Text from ${p.name}`);
        break;
      }
    }
  }

  /* ---------- sending ---------- */
  function chunkSize(p) {
    const sctp = p.conn.peerConnection && p.conn.peerConnection.sctp;
    const max = sctp && sctp.maxMessageSize > 0 ? sctp.maxMessageSize : 65536;
    return Math.max(16 * 1024, Math.min(MAX_CHUNK, max)) - 4;
  }

  function drained(dc) {
    return new Promise((res) => {
      const done = () => { dc.removeEventListener('bufferedamountlow', done); dc.removeEventListener('close', done); clearTimeout(t); res(); };
      const t = setTimeout(done, 500); // safety net in case the event never fires
      dc.addEventListener('bufferedamountlow', done);
      dc.addEventListener('close', done);
    });
  }
  const ackWait = (tr) => new Promise((res) => { const t = setTimeout(res, 1000); tr.wake = () => { clearTimeout(t); tr.wake = null; res(); }; });

  function queueFiles(list, targets) {
    if (!list.length) return;
    if (!targets.length) { toast(peers.size ? 'Choose a device to send to' : 'Connect a device first. Scan the QR code on another device.'); return; }
    // Several files sent together form a batch: one group in Activity, and one ZIP on the other side.
    const tops = new Set(list.map((x) => (x.path && x.path.includes('/') ? x.path.split('/')[0] : '')));
    const label = tops.size === 1 && !tops.has('') ? [...tops][0] : '';
    const total = list.reduce((n, x) => n + x.file.size, 0);
    for (const p of targets) {
      const b = list.length > 1 ? newBatch({ dir: 'out', peer: p, bid: txSeq++, count: list.length, label, total }) : null;
      for (const { file, path } of list) {
        const tr = newItem({ dir: 'out', kind: 'file', peer: p, batch: b, file, name: file.name || 'file', path: path && path !== file.name ? path : '', size: file.size, type: file.type || '', state: 'queued' });
        p.queue.push(tr);
      }
      pump(p);
    }
    const n = list.length;
    toast(`Sending ${n} ${n === 1 ? 'file' : 'files'} to ${targets.length === 1 ? targets[0].name : `${targets.length} devices`}`);
  }

  function sendText(text, targets) {
    if (!targets.length) { toast(peers.size ? 'Choose a device to send to' : 'Connect a device first'); return false; }
    if (text.length > TEXT_MAX) {
      queueFiles([{ file: new File([text], 'text.txt', { type: 'text/plain' }), path: '' }], targets);
      return true;
    }
    for (const p of targets) {
      const tr = newItem({ dir: 'out', kind: 'text', peer: p, name: 'Text', text, size: text.length, state: 'queued' });
      p.queue.push(tr);
      pump(p);
    }
    return true;
  }

  // One transfer at a time per device keeps each channel full; different devices run in parallel.
  async function pump(p) {
    if (p.busy) return;
    p.busy = true;
    try {
      while (p.queue.length && peers.get(p.id) === p) {
        const tr = p.queue.shift();
        if (!FINAL.has(tr.state)) {
          try { await sendOne(p, tr); } catch (e) {
            if (!FINAL.has(tr.state)) {
              sendCtl(p, { t: 'cancel', side: 'tx', id: tr.id });
              failItem(tr, e && e.message === 'closed' ? 'Device disconnected' : "Couldn't read the file");
            }
          }
        }
        // Tell the other device when a batch has nothing more coming, even if some files were cancelled before they started.
        const b = tr.batch;
        if (b && !b.ended && !p.queue.some((q) => q.batch === b)) { b.ended = true; sendCtl(p, { t: 'batchend', batch: b.bid }); }
      }
    } finally { p.busy = false; }
  }

  async function sendOne(p, tr) {
    const key = `${p.id}:${tr.id}`;
    if (tr.kind === 'text') {
      if (!sendCtl(p, { t: 'text', id: tr.id, text: tr.text })) throw new Error('closed');
      tr.bytes = tr.size; finishItem(tr);
      return;
    }
    tx.set(key, tr);
    setState(tr, 'waiting');
    const accepted = new Promise((res) => { tr.answer = (v) => { tr.answer = null; res(v); }; });
    if (!sendCtl(p, { t: 'offer', id: tr.id, name: tr.name, path: tr.path, size: tr.size, type: tr.type, lastModified: tr.file.lastModified,
      ...(tr.batch ? { batch: tr.batch.bid, count: tr.batch.count, label: tr.batch.label, total: tr.batch.total } : {}) })) throw new Error('closed');
    if (!(await accepted) || tr.state !== 'waiting') return;

    setState(tr, 'sending');
    const dc = p.dc, max = chunkSize(p), file = tr.file, size = tr.size;
    const read = (at) => file.slice(at, Math.min(size, at + READ_BLOCK)).arrayBuffer().then((b) => new Uint8Array(b));
    let off = 0, sent = 0;
    let next = size ? read(0) : null;
    while (off < size) {
      const buf = await next;
      if (!buf.length) throw new Error('read');
      const end = off + buf.length;
      next = end < size ? read(end) : null; // read the next block while this one goes out
      for (let i = 0; i < buf.length; i += max) {
        if (tr.state !== 'sending') return;
        if (dc.readyState !== 'open') throw new Error('closed');
        while (dc.bufferedAmount > BUF_HIGH && dc.readyState === 'open') await drained(dc);
        while (sent - tr.bytes > WINDOW && tr.state === 'sending' && dc.readyState === 'open') await ackWait(tr);
        if (tr.state !== 'sending') return;
        if (dc.readyState !== 'open') throw new Error('closed');
        const len = Math.min(max, buf.length - i);
        const msg = new Uint8Array(len + 4);
        new DataView(msg.buffer).setUint32(0, tr.id);
        msg.set(buf.subarray(i, i + len), 4);
        dc.send(msg);
        sent += len;
      }
      off = end;
    }
    if (tr.state !== 'sending') return;
    if (!sendCtl(p, { t: 'end', id: tr.id })) throw new Error('closed');
    // The item stays "sending" until the other device says it has the whole file.
  }

  /* ---------- receiving ---------- */
  async function onOffer(p, m) {
    const key = `${p.id}:${m.id}`;
    const size = Number(m.size);
    if (!Number.isSafeInteger(m.id) || rx.has(key) || !Number.isSafeInteger(size) || size < 0) return;
    const name = cleanFileName(m.name);
    let b = null;
    if (Number.isSafeInteger(m.batch) && Number.isSafeInteger(m.count) && m.count > 1) {
      const bkey = `${p.id}:${m.batch}`;
      b = batches.get(bkey) || newBatch({ dir: 'in', peer: p, bid: m.batch, count: Math.min(m.count, 1e6), label: m.label ? cleanFileName(m.label) : '', total: Number(m.total) > 0 ? Number(m.total) : 0 });
    }
    const tr = newItem({ dir: 'in', kind: 'file', peer: p, batch: b, crc: 0, rid: m.id, name, path: m.path ? cleanPath(m.path) : '', size, type: typeof m.type === 'string' ? m.type.slice(0, 100) : '', state: 'receiving' });
    rx.set(key, tr);
    if (hasOPFS && size > DISK_OVER && navigator.storage.estimate) {
      try {
        const { quota, usage } = await navigator.storage.estimate();
        if (quota && quota - usage < size * 1.05) { rx.delete(key); sendCtl(p, { t: 'cancel', side: 'rx', id: m.id, reason: 'full' }); failItem(tr, `Not enough free space (needs ${fmtBytes(size)})`); return; }
      } catch {}
    }
    try {
      tr.sink = await makeSink({ name, size, type: tr.type, lastModified: Number(m.lastModified) || 0 }, (n) => sendCtl(p, { t: 'ack', id: m.id, bytes: n }));
    } catch { rx.delete(key); sendCtl(p, { t: 'cancel', side: 'rx', id: m.id }); failItem(tr, "Couldn't store the file"); return; }
    if (tr.state !== 'receiving') { tr.sink.abort(); return; }
    tr.opfsName = tr.sink.opfsName;
    tr.t0 = performance.now();
    sendCtl(p, { t: 'accept', id: m.id });
  }

  function onChunk(p, d) {
    const buf = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null;
    if (!buf || buf.length < 4) return;
    const id = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0);
    const key = `${p.id}:${id}`;
    const tr = rx.get(key);
    if (!tr || tr.state !== 'receiving' || !tr.sink) return; // e.g. the tail of a cancelled transfer
    const body = buf.subarray(4);
    if (tr.bytes + body.length > tr.size) { cancelItem(tr, true, 'Received more data than expected'); return; }
    try { tr.sink.push(body); } catch { cancelItem(tr, true, "Couldn't store the file"); return; }
    tr.crc = crc32(body, tr.crc); // for the ZIP, so it can be made instantly later
    tr.bytes += body.length;
  }

  async function onEnd(p, key) {
    const tr = rx.get(key);
    if (!tr || tr.state !== 'receiving' || !tr.sink) return;
    if (tr.bytes !== tr.size) { cancelItem(tr, true, 'The file arrived incomplete'); return; }
    try { tr.file = await tr.sink.finish(); } catch { cancelItem(tr, true, "Couldn't store the file"); return; }
    rx.delete(key);
    if (tr.state !== 'receiving') return;
    sendCtl(p, { t: 'done', id: tr.rid });
    finishItem(tr);
    if ($('#autosave').checked && !tr.batch) saveItem(tr); // batches are saved as one ZIP when they complete
  }

  /* =====================================================================
     Items (the Activity list)
     ===================================================================== */
  const FINAL = new Set(['done', 'failed', 'cancelled']);
  const items = [];
  let itemSeq = 1;

  function newItem(o) {
    const tr = Object.assign({ id: txSeq++, uid: itemSeq++, bytes: 0, rate: 0, lastBytes: 0, t0: 0, t1: 0, note: '', url: null, file: null, saved: false }, o);
    items.unshift(tr);
    if (tr.batch) tr.batch.items.push(tr);
    buildItem(tr);
    renderItem(tr);
    if (tr.batch) renderBatch(tr.batch);
    syncActivity();
    return tr;
  }

  function setState(tr, s) {
    tr.state = s;
    if ((s === 'sending' || s === 'receiving') && !tr.t0) { tr.t0 = performance.now(); tr.lastBytes = tr.bytes; }
    renderItem(tr);
    if (tr.batch) renderBatch(tr.batch);
    syncActivity();
  }

  function finishItem(tr) {
    tr.t1 = performance.now();
    tr.bytes = tr.size;
    setState(tr, 'done');
    if (tr.dir === 'in' && tr.kind === 'file' && !tr.batch) toast(`Received ${tr.name}`);
  }

  function failItem(tr, why) {
    tr.note = why || 'Failed';
    if (tr.answer) tr.answer(false);
    if (tr.wake) tr.wake();
    if (tr.sink && tr.state === 'receiving') tr.sink.abort();
    tx.delete(`${tr.peer.id}:${tr.id}`);
    if (tr.dir === 'in') rx.delete(`${tr.peer.id}:${tr.rid}`);
    setState(tr, 'failed');
  }

  function cancelItem(tr, notify, why) {
    if (FINAL.has(tr.state)) return;
    const was = tr.state;
    if (notify) {
      if (tr.dir === 'out' && (was === 'waiting' || was === 'sending')) sendCtl(tr.peer, { t: 'cancel', side: 'tx', id: tr.id });
      if (tr.dir === 'in') sendCtl(tr.peer, { t: 'cancel', side: 'rx', id: tr.rid });
    }
    if (tr.answer) tr.answer(false);
    if (tr.wake) tr.wake();
    if (tr.sink && was === 'receiving') tr.sink.abort();
    tx.delete(`${tr.peer.id}:${tr.id}`);
    if (tr.dir === 'in') rx.delete(`${tr.peer.id}:${tr.rid}`);
    if (why) { tr.note = why; setState(tr, 'failed'); } else setState(tr, 'cancelled');
  }

  function itemUrl(tr) {
    if (!tr.url && tr.file) tr.url = URL.createObjectURL(tr.file);
    return tr.url;
  }

  function saveItem(tr) {
    if (!tr.file) return;
    const a = document.createElement('a');
    a.href = itemUrl(tr);
    a.download = tr.path ? tr.path.replace(/\//g, ' - ') : tr.name;
    document.body.appendChild(a); a.click(); a.remove();
    tr.saved = true;
    renderItem(tr);
    if (tr.batch) renderBatch(tr.batch);
    syncActivity();
  }

  const zipStamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`; };
  const zipName = (s) => cleanFileName(s).replace(/\//g, '-');
  const receivedFiles = (list) => list.filter((t) => t.dir === 'in' && t.kind === 'file' && t.state === 'done' && t.file);

  function saveZip(list, filename, prefix) {
    if (!list.length) return;
    const entries = list.map((t) => ({ path: (prefix ? prefix(t) : '') + (t.path || t.name), file: t.file, crc: t.crc || 0 }));
    downloadBlob(makeZip(entries), filename);
    for (const t of list) { t.saved = true; renderItem(t); }
    for (const b of new Set(list.map((t) => t.batch).filter(Boolean))) renderBatch(b);
    syncActivity();
  }

  function saveBatchZip(b) {
    const files = receivedFiles(b.items);
    // A folder keeps its own name; loose files get a name that says where they came from.
    saveZip(files, zipName(b.label ? `${b.label}.zip` : `Beam from ${b.peer.name} ${zipStamp()}.zip`));
  }

  /* ---------- batches: several files sent together ---------- */
  const batches = new Map(); // `${peerId}:${bid}` -> batch

  function newBatch(o) {
    const b = Object.assign({ items: [], ended: false, open: false, done: false, actKey: '' }, o);
    b.key = `${b.peer.id}:${b.bid}`;
    if (b.dir === 'in') batches.set(b.key, b);
    const li = el('li', `xfer batch ${b.dir}`);
    const head = el('div', 'batch-head');
    const icon = el('div', 'x-icon folder');
    icon.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 14a3 3 0 0 1 3-3h10l4 5h16a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"/></svg>';
    const main = el('div', 'x-main');
    const top = el('div', 'x-top');
    const name = el('span', 'x-name'), size = el('span', 'x-size');
    top.append(name, size);
    const meta = el('span', 'x-meta');
    const prog = el('div', 'progress'); const bar = el('span'); prog.append(bar);
    main.append(top, meta, prog);
    const actions = el('div', 'x-actions');
    head.append(icon, main, actions);
    const list = el('ul', 'batch-list'); list.hidden = true;
    li.append(head, list);
    b.el = { li, name, size, meta, prog, bar, actions, list };
    $('#xfers').prepend(li);
    return b;
  }

  function renderBatch(b) {
    const { name, size, meta, prog, bar, actions, list } = b.el;
    const out = b.dir === 'out';
    const its = b.items;
    const ok = its.filter((t) => t.state === 'done').length;
    const bad = its.filter((t) => t.state === 'failed' || t.state === 'cancelled').length;
    const active = its.filter((t) => !FINAL.has(t.state));
    const peerGone = peers.get(b.peer.id) !== b.peer;
    const complete = !active.length && (its.length >= b.count || b.ended || peerGone || out);
    const total = b.total || its.reduce((n, t) => n + t.size, 0);
    const got = its.reduce((n, t) => n + (t.state === 'done' ? t.size : t.bytes), 0);
    const rate = active.reduce((n, t) => n + (t.rate || 0), 0);

    name.textContent = b.label ? `${b.label}/` : `${b.count} files`;
    name.title = name.textContent;
    size.textContent = fmtBytes(total);
    meta.textContent = '';
    meta.append(el('span', `dir ${b.dir}`, out ? '↑ ' : '↓ '), document.createTextNode(`${out ? 'To' : 'From'} ${b.peer.name}`));
    const add = (txt, cls) => { meta.append(document.createTextNode(' · ')); meta.append(cls ? el('span', cls, txt) : document.createTextNode(txt)); };
    if (!complete) {
      add(`${ok} of ${b.count} files`);
      if (total) add(`${Math.floor(Math.min(100, (got / total) * 100))}%`);
      if (rate > 0) { add(fmtRate(rate)); const left = (total - got) / rate; if (left > 1) add(`${fmtTime(left)} left`); }
    } else {
      const allSaved = ok && receivedFiles(its).every((t) => t.saved);
      add(`${ok} ${ok === 1 ? 'file' : 'files'} ${out ? 'delivered' : allSaved ? 'saved' : 'received'}`, ok ? 'good' : '');
      if (bad) add(`${bad} failed`, 'bad');
    }
    prog.hidden = complete;
    bar.style.width = `${total ? Math.min(100, (got / total) * 100) : 0}%`;
    list.hidden = !b.open;

    if (complete && !b.done) {
      b.done = true;
      if (!out && ok) {
        toast(`Received ${ok} ${ok === 1 ? 'file' : 'files'} from ${b.peer.name}`);
        if ($('#autosave').checked) { saveBatchZip(b); return; }
      }
    }

    const files = receivedFiles(its);
    const actKey = `${complete}|${b.open}|${files.length}|${files.every((t) => t.saved)}|${its.length}`;
    if (b.actKey === actKey) return;
    b.actKey = actKey;
    actions.textContent = '';
    const btn = (label, fn, cls = '') => { const x = el('button', `btn small-btn ${cls}`, label); x.type = 'button'; x.addEventListener('click', fn); actions.append(x); return x; };
    if (!complete) btn('Cancel all', () => { for (const t of [...its]) if (!FINAL.has(t.state)) cancelItem(t, true); renderBatch(b); }, 'danger');
    if (complete && !out && files.length) {
      const saved = files.every((t) => t.saved);
      btn(saved ? 'Download ZIP again' : 'Download ZIP', () => saveBatchZip(b), saved ? '' : 'primary');
    }
    const t = btn(b.open ? 'Hide files' : 'Show files', () => { b.open = !b.open; renderBatch(b); });
    t.setAttribute('aria-expanded', String(b.open));
    if (complete) { const x = btn('×', () => { for (const it of [...its]) removeItem(it); }, 'icon'); x.setAttribute('aria-label', 'Remove from list'); }
  }

  function removeBatchIfEmpty(b) {
    if (b.items.length) { renderBatch(b); return; }
    b.el.li.remove();
    batches.delete(b.key);
  }

  function removeItem(tr) {
    if (!FINAL.has(tr.state)) cancelItem(tr, true);
    const i = items.indexOf(tr);
    if (i >= 0) items.splice(i, 1);
    if (tr.url) URL.revokeObjectURL(tr.url);
    if (tr.thumb) URL.revokeObjectURL(tr.thumb);
    removeStored(tr.opfsName);
    tr.el.li.remove();
    if (tr.batch) { const b = tr.batch, j = b.items.indexOf(tr); if (j >= 0) b.items.splice(j, 1); removeBatchIfEmpty(b); }
    syncActivity();
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function extOf(name) { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ''); return m ? m[1] : 'file'; }

  function buildItem(tr) {
    const li = el('li', `xfer ${tr.dir}`);
    const icon = el('div', 'x-icon' + (tr.kind === 'text' ? ' text' : ''), tr.kind === 'text' ? '¶' : extOf(tr.name));
    const main = el('div', 'x-main');
    const top = el('div', 'x-top');
    const name = el('span', 'x-name', tr.path || tr.name);
    name.title = tr.path || tr.name;
    const size = el('span', 'x-size', tr.kind === 'text' ? '' : fmtBytes(tr.size));
    top.append(name, size);
    const meta = el('span', 'x-meta');
    const prog = el('div', 'progress'); const bar = el('span'); prog.append(bar);
    main.append(top, meta);
    let text = null;
    if (tr.kind === 'text') { text = el('p', 'x-text', tr.text); main.append(text); prog.hidden = true; } else main.append(prog);
    const actions = el('div', 'x-actions');
    li.append(icon, main, actions);
    tr.el = { li, icon, meta, prog, bar, actions };
    if (tr.batch) tr.batch.el.list.append(li); else $('#xfers').prepend(li);
    if (tr.kind === 'file' && tr.dir === 'out' && /^image\//.test(tr.type) && tr.size < 30e6) setThumb(tr, tr.file);
  }

  function setThumb(tr, file) {
    if (tr.thumb) return;
    tr.thumb = URL.createObjectURL(file);
    const img = new Image();
    img.alt = ''; img.decoding = 'async'; img.src = tr.thumb;
    img.onerror = () => { img.remove(); tr.el.icon.textContent = extOf(tr.name); };
    tr.el.icon.textContent = '';
    tr.el.icon.append(img);
  }

  const isUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim()) && s.trim().length < 2000;

  function renderItem(tr) {
    const { meta, prog, bar, actions } = tr.el;
    const out = tr.dir === 'out';
    meta.textContent = '';
    const dir = el('span', `dir ${tr.dir}`, out ? '↑ ' : '↓ ');
    meta.append(dir, document.createTextNode(`${out ? 'To' : 'From'} ${tr.peer.name}`));
    const add = (txt, cls) => { meta.append(document.createTextNode(' · ')); if (cls) meta.append(el('span', cls, txt)); else meta.append(document.createTextNode(txt)); };
    const pct = tr.size ? Math.min(100, (tr.bytes / tr.size) * 100) : 100;
    switch (tr.state) {
      case 'queued': add('Queued'); break;
      case 'waiting': add('Waiting for the other device'); break;
      case 'sending': case 'receiving': {
        add(`${Math.floor(pct)}%`);
        if (tr.rate > 0) { add(fmtRate(tr.rate)); const left = (tr.size - tr.bytes) / tr.rate; if (left > 1) add(`${fmtTime(left)} left`); }
        break;
      }
      case 'done': {
        if (tr.kind === 'text') { add(out ? 'Sent' : 'Received', 'good'); break; }
        add(out ? 'Delivered' : (tr.saved ? 'Saved' : 'Received'), 'good');
        const secs = tr.t0 && tr.t1 ? (tr.t1 - tr.t0) / 1000 : 0;
        if (secs > 0.2 && tr.size > 1e6) add(`${fmtTime(secs)}, ${fmtRate(tr.size / secs)} average`);
        break;
      }
      case 'failed': add(tr.note || 'Failed', 'bad'); break;
      case 'cancelled': add('Cancelled', 'bad'); break;
    }
    if (tr.kind === 'file') {
      prog.hidden = FINAL.has(tr.state) && tr.state !== 'failed' ? true : tr.state === 'queued';
      bar.style.width = `${pct}%`;
      if (tr.state === 'done' && tr.dir === 'in' && /^image\//.test(tr.type) && tr.size < 60e6) setThumb(tr, tr.file);
    }

    // Only rebuild the buttons when they change, so a click never lands on a button that was just replaced.
    const actKey = `${tr.state}|${tr.saved}`;
    if (tr.actKey === actKey) return;
    tr.actKey = actKey;
    actions.textContent = '';
    const btn = (label, fn, cls = '') => { const b = el('button', `btn small-btn ${cls}`, label); b.type = 'button'; b.addEventListener('click', fn); actions.append(b); return b; };
    if (!FINAL.has(tr.state)) btn('Cancel', () => cancelItem(tr, true), 'danger');
    else {
      if (tr.state === 'done' && tr.dir === 'in' && tr.kind === 'file') {
        btn(tr.saved ? 'Save again' : 'Save', () => saveItem(tr), tr.saved ? '' : 'primary');
        if (/^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/|audio\/|application\/pdf$|text\/plain$)/.test(tr.type)) {
          const a = el('a', 'btn small-btn', 'Open');
          a.target = '_blank'; a.rel = 'noopener'; a.href = itemUrl(tr);
          actions.append(a);
        }
      }
      if (tr.kind === 'text') {
        btn('Copy', async () => toast((await copyText(tr.text)) ? 'Copied' : "Couldn't copy"));
        if (isUrl(tr.text) && tr.dir === 'in') {
          const a = el('a', 'btn small-btn', 'Open link');
          a.href = tr.text.trim(); a.target = '_blank'; a.rel = 'noopener noreferrer';
          actions.append(a);
        }
      }
      const x = btn('×', () => removeItem(tr), 'icon');
      x.setAttribute('aria-label', 'Remove from list');
    }
  }
  function renderAllItems() {
    for (const tr of items) renderItem(tr);
    for (const b of new Set(items.map((t) => t.batch).filter(Boolean))) { b.actKey = ''; renderBatch(b); }
  }

  function syncActivity() {
    $('#xfers-empty').hidden = items.length > 0;
    $('#clear-done').hidden = !items.some((t) => FINAL.has(t.state));
    $('#save-all').hidden = receivedFiles(items).length < 2;
  }

  // Finished files leave the list, but a group still in progress keeps all of its files together.
  $('#clear-done').addEventListener('click', () => { for (const tr of items.filter((t) => FINAL.has(t.state) && (!t.batch || t.batch.done))) removeItem(tr); });
  // Everything received, in one ZIP. Files from different devices go in a folder per device.
  $('#save-all').addEventListener('click', () => {
    const list = receivedFiles(items).reverse();
    const devices = new Set(list.map((t) => t.peer.name));
    saveZip(list, `Beam ${zipStamp()}.zip`, devices.size > 1 ? (t) => `${zipName(t.peer.name)}/` : null);
  });

  /* =====================================================================
     Rendering: this device, pairing card, devices
     ===================================================================== */
  function renderMe() {
    $('#me-dot').className = 'dot' + (meReady ? '' : ' wait');
    $('#my-kind').textContent = ME.label;
  }
  const nameInput = $('#my-name');
  nameInput.value = myName;
  const commitName = () => {
    const n = cleanName(nameInput.value, myName);
    nameInput.value = n;
    if (n === myName) return;
    myName = n; store.set('beam-name', n);
    broadcast({ t: 'name', name: n });
  };
  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });

  let qrFor = '';
  function renderPair() {
    const link = room ? `${location.origin}${location.pathname}?code=${room}` : '';
    $('#code').textContent = room || '------';
    if (link !== qrFor) { qrFor = link; if (link) $('#qr').src = qrImage(link); else $('#qr').removeAttribute('src'); }
    let s;
    if (!rtcOk) s = '';
    else if (!meReady) s = 'Connecting to the pairing service…';
    else if (joining) s = `Joining ${joining}…`;
    else if (doorReady) s = peers.size ? 'Other devices can join with this code too.' : 'Ready. Waiting for a device to join.';
    else if (peers.size && [...peers.values()].some((p) => p.door)) s = 'Other devices can join with this code.';
    else if (door) s = 'Opening the room…';
    else s = 'Reconnecting…';
    $('#room-status').textContent = s;
  }

  $('#copy-link').addEventListener('click', async () => {
    if (!room) return;
    const link = `${location.origin}${location.pathname}?code=${room}`;
    toast((await copyText(link)) ? 'Link copied' : `Copy failed. The code is ${room}`);
  });
  $('#new-room').addEventListener('click', () => {
    if (!meReady) return;
    if (peers.size && !confirm('Connected devices will be disconnected. Make a new code?')) return;
    leaveRoom();
    freshRoom();
    renderPair();
  });
  $('#code-input').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = cleanCode($('#code-input').value);
    if (!validCode(c)) { showError($('#join-error'), 'Enter the 6-character code shown on the other device.'); return; }
    $('#code-input').value = '';
    join(c);
  });

  const ROUTES = { lan: ['Local network', 'lan'], net: ['Over the internet', 'net'], relay: ['Relayed, slower', 'relay'] };
  function renderDevices() {
    const list = $('#device-list');
    list.textContent = '';
    const ready = [...peers.values()];
    for (const p of ready) {
      const li = el('li', 'device');
      const icon = el('span', 'dev-icon'); icon.innerHTML = ICONS[p.kind] || ICONS.computer;
      icon.append(el('span', 'dot' + (p.open && p.greeted ? '' : ' wait')));
      const main = el('div', 'dev-main');
      main.append(el('span', 'dev-name', p.name));
      const meta = el('span', 'dev-meta');
      if (!p.open || !p.greeted) meta.textContent = 'Connecting…';
      else {
        if (p.label) meta.append(document.createTextNode(p.label));
        if (p.route) { const [t, c] = ROUTES[p.route]; if (p.label) meta.append(document.createTextNode(' · ')); meta.append(el('span', `route ${c}`, t)); }
        if (p.rtt != null) meta.append(document.createTextNode(` · ${p.rtt} ms`));
      }
      main.append(meta);
      li.append(icon, main);
      if (p.open && p.greeted) {
        const b = el('button', 'btn small-btn', 'Send files'); b.type = 'button';
        b.addEventListener('click', () => { pickTarget = [p]; $('#file-input').click(); });
        li.append(b);
        li.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); li.classList.add('drag-over'); } });
        li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
        li.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); li.classList.remove('drag-over'); hideVeil(); dropped(e, [p]); });
      }
      list.append(li);
    }
    const live = ready.filter((p) => p.open && p.greeted);
    $('#dev-count').textContent = String(live.length);
    $('#dev-empty').hidden = ready.length > 0;
    document.body.classList.toggle('alone', live.length === 0);

    const sel = $('#target'), prev = sel.value;
    sel.textContent = '';
    const all = el('option', '', live.length > 1 ? `All devices (${live.length})` : 'All devices'); all.value = '*';
    sel.append(all);
    for (const p of live) { const o = el('option', '', p.name); o.value = p.id; sel.append(o); }
    sel.value = [...sel.options].some((o) => o.value === prev) ? prev : '*';
    renderPair();
  }

  /* =====================================================================
     Choosing what to send
     ===================================================================== */
  let pickTarget = null;
  function targets() {
    if (pickTarget) { const t = pickTarget.filter((p) => peers.get(p.id) === p); pickTarget = null; return t; }
    const v = $('#target').value;
    const live = [...peers.values()].filter((p) => p.open && p.greeted);
    return v === '*' ? live : live.filter((p) => p.id === v);
  }

  $('#pick-files').addEventListener('click', (e) => { e.stopPropagation(); pickTarget = null; $('#file-input').click(); });
  $('#pick-folder').addEventListener('click', (e) => { e.stopPropagation(); pickTarget = null; $('#folder-input').click(); });
  if (!('webkitdirectory' in document.createElement('input')) || /iPhone|iPad|Android/.test(navigator.userAgent)) $('#pick-folder').hidden = true;
  $('#drop').addEventListener('click', () => { pickTarget = null; $('#file-input').click(); });
  $('#drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-input').click(); } });

  for (const id of ['#file-input', '#folder-input']) {
    $(id).addEventListener('change', (e) => {
      const files = [...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
      e.target.value = '';
      queueFiles(files, targets());
    });
    $(id).addEventListener('cancel', () => { pickTarget = null; });
  }

  $('#text-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#text-input').value;
    if (!t.trim()) return;
    if (sendText(t, targets())) $('#text-input').value = '';
  });
  $('#text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#text-form').requestSubmit(); }
  });

  const autosave = $('#autosave');
  autosave.checked = store.get('beam-autosave') === '1';
  autosave.addEventListener('change', () => store.set('beam-autosave', autosave.checked ? '1' : '0'));

  /* drag and drop, including whole folders */
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  let veilDepth = 0;
  const hideVeil = () => { veilDepth = 0; $('#drag-veil').hidden = true; $('#drop').classList.remove('drag-over'); };
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; veilDepth++; $('#drag-veil').hidden = false; $('#drop').classList.add('drag-over'); });
  window.addEventListener('dragleave', () => { if (--veilDepth <= 0) hideVeil(); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); hideVeil(); dropped(e, null); });

  function dropped(e, to) {
    // Entries must be taken synchronously, before the drop event ends.
    const entries = [...e.dataTransfer.items].filter((i) => i.kind === 'file').map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
    const plain = [...e.dataTransfer.files];
    const dest = to || targets();
    if (entries.length && entries.every(Boolean)) {
      collect(entries).then((list) => queueFiles(list, dest)).catch(() => queueFiles(plain.map((f) => ({ file: f, path: f.name })), dest));
    } else queueFiles(plain.map((f) => ({ file: f, path: f.name })), dest);
  }

  async function collect(entries) {
    const out = [];
    const fileOf = (fe) => new Promise((res, rej) => fe.file(res, rej));
    const readAll = (dir) => new Promise((res, rej) => {
      const r = dir.createReader(), all = [];
      const step = () => r.readEntries((batch) => { if (!batch.length) res(all); else { all.push(...batch); step(); } }, rej);
      step();
    });
    async function walk(entry, prefix) {
      if (out.length > 5000) return;
      if (entry.isFile) { const f = await fileOf(entry); out.push({ file: f, path: prefix + f.name }); }
      else if (entry.isDirectory) for (const child of await readAll(entry)) await walk(child, `${prefix}${entry.name}/`);
    }
    for (const en of entries) await walk(en, '');
    return out;
  }

  // Pasting files (screenshots, copied files) sends them, unless you're typing in a box.
  document.addEventListener('paste', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const files = [...(e.clipboardData && e.clipboardData.files || [])];
    if (files.length) { e.preventDefault(); queueFiles(files.map((f) => ({ file: f, path: f.name || 'pasted' })), targets()); return; }
    const t = e.clipboardData && e.clipboardData.getData('text');
    if (t) { $('#text-input').value = t; $('#text-input').focus(); }
  });

  /* =====================================================================
     Live numbers, speed chart, title, keep awake
     ===================================================================== */
  let totalSent = 0, totalRecv = 0, upNow = 0, downNow = 0, lastTick = performance.now(), wake = null, wakeBusy = false;
  const history_ = [];
  const liveBatches = new Set();
  const HIST = 60;

  setInterval(() => {
    const now = performance.now(), dt = Math.max(0.001, (now - lastTick) / 1000);
    lastTick = now;
    let up = 0, down = 0, active = 0, done = 0, total = 0;
    for (const tr of items) {
      const delta = tr.bytes - tr.lastBytes;
      tr.lastBytes = tr.bytes;
      if (tr.kind !== 'file') continue;
      if (delta > 0) { if (tr.dir === 'out') totalSent += delta; else totalRecv += delta; }
      if (tr.state === 'sending' || tr.state === 'receiving') {
        const inst = delta / dt;
        tr.rate = tr.rate ? tr.rate * 0.6 + inst * 0.4 : inst;
        if (tr.dir === 'out') up += inst; else down += inst;
        active++; done += tr.bytes; total += tr.size;
        renderItem(tr);
        if (tr.batch) liveBatches.add(tr.batch);
      } else if (tr.state === 'waiting' || tr.state === 'queued') active++;
    }
    for (const b of liveBatches) renderBatch(b);
    liveBatches.clear();
    upNow = upNow * 0.5 + up * 0.5; downNow = downNow * 0.5 + down * 0.5;
    if (up === 0 && upNow < 1024) upNow = 0;
    if (down === 0 && downNow < 1024) downNow = 0;
    $('#st-up').textContent = fmtRate(upNow);
    $('#st-down').textContent = fmtRate(downNow);
    $('#st-sent').textContent = fmtBytes(totalSent);
    $('#st-recv').textContent = fmtBytes(totalRecv);
    document.title = total ? `${Math.floor((done / total) * 100)}% · Beam` : 'Beam: Fast File Transfer Between Devices on Your Wi-Fi, Free';
    keepAwake(active > 0);
  }, 250);

  setInterval(() => {
    history_.push([upNow, downNow]);
    if (history_.length > HIST) history_.shift();
    drawSpark();
  }, 1000);

  const spark = $('#spark');
  function drawSpark() {
    const dpr = window.devicePixelRatio || 1, w = spark.clientWidth, h = spark.clientHeight;
    if (!w) return;
    if (spark.width !== Math.round(w * dpr)) { spark.width = Math.round(w * dpr); spark.height = Math.round(h * dpr); }
    const g = spark.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    g.strokeStyle = css.getPropertyValue('--border').trim(); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5); g.stroke();
    const max = Math.max(1, ...history_.flat());
    const step = w / (HIST - 1), x0 = w - (history_.length - 1) * step;
    const line = (idx, color) => {
      if (history_.length < 2) return;
      g.beginPath();
      history_.forEach((v, i) => { const x = x0 + i * step, y = h - 2 - (v[idx] / max) * (h - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
      g.lineTo(w, h); g.lineTo(x0, h); g.closePath();
      g.globalAlpha = 0.12; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    };
    line(1, css.getPropertyValue('--accent-2').trim());
    line(0, css.getPropertyValue('--accent').trim());
  }
  window.addEventListener('resize', drawSpark);

  // Phones and tablets stop the page when the screen sleeps, so stay awake while something is moving.
  async function keepAwake(on) {
    if (wakeBusy || !('wakeLock' in navigator)) return;
    if (on && !wake && document.visibilityState === 'visible') {
      wakeBusy = true;
      try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch {}
      wakeBusy = false;
    } else if (!on && wake) { wake.release().catch(() => {}); wake = null; }
  }

  window.addEventListener('beforeunload', (e) => {
    if (items.some((t) => t.state === 'sending' || t.state === 'receiving' || t.state === 'waiting')) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', (e) => {
    if (e.persisted) return;
    for (const p of peers.values()) { try { p.conn.close(); } catch {} }
    if (door) { try { door.destroy(); } catch {} }
    if (me) { try { me.destroy(); } catch {} }
  });

  /* ---------- start ---------- */
  renderMe();
  renderDevices();
  syncActivity();
  drawSpark();
  if (!rtcOk) { $('#unsupported').hidden = false; $('#room-status').textContent = ''; return; }
  cleanOldInboxes();
  startMe();
})();
