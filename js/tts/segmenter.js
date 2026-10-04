// VOZI — División en oraciones (para síntesis y resaltado) y reconstrucción de párrafos.

const ABREV = new Set(['sr', 'sra', 'srta', 'sres', 'sras', 'dr', 'dra', 'dres', 'ing', 'lic', 'prof', 'profa', 'mg',
  'arq', 'ud', 'uds', 'vd', 'vds', 'etc', 'ej', 'gr', 'cf', 'vs', 'pág', 'págs', 'pp', 'núm', 'nro', 'no', 'art',
  'arts', 'cap', 'caps', 'vol', 'vols', 'ed', 'eds', 'fig', 'figs', 'aprox', 'máx', 'mín', 'tel', 'av', 'avda', 'cra',
  'cl', 'dpto', 'depto', 'cía', 'ltda', 'sto', 'sta', 'gral', 'cnel', 'pdte', 'adm', 'admón', 'al', 'ibíd', 'cit',
  'ss', 'atte', 'izq', 'der', 'dcha', 'obs', 'p', 'pl', 'op', 'ee', 'uu', 'c', 'm', 'mz', 'bto', 'inc', 'jr',
  'mr', 'mrs', 'st', 'col']);

const CIERRE = `["'”’»)\\]]*`;

// Devuelve [{start, end}] (offsets en el texto original del párrafo)
export function dividirOraciones(texto) {
  const res = [];
  const re = new RegExp(`([.!?…]+|\\.\\.\\.)${CIERRE}(?=\\s+|$)`, 'g');
  let inicio = 0, m;
  while ((m = re.exec(texto))) {
    const fin = m.index + m[0].length;
    const antes = texto.slice(inicio, m.index);
    const resto = texto.slice(fin);
    const sig = resto.match(/^\s+(\S)/);
    if (m[1] === '.' || m[1] === '…') {
      const palabra = (antes.match(/([\p{L}]+)$/u) || [])[1] || '';
      if (palabra && ABREV.has(palabra.toLowerCase())) continue;           // abreviatura
      if (/^\p{Lu}$/u.test(palabra) && sig && /\p{Lu}/u.test(sig[1])) continue;  // inicial: "J. R. Pérez"
      if (sig && /[\p{Ll}]/u.test(sig[1])) continue;                       // siguiente empieza en minúscula
    }
    if (sig && /[,;:]/.test(sig[1])) continue;
    if (!sig && resto.trim()) continue;
    res.push({ start: inicio, end: fin });
    inicio = fin;
    while (inicio < texto.length && /\s/.test(texto[inicio])) inicio++;
    re.lastIndex = inicio;
  }
  if (inicio < texto.length && texto.slice(inicio).trim()) res.push({ start: inicio, end: texto.length });
  return res.length ? res : [{ start: 0, end: texto.length }];
}

// Divide una oración demasiado larga para el modelo en partes naturales (por ; : , o espacios)
export function partirLarga(texto, max = 280) {
  if (texto.length <= max) return [texto];
  const mitad = texto.length / 2;
  let mejor = -1, mejorDist = Infinity;
  for (const sep of [/[;:]\s/g, /,\s/g, /\s(?:y|o|pero|aunque|porque|que|mientras|cuando)\s/g, /\s/g]) {
    sep.lastIndex = 0;
    let m;
    while ((m = sep.exec(texto))) {
      const pos = m.index + 1;
      const d = Math.abs(pos - mitad);
      if (pos > 40 && texto.length - pos > 40 && d < mejorDist) { mejor = pos; mejorDist = d; }
    }
    if (mejor > 0 && mejorDist < texto.length * 0.3) break;
  }
  if (mejor < 0) return [texto];
  return [...partirLarga(texto.slice(0, mejor).trim(), max), ...partirLarga(texto.slice(mejor).trim(), max)];
}

const TERMINAL = /[.!?…:"”»)]$/;

// Une líneas de un texto plano con saltos de línea artificiales.
// Devuelve una lista de párrafos (strings) sin alterar las palabras.
export function reconstruirParrafos(texto) {
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/g, ''));
  const hayBlancos = lineas.some((l, i) => !l.trim() && i > 0 && i < lineas.length - 1);
  const parrafos = [];
  let actual = '';
  const cerrar = () => { if (actual.trim()) parrafos.push(actual.trim()); actual = ''; };
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (!l) { cerrar(); continue; }
    if (!actual) { actual = l; continue; }
    if (unirLineas(actual, l, hayBlancos)) actual = juntar(actual, l);
    else { cerrar(); actual = l; }
  }
  cerrar();
  return parrafos;
}

export function unirLineas(prev, sig, blandos) {
  if (/^[•▪◦●■□➢►–—-]\s/.test(sig) || /^\d{1,2}[.)]\s/.test(sig)) return false; // nueva viñeta
  if (/[\p{L}]-$/u.test(prev) && /^\p{Ll}/u.test(sig)) return true;            // palabra cortada
  if (/^\p{Ll}/u.test(sig)) return true;                                           // continúa en minúscula
  if (!TERMINAL.test(prev)) return blandos || prev.length > 50;
  return false;
}

// Une dos líneas reparando palabras cortadas con guion al final de línea
export function juntar(prev, sig) {
  const m = prev.match(/([\p{L}]+)-$/u);
  if (m && /^\p{Ll}/u.test(sig)) {
    // Mantener guion en compuestos tipo "teórico-práctico" (segunda parte con tilde o forma de palabra completa)
    const resto = sig.match(/^[\p{L}]+/u)[0];
    if (/^(?:[\p{Ll}]+)$/u.test(resto) && esCompuesto(m[1], resto)) return prev + sig;
    return prev.slice(0, -1) + sig;
  }
  return prev + ' ' + sig;
}

function esCompuesto(a, b) {
  // Heurística: ambas partes con terminaciones típicas de adjetivo/sustantivo completos ("económico-social")
  return /(ico|ica|al|ivo|iva|ario|aria|ano|ana)$/.test(a) && /(ico|ica|al|ivo|iva|ario|aria|ano|ana|os|as)$/.test(b) && a.length > 4 && b.length > 4;
}
