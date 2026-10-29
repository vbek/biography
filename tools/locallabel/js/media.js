// Local media access: folder scanning, image decoding, video frame seeking.
import { S } from './store.js';
import { isTiff, decodeTiff, tiffInfo } from './tiff.js';

export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif', 'tif', 'tiff'];

// Decode any supported still image to an ImageBitmap.
async function decodeImage(file, path) {
  if (isTiff(path)) return (await decodeTiff(file)).bitmap;
  return await createImageBitmap(file);
}
export const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'];
const SKIP_DIRS = new Set(['.locallabel', 'node_modules', '.git', '__MACOSX']);

export const ext = p => p.split('.').pop().toLowerCase();
export const kindOf = p => IMAGE_EXT.includes(ext(p)) ? 'image' : VIDEO_EXT.includes(ext(p)) ? 'video' : null;
export const stem = p => p.split('/').pop().replace(/\.[^.]+$/, '');
export const basename = p => p.split('/').pop();

// Recursively list media files under a directory handle -> [{path, handle}]
export async function scanDirectory(dir, prefix = '') {
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith('.') && handle.kind === 'directory') continue;
    if (handle.kind === 'directory') {
      if (SKIP_DIRS.has(name)) continue;
      out.push(...await scanDirectory(handle, prefix + name + '/'));
    } else if (kindOf(name)) {
      out.push({ path: prefix + name, handle });
    }
  }
  return out;
}

export function sortPaths(items) {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return items.sort((a, b) => coll.compare(a.path, b.path));
}

export async function getFile(path) {
  const src = S.sources.get(path);
  if (!src) throw new Error('File not available: ' + path);
  return src instanceof File ? src : await src.getFile();
}

// images
const bitmapCache = new Map(); // path -> ImageBitmap (small LRU)
export async function loadBitmap(path) {
  if (bitmapCache.has(path)) {
    const b = bitmapCache.get(path);
    bitmapCache.delete(path); bitmapCache.set(path, b);
    return b;
  }
  const file = await getFile(path);
  const bmp = await decodeImage(file, path);
  bitmapCache.set(path, bmp);
  while (bitmapCache.size > 6) {
    const [k, v] = bitmapCache.entries().next().value;
    v.close?.(); bitmapCache.delete(k);
  }
  return bmp;
}

// video
let video = null, videoPath = null, videoUrl = null;

export function currentVideo() { return video; }

export async function openVideo(m) {
  if (video && videoPath === m.id) return video;
  closeVideo();
  const file = await getFile(m.id);
  videoUrl = URL.createObjectURL(file);
  video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = videoUrl;
  videoPath = m.id;
  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error('This video format cannot be decoded by Chrome: ' + m.id));
  });
  m.width = video.videoWidth;
  m.height = video.videoHeight;
  m.duration = video.duration;
  if (!m.fps) m.fps = await estimateFps(video);
  m.frames = Math.max(1, Math.floor(m.duration * m.fps + 1e-6));
  await seekFrame(m, 0);
  return video;
}

export function closeVideo() {
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  video = null; videoPath = null; videoUrl = null;
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
async function estimateFps(v) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return 25;
  const times = [];
  const done = new Promise(resolve => {
    const timer = setTimeout(resolve, 1500);
    const cb = (_, meta) => {
      times.push(meta.mediaTime);
      if (times.length >= 12) { clearTimeout(timer); resolve(); } else v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  });
  try { await v.play(); } catch { return 25; }
  await done;
  v.pause();
  v.currentTime = 0;
  const diffs = [];
  for (let i = 1; i < times.length; i++) { const d = times[i] - times[i - 1]; if (d > 0.001) diffs.push(d); }
  if (diffs.length < 3) return 25;
  diffs.sort((a, b) => a - b);
  const fps = 1 / diffs[Math.floor(diffs.length / 2)];
  return COMMON_FPS.reduce((best, f) => Math.abs(f - fps) < Math.abs(best - fps) ? f : best, 25);
}

export function seekFrame(m, frame) {
  return new Promise(resolve => {
    if (!video) return resolve();
    const t = Math.min(m.duration - 0.0005, (frame + 0.5) / m.fps);
    if (Math.abs(video.currentTime - t) < 1e-4) return resolve();
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.max(0, t);
  });
}

export function frameFromTime(m, t) {
  return Math.max(0, Math.min(m.frames - 1, Math.floor(t * m.fps + 1e-3)));
}

// Get native-size dimensions for any media item (used by exporters).
export async function ensureDims(m) {
  if (m.width && m.height && (m.kind === 'image' || m.frames)) return m;
  if (m.kind === 'image') {
    const file = await getFile(m.id);
    if (isTiff(m.id)) {
      const info = await tiffInfo(file); // header only, no full decode
      m.width = info.width; m.height = info.height;
    } else {
      const b = await createImageBitmap(file);
      m.width = b.width; m.height = b.height; b.close?.();
    }
  } else {
    // openVideo measures the real frame rate; guessing here would store a wrong fps in the project
    await openVideo(m);
  }
  return m;
}

// Render a frame of any media item into a canvas (used by AI + frame export).
export async function frameCanvas(m, frame) {
  await ensureDims(m);
  const c = new OffscreenCanvas(m.width, m.height);
  const ctx = c.getContext('2d');
  if (m.kind === 'image') {
    ctx.drawImage(await loadBitmap(m.id), 0, 0);
  } else {
    await openVideo(m);
    await seekFrame(m, frame);
    ctx.drawImage(video, 0, 0, m.width, m.height);
  }
  return c;
}
