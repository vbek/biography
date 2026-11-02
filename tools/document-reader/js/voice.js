/* Document Reader — manages the one-time model download and talks to the voice worker. */
const HF = 'https://huggingface.co/';
const CACHE = 'reader-voices';
const SUPERTONIC_VOICES = [['F1', 'Female 1', ''], ['F2', 'Female 2', ''], ['F3', 'Female 3', ''], ['F4', 'Female 4', ''], ['F5', 'Female 5', ''], ['M1', 'Male 1', ''], ['M2', 'Male 2', ''], ['M3', 'Male 3', ''], ['M4', 'Male 4', ''], ['M5', 'Male 5', '']];
const LANGUAGES = { en: 'English', ko: 'Korean', es: 'Spanish', pt: 'Portuguese', fr: 'French', ja: 'Japanese', ar: 'Arabic', bg: 'Bulgarian', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', et: 'Estonian', fi: 'Finnish', hi: 'Hindi', hr: 'Croatian', hu: 'Hungarian', id: 'Indonesian', it: 'Italian', lt: 'Lithuanian', lv: 'Latvian', nl: 'Dutch', pl: 'Polish', ro: 'Romanian', ru: 'Russian', sk: 'Slovak', sl: 'Slovenian', sv: 'Swedish', tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese' };
export const languageName = (code) => LANGUAGES[code];

// Piper: only voices trained from scratch on public-domain recordings and released as public domain. Most other Piper
// voices are fine-tuned from Lessac, whose recordings are under a research licence, so don't add those.
// eSpeak NG is GPL and is deliberately not used: pronunciation for the voices that need it comes from g2p.js.
export const TIERS = {
  fast: {
    kind: 'piper', rate: 22050, bytes: 63201294, perVoice: true, name: 'Fast', licence: 'Public domain',
    note: 'The quickest on an older laptop. Each voice is a separate download.',
    voices: [['en_US-kristin-medium', 'Kristin', 'US, female', 'en_US/kristin/medium/'], ['en_US-norman-medium', 'Norman', 'US, male', 'en_US/norman/medium/'], ['en_GB-cori-medium', 'Cori', 'UK, female', 'en_GB/cori/medium/']],
  },
  tiny: {
    kind: 'kitten', rate: 24000, bytes: 27648873, sizes: [24369971, 3278902], name: 'Tiny', licence: 'Apache 2.0', base: `${HF}KittenML/kitten-tts-nano-0.8-int8/resolve/main/`, file: 'kitten_tts_nano_v0_8.onnx',
    note: 'The smallest download, with 8 voices. Only just keeps up on an older laptop.',
    voices: [['expr-voice-2-f', 'Bella', 'female'], ['expr-voice-2-m', 'Jasper', 'male'], ['expr-voice-3-f', 'Luna', 'female'], ['expr-voice-3-m', 'Bruno', 'male'], ['expr-voice-4-f', 'Rosie', 'female'], ['expr-voice-4-m', 'Hugo', 'male'], ['expr-voice-5-f', 'Kiki', 'female'], ['expr-voice-5-m', 'Leo', 'male']],
  },
  natural: {
    kind: 'supertonic', rate: 44100, bytes: 262800000, sizes: [1500000, 27400000, 132500000, 101400000], restricted: true, name: 'Natural', licence: 'OpenRAIL-M', base: `${HF}Supertone/supertonic-2/resolve/main/`, file: 'onnx/vector_estimator.onnx',
    note: 'Clear, fast and 10 voices. Reads English, Korean, Spanish, Portuguese and French.',
    langs: ['en', 'ko', 'es', 'pt', 'fr'], voices: SUPERTONIC_VOICES,
  },
  global: {
    kind: 'supertonic', rate: 44100, bytes: 398000000, sizes: [3700000, 36400000, 256500000, 101400000], restricted: true, name: 'Many languages', licence: 'OpenRAIL-M', base: `${HF}Supertone/supertonic-3/resolve/main/`, file: 'onnx/vector_estimator.onnx',
    note: 'Reads 31 languages, including Hindi, Arabic and Russian. Needs a fast computer, or there will be pauses.',
    langs: Object.keys(LANGUAGES), voices: SUPERTONIC_VOICES,
  },
  studio: {
    kind: 'kokoro', rate: 24000, bytes: 92361116, name: 'Studio', licence: 'Apache 2.0', base: `${HF}onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/`, file: 'onnx/model_quantized.onnx',
    note: 'A rich sound and 13 voices. Needs a fast computer, or there will be long pauses.',
    voices: [['af_heart', 'Heart', 'US, female'], ['af_bella', 'Bella', 'US, female'], ['af_nicole', 'Nicole', 'US, soft'], ['af_aoede', 'Aoede', 'US, female'], ['af_kore', 'Kore', 'US, female'], ['af_sarah', 'Sarah', 'US, female'], ['am_michael', 'Michael', 'US, male'], ['am_fenrir', 'Fenrir', 'US, male'], ['am_puck', 'Puck', 'US, male'], ['bf_emma', 'Emma', 'UK, female'], ['bf_isabella', 'Isabella', 'UK, female'], ['bm_george', 'George', 'UK, male'], ['bm_fable', 'Fable', 'UK, male']],
  },
};
const PIPER_REPO = `${HF}rhasspy/piper-voices/resolve/main/en/`;
const piperBase = (id) => `${PIPER_REPO}${(TIERS.fast.voices.find((v) => v[0] === id) || TIERS.fast.voices[0])[3]}`;
const mainFile = (tier, voice) => (tier === 'fast' ? `${piperBase(voice)}${voice}.onnx` : TIERS[tier].base + TIERS[tier].file);
export const modelKey = (tier, voice) => (TIERS[tier].perVoice ? `${tier}:${voice}` : tier);
export async function isInstalled(tier, voice) {
  try {
    if (!('caches' in window) || !await caches.has(CACHE)) return false;
    return !!await (await caches.open(CACHE)).match(mainFile(tier, voice));
  } catch { return false; }
}
export async function storedBytes() {
  let total = 0;
  for (const name of [CACHE]) {
    try {
      if (!await caches.has(name)) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        const size = +res.headers.get('content-length');
        total += size || (await res.clone().blob()).size;
      }
    } catch { /* an unreadable entry just isn't counted */ }
  }
  return total;
}
export async function removeModel() {
  await caches.delete(CACHE);
}

