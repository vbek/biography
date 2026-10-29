// Speech-to-text worker for Media Studio. Whisper runs on this device through transformers.js (WebGPU when
// available, otherwise WebAssembly). Only the library and model weights are downloaded; audio never leaves the page.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

env.allowLocalModels = false;

const SR = 16000;
let asr = null, asrKey = '', device = '';

async function hasWebGPU() {
  try { return !!(self.navigator.gpu && await self.navigator.gpu.requestAdapter()); } catch { return false; }
}

async function load(model) {
  if (asr && asrKey === model) return asr;
  if (asr) { try { await asr.dispose(); } catch {} asr = null; }
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) self.postMessage({ type: 'download', file: p.file, loaded: p.loaded, total: p.total });
  };
  const attempts = [{ device: 'wasm', dtype: 'q8' }];
  if (await hasWebGPU()) attempts.unshift({ device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
  let lastErr;
  for (const opts of attempts) {
    try {
      asr = await pipeline('automatic-speech-recognition', model, { ...opts, progress_callback });
      asrKey = model; device = opts.device;
      return asr;
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

// Split long audio into windows of at most 30 s (Whisper's context), cutting at the quietest moment
// between 20 and 30 s so that words are rarely split in half.
function windows(audio) {
  const max = 30 * SR, min = 20 * SR, hop = SR / 10, out = [];
  for (let s = 0; s < audio.length;) {
    let e = Math.min(audio.length, s + max);
    if (e < audio.length) {
      let best = e, bestE = Infinity;
      for (let p = s + min; p + hop <= e; p += hop / 2) {
        let sum = 0;
        for (let i = p; i < p + hop; i++) sum += audio[i] * audio[i];
        if (sum < bestE) { bestE = sum; best = p + hop / 2; }
      }
      e = best;
    }
    out.push([s, e]);
    s = e;
  }
  return out;
}

function rms(a) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / Math.max(1, a.length));
}

// Long segments become several shorter cues, timed in proportion to their length.
function splitCue(start, end, text, maxChars = 84) {
  if (text.length <= maxChars) return [{ start, end, text }];
  const words = text.split(/\s+/), parts = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) { parts.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) parts.push(cur);
  const total = parts.reduce((n, p) => n + p.length, 0);
  let t = start;
  return parts.map(p => {
    const d = (end - start) * p.length / total;
    const cue = { start: t, end: t + d, text: p };
    t += d;
    return cue;
  });
}

const NOISE = /^[\s.,!?♪\-–—…]*$|^\s*[\[(][^\])]*[\])]\s*$/;

async function transcribe({ audio, model, language, task, offset }) {
  await load(model);
  self.postMessage({ type: 'ready', device });
  const opts = { return_timestamps: true };
  if (language) opts.language = language;
  if (task) opts.task = task;
  const wins = windows(audio), total = audio.length / SR;
  for (const [s, e] of wins) {
    const chunk = audio.subarray(s, e), t0 = s / SR, len = (e - s) / SR;
    const cues = [];
    if (rms(chunk) > 0.002 && len > 0.3) {
      const out = await asr(chunk, opts);
      for (const c of out.chunks || [{ timestamp: [0, len], text: out.text }]) {
        const text = (c.text || '').trim();
        if (!text || NOISE.test(text)) continue;
        const a = Math.max(0, Math.min(len, c.timestamp?.[0] ?? 0));
        let b = c.timestamp?.[1];
        b = b == null || b <= a ? Math.min(len, a + Math.max(1.5, text.length / 15)) : Math.min(len, b);
        cues.push(...splitCue(offset + t0 + a, offset + t0 + b, text));
      }
    }
    self.postMessage({ type: 'cues', cues, done: e / SR, total });
  }
  self.postMessage({ type: 'done' });
}

self.onmessage = async (e) => {
  try {
    if (e.data.cmd === 'transcribe') await transcribe(e.data);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
