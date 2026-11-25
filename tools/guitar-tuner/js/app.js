/* Guitar Tuner: listens to the microphone with the Web Audio API and finds the pitch with the YIN method.
   Nothing is recorded or sent anywhere; the audio is analysed frame by frame in memory. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- instruments and tunings (strings low to high, as they sit at the nut, left to right) ----------
  var INSTRUMENTS = {
    guitar: { minHz: 60, maxHz: 1400, rate: 24000, tunings: [
      ['standard', 'Standard (E A D G B E)', 'E2 A2 D3 G3 B3 E4'],
      ['halfdown', 'Half step down (E♭)', 'Eb2 Ab2 Db3 Gb3 Bb3 Eb4'],
      ['wholedown', 'Whole step down (D)', 'D2 G2 C3 F3 A3 D4'],
      ['dropd', 'Drop D', 'D2 A2 D3 G3 B3 E4'],
      ['dropcs', 'Drop C♯', 'C#2 G#2 C#3 F#3 A#3 D#4'],
      ['dropc', 'Drop C', 'C2 G2 C3 F3 A3 D4'],
      ['dadgad', 'DADGAD', 'D2 A2 D3 G3 A3 D4'],
      ['openg', 'Open G', 'D2 G2 D3 G3 B3 D4'],
      ['opend', 'Open D', 'D2 A2 D3 F#3 A3 D4'],
      ['opene', 'Open E', 'E2 B2 E3 G#3 B3 E4'],
      ['openc', 'Open C', 'C2 G2 C3 G3 C4 E4'],
      ['nashville', 'Nashville (high strung)', 'E3 A3 D4 G4 B3 E4']
    ] },
    bass: { minHz: 28, maxHz: 700, rate: 12000, tunings: [
      ['standard', 'Standard 4-string (E A D G)', 'E1 A1 D2 G2'],
      ['dropd', 'Drop D', 'D1 A1 D2 G2'],
      ['halfdown', 'Half step down (E♭)', 'Eb1 Ab1 Db2 Gb2'],
      ['five', '5-string (B E A D G)', 'B0 E1 A1 D2 G2'],
      ['six', '6-string (B E A D G C)', 'B0 E1 A1 D2 G2 C3']
    ] },
    ukulele: { minHz: 100, maxHz: 1600, rate: 24000, tunings: [
      ['standard', 'Standard (G C E A)', 'G4 C4 E4 A4'],
      ['lowg', 'Low G', 'G3 C4 E4 A4'],
      ['dtune', 'D tuning (A D F♯ B)', 'A4 D4 F#4 B4'],
      ['baritone', 'Baritone (D G B E)', 'D3 G3 B3 E4']
    ] }
  };
  var SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function parseNote(s) {
    var m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
    var midi = (+m[3] + 1) * 12 + LETTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return { letter: m[1], acc: m[2], oct: +m[3], midi: midi };
  }
  function midiNote(midi) {
    var n = SHARPS[((midi % 12) + 12) % 12];
    return { letter: n[0], acc: n[1] || '', oct: Math.floor(midi / 12) - 1, midi: midi };
  }
  var accChar = function (a) { return a === '#' ? '♯' : a === 'b' ? '♭' : ''; };
  var noteText = function (n) { return n.letter + accChar(n.acc) + n.oct; };
  var hzOf = function (midi) { return settings.a4 * Math.pow(2, (midi - 69) / 12); };

  // ---------- settings, remembered on this device ----------
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('tuner.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tuner.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  var settings = {
    instrument: store.get('instrument', 'guitar'),
    tunings: store.get('tunings', {}),
    mode: store.get('mode', 'auto'),
    a4: store.get('a4', 440),
    playTap: store.get('playTap', true)
  };
  if (!INSTRUMENTS[settings.instrument]) settings.instrument = 'guitar';
  if (['auto', 'manual', 'chromatic'].indexOf(settings.mode) < 0) settings.mode = 'auto';
  if (!(settings.a4 >= 415 && settings.a4 <= 466)) settings.a4 = 440;

  var inst, tuningId, strings = [], selected = 0, tuned = [];

  function loadStrings() {
    inst = INSTRUMENTS[settings.instrument];
    tuningId = settings.tunings[settings.instrument];
    var t = inst.tunings.filter(function (x) { return x[0] === tuningId; })[0] || inst.tunings[0];
    tuningId = t[0];
    strings = t[2].split(' ').map(parseNote);
    selected = Math.min(selected, strings.length - 1);
    tuned = strings.map(function () { return false; });
    autoIdx = -1;
  }

  // ---------- pitch detection ----------
  var dBuf = new Float64Array(0), cmBuf = new Float64Array(0);

  // YIN (de Cheveigné & Kawahara, 2002) on x[0..n). Returns { tau, clarity } or null.
  function yin(x, n, rate, minHz, maxHz) {
    var tauMax = Math.min(n >> 1, Math.ceil(rate / minHz));
    var tauMin = Math.max(2, Math.floor(rate / maxHz));
    if (tauMax - tauMin < 4) return null;
    var W = n - tauMax;
    if (dBuf.length < tauMax + 2) { dBuf = new Float64Array(tauMax + 2); cmBuf = new Float64Array(tauMax + 2); }
    var d = dBuf, cm = cmBuf, run = 0, tau, j, s, v;
    cm[0] = 1;
    for (tau = 1; tau <= tauMax; tau++) {
      s = 0;
      for (j = 0; j < W; j++) { v = x[j] - x[j + tau]; s += v * v; }
      d[tau] = s; run += s;
      cm[tau] = run > 0 ? s * tau / run : 1;
    }
    var best = -1;
    for (tau = tauMin; tau < tauMax; tau++) {
      if (cm[tau] < 0.15) {
        while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++;
        best = tau; break;
      }
    }
    if (best < 0) {
      var m = Infinity;
      for (tau = tauMin; tau < tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau; }
      if (m > 0.3) return null;
    }
    var t = best;
    if (best > 1 && best < tauMax) {
      var a = cm[best - 1], b = cm[best], c = cm[best + 1], den = a - 2 * b + c;
      if (den > 0) t = best + 0.5 * (a - c) / den;
    }
    return { tau: t, clarity: 1 - cm[best] };
  }

  // Squared difference at a whole-sample lag, at the full sample rate.
  function diffAt(x, len, lag, W) {
    var s = 0, v;
    for (var j = 0; j < W; j++) { v = x[j] - x[j + lag]; s += v * v; }
    return s;
  }

  var dec = null;
  // Finds the fundamental in a full-rate buffer: a coarse YIN pass on a decimated copy, then a fine
  // parabolic fit of the difference function at the full rate, which keeps the reading within a fraction of a cent.
  function detect(raw, sampleRate, minHz, maxHz, targetRate) {
    var factor = Math.max(1, Math.round(sampleRate / targetRate));
    var n = Math.floor(raw.length / factor);
    if (!dec || dec.length < n) dec = new Float64Array(n);
    var mean = 0, i, k, s;
    for (i = 0; i < n; i++) {
      s = 0;
      for (k = 0; k < factor; k++) s += raw[i * factor + k];
      dec[i] = s / factor; mean += dec[i];
    }
    mean /= n;
    for (i = 0; i < n; i++) dec[i] -= mean;
    var r = yin(dec, n, sampleRate / factor, minHz, maxHz);
    if (!r) return null;
    var lag = r.tau * factor;
    if (factor > 1) {
      var L = Math.round(lag);
      var W = Math.min(raw.length - L - 3, 8192);
      if (L > 3 && W > L) {
        var a = diffAt(raw, raw.length, L - 1, W), b = diffAt(raw, raw.length, L, W), c = diffAt(raw, raw.length, L + 1, W);
        // walk to the local minimum if the coarse guess sits beside it
        var guard = 0;
        while (guard++ < 4 && (a < b || c < b)) {
          if (a < b) { L--; c = b; b = a; a = diffAt(raw, raw.length, L - 1, W); }
          else { L++; a = b; b = c; c = diffAt(raw, raw.length, L + 1, W); }
        }
        var den = a - 2 * b + c;
        lag = den > 0 ? L + 0.5 * (a - c) / den : L;
      }
    }
    return { freq: sampleRate / lag, clarity: r.clarity };
  }

  // ---------- audio ----------
  var ctx = null, stream = null, source = null, highpass = null, lowpass = null, analyser = null, sink = null, raw = null;
  var listening = false, starting = false, wakeLock = null;

  function ensureCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('nowebaudio');
      ctx = new AC({ latencyHint: 'interactive' });
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function configureAnalyser() {
    if (!analyser) return;
    var factor = Math.max(1, Math.round(ctx.sampleRate / inst.rate));
    var size = 1; while (size < 2048 * factor) size <<= 1;
    analyser.fftSize = Math.min(32768, size);
    raw = new Float32Array(analyser.fftSize);
    highpass.frequency.value = Math.max(20, inst.minHz * 0.6);
    // Hiss above the strings' range makes the reading wander as a note fades, so it's filtered out first.
    lowpass.frequency.value = Math.min(ctx.sampleRate / 2.4, Math.max(1200, inst.maxHz * 1.4));
  }

  async function start() {
    if (listening || starting) return;
    hideError();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError(window.isSecureContext === false ? 'The microphone only works on a secure (https) page.' : 'This browser can\'t use the microphone. Try the latest Chrome, Edge, Firefox or Safari.');
      return;
    }
    starting = true; setStatus('wait', 'Starting…');
    try {
      ensureCtx();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
      await ctx.resume();
      source = ctx.createMediaStreamSource(stream);
      highpass = ctx.createBiquadFilter(); highpass.type = 'highpass'; highpass.Q.value = 0.7;
      lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.Q.value = 0.6;
      analyser = ctx.createAnalyser(); analyser.smoothingTimeConstant = 0;
      sink = ctx.createGain(); sink.gain.value = 0;
      source.connect(highpass); highpass.connect(lowpass); lowpass.connect(analyser); analyser.connect(sink); sink.connect(ctx.destination);
      configureAnalyser();
      listening = true; noiseFloor = 0.002; medianBuf.length = 0;
      stream.getAudioTracks().forEach(function (t) { t.addEventListener('ended', function () { stop(); showError('The microphone was disconnected.'); }); });
      requestWakeLock();
    } catch (e) {
      stopTracks();
      var name = e && e.name;
      showError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone access was blocked. Allow the microphone for this site (the icon in the address bar) and press Start again.'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No microphone was found. Plug one in, or use a device with a built-in mic.'
        : name === 'NotReadableError' ? 'The microphone is busy in another app. Close it and try again.'
        : 'The microphone couldn\'t start' + (e && e.message ? ': ' + e.message : '.'));
    }
    starting = false;
    syncChrome();
  }

  function stopTracks() {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
  }
  function stop() {
    listening = false;
    try { if (source) source.disconnect(); if (analyser) analyser.disconnect(); } catch (e) { /* already gone */ }
    source = highpass = lowpass = analyser = sink = null;
    stopTracks();
    reading = null; level = 0;
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    syncChrome();
  }

  function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () { if (listening && document.visibilityState === 'visible') requestWakeLock(); });

  // A plucked reference note (Karplus-Strong). The buffer's sample rate is chosen so the loop length is a whole
  // number of samples at exactly the target pitch; the browser resamples it, so the tone is in tune to the cent.
  var refUntil = 0;
  function pluck(midi) {
    try { ensureCtx(); } catch (e) { return; }
    var f = hzOf(midi), base = ctx.sampleRate;
    var N = Math.max(4, Math.round(base / f - 0.5));
    var rate = (N + 0.5) * f, dur = midi < 40 ? 3 : 2.4, len = Math.floor(rate * dur);
    var buf;
    try { buf = ctx.createBuffer(1, len, rate); } catch (e) { return; }
    var out = buf.getChannelData(0), ring = new Float32Array(N), prev = 0, i;
    for (i = 0; i < N; i++) { prev = prev * 0.35 + (Math.random() * 2 - 1) * 0.65; ring[i] = prev; }
    var idx = 0, loss = midi < 45 ? 0.998 : 0.996, peak = 0;
    for (i = 0; i < len; i++) {
      var nxt = (idx + 1) % N, v = ring[idx];
      out[i] = v;
      ring[idx] = (v + ring[nxt]) * 0.5 * loss;
      idx = nxt;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    var fade = Math.floor(rate * 0.25), g = 0.55 / (peak || 1);
    for (i = 0; i < len; i++) out[i] *= g * (i > len - fade ? (len - i) / fade : 1);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var gain = ctx.createGain(); gain.gain.value = 0.9;
    src.connect(gain); gain.connect(ctx.destination); src.start();
    refUntil = performance.now() + 1400; // don't mistake our own tone for the instrument
    medianBuf.length = 0;
  }

  // ---------- reading state ----------
  var noiseFloor = 0.002, level = 0, medianBuf = [], lastSignal = 0, autoIdx = -1;
  var reading = null;          // { freq, cents, target: {midi, letter, acc, oct}, idx, t }
  var disp = { cents: 0, active: false };
  var inTuneSince = 0, offSince = 0, history = [];

  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }

  function analyse(now) {
    analyser.getFloatTimeDomainData(raw);
    var s = 0, i;
    for (i = 0; i < raw.length; i++) s += raw[i] * raw[i];
    var rms = Math.sqrt(s / raw.length);
    level = rms;
    var gate = Math.max(0.0035, noiseFloor * 3);
    var r = null;
    if (rms > gate && now > refUntil) r = detect(raw, ctx.sampleRate, inst.minHz * 0.85, settings.mode === 'chromatic' ? 1600 : inst.maxHz, inst.rate);
    if (!r) noiseFloor = rms < noiseFloor ? noiseFloor * 0.9 + rms * 0.1 : noiseFloor * 0.998 + rms * 0.002;
    if (r && r.clarity > 0.7) {
      medianBuf.push(r.freq); if (medianBuf.length > 5) medianBuf.shift();
      lastSignal = now;
      if (medianBuf.length >= 2) take(median(medianBuf), now);
    } else if (now - lastSignal > 160) medianBuf.length = 0;
    var c = reading && now - reading.t < 250 ? reading.cents : null;
    history.push([now, c]);
    while (history.length && history[0][0] < now - 10000) history.shift();
  }

  function take(freq, now) {
    var m = 69 + 12 * Math.log2(freq / settings.a4), target, idx = -1;
    if (settings.mode === 'chromatic') target = midiNote(Math.round(m));
    else if (settings.mode === 'manual') { idx = selected; target = strings[idx]; }
    else {
      var bd = Infinity;
      strings.forEach(function (st, i) { var dd = Math.abs(m - st.midi); if (dd < bd) { bd = dd; idx = i; } });
      // a little stickiness so a string sitting between two others doesn't flicker
      if (autoIdx >= 0 && autoIdx !== idx && Math.abs(m - strings[autoIdx].midi) - bd < 0.3) idx = autoIdx;
      autoIdx = idx; target = strings[idx];
    }
    var cents = 100 * (m - target.midi);
    var changed = !reading || reading.target.midi !== target.midi || reading.idx !== idx;
    reading = { freq: freq, cents: cents, target: target, idx: idx, t: now };
    if (changed) { disp.cents = Math.max(-60, Math.min(60, cents)); inTuneSince = 0; offSince = 0; }

    // a string earns its checkmark after holding within 3 cents for half a second
    if (idx >= 0 && settings.mode !== 'chromatic') {
      if (Math.abs(cents) <= 3) {
        offSince = 0;
        if (!inTuneSince) inTuneSince = now;
        if (!tuned[idx] && now - inTuneSince > 500) markTuned(idx, true);
      } else {
        inTuneSince = 0;
        if (Math.abs(cents) > 10) { if (!offSince) offSince = now; if (tuned[idx] && now - offSince > 600) markTuned(idx, false); }
      }
    }
  }

  function markTuned(i, on) {
    tuned[i] = on;
    var peg = pegEls[i]; if (peg) peg.classList.toggle('tuned', on);
    if (strEls[i]) strEls[i].classList.toggle('tuned', on);
    if (on) {
      dial.classList.remove('pop'); void dial.offsetWidth; dial.classList.add('pop');
      if (tuned.every(Boolean)) {
        dial.classList.remove('celebrate'); void dial.offsetWidth; dial.classList.add('celebrate');
        toast('All ' + strings.length + ' strings are in tune. Nice!');
      }
    }
    syncTunedMeter();
  }

  // ---------- dial ----------
  var dial = $('dial'), CX = 200, CY = 200, R = 160, MAXDEG = 70;
  var angleOf = function (c) { return Math.max(-1, Math.min(1, c / 50)) * MAXDEG; };
  function pt(deg, r) { var a = deg * Math.PI / 180; return [CX + r * Math.sin(a), CY - r * Math.cos(a)]; }
  function arc(d0, d1, r) {
    var p0 = pt(d0, r), p1 = pt(d1, r);
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A' + r + ' ' + r + ' 0 0 ' + (d1 > d0 ? 1 : 0) + ' ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }
  (function buildTicks() {
    var g = $('ticks');
    for (var c = -50; c <= 50; c += 5) {
      var major = c % 25 === 0, a = angleOf(c), p0 = pt(a, R - 11), p1 = pt(a, R + (major ? 13 : 7));
      var l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', p0[0]); l.setAttribute('y1', p0[1]); l.setAttribute('x2', p1[0]); l.setAttribute('y2', p1[1]);
      l.setAttribute('class', 'tick' + (major ? ' major' : ''));
      g.appendChild(l);
      if (major) {
        var tp = pt(a, R + 26), t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('x', tp[0]); t.setAttribute('y', tp[1] + 4); t.setAttribute('class', 'tick-label');
        t.textContent = c > 0 ? '+' + c : c === 0 ? '0' : '−' + -c;
        g.appendChild(t);
      }
    }
    $('zone').setAttribute('d', arc(angleOf(-5), angleOf(5), R));
  })();

  function toneFor(absC) {
    var h = 145 - Math.min(1, Math.max(0, absC - 2) / 28) * 145;
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    return 'hsl(' + h.toFixed(0) + ' ' + (light ? '75% 38%' : '85% 58%') + ')';
  }

  // ---------- canvases ----------
  function fitCanvas(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return dpr;
  }
  var strobe = $('strobe'), sctx = strobe.getContext('2d'), phase = 0;
  function drawStrobe(dt, tone, alive) {
    var dpr = fitCanvas(strobe), w = strobe.width, h = strobe.height;
    sctx.clearRect(0, 0, w, h);
    if (alive) phase += disp.cents * 3.2 * dt;
    var rows = [[0, h / 2, 26], [h / 2, h / 2, 13]];
    sctx.fillStyle = tone;
    sctx.globalAlpha = alive ? 0.85 : 0.18;
    rows.forEach(function (row, k) {
      var p = row[2] * dpr, off = ((phase * dpr * (k + 1)) % (2 * p) + 2 * p) % (2 * p);
      for (var x = off - 2 * p; x < w; x += 2 * p) sctx.fillRect(x, row[0] + (k ? 1 : 0), p, row[1] - 1);
    });
    sctx.globalAlpha = 1;
  }
  var hist = $('history'), hctx = hist.getContext('2d');
  function drawHistory(now) {
    var dpr = fitCanvas(hist), w = hist.width, h = hist.height, cs = getComputedStyle(document.documentElement);
    var y = function (c) { return h / 2 - Math.max(-50, Math.min(50, c)) / 50 * (h / 2 - 6 * dpr); };
    hctx.clearRect(0, 0, w, h);
    hctx.fillStyle = cs.getPropertyValue('--good'); hctx.globalAlpha = 0.14;
    hctx.fillRect(0, y(5), w, y(-5) - y(5));
    hctx.globalAlpha = 1; hctx.strokeStyle = cs.getPropertyValue('--tick'); hctx.lineWidth = dpr;
    hctx.setLineDash([4 * dpr, 4 * dpr]);
    [-25, 25].forEach(function (c) { hctx.beginPath(); hctx.moveTo(0, y(c)); hctx.lineTo(w, y(c)); hctx.stroke(); });
    hctx.setLineDash([]);
    hctx.beginPath(); hctx.moveTo(0, y(0)); hctx.lineTo(w, y(0)); hctx.stroke();
    hctx.lineWidth = 2.5 * dpr; hctx.lineJoin = 'round'; hctx.lineCap = 'round';
    var prev = null;
    for (var i = 0; i < history.length; i++) {
      var e = history[i], x = w - (now - e[0]) / 10000 * w;
      if (e[1] == null) { prev = null; continue; }
      var py = y(e[1]);
      if (prev) {
        hctx.strokeStyle = toneFor(Math.abs(e[1]));
        hctx.beginPath(); hctx.moveTo(prev[0], prev[1]); hctx.lineTo(x, py); hctx.stroke();
      }
      prev = [x, py];
    }
    if (prev) { hctx.fillStyle = hctx.strokeStyle; hctx.beginPath(); hctx.arc(prev[0], prev[1], 4 * dpr, 0, 7); hctx.fill(); }
  }

  // ---------- render loop ----------
  var els = { letter: $('note-letter'), acc: $('note-acc'), oct: $('note-oct'), hint: $('hint'), cents: $('cents'), hz: $('hz'), target: $('target'),
    pointer: $('pointer'), fill: $('fill'), level: $('level-bar') };
  var lastT = performance.now(), lastText = 0, shown = {}, activeIdx = -1;

  function setText(el, key, v) { if (shown[key] !== v) { shown[key] = v; el.textContent = v; } }
  function setClass(el, key, v) { if (shown[key] !== v) { shown[key] = v; el.className = v; } }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (listening && analyser) analyse(now);

    var age = reading ? now - reading.t : Infinity;
    if (age > 1800) reading = null;
    var live = !!reading, held = live && age > 300;
    if (live) {
      var k = 1 - Math.exp(-dt * 16);
      disp.cents += (Math.max(-60, Math.min(60, reading.cents)) - disp.cents) * k;
    }
    var absC = live ? Math.abs(disp.cents) : 50, tone = live ? toneFor(absC) : 'var(--accent)';
    var locked = live && !held && Math.abs(reading.cents) <= 3;
    document.documentElement.style.setProperty('--tone', live ? toneFor(Math.abs(reading.cents)) : '');
    dial.classList.toggle('live', live); dial.classList.toggle('held', held); dial.classList.toggle('locked', locked);

    var a = angleOf(live ? disp.cents : 0);
    els.pointer.setAttribute('transform', 'rotate(' + a.toFixed(2) + ' ' + CX + ' ' + CY + ')');
    els.fill.setAttribute('d', Math.abs(a) < 0.3 ? '' : arc(0, a, R));

    // text updates are throttled so the numbers stay readable
    if (now - lastText > 90 || !live) {
      lastText = now;
      if (live) {
        var t = reading.target, c = reading.cents;
        setText(els.letter, 'l', t.letter); setText(els.acc, 'a', accChar(t.acc)); setText(els.oct, 'o', String(t.oct));
        setText(els.cents, 'c', (c > 0.05 ? '+' : c < -0.05 ? '−' : '') + Math.abs(c).toFixed(1) + ' ¢');
        setText(els.hz, 'h', reading.freq.toFixed(1) + ' Hz');
        setText(els.target, 't', noteText(t) + ' · ' + hzOf(t.midi).toFixed(1));
        var hint, cls = 'hint ' + (Math.abs(c) <= 3 ? 'ok' : c < 0 ? 'flat' : 'sharp');
        var chrom = settings.mode === 'chromatic', up = chrom ? 'go higher' : 'tighten', down = chrom ? 'go lower' : 'loosen';
        if (Math.abs(c) <= 3) hint = 'In tune ✓';
        else if (Math.abs(c) >= 150) hint = (c < 0 ? 'Way flat: ' + up : 'Way sharp: ' + down) + ' (about ' + Math.round(Math.abs(c) / 100) + ' semitones)';
        else if (Math.abs(c) <= 10) hint = c < 0 ? 'Almost: ' + up + ' a touch ↑' : 'Almost: ' + down + ' a touch ↓';
        else hint = c < 0 ? 'Flat: ' + up + (chrom ? '' : ' the string') + ' ↑' : 'Sharp: ' + down + (chrom ? '' : ' the string') + ' ↓';
        setText(els.hint, 'hint', hint); setClass(els.hint, 'hc', cls);
      } else {
        if (settings.mode === 'manual') {
          var st = strings[selected];
          setText(els.letter, 'l', st.letter); setText(els.acc, 'a', accChar(st.acc)); setText(els.oct, 'o', String(st.oct));
          setText(els.target, 't', noteText(st) + ' · ' + hzOf(st.midi).toFixed(1));
        } else {
          setText(els.letter, 'l', '–'); setText(els.acc, 'a', ''); setText(els.oct, 'o', '');
          setText(els.target, 't', settings.mode === 'chromatic' ? 'Any note' : 'Auto');
        }
        setText(els.cents, 'c', '–'); setText(els.hz, 'h', '–');
        setText(els.hint, 'hint', listening ? (now < refUntil ? 'Playing the reference note…' : 'Listening… pluck a string') : starting ? 'Waiting for the microphone…' : 'Press Start, then pluck a string');
        setClass(els.hint, 'hc', 'hint');
      }
    }

    var ai = live && !held ? reading.idx : -1;
    if (ai !== activeIdx) {
      if (pegEls[activeIdx]) { pegEls[activeIdx].classList.remove('active'); strEls[activeIdx].classList.remove('active'); }
      activeIdx = ai;
      if (pegEls[ai]) { pegEls[ai].classList.add('active'); strEls[ai].classList.add('active'); }
    }

    var lv = listening ? Math.min(1, Math.max(0, (20 * Math.log10(level + 1e-9) + 60) / 54)) : 0;
    els.level.style.width = (lv * 100).toFixed(0) + '%';
    drawStrobe(dt, live ? toneFor(absC) : getComputedStyle(document.documentElement).getPropertyValue('--muted'), live && !held);
    drawHistory(now);
  }

  // ---------- headstock ----------
  var pegEls = [], strEls = [];
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function buildHeadstock() {
    var svg = $('headstock');
    svg.textContent = '';
    pegEls = []; strEls = []; activeIdx = -1;
    var defs = el('defs', {}, svg);
    var wood = el('linearGradient', { id: 'wood', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    el('stop', { offset: '0', 'class': 'w1' }, wood); el('stop', { offset: '.55', 'class': 'w2' }, wood); el('stop', { offset: '1', 'class': 'w1' }, wood);
    var metal = el('linearGradient', { id: 'metal', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0', 'class': 'm1' }, metal); el('stop', { offset: '1', 'class': 'm2' }, metal);

    var n = strings.length, left = Math.ceil(n / 2), right = n - left, perSide = Math.max(left, right);
    var top = perSide > 2 ? 78 : 120, bottom = 300, step = perSide > 1 ? (bottom - top) / (perSide - 1) : 0;
    el('path', { 'class': 'hs-body', d: 'M116 438 C108 372 90 318 84 232 L72 76 Q70 30 112 26 L208 26 Q250 30 248 76 L236 232 C230 318 212 372 204 438 Z' }, svg);
    el('path', { 'class': 'hs-face', d: 'M124 420 C116 360 100 310 95 232 L84 82 Q83 42 116 38 L204 38 Q237 42 236 82 L225 232 C220 310 204 360 196 420' }, svg);
    el('path', { 'class': 'hs-cover', d: 'M147 406 C147 384 152 364 160 356 C168 364 173 384 173 406 Q160 412 147 406 Z' }, svg);

    var nutL = 122, nutR = 198, nutY = 432;
    var keysG = el('g', {}, svg), stringsG = el('g', {}, svg), postsG = el('g', {}, svg);
    strings.forEach(function (st, i) {
      var onLeft = i < left;
      var rank = onLeft ? i : n - 1 - i;                 // 0 = the post nearest the nut
      var py = bottom - rank * step;
      var px = onLeft ? 104 : 216, kx = onLeft ? 36 : 284;
      var nx = n > 1 ? nutL + (nutR - nutL) * i / (n - 1) : 160;
      var sw = (n > 4 ? 3.4 : 3.8) - (n > 1 ? i / (n - 1) : 0) * 2.2;
      if (settings.instrument === 'ukulele') sw = 2.6;
      strEls[i] = el('line', { 'class': 'str' + (tuned[i] ? ' tuned' : ''), x1: nx, y1: nutY, x2: px, y2: py, 'stroke-width': sw.toFixed(2) }, stringsG);

      el('rect', { 'class': 'hs-shaft', x: Math.min(px, kx) + (onLeft ? 20 : 0), y: py - 4, width: Math.abs(px - kx) - 20, height: 8, rx: 3 }, keysG);
      el('circle', { 'class': 'hs-post', cx: px, cy: py, r: 8 }, postsG);

      var g = el('g', { 'class': 'peg' + (tuned[i] ? ' tuned' : ''), tabindex: '0', role: 'button', 'data-i': i,
        'aria-label': 'String ' + (n - i) + ', ' + noteText(st) + (settings.playTap ? '. Play reference note' : '') }, keysG);
      el('ellipse', { 'class': 'ring', cx: kx, cy: py, rx: 33, ry: 27 }, g);
      el('ellipse', { 'class': 'key', cx: kx, cy: py, rx: 27, ry: 21 }, g);
      var lab = el('text', { 'class': 'key-label', x: kx, y: py }, g);
      lab.textContent = st.letter + accChar(st.acc);
      var num = el('text', { 'class': 'key-num', x: kx, y: py + 38 }, g);
      num.textContent = noteText(st);
      var badge = el('g', { 'class': 'badge' }, g);
      el('circle', { cx: kx + (onLeft ? -22 : 22), cy: py - 17, r: 9 }, badge);
      el('path', { d: 'M' + (kx + (onLeft ? -26 : 18)) + ' ' + (py - 17) + ' l3 3 l5 -6' }, badge);
      pegEls[i] = g;
    });
    el('rect', { 'class': 'hs-nut', x: nutL - 10, y: nutY - 4, width: nutR - nutL + 20, height: 12, rx: 3 }, svg);
    strings.forEach(function (st, i) {
      var nx = n > 1 ? nutL + (nutR - nutL) * i / (n - 1) : 160;
      el('line', { x1: nx, y1: nutY + 8, x2: nx, y2: 450, stroke: 'var(--string)', 'stroke-width': strEls[i].getAttribute('stroke-width'), 'stroke-linecap': 'round', opacity: '.7' }, svg);
    });
    syncSelected();
    syncTunedMeter();
  }

  function syncSelected() {
    pegEls.forEach(function (p, i) { p.classList.toggle('selected', settings.mode === 'manual' && i === selected); });
  }
  function syncTunedMeter() {
    var c = tuned.filter(Boolean).length, all = c === strings.length;
    $('tuned-count').textContent = all ? 'All ' + c + ' strings in tune' : c + ' of ' + strings.length + ' strings in tune';
    $('tuned-bar').style.width = (c / strings.length * 100) + '%';
    $('tuned-count').parentNode.classList.toggle('all', all);
  }

  function tapString(i) {
    if (!strings[i]) return;
    if (settings.mode === 'manual') { selected = i; syncSelected(); reading = null; }
    if (settings.playTap) {
      pluck(strings[i].midi);
      var p = pegEls[i]; p.classList.remove('playing'); void p.getBoundingClientRect(); p.classList.add('playing');
    }
  }
  $('headstock').addEventListener('click', function (e) {
    var g = e.target.closest && e.target.closest('.peg');
    if (g) tapString(+g.getAttribute('data-i'));
  });
  $('headstock').addEventListener('keydown', function (e) {
    var g = e.target.closest && e.target.closest('.peg');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); tapString(+g.getAttribute('data-i')); }
  });

  // ---------- controls ----------
  function syncSeg(id, v) {
    Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-v') === v)); });
  }
  function fillTunings() {
    var sel = $('tuning'); sel.textContent = '';
    inst.tunings.forEach(function (t) {
      var o = document.createElement('option'); o.value = t[0]; o.textContent = t[1]; sel.appendChild(o);
    });
    sel.value = tuningId;
  }
  function setInstrument(v) {
    settings.instrument = v; store.set('instrument', v);
    loadStrings(); fillTunings(); syncSeg('instrument', v); buildHeadstock(); configureAnalyser(); reading = null;
  }
  function setMode(v) {
    settings.mode = v; store.set('mode', v); syncSeg('mode', v); syncSelected(); reading = null; autoIdx = -1;
  }
  function setA4(v) {
    settings.a4 = Math.max(415, Math.min(466, v)); store.set('a4', settings.a4);
    $('a4').textContent = 'A4 = ' + settings.a4 + ' Hz';
    tuned = strings.map(function () { return false; }); buildHeadstock(); reading = null;
  }
  $('instrument').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setInstrument(b.getAttribute('data-v')); });
  $('mode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setMode(b.getAttribute('data-v')); });
  $('tuning').addEventListener('change', function () {
    settings.tunings[settings.instrument] = this.value; store.set('tunings', settings.tunings);
    loadStrings(); buildHeadstock(); reading = null;
  });
  $('a4-down').addEventListener('click', function () { setA4(settings.a4 - 1); });
  $('a4-up').addEventListener('click', function () { setA4(settings.a4 + 1); });
  $('play-tap').checked = settings.playTap;
  $('play-tap').addEventListener('change', function () { settings.playTap = this.checked; store.set('playTap', this.checked); buildHeadstock(); });
  $('reset-tuned').addEventListener('click', function () { tuned = strings.map(function () { return false; }); buildHeadstock(); });

  function toggle() { if (listening) stop(); else start(); }
  $('toggle').addEventListener('click', toggle);
  $('big-start').addEventListener('click', start);

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === ' ' && !(e.target.closest && e.target.closest('button, .peg, summary'))) { e.preventDefault(); toggle(); }
    else if (/^[1-6]$/.test(e.key)) tapString(strings.length - +e.key);   // 1 = highest string, as guitarists number them
    else if (e.key === 'a' || e.key === 'A') setMode('auto');
    else if (e.key === 'p' || e.key === 'P') setMode('manual');
    else if (e.key === 'c' || e.key === 'C') setMode('chromatic');
  });

  function setStatus(kind, text) {
    $('status-dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
  }
  function syncChrome() {
    var b = $('toggle');
    b.classList.toggle('on', listening);
    b.querySelector('span').textContent = listening ? 'Stop' : 'Start';
    $('veil').hidden = listening || starting;
    if (listening) setStatus('live', 'Listening'); else if (!starting) setStatus('off', 'Mic off');
  }
  function showError(msg) { var e = $('error'); e.textContent = msg; e.hidden = false; }
  function hideError() { $('error').hidden = true; }
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }

  // ---------- go ----------
  loadStrings(); fillTunings(); syncSeg('instrument', settings.instrument); syncSeg('mode', settings.mode);
  $('a4').textContent = 'A4 = ' + settings.a4 + ' Hz';
  buildHeadstock(); syncChrome();
  requestAnimationFrame(frame);

  // A small handle for automated checks.
  window.__tuner = {
    detect: detect,
    get reading() { return reading; },
    get strings() { return strings.map(noteText); },
    get tuned() { return tuned.slice(); },
    get listening() { return listening; },
    get sampleRate() { return ctx && ctx.sampleRate; },
    setMode: setMode, setInstrument: setInstrument, start: start, stop: stop
  };
})();
