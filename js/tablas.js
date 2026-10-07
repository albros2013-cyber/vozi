// VOZI — Cuadros y tablas: se guardan con su estructura (filas y columnas) para leerlos con orden:
// primero de qué trata (o la interpretación de la IA, si existe) y luego fila por fila con el nombre
// de cada columna. Así «Residencial: consumo, 120 GWh; variación, 3 %» en lugar de números sueltos.

const limpiarCelda = (t) => String(t || '').replace(/\s+/g, ' ').replace(/[.;:]+$/, '').trim();

// filas: [[celda, ...], ...]; la primera fila es el encabezado si `encabezado` es true
export function crearParrafoTabla({ titulo = '', filas, encabezado = true }) {
  let fs = filas.map((f) => f.map(limpiarCelda));
  // Quitar columnas y filas vacías
  const nCol = Math.max(...fs.map((f) => f.length));
  fs = fs.map((f) => Array.from({ length: nCol }, (_, j) => f[j] || ''));
  const usadas = Array.from({ length: nCol }, (_, j) => fs.some((f) => f[j]));
  fs = fs.map((f) => f.filter((_, j) => usadas[j])).filter((f) => f.some(Boolean));
  const tabla = { titulo: limpiarCelda(titulo), filas: fs, encabezado: encabezado && fs.length > 1 };
  const { texto, offsets } = linealizar(tabla);
  tabla.offsets = offsets;
  return { kind: 'tabla', text: texto, tabla };
}

// Texto que se muestra en búsquedas y que lee la voz: una oración por fila
function linealizar(t) {
  const H = t.encabezado ? t.filas[0] : null;
  const cuerpo = t.encabezado ? t.filas.slice(1) : t.filas;
  const nCol = t.filas[0] ? t.filas[0].length : 0;
  // «Tabla 1. Consumo…» → «Tabla 1: Consumo…» (una sola oración)
  const tit = t.titulo ? t.titulo.replace(/^((?:tabla|cuadro|table|gr[áa]fico|figura|anexo)\s*(?:n[.º°o]*\s*)?[\dIVXLC.]+)\.\s+/i, '$1: ') : '';
  let texto = (tit ? tit + '. ' : 'Cuadro. ') +
    (H ? `Tiene ${cuerpo.length} ${cuerpo.length === 1 ? 'fila' : 'filas'} y estas columnas: ${lista(H.filter(Boolean))}.` : `Tiene ${cuerpo.length} filas y ${nCol} columnas.`);
  const offsets = [];
  cuerpo.forEach((f, i) => {
    texto += ' ';
    offsets.push(texto.length);
    let frase;
    if (H && nCol >= 2) {
      const etiqueta = f[0] || `Fila ${i + 1}`;
      const pares = [];
      for (let j = 1; j < nCol; j++) if (f[j]) pares.push(H[j] ? `${minusculaInicial(H[j])}, ${f[j]}` : f[j]);
      frase = `${etiqueta}: ${pares.join('; ') || 'sin datos'}`;
    } else frase = `Fila ${i + 1}: ${f.filter(Boolean).join('; ')}`;
    texto += frase.replace(/[.\s]+$/, '') + '.';
  });
  return { texto, offsets };
}

function lista(xs) { return xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]; }
function minusculaInicial(s) { return /^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s; }

// Lo que dice la voz para un cuadro, según el ajuste «cuadros»: 'interpretacion' | 'filas' | 'ambos'
// Devuelve también dónde empiezan las filas, para resaltar la fila que se está leyendo.
export function textoVozTabla(p, modo = 'ambos') {
  const interp = p.interpretacion && modo !== 'filas' ? `Interpretación del cuadro: ${p.interpretacion.replace(/\s+/g, ' ').trim()} ` : '';
  const conFilas = !interp || modo !== 'interpretacion';
  if (!conFilas) return { texto: (p.tabla && p.tabla.titulo ? p.tabla.titulo + '. ' : '') + interp.trim(), inicioFilas: Infinity };
  return { texto: interp + p.text, inicioFilas: interp.length };
}

// Fila (0 = primera fila de datos; -1 = título/encabezado/interpretación) para una posición del texto hablado
export function filaEnPosicion(p, pos, inicioFilas) {
  if (!p.tabla || pos < inicioFilas) return -1;
  const off = pos - inicioFilas;
  let r = -1;
  (p.tabla.offsets || []).forEach((o, i) => { if (off >= o) r = i; });
  return r;
}

