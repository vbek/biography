/* AR Survival — tracking worker; the page starts one for faces and one for hands. Frames arrive as ImageBitmaps
   and never leave this device; the only network use is the one-time download of the AI files below, which are
   kept in the Cache API. */
'use strict';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/';
const MODELS = 'https://storage.googleapis.com/mediapipe-models/';
const CACHE_NAME = 'ar-survival-ai-v1';
const ASSETS = {
  bundle: { url: MP + 'vision_bundle.cjs', size: 137025, type: 'text/javascript', sha: '52b84244bb64fd460faf89e0fa24711bafd32cfd26e830e574d0fc67bdad7ab7' },
  loader: { url: MP + 'wasm/vision_wasm_internal.js', size: 209826, type: 'text/javascript', sha: '9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c' },
  wasm: { url: MP + 'wasm/vision_wasm_internal.wasm', size: 9423986, type: 'application/wasm', sha: 'f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc' },
  loaderNoSimd: { url: MP + 'wasm/vision_wasm_nosimd_internal.js', size: 209735, type: 'text/javascript', sha: 'abe9b6fbeaf86fcb53a5edce3926c82ccb0619e18fed4d9d9ce561ee7f55e054' },
  wasmNoSimd: { url: MP + 'wasm/vision_wasm_nosimd_internal.wasm', size: 9294247, type: 'application/wasm', sha: '38b61feab2fd7934e05cbe9f68baa308978a5e3b7f85c1913bb8ae89b8ef8b97' },
  face: { url: MODELS + 'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite', size: 229746, type: 'application/octet-stream', sha: 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f' },
  hand: { url: MODELS + 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', size: 7819105, type: 'application/octet-stream', sha: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1' },
};
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const SLOW_GPU_MS = 50; // once warm, a GPU slower than this has to beat the CPU path to be used

// one worker runs one model, so a slow hand inference can never hold up face tracking
let role = 'face', task = null, vision = null, fileset = null, delegate = 'CPU';
let cache = null, loaded = {}, total = 0, networkBytes = 0;

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

function report() {
  let done = 0;
  for (const k in loaded) done += loaded[k];
  postMessage({ type: 'progress', role, done, total, networkBytes });
}

/* Cache-first fetch. A file is stored only after its hash matches, so a broken download is never kept. */
async function getAsset(key) {
  const a = ASSETS[key];
  if (cache) {
    const hit = await cache.match(a.url);
    if (hit) {
      const blob = await hit.blob();
      if (blob.size === a.size) {
        loaded[key] = a.size;
        report();
        return new Blob([blob], { type: a.type });
      }
      await cache.delete(a.url);
    }
  }
  const res = await fetch(a.url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error('Download failed (' + res.status + ')');
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    networkBytes += value.length;
    loaded[key] = Math.min(got, a.size);
    report();
  }
  const blob = new Blob(chunks, { type: a.type });
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  if (hex(digest) !== a.sha) throw new Error('Downloaded AI file failed its integrity check');
  loaded[key] = a.size;
  report();
  if (cache) {
    try { await cache.put(a.url, new Response(blob, { headers: { 'Content-Type': a.type } })); } catch {}
  }
  return blob;
}

const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

const createHandTask = (buffer, d) => vision.HandLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetBuffer: buffer, delegate: d },
  runningMode: 'VIDEO', numHands: 2,
  minHandDetectionConfidence: 0.45, minHandPresenceConfidence: 0.45, minTrackingConfidence: 0.45,
});

/* The first GPU inference compiles shaders and can block for seconds, so it happens here rather than mid-game.
   Returns the time of a normal inference once warm. */
function warmUp(hands) {
  const c = new OffscreenCanvas(256, 192), ctx = c.getContext('2d');
  ctx.fillStyle = '#777';
  ctx.fillRect(0, 0, 256, 192);
  let ms = 0;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    hands.detectForVideo(c, t);
    ms = performance.now() - t;
  }
  return ms;
}

async function chooseHandTask(buffer) {
  let gpu = null, gpuMs = Infinity;
  try {
    gpu = await createHandTask(buffer, 'GPU');
    gpuMs = warmUp(gpu);
  } catch {
    gpu = null;
  }
  if (gpu && gpuMs <= SLOW_GPU_MS) {
    delegate = 'GPU';
    return gpu;
  }
  const cpu = await createHandTask(buffer, 'CPU');
  const cpuMs = warmUp(cpu);
  const useGpu = gpu && gpuMs <= cpuMs;
  try { (useGpu ? cpu : gpu)?.close(); } catch {}
  delegate = useGpu ? 'GPU' : 'CPU';
  return useGpu ? gpu : cpu;
}

async function init(which, withHands) {
  role = which;
  try { cache = await caches.open(CACHE_NAME); } catch { cache = null; }
  const simd = WebAssembly.validate(SIMD_PROBE);
  const keys = ['bundle', simd ? 'loader' : 'loaderNoSimd', simd ? 'wasm' : 'wasmNoSimd', 'face'];
  const coreSize = keys.reduce((sum, k) => sum + ASSETS[k].size, 0);
  total = coreSize + (withHands ? ASSETS.hand.size : 0);

  // the hand worker starts after the face worker has stored the shared files, so nothing is fetched twice
  const [bundle, loader, wasm, face] = await Promise.all((role === 'face' ? keys : keys.slice(0, 3)).map(getAsset));
  if (role === 'hand') loaded = { core: coreSize };

  // the CommonJS build is what can run in a classic worker, where MediaPipe's importScripts() call is allowed
  self.exports = {};
  self.module = { exports: self.exports };
  importScripts(URL.createObjectURL(bundle));
  vision = self.module.exports;
  fileset = { wasmLoaderPath: URL.createObjectURL(loader), wasmBinaryPath: URL.createObjectURL(wasm) };

  if (role === 'face') {
    task = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: await bytes(face), delegate: 'CPU' },
      runningMode: 'VIDEO', minDetectionConfidence: 0.5,
    });
  } else {
    task = await chooseHandTask(await bytes(await getAsset('hand')));
  }
  postMessage({ type: 'ready', role, delegate, networkBytes });
}

function detectFace(bitmap, now) {
  const dets = task.detectForVideo(bitmap, now).detections;
  if (!dets.length) return null;
  let best = dets[0];
  for (const d of dets) if (d.boundingBox.width > best.boundingBox.width) best = d;
  const b = best.boundingBox;
  return [(b.originX + b.width / 2) / bitmap.width, (b.originY + b.height / 2) / bitmap.height, b.width / bitmap.width, b.height / bitmap.height];
}

function detectHands(bitmap, now) {
  const out = [];
  for (const hand of task.detectForVideo(bitmap, now).landmarks) {
    const pts = new Float32Array(42);
    hand.forEach((p, i) => { pts[i * 2] = p.x; pts[i * 2 + 1] = p.y; });
    out.push(pts);
  }
  return out;
}

function onFrame(bitmap) {
  const t0 = performance.now(), msg = { type: 'result', role }, transfer = [];
  try {
    if (role === 'face') msg.face = detectFace(bitmap, t0);
    else {
      msg.hands = detectHands(bitmap, t0);
      msg.hands.forEach((h) => transfer.push(h.buffer));
    }
  } catch (err) {
    msg.error = String(err && err.message || err);
  }
  bitmap.close();
  msg.ms = performance.now() - t0;
  postMessage(msg, transfer);
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') init(m.role, m.withHands).catch((err) => postMessage({ type: 'error', role, message: String(err && err.message || err) }));
  else if (m.type === 'frame') onFrame(m.bitmap);
};
