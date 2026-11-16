// Counts visits to the home page, tools, games and Learn lessons (workers/ask-log). Sends only the page, whether the
// visitor interacted, and how long the tab was in view; never any file or content from the app.
(function () {
    'use strict';
    var HOSTS = ['bibek-koirala.com.np', 'www.bibek-koirala.com.np'];
    if (HOSTS.indexOf(location.hostname) < 0 || !window.fetch) return;

    var EVENTS = ['pointerdown', 'keydown', 'drop', 'change'];
    var learn = /^\/learn\//.test(location.pathname);
    var visit, interacted, seen, since;

    // tools/<app>, games/<app>, learn (overview) or learn/<subject>/<lesson> (the Learn hub routes by #hash)
    function appName() {
        var m = location.pathname.match(/^\/(tools|games)\/([^\/]+)/);
        if (m) return m[1] + '/' + m[2];
        if (learn) {
            var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).slice(0, 2);
            return parts.length === 2 ? 'learn/' + parts.join('/') : 'learn';
        }
        if (location.pathname === '/' || location.pathname === '/index.html') return 'home';
        return location.pathname;
    }

    function post(body, beacon) {
        var json = JSON.stringify(body);
        try {
            if (beacon && navigator.sendBeacon && navigator.sendBeacon('/api/visit', new Blob([json], { type: 'application/json' }))) return;
            fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true })
                .catch(function () { /* best effort */ });
        } catch (e) { /* ignore */ }
    }

    function used() {
        if (interacted) return;
        interacted = true;
        EVENTS.forEach(function (t) { removeEventListener(t, used, true); });
    }

    function open(ref) {
        visit = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        interacted = false;
        seen = 0;
        since = document.visibilityState === 'visible' ? Date.now() : 0;
        post({ event: 'open', visit: visit, app: appName(), page: location.pathname + location.search + (learn ? location.hash : ''), ref: ref || null });
        EVENTS.forEach(function (t) { addEventListener(t, used, true); });
    }

    function report() {
        if (since) { seen += Date.now() - since; since = 0; }
        post({ event: 'end', visit: visit, interacted: interacted, seconds: Math.round(seen / 1000) }, true);
    }

    open(document.referrer);

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') report();
        else since = Date.now();
    });
    addEventListener('pagehide', function () { if (since) report(); });

    // In the Learn hub, moving to another lesson closes this visit and opens a new one for that lesson.
    if (learn) {
        var current = appName();
        addEventListener('hashchange', function (e) {
            var next = appName();
            if (next === current) return;
            report();
            current = next;
            open(e.oldURL || null);
        });
    }
})();
