// Natural voice worker. The voice runs on this device, and its files are kept in the browser's Cache Storage, so a
// second visit downloads nothing. Text never leaves the page.
import { setDictionary, textToPhonemes, expandNumbers } from './g2p.js';

const VENDOR = new URL('../vendor/', import.meta.url).href;
const CACHE = 'reader-voices';
let generate = null, ort = null, jobs = [], busy = false;

async function download(url, expected) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { /* without Cache Storage the voice still works for this visit */ }
  self.postMessage({ type: 'download', file: url, loaded: 0, total: expected });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The voice download failed (error ${res.status}).`);
  const total = +res.headers.get('content-length') || expected;
  const reader = res.body.getReader(), chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    self.postMessage({ type: 'download', file: url, loaded, total: Math.max(total, loaded) });
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  // Stored only once complete, so a cancelled download never leaves a broken voice behind.
  try { await cache?.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(loaded) } })); } catch { /* storage full: works for this visit */ }
  return bytes;
}
const json = async (url, expected) => JSON.parse(new TextDecoder().decode(await download(url, expected)));
const session = (bytes) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const int64 = (values, dims) => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), dims);
const float32 = (values, dims) => new ort.Tensor('float32', values, dims);
const loadDictionary = async () => setDictionary(await (await fetch(`${VENDOR}cmudict.dict`)).text());

/* ---------- Piper ---------- */
async function loadPiper({ base, voice, bytes }) {
  const url = `${base}${voice}.onnx`;
  const [model, config] = await Promise.all([download(url, bytes), json(`${url}.json`, 5000), loadDictionary()]);
  const s = await session(model);
  const map = config.phoneme_id_map, lang = config.espeak.voice, { noise_scale, length_scale, noise_w } = config.inference;
  generate = async (text, _voice, speed) => {
    const ids = [...map['^'], ...map._];
    for (const ch of textToPhonemes(text, lang).normalize('NFD')) if (map[ch]) ids.push(...map[ch], ...map._);
    ids.push(...map.$);
    const out = await s.run({
      input: int64(ids, [1, ids.length]),
      input_lengths: int64([ids.length], [1]),
      scales: float32(Float32Array.from([noise_scale, length_scale / speed, noise_w]), [3]),
    });
    return { audio: out.output.data.slice(), rate: config.audio.sample_rate };
  };
}

/* ---------- Kitten ---------- */
const KITTEN_SYMBOLS = ['$', ...';:,.!?¡¿—…"«»"" ', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  ...'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\'̩\'ᵻ'];
// voices.npz is an uncompressed zip of NumPy arrays, written with zip64 sizes.
function readNpz(bytes, name) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
  for (let p = 0; v.getUint32(p, true) === 0x04034b50;) {
    let size = v.getUint32(p + 18, true);
    const nameLen = v.getUint16(p + 26, true), extra = v.getUint16(p + 28, true);
    if (size === 0xffffffff) size = Number(v.getBigUint64(p + 30 + nameLen + 12, true));
    const start = p + 30 + nameLen + extra;
    if (dec.decode(bytes.subarray(p + 30, p + 30 + nameLen)) === `${name}.npy`) {
      const header = v.getUint16(start + 8, true);
      return new Float32Array(bytes.slice(start + 10 + header, start + size).buffer);
    }
    p = start + size;
  }
  throw new Error('That voice is missing from the download.');
}
async function loadKitten({ base, file, sizes }) {
  const [model, voices] = await Promise.all([download(base + file, sizes[0]), download(`${base}voices.npz`, sizes[1]), loadDictionary()]);
  const s = await session(model), map = new Map(KITTEN_SYMBOLS.map((c, i) => [c, i])), styles = new Map();
  generate = async (text, voice, speed) => {
    if (!styles.has(voice)) styles.set(voice, readNpz(voices, voice));
    // The model expects each word and punctuation mark separated by a space.
    const phonemes = textToPhonemes(text).match(/[\p{L}\p{M}\p{Lm}\p{Sk}\d_]+|[^\p{L}\p{M}\p{Lm}\p{Sk}\d_\s]/gu)?.join(' ') || '';
    const ids = [0];
    for (const c of phonemes) if (map.has(c)) ids.push(map.get(c));
    ids.push(10, 0);
    const row = Math.min(text.length, 399) * 256, prior = voice === 'expr-voice-4-m' ? 0.9 : 0.8;
    const out = await s.run({ input_ids: int64(ids, [1, ids.length]), style: float32(styles.get(voice).slice(row, row + 256), [1, 256]), speed: float32(Float32Array.of(speed * prior), [1]) });
    return { audio: Object.values(out)[0].data.slice(0, -5000), rate: 24000 };
  };
}

/* ---------- Kokoro ---------- */
async function loadKokoro({ base, file, bytes, voice: first }) {
  const [model, tokenizer] = await Promise.all([download(base + file, bytes), json(`${base}tokenizer.json`, 3497), loadDictionary()]);
  const s = await session(model), vocab = tokenizer.model.vocab, styles = new Map();
  const style = async (voice) => {
    if (!styles.has(voice)) { const b = await download(`${base}voices/${voice}.bin`, 522240); styles.set(voice, new Float32Array(b.slice().buffer)); }
    return styles.get(voice);
  };
  await style(first);
  generate = async (text, voice, speed) => {
    const ids = [0];
    for (const c of textToPhonemes(text, voice[0] === 'b' ? 'en-gb' : 'en-us')) if (vocab[c] !== undefined) ids.push(vocab[c]);
    ids.push(0);
    const row = Math.min(ids.length - 2, 509) * 256;
    const out = await s.run({ input_ids: int64(ids, [1, ids.length]), style: float32((await style(voice)).slice(row, row + 256), [1, 256]), speed: float32(Float32Array.of(speed), [1]) });
    return { audio: out.waveform.data.slice(), rate: 24000 };
  };
}

/* ---------- Supertonic: reads letters directly, so it needs no pronunciation step ---------- */
const SYMBOLS = { '–': '-', '‑': '-', '—': '-', _: ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '@': ' at ' };
function prepare(text, lang) {
  let t = (lang === 'en' ? expandNumbers(text) : text).normalize('NFKD').replace(/\p{Extended_Pictographic}/gu, '').replace(/[–‑—_“”‘’´`[\]|/#@]/g, (c) => SYMBOLS[c]);
  t = t.replace(/ ([,.!?;:'])/g, '$1').replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(t)) t += '.';
  return `<${lang}>${t}</${lang}>`;
}
function pieces(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const at = Math.max(head.lastIndexOf(' '), head.lastIndexOf('、'), head.lastIndexOf('。'));
    out.push(rest.slice(0, at > 0 ? at + 1 : max));
    rest = rest.slice(at > 0 ? at + 1 : max);
  }
  if (rest.trim()) out.push(rest);
  return out;
}
async function loadSupertonic({ base, sizes, voice: first }) {
  const f = (name) => `${base}onnx/${name}`;
  const [dp, enc, est, voc, cfg, indexer] = await Promise.all([
    download(f('duration_predictor.onnx'), sizes[0]), download(f('text_encoder.onnx'), sizes[1]), download(f('vector_estimator.onnx'), sizes[2]), download(f('vocoder.onnx'), sizes[3]),
    json(f('tts.json'), 8500), json(f('unicode_indexer.json'), 270000),
  ]);
  const [durationModel, encoder, estimator, vocoder] = [await session(dp), await session(enc), await session(est), await session(voc)];
  const styles = new Map();
  const style = async (voice) => {
    if (!styles.has(voice)) {
      const s = await json(`${base}voice_styles/${voice}.json`, 400000);
      styles.set(voice, {
        ttl: float32(Float32Array.from(s.style_ttl.data.flat(Infinity)), s.style_ttl.dims),
        dp: float32(Float32Array.from(s.style_dp.data.flat(Infinity)), s.style_dp.dims),
      });
    }
    return styles.get(voice);
  };
  await style(first);
  const sampleRate = cfg.ae.sample_rate, chunk = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor, dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const STEPS = 5;
  const one = async (text, st, speed, lang) => {
    const ids = [...prepare(text, lang)].map((c) => { const cp = c.codePointAt(0); return cp < indexer.length ? indexer[cp] : -1; });
    const textIds = int64(ids, [1, ids.length]), textMask = float32(new Float32Array(ids.length).fill(1), [1, 1, ids.length]);
    const seconds = (await durationModel.run({ text_ids: textIds, style_dp: st.dp, text_mask: textMask })).duration.data[0] / (speed * 1.05);
    const textEmb = (await encoder.run({ text_ids: textIds, style_ttl: st.ttl, text_mask: textMask })).text_emb;
    const len = Math.max(1, Math.floor((Math.floor(seconds * sampleRate) + chunk - 1) / chunk));
    let latent = new Float32Array(dim * len);
    for (let i = 0; i < latent.length; i++) latent[i] = Math.sqrt(-2 * Math.log(Math.max(1e-4, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
    const latentMask = float32(new Float32Array(len).fill(1), [1, 1, len]), total = float32(Float32Array.of(STEPS), [1]);
    for (let step = 0; step < STEPS; step++) {
      latent = (await estimator.run({ noisy_latent: float32(latent, [1, dim, len]), text_emb: textEmb, style_ttl: st.ttl, latent_mask: latentMask, text_mask: textMask, current_step: float32(Float32Array.of(step), [1]), total_step: total })).denoised_latent.data;
    }
    return (await vocoder.run({ latent: float32(latent, [1, dim, len]) })).wav_tts.data.slice();
  };
  generate = async (text, voice, speed, lang = 'en') => {
    const st = await style(voice);
    const parts = [];
    for (const p of pieces(text, lang === 'ko' || lang === 'ja' ? 120 : 290)) parts.push(await one(p, st, speed, lang));
    if (parts.length === 1) return { audio: parts[0], rate: sampleRate };
    const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { audio.set(p, at); at += p.length; }
    return { audio, rate: sampleRate };
  };
}

async function drain() {
  if (busy) return;
  busy = true;
  while (jobs.length) {
    const job = jobs.shift();
    const started = performance.now();
    try {
      const { audio, rate } = await generate(job.text, job.voice, job.speed || 1, job.lang);
      self.postMessage({ type: 'audio', id: job.id, audio, rate, ms: performance.now() - started }, [audio.buffer]);
    } catch (err) {
      self.postMessage({ type: 'failed', id: job.id, message: String(err?.message || err) });
    }
    // Lets a waiting "clear" arrive before the next sentence starts, so seeking feels immediate.
    await new Promise((r) => setTimeout(r));
  }
  busy = false;
}

const LOADERS = { piper: loadPiper, kitten: loadKitten, kokoro: loadKokoro, supertonic: loadSupertonic };
self.onmessage = async (e) => {
  const m = e.data;
  if (m.cmd === 'load') {
    try {
      ort = await import(`${VENDOR}ort.wasm.min.mjs`);
      ort.env.wasm.wasmPaths = VENDOR;
      await LOADERS[m.kind](m);
      self.postMessage({ type: 'ready' });
    } catch (err) { self.postMessage({ type: 'error', message: String(err?.message || err) }); }
  } else if (m.cmd === 'synth') {
    jobs.push(m);
    drain();
  } else if (m.cmd === 'clear') {
    jobs = [];
  }
};
