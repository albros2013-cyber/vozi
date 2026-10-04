// VOZI — Normalización de texto en inglés para la voz (solo forma hablada; el texto no cambia).
const U = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const D = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function menorMil(n) {
  const c = Math.floor(n / 100), r = n % 100, out = [];
  if (c) out.push(U[c] + ' hundred');
  if (r) out.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? '-' + U[r % 10] : ''));
  return out.join(' ');
}

export function numberToWords(num) {
  let n = typeof num === 'bigint' ? num : BigInt(Math.trunc(Number(num)));
  if (n === 0n) return 'zero';
  const escalas = ['', ' thousand', ' million', ' billion', ' trillion'];
  const partes = [];
  let i = 0;
  while (n > 0n && i < escalas.length) {
    const grupo = Number(n % 1000n);
    if (grupo) partes.unshift(menorMil(grupo) + escalas[i]);
    n /= 1000n; i++;
  }
  return partes.join(' ');
}

function year(y) {
  if (y >= 2000 && y < 2010) return numberToWords(y);
  const a = Math.floor(y / 100), b = y % 100;
  return numberToWords(a) + ' ' + (b === 0 ? 'hundred' : b < 10 ? 'oh ' + U[b] : numberToWords(b));
}

function ordinal(n) {
  const w = numberToWords(n);
  const irr = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  const m = w.match(/([a-z]+)$/);
  const last = m[1];
  if (irr[last]) return w.slice(0, -last.length) + irr[last];
  if (last.endsWith('y')) return w.slice(0, -1) + 'ieth';
  return w + 'th';
}

function cifra(raw) {
  const s = raw.replace(/,(?=\d{3}\b)/g, '');
  const [e, d] = s.split('.');
  let out = numberToWords(BigInt(e || '0'));
  if (d) out += ' point ' + d.split('').map((c) => U[+c]).join(' ');
  return out;
}

const ABBR = [['Mr.', 'Mister'], ['Mrs.', 'Missus'], ['Ms.', 'Miz'], ['Dr.', 'Doctor'], ['Prof.', 'Professor'], ['St.', 'Saint'],
  ['vs.', 'versus'], ['e.g.', 'for example'], ['i.e.', 'that is'], ['etc.', 'et cetera'], ['approx.', 'approximately'],
  ['Inc.', 'Incorporated'], ['Ltd.', 'Limited'], ['Corp.', 'Corporation'], ['Jr.', 'Junior'], ['Sr.', 'Senior'],
  ['No.', 'number'], ['Fig.', 'figure'], ['p.', 'page'], ['pp.', 'pages'], ['et al.', 'and colleagues']];

const N = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

export function normalizarEn(texto, { diccionario = [] } = {}) {
  let t = ' ' + texto.normalize('NFC') + ' ';
  for (const { escrito, dicho } of diccionario) if (escrito) t = t.split(escrito).join(dicho);
  t = t.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/ /g, ' ');
  for (const [a, b] of ABBR) t = t.replace(new RegExp('(^|[\\s(])' + a.replace(/\./g, '\\.') + '(?=[\\s,;:)]|$)', 'g'), '$1' + b);
  t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n) => ordinal(+n));
  t = t.replace(new RegExp(`(US)?\\$\\s?(${N})(\\s?(million|billion|thousand|M|B|K))?`, 'g'), (_, us, n, __, esc) => {
    const e = { M: 'million', B: 'billion', K: 'thousand' }[esc] || esc;
    return `${cifra(n)}${e ? ' ' + e : ''} dollars`;
  });
  t = t.replace(new RegExp(`(${N})\\s?(€|euros?)`, 'g'), (_, n) => `${cifra(n)} euros`);
  t = t.replace(new RegExp(`(${N})\\s?%`, 'g'), (_, n) => `${cifra(n)} percent`);
  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => `${numberToWords(+h)}${+m ? ' ' + (+m < 10 ? 'oh ' + U[+m] : numberToWords(+m)) : " o'clock"}`);
  t = t.replace(/\b(\d{4})\s?[–—-]\s?(\d{4})\b/g, (_, a, b) => `${a} to ${b}`);
  t = t.replace(/\b(1[1-9]\d\d|20\d\d)\b(?![.,]\d)/g, (_, y) => year(+y));
  t = t.replace(new RegExp(`(^|[^\\w])(${N})(?![\\w])`, 'g'), (_, pre, n) => pre + cifra(n));
  t = t.replace(/\s&\s/g, ' and ').replace(/(?<![mk])[⁰¹²³⁴⁵⁶⁷⁸⁹†]+/gu, '');
  t = t.replace(/(^|\n)\s*[•▪◦●■□➢►–—-]\s+/g, '$1');
  return t.replace(/[ \t]+/g, ' ').trim();
}
