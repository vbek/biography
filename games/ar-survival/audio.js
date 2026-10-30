/* AR Survival — all sound is synthesised, so there are no audio files to download. */
window.ARAudio = (() => {
  'use strict';
  const KEY = 'arSurvival.sound';
  let ac = null, master = null, noise = null, on = true, musicTimer = 0, nextNote = 0, step = 0, song = null;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch {}

  const SONGS = {
    space: { root: 55, bass: [0, 0, 12, 0, 7, 0, 10, 5], arp: [0, 7, 12, 15, 19, 15, 12, 7], type: 'sawtooth' },
    air: { root: 73.42, bass: [0, 0, 0, 12, 3, 3, 5, 7], arp: [12, 15, 19, 24, 19, 15, 12, 10], type: 'square' },
    naval: { root: 49, bass: [0, 7, 0, 7, 3, 10, 2, 7], arp: [0, 3, 7, 12, 7, 3, 7, 3], type: 'triangle' },
  };

  function unlock() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      master = ac.createGain();
      master.gain.value = on ? 0.8 : 0;
      master.connect(comp).connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  }

  function out(gain, pan) {
    if (pan && ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(p).connect(master);
    } else gain.connect(master);
  }

  function tone(freq, dur, { type = 'sine', vol = 0.15, to = 0, delay = 0, pan = 0 } = {}) {
    if (!ac || !on) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    out(g, pan);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function hiss(dur, { vol = 0.25, from = 2000, to = 200, q = 0.7, pan = 0, filter = 'lowpass', attack = 0 } = {}) {
    if (!ac || !on) return;
    const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise;
    s.loop = true;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    if (attack) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
    } else g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    out(g, pan);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  function schedule() {
    if (!ac || !song || !on) return;
    while (nextNote < ac.currentTime + 0.2) {
      if (nextNote < ac.currentTime) nextNote = ac.currentTime + 0.02;
      const beat = 0.15, i = step % 8, delay = nextNote - ac.currentTime;
      if (step % 2 === 0) tone(song.root * 2 ** (song.bass[(step / 2) % 8] / 12), beat * 1.7, { type: song.type, vol: 0.075, delay });
      if (step % 32 > 15) tone(song.root * 4 * 2 ** (song.arp[i] / 12), beat * 0.8, { type: 'triangle', vol: 0.03, delay });
      if (step % 4 === 2) tone(70, 0.08, { type: 'sine', vol: 0.09, to: 40, delay });
      nextNote += beat;
      step++;
    }
  }

  return {
    unlock,
    get on() { return on; },
    toggle() {
      on = !on;
      if (master) master.gain.value = on ? 0.8 : 0;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
      return on;
    },
    music(theme) {
      clearInterval(musicTimer);
      song = theme ? SONGS[theme] : null;
      if (song && ac) {
        nextNote = ac.currentTime + 0.05;
        step = 0;
        musicTimer = setInterval(schedule, 90);
      }
    },
    explode(big, pan) {
      hiss(big ? 0.9 : 0.5, { vol: big ? 0.55 : 0.3, from: big ? 2200 : 3200, to: 90, pan });
      tone(big ? 110 : 170, big ? 0.6 : 0.3, { type: 'sine', vol: 0.3, to: 32, pan });
    },
    whoosh(pan) { hiss(0.45, { vol: 0.16, from: 500, to: 3000, q: 2, filter: 'bandpass', pan, attack: 0.25 }); },
    push(pan) {
      hiss(0.22, { vol: 0.3, from: 3000, to: 500, q: 1.2, filter: 'bandpass', pan });
      tone(240, 0.16, { type: 'square', vol: 0.09, to: 760, pan });
    },
    launch(pan) {
      hiss(0.5, { vol: 0.3, from: 900, to: 4200, q: 1, filter: 'bandpass', pan });
      tone(180, 0.35, { type: 'sawtooth', vol: 0.09, to: 720, pan });
    },
    alarm(pan) {
      tone(880, 0.13, { type: 'square', vol: 0.1, pan });
      tone(660, 0.13, { type: 'square', vol: 0.1, delay: 0.17, pan });
      tone(880, 0.13, { type: 'square', vol: 0.1, delay: 0.34, pan });
    },
    clang(pan) { tone(620, 0.2, { type: 'square', vol: 0.09, to: 210, pan }); tone(930, 0.14, { type: 'triangle', vol: 0.07, pan }); },
    dodge(combo) { tone(520 * 2 ** (Math.min(combo, 16) / 12), 0.09, { type: 'triangle', vol: 0.09 }); },
    near() { tone(1000, 0.16, { type: 'sine', vol: 0.1, to: 1800 }); },
    hit() { hiss(0.5, { vol: 0.5, from: 1200, to: 70 }); tone(150, 0.5, { type: 'sawtooth', vol: 0.22, to: 38 }); },
    level() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'square', vol: 0.07, delay: i * 0.08 })); },
    oneUp() { [660, 880, 1320].forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.12, delay: i * 0.09 })); },
    beep(hi) { tone(hi ? 880 : 440, hi ? 0.4 : 0.14, { type: 'square', vol: 0.09 }); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.34, { type: 'sawtooth', vol: 0.11, delay: i * 0.18 })); },
    best() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.13, delay: 0.7 + i * 0.1 })); },
  };
})();