// Para la IA: la tabla en formato Markdown
export function tablaMarkdown(p) {
  const t = p.tabla;
  if (!t || !t.filas.length) return p.text;
  const fila = (f) => '| ' + f.map((c) => c.replace(/\|/g, '/')).join(' | ') + ' |';
  const out = [];
  if (t.titulo) out.push(t.titulo);
  const H = t.encabezado ? t.filas[0] : t.filas[0].map((_, j) => `Col ${j + 1}`);
  out.push(fila(H), '|' + H.map(() => ' --- ').join('|') + '|');
  for (const f of (t.encabezado ? t.filas.slice(1) : t.filas)) out.push(fila(f));
  return out.join('\n');
}

// ---------- Detección de tablas en líneas de un PDF ----------
// Cada línea trae `celdas`: trozos de texto separados por espacios horizontales grandes.
// Una tabla es una serie de 3 o más líneas con 2 o más celdas alineadas en columnas.
export function separarTablas(lineas, hMed) {
  const bloques = []; // {tipo:'texto', lineas} | {tipo:'tabla', parrafo}
  let texto = [];
  let i = 0;
  const multi = (l) => l.celdas && l.celdas.length >= 2;
  while (i < lineas.length) {
    if (!multi(lineas[i])) { texto.push(lineas[i]); i++; continue; }
    // Recorrer la serie: líneas con varias celdas y continuaciones cortas entre ellas
    let j = i;
    const serie = [];
    while (j < lineas.length) {
      const l = lineas[j];
      if (multi(l)) { serie.push(l); j++; continue; }
      const sig = lineas[j + 1];
      const prev = serie[serie.length - 1];
      const cerca = prev && Math.abs(prev.y - l.y) < hMed * 2.2;
      if (cerca && sig && multi(sig) && l.text.length < 80) { serie.push(l); j++; continue; }
      break;
    }
    const tabla = construirTabla(serie, hMed);
    if (!tabla) { texto.push(lineas[i]); i++; continue; }
    // Título del cuadro: la línea anterior si empieza con «Tabla», «Cuadro»…
    let titulo = '';
    const ant = texto[texto.length - 1];
    if (ant && /^(tabla|cuadro|table|gr[áa]fico|figura|anexo)\s*(n[.º°o]*\s*)?[\dIVXLC]/i.test(ant.text) && ant.text.length < 160) { titulo = ant.text; texto.pop(); }
    if (texto.length) bloques.push({ tipo: 'texto', lineas: texto });
    texto = [];
    bloques.push({ tipo: 'tabla', parrafo: crearParrafoTabla({ titulo, filas: tabla }) });
    i = j;
  }
  if (texto.length) bloques.push({ tipo: 'texto', lineas: texto });
  return bloques;
}

function construirTabla(serie, hMed) {
  const filasMulti = serie.filter((l) => l.celdas && l.celdas.length >= 2);
  if (filasMulti.length < 3) return null;
  const celdas = filasMulti.flatMap((l) => l.celdas);
  const largoMedio = celdas.reduce((s, c) => s + c.text.length, 0) / celdas.length;
  const maxCols = Math.max(...filasMulti.map((l) => l.celdas.length));
  // Dos columnas de prosa (texto a dos columnas) no son una tabla
  if (largoMedio > 45 || (maxCols === 2 && largoMedio > 28 && filasMulti.every((l) => l.celdas.every((c) => c.text.length > 20)))) return null;
  // Columnas: agrupar los inicios de celda
  const tol = hMed * 2;
  const xs = celdas.map((c) => c.x).sort((a, b) => a - b);
  const grupos = [];
  for (const x of xs) {
    const g = grupos[grupos.length - 1];
    if (g && x - g.max <= tol) { g.max = x; g.n++; } else grupos.push({ min: x, max: x, n: 1 });
  }
  const minApoyo = Math.max(2, Math.floor(filasMulti.length * 0.25));
  const cols = grupos.filter((g) => g.n >= minApoyo).map((g) => g.min);
  if (cols.length < 2) return null;
  const columna = (x) => { let k = 0; for (let c = 0; c < cols.length; c++) if (cols[c] <= x + tol * 0.5) k = c; return k; };
  const filas = [];
  for (const l of serie) {
    const cs = l.celdas && l.celdas.length ? l.celdas : [{ x: l.x, text: l.text }];
    if (cs.length < 2 && filas.length) { // continuación de una celda partida en dos líneas
      const k = columna(cs[0].x);
      const f = filas[filas.length - 1];
      f[k] = f[k] ? f[k] + ' ' + cs[0].text : cs[0].text;
      continue;
    }
    const f = Array(cols.length).fill('');
    for (const c of cs) { const k = columna(c.x); f[k] = f[k] ? f[k] + ' ' + c.text : c.text; }
    filas.push(f);
  }
  return filas.length >= 3 ? filas : null;
}
