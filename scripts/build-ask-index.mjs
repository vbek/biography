#!/usr/bin/env node
// Builds ask/knowledge.json, the searchable knowledge base behind the
// "Ask About Me" chat widget (ask/ask.js).
//
//   node scripts/build-ask-index.mjs
//
// Sources: index.html, tools/index.html, games/index.html, data.json and
// raw/resume.pdf (needs `pdftotext` from poppler; if it is missing, the résumé
// entries already in ask/knowledge.json are kept). No npm dependencies.
//
// Every chunk holds text copied from the site. The widget only ever shows
// that text, so re-run this after editing the site (the deploy workflow also
// runs it) or the bot will not know about the change.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'ask', 'knowledge.json');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ---------- tiny HTML helpers (the site's markup is hand-written and regular) ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', middot: '·', times: '×', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };
const decode = (s) => s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const text = (html) => decode(String(html || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').trim();

// Every element whose class list contains `cls`, with its balanced inner HTML.
function elements(html, cls) {
    const out = [];
    const open = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bclass="([^"]*)"[^>]*>`, 'gi');
    let m;
    while ((m = open.exec(html))) {
        if (!m[2].split(/\s+/).includes(cls)) continue;
        const tag = m[1].toLowerCase();
        const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
        tagRe.lastIndex = open.lastIndex;
        let depth = 1, t, end = html.length;
        while ((t = tagRe.exec(html))) {
            depth += t[1] ? -1 : 1;
            if (!depth) { end = t.index; break; }
        }
        out.push({ open: m[0], classes: m[2], inner: html.slice(open.lastIndex, end) });
    }
    return out;
}
const first = (html, cls) => elements(html, cls)[0]?.inner ?? '';
const firstTag = (html, tag) => (html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1] ?? '';
const allTags = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]);
const attr = (tagHtml, name) => decode((tagHtml.match(new RegExp(`\\b${name}="([^"]*)"`, 'i')) || [])[1] ?? '');
const links = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: attr(m[1], 'href'), label: text(m[2]) }))
    .filter((l) => l.href && !l.href.startsWith('#'));

// ---------- chunk collection ----------
const chunks = [];
const seen = new Set();
function add(c) {
    c.text = c.text.replace(/\s+/g, ' ').trim();
    if (!c.text) return;
    let id = c.id, n = 2;
    while (seen.has(id)) id = `${c.id}-${n++}`;
    seen.add(id);
    chunks.push({ ...c, id });
}
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// ---------- index.html ----------
const home = read('index.html');
let owner = { name: 'Bibek Koirala', email: '', links: [] };
for (const block of allTags(home, 'script').filter((s) => s.includes('schema.org'))) {
    try {
        const graph = JSON.parse(block)['@graph'] || [];
        const person = graph.find((g) => g['@type'] === 'Person');
        if (person) {
            owner = {
                name: person.name,
                email: String(person.email || '').replace(/^mailto:/, ''),
                jobTitle: person.jobTitle,
                links: person.sameAs || [],
            };
        }
    } catch { /* not JSON-LD we understand */ }
}

const hero = first(home, 'bio-text');
add({
    id: 'about', section: 'about', title: 'About me', url: '#biography',
    text: `${text(firstTag(hero, 'h1'))}. ${text(firstTag(hero, 'p'))}`,
});
const badge = text(first(hero, 'hero-badge'));
if (badge) add({ id: 'availability', section: 'about', title: 'Availability', url: '#biography', weight: 0.6, text: `${badge}.` });

const stats = elements(hero, 'stat-item').map((s) => {
    const n = attr(elements(s.inner, 'stat-number')[0]?.open ?? '', 'data-count');
    return `${text(first(s.inner, 'stat-label'))}: ${n}`;
});
if (stats.length) add({ id: 'stats', section: 'stats', title: 'At a glance', url: '#biography', text: `${stats.join('. ')}.` });

const chips = elements(home, 'float-chip').map((c) => text(c.inner)).filter(Boolean);
if (chips.length) add({ id: 'focus-areas', section: 'skills', title: 'Focus areas', url: '#biography', text: `Focus areas: ${chips.join(', ')}.` });

for (const card of elements(home, 'path-card')) {
    const title = text(firstTag(card.inner, 'h3'));
    const period = text(first(card.inner, 'path-period'));
    const inst = text(first(card.inner, 'institution'));
    const desc = text(first(card.inner, 'description'));
    const tags = elements(card.inner, 'tag').map((t) => text(t.inner));
    const isEdu = /\b(M\.S\.|B\.S\.|B\.E\.|degree|bachelor|master|ph\.?d)/i.test(title);
    add({
        id: `${isEdu ? 'edu' : 'exp'}-${slug(title)}`, section: isEdu ? 'education' : 'experience',
        title, date: period, url: '#professional-path', tags,
        text: `${title}, ${inst}, ${period}. ${desc}${tags.length ? ` Focus: ${tags.join(', ')}.` : ''}`,
        links: links(card.inner),
    });
}

