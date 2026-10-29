// AI inference worker: a generic ONNX runner. Pre- and post-processing happen on the main thread (js/ai.js).
// ONNX Runtime Web is bundled in /vendor; nothing is fetched from the network.
import * as ort from '../vendor/ort.webgpu.bundle.min.mjs';

ort.env.wasm.wasmPaths = new URL('../vendor/', import.meta.url).href;
ort.env.wasm.numThreads = 1; // static hosting (GitHub Pages) is not cross-origin isolated
ort.env.logLevel = 'error';

let session = null;
let backend = 'wasm';

function meta(list, names) {
  return names.map((name, i) => {
    const m = Array.isArray(list) ? list[i] : list?.[name];
    return { name, type: m?.type || 'float32', shape: m?.shape || m?.dimensions || null };
  });
}

// The main thread gives each model its own worker and retries a failed WebGPU load on WASM in a fresh one:
// retrying here could hit a runtime left broken by the first attempt.
async function load(buffer, preferGPU) {
  const providers = preferGPU && self.navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
  session = await ort.InferenceSession.create(new Uint8Array(buffer), { executionProviders: providers, graphOptimizationLevel: 'all' });
  backend = providers[0];
  return {
    backend,
    inputs: meta(session.inputMetadata, session.inputNames),
    outputs: meta(session.outputMetadata, session.outputNames),
  };
}

function f16(h) { // IEEE half -> float
  const s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1F) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

// Normalise any output tensor to a transferable Float32Array.
function toF32(t) {
  const d = t.data;
  if (d instanceof Float32Array) return d.slice(); // own buffer, safe to transfer
  if (t.type === 'float16' && (d instanceof Uint16Array)) return Float32Array.from(d, f16);
  if (d instanceof BigInt64Array || d instanceof BigUint64Array) return Float32Array.from(d, Number);
  return Float32Array.from(d);
}

async function run({ data, dims, type }) {
  const inName = session.inputNames[0];
  const t0 = performance.now();
  const out = await session.run({ [inName]: new ort.Tensor(type, data, dims) });
  const ms = performance.now() - t0;
  const outputs = session.outputNames.map(name => {
    const t = out[name];
    return { name, dims: [...t.dims], type: t.type, data: toF32(t) };
  });
  return { outputs, ms, backend };
}

self.onmessage = async (e) => {
  const { id, cmd } = e.data;
  try {
    let result, transfer = [];
    if (cmd === 'load') result = await load(e.data.buffer, e.data.preferGPU);
    else if (cmd === 'run') {
      result = await run(e.data);
      transfer = result.outputs.map(o => o.data.buffer);
    } else throw new Error('Unknown command');
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
