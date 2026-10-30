/* Financial Planner — small SVG charts drawn at the container's real width, with tooltips on hover, tap and keyboard focus. */
(() => {
  'use strict';
  const { esc } = FP;
  const compact = (c) => {
    const v = Math.abs(c) / 100, s = c < 0 ? '-' : '';
    return v >= 1e6 ? `${s}${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${s}${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${s}${Math.round(v)}`;
  };
  function niceMax(v) {
    if (v <= 0) return 100;
    const p = 10 ** Math.floor(Math.log10(v)), r = v / p;
    return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
  }
  const point = (attrs, tip) => `${attrs} class="pt" tabindex="0" role="img" aria-label="${esc(tip)}" data-tip="${esc(tip)}"`;
  const legend = (series) => (series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${esc(s.color)}"></i>${esc(s.name)}</span>`).join('')}</div>` : '');
  const emptyChart = (msg = 'Nothing to show for this period yet.') => `<p class="chart-empty">${esc(msg)}</p>`;
  const anyData = (series) => series.some((s) => s.values.some((v) => v));
  function axes(W, H, m, min, max, labels, step) {
    let out = '';
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4, y = H - m.b - ((H - m.t - m.b) * i) / 4;
      out += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="grid"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end" class="tick">${esc(compact(v))}</text>`;
    }
    const plot = (W - m.l - m.r) / labels.length;
    labels.forEach((l, i) => {
      if (i % step === 0) out += `<text x="${m.l + plot * (i + 0.5)}" y="${H - 8}" text-anchor="middle" class="tick">${esc(l)}</text>`;
    });
    return out;
  }
  const labelStep = (n, W) => Math.max(1, Math.ceil(n / Math.max(2, Math.floor(W / 62))));

  function bars(el, { labels, series, height = 240 }) {
    if (!labels.length || !anyData(series)) { el.innerHTML = emptyChart(); return; }
    const W = Math.max(280, el.clientWidth || 600), H = height, m = { t: 12, r: 8, b: 28, l: 42 };
    const top = niceMax(Math.max(...series.flatMap((s) => s.values)));
    const plot = (W - m.l - m.r) / labels.length, group = plot * 0.76, bw = Math.max(1.5, group / series.length), scale = (H - m.t - m.b) / top;
    let body = axes(W, H, m, 0, top, labels, labelStep(labels.length, W));
    labels.forEach((l, i) => series.forEach((s, j) => {
      const v = s.values[i] || 0, h = v * scale, x = m.l + plot * i + (plot - group) / 2 + j * bw;
      body += `<rect x="${x.toFixed(1)}" y="${(H - m.b - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${Math.max(v ? 1.5 : 0, h).toFixed(1)}" rx="2" fill="${esc(s.color)}" ${point('', `${l}, ${s.name}: ${FP.money(v)}`)}/>`;
    }));
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>${legend(series)}`;
  }
  function lines(el, { labels, series, height = 240 }) {
    if (labels.length < 2 || !anyData(series)) { el.innerHTML = emptyChart(); return; }
    const W = Math.max(280, el.clientWidth || 600), H = height, m = { t: 12, r: 8, b: 28, l: 46 };
    const vals = series.flatMap((s) => s.values), hi = niceMax(Math.max(0, ...vals)), lo = Math.min(0, ...vals) < 0 ? -niceMax(-Math.min(...vals)) : 0;
    const plot = (W - m.l - m.r) / labels.length, X = (i) => m.l + plot * (i + 0.5), Y = (v) => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
    let body = axes(W, H, m, lo, hi, labels, labelStep(labels.length, W));
    for (const s of series) {
      body += `<polyline fill="none" stroke="${esc(s.color)}" stroke-width="2.5" stroke-linejoin="round" points="${s.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
      s.values.forEach((v, i) => {
        if (labels.length > 62 && i % 3) return;
        body += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${labels.length > 40 ? 2 : 3.5}" fill="${esc(s.color)}" ${point('', `${labels[i]}, ${s.name}: ${FP.money(v)}`)}/>`;
      });
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>${legend(series)}`;
  }
  /* rows: [{label, value, color, id}]. onPick is wired through data-act, so a slice can open the filtered history. */
  function donut(el, { rows, act }) {
    const total = rows.reduce((s, r) => s + r.value, 0);
    if (!total) { el.innerHTML = emptyChart(); return; }
    const R = 70, C = 2 * Math.PI * R;
    let off = 0, arcs = '';
    for (const r of rows) {
      const len = (r.value / total) * C;
      const label = `${r.label}: ${FP.money(r.value)} (${Math.round((r.value / total) * 100)}%)`;
      arcs += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${esc(r.color)}" stroke-width="26" stroke-dasharray="${Math.max(len - 1.5, 0.5).toFixed(2)} ${(C - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 100 100)"${act ? ` data-act="${esc(act)}" data-id="${esc(r.id)}"` : ''} ${point('', label)}/>`;
      off += len;
    }
    el.innerHTML = `<div class="donut"><svg viewBox="0 0 200 200" width="190" height="190">${arcs}<text x="100" y="96" text-anchor="middle" class="tick">Total</text><text x="100" y="116" text-anchor="middle" class="donut-total">${esc(compact(total))}</text></svg>
      <ul class="donut-list">${rows.slice(0, 7).map((r) => `<li><i style="background:${esc(r.color)}"></i><span>${esc(r.label)}</span><b>${esc(FP.money(r.value))}</b></li>`).join('')}</ul></div>`;
  }

  /* one tooltip shared by every chart */
  let tip = null;
  function showTip(target) {
    tip ||= Object.assign(document.createElement('div'), { className: 'chart-tip' });
    if (!tip.isConnected) (target.closest('dialog') || document.body).append(tip);
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const b = target.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, b.left + b.width / 2 - w / 2))}px`;
    tip.style.top = `${Math.max(6, b.top - tip.offsetHeight - 8)}px`;
  }
  const hideTip = () => { if (tip) tip.hidden = true; };
  for (const ev of ['pointerover', 'focusin']) document.addEventListener(ev, (e) => { const t = e.target.closest?.('[data-tip]'); if (t) showTip(t); else if (ev === 'pointerover') hideTip(); });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);

  FP.charts = { bars, lines, donut, emptyChart };
})();
