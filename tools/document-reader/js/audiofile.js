/* Document Reader — writes generated speech to an audio file, a sentence at a time, so memory stays low on long documents.
   Compressed files use the browser's own encoders through Mediabunny, which is shared with Media Studio. */
const MB_URL = new URL('../../media-studio/lib/mediabunny.min.mjs', import.meta.url).href;
const SAMPLE_RATE = 48000;
// Windows' AAC encoder refuses anything below 96 kbps. Opus is for browsers with no AAC encoder at all.
export const FORMATS = {
  m4a: { codec: 'aac', bitrate: 96000, type: 'audio/mp4', label: 'M4A: small, plays on phones and computers', make: (MB) => new MB.Mp4OutputFormat({ fastStart: 'in-memory' }) },
  ogg: { codec: 'opus', bitrate: 64000, type: 'audio/ogg', label: 'Ogg Opus: small, plays in most apps', make: (MB) => new MB.OggOutputFormat() },
};
export async function compressedFormat() {
  try {
    const MB = await import(MB_URL);
    for (const [key, f] of Object.entries(FORMATS)) {
      if (await MB.canEncodeAudio(f.codec, { numberOfChannels: 1, sampleRate: SAMPLE_RATE, bitrate: f.bitrate })) return key;
    }
  } catch { /* WAV needs no library */ }
  return null;
}

// Encoders only accept common sample rates, and the voices each use their own.
async function resample(samples, from, to) {
  if (from === to) return samples;
  const offline = new OfflineAudioContext(1, Math.ceil((samples.length * to) / from), to);
  const buffer = offline.createBuffer(1, samples.length, from);
  buffer.copyToChannel(samples, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return (await offline.startRendering()).getChannelData(0);
}

async function compressedWriter(key, title) {
  const MB = await import(MB_URL), f = FORMATS[key];
  const output = new MB.Output({ format: f.make(MB), target: new MB.BufferTarget() });
  const source = new MB.AudioSampleSource({ codec: f.codec, bitrate: f.bitrate });
  output.addAudioTrack(source);
  output.setMetadataTags({ title, comment: 'Machine-generated speech' });
  await output.start();
  let seconds = 0;
  return {
    ext: key,
    async add(samples, rate) {
      const data = await resample(samples, rate, SAMPLE_RATE);
      const sample = new MB.AudioSample({ data, format: 'f32', numberOfChannels: 1, sampleRate: SAMPLE_RATE, timestamp: seconds });
      await source.add(sample);
      sample.close();
      seconds += data.length / SAMPLE_RATE;
    },
    async finish() {
      source.close();
      await output.finalize();
      return { blob: new Blob([output.target.buffer], { type: f.type }), seconds };
    },
    async cancel() { await output.cancel().catch(() => {}); },
  };
}

function wavWriter() {
  const parts = [];
  let count = 0, sampleRate = 24000;
  return {
    ext: 'wav',
    async add(samples, rate) {
      sampleRate = rate;
      const pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 32767;
      parts.push(pcm);
      count += pcm.length;
    },
    async finish() {
      const v = new DataView(new ArrayBuffer(44));
      const text = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
      text(0, 'RIFF'); v.setUint32(4, 36 + count * 2, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true);
      v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, count * 2, true);
      return { blob: new Blob([v.buffer, ...parts], { type: 'audio/wav' }), seconds: count / sampleRate };
    },
    async cancel() { parts.length = 0; },
  };
}
export const openWriter = (format, title) => (FORMATS[format] ? compressedWriter(format, title) : wavWriter());
