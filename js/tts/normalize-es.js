// VOZI — Normalización de texto en español para síntesis de voz.
// Solo produce la forma HABLADA. El texto original nunca se modifica:
// la app muestra siempre el original y sintetiza esta versión.

const UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve'];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos',
  'setecientos', 'ochocientos', 'novecientos'];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];

const ORDINALES_M = ['', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo',
  'noveno', 'décimo', 'undécimo', 'duodécimo'];

// Género: 'm' (por defecto), 'f', o 'apocope' (un/veintiún antes de sustantivo masculino)
function menorMil(n, genero) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100), r = n % 100;
  let out = [];
  if (c) {
    let cw = CENTENAS[c];
    if (genero === 'f' && c > 1) cw = cw.replace(/ientos$/, 'ientas').replace(/ientos$/, 'ientas').replace(/quinientos/, 'quinientas');
    out.push(cw);
  }
  if (r) {
    let w;
    if (r < 30) w = UNIDADES[r];
    else {
      const d = Math.floor(r / 10), u = r % 10;
      w = DECENAS[d] + (u ? ' y ' + UNIDADES[u] : '');
    }
    out.push(w);
  }
  let s = out.join(' ');
  if (genero === 'f') s = s.replace(/veintiuno$/, 'veintiuna').replace(/(^| )uno$/, '$1una');
  else if (genero === 'apocope') s = s.replace(/veintiuno$/, 'veintiún').replace(/(^| )uno$/, '$1un');
  return s;
}

// Convierte un entero no negativo (hasta 10^18) en palabras.
export function numeroALetras(num, genero = 'm') {
  let n = typeof num === 'bigint' ? num : BigInt(Math.trunc(Number(num)));
  if (n === 0n) return 'cero';
  if (n < 0n) return 'menos ' + numeroALetras(-n, genero);
  const partes = [];
  const billones = n / 1000000000000n; n %= 1000000000000n;
  const millones = n / 1000000n; n %= 1000000n;
  const miles = n / 1000n; const resto = Number(n % 1000n);
  if (billones) partes.push(billones === 1n ? 'un billón' : numeroALetras(billones, 'apocope') + ' billones');
  if (millones) {
    // "mil millones" para valores >= 1000 millones
    const mm = millones;
    if (mm === 1n) partes.push('un millón');
    else partes.push(numeroALetras(mm, 'apocope') + ' millones');
  }
  if (miles) {
    const g = genero === 'f' ? 'f' : 'apocope';
    partes.push(miles === 1n ? 'mil' : menorMilBig(miles, g) + ' mil');
  }
  if (resto) partes.push(menorMil(resto, genero));
  return partes.join(' ').replace(/\s+/g, ' ').trim();
}
function menorMilBig(n, g) {
  // n < 1000000 aquí (miles de 1..999); para 1000..999999 de "miles" no ocurre
  const v = Number(n);
  if (v < 1000) return menorMil(v, g);
  return numeroALetras(BigInt(v), g);
}

export function ordinal(n, genero = 'm') {
  let w;
  if (n <= 12) w = ORDINALES_M[n];
  else if (n < 20) w = 'décimo ' + ORDINALES_M[n - 10];
  else if (n === 20) w = 'vigésimo';
  else if (n < 30) w = 'vigésimo ' + ORDINALES_M[n - 20];
  else return numeroALetras(n, genero);
  if (genero === 'f') w = w.split(' ').map((p) => p.replace(/o$/, 'a')).join(' ');
  return w;
}

function romanoAEntero(s) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]], b = v[s[i + 1]] || 0;
    total += a < b ? -a : a;
  }
  return total;
}

// Palabras femeninas comunes terminadas en -a que en realidad son masculinas, y viceversa
const MASC_EN_A = new Set(['día', 'días', 'mapa', 'mapas', 'problema', 'problemas', 'programa', 'programas',
  'sistema', 'sistemas', 'tema', 'temas', 'idioma', 'idiomas', 'clima', 'climas', 'planeta', 'planetas',
  'dilema', 'dilemas', 'esquema', 'esquemas', 'poema', 'poemas', 'drama', 'dramas', 'teorema', 'teoremas',
  'diagrama', 'diagramas', 'lema', 'lemas', 'síntoma', 'síntomas', 'cometa', 'cometas', 'pijama']);
