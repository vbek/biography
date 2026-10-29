/* Media Studio, video mode — compress, resize, convert, trim, extract audio and make subtitles in the browser.
   Decoding/encoding uses WebCodecs through Mediabunny (lib/); speech-to-text runs Whisper in whisper-worker.js. */
import * as MB from 'mediabunny';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const video = $('#video'), capView = $('#capView');

const QUALITY = ['very-low', 'low', 'medium', 'high', 'very-high'];
const QUALITY_LABEL = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
const BPP = [0.03, 0.053, 0.095, 0.17, 0.3]; // rough bits per pixel per frame, only used for size estimates
const RES_PRESETS = [2160, 1440, 1080, 720, 540, 480, 360, 240];

const CONTAINERS = {
  mp4: { ext: 'mp4', make: () => new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), video: ['avc', 'hevc', 'av1', 'vp9'], audio: ['aac', 'opus'], note: 'Plays almost everywhere.' },
  webm: { ext: 'webm', make: () => new MB.WebMOutputFormat(), video: ['vp9', 'av1', 'vp8'], audio: ['opus', 'vorbis'], note: 'Made for the web. VP9/AV1 give smaller files at the same quality.' },
  mov: { ext: 'mov', make: () => new MB.MovOutputFormat({ fastStart: 'in-memory' }), video: ['avc', 'hevc'], audio: ['aac'], note: 'QuickTime, handy for Apple devices and editing apps.' },
  mkv: { ext: 'mkv', make: () => new MB.MkvOutputFormat(), video: ['avc', 'hevc', 'vp9', 'av1'], audio: ['opus', 'aac'], note: 'Flexible, but some players and sites don’t accept it.' },
};
const CODEC_NAME = { avc: 'H.264', hevc: 'H.265', vp9: 'VP9', av1: 'AV1', vp8: 'VP8', prores: 'ProRes', aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3', eac3: 'E-AC-3' };
const FORMAT_NAME = { 'QuickTime File Format': 'MOV (QuickTime)', WAVE: 'WAV', Matroska: 'MKV' };
const codecName = (c) => c ? (CODEC_NAME[c] || (c.startsWith('pcm') ? 'PCM' : c.toUpperCase())) : '—';

const st = { file: null, info: null, start: 0, end: 0, cues: [], cmp: 'off', busy: false, cancel: null, worker: null };

/* ---------- small helpers ---------- */
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const clipDur = () => Math.max(0, st.end - st.start);
const baseName = () => st.file.name.replace(/\.[^.]+$/, '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtT(t, d = 1) {
  const f = 10 ** d;
  t = Math.floor(Math.max(0, t) * f + 1e-6) / f;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = (t % 60).toFixed(d).padStart(d ? d + 3 : 2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
function parseT(str) {
  const parts = String(str).trim().replace(',', '.').split(':');
  if (!parts[0] || parts.length > 3) return null;
  const t = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  return Number.isFinite(t) ? t : null;
}
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 ** 2) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 2 : 1) + ' MB';
  return (b / 1024 ** 3).toFixed(2) + ' GB';
}
const fmtRate = (bps) => bps >= 1e6 ? (bps / 1e6).toFixed(bps < 1e7 ? 2 : 1) + ' Mbps' : Math.round(bps / 1000) + ' kbps';

