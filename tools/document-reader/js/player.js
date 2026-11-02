/* Document Reader — plays a document sentence by sentence, keeping the next few sentences ready ahead of the listener.
   Speed is applied by the audio element, so it changes instantly, without altering pitch or regenerating anything. */
import { toPcm, wavBlob } from './voice.js';

const AHEAD_SECONDS = 75, AHEAD_MAX = 14, KEEP_BEHIND = 4, BLOCK_PAUSE = 0.32, SENTENCE_PAUSE = 0.06;

/** What the voice is asked to say, as opposed to what's on the page. */
export function speakable(text, tidy) {
  let t = text;
  if (tidy) {
    t = t.replace(/\bhttps?:\/\/(?:www\.)?([^\s/)]+)[^\s)]*/gi, '$1').replace(/\bwww\.([^\s/)]+)[^\s)]*/gi, '$1')
      .replace(/\[(?:\d+(?:\s*[,–-]\s*\d+)*)\]/g, '')
      .replace(/\be\.g\.,?/gi, 'for example,').replace(/\bi\.e\.,?/gi, 'that is,').replace(/\betc\./gi, 'et cetera.')
      .replace(/\bet al\./gi, 'and others').replace(/\bFig\.\s/g, 'Figure ').replace(/\bvs\./gi, 'versus');
  }
  t = t.replace(/[|_~^=*#<>]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}

export class Player extends EventTarget {
  constructor(engine) {
    super();
    this.engine = engine;
    this.audio = new Audio();
    this.audio.preservesPitch = true;
    this.items = [];
    this.idx = 0;
    this.playing = false;
    this.waiting = false;
    this.mode = 'neural';
    this.voice = 'af_heart';
    this.systemVoice = '';
    this.rate = 1;
    this.tidy = true;
    this.clips = new Map();
    this.asked = new Set();
    this.generation = 0;
    this.playToken = 0;
    this.secondsPerChar = 0.07;
    this.generationSpeed = 0;
    this.audio.addEventListener('ended', () => { if (this.playing && this.mode === 'neural') this.advance(); });
    this.audio.addEventListener('error', () => { if (this.playing && this.audio.getAttribute('src')) this.advance(); });
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** Each item is a sentence: { text, blockEnd }. */
  setItems(items, idx = 0) {
    this.stop();
    this.flush();
    this.items = items;
    this.idx = Math.max(0, Math.min(items.length - 1, idx));
    this.emit('position', { idx: this.idx });
  }

  say(i) { return speakable(this.items[i]?.text || '', this.tidy); }
  nextSpoken(i, dir = 1) {
    for (let n = i; n >= 0 && n < this.items.length; n += dir) if (this.say(n)) return n;
    return -1;
  }

  flush() {
    this.generation++;
    this.generationSpeed = 0;
    this.engine.clear();
    for (const clip of this.clips.values()) URL.revokeObjectURL(clip.url);
    this.clips.clear();
    this.asked.clear();
  }

  setRate(rate) {
    this.rate = rate;
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
    if (this.mode === 'system' && this.playing) this.speakNow();
    this.emit('time');
  }
  setVoice(voice) {
    this.voice = voice;
    this.flush();
    if (this.playing && this.mode === 'neural') { this.audio.pause(); this.speakNow(); }
  }
  setSystemVoice(name) {
    this.systemVoice = name;
    if (this.playing && this.mode === 'system') this.speakNow();
  }
  setTidy(tidy) {
    this.tidy = tidy;
    this.flush();
    if (this.playing) this.speakNow();
  }
  setMode(mode) {
    const was = this.playing;
    this.stop();
    this.flush();
    this.mode = mode;
    if (was) this.play();
  }

  async play() {
    if (!this.items.length) return;
    this.playing = true;
    this.emit('state');
    if (this.mode === 'neural') {
      // Resuming the very same sentence continues mid-word rather than restarting it.
      const clip = this.clips.get(this.idx);
      if (clip && this.audio.getAttribute('src') === clip.url && this.audio.paused && this.audio.currentTime > 0 && !this.audio.ended) {
        try { await this.audio.play(); this.pump(); return; } catch { /* fall through and start the sentence normally */ }
      }
    }
    this.speakNow();
  }

  pause() {
    this.playing = false;
    this.waiting = false;
    this.playToken++;
    this.audio.pause();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.emit('state');
  }
  stop() {
    this.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  seek(i) {
    const target = this.nextSpoken(Math.max(0, Math.min(this.items.length - 1, i)));
    if (target < 0) return;
    this.idx = target;
    this.emit('position', { idx: target });
    // Sentences far from the new position were queued for nothing.
    const stillUseful = [...this.asked].some((n) => n >= target && n <= target + AHEAD_MAX);
    if (!stillUseful) { this.generation++; this.engine.clear(); this.asked.clear(); }
    if (this.playing) this.speakNow();
    else { this.audio.pause(); this.audio.removeAttribute('src'); }
  }
  skip(dir) {
    const next = this.nextSpoken(this.idx + dir, dir);
    if (next >= 0) this.seek(next);
  }
  skipBlock(dir) {
    let i = this.idx;
    const at = (n) => this.items[n]?.block;
    const here = at(i);
    if (dir > 0) { while (i < this.items.length && at(i) === here) i++; }
    else {
      while (i > 0 && at(i - 1) === here) i--;
      // Pressed early in a paragraph, go to the previous one; otherwise back to the start of this one.
      if (this.idx - i < 2 && i > 0) { const prev = at(i - 1); i--; while (i > 0 && at(i - 1) === prev) i--; }
    }
    if (i < this.items.length) this.seek(i);
  }

  advance() {
    const next = this.nextSpoken(this.idx + 1);
    if (next < 0) {
      this.pause();
      this.emit('finished');
      return;
    }
    this.idx = next;
    this.emit('position', { idx: next });
    this.speakNow();
  }

  speakNow() {
    const start = this.nextSpoken(this.idx);
    if (start < 0) { this.pause(); return; }
    if (start !== this.idx) { this.idx = start; this.emit('position', { idx: start }); }
    const token = ++this.playToken;
    if (this.mode === 'system') { this.speakSystem(token); return; }
    const clip = this.clips.get(this.idx);
    if (clip) this.startClip(clip, token);
    else { this.waiting = true; this.audio.pause(); this.emit('state'); }
    this.pump();
  }

  async startClip(clip, token) {
    this.waiting = false;
    this.audio.src = clip.url;
    this.audio.defaultPlaybackRate = this.rate;
    this.audio.playbackRate = this.rate;
    this.audio.preservesPitch = true;
    this.emit('state');
    try { await this.audio.play(); }
    catch (err) {
      if (err.name === 'NotAllowedError' && token === this.playToken) this.pause();
    }
  }

  pump() {
    if (!this.playing || this.mode !== 'neural' || !this.engine.ready) return;
    let buffered = 0;
    for (let i = this.idx, looked = 0; i < this.items.length && looked < AHEAD_MAX && buffered < AHEAD_SECONDS; i++, looked++) {
      const text = this.say(i);
      if (!text) continue;
      const clip = this.clips.get(i);
      if (clip) { buffered += clip.seconds; continue; }
      buffered += text.length * this.secondsPerChar;
      if (!this.asked.has(i)) this.request(i, text);
    }
    for (const [i, clip] of this.clips) {
      if (i < this.idx - KEEP_BEHIND || i > this.idx + AHEAD_MAX * 2) { URL.revokeObjectURL(clip.url); this.clips.delete(i); }
    }
  }

  async request(i, text) {
    const generation = this.generation;
    this.asked.add(i);
    try {
      const { audio, sampleRate, ms } = await this.engine.synth(text, this.voice);
      if (generation !== this.generation) return;
      this.asked.delete(i);
      const seconds = audio.length / sampleRate;
      const pad = this.items[i].blockEnd ? BLOCK_PAUSE : SENTENCE_PAUSE;
      const url = URL.createObjectURL(wavBlob([toPcm(audio, pad, sampleRate)], audio.length + Math.round(pad * sampleRate), sampleRate));
      this.clips.set(i, { url, seconds: seconds + pad });
      this.secondsPerChar = this.secondsPerChar * 0.85 + (seconds / Math.max(1, text.length)) * 0.15;
      this.generationSpeed = this.generationSpeed ? this.generationSpeed * 0.7 + (seconds / (ms / 1000)) * 0.3 : seconds / (ms / 1000);
      this.emit('time');
      if (i === this.idx && this.waiting && this.playing) this.startClip(this.clips.get(i), this.playToken);
      this.pump();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (generation !== this.generation) return;
      this.asked.delete(i);
      this.pause();
      this.emit('failure', { message: err.message });
    }
  }

  speakSystem(token) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(this.say(this.idx));
    const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === this.systemVoice);
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = this.rate;
    u.onend = () => { if (token === this.playToken && this.playing) this.advance(); };
    u.onerror = (e) => {
      if (token !== this.playToken || e.error === 'canceled' || e.error === 'interrupted') return;
      this.pause();
      this.emit('failure', { message: 'This browser\'s built-in voice stopped unexpectedly.' });
    };
    this.waiting = false;
    this.emit('state');
    speechSynthesis.speak(u);
  }

  secondsLeft() {
    let chars = 0;
    for (let i = this.idx; i < this.items.length; i++) chars += this.items[i].text.length;
    return (chars * this.secondsPerChar) / this.rate;
  }
}
