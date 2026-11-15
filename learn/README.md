# Learn hub

Interactive lessons at `/learn/`. Static and browser-only like the rest of the site: nothing is uploaded, progress is kept in `localStorage` (`learn.v1`), and every library is vendored under `vendor/`.

## Layout

```
learn/
  index.html            page shell (strict CSP, no inline scripts)
  css/learn.css         theme tokens mirror ../styles.css
  js/app.js             router, curriculum drawer, workbench, controls ↔ code sync, challenges, playback
  js/registry.js        SUBJECTS → levels → lessons (add tracks here)
  js/py-worker.js       Pyodide in a Web Worker
  js/core/              plot2d (canvas), scene3d (three.js), data, math, python bridge
  js/lessons/*.js       one module per lesson
  vendor/               pyodide 0.27.7 (+ numpy, scipy, scikit-learn wheels), three r170 + OrbitControls,
                        CodeMirror 5.65 (python mode), KaTeX 0.16.11 (woff2 fonts only)
```

## Adding a track

Append an entry to `SUBJECTS` in `js/registry.js` with `status: 'live'`, its `levels`, and its `lessons`. Each lesson entry points at a module with `load: () => import('./lessons/<id>.js')`. Tracks marked `status: 'soon'` show in the switcher with a SOON tag.

## Writing a lesson

A lesson module default-exports a definition:

| field | purpose |
| --- | --- |
| `views` | `[{ id: '2d' \| '3d' \| 'split', label }]` — the stage panes it uses |
| `datasets`, `defaultDataset` | preset buttons on the stage |
| `params` | sliders/chips. `py: 'name'` links a control to a `name = value` line in the script (two-way) |
| `presets`, `actions`, `legend`, `how`, `hint` | panel and stage extras |
| `playback: { sps }` | shows Step / Play / Reset / Speed; `sps` = steps per second at 1× |
| `challenges` | `{ id, title, hint, check(state, params) }`, checked after the visitor first interacts |
| `code` | the Python script. The canvas data arrives as globals (`X`, `y`, …); set `result = {...}` to send values back |
| `explain` | HTML; `.eq` blocks and `.tx` spans are rendered with KaTeX |
| `random`, `spread` | set to `false` to hide the dice / Spread slider (both shown by default when there are datasets) |
| `create(ctx)` | returns the instance: `frame`, `setParam`, `setDataset`, `setView`, `step`, `reset`, `metrics`, `state`, `pyData`, `onPython`, `clearPython`, `destroy` |

## Guided tours

`js/lessons/tours.js` holds a beginner walkthrough per lesson. It opens automatically the first time a lesson is visited and can be replayed with the Guided tour button. Each step can hide layers that the lesson checks with `ctx.hidden('model')` (revealed later), show parts of the stage UI (`ui: ['metrics', 'playbar', 'classpick']`), put sliders inline (`controls: ['k']`), run setup code (`do(api)`), and wait for the visitor to try something (`wait.check(state, params, ev)`, where `ev` counts hovers, clicks and drags) before Next unlocks.

## Testing

- `?nopython` skips the background Pyodide download (it still loads on demand from the Python tab).
- `window.__learn` exposes the open lesson plus `setParam`, `selectView` and `stepOnce` for scripted checks.
- Pyodide is about 42 MB on first visit, then served from the browser cache.