for (const card of elements(home, 'pub-card')) {
    const title = text(firstTag(card.inner, 'h3'));
    const kind = text(first(card.inner, 'pub-kind'));
    const when = text(elements(card.inner, 'path-period')[0]?.inner);
    const authors = text(first(card.inner, 'pub-authors'));
    const venue = text(first(card.inner, 'pub-venue'));
    add({
        id: `pub-${slug(title)}`, section: 'publications', title, kind, date: when, url: '#publications',
        text: `${venue}. Authors: ${authors.replace(/\.$/, '')}.`,
        links: links(card.inner),
    });
}
const pubNote = text(first(home, 'pub-note'));
if (pubNote) add({ id: 'pub-in-preparation', section: 'publications', title: 'In preparation', url: '#publications', text: pubNote });

for (const slide of elements(home, 'project-slide')) {
    const body = first(slide.inner, 'project-content');
    const title = text(firstTag(body, 'h3'));
    add({
        id: `project-${slug(title)}`, section: 'projects', title, url: '#research',
        text: text(firstTag(body, 'p')), links: links(body),
    });
}

for (const card of elements(home, 'news-card')) {
    const body = first(card.inner, 'news-content');
    const title = text(firstTag(body, 'h3'));
    add({
        id: `news-${slug(title)}`, section: 'news', title, kind: text(first(body, 'news-tag')),
        date: text(first(body, 'news-date')), url: '#news', text: text(firstTag(body, 'p')), links: links(body),
    });
}

const cta = first(home, 'cta-inner');
const contactLinks = links(first(home, 'contact-content'));
function linkName(href) {
    if (href.startsWith('mailto:')) return 'Email';
    const h = href.toLowerCase();
    return h.includes('linkedin') ? 'LinkedIn' : h.includes('github') ? 'GitHub' : h.includes('instagram') ? 'Instagram'
        : /x\.com|twitter/.test(h) ? 'X (Twitter)' : href;
}
add({
    id: 'contact', section: 'contact', title: 'Contact', url: '#contact',
    text: `${owner.email ? `You can email me at ${owner.email}. ` : ''}I'm also on ${contactLinks.filter((l) => !l.href.startsWith('mailto:')).map((l) => linkName(l.href)).join(', ')}. ${text(firstTag(cta, 'p'))}.`,
    links: contactLinks.map((l) => ({ href: l.href, label: linkName(l.href) })),
});
const resumeLink = home.match(/<a\b[^>]*href="(raw\/resume\.pdf)"[^>]*>([\s\S]*?)<\/a>/i);
if (resumeLink) add({ id: 'resume-download', section: 'contact', title: 'Résumé / CV', url: resumeLink[1], text: `My résumé (CV) is available to download as a PDF.`, links: [{ href: resumeLink[1], label: 'Download résumé' }] });

for (const a of links(first(home, 'footer-archive'))) {
    add({ id: `archive-${slug(a.label)}`, section: 'projects', title: a.label, url: a.href, weight: 0.6, text: `The site archive includes the ${a.label}.`, links: [a] });
}

// ---------- tools/ and games/ landing pages ----------
for (const [file, section, base] of [['tools/index.html', 'tools', 'tools/'], ['games/index.html', 'games', 'games/']]) {
    if (!existsSync(join(ROOT, file))) continue;
    const page = read(file);
    const intro = text(firstTag(first(page, 'tools-head'), 'p'));
    const perks = elements(page, 'tools-perks')[0];
    const cards = elements(page, 'tool-card').filter((c) => !c.classes.split(/\s+/).includes('soon'));
    const names = cards.map((c) => text(firstTag(c.inner, 'h2')));
    add({
        id: `${section}-overview`, section, title: section === 'tools' ? 'Free tools' : 'Free games', url: `${base}index.html`,
        text: `${intro} ${perks ? `${text(perks.inner.replace(/<\/span>/g, ', </span>')).replace(/,\s*$/, '')}.` : ''} ${section === 'tools' ? 'Tools' : 'Games'}: ${names.join(', ')}.`,
    });
    for (const c of cards) {
        const title = text(firstTag(c.inner, 'h2'));
        add({
            id: `${section}-${slug(title)}`, section, title, url: base + attr(c.open, 'href'),
            text: `${title}: ${text(firstTag(c.inner, 'p'))}`,
            links: [{ href: base + attr(c.open, 'href'), label: `Open ${title}` }],
        });
    }
}

// ---------- data.json (the dashboard's items; the widget also re-reads it live) ----------
if (existsSync(join(ROOT, 'data.json'))) {
    const data = JSON.parse(read('data.json'));
    for (const item of data.news || []) add(dataChunk(item, 'news'));
    for (const item of data.research || []) add(dataChunk(item, 'projects'));
}
// Keep in step with dataChunk() in ask/ask.js.
function dataChunk(item, section) {
    return {
        id: `data-${item.id}`, section, src: 'data.json', title: item.title, kind: item.tag || '', date: item.date || '',
        url: section === 'news' ? '#news' : '#research', text: item.description || '',
        links: item.link ? [{ href: item.link, label: item.linkLabel || 'View' }] : [],
    };
}

