// Logs questions asked in the site's "Ask About Me" chat, and visits to the tools and games,
// with the visitor's IP and Cloudflare's guess at their location, into a D1 database.
//
//   POST /api/ask-log                     called by ask/ask.js after each answer
//   POST /api/visit                       called by track.js when a tool/game opens and when it's left
//   GET  /api/ask-log?key=...             newest questions (needs ADMIN_KEY)
//   GET  /api/ask-log?key=...&view=visits newest tool/game visits
//   GET  /api/ask-log?key=...&view=apps   per-app summary
//   add &format=json for raw data, &limit=N for more rows
//
// A daily cron deletes entries older than RETENTION_DAYS.

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
            country, region, city, timezone, asn, as_org, user_agent, referrer)
         VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        question, clean(body.kind, 20), clean(body.title, 200), clean(body.page, 200), clean(body.session, 40),
        w.ip, w.country, w.region, w.city, w.timezone, w.asn, w.as_org, w.ua, clean(body.ref, 300),
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
            `INSERT INTO visits (visit, ts, last_ts, app, page, ip, country, region, city, timezone, asn, as_org, user_agent, referrer)
             VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, app, clean(body.page, 200), w.ip, w.country, w.region, w.city, w.timezone, w.asn, w.as_org, w.ua, clean(body.ref, 300)).run();
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

async function view(url, env) {
    const key = url.searchParams.get('key') || '';
    if (!env.ADMIN_KEY || !safeEqual(key, env.ADMIN_KEY)) return new Response('Not found', { status: 404 });

    const name = VIEWS[url.searchParams.get('view')] ? url.searchParams.get('view') : 'questions';
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 5000);
    const { results } = await env.DB.prepare(VIEWS[name].sql).bind(limit).all();

    const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };
    if (url.searchParams.get('format') === 'json') return Response.json(results, { headers });

    const cols = results.length ? Object.keys(results[0]) : [];
    const rows = results.map((r) => '<tr>' + cols.map((c) => `<td>${esc(r[c])}</td>`).join('') + '</tr>').join('');
    const nav = Object.keys(VIEWS).map((v) => v === name
        ? `<b>${esc(VIEWS[v].title)}</b>`
        : `<a href="?key=${encodeURIComponent(key)}&amp;view=${v}">${esc(VIEWS[v].title)}</a>`).join(' · ');
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site log</title>
<style>
body{font:13px/1.4 system-ui,sans-serif;margin:16px;background:#fff;color:#111}
a{color:#0b6bcb}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}a{color:#6cb6ff}td,th{border-color:#333!important}}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:inherit}
.wrap{overflow-x:auto}
</style>
<p>${nav}</p>
<h1>${esc(VIEWS[name].title)}: ${results.length} rows (times in UTC)</h1>
<div class="wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    return new Response(html, {
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" },
    });
}

function clean(v, max) {
    if (v == null) return null;
    const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
    return s || null;
}

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}
