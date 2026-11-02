/* Lets the reader open offline, and turns on cross-origin isolation, which GitHub Pages can't set as headers.
   Isolation is what lets the voice use several processor cores, making it several times faster.
   Your documents never pass through here: they stay in IndexedDB. */
const CACHE = 'dr-shell-v1';
// The voice runtimes in vendor/ are large, so they are cached the first time a voice needs them rather than on every visit.
const PRECACHE = ['./', 'index.html', 'app.css', 'icon.svg', 'manifest.webmanifest', 'js/theme.js', 'js/app.js', 'js/extract.js', 'js/player.js', 'js/store.js', 'js/voice.js', 'js/g2p.js', 'js/audiofile.js', 'js/tts-worker.js',
  '../pdf-editor/lib/pdf.min.js', '../pdf-editor/lib/pdf.worker.min.js', '../pdf-editor/lib/jszip.min.js', '../media-studio/lib/mediabunny.min.mjs'];

function isolated(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'error') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(PRECACHE.map((p) => c.add(p)))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('dr-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || e.request.headers.has('range')) return;
  // Bundled libraries never change under the same cache version, so they are only ever fetched once.
  const fixed = /\/(vendor|lib)\//.test(url.pathname);
  const network = () => fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  });
  const respond = fixed
    ? caches.match(e.request).then((hit) => hit || network())
    : network().catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())));
  e.respondWith(respond.then(isolated));
});
