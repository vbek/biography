/*
 * Turns a TeX log into clickable issues: { level: 'error'|'warning'|'typesetting', file, line, message, context }.
 * `projectDir` is the directory the engine ran in, so paths can be made project-relative.
 */
(function (root) {
  'use strict';

  const FILE_TOKEN_RE = /\.(tex|sty|cls|cfg|def|clo|fd|ltx|bbl|aux|toc|lof|lot|out|bib|ldf|cbx|bbx|lbx|tikz|pgf|nav|snm|vrb|ind)$/i;

  function parse(log, projectDir = '') {
    const items = [];
    const seen = new Set();
    const lines = String(log || '').split(/\r?\n/);
    const stack = [];
    const dir = projectDir.replace(/\/+$/, '');
    const current = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i]; return null; };
    const rel = f => {
      if (!f) return null;
      let s = f.replace(/^"+|"+$/g, '').replace(/\\/g, '/');
      if (dir && s.startsWith(`${dir}/`)) s = s.slice(dir.length + 1);
      else if (s.startsWith('/')) return null;
      s = s.replace(/^(\.\/)+/, '').replace(/\/\.\//g, '/');
      if (/^output\./.test(s)) return null;
      return s || null;
    };
    const push = item => {
      const key = `${item.level}|${item.file}|${item.line}|${item.message}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };
    const trackFiles = line => {
      const re = /\(("[^"]+"|[^\s()]*)|\)/g;
      let m;
      while ((m = re.exec(line))) {
        if (m[0] === ')') stack.pop();
        else stack.push(m[1] && FILE_TOKEN_RE.test(m[1].replace(/"/g, '')) ? m[1] : null);
      }
    };
    const lineNoAfter = (i, max = 12) => {
      for (let j = i + 1; j < Math.min(lines.length, i + max); j++) {
        const m = /^l\.(\d+)/.exec(lines[j]);
        if (m) return { line: Number(m[1]), at: j };
      }
      return null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (line.startsWith('===== ') || line.startsWith('[Texlume]')) break; // appended tool output

      if ((m = /^(.+?\.[A-Za-z0-9]+):(\d+): (.*)$/.exec(line)) && !/^\s/.test(line)) {
        const ctx = lineNoAfter(i);
        const context = ctx ? lines.slice(ctx.at, ctx.at + 2).join('\n') : '';
        let message = m[3];
        if (/LaTeX Error|Package .* Error/.test(message) && lines[i + 1] && !/^(See |Type |l\.\d)/.test(lines[i + 1]) && lines[i + 1].trim()) {
          message += ` ${lines[i + 1].trim()}`;
        }
        push({ level: 'error', file: rel(m[1]), line: Number(m[2]), message, context });
        if (ctx) i = ctx.at + 1;
        continue;
      }

      if ((m = /^! (.*)$/.exec(line)) || (m = /^!\s*(pdfTeX error.*)$/.exec(line))) {
        const ctx = lineNoAfter(i);
        const context = ctx ? lines.slice(ctx.at, ctx.at + 2).join('\n') : '';
        if (!/^Emergency stop\.?$/.test(m[1]) || !items.some(x => x.level === 'error')) {
          push({ level: 'error', file: rel(current()), line: ctx ? ctx.line : null, message: m[1].replace(/\/bin\/busytex/g, 'pdflatex'), context });
        }
        if (ctx) i = ctx.at + 1;
        continue;
      }

      if ((m = /^(LaTeX|Package|Class|pdfTeX|LuaTeX|XeTeX)(?:\s+(\S+))?\s+Warning:\s*(.*)$/.exec(line))) {
        let message = m[3];
        const pkg = m[2];
        for (let j = i + 1; j < lines.length && j < i + 8; j++) {
          const nl = lines[j];
          if (!nl.trim()) break;
          if (pkg && nl.startsWith(`(${pkg})`)) { message += ` ${nl.slice(pkg.length + 2).trim()}`; i = j; continue; }
          if (!pkg && /^[a-z(]/.test(nl) && !/^\(/.test(nl)) { message += ` ${nl.trim()}`; i = j; continue; }
          break;
        }
        const ln = /on input line (\d+)/.exec(message);
        push({ level: 'warning', file: rel(current()), line: ln ? Number(ln[1]) : null, message: (pkg && m[1] !== 'LaTeX' ? `${pkg}: ` : '') + message.replace(/\s+/g, ' ').trim() });
        continue;
      }

      if ((m = /^(Over|Under)full \\([hv])box (.*)$/.exec(line))) {
        const ln = /lines? (\d+)/.exec(m[3]);
        push({ level: 'typesetting', file: rel(current()), line: ln ? Number(ln[1]) : null, message: line.trim() });
        while (i + 1 < lines.length && lines[i + 1].trim() && /^\[\]|^\s|\\/.test(lines[i + 1]) && !/^[(<[]?\S+\.(tex|sty)/.test(lines[i + 1])) i++;
        continue;
      }

      trackFiles(line);
    }

    // bibtex output appended by the worker
    const bib = /===== bibtex =====([\s\S]*?)(?:\n=====|$)/.exec(log || '');
    if (bib) {
      for (const m of bib[1].matchAll(/^(?:Warning--.*|.*I couldn't open.*|.*I found no.*|.*Repeated entry.*)$/gm)) {
        push({ level: /^Warning/.test(m[0]) ? 'warning' : 'error', file: null, line: null, message: `BibTeX: ${m[0].trim()}` });
      }
    }
    return items;
  }

  root.LogParse = { parse };
})(self);
