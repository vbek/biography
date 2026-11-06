# TeXForge

A free, private alternative to Overleaf that runs entirely in the browser. Write LaTeX on the left and see the PDF on the right. It recompiles as you type and syncs both ways between source and PDF.

**Nothing is uploaded.** Projects are stored in the browser (IndexedDB). They compile on the device with TeX Live running as WebAssembly. The page's Content-Security-Policy only allows connections to this site.

Live at <https://bibek-koirala.com.np/tools/texforge/>.

## Features

- **Side-by-side editor and PDF.** CodeMirror with LaTeX highlighting, bracket matching, find and replace, a formatting bar and autocomplete. Autocomplete covers commands, environments, `\ref` labels, `\cite` keys, image paths and `\input` files.
- **Live compilation.** The project saves and recompiles about a second after you stop typing. pdfLaTeX and XeLaTeX are available. BibTeX and makeindex run when needed, and only when citations or `.bib` files change. LaTeX reruns whenever the table of contents or the lists of figures and tables change, as latexmk does, so their page numbers come out right.
- **Fast compile, on by default.** The **Fast** switch (or ⋯ → Fast compile) skips decoding and embedding images and runs a single LaTeX pass. Each image becomes a frame of the same size labelled with its filename, so the layout is unchanged. On a document with four 9.6 MB photos, a recompile went from about 9.5 s to 0.8 s. A *Fast · no images* badge marks such PDFs; clicking it compiles the full PDF once. The setting is saved per project.
- **Long compiles are never cut off in Normal mode.** After 30 s a prompt asks *Keep waiting* or *Stop compiling*, and asks again every 60 s if you keep waiting. Time spent downloading TeX packages doesn't count. While compiling, **Recompile** becomes **Stop**, which asks for confirmation first. Fast mode still stops by itself after 150 s, since that almost always means an infinite loop.
- **Images and figures.** Drag an image into the editor or paste a screenshot. It is stored in `images/` and a `figure` block is inserted. PNG, JPG and PDF graphics work.
- **PDF viewer.** Zoom, fit width or page, lazy page rendering, and the scroll position is kept across recompiles.
- **SyncTeX.** Double-click the PDF to jump to the source line. Ctrl+Alt+J highlights the cursor's position in the PDF.
- **Errors.** The log becomes clickable errors and warnings, with markers in the gutter.
- **Projects.** The **Manage projects** window, from the button beside the project picker or ⋯ → Manage projects, lists every project with its size and last-edit date. From there you can open, rename or delete one; deleting takes two clicks. Also: folders, choice of main file, and **import of Overleaf `.zip` exports**. You can download the source as a .zip or download the PDF. Works offline after the first visit.

## How it works

| Piece | Where |
|---|---|
| UI, editor, PDF viewer | `index.html`, `css/app.css`, `js/app.js`, `vendor/codemirror`, `vendor/pdfjs` |
| Local storage | `js/db.js` (IndexedDB: projects, files, last PDF) |
| TeX engine | `js/tex-worker.js` running [BusyTeX](https://github.com/busytex/busytex) (`vendor/texlive/busytex.wasm.gz`) in a Web Worker |
| TeX Live files | `vendor/texlive/index.json` + `chunk-*.bin.gz` |
| SyncTeX and log parsing | `js/synctex.js`, `js/logparse.js` |
| Offline shell | `sw.js` (the engine caches itself with the Cache API) |

Fonts work the same way. The cm-super Type 1 fonts are needed for `[T1]{fontenc}` and for text-companion symbols such as `\textdegree` and `\textmu`. They are one unit per font, about 140 KB each. pdfTeX stops at the first font file it can't open, so every run uses `--recorder`. On a font failure, the worker reads the list of `.tfm` files the run used, looks each one up in `pdftex.map`, and fetches all the missing outline fonts in one round.

TeX Live is repackaged into about 2,650 *units*, one per package or font family, each with a list of the units it depends on. On first use the browser downloads the engine and the pdfLaTeX core, about 23 MB. Anything else loads only when a document needs it, for example `\usepackage{tikz}` or Times fonts. The worker scans `\usepackage`, `\documentclass`, `\usetikzlibrary` and similar commands, and also watches the log for "file not found". XeLaTeX adds about 21 MB the first time it is selected. Every download is cached for offline use.

## Rebuilding the TeX Live bundles

`vendor/texlive/` is generated. To rebuild it:

1. Download from the BusyTeX release `build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1`: `busytex.js` and `busytex.wasm`, plus `.js` and `.data` for `texlive-basic`, `ubuntu-texlive-latex-base`, `-latex-recommended`, `-latex-extra`, `-fonts-recommended` and `-science`.
2. Download the extra packages the BusyTeX bundles lack, as TDS trees. The current build adds PGF/TikZ, pgfplots and tikz-cd from CTAN, plus cm-super and IEEEtran from `tlnet/archive/<name>.tar.xz`. Extract each tree's `tex/` and `fonts/` into `ctan/<name>/`.
3. Run `node scripts/build-texlive.js <busytex-dir> vendor/texlive <ctan-dir>`. Each build gets a content hash (`index.json` → `build`) that versions the browser cache, so visitors never mix chunks from different builds.

## Limitations

- LuaLaTeX is not offered: LuaHBTeX in this BusyTeX build overflows its WebAssembly stack.
- There is no Biber, so biblatex with `backend=biber` won't work. Use BibTeX or natbib.
- Shell escape is not available (`minted`, `\write18`).
- TeX Live 2023 (BusyTeX's last WebAssembly build) with Ubuntu's package selection plus PGF. Some rarer CTAN packages are missing.
- WebAssembly pdfTeX runs about 2–3× slower than native. Small documents recompile in about 1 s; beamer decks and heavy TikZ take longer.
- Clearing the browser's site data deletes your projects. Download a .zip to back them up.

## Licences

- TeXForge code: MIT.
- [BusyTeX](https://github.com/busytex/busytex): MIT.
- TeX Live and CTAN packages: their own free licences (LPPL, GPL, OFL and others).
- [CodeMirror 5](https://codemirror.net/5/): MIT.
- [PDF.js](https://mozilla.github.io/pdf.js/): Apache-2.0.
