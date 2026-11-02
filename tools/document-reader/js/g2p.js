/* Document Reader — turns English text into the phonemes the voice expects. Words come from the CMU Pronouncing
   Dictionary; anything it doesn't know is built from spelling rules. Numbers are written out first. */
const IPA = {
  AA: 'ɑː', AE: 'æ', AO: 'ɔː', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', EY: 'eɪ', IH: 'ɪ', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'uː',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};
const UK = { OW: 'əʊ', AA: 'ɑː', AO: 'ɔː', AE: 'a', EH: 'ɛ', EY: 'eɪ' };
const VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)/;
// Said lightly in running speech, so they carry no stress mark.
const LIGHT = new Set('the a an of to and or but for nor in on at by with from as is am are was were be been it its he him his she her they them their we us our you your my me that this than then if so not do does did has have had can will would could should'.split(' '));

let dict = new Map();
export function setDictionary(text) {
  dict = new Map();
  for (const line of text.split('\n')) {
    const at = line.indexOf(' ');
    // Alternative pronunciations are written "word(2)", and the first listed is the usual one.
    if (at < 1 || line[at - 1] === ')' || line[0] === '#') continue;
    dict.set(line.slice(0, at), line.slice(at + 1).split('#')[0].trim().split(' '));
  }
}

/* ---------- numbers ---------- */
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ' ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const SCALE = ['', 'thousand', 'million', 'billion', 'trillion'];
function under1000(n) {
  const parts = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) parts.push(ONES[n]); } else if (n) parts.push(ONES[n]);
  return parts.join(' ');
}
function spellDigits(s) { return [...s].map((d) => ONES[+d]).join(' '); }
function cardinal(s) {
  if (s.length > 15) return spellDigits(s);
  let n = +s;
  if (!n) return 'zero';
  const groups = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) {
    const g = n % 1000;
    if (g) groups.unshift(`${under1000(g)}${SCALE[i] ? ` ${SCALE[i]}` : ''}`);
  }
  return groups.join(' ');
}
function year(s) {
  const a = +s.slice(0, 2), b = +s.slice(2);
  if (a === 20 && b < 10) return cardinal(s);
  if (b === 0) return `${under1000(a)} hundred`;
  return `${under1000(a)} ${b < 10 ? `oh ${ONES[b]}` : under1000(b)}`;
}
const ORDINAL = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
function ordinal(s) {
  const words = cardinal(s).split(' ');
  const last = words.pop();
  return [...words, ORDINAL[last] || (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`)].join(' ');
}
function number(raw) {
  const s = raw.replace(/,/g, '');
  if (s.includes('.')) { const [w, f] = s.split('.'); return `${w ? cardinal(w) : ''} point ${spellDigits(f)}`.trim(); }
  if (s.length > 1 && s[0] === '0') return spellDigits(s);
  return /^(1[1-9]|20)\d\d$/.test(s) && !raw.includes(',') ? year(s) : cardinal(s);
}
export function expandNumbers(text) {
  return text
    .replace(/\$(\d[\d,]*)(?:\.(\d\d))?(?!\d)/g, (_, d, c) => `${number(d)} ${d === '1' ? 'dollar' : 'dollars'}${c && +c ? ` and ${cardinal(c.replace(/^0/, ''))} ${+c === 1 ? 'cent' : 'cents'}` : ''}`)
    .replace(/£(\d[\d,]*)/g, (_, d) => `${number(d)} ${d === '1' ? 'pound' : 'pounds'}`)
    .replace(/€(\d[\d,]*)/g, (_, d) => `${number(d)} euros`)
    .replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g, (_, d) => `${number(d)} percent`)
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, d) => ordinal(d))
    .replace(/(\d)-(?=\d)/g, '$1 to ')
    .replace(/\d[\d,]*\.\d+|\.\d+|\d{1,3}(?:,\d{3})+|\d+/g, (d) => ` ${number(d)} `)
    .replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/@/g, ' at ');
}

/* ---------- words the dictionary doesn't know ---------- */
const LETTERS = { a: 'EY1', b: 'B IY1', c: 'S IY1', d: 'D IY1', e: 'IY1', f: 'EH1 F', g: 'JH IY1', h: 'EY1 CH', i: 'AY1', j: 'JH EY1', k: 'K EY1', l: 'EH1 L', m: 'EH1 M', n: 'EH1 N', o: 'OW1', p: 'P IY1', q: 'K Y UW1', r: 'AA1 R', s: 'EH1 S', t: 'T IY1', u: 'Y UW1', v: 'V IY1', w: 'D AH1 B AH0 L Y UW0', x: 'EH1 K S', y: 'W AY1', z: 'Z IY1' };
// Longest spellings are tried first at each position.
const RULES = [
  ['tion', 'SH AH N'], ['sion', 'ZH AH N'], ['ough', 'OW'], ['augh', 'AO'], ['eigh', 'EY'], ['igh', 'AY'], ['tch', 'CH'], ['dge', 'JH'], ['sch', 'SH'], ['ture', 'CH ER'], ['ous', 'AH S'],
  ['ch', 'CH'], ['sh', 'SH'], ['th', 'TH'], ['ph', 'F'], ['wh', 'W'], ['ck', 'K'], ['ng', 'NG'], ['qu', 'K W'], ['kn', 'N'], ['wr', 'R'], ['gh', ''],
  ['ee', 'IY'], ['ea', 'IY'], ['oo', 'UW'], ['ai', 'EY'], ['ay', 'EY'], ['oa', 'OW'], ['oi', 'OY'], ['oy', 'OY'], ['ou', 'AW'], ['ow', 'OW'], ['au', 'AO'], ['aw', 'AO'], ['ie', 'IY'], ['ei', 'EY'], ['ey', 'IY'], ['ew', 'UW'], ['ue', 'UW'],
  ['ar', 'AA R'], ['er', 'ER'], ['ir', 'ER'], ['ur', 'ER'], ['or', 'AO R'],
  ['a', 'AE'], ['b', 'B'], ['d', 'D'], ['e', 'EH'], ['f', 'F'], ['h', 'HH'], ['i', 'IH'], ['j', 'JH'], ['k', 'K'], ['l', 'L'], ['m', 'M'], ['n', 'N'], ['o', 'AA'], ['p', 'P'], ['r', 'R'], ['s', 'S'], ['t', 'T'], ['u', 'AH'], ['v', 'V'], ['w', 'W'], ['x', 'K S'], ['y', 'Y'], ['z', 'Z'],
];
function spell(word) {
  const w = word.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  const out = [];
  for (let i = 0; i < w.length;) {
    const rest = w.slice(i), next = w[i + 1];
    // A silent final e lengthens the vowel before it: "tribe", "stone".
    const magic = /^[aeiou][bcdfgklmnprstvz]e$/.test(rest);
    if (magic) { out.push({ a: 'EY', e: 'IY', i: 'AY', o: 'OW', u: 'UW' }[w[i]], ...(rest[1] === 'c' ? ['S'] : rest[1] === 'g' ? ['JH'] : [RULES.find((r) => r[0] === rest[1])[1]])); break; }
    if (w[i] === 'c') { out.push(/[eiy]/.test(next || '') ? 'S' : 'K'); i++; continue; }
    if (w[i] === 'g') { out.push(/[eiy]/.test(next || '') ? 'JH' : 'G'); i++; continue; }
    if (w[i] === 'y' && i > 0) { out.push(i === w.length - 1 ? 'IY' : 'IH'); i++; continue; }
    if (rest === 'e' && out.some((p) => VOWEL.test(p))) break;
    const rule = RULES.find((r) => rest.startsWith(r[0]));
    if (!rule) { i++; continue; }
    if (rule[1]) out.push(...rule[1].split(' '));
    i += rule[0].length;
  }
  // Doubled letters are one sound, and the first vowel takes the stress.
  const merged = out.flatMap((p) => p.split(' ')).filter((p, n, a) => p !== a[n - 1]);
  let stressed = false;
  return merged.map((p) => { if (!VOWEL.test(p)) return p; const mark = stressed ? '0' : '1'; stressed = true; return p + mark; });
}
function pronounce(word) {
  const w = word.toLowerCase();
  const hit = dict.get(w);
  if (hit) return hit;
  if (/^[A-Z]{2,6}s?$/.test(word)) return [...word.toLowerCase()].flatMap((c) => LETTERS[c].split(' '));
  let m;
  if ((m = /^(.+)'s$/.exec(w)) || (m = /^(.+[^s])s$/.exec(w))) {
    const stem = dict.get(m[1]);
    if (stem) {
      const last = stem[stem.length - 1];
      return [...stem, ...(/^(S|Z|SH|ZH|CH|JH)$/.test(last) ? ['IH0', 'Z'] : /^(P|T|K|F|TH)$/.test(last) ? ['S'] : ['Z'])];
    }
  }
  if ((m = /^(.+)'(?:d|ll|re|ve|t)$/.exec(w)) && dict.get(m[1])) return [...dict.get(m[1]), ...spell(w.slice(m[1].length + 1))];
  if ((m = /^(.+?)(ing|ed|ly|er|est|ness|ment)$/.exec(w))) {
    const stem = dict.get(m[1]) || dict.get(`${m[1]}e`);
    const ending = { ing: 'IH0 NG', ed: 'D', ly: 'L IY0', er: 'ER0', est: 'AH0 S T', ness: 'N AH0 S', ment: 'M AH0 N T' }[m[2]];
    if (stem) return [...stem, ...(m[2] === 'ed' && /^(T|D)$/.test(stem[stem.length - 1]) ? ['IH0', 'D'] : m[2] === 'ed' && /^(P|K|F|S|SH|CH|TH)$/.test(stem[stem.length - 1]) ? ['T'] : ending.split(' '))];
  }
  return spell(w);
}

/* ---------- phonemes ---------- */
function toIpa(arpabet, british, light) {
  let out = '';
  arpabet.forEach((token, n) => {
    const m = /^([A-Z]+)(\d?)$/.exec(token);
    if (!m) return;
    const [, p, stress] = m;
    const next = arpabet[n + 1] || '';
    // Most of Britain doesn't say an r unless a vowel follows it.
    if (british && p === 'R' && !VOWEL.test(next)) return;
    if (!light && stress === '1') out += 'ˈ';
    else if (!light && stress === '2') out += 'ˌ';
    if (p === 'AH') out += stress === '1' && !light ? 'ʌ' : 'ə';
    else if (p === 'ER') out += stress === '0' || light ? (british ? 'ə' : 'ɚ') : 'ɜː';
    else if (p === 'IY') out += stress === '0' ? 'i' : 'iː';
    else out += (british && UK[p]) || IPA[p] || '';
  });
  return out;
}
export function textToPhonemes(text, lang = 'en-us') {
  const british = /gb|uk|rp/i.test(lang);
  const clean = expandNumbers(text.replace(/[‘’]/g, "'")).normalize('NFC');
  let out = '';
  for (const m of clean.matchAll(/[\p{L}\p{M}]+(?:'[\p{L}]+)*|[.,;:!?—…"()]+|\s+|./gu)) {
    const token = m[0];
    if (/^\s+$/.test(token)) { if (out && !out.endsWith(' ')) out += ' '; continue; }
    if (/^[.,;:!?—…"()]+$/.test(token)) { out = out.trimEnd() + token; continue; }
    if (!/\p{L}/u.test(token)) { if (out && !out.endsWith(' ')) out += ' '; continue; }
    out += toIpa(pronounce(token), british, LIGHT.has(token.toLowerCase()));
  }
  return out.trim();
}