const FEM_NO_A = new Set(['personas', 'veces', 'vez', 'horas', 'mujeres', 'mujer', 'ciudades', 'ciudad', 'unidades',
  'unidad', 'clases', 'clase', 'leyes', 'ley', 'noches', 'noche', 'calles', 'calle', 'partes', 'parte',
  'opciones', 'opción', 'preguntas', 'lecciones', 'lección', 'naciones', 'nación', 'sesiones', 'sesión',
  'universidades', 'universidad', 'empresas', 'imágenes', 'imagen', 'páginas', 'fuentes', 'fuente', 'redes',
  'red', 'muestras', 'actividades', 'actividad', 'funciones', 'función', 'variables', 'variable']);

function generoDeSiguiente(palabra) {
  if (!palabra) return 'm';
  const p = palabra.toLowerCase();
  if (MASC_EN_A.has(p)) return 'apocope';
  if (FEM_NO_A.has(p)) return 'f';
  if (/(a|as)$/.test(p) && p.length > 2) return 'f';
  if (/(ción|siones|ciones|sión|dad|dades|tud|tudes)$/.test(p)) return 'f';
  return 'apocope';
}

// Interpreta una cifra escrita con separadores. Devuelve {entero: BigInt, decimales: string|null, sep: ','|'.'|null}
export function parseCifra(raw) {
  const s = raw.replace(/\s/g, '');
  // 1.500.000,25  (miles con punto, decimal con coma — convención colombiana)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    const [e, d] = s.split(',');
    return { entero: BigInt(e.replace(/\./g, '')), decimales: d ?? null, sep: ',' };
  }
  // 1,500,000.25 (miles con coma, decimal con punto)
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    const [e, d] = s.split('.');
    return { entero: BigInt(e.replace(/,/g, '')), decimales: d ?? null, sep: '.' };
  }
  if (/^\d+,\d+$/.test(s)) { const [e, d] = s.split(','); return { entero: BigInt(e), decimales: d, sep: ',' }; }
  if (/^\d+\.\d+$/.test(s)) { const [e, d] = s.split('.'); return { entero: BigInt(e), decimales: d, sep: '.' }; }
  if (/^\d+$/.test(s)) return { entero: BigInt(s), decimales: null, sep: null };
  return null;
}

function decimalesALetras(d) {
  // "05" -> "cero cinco"; "5" -> "cinco"; "25" -> "veinticinco"; >3 cifras -> dígito a dígito
  if (d.length > 3 || d.startsWith('0')) return d.split('').map((c) => UNIDADES[+c]).join(' ');
  return numeroALetras(BigInt(d));
}

export function cifraALetras(raw, genero = 'm') {
  const p = parseCifra(raw);
  if (!p) return raw;
  let s = numeroALetras(p.entero, p.decimales ? 'm' : genero);
  if (p.decimales) s += (p.sep === ',' ? ' coma ' : ' punto ') + decimalesALetras(p.decimales);
  return s;
}

// Abreviaturas (con punto). La clave se compara sin distinguir mayúsculas salvo indicación.
const ABREVIATURAS = [
  ['Sr.', 'señor'], ['Sra.', 'señora'], ['Srta.', 'señorita'], ['Sres.', 'señores'], ['Sras.', 'señoras'],
  ['Dr.', 'doctor'], ['Dra.', 'doctora'], ['Dres.', 'doctores'], ['Ing.', 'ingeniero'], ['Lic.', 'licenciado'],
  ['Prof.', 'profesor'], ['Profa.', 'profesora'], ['Mg.', 'magíster'], ['Arq.', 'arquitecto'],
  ['Ud.', 'usted'], ['Uds.', 'ustedes'], ['Vd.', 'usted'], ['Vds.', 'ustedes'],
  ['etc.', 'etcétera'], ['p. ej.', 'por ejemplo'], ['p.ej.', 'por ejemplo'], ['v. gr.', 'verbigracia'],
  ['i. e.', 'es decir'], ['e. g.', 'por ejemplo'], ['cf.', 'confróntese'], ['vs.', 'versus'],
  ['págs.', 'páginas'], ['pág.', 'página'], ['pp.', 'páginas'], ['núm.', 'número'], ['nro.', 'número'],
  ['art.', 'artículo'], ['arts.', 'artículos'], ['cap.', 'capítulo'], ['caps.', 'capítulos'], ['vol.', 'volumen'],
  ['vols.', 'volúmenes'], ['ed.', 'edición'], ['eds.', 'editores'], ['fig.', 'figura'], ['figs.', 'figuras'],
  ['aprox.', 'aproximadamente'], ['máx.', 'máximo'], ['mín.', 'mínimo'], ['tel.', 'teléfono'],
  ['Av.', 'avenida'], ['Avda.', 'avenida'], ['Cra.', 'carrera'], ['Cl.', 'calle'], ['Dpto.', 'departamento'],
  ['Depto.', 'departamento'], ['Cía.', 'compañía'], ['Ltda.', 'limitada'], ['S.A.S.', 'ese a ese'],
  ['S. A. S.', 'ese a ese'], ['S.A.', 'ese a'], ['S. A.', 'ese a'], ['EE. UU.', 'Estados Unidos'],
  ['EE.UU.', 'Estados Unidos'], ['a. C.', 'antes de Cristo'], ['d. C.', 'después de Cristo'],
  ['a. m.', 'a eme'], ['p. m.', 'pe eme'], ['a.m.', 'a eme'], ['p.m.', 'pe eme'],
  ['Sto.', 'santo'], ['Sta.', 'santa'], ['Gral.', 'general'], ['Cnel.', 'coronel'], ['Pdte.', 'presidente'],
  ['Admón.', 'administración'], ['Adm.', 'administración'], ['Bto.', 'bloque'], ['Mz.', 'manzana'],
  ['et al.', 'y colaboradores'], ['ibíd.', 'ibídem'], ['op. cit.', 'obra citada'], ['ss.', 'siguientes'],
  ['Atte.', 'atentamente'], ['izq.', 'izquierda'], ['der.', 'derecha'], ['dcha.', 'derecha'], ['obs.', 'observación'],
];

