// Counts visits to the tools and games (workers/ask-log). Sends only the page, whether the
// visitor interacted, and how long the tab was in view; never any file or content from the app.
(function () {
    'use strict';
    var HOSTS = ['bibek-koirala.com.np', 'www.bibek-koirala.com.np'];
    if (HOSTS.indexOf(location.hostname) < 0 || !window.fetch) return;

    var m = location.pathname.match(/^\/(tools|games)\/([^\/]+)/);
    var app = m ? m[1] + '/' + m[2] : location.pathname;
    var visit = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    var interacted = false;
    var seen = 0, since = document.visibilityState === 'visible' ? Date.now() : 0;

    function post(body, beacon) {
        var json = JSON.stringify(body);
        try {
            if (beacon && navigator.sendBeacon && navigator.sendBeacon('/api/visit', new Blob([json], { type: 'application/json' }))) return;
            fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true })
                .catch(function () { /* best effort */ });
        } catch (e) { /* ignore */ }
    }

    post({ event: 'open', visit: visit, app: app, page: location.pathname + location.search, ref: document.referrer || null });

    function used() {
        if (interacted) return;
        interacted = true;
        ['pointerdown', 'keydown', 'drop', 'change'].forEach(function (t) { removeEventListener(t, used, true); });
    }
    ['pointerdown', 'keydown', 'drop', 'change'].forEach(function (t) { addEventListener(t, used, true); });

    function report() {
        if (since) { seen += Date.now() - since; since = 0; }
        post({ event: 'end', visit: visit, interacted: interacted, seconds: Math.round(seen / 1000) }, true);
    }
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') report();
        else since = Date.now();
    });
    addEventListener('pagehide', function () { if (since) report(); });
})();
