// Pyodide runs here, off the main thread, so the canvas stays at 60fps while Python loads or runs.
/* global loadPyodide */
importScripts('../vendor/pyodide/pyodide.js');

const INDEX = new URL('../vendor/pyodide/', self.location.href).href;
let py = null;
let out = [];

const HARNESS = `
import json, math, traceback
import numpy as np

def _jsonable(v):
    if isinstance(v, np.ndarray):
        return _jsonable(v.tolist())
    if isinstance(v, (np.floating,)):
        v = float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, (int, str, bool)) or v is None:
        return v
    return str(v)

def _run(code, data_json):
    ns = {"__name__": "__main__"}
    for k, v in json.loads(data_json).items():
        ns[k] = np.array(v) if isinstance(v, list) else v
    import linecache
    linecache.cache["lesson.py"] = (len(code), None, code.splitlines(True), "lesson.py")
    try:
        exec(compile(code, "lesson.py", "exec"), ns)
    except BaseException as e:
        tb = traceback.extract_tb(e.__traceback__)
        frames = [f for f in tb if f.filename == "lesson.py"]
        lines = ["Traceback (most recent call last):"]
        for f in frames:
            lines.append(f'  line {f.lineno}: {(f.line or "").strip()}')
        lines.append(f"{type(e).__name__}: {e}")
        return json.dumps({"__error__": "\\n".join(lines), "__line__": frames[-1].lineno if frames else None})
    return json.dumps({"result": _jsonable(ns.get("result"))})
`;

async function init() {
    try {
        post({ type: 'status', stage: 'Loading Python runtime', pct: 8 });
        py = await loadPyodide({
            indexURL: INDEX,
            stdout: (s) => out.push(s),
            stderr: (s) => out.push(s),
        });
        post({ type: 'status', stage: 'Loading numpy & scikit-learn', pct: 45 });
        let n = 0;
        await py.loadPackage(['numpy', 'scikit-learn'], {
            messageCallback: () => { n++; post({ type: 'status', stage: 'Loading numpy & scikit-learn', pct: Math.min(92, 45 + n * 7) }); },
            errorCallback: (m) => out.push(m),
        });
        post({ type: 'status', stage: 'Warming up', pct: 95 });
        await py.runPythonAsync(HARNESS + '\nimport sklearn.linear_model, sklearn.neighbors, sklearn.tree, sklearn.cluster, sklearn.svm, sklearn.decomposition, sklearn.neural_network, sklearn.preprocessing\n');
        out = [];
        post({ type: 'ready' });
    } catch (e) {
        post({ type: 'error', message: String(e && e.message || e) });
    }
}

function post(m) { self.postMessage(m); }

self.onmessage = async (ev) => {
    const m = ev.data;
    if (m.type !== 'run') return;
    out = [];
    const t0 = performance.now();
    try {
        const run = py.globals.get('_run');
        const json = run(m.code, JSON.stringify(m.data || {}));
        run.destroy();
        const res = JSON.parse(json);
        post({ type: 'result', id: m.id, stdout: out.join('\n'), result: res.result, error: res.__error__ || null, line: res.__line__ || null, ms: performance.now() - t0 });
    } catch (e) {
        post({ type: 'result', id: m.id, stdout: out.join('\n'), error: String(e && e.message || e), ms: performance.now() - t0 });
    }
};

init();