const UNIDADES_MEDIDA = {
  km: ['kilómetro', 'kilómetros'], m: ['metro', 'metros'], cm: ['centímetro', 'centímetros'],
  mm: ['milímetro', 'milímetros'], kg: ['kilogramo', 'kilogramos'], g: ['gramo', 'gramos'],
  mg: ['miligramo', 'miligramos'], l: ['litro', 'litros'], L: ['litro', 'litros'], ml: ['mililitro', 'mililitros'],
  h: ['hora', 'horas'], min: ['minuto', 'minutos'], seg: ['segundo', 'segundos'], ha: ['hectárea', 'hectáreas'],
  'km/h': ['kilómetro por hora', 'kilómetros por hora'], 'm²': ['metro cuadrado', 'metros cuadrados'],
  m2: ['metro cuadrado', 'metros cuadrados'], 'km²': ['kilómetro cuadrado', 'kilómetros cuadrados'],
  'm³': ['metro cúbico', 'metros cúbicos'], '°C': ['grado centígrado', 'grados centígrados'],
  'ºC': ['grado centígrado', 'grados centígrados'], GB: ['gigabyte', 'gigabytes'], MB: ['megabyte', 'megabytes'],
  TB: ['terabyte', 'terabytes'], kW: ['kilovatio', 'kilovatios'], kWh: ['kilovatio hora', 'kilovatios hora'],
};

const PALABRAS_ROMANOS = /\b(siglo|siglos|capítulo|capítulos|tomo|tomos|volumen|libro|parte|título|acto|fase|etapa|nivel|grado|tramo|anexo|sección)\s+([IVXLCDM]{1,7})\b/gi;

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Diccionario de pronunciación personalizada: [{escrito, dicho}]
export function aplicarDiccionario(texto, dic = []) {
  for (const { escrito, dicho } of dic) {
    if (!escrito) continue;
    const re = new RegExp('(^|[^\\p{L}\\p{N}])' + escRe(escrito) + '(?=$|[^\\p{L}\\p{N}])', 'gu');
    texto = texto.replace(re, (_, pre) => pre + dicho);
  }
  return texto;
}

const CIFRA = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;

