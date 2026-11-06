/* TeXForge service worker: keeps the editor itself available offline.
 * The TeX engine (vendor/texlive/) is cached separately by js/tex-worker.js. */
const VERSION = 'texforge-shell-v1';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'icon.svg',
  'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/engine.js', 'js/logparse.js', 'js/synctex.js', 'js/tex-worker.js', 'js/zip.js',
  'vendor/codemirror/codemirror.min.js', 'vendor/codemirror/codemirror.min.css',
  'vendor/codemirror/addon/stex.min.js', 'vendor/codemirror/addon/matchbrackets.min.js',
  'vendor/codemirror/addon/closebrackets.min.js', 'vendor/codemirror/addon/active-line.min.js',
  'vendor/codemirror/addon/show-hint.min.js', 'vendor/codemirror/addon/show-hint.min.css',
  'vendor/codemirror/addon/dialog.min.js', 'vendor/codemirror/addon/dialog.min.css',
  'vendor/codemirror/addon/searchcursor.min.js', 'vendor/codemirror/addon/search.min.js',
  'vendor/codemirror/addon/jump-to-line.min.js', 'vendor/codemirror/addon/annotatescrollbar.min.js',
  'vendor/codemirror/addon/matchesonscrollbar.min.js', 'vendor/codemirror/addon/matchesonscrollbar.min.css',
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('texforge-shell-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/texlive/')) return; // handled by the TeX worker's own cache
  // Network first so updates arrive; fall back to the cached shell when offline.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))),
  );
});
