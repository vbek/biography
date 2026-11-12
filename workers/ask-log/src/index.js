// Logs questions asked in the site's "Ask About Me" chat, with the visitor's
// IP and Cloudflare's guess at their location, into a D1 database.
//
//   POST /api/ask-log            called by ask/ask.js after each answer
//   GET  /api/ask-log?key=...    newest entries as a table (needs ADMIN_KEY)
//   GET  /api/ask-log?key=...&format=json
//
// A daily cron deletes entries older than RETENTION_DAYS.

const SITE_HOSTS = ['bibek-koirala.com.np', 'www.bibek-koirala.com.np'];
const PER_IP_PER_MINUTE = 20;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === 'POST') return record(request, env);
        if (request.method === 'GET') return view(url, env);
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    },

    async scheduled(_event, env) {
        const days = Number(env.RETENTION_DAYS) || 180;
        await env.DB.prepare("DELETE FROM questions WHERE ts < datetime('now', ?)").bind(`-${days} days`).run();
    },
};

async function record(request, env) {
    // Only accept posts from the site's own pages.
    const origin = request.headers.get('Origin') || '';
    let host = '';
    try { host = new URL(origin).hostname; } catch { /* no or bad origin */ }
    if (!SITE_HOSTS.includes(host)) return new Response(null, { status: 403 });

    let body;
    try { body = await request.json(); } catch { return new Response(null, { status: 400 }); }
    const question = clean(body.q, 300);
    if (!question) return new Response(null, { status: 400 });

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const recent = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM questions WHERE ip = ? AND ts > datetime('now', '-1 minute')"
    ).bind(ip).first();
    if (recent && recent.n >= PER_IP_PER_MINUTE) return new Response(null, { status: 429 });

    const cf = request.cf || {};
    await env.DB.prepare(
        `INSERT INTO questions (ts, question, answer_kind, answer_title, page, session, ip,
            country, region, city, timezone, asn, as_org, user_agent, referrer)
         VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        question,
        clean(body.kind, 20),
        clean(body.title, 200),
        clean(body.page, 200),
        clean(body.session, 40),
        ip,
        cf.country || null,
        cf.region || null,
        cf.city || null,
        cf.timezone || null,
        cf.asn || null,
        cf.asOrganization || null,
        clean(request.headers.get('User-Agent'), 300),
        clean(body.ref, 300),
    ).run();

    return new Response(null, { status: 204 });
}

async function view(url, env) {
    if (!env.ADMIN_KEY || !safeEqual(url.searchParams.get('key') || '', env.ADMIN_KEY)) {
        return new Response('Not found', { status: 404 });
    }
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 2000);
    const { results } = await env.DB.prepare(
        `SELECT ts, question, answer_kind, answer_title, page, session, ip, city, region, country,
                timezone, as_org, user_agent, referrer
         FROM questions ORDER BY id DESC LIMIT ?`
    ).bind(limit).all();

    const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };
    if (url.searchParams.get('format') === 'json') {
        return Response.json(results, { headers });
    }

    const cols = ['ts', 'question', 'answer_kind', 'answer_title', 'page', 'ip', 'city', 'region', 'country', 'as_org', 'session'];
    const rows = results.map((r) => '<tr>' + cols.map((c) => `<td>${esc(r[c])}</td>`).join('') + '</tr>').join('');
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ask log</title>
<style>
body{font:13px/1.4 system-ui,sans-serif;margin:16px;background:#fff;color:#111}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}td,th{border-color:#333!important}}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:inherit}td:nth-child(2){min-width:240px}
.wrap{overflow-x:auto}
</style>
<h1>Ask About Me: ${results.length} newest questions (UTC)</h1>
<div class="wrap"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
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