function toast(msg, warn) {
  const el = document.createElement('div');
  el.className = 'toast' + (warn ? ' warn' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), warn ? 6000 : 3200);
}

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/* ---------- loading ---------- */
async function probe(file) {
  const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(file) });
  try {
    if (!(await input.canRead())) throw new Error('unsupported');
    const [format, duration, v, a] = await Promise.all([input.getFormat(), input.computeDuration(), input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const info = { format: FORMAT_NAME[format.name] || format.name, duration, size: file.size, bitrate: duration ? file.size * 8 / duration : 0, hasVideo: !!v, hasAudio: !!a };
    if (v) {
      Object.assign(info, { width: v.displayWidth, height: v.displayHeight, vcodec: v.codec });
      try { info.fps = (await v.computePacketStats(150)).averagePacketRate; } catch { info.fps = 0; }
    }
    if (a) Object.assign(info, { acodec: a.codec, channels: a.numberOfChannels, sampleRate: a.sampleRate });
    return info;
  } finally {
    input.dispose();
  }
}

async function openFile(file) {
  if (!file || st.busy) return;
  let info;
  try { info = await probe(file); } catch {
    toast(`Couldn’t read “${file.name}”. Try MP4, WebM, MOV or MKV.`, true);
    return;
  }
  if (!info.duration) { toast('This file has no playable media.', true); return; }
  if (st.file) URL.revokeObjectURL(video.src);
  Object.assign(st, { file, info, start: 0, end: info.duration, cues: [] });
  document.body.classList.add('has-img');
  document.body.classList.toggle('audio-only', !info.hasVideo);
  $('#drop').hidden = true;
  $('#player').hidden = false;
  $('#noPreview').hidden = true;
  $('#player').classList.toggle('audio-only', !info.hasVideo);
  video.src = URL.createObjectURL(file);
  $('#outName').value = baseName() + '-edit';
  $('#result').hidden = true;
  $('#rotate').value = '0';
  $('#res').value = 'orig';
  $('#subsBox').open = !info.hasVideo || $('#subsBox').open;
  $('#audioBox').open = !info.hasVideo || $('#audioBox').open;
  renderInfo();
  fillRes();
  await fillCodecs();
  renderCues();
  updateTrim();
  update();
}

function renderInfo() {
  const i = st.info, rows = [['Name', esc(st.file.name)], ['Format', esc(i.format)], ['Length', fmtT(i.duration)], ['Size', fmtBytes(i.size)]];
  if (i.hasVideo) rows.push(['Video', `${i.width}×${i.height} · ${codecName(i.vcodec)}${i.fps ? ' · ' + (Math.round(i.fps * 100) / 100) + ' fps' : ''}`]);
  rows.push(['Audio', i.hasAudio ? `${codecName(i.acodec)} · ${(i.sampleRate / 1000).toFixed(1)} kHz · ${i.channels === 1 ? 'mono' : i.channels === 2 ? 'stereo' : i.channels + ' ch'}` : 'None']);
  rows.push(['Bitrate', fmtRate(i.bitrate)]);
  $('#info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

/* ---------- output settings ---------- */
function srcDims() {
  const { width: w, height: h } = st.info;
  return +$('#rotate').value % 180 ? [h, w] : [w, h];
}

function outDims() {
  const [w, h] = srcDims(), v = $('#res').value;
  if (v === 'orig') return { w, h, changed: false };
  if (v === 'custom') return { w: even(+$('#cw').value || w), h: even(+$('#ch').value || h), changed: true, custom: true };
  const s = +v / Math.min(w, h);
  return { w: even(w * s), h: even(h * s), changed: true };
}

function fillRes() {
  if (!st.info.hasVideo) return;
  const [w, h] = srcDims(), short = Math.min(w, h), keep = $('#res').value;
  const opts = [`<option value="orig">Original · ${w}×${h}</option>`];
  for (const p of RES_PRESETS) {
    if (p >= short) continue;
    const s = p / short;
    opts.push(`<option value="${p}">${p}p · ${even(w * s)}×${even(h * s)}</option>`);
  }
  opts.push('<option value="custom">Custom size…</option>');
  $('#res').innerHTML = opts.join('');
  $('#res').value = [...$('#res').options].some((o) => o.value === keep) ? keep : 'orig';
  if (!$('#cw').value || $('#res').value !== 'custom') { $('#cw').value = even(w); $('#ch').value = even(h); }
}

async function fillCodecs() {
  const c = CONTAINERS[$('#fmt').value], keep = $('#vcodec').value;
  const sup = c.make().getSupportedVideoCodecs(), list = c.video.filter((x) => sup.includes(x));
  const d = st.info?.hasVideo ? outDims() : { w: 1280, h: 720 };
  const ok = await Promise.all(list.map((x) => MB.canEncodeVideo(x, { width: d.w, height: d.h }).catch(() => false)));
  $('#vcodec').innerHTML = '<option value="">Auto</option>' + list.map((x, i) =>
    `<option value="${x}"${ok[i] ? '' : ' disabled'}>${CODEC_NAME[x]}${ok[i] ? '' : ' (not in this browser)'}</option>`).join('');
  $('#vcodec').value = list.includes(keep) && ok[list.indexOf(keep)] ? keep : '';
  $('#fmtNote').textContent = c.note;
  $('#outExt').textContent = '.' + c.ext;
}

const burning = () => $('#burn').checked && st.cues.length > 0;
const transforms = () => outDims().changed || !!$('#fps').value || burning(); // rotation alone is stored as metadata

// Bitrate plan for the current settings; used for both the estimate and the encoder.
function plan() {
  const i = st.info, dur = clipDur(), d = outDims();
  const fps = +$('#fps').value || i.fps || 30;
  const audio = i.hasAudio && !$('#mute').checked;
  const p = { dur, d, fps, audio };
  if (st.cmp === 'size') {
    p.target = Math.max(0.05, +$('#targetMB').value || 0) * 1024 * 1024;
    const total = p.target * 8 * 0.96 / Math.max(dur, 0.1); // leave room for container overhead
    p.abps = audio ? (total < 160e3 ? 32e3 : total < 500e3 ? 64e3 : total < 1.2e6 ? 96e3 : 128e3) : 0;
    p.vbps = total - p.abps;
    p.bytes = p.target;
  } else if (st.cmp === 'quality' || transforms()) {
    const q = st.cmp === 'quality' ? +$('#quality').value : 3;
    p.vbps = BPP[q] * d.w * d.h * fps;
    p.abps = audio ? 128e3 : 0;
    p.bytes = (p.vbps + p.abps) * dur / 8;
  } else {
    p.bytes = (audio ? i.bitrate : i.bitrate * 0.92) * dur / 8; // streams are copied as they are
  }
  return p;
}

function update() {
  if (!st.info?.hasVideo) return; // audio files only use the Audio and Subtitles sections
  const i = st.info, p = plan(), d = p.d;
  $$('[data-cmp]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cmp === st.cmp)));
  $('#cmpNoteOff').hidden = st.cmp !== 'off';
  $('#rowQuality').hidden = st.cmp !== 'quality';
  $('#rowSize').hidden = st.cmp !== 'size';
  $('#qualityV').textContent = QUALITY_LABEL[+$('#quality').value];
  $('#rowCustom').hidden = $('#res').value !== 'custom';
  $('#rowFit').hidden = $('#res').value !== 'custom' || Math.abs(d.w / d.h - srcDims()[0] / srcDims()[1]) < 0.01;

  const pct = Math.round((1 - p.bytes / i.size) * 100);
  let est = `≈ <b>${fmtBytes(p.bytes)}</b>${pct > 0 ? ` · ${pct}% smaller` : pct < 0 ? ` · ${-pct}% larger` : ''}`;
  if (st.cmp === 'size') {
    if (p.vbps < 40e3) est = `<span class="bad">Too small for a ${fmtT(p.dur)} clip — trim it, mute it or pick a bigger size.</span>`;
    else {
      est = `Video ${fmtRate(p.vbps)}${p.abps ? ` · audio ${fmtRate(p.abps)}` : ''}`;
      const bpp = p.vbps / (d.w * d.h * p.fps);
      if (bpp < 0.035) est += `<br><span class="bad">Low bitrate for ${d.w}×${d.h} — a smaller resolution will look sharper.</span>`;
    }
  }
  $('#estimate').innerHTML = est;

  const vc = $('#vcodec').value ? CODEC_NAME[$('#vcodec').value] : 'Auto';
  $('#outInfo').innerHTML = [
    ['Clip', `${fmtT(p.dur)}${clipDur() < i.duration - 0.05 ? ` <span class="muted">of ${fmtT(i.duration)}</span>` : ''}`],
    ['Video', `${d.w}×${d.h}${$('#fps').value ? ' · ' + $('#fps').value + ' fps' : ''} · ${vc}`],
    ['Audio', p.audio ? 'Kept' : 'None'],
    ['Subtitles', burning() ? 'Burned in' : st.cues.length ? 'Not burned' : 'None'],
    ['Estimated size', st.cmp === 'size' ? `≤ ${fmtBytes(p.target)}` : '≈ ' + fmtBytes(p.bytes)],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

/* ---------- conversion core ---------- */
function startJob(label, cancel) {
  st.busy = true;
  st.cancel = cancel;
  st.jobT0 = performance.now();
  document.body.classList.add('busy');
  $('#job').hidden = false;
  setJob(label, null);
}
function setJob(label, frac, detail) {
  if (label) $('#jobLabel').textContent = label;
  $('#job').classList.toggle('indeterminate', frac == null);
  if (frac != null) {
    $('#jobFill').style.width = (frac * 100).toFixed(1) + '%';
    const el = (performance.now() - st.jobT0) / 1000;
    const eta = frac > 0.03 ? el * (1 - frac) / frac : null;
    $('#jobDetail').textContent = detail ?? `${Math.round(frac * 100)}%${eta != null ? ' · ' + fmtT(eta, 0) + ' left' : ''}`;
  } else $('#jobDetail').textContent = detail || '';
}
function endJob() {
  st.busy = false;
  st.cancel = null;
  document.body.classList.remove('busy');
  $('#job').hidden = true;
}

const DISCARD_REASON = {
  undecodable_source_codec: 'your browser can’t decode it',
  unknown_source_codec: 'its codec is unknown',
  no_encodable_target_codec: 'your browser can’t encode a codec this format allows',
  cannot_copy: 'it can’t be copied into this format',
};

async function convert({ format, video: vopts, audio: aopts, onProgress, tags }) {
  const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(st.file) });
  const target = new MB.BufferTarget();
  const output = new MB.Output({ format, target });
  const trimmed = st.start > 0.001 || st.end < st.info.duration - 0.001;
  try {
    const conv = await MB.Conversion.init({
      input, output, video: vopts, audio: aopts, showWarnings: false,
      trim: trimmed ? { start: st.start, end: st.end } : undefined,
      ...(tags ? { tags } : {}),
    });
    const lost = conv.discardedTracks.filter((t) => DISCARD_REASON[t.reason]);
    if (!conv.isValid) {
      const why = lost.map((t) => `${t.track.type} track skipped: ${DISCARD_REASON[t.reason] || t.reason}`).join('; ');
      throw new Error(why || 'This combination of settings isn’t supported.');
    }
    for (const t of lost) toast(`The ${t.track.type} track was left out: ${DISCARD_REASON[t.reason] || t.reason}.`, true);
    st.cancel = () => conv.cancel();
    conv.onProgress = onProgress;
    await conv.execute();
    return target.buffer;
  } finally {
    input.dispose();
  }
}

async function pickCodec(kind, candidates, format, opts) {
  const sup = kind === 'video' ? format.getSupportedVideoCodecs() : format.getSupportedAudioCodecs();
  const list = candidates.filter((c) => sup.includes(c));
  return kind === 'video' ? MB.getFirstEncodableVideoCodec(list, opts) : MB.getFirstEncodableAudioCodec(list, opts);
}

// Cheapest audio the browser can encode at or above the wanted bitrate (some encoders, like the AAC one
// on Windows, only offer a few fixed bitrates).
async function pickAudio(c, wanted) {
  const sup = c.make().getSupportedAudioCodecs(), numberOfChannels = Math.min(2, st.info.channels), sampleRate = st.info.sampleRate;
  const rates = [...new Set([wanted, 64e3, 96e3, 128e3])].filter((b) => b >= wanted).sort((a, b) => a - b);
  for (const codec of c.audio.filter((x) => sup.includes(x))) {
    for (const bitrate of rates) {
      if (await MB.canEncodeAudio(codec, { numberOfChannels, sampleRate, quality: new MB.Quality({ bitrate }) }).catch(() => false)) return { codec, bitrate };
    }
  }
  return null;
}

/* ---------- export video ---------- */
async function exportVideo() {
  if (!st.file || st.busy) return;
  if (!st.info.hasVideo) { toast('This is an audio file — use the Audio section to convert it.', true); return; }
  const c = CONTAINERS[$('#fmt').value], p = plan(), d = p.d;
  if (st.cmp === 'size' && p.vbps < 40e3) { toast('That target size is too small for this clip. Trim it or choose a bigger size.', true); return; }
  if ($('#burn').checked && !st.cues.length) toast('There are no subtitles to burn in yet.', true);

  const name = ($('#outName').value.trim() || baseName()) + '.' + c.ext;
  const changes = transforms() || st.cmp !== 'off';
  const copyVideo = !changes && !$('#vcodec').value && c.make().getSupportedVideoCodecs().includes(st.info.vcodec);
  let vcodec = copyVideo ? st.info.vcodec : null;
  if (!vcodec) {
    const wanted = $('#vcodec').value ? [$('#vcodec').value] : c.video;
    vcodec = await pickCodec('video', wanted, c.make(), { width: d.w, height: d.h });
    if (!vcodec) { toast(`Your browser can’t encode video for ${c.ext.toUpperCase()}. Try another format.`, true); return; }
  }
  let acodec = null, abps = p.abps;
  if (p.audio) {
    const copyAudio = st.cmp !== 'size' && c.make().getSupportedAudioCodecs().includes(st.info.acodec);
    if (copyAudio) acodec = st.info.acodec;
    else if (st.cmp === 'size') ({ codec: acodec, bitrate: abps } = await pickAudio(c, p.abps) || {});
    else acodec = await pickCodec('audio', c.audio, c.make(), { numberOfChannels: Math.min(2, st.info.channels), sampleRate: st.info.sampleRate });
    if (!acodec) toast('Your browser can’t encode audio for this format, so the video will be silent.', true);
  }

  // Target size: the encoder's rate control is only approximate, so measure and re-run (at a constant
  // bitrate) when the file comes out too big.
  let vbps = p.vbps + (p.abps - (acodec ? abps : 0)), tries = st.cmp === 'size' ? 3 : 1;
  if (st.cmp === 'size' && vbps < 40e3) { toast('That target size is too small for this clip. Trim it, mute it or choose a bigger size.', true); return; }
  startJob('Exporting video…', null);
  try {
    for (let pass = 1; pass <= tries; pass++) {
      if (pass > 1) setJob(`Fine-tuning the size (pass ${pass} of ${tries})…`, 0);
      const vopts = { codec: vcodec, forceTranscode: changes || vcodec !== st.info.vcodec };
      if (d.changed) Object.assign(vopts, { width: d.w, height: d.h, fit: d.custom ? $('#fit').value : 'fill' });
      if ($('#fps').value) vopts.frameRate = +$('#fps').value;
      if ($('#rotate').value !== '0') vopts.rotate = +$('#rotate').value;
      if (st.cmp === 'quality') vopts.quality = new MB.Quality(QUALITY[+$('#quality').value]);
      else if (st.cmp === 'size') vopts.quality = new MB.Quality({ bitrate: Math.round(vbps), bitrateMode: pass > 1 ? 'constant' : 'variable' });
      else if (vopts.forceTranscode) vopts.quality = new MB.Quality('high');
      if (burning()) Object.assign(vopts, { process: burner(), allowTransformationMetadata: false });

      const aopts = !acodec ? { discard: true } : { codec: acodec, forceTranscode: st.cmp === 'size' || acodec !== st.info.acodec };
      if (acodec && st.cmp === 'size') aopts.quality = new MB.Quality({ bitrate: abps });
      if (acodec && st.info.channels > 2) aopts.numberOfChannels = 2;

      const buf = await convert({
        format: c.make(), video: vopts, audio: aopts,
        onProgress: (f) => setJob(null, f),
      });
      if (st.cmp === 'size' && pass < tries && buf.byteLength > p.target) {
        const audioBytes = acodec ? abps * p.dur / 8 : 0;
        vbps *= Math.max(0.3, (p.target - audioBytes) / Math.max(1, buf.byteLength - audioBytes)) * 0.95;
        continue;
      }
      finishExport(new Blob([buf]), name, p);
      break;
    }
  } catch (err) {
    if (!(err instanceof MB.ConversionCanceledError)) { console.error(err); toast('Export failed: ' + (err.message || err), true); }
  } finally {
    endJob();
  }
}

function finishExport(blob, name, p) {
  save(blob, name);
  const pct = Math.round((1 - blob.size / st.info.size) * 100);
  const over = p?.target && blob.size > p.target;
  $('#result').hidden = false;
  $('#result').innerHTML = `Saved <b>${esc(name)}</b> · ${fmtBytes(blob.size)} ` +
    (pct > 0 ? `<span class="good">${pct}% smaller</span>` : pct < 0 ? `<span class="bad">${-pct}% larger</span>` : '') +
    (over ? `<br><span class="bad">Slightly over the target — try a smaller size or resolution.</span>` : '');
  toast(`Saved ${name} (${fmtBytes(blob.size)})`);
}

/* ---------- audio ---------- */
let mp3Ready = null;
function ensureMp3() {
  mp3Ready ??= (async () => {
    if (await MB.canEncodeAudio('mp3')) return;
    const { registerMp3Encoder } = await import('./lib/mediabunny-mp3-encoder.min.mjs');
    registerMp3Encoder();
  })();
  return mp3Ready;
}

function copyTarget(codec) {
  if (codec === 'aac') return [new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), 'm4a'];
  if (codec === 'mp3') return [new MB.Mp3OutputFormat(), 'mp3'];
  if (codec === 'opus' || codec === 'vorbis') return [new MB.OggOutputFormat(), 'ogg'];
  if (codec === 'flac') return [new MB.FlacOutputFormat(), 'flac'];
  if (codec?.startsWith('pcm')) return [new MB.WavOutputFormat(), 'wav'];
  return [new MB.MkvOutputFormat(), 'mka'];
}

async function extractAudio() {
  if (!st.file || st.busy) return;
  if (!st.info.hasAudio) { toast('This file has no audio track.', true); return; }
  const kind = $('#aFmt').value, bitrate = +$('#aRate').value;
  let format, ext, codec = null;
  if (kind === 'copy') [format, ext] = copyTarget(st.info.acodec);
  else if (kind === 'mp3') { await ensureMp3(); [format, ext, codec] = [new MB.Mp3OutputFormat(), 'mp3', 'mp3']; }
  else if (kind === 'm4a') [format, ext, codec] = [new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), 'm4a', 'aac'];
  else if (kind === 'ogg') [format, ext, codec] = [new MB.OggOutputFormat(), 'ogg', 'opus'];
  else [format, ext, codec] = [new MB.WavOutputFormat(), 'wav', 'pcm-s16'];
  if (codec && !codec.startsWith('pcm') && !(await MB.canEncodeAudio(codec, { numberOfChannels: Math.min(2, st.info.channels), sampleRate: st.info.sampleRate }))) {
    toast(`Your browser can’t encode ${codecName(codec)}. Try MP3, WAV or another format.`, true);
    return;
  }
  const aopts = codec ? { codec, forceTranscode: true } : {};
  if (codec && !codec.startsWith('pcm')) aopts.quality = new MB.Quality({ bitrate });
  if (codec && st.info.channels > 2) aopts.numberOfChannels = 2;
  const name = baseName() + '.' + ext;
  startJob('Extracting audio…', null);
  try {
    const buf = await convert({ format, video: { discard: true }, audio: aopts, onProgress: (f) => setJob(null, f) });
    save(new Blob([buf]), name);
    toast(`Saved ${name} (${fmtBytes(buf.byteLength)})`);
  } catch (err) {
    if (!(err instanceof MB.ConversionCanceledError)) { console.error(err); toast('Audio export failed: ' + (err.message || err), true); }
  } finally {
    endJob();
  }
}

/* ---------- subtitles: drawing ---------- */
const capOpts = () => ({ size: +$('#capSize').value, style: $('#capStyle').value, pos: $('#capPos').value });

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? cur + ' ' + word : word;
      if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = word; } else cur = t;
    }
    if (cur) out.push(cur);
  }
  return out;
}

