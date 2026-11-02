#!/usr/bin/env node
/* Local network host for the board games. No dependencies, Node 16+.

     node games/party/host-server.js [port]

   Serves the games to your Wi-Fi and relays moves over a WebSocket, so devices can join
   by IP address or QR code with no internet connection. See games/party/README.md. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const MAX_FRAME = 64 * 1024, MAX_ROOMS = 50, MAX_PEERS = 12, ROOM_GRACE_MS = 10 * 60 * 1000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function lanAddresses() {
  const virtual = /vEthernet|VMware|VirtualBox|WSL|Hyper-V|Loopback|Tailscale|ZeroTier|docker|utun|tun|tap/i;
  const score = (name, ip) => (virtual.test(name) ? 10 : 0) + (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.')) found.push({ ip: a.address, s: score(name, a.address) });
    }
  }
  return found.sort((a, b) => a.s - b.s).map((a) => a.ip);
}

/* ---------- rooms ---------- */
const rooms = new Map();   // code -> { code, game, host, peers: Map<id, socket>, emptySince }
let nextId = 1;

function openRooms(game) {
  return [...rooms.values()].filter((r) => r.host && (!game || r.game === game)).map((r) => ({ code: r.code, game: r.game }));
}

setInterval(() => {
  for (const [code, r] of rooms) if (!r.host && !r.peers.size && Date.now() - r.emptySince > ROOM_GRACE_MS) rooms.delete(code);
}, 30000).unref();

/* ---------- static files + room info ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__party/info') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ lan: lanAddresses(), port: PORT, rooms: openRooms(url.searchParams.get('game')) }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel === '/') { res.writeHead(302, { location: '/games/' }); res.end(); return; }
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  // nothing outside the site, and nothing hidden such as .git
  if (parts.some((p) => p.startsWith('.') || p.includes('\0'))) { res.writeHead(403); res.end('Forbidden'); return; }
  let file = path.join(ROOT, ...parts);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(302, { location: url.pathname + '/' + url.search }); res.end(); return; }
      file = path.join(file, 'index.html');
    }
    fs.stat(file, (err2, st2) => {
      if (err2 || !st2.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st2.size, 'cache-control': 'no-cache' });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
  });
});

/* ---------- minimal WebSocket (RFC 6455, text frames) ---------- */
function encodeFrame(text) {
  const body = Buffer.from(text), len = body.length;
  const head = len < 126 ? Buffer.from([0x81, len])
    : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, body]);
}

function attachSocket(socket, onText, onClose) {
  let buf = Buffer.alloc(0), closed = false;
  const finish = () => { if (!closed) { closed = true; socket.destroy(); onClose(); } };
  socket.on('error', finish); socket.on('close', finish); socket.on('end', finish);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15, masked = buf[1] & 128;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { finish(); return; }
      if (!masked || len > MAX_FRAME) { finish(); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i % 4];
      buf = buf.subarray(off + 4 + len);
      if (op === 8) { finish(); return; }
      if (op === 9) { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      if (op === 1) onText(data.toString());
    }
  });
  return { send: (obj) => { if (!closed) socket.write(encodeFrame(JSON.stringify(obj))); }, close: finish };
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  const origin = req.headers.origin;
  // only pages served by this host may use the relay, not other websites open on the device
  let sameOrigin = false;
  try { sameOrigin = !origin || new URL(origin).host === req.headers.host; } catch {}
  if (url.pathname !== '/__party/ws' || !key || !sameOrigin) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');

  const role = url.searchParams.get('role'), code = String(url.searchParams.get('room') || '').toUpperCase().slice(0, 12), game = String(url.searchParams.get('game') || '').slice(0, 32);
  if (!code) { socket.destroy(); return; }

  if (role === 'host') {
    let room = rooms.get(code);
    if (room && room.game !== game) { const c = attachSocket(socket, () => {}, () => {}); c.send({ t: 'error', reason: 'taken' }); c.close(); return; }
    if (!room) {
      if (rooms.size >= MAX_ROOMS) { socket.destroy(); return; }
      room = { code, game, host: null, peers: new Map(), emptySince: 0 };
      rooms.set(code, room);
    }
    if (room.host) room.host.close();
    const conn = attachSocket(socket, (text) => {
      let m; try { m = JSON.parse(text); } catch { return; }
      if (m.t === 'to') room.peers.get(m.id)?.send({ t: 'msg', data: m.data });
      else if (m.t === 'all') for (const p of room.peers.values()) p.send({ t: 'msg', data: m.data });
      else if (m.t === 'drop') room.peers.get(m.id)?.close();
    }, () => {
      if (room.host !== conn) return;
      room.host = null; room.emptySince = Date.now();
      for (const p of room.peers.values()) p.send({ t: 'hostgone' });
    });
    room.host = conn;
    conn.send({ t: 'ready' });
    for (const id of room.peers.keys()) conn.send({ t: 'open', id });
    for (const p of room.peers.values()) p.send({ t: 'hostback' });
    return;
  }

  const room = rooms.get(code);
  if (!room || !room.host || room.game !== game || room.peers.size >= MAX_PEERS) {
    const c = attachSocket(socket, () => {}, () => {});
    c.send({ t: 'error', reason: 'notfound' }); c.close();
    return;
  }
  const id = 'c' + nextId++;
  const conn = attachSocket(socket, (text) => {
    let data; try { data = JSON.parse(text); } catch { return; }
    room.host?.send({ t: 'msg', id, data });
  }, () => {
    room.peers.delete(id);
    room.host?.send({ t: 'close', id });
    if (!room.peers.size && !room.host) room.emptySince = Date.now();
  });
  room.peers.set(id, conn);
  conn.send({ t: 'ready' });
  room.host.send({ t: 'open', id });
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Try: node games/party/host-server.js ${PORT + 1}` : e.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('\n  Board games are live on your network.\n');
  console.log(`  On this device:   http://localhost:${PORT}/games/`);
  for (const ip of ips) console.log(`  On your Wi-Fi:    http://${ip}:${PORT}/games/`);
  if (!ips.length) console.log('  No network found. Connect to Wi-Fi so other devices can reach this one.');
  console.log('\n  Host a room from any of these pages. Other devices scan its QR code or type the IP.');
  console.log('  If they cannot connect, allow Node.js through your firewall on private networks.');
  console.log('  Press Ctrl+C to stop.\n');
});