// ---------- résumé PDF ----------
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
let resumeText = '', resumeLayout = '';
try {
    const pdf = join(ROOT, 'raw', 'resume.pdf');
    resumeText = execFileSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' });
    resumeLayout = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' });
} catch {
    console.warn('pdftotext not available: keeping résumé entries from the previous index.');
}
if (resumeText) {
    for (const c of resumeChunks(resumeText, resumeLayout)) add(c);
} else if (previous) {
    for (const c of previous.chunks.filter((c) => c.src === 'resume')) add(c);
}

function resumeChunks(raw, layout) {
    const HEADINGS = ['Summary', 'Education', 'Technical Skills', 'Experience', 'Publications', 'Selected Projects'];
    const sectionsOf = (txt) => {
        const out = {};
        let cur = '_header';
        for (const line of txt.replace(/\f/g, '\n').split('\n').map((l) => l.trim())) {
            if (HEADINGS.includes(line)) { cur = line; continue; }
            if (line) (out[cur] ||= []).push(line);
        }
        return out;
    };
    const sections = sectionsOf(raw);
    const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
    const clean = (s) => s
        .replace(/(\w)-\n+\s*(\w)/g, '$1$2')       // words hyphenated across lines
        .replace(/\n+/g, ' ')
        .replace(new RegExp(`([a-z])(${MONTH} \\d{4})`, 'g'), '$1, $2')
        .replace(/\bFirstauthor\b/g, 'First-author')
        .replace(/\bvisionlanguage\b/g, 'vision-language')
        .replace(/\s+/g, ' ').trim();
    const bullets = (s) => s.split('•').map((b) => b.trim()).filter(Boolean);
    // Entries ("Role – Org", "Project – link") start on a non-bullet line with a spaced dash.
    const entries = (lines = []) => {
        const out = [];
        for (const l of lines) {
            const cur = out[out.length - 1];
            if (!l.startsWith('•') && / – /.test(l) && /^[A-Z]/.test(l) && (!cur || cur.some((x) => x.includes('•')))) out.push([l]);
            else if (cur) cur.push(l);
            else out.push([l]);
        }
        return out.map((e) => clean(e.join('\n')));
    };
    const R = { src: 'resume', url: 'raw/resume.pdf' };
    const out = [];

    // Only the location from the header line: the phone number is left out on purpose.
    const header = (sections._header || []).find((l) => l.includes('|'));
    const location = header?.split('|')[0].trim();
    if (location && !/@|\d{3}/.test(location)) out.push({ ...R, id: 'resume-location', section: 'about', title: 'Location', text: `I'm based in ${location}.` });

    if (sections.Summary) out.push({ ...R, id: 'resume-summary', section: 'about', title: 'Résumé summary', text: clean(sections.Summary.join('\n')) });

    for (const e of entries(sections.Education)) {
        const [head, ...rest] = bullets(e);
        out.push({ ...R, id: `resume-education-${slug(head)}`, section: 'education', title: 'Education', text: `${head}.${rest.length ? ' ' + rest.join(' ') + '.' : ''}` });
    }

    // Skill categories each start a line in the layout text ("Computer Vision: ...").
    const skillLines = (sectionsOf(layout || '')['Technical Skills'] || []);
    const cats = [];
    for (const l of skillLines) {
        if (/^[A-Z][^,:]{2,40}:\s/.test(l)) cats.push([l]);
        else if (cats.length) cats[cats.length - 1].push(l);
    }
    for (const c of cats) {
        const [, name, list] = clean(c.join('\n')).match(/^([^:]+):\s*(.+?)[,\s]*$/);
        out.push({ ...R, id: `skills-${slug(name)}`, section: 'skills', title: `Skills: ${name}`, text: `${name}: ${list}.` });
    }

    for (const e of entries(sections.Experience)) {
        const [head, ...items] = bullets(e);
        const title = head.split(' – ')[0].replace(/,.*$/, '').trim();
        out.push({ ...R, id: `resume-exp-${slug(title)}`, section: 'experience', title, text: `${head}. ${items.join(' ')}` });
    }

    for (const p of bullets(clean((sections.Publications || []).join('\n')))) {
        const t = (p.match(/“([^”]+?),?”/) || [])[1] || p.slice(0, 60);
        out.push({ ...R, id: `resume-pub-${slug(t)}`, section: 'publications', title: t, text: p });
    }

    for (const e of entries(sections['Selected Projects'])) {
        const [head, ...items] = bullets(e);
        const title = head.split(' – ')[0].trim();
        out.push({ ...R, id: `resume-project-${slug(title)}`, section: 'projects', title, text: `${head}. ${items.join(' ')}` });
    }
    return out;
}

// ---------- write ----------
const kb = {
    version: 1,
    generated: new Date().toISOString(),
    owner,
    chunks: chunks.map(({ links, tags, ...c }) => ({
        ...c,
        ...(tags?.length ? { tags } : {}),
        ...(links?.length ? { links } : {}),
    })),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(kb, null, 1) + '\n');
const bySection = kb.chunks.reduce((m, c) => ((m[c.section] = (m[c.section] || 0) + 1), m), {});
console.log(`ask/knowledge.json: ${kb.chunks.length} chunks`, bySection);