export function normalizar(texto, opciones = {}) {
  let t = ' ' + texto.normalize('NFC') + ' ';
  t = aplicarDiccionario(t, opciones.diccionario);

  // Caracteres tipográficos
  t = t.replace(/[­​‌‍﻿]/g, '')
    .replace(/[“”«»„]/g, '"').replace(/[‘’‚]/g, "'")
    .replace(/…/g, '...').replace(/ /g, ' ');

  // URLs y correos
  t = t.replace(/\bhttps?:\/\/(\S+)/gi, (_, u) => leerUrl(u));
  t = t.replace(/\bwww\.(\S+)/gi, (_, u) => 'w w w punto ' + leerUrl(u));
  t = t.replace(/\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)\b/g, (_, a, d) => `${a.replace(/[._]/g, ' punto ')} arroba ${d.replace(/\./g, ' punto ')}`);

  // Abreviaturas (las más largas primero)
  for (const [ab, ex] of [...ABREVIATURAS].sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp('(^|[\\s(\\["¿¡])' + escRe(ab) + '(?=[\\s,;:)\\]"!?]|$)', /^[A-Z]/.test(ab) && ab.length <= 3 ? 'g' : 'gi');
    t = t.replace(re, (_, pre) => pre + ex);
  }
  // "No." / "N.º" / "Nº" seguido de número
  t = t.replace(/\b(?:No\.|N\.º|Nº|N°|n\.º|nº)\s*(?=\d)/g, 'número ');

  // Ordinales 1.º 2.ª 1º 3er 1er
  t = t.replace(/\b(\d{1,2})\.?\s?[º°o](?=\s|[.,;:)]|$)(\s+\p{L})?/gu, (_, n, sig) => {
    let w = ordinal(+n, 'm');
    if (sig) w = w.replace(/^(primero|tercero)/, (x) => x.slice(0, -1));
    return w + (sig || '');
  });
  t = t.replace(/\b(\d{1,2})\.?\s?ª/g, (_, n) => ordinal(+n, 'f'));
  t = t.replace(/\b1er\b/g, 'primer').replace(/\b3er\b/g, 'tercer');

  // Números romanos tras palabras clave (siglo XXI → siglo veintiuno)
  t = t.replace(PALABRAS_ROMANOS, (m, w, r) => {
    const v = romanoAEntero(r.toUpperCase());
    return v > 0 && v < 4000 ? `${w} ${numeroALetras(v)}` : m;
  });

  // Fechas dd/mm/aaaa o dd-mm-aaaa
  t = t.replace(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/g, (m, d, mo, y) => {
    const dd = +d, mm = +mo;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return m;
    const yy = y.length === 2 ? 2000 + +y : +y;
    return `${dd === 1 ? 'primero' : numeroALetras(dd)} de ${MESES[mm - 1]} de ${numeroALetras(yy)}`;
  });
  // "1 de enero" → "primero de enero"
  t = t.replace(/\b1(?=\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b)/gi, 'primero');

  // Horas 10:30, 7:05
  t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h, mi) => {
    const hh = numeroALetras(+h, 'f');
    const m = +mi;
    return m === 0 ? hh : `${hh} y ${m < 10 ? 'cero ' + UNIDADES[m] : numeroALetras(m)}`;
  });

  // Monedas
  const MON = '(?:US\\$|USD|COP|EUR|MXN|\\$|€|£)';
  t = t.replace(new RegExp(`(${MON})\\s?(${CIFRA})(\\s?(?:millones|millón|mil millones|billones|mil|M|MM|mm))?`, 'g'),
    (m, mon, cifra, escala) => leerMonto(mon, cifra, escala));
  t = t.replace(new RegExp(`(${CIFRA})\\s?(€|euros?|USD|COP|dólares|pesos)\\b`, 'g'), (m, cifra, mon) => {
    if (/^(euros?|dólares|pesos)$/.test(mon)) return `${cifraALetras(cifra, 'apocope')} ${mon}`;
    return leerMonto(mon, cifra, '');
  });

  // Porcentajes y por mil
  t = t.replace(new RegExp(`(${CIFRA})\\s?%`, 'g'), (_, c) => `${cifraALetras(c, 'apocope')} por ciento`);
  t = t.replace(new RegExp(`(${CIFRA})\\s?‰`, 'g'), (_, c) => `${cifraALetras(c, 'apocope')} por mil`);

  // Teléfonos: 601 234 5678, +57 300 123 4567, 3001234567
  t = t.replace(/(\+\d{1,3}\s?)?\b(\d{3})[\s.-](\d{3})[\s.-](\d{4})\b/g, (m, cc, a, b, c) =>
    (cc ? 'más ' + digitos(cc.replace(/\D/g, '')) + ', ' : '') + [a, b, c].map(grupoTelefono).join(', '));
  t = t.replace(/\b\d{7,}\b/g, (m) => m.match(/.{1,3}/g).map(grupoTelefono).join(', '));
  // Miles con espacio: 1 000 000
  t = t.replace(/\b\d{1,3}(?:[ \u202F]\d{3})+\b(?![.,]\d)/g, (m) => m.replace(/[ \u202F]/g, '.'));

  // Rangos numéricos 2020-2025, 10–15 ("entre X y Y", "de X a Y")
  t = t.replace(/(\bentre\s+)?\b(\d+)\s?[–—-]\s?(\d+)\b/gi, (_, entre, a, b) => entre ? `${entre}${a} y ${b}` : `${a} a ${b}`);

  // Unidades de medida tras cifras
  const unidades = Object.keys(UNIDADES_MEDIDA).sort((a, b) => b.length - a.length).map(escRe).join('|');
  t = t.replace(new RegExp(`(${CIFRA})\\s?(${unidades})(?=$|[^\\p{L}\\p{N}])`, 'gu'), (m, c, u) => {
    const p = parseCifra(c);
    const [sg, pl] = UNIDADES_MEDIDA[u];
    const esUno = p && p.entero === 1n && !p.decimales;
    return `${cifraALetras(c, 'apocope')} ${esUno ? sg : pl}`;
  });

  // Signos sueltos
  t = t.replace(/\s&\s/g, ' y ').replace(/\s\+\s/g, ' más ').replace(/\s=\s/g, ' igual a ')
    .replace(/\s[x×]\s(?=\d)/g, ' por ').replace(/§\s?/g, 'sección ');

  // Cifras restantes, con concordancia de género según la palabra siguiente
  t = t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${CIFRA})(?=$|[^\\p{L}\\p{N}])(\\s+(\\p{L}+))?`, 'gu'),
    (m, pre, cifra, _sp, sig) => {
      // No tocar si es un decimal sin contexto ambiguo que termina en punto de frase: "en 2025." ya funciona
      const g = sig ? generoDeSiguiente(sig) : 'm';
      return pre + cifraALetras(cifra, g) + (_sp || '');
    });

  t = t.replace(/\b(k?m)([²³])/g, (_, u, e) => (u === 'km' ? 'kilómetro' : 'metro') + (e === '²' ? ' cuadrado' : ' cúbico'));
  // Llamadas de nota (superíndices) no se leen: «empresa¹» → «empresa»
  t = t.replace(/(?<![mk])[⁰¹²³⁴⁵⁶⁷⁸⁹†]+/gu, '');
  // Al inicio de una nota al pie: «¹ Ver…» / «1. Ver…» se lee «Nota 1. Ver…»
  t = t.replace(/^\s*([⁰¹²³⁴⁵⁶⁷⁸⁹]+)\s*/u, '');

  // Viñetas y guiones al inicio
  t = t.replace(/(^|\n)\s*[•▪◦●■□➢►–—-]\s+/g, '$1');

  return t.replace(/[ \t]+/g, ' ').trim();
}

function digitos(s) { return s.split('').map((c) => UNIDADES[+c]).join(' '); }
function grupoTelefono(g) { return g.startsWith('0') || g.length > 3 ? (g.length === 4 && !g.startsWith('0') ? numeroALetras(+g.slice(0, 2)) + ' ' + (g[2] === '0' ? digitos(g.slice(2)) : numeroALetras(+g.slice(2))) : digitos(g)) : numeroALetras(+g); }

function leerUrl(u) {
  return u.replace(/\/$/, '').replace(/\./g, ' punto ').replace(/\//g, ' barra ').replace(/[-_]/g, ' ');
}

function leerMonto(mon, cifra, escala) {
  const p = parseCifra(cifra);
  if (!p) return mon + cifra;
  const nombres = {
    '$': ['peso', 'pesos'], COP: ['peso', 'pesos'], MXN: ['peso mexicano', 'pesos mexicanos'],
    'US$': ['dólar', 'dólares'], USD: ['dólar', 'dólares'], '€': ['euro', 'euros'], EUR: ['euro', 'euros'],
    '£': ['libra', 'libras'],
  };
  const [sg, pl] = nombres[mon] || ['', ''];
  escala = (escala || '').trim();
  if (escala) {
    const esc = { M: 'millones', MM: 'millones', mm: 'millones' }[escala] || escala;
    const num = cifraALetras(cifra, 'apocope');
    const escFinal = (esc === 'millones' && p.entero === 1n && !p.decimales) ? 'millón' : esc;
    const de = /mill|bill/.test(escFinal) ? ' de ' : ' ';
    return `${num} ${escFinal}${de}${pl}`;
  }
  const num = cifraALetras(cifra, 'apocope');
  const n = p.entero;
  const usaDe = !p.decimales && n >= 1000000n && n % 1000000n === 0n;
  const unidad = !p.decimales && n === 1n ? sg : pl;
  return `${num}${usaDe ? ' de' : ''} ${unidad}`;
}