export class VoiceEngine {
  constructor() { this.worker = null; this.pending = new Map(); this.nextId = 1; this.key = null; this.ready = null; this.lang = 'en'; }

  /** Starts the worker once. onProgress gets { loaded, total, bytesPerSec }; it only reports real downloads. */
  load(tier, voice, onProgress = () => {}) {
    const key = modelKey(tier, voice);
    if (this.ready && this.key === key) return this.ready;
    this.dispose();
    this.key = key;
    this.ready = new Promise((res, rej) => {
      this.worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
      this.rejectLoad = rej;
      const files = new Map();
      let lastAt = performance.now(), lastLoaded = 0, bytesPerSec = 0;
      this.worker.onerror = (e) => { rej(new Error(e.message || 'The voice could not start.')); this.dispose(); };
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'download') {
          files.set(m.file, m);
          let loaded = 0, total = 0;
          for (const f of files.values()) { loaded += f.loaded; total += f.total; }
          const now = performance.now();
          if (now - lastAt > 500) {
            const instant = (loaded - lastLoaded) / ((now - lastAt) / 1000);
            bytesPerSec = bytesPerSec ? bytesPerSec * 0.7 + instant * 0.3 : instant;
            lastAt = now; lastLoaded = loaded;
          }
          onProgress({ loaded, total, bytesPerSec });
        } else if (m.type === 'ready') res();
        else if (m.type === 'error') { rej(new Error(m.message)); this.dispose(); }
        else if (m.type === 'audio' || m.type === 'failed') {
          const job = this.pending.get(m.id);
          if (!job) return;
          this.pending.delete(m.id);
          if (m.type === 'audio') job.res({ audio: m.audio, sampleRate: m.rate, ms: m.ms });
          else job.rej(new Error(m.message));
        }
      };
      const t = TIERS[tier];
      this.worker.postMessage({ cmd: 'load', kind: t.kind, voice, base: t.kind === 'piper' ? piperBase(voice) : t.base, file: t.file, bytes: t.bytes, sizes: t.sizes });
    });
    return this.ready;
  }

  synth(text, voice, speed = 1) {
    return new Promise((res, rej) => {
      const id = this.nextId++;
      this.pending.set(id, { res, rej });
      this.worker.postMessage({ cmd: 'synth', id, text, voice, speed, lang: this.lang });
    });
  }

  /** Drops queued sentences. The one in progress finishes and is ignored by whoever asked. */
  clear() {
    this.worker?.postMessage({ cmd: 'clear' });
    for (const job of this.pending.values()) job.rej(new DOMException('cancelled', 'AbortError'));
    this.pending.clear();
  }

  dispose() {
    this.clear();
    this.worker?.terminate();
    this.rejectLoad?.(new DOMException('cancelled', 'AbortError'));
    this.worker = null; this.ready = null; this.key = null; this.rejectLoad = null;
  }
}

/* ---------- audio files ---------- */
function wavHeader(samples, sampleRate) {
  const v = new DataView(new ArrayBuffer(44));
  const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, samples * 2, true);
  return v.buffer;
}
export function toPcm(audio, padSeconds, sampleRate) {
  const pad = Math.round(padSeconds * sampleRate);
  const pcm = new Int16Array(audio.length + pad);
  for (let i = 0; i < audio.length; i++) pcm[i] = Math.max(-1, Math.min(1, audio[i])) * 32767;
  return pcm;
}
export const wavBlob = (parts, samples, sampleRate) => new Blob([wavHeader(samples, sampleRate), ...parts], { type: 'audio/wav' });
