// Logs questions asked in the site's "Ask About Me" chat, and visits to the tools and games,
// with the visitor's IP and Cloudflare's guess at their location, into a D1 database.
//
//   POST /api/ask-log                     called by ask/ask.js after each answer
//   POST /api/visit                       called by track.js when a tool/game opens and when it's left
//   GET  /api/ask-log?key=...             Ask About Me dashboard (needs ADMIN_KEY)
//   GET  /api/ask-log?key=...&view=visits tool/game visits dashboard (&app=games/ludo to start filtered)
//   GET  /api/ask-log?key=...&view=apps   per-app dashboard
//   add &days=7|30|90|180 for the range (default 30)
//   add &format=json for the newest raw rows instead, &limit=N for more of them
//
// A daily cron deletes entries older than RETENTION_DAYS.

import PAGE from './dashboard.html';
import { WORLD } from './world.js';

const SITE_HOSTS = ['bibek-koirala.com.np', 'www.bibek-koirala.com.np'];
const QUESTIONS_PER_IP_PER_MINUTE = 20;
const OPENS_PER_IP_PER_MINUTE = 60;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/visit')) {
            if (request.method === 'POST') return visit(request, env);
        } else if (request.method === 'POST') {
            return record(request, env);
        } else if (request.method === 'GET') {
            return view(url, env);
        }
        return new Response('Method not allowed', { status: 405 });
    },

    async scheduled(_event, env) {
        const days = `-${Number(env.RETENTION_DAYS) || 180} days`;
        await env.DB.batch([
            env.DB.prepare("DELETE FROM questions WHERE ts < datetime('now', ?)").bind(days),
            env.DB.prepare("DELETE FROM visits WHERE ts < datetime('now', ?)").bind(days),
        ]);
    },
};

function fromSite(request) {
    let host = '';
    try { host = new URL(request.headers.get('Origin') || '').hostname; } catch { /* no or bad origin */ }
    return SITE_HOSTS.includes(host);
}

function where(request) {
    const cf = request.cf || {};
    return {
        ip: request.headers.get('CF-Connecting-IP') || '',
        country: cf.country || null,
        region: cf.region || null,
        city: cf.city || null,
        timezone: cf.timezone || null,
        asn: cf.asn || null,
        as_org: cf.asOrganization || null,
        ua: clean(request.headers.get('User-Agent'), 300),
        lat: coord(cf.latitude, 90),
        lon: coord(cf.longitude, 180),
    };
}

async function readJson(request) {
    try { return await request.json(); } catch { return null; }
}

async function tooMany(env, table, ip, max) {
    const r = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ip = ? AND ts > datetime('now', '-1 minute')`
    ).bind(ip).first();
    return r && r.n >= max;
}

async function record(request, env) {
    if (!fromSite(request)) return new Response(null, { status: 403 });
    const body = await readJson(request);
    const question = body && clean(body.q, 300);
    if (!question) return new Response(null, { status: 400 });

    const w = where(request);
    if (await tooMany(env, 'questions', w.ip, QUESTIONS_PER_IP_PER_MINUTE)) return new Response(null, { status: 429 });

    await env.DB.prepare(
        `INSERT INTO questions (ts, question, answer_kind, answer_title, page, session, ip,
            country, region, city, timezone, asn, as_org, user_agent, referrer, lat, lon)
         VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        question, clean(body.kind, 20), clean(body.title, 200), clean(body.page, 200), clean(body.session, 40),
        w.ip, w.country, w.region, w.city, w.timezone, w.asn, w.as_org, w.ua, clean(body.ref, 300), w.lat, w.lon,
    ).run();
    return new Response(null, { status: 204 });
}

