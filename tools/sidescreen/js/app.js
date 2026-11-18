/* Sidescreen: one device shares a screen or window, others show it.
   The computer hosts a PeerJS room named after a 6-letter code. Each screen that joins opens a data channel
   (for its name and size) and the computer then calls it with the captured stream. Media flows peer to peer. */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0 or 1, which are easy to misread
  const peerId = (code) => `vbek-bio-sidescreen-${code}`.toLowerCase();
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('');
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const validCode = (s) => s.length === 6 && [...s].every((c) => ALPHABET.includes(c));

  const PRESETS = {
    text: { w: 1920, h: 1080, fps: 30, bitrate: 8e6, hint: 'detail', degrade: 'maintain-resolution' },
    smooth: { w: 1920, h: 1080, fps: 60, bitrate: 12e6, hint: 'motion', degrade: 'maintain-framerate' },
    saver: { w: 1280, h: 720, fps: 20, bitrate: 2.5e6, hint: 'detail', degrade: 'balanced' },
  };

  const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  /* ---------- small helpers ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }

  function deviceName() {
    const ua = navigator.userAgent;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    if (/CrOS/.test(ua)) return 'Chromebook';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Linux/.test(ua)) return 'Linux computer';
    return 'Browser';
  }

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

  /* ---------- pages ---------- */
  const pages = ['#home', '#send', '#join', '#screen'];
  function show(id) { for (const p of pages) $(p).hidden = p !== id; window.scrollTo(0, 0); }

  function goHome() {
    stopSharing();
    leaveScreen();
    if (location.search) history.replaceState(null, '', location.pathname);
    show('#home');
  }
  document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', goHome));

  $('#pick-send').addEventListener('click', () => {
    showError($('#send-error'), '');
    $('#send-setup').hidden = false; $('#send-live').hidden = true;
    show('#send');
  });
  $('#pick-watch').addEventListener('click', () => {
    showError($('#join-error'), '');
    show('#join');
    setTimeout(() => $('#code-input').focus(), 50);
  });
  if (!canShare) { $('#pick-send').disabled = true; $('#no-share').hidden = false; }

  /* =====================================================================
     Computer: share a screen or window
     ===================================================================== */
  let stream = null, peer = null, code = '', repair = null, paused = false, preset = 'text', brokerUp = false;
  const viewers = new Map(); // connectionId -> { conn, call, name, size, live }

  async function capture() {
    const p = PRESETS[preset];
    const wantAudio = $('#audio').checked;
    const video = { width: { max: p.w }, height: { max: p.h }, frameRate: { ideal: p.fps, max: p.fps } };
    const extra = { selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include' };
    const tries = [
      { video, audio: wantAudio, ...extra },
      { video: true, audio: wantAudio },
      { video: true, audio: false },
    ];
    let last;
    for (const opts of tries) {
      try { return await navigator.mediaDevices.getDisplayMedia(opts); } catch (e) {
        last = e;
        // Cancelling the picker or denying permission is final; only retry when the browser disliked the options.
        if (e.name === 'NotAllowedError' || e.name === 'AbortError' || e.name === 'NotFoundError') throw e;
      }
    }
    throw last;
  }

  function captureMessage(e) {
    if (e.name === 'NotAllowedError') {
      return /mac/i.test(navigator.platform) && e.message && /system|permission/i.test(e.message)
        ? 'macOS blocked screen recording for this browser. Open System Settings › Privacy & Security › Screen Recording, turn on your browser, then restart it.'
        : 'Nothing was shared. Choose a screen or window and click Share. On a Mac, your browser also needs Screen Recording permission in System Settings › Privacy & Security.';
    }
    return `This browser couldn't share the screen (${e.name || 'error'}). Try the latest Chrome, Edge, Firefox or Safari.`;
  }

  function applyPreset(track) {
    if (!track) return;
    const p = PRESETS[preset];
    try { track.contentHint = p.hint; } catch {}
    track.applyConstraints({ width: { max: p.w }, height: { max: p.h }, frameRate: { max: p.fps } }).catch(() => {});
  }

  async function tuneSender(pc) {
    const p = PRESETS[preset];
    for (const s of pc.getSenders()) {
      if (!s.track || s.track.kind !== 'video') continue;
      try {
        const params = s.getParameters();
        if (!params.encodings || !params.encodings.length) continue; // not negotiated yet
        params.encodings[0].maxBitrate = p.bitrate;
        params.encodings[0].maxFramerate = p.fps;
        params.degradationPreference = p.degrade;
        await s.setParameters(params);
      } catch {}
    }
  }

  function describeSource() {
    const t = stream && stream.getVideoTracks()[0];
    if (!t) return '';
    const s = t.getSettings ? t.getSettings() : {};
    const what = { monitor: 'a whole screen', window: 'a window', browser: 'a browser tab' }[s.displaySurface] || 'your screen';
    const size = s.width && s.height ? ` at ${s.width}×${s.height}` : '';
    return `Sharing ${what}${size}.`;
  }

  function onTrackEnded() { stopSharing(); show('#send'); $('#send-setup').hidden = false; $('#send-live').hidden = true; toast('Sharing stopped'); }

  function useStream(s) {
    if (stream) for (const t of stream.getTracks()) { t.removeEventListener('ended', onTrackEnded); t.stop(); }
    stream = s;
    const v = s.getVideoTracks()[0];
    applyPreset(v);
    if (v) { v.enabled = !paused; v.addEventListener('ended', onTrackEnded); }
    $('#preview').srcObject = s;
    $('#preview').play().catch(() => {});
    $('#source-name').textContent = describeSource();
    setTimeout(() => { $('#source-name').textContent = describeSource(); }, 600); // sizes settle after the first frames
  }

  $('#start').addEventListener('click', async () => {
    showError($('#send-error'), '');
    preset = $('#quality').value;
    let s;
    try { s = await capture(); } catch (e) { showError($('#send-error'), captureMessage(e)); return; }
    paused = false; syncPause();
    useStream(s);
    $('#quality-live').value = preset;
    $('#send-setup').hidden = true; $('#send-live').hidden = false;
    openRoom(newCode());
  });

  function openRoom(c) {
    closeRoom();
    code = c; brokerUp = false;
    const link = `${location.origin}${location.pathname}?code=${code}`;
    $('#code').textContent = code;
    $('#qr').src = qrImage(link);
    $('#copy-link').onclick = async () => toast((await copyText(link)) ? 'Link copied' : 'Copy failed. The code is ' + code);
    setBroker('Connecting to the pairing service…');

    let everReady = false;
    const open = () => {
      peer = new Peer(peerId(code), { debug: 0 });
      peer.on('open', () => { everReady = true; brokerUp = true; setBroker(viewers.size ? '' : 'Ready. Waiting for a screen to join.'); });
      peer.on('disconnected', () => { brokerUp = false; });
      peer.on('connection', onViewer);
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id' && !everReady) { openRoom(newCode()); return; }
        if (e.type === 'browser-incompatible' || e.type === 'webrtc') setBroker('This browser does not support WebRTC.');
        else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) setBroker("Can't reach the pairing service. Check your internet connection. Retrying…");
      });
    };
    open();
    // Screens that are already connected keep streaming while the link to the broker is repaired.
    repair = setInterval(() => {
      if (!peer) return;
      if (peer.destroyed) open();
      else if (peer.disconnected) { try { peer.reconnect(); } catch {} }
    }, 4000);
  }

  function closeRoom() {
    clearInterval(repair); repair = null;
    for (const v of viewers.values()) { try { v.call && v.call.close(); } catch {} try { v.conn.close(); } catch {} }
    viewers.clear(); renderViewers();
    if (peer) { try { peer.destroy(); } catch {} peer = null; }
  }

  function setBroker(msg) { $('#broker').textContent = msg; $('#broker').hidden = !msg; }

  function onViewer(conn) {
    const v = { conn, call: null, name: 'A screen', size: '', live: false };
    viewers.set(conn.connectionId, v);
    renderViewers();
    const drop = () => {
      if (!viewers.has(conn.connectionId)) return;
      viewers.delete(conn.connectionId);
      try { v.call && v.call.close(); } catch {}
      try { conn.close(); } catch {}
      renderViewers();
      if (v.live) toast(`${v.name} left`);
    };
    conn.on('open', () => {
      if (!stream) return drop();
      conn.send({ type: 'paused', value: paused });
      const call = peer.call(conn.peer, stream);
      v.call = call;
      const pc = call.peerConnection;
      const watchState = () => {
        const st = pc.connectionState || pc.iceConnectionState;
        if (st === 'connected' || st === 'completed') {
          if (!v.live) { v.live = true; renderViewers(); toast(`${v.name} connected`); }
          tuneSender(pc);
        } else if (st === 'failed' || st === 'closed') drop();
      };
      pc.addEventListener('connectionstatechange', watchState);
      pc.addEventListener('iceconnectionstatechange', watchState);
      call.on('close', drop);
      call.on('error', drop);
    });
    conn.on('data', (d) => {
      if (!d || d.type !== 'hello') return;
      v.name = String(d.name || 'A screen').slice(0, 40);
      v.size = d.w && d.h ? `${Math.round(d.w)}×${Math.round(d.h)}` : '';
      renderViewers();
    });
    conn.on('close', drop);
    conn.on('error', drop);
  }

  function renderViewers() {
    const ul = $('#viewers');
    ul.textContent = '';
    if (!viewers.size) {
      const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'None yet';
      ul.append(li);
      if (brokerUp) setBroker('Ready. Waiting for a screen to join.');
      return;
    }
    setBroker('');
    for (const v of viewers.values()) {
      const li = document.createElement('li');
      const dot = document.createElement('span'); dot.className = 'dot' + (v.live ? '' : ' wait');
      const name = document.createElement('span'); name.textContent = v.name;
      const meta = document.createElement('span'); meta.className = 'muted small';
      meta.textContent = v.live ? (v.size ? `screen ${v.size}` : 'connected') : 'connecting…';
      li.append(dot, name, meta);
      ul.append(li);
    }
  }

  function broadcast(msg) { for (const v of viewers.values()) if (v.conn.open) v.conn.send(msg); }

  function syncPause() {
    const b = $('#pause');
    b.textContent = paused ? 'Resume' : 'Pause';
    b.setAttribute('aria-pressed', String(paused));
    $('#paused-badge').hidden = !paused;
  }
  $('#pause').addEventListener('click', () => {
    paused = !paused;
    const t = stream && stream.getVideoTracks()[0];
    if (t) t.enabled = !paused;
    syncPause();
    broadcast({ type: 'paused', value: paused });
  });

  $('#change').addEventListener('click', async () => {
    let s;
    try { s = await capture(); } catch (e) { if (e.name !== 'NotAllowedError') toast(captureMessage(e)); return; }
    const video = s.getVideoTracks()[0], audio = s.getAudioTracks()[0] || null;
    applyPreset(video);
    if (video) video.enabled = !paused;
    // Swap the tracks on every live connection so screens don't have to reconnect.
    await Promise.all([...viewers.values()].map(async (v) => {
      if (!v.call) return;
      for (const sender of v.call.peerConnection.getSenders()) {
        const kind = sender.track ? sender.track.kind : null;
        try {
          if (kind === 'video') await sender.replaceTrack(video);
          else if (kind === 'audio') await sender.replaceTrack(audio);
        } catch {}
      }
      tuneSender(v.call.peerConnection);
    }));
    useStream(s);
    toast('Now sharing the new choice');
  });

  $('#quality-live').addEventListener('change', (e) => {
    preset = e.target.value;
    $('#quality').value = preset;
    applyPreset(stream && stream.getVideoTracks()[0]);
    for (const v of viewers.values()) if (v.call) tuneSender(v.call.peerConnection);
  });

  $('#new-code').addEventListener('click', () => {
    if (viewers.size && !confirm('Connected screens will be disconnected. Make a new code?')) return;
    openRoom(newCode());
  });

  $('#stop').addEventListener('click', () => {
    stopSharing();
    $('#send-setup').hidden = false; $('#send-live').hidden = true;
    toast('Sharing stopped');
  });

  function stopSharing() {
    closeRoom();
    if (stream) { for (const t of stream.getTracks()) { t.removeEventListener('ended', onTrackEnded); t.stop(); } stream = null; }
    $('#preview').srcObject = null;
    paused = false; syncPause();
  }

  /* =====================================================================
     Tablet / phone: show the screen
     ===================================================================== */
  let wPeer = null, wConn = null, wCall = null, wCode = '', watching = false, everLive = false, retries = 0, retryTimer = null;
  let wake = null, barTimer = null, statsTimer = null, lastBytes = 0, lastTime = 0;
  const remote = $('#remote');

  $('#code-input').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = cleanCode($('#code-input').value);
    if (!validCode(c)) { showError($('#join-error'), 'Enter the 6-character code shown on the computer.'); return; }
    showError($('#join-error'), '');
    startWatching(c);
  });

  function startWatching(c) {
    wCode = c; watching = true; everLive = false; retries = 0;
    history.replaceState(null, '', `${location.pathname}?code=${c}`); // a reload rejoins the same computer
    show('#screen');
    connectScreen();
  }

  function setStatus(text, { busy = true, retry = false } = {}) {
    $('#status').hidden = false;
    $('#status').classList.toggle('idle', !busy);
    $('#status-text').textContent = text;
    $('#status-retry').hidden = !retry;
  }

  function teardownScreen() {
    clearTimeout(retryTimer);
    if (wPeer) { try { wPeer.destroy(); } catch {} }
    wPeer = wConn = wCall = null;
  }

  function connectScreen() {
    teardownScreen();
    setStatus(everLive ? 'Reconnecting…' : `Connecting to ${wCode}…`);
    const p = new Peer({ debug: 0 });
    wPeer = p;
    p.on('open', () => {
      if (p !== wPeer) return;
      const conn = p.connect(peerId(wCode), { reliable: true });
      wConn = conn;
      conn.on('open', () => {
        const dpr = window.devicePixelRatio || 1;
        conn.send({ type: 'hello', name: deviceName(), w: screen.width * dpr, h: screen.height * dpr });
      });
      conn.on('data', (d) => {
        if (d && d.type === 'paused') {
          if (d.value) setStatus('Sharing is paused on the computer.', { busy: false });
          else if (remote.srcObject) $('#status').hidden = true;
        }
      });
      conn.on('close', () => { if (p === wPeer) lost(); });
      conn.on('error', () => { if (p === wPeer) lost(); });
    });
    p.on('call', (call) => {
      if (p !== wPeer) return;
      wCall = call;
      call.answer();
      call.on('stream', onRemoteStream);
      call.on('close', () => { if (p === wPeer) lost(); });
      const pc = call.peerConnection;
      pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' && p === wPeer) lost(); });
    });
    p.on('error', (e) => {
      if (p !== wPeer) return;
      if (e.type === 'peer-unavailable') {
        teardownScreen();
        setStatus(everLive
          ? 'The computer stopped sharing.'
          : `No computer is sharing with code ${wCode}. Check the code on the computer and try again.`, { busy: false, retry: true });
      } else if (e.type === 'browser-incompatible' || e.type === 'webrtc') {
        teardownScreen();
        setStatus('This browser does not support WebRTC, so it can’t show the screen.', { busy: false });
      } else lost();
    });
  }

  function lost() {
    if (!watching) return;
    teardownScreen();
    remote.srcObject = null;
    if (retries++ >= 8) { setStatus('Lost the connection to the computer.', { busy: false, retry: true }); return; }
    setStatus('Connection lost. Reconnecting…');
    retryTimer = setTimeout(connectScreen, Math.min(1000 * retries, 5000));
  }

  function onRemoteStream(s) {
    everLive = true; retries = 0;
    remote.srcObject = s;
    remote.play().catch(() => {});
    $('#status').hidden = true;
    $('#sound').hidden = !s.getAudioTracks().length;
    syncSound();
    keepAwake();
    flashBar();
  }

  function leaveScreen() {
    if (!watching) return;
    watching = false;
    teardownScreen();
    remote.srcObject = null;
    stopStats();
    if (wake) { wake.release().catch(() => {}); wake = null; }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  $('#leave').addEventListener('click', goHome);
  $('#status-leave').addEventListener('click', goHome);
  $('#status-retry').addEventListener('click', () => { retries = 0; connectScreen(); });

  /* keep the tablet awake while it is a screen */
  async function keepAwake() {
    if (!watching || wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (!watching || document.visibilityState !== 'visible') return;
    keepAwake();
    if (remote.srcObject) remote.play().catch(() => {});
  });

  /* controls: tap the screen to show them */
  function flashBar() {
    $('#bar').hidden = false;
    clearTimeout(barTimer);
    barTimer = setTimeout(() => { $('#bar').hidden = true; }, 4000);
  }
  $('#screen').addEventListener('click', (e) => {
    if (e.target.closest('.bar, .status')) { flashBar(); return; }
    if ($('#bar').hidden) flashBar(); else { $('#bar').hidden = true; clearTimeout(barTimer); }
  });

  const root = document.documentElement;
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  $('#fs').addEventListener('click', () => {
    if (isFs()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    else if (remote.webkitEnterFullscreen) remote.webkitEnterFullscreen(); // iPhone: only the video can go full screen
  });
  const syncFs = () => { $('#fs').textContent = isFs() ? 'Exit full screen' : 'Full screen'; };
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);

  $('#fit').addEventListener('click', () => {
    const fill = $('#screen').classList.toggle('fill');
    $('#fit').textContent = fill ? 'Fit' : 'Fill';
  });

  function syncSound() { $('#sound').textContent = remote.muted ? 'Sound on' : 'Sound off'; }
  $('#sound').addEventListener('click', () => {
    remote.muted = !remote.muted;
    remote.play().catch(() => {});
    syncSound();
  });

  /* connection details */
  $('#stats-btn').addEventListener('click', () => {
    const on = $('#stats').hidden;
    $('#stats-btn').setAttribute('aria-pressed', String(on));
    if (on) startStats(); else stopStats();
  });
  function startStats() {
    $('#stats').hidden = false; $('#stats').textContent = 'Measuring…';
    lastBytes = 0; lastTime = 0;
    clearInterval(statsTimer);
    statsTimer = setInterval(readStats, 1000);
    readStats();
  }
  function stopStats() {
    clearInterval(statsTimer); statsTimer = null;
    $('#stats').hidden = true;
    $('#stats-btn').setAttribute('aria-pressed', 'false');
  }
  async function readStats() {
    if (!wCall || !wCall.peerConnection) return;
    let report;
    try { report = await wCall.peerConnection.getStats(); } catch { return; }
    let inb = null, pair = null;
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && (s.kind || s.mediaType) === 'video') inb = s;
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pair = s;
    });
    const lines = [];
    if (inb) {
      if (inb.frameWidth) lines.push(`${inb.frameWidth}×${inb.frameHeight}`);
      if (inb.framesPerSecond != null) lines.push(`${Math.round(inb.framesPerSecond)} fps`);
      const now = inb.timestamp;
      if (lastTime && now > lastTime) lines.push(`${(((inb.bytesReceived - lastBytes) * 8) / ((now - lastTime) / 1000) / 1e6).toFixed(1)} Mbps`);
      lastBytes = inb.bytesReceived; lastTime = now;
      if (inb.framesDropped) lines.push(`${inb.framesDropped} frames dropped`);
    }
    if (pair) {
      if (pair.currentRoundTripTime != null) lines.push(`${Math.round(pair.currentRoundTripTime * 1000)} ms round trip`);
      const local = report.get(pair.localCandidateId);
      const type = local && (local.candidateType || local.type);
      const route = { host: 'Direct, same network', srflx: 'Direct, over the internet', prflx: 'Direct', relay: 'Relayed' }[type];
      if (route) lines.push(route);
    }
    $('#stats').textContent = lines.join('\n') || 'Waiting for video…';
  }

  window.addEventListener('pagehide', () => { stopSharing(); leaveScreen(); });

  /* ---------- start ---------- */
  const fromLink = cleanCode(new URLSearchParams(location.search).get('code'));
  if (validCode(fromLink)) startWatching(fromLink);
  else show('#home');
})();