// Shared by the live preview and the burn-in, so what you see is what gets exported.
function drawCaption(ctx, w, h, text, o) {
  const px = Math.max(8, Math.round(h * o.size / 100));
  ctx.save();
  ctx.font = `600 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, text, w * 0.88), lh = px * 1.3, margin = h * 0.06;
  let y = o.pos === 'top' ? margin + lh / 2 : h - margin - lh / 2 - (lines.length - 1) * lh;
  for (const line of lines) {
    if (o.style === 'box') {
      const tw = ctx.measureText(line).width, pad = px * 0.35;
      ctx.fillStyle = 'rgba(0, 0, 0, .72)';
      ctx.fillRect(w / 2 - tw / 2 - pad, y - lh / 2, tw + pad * 2, lh);
      ctx.fillStyle = '#fff';
    } else {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, px * 0.16);
      ctx.strokeStyle = '#000';
      ctx.strokeText(line, w / 2, y);
      ctx.fillStyle = o.style === 'yellow' ? '#ffd60a' : '#fff';
    }
    ctx.fillText(line, w / 2, y);
    y += lh;
  }
  ctx.restore();
}

const sortCues = () => st.cues.sort((a, b) => a.start - b.start);
const cueAt = (cues, t) => cues.find((c) => t >= c.start && t < c.end);

// Frame callback for burn-in. Sample timestamps are on the output timeline, which starts at the trim start.
function burner() {
  const cues = sortCues().filter((c) => c.text.trim()).map((c) => ({ ...c })), o = capOpts(), offset = st.start;
  let cv, ctx;
  return (sample) => {
    const w = sample.displayWidth, h = sample.displayHeight;
    if (!cv || cv.width !== w || cv.height !== h) { cv = new OffscreenCanvas(w, h); ctx = cv.getContext('2d'); }
    sample.draw(ctx, 0, 0, w, h);
    const cue = cueAt(cues, sample.timestamp + offset);
    if (cue) drawCaption(ctx, w, h, cue.text, o);
    return cv;
  };
}

function drawPreview() {
  const w = video.clientWidth, h = video.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (capView.width !== Math.round(w * dpr) || capView.height !== Math.round(h * dpr)) {
    capView.width = Math.round(w * dpr);
    capView.height = Math.round(h * dpr);
  }
  capView.style.cssText = `left:${video.offsetLeft}px;top:${video.offsetTop}px;width:${w}px;height:${h}px`;
  const ctx = capView.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cue = cueAt(st.cues, video.currentTime);
  if (cue && cue.text.trim()) drawCaption(ctx, w, h, cue.text, capOpts());
  const idx = st.cues.indexOf(cue);
  $$('#cues .cue').forEach((el, i) => el.classList.toggle('active', i === idx));
}

/* ---------- subtitles: list, import, export ---------- */
function renderCues() {
  sortCues();
  $('#cues').innerHTML = st.cues.map((c, i) => `
    <div class="cue" data-i="${i}">
      <div class="cue-times">
        <input value="${fmtT(c.start)}" data-f="start" aria-label="Start time" spellcheck="false">
        <span>→</span>
        <input value="${fmtT(c.end)}" data-f="end" aria-label="End time" spellcheck="false">
        <button class="cue-go" title="Jump to this line">Play</button>
      </div>
      <button class="rm" title="Delete line" aria-label="Delete line"><svg class="ic"><use href="#i-x"/></svg></button>
      <textarea rows="2" aria-label="Subtitle text">${esc(c.text)}</textarea>
    </div>`).join('');
  const has = st.cues.length > 0;
  $('#subExport').hidden = !has;
  $('#cuesLabel').hidden = !has;
  $('#cueCount').textContent = `${st.cues.length} subtitle line${st.cues.length === 1 ? '' : 's'} ready`;
  $('#burnBox').hidden = !has || !st.info?.hasVideo;
  $('#burn2Row').hidden = !has || !st.info?.hasVideo;
  $('#burn2').checked = $('#burn').checked;
  $('#cueMarks').innerHTML = st.info ? st.cues.map((c) =>
    `<i style="left:${c.start / st.info.duration * 100}%;width:${Math.max(0.2, (c.end - c.start) / st.info.duration * 100)}%"></i>`).join('') : '';
  drawPreview();
  update();
}

function parseSubs(txt) {
  const cues = [], t = (h, m, s, ms) => (+h || 0) * 3600 + +m * 60 + +s + +ms.padEnd(3, '0') / 1000;
  const re = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})[^\n]*\n([\s\S]*?)(?=\n[ \t]*\n|$)/g;
  for (const m of txt.replace(/\r\n?/g, '\n').matchAll(re)) {
    const text = m[9].replace(/<[^>]+>|\{\\[^}]*\}/g, '').trim();
    if (text) cues.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text });
  }
  return cues;
}

// Exported files are timed to the trimmed clip, so they line up with an exported video.
function subsText(kind) {
  const stamp = (t, sep) => {
    const ms = Math.round(Math.max(0, t) * 1000), p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
  };
  const cues = sortCues().filter((c) => c.text.trim() && c.end > st.start && c.start < st.end)
    .map((c) => ({ start: Math.max(c.start, st.start) - st.start, end: Math.min(c.end, st.end) - st.start, text: c.text.trim() }));
  if (kind === 'txt') return cues.map((c) => c.text).join('\n') + '\n';
  if (kind === 'vtt') return 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}`).join('\n\n') + '\n';
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}`).join('\n\n') + '\n';
}

async function importSubs(file) {
  if (!file || !st.info) return;
  const cues = parseSubs(await file.text());
  if (!cues.length) { toast('No subtitles found in that file.', true); return; }
  st.cues = cues;
  $('#subsBox').open = true;
  renderCues();
  toast(`Imported ${cues.length} subtitle lines.`);
}

/* ---------- subtitles: Whisper ---------- */
function parseWav(buf) {
  const dv = new DataView(buf);
  for (let off = 12; off + 8 <= buf.byteLength;) {
    const id = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') return new Float32Array(buf.slice(off + 8, off + 8 + Math.min(size, buf.byteLength - off - 8) & ~3));
    off += 8 + size + (size & 1);
  }
  throw new Error('No audio data');
}

async function transcribe() {
  if (!st.file || st.busy) return;
  if (!st.info.hasAudio) { toast('This file has no audio to transcribe.', true); return; }
  if (st.cues.length && !confirm('Replace the current subtitles with new ones?')) return;
  let canceled = false;
  startJob('Preparing audio…', null);
  try {
    const buf = await convert({
      format: new MB.WavOutputFormat(), video: { discard: true }, tags: {},
      audio: { codec: 'pcm-f32', sampleRate: 16000, numberOfChannels: 1, forceTranscode: true },
      onProgress: (f) => setJob(null, f),
    });
    const audio = parseWav(buf);
    st.cues = [];
    renderCues();
    $('#subsBox').open = true;

    st.worker ??= new Worker(new URL('whisper-worker.js', import.meta.url), { type: 'module' });
    const w = st.worker, files = new Map(), done = Promise.withResolvers();
    st.cancel = () => { canceled = true; w.terminate(); st.worker = null; done.resolve(); };
    setJob('Loading speech model…', null);
    w.onmessage = ({ data: m }) => {
      if (m.type === 'download') {
        files.set(m.file, m);
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        setJob('Downloading speech model (first time only)…', loaded / total, `${fmtBytes(loaded)} of ${fmtBytes(total)}`);
      } else if (m.type === 'ready') {
        st.jobT0 = performance.now();
        setJob(`Transcribing${m.device === 'webgpu' ? ' (GPU)' : ''}…`, 0);
      } else if (m.type === 'cues') {
        st.cues.push(...m.cues);
        renderCues();
        setJob(null, m.done / m.total);
      } else if (m.type === 'done') done.resolve();
      else if (m.type === 'error') done.reject(new Error(m.message));
    };
    w.onerror = (e) => done.reject(new Error(e.message || 'The speech model could not start. Check your connection — it is downloaded once.'));
    w.postMessage({ cmd: 'transcribe', audio, model: $('#model').value, language: $('#lang').value, task: $('#task').value, offset: st.start }, [audio.buffer]);
    await done.promise;
    if (!canceled && st.cues.length) $('#subExport').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!canceled) toast(st.cues.length ? `Created ${st.cues.length} subtitle lines — download them or add them to your video.` : 'No speech was found.', !st.cues.length);
  } catch (err) {
    if (!(err instanceof MB.ConversionCanceledError)) {
      console.error(err);
      toast('Transcription failed: ' + (err.message || err), true);
      st.worker?.terminate();
      st.worker = null;
    }
  } finally {
    endJob();
  }
}

/* ---------- trim timeline ---------- */
function updateTrim() {
  if (!st.info) return;
  const D = st.info.duration, pc = (t) => (t / D * 100) + '%';
  $('#sel').style.left = pc(st.start);
  $('#sel').style.width = pc(st.end - st.start);
  $('#hStart').style.left = pc(st.start);
  $('#hEnd').style.left = pc(st.end);
  $('#playhead').style.left = pc(Math.min(D, video.currentTime || 0));
  $('#tStart').textContent = fmtT(st.start);
  $('#tEnd').textContent = fmtT(st.end);
  $('#clipLen').textContent = clipDur() < D - 0.05 ? `Clip ${fmtT(clipDur())}` : `Full ${fmtT(D)}`;
  $('#hStart').setAttribute('aria-valuetext', fmtT(st.start));
  $('#hEnd').setAttribute('aria-valuetext', fmtT(st.end));
}

function setTrim(which, t) {
  const D = st.info.duration, min = Math.min(0.1, D);
  if (which === 'start') st.start = Math.max(0, Math.min(t, st.end - min));
  else st.end = Math.min(D, Math.max(t, st.start + min));
  updateTrim();
  update();
}

function seek(t) {
  if (!Number.isFinite(t)) return;
  try { video.currentTime = Math.max(0, Math.min(st.info.duration, t)); } catch {}
  updateTrim();
}

function bindTrack() {
  const track = $('#track');
  const timeAt = (e) => {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * st.info.duration;
  };
  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    if (!st.info || st.busy) return;
    drag = e.target.dataset.h || 'seek';
    track.setPointerCapture(e.pointerId);
    const t = timeAt(e);
    if (drag === 'seek') seek(t); else { setTrim(drag, t); seek(drag === 'start' ? st.start : st.end); }
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = timeAt(e);
    if (drag === 'seek') seek(t); else { setTrim(drag, t); seek(drag === 'start' ? st.start : st.end); }
  });
  const stop = () => { drag = null; };
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);
  for (const h of [$('#hStart'), $('#hEnd')]) {
    h.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 1 : 0.1, which = h.dataset.h, cur = which === 'start' ? st.start : st.end;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setTrim(which, cur - step);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setTrim(which, cur + step);
      else return;
      seek(which === 'start' ? st.start : st.end);
      e.preventDefault();
    });
  }
}

/* ---------- wiring ---------- */
function bindUI() {
  const open = () => !st.busy && $('#file').click();
  $('#btnOpen').onclick = open;
  $('#btnOpen2').onclick = open;
  $('#file').onchange = (e) => { openFile(e.target.files[0]); e.target.value = ''; };
  $('#btnExport').onclick = exportVideo;
  $('#btnExport2').onclick = exportVideo;
  $('#jobCancel').onclick = () => st.cancel?.();
  $('#btnAudio').onclick = extractAudio;
  $('#btnTranscribe').onclick = transcribe;

  $$('[data-cmp]').forEach((b) => b.onclick = () => { st.cmp = b.dataset.cmp; update(); });
  $('#sizeChips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b || !st.info) return;
    $('#targetMB').value = b.dataset.half ? +(st.info.size / 2 / 1024 ** 2 * clipDur() / st.info.duration).toFixed(1) : b.dataset.mb;
    update();
  };
  for (const id of ['#quality', '#targetMB', '#fps', '#mute', '#fit', '#capSize', '#capStyle', '#capPos', '#burn']) $(id).addEventListener('input', () => { update(); drawPreview(); });
  $('#burn2').addEventListener('input', () => { $('#burn').checked = $('#burn2').checked; update(); drawPreview(); });
  $('#burn').addEventListener('input', () => { $('#burn2').checked = $('#burn').checked; });
  $('#capSize').addEventListener('input', () => { $('#capSizeV').textContent = $('#capSize').value + '%'; });
  $('#res').onchange = async () => { update(); await fillCodecs(); update(); };
  $('#rotate').onchange = async () => { fillRes(); await fillCodecs(); update(); };
  $('#fmt').onchange = async () => { await fillCodecs(); update(); };
  $('#vcodec').onchange = update;
  const custom = (src) => {
    const [w, h] = srcDims();
    if ($('#cLock').checked) {
      if (src === 'w') $('#ch').value = even(+$('#cw').value * h / w);
      else $('#cw').value = even(+$('#ch').value * w / h);
    }
    update();
  };
  $('#cw').oninput = () => custom('w');
  $('#ch').oninput = () => custom('h');
  $('#aFmt').onchange = () => { $('#aRateWrap').hidden = ['copy', 'wav'].includes($('#aFmt').value); };
  $('#aFmt').onchange();

  // trim
  bindTrack();
  $('#setStart').onclick = () => setTrim('start', video.currentTime);
  $('#setEnd').onclick = () => setTrim('end', video.currentTime);
  $('#trimReset').onclick = () => { st.start = 0; st.end = st.info.duration; updateTrim(); update(); };
  let clipPlay = false;
  $('#playClip').onclick = () => { clipPlay = true; seek(st.start); video.play().catch(() => {}); };
  video.addEventListener('pause', () => { clipPlay = false; });
  const tick = () => {
    if (clipPlay && video.currentTime >= st.end) { video.pause(); seek(st.end); }
    updateTrim();
    drawPreview();
  };
  video.addEventListener('timeupdate', tick);
  video.addEventListener('seeked', tick);
  video.addEventListener('loadedmetadata', tick);
  let rvfc = false; // keep exactly one frame callback chain alive while playing
  const frameLoop = () => {
    rvfc = false;
    tick();
    if (!video.paused) { rvfc = true; video.requestVideoFrameCallback(frameLoop); }
  };
  video.addEventListener('play', () => {
    if ('requestVideoFrameCallback' in video && !rvfc) { rvfc = true; video.requestVideoFrameCallback(frameLoop); }
  });
  video.addEventListener('error', () => {
    if (!st.file) return;
    $('#noPreview').hidden = false;
    const { width: w = 16, height: h = 9 } = st.info;
    video.style.cssText = `width:min(720px,100%);aspect-ratio:${w}/${h}`;
  });
  video.addEventListener('loadeddata', () => { video.style.cssText = ''; $('#noPreview').hidden = true; });
  new ResizeObserver(drawPreview).observe(video);

  // subtitle list
  $('#cues').addEventListener('input', (e) => {
    const row = e.target.closest('.cue');
    if (row && e.target.tagName === 'TEXTAREA') { st.cues[+row.dataset.i].text = e.target.value; drawPreview(); }
  });
  $('#cues').addEventListener('change', (e) => {
    const row = e.target.closest('.cue'), f = e.target.dataset.f;
    if (!row || !f) return;
    const c = st.cues[+row.dataset.i], t = parseT(e.target.value);
    if (t == null) { e.target.value = fmtT(c[f]); return; }
    c[f] = Math.max(0, Math.min(st.info.duration, t));
    if (c.end <= c.start) c.end = c.start + 0.5;
    renderCues();
  });
  $('#cues').addEventListener('click', (e) => {
    const row = e.target.closest('.cue');
    if (!row) return;
    const i = +row.dataset.i;
    if (e.target.closest('.rm')) { st.cues.splice(i, 1); renderCues(); }
    else if (e.target.closest('.cue-go')) { seek(st.cues[i].start + 0.01); video.play().catch(() => {}); }
  });
  $('#btnAddCue').onclick = () => {
    if (!st.info) return;
    const t = video.currentTime || 0, next = sortCues().find((c) => c.start > t);
    const cue = { start: t, end: Math.min(st.info.duration, next ? Math.min(next.start, t + 2.5) : t + 2.5), text: '' };
    st.cues.push(cue);
    renderCues();
    const row = $(`#cues .cue[data-i="${st.cues.indexOf(cue)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector('textarea').focus();
  };
  $('#btnImportSubs').onclick = () => $('#subFile').click();
  $('#subFile').onchange = (e) => { importSubs(e.target.files[0]); e.target.value = ''; };
  $('#subExport').onclick = (e) => {
    const kind = e.target.closest('[data-sub]')?.dataset.sub;
    if (!kind) return;
    const mime = kind === 'vtt' ? 'text/vtt' : 'text/plain';
    save(new Blob([subsText(kind)], { type: mime + ';charset=utf-8' }), `${baseName()}.${kind}`);
  };
  $('#btnClearCues').onclick = () => { if (confirm('Remove all subtitle lines?')) { st.cues = []; renderCues(); } };

  // drag & drop, shortcuts
  let depth = 0;
  addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dragging'); } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    const f = [...(e.dataTransfer?.files || [])];
    const sub = f.find((x) => /\.(srt|vtt)$/i.test(x.name)), media = f.find((x) => x !== sub);
    if (media) openFile(media);
    else if (sub) importSubs(sub);
  });
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); open(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); exportVideo(); }
    else if (!typing && st.info && e.key === '[') setTrim('start', video.currentTime);
    else if (!typing && st.info && e.key === ']') setTrim('end', video.currentTime);
  });
  addEventListener('beforeunload', (e) => { if (st.busy) { e.preventDefault(); e.returnValue = ''; } });
}

bindUI();
fillCodecs();