async function visit(request, env) {
    if (!fromSite(request)) return new Response(null, { status: 403 });
    const body = await readJson(request);
    const id = body && clean(body.visit, 40);
    if (!id) return new Response(null, { status: 400 });
    const w = where(request);

    if (body.event === 'open') {
        const app = clean(body.app, 80);
        if (!app) return new Response(null, { status: 400 });
        if (await tooMany(env, 'visits', w.ip, OPENS_PER_IP_PER_MINUTE)) return new Response(null, { status: 429 });
        await env.DB.prepare(
            `INSERT INTO visits (visit, ts, last_ts, app, page, ip, country, region, city, timezone, asn, as_org, user_agent, referrer, lat, lon)
             VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, app, clean(body.page, 200), w.ip, w.country, w.region, w.city, w.timezone, w.asn, w.as_org, w.ua,
            clean(body.ref, 300), w.lat, w.lon).run();
    } else if (body.event === 'end') {
        const seconds = Math.max(0, Math.min(86400, Math.round(Number(body.seconds) || 0)));
        // Only the browser that opened the visit (same IP) can update it.
        await env.DB.prepare(
            `UPDATE visits SET seconds = MAX(seconds, ?), interacted = MAX(interacted, ?), last_ts = datetime('now')
             WHERE visit = ? AND ip = ?`
        ).bind(seconds, body.interacted ? 1 : 0, id, w.ip).run();
    } else {
        return new Response(null, { status: 400 });
    }
    return new Response(null, { status: 204 });
}

const VIEWS = {
    questions: {
        title: 'Ask About Me questions',
        sql: `SELECT ts, question, answer_kind, answer_title, page, ip, city, region, country, as_org, session
              FROM questions ORDER BY id DESC LIMIT ?`,
    },
    visits: {
        title: 'Tool & game visits',
        sql: `SELECT ts, app, interacted AS used, seconds, ip, city, region, country, as_org, referrer, page
              FROM visits ORDER BY id DESC LIMIT ?`,
    },
    apps: {
        title: 'Per app',
        sql: `SELECT app, COUNT(*) AS opens, SUM(interacted) AS used, COUNT(DISTINCT ip) AS unique_ips,
                     ROUND(AVG(CASE WHEN interacted = 1 THEN seconds END)) AS avg_seconds_when_used,
                     SUM(ts > datetime('now', '-7 days')) AS opens_last_7_days, MAX(ts) AS last_open
              FROM visits GROUP BY app ORDER BY opens DESC LIMIT ?`,
    },
};

// Rough device / browser / OS from the user agent, worked out by D1 so the Worker stays cheap.
const UA_COLUMNS = `
    CASE WHEN user_agent LIKE '%bot%' OR user_agent LIKE '%crawl%' OR user_agent LIKE '%spider%' OR user_agent LIKE '%Headless%' THEN 'Bot'
         WHEN user_agent LIKE '%iPad%' OR (user_agent LIKE '%Android%' AND user_agent NOT LIKE '%Mobile%') THEN 'Tablet'
         WHEN user_agent LIKE '%Mobi%' OR user_agent LIKE '%iPhone%' THEN 'Mobile'
         WHEN user_agent IS NULL THEN 'Unknown' ELSE 'Desktop' END AS device,
    CASE WHEN user_agent LIKE '%Edg%/%' THEN 'Edge' WHEN user_agent LIKE '%OPR/%' OR user_agent LIKE '%Opera%' THEN 'Opera'
         WHEN user_agent LIKE '%SamsungBrowser%' THEN 'Samsung Internet'
         WHEN user_agent LIKE '%Firefox/%' OR user_agent LIKE '%FxiOS%' THEN 'Firefox'
         WHEN user_agent LIKE '%CriOS%' OR user_agent LIKE '%Chrome/%' THEN 'Chrome'
         WHEN user_agent LIKE '%Safari/%' THEN 'Safari' WHEN user_agent IS NULL THEN 'Unknown' ELSE 'Other' END AS browser,
    CASE WHEN user_agent LIKE '%Windows%' THEN 'Windows' WHEN user_agent LIKE '%Android%' THEN 'Android'
         WHEN user_agent LIKE '%iPhone%' OR user_agent LIKE '%iPad%' THEN 'iOS' WHEN user_agent LIKE '%Macintosh%' THEN 'macOS'
         WHEN user_agent LIKE '%CrOS%' THEN 'ChromeOS' WHEN user_agent LIKE '%Linux%' THEN 'Linux'
         WHEN user_agent IS NULL THEN 'Unknown' ELSE 'Other' END AS os`;

// The dashboard gets every row from the chosen range plus the range before it (for the
// "vs previous" deltas) and works out the charts in the browser.
const DASH_SQL = {
    questions: (ll) => `SELECT ts, question, answer_kind AS kind, answer_title AS title, page, session, ip,
            country, region, city, as_org AS network, ${ll}, referrer, ${UA_COLUMNS}
        FROM questions WHERE ts > datetime('now', ?) ORDER BY id DESC LIMIT ?`,
    visits: (ll) => `SELECT ts, app, interacted AS used, seconds, ip, country, region, city, as_org AS network, ${ll},
            referrer, page, ${UA_COLUMNS}
        FROM visits WHERE ts > datetime('now', ?) ORDER BY id DESC LIMIT ?`,
};
DASH_SQL.apps = DASH_SQL.visits;
const DASH_MAX_ROWS = 20000;
const RANGES = [7, 30, 90, 180];

async function view(url, env) {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !safeEqual(key, env.ADMIN_KEY)) return new Response('Not found', { status: 404 });

    const name = VIEWS[url.searchParams.get('view')] ? url.searchParams.get('view') : 'questions';
    const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };

    if (url.searchParams.get('format') === 'json') {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 5000);
        const { results } = await env.DB.prepare(VIEWS[name].sql).bind(limit).all();
        return Response.json(results, { headers });
    }

    const days = RANGES.includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
    const since = `-${days * 2} days`;
    let raw;
    try {
        raw = await env.DB.prepare(DASH_SQL[name]('lat, lon')).bind(since, DASH_MAX_ROWS).raw({ columnNames: true });
    } catch (e) {
        // Database from before migrations/001-lat-lon.sql: show everything except the city dots.
        if (!/no such column/i.test(String(e && e.message))) throw e;
        raw = await env.DB.prepare(DASH_SQL[name]('NULL AS lat, NULL AS lon')).bind(since, DASH_MAX_ROWS).raw({ columnNames: true });
    }
    const [cols = [], ...rows] = raw;
    const data = {
        view: name, days, ranges: RANGES, app: url.searchParams.get('app') || null,
        now: new Date().toISOString(), capped: rows.length >= DASH_MAX_ROWS,
        retentionDays: Number(env.RETENTION_DAYS) || 180, cols, rows,
        world: name === 'apps' ? null : WORLD,
    };
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const html = PAGE.split('__NONCE__').join(nonce)
        .replace('__DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c'));
    return new Response(html, {
        headers: {
            ...headers, 'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`,
        },
    });
}

function coord(v, max) {
    const n = Number(v);
    return v != null && v !== '' && Number.isFinite(n) && Math.abs(n) <= max ? Math.round(n * 100) / 100 : null;
}

function clean(v, max) {
    if (v == null) return null;
    const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
    return s || null;
}

function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}
