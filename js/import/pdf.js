// VOZI — Importación de PDF: extracción del texto digital y OCR de páginas escaneadas.
import * as pdfjsLib from '../../vendor/pdfjs/pdf.mjs';
import { juntar, unirLineas, reconstruirParrafos } from '../tts/segmenter.js';
import { reconocer, dibujarGris, canvasAPng } from './ocr.js';
import { uid } from '../db.js';
import { LIMITE_ARCHIVO } from './textos.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
const BASE = new URL('../../vendor/pdfjs/', import.meta.url).href;

export const LIMITE_PAGINAS = 3000;

export async function abrirPdf(file, pedirClave) {
  if (file.size > LIMITE_ARCHIVO) throw new Error('El PDF es demasiado grande (máximo 200 MB). Divide el archivo o elige un rango menor.');
  const data = new Uint8Array(await file.arrayBuffer());
  const tarea = pdfjsLib.getDocument({
    data, cMapUrl: BASE + 'cmaps/', cMapPacked: true, standardFontDataUrl: BASE + 'standard_fonts/',
    isEvalSupported: false, enableXfa: false,
  });
  let intentosClave = 0;
  tarea.onPassword = async (actualizar, razon) => {
    intentosClave++;
    const clave = pedirClave ? await pedirClave(razon === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD, intentosClave) : null;
    if (clave == null) { tarea.destroy(); return; }
    actualizar(clave);
  };
  try {
    const pdf = await tarea.promise;
    if (pdf.numPages > LIMITE_PAGINAS) throw new Error(`El PDF tiene ${pdf.numPages} páginas; el máximo es ${LIMITE_PAGINAS}. Importa un rango.`);
    let titulo = '';
    try { const md = await pdf.getMetadata(); titulo = (md.info && md.info.Title) || ''; } catch { /* sin metadatos */ }
    return { pdf, numPages: pdf.numPages, titulo: titulo.trim() };
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('El PDF está protegido con contraseña y no se pudo abrir.');
    if (e && e.name === 'InvalidPDFException') throw new Error('El archivo está dañado o no es un PDF válido.');
    if (e && /destroy|cancel/i.test(e.message || '')) throw new Error('Importación cancelada: el PDF requiere contraseña.');
    if (e && e.message && /páginas|máximo/.test(e.message)) throw e;
    throw new Error('No se pudo abrir el PDF: ' + (e && e.message ? e.message : 'error desconocido'));
  }
}

// Extrae las líneas de texto de una página conservando la geometría básica
async function lineasDePagina(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const lineas = [];
  let cur = null;
  const cerrar = () => { if (cur && cur.text.trim()) lineas.push(cur); cur = null; };
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    const [a, b, c, d, x, y] = it.transform;
    const h = Math.hypot(c, d) || it.height || 10;
    // Llamada de nota (número volado pequeño): se conserva como superíndice y la voz la omite
    const volado = cur && it.str && /^\s*[\d*†]{1,3}\s*$/.test(it.str) && h < cur.hmax * 0.8 && y > cur.y + cur.hmax * 0.15 && y - cur.y < cur.hmax * 0.9;
    if (cur && !volado && Math.abs(y - cur.y) > Math.max(h, cur.hmax) * 0.6) cerrar();
    if (!cur) cur = { x, y, h, text: '', xEnd: x, hmax: h };
    if (volado) {
      cur.text = cur.text.replace(/\s+$/, '') + aSuperindice(it.str.trim());
      cur.xEnd = x + (it.width || 0);
      if (it.hasEOL) cerrar();
      continue;
    }
    if (it.str) {
      const gap = x - cur.xEnd;
      const necesitaEspacio = cur.text && !/\s$/.test(cur.text) && !/^\s/.test(it.str) && gap > h * 0.12;
      cur.text += (necesitaEspacio ? ' ' : '') + it.str;
      cur.xEnd = x + (it.width || 0);
      cur.hmax = Math.max(cur.hmax, h);
    }
    if (it.hasEOL) cerrar();
  }
  cerrar();
  for (const l of lineas) l.text = l.text.replace(/\s+/g, ' ').trim();
  return { lineas: lineas.filter((l) => l.text), ancho: vp.width, alto: vp.height };
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '*': '*', '†': '†' };
function aSuperindice(t) { return t.split('').map((c) => SUP[c] || c).join(''); }

// Detecta el bloque de notas al pie: letra más pequeña que el cuerpo, en la parte baja de la página,
// y que empieza con una llamada (número, asterisco o superíndice).
function marcarNotasAlPie(p, hCuerpo) {
  const ls = p.lineas;
  let i = ls.length - 1;
  while (i >= 0 && ls[i].y < p.alto * 0.5 && ls[i].hmax <= hCuerpo * 0.88) i--;
  let ini = i + 1;
  if (ini >= ls.length) return;
  // El bloque debe empezar con una llamada de nota
  while (ini < ls.length && !/^\s*([\d¹²³⁴⁵⁶⁷⁸⁹⁰]{1,3}|[*†])[\s.)]?/.test(ls[ini].text)) ini++;
  if (ini >= ls.length) return;
  for (let k = ini; k < ls.length; k++) ls[k].pie = true;
}

function mediana(arr) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[s.length >> 1]; }

// Agrupa líneas en párrafos usando espaciado, sangría y puntuación
function parrafosDeLineas(lineas, ancho) {
  if (!lineas.length) return [];
  const gaps = [];
  for (let i = 1; i < lineas.length; i++) { const g = lineas[i - 1].y - lineas[i].y; if (g > 0) gaps.push(g); }
  const gapMed = mediana(gaps) || lineas[0].h * 1.2;
  const hMed = mediana(lineas.map((l) => l.hmax));
  const xMed = mediana(lineas.map((l) => l.x));
  const anchoMed = mediana(lineas.map((l) => l.xEnd - l.x)) || ancho * 0.6;
  const out = [];
  let actual = null;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const esTitulo = l.hmax > hMed * 1.25 && l.text.length < 120;
    if (!actual) { actual = { text: l.text, kind: esTitulo ? 'h' : 'p', ultima: l }; continue; }
    const prev = actual.ultima;
    const gap = prev.y - l.y;
    const salto = gap > gapMed * 1.45 || gap < -gapMed * 0.5;   // espacio grande o cambio de columna
    const sangria = l.x > xMed + hMed * 1.2 && /[.!?:]$/.test(prev.text);
    const prevCorta = (prev.xEnd - prev.x) < anchoMed * 0.72 && /[.!?:"”»)]$/.test(prev.text);
    const cambioTitulo = esTitulo !== (actual.kind === 'h');
    const continua = !salto && !sangria && !prevCorta && !cambioTitulo && unirLineas(actual.text, l.text, true);
    if (continua || (/[\p{L}]-$/u.test(prev.text) && /^\p{Ll}/u.test(l.text))) {
      actual.text = juntar(actual.text, l.text);
      actual.ultima = l;
    } else {
      out.push(actual);
      actual = { text: l.text, kind: esTitulo ? 'h' : 'p', ultima: l };
    }
  }
  if (actual) out.push(actual);
  return out.map((p) => ({ text: p.text, kind: p.kind }));
}

function claveRepeticion(t) { return t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim(); }
const NUM_PAGINA = /^(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(de|\/)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;

function calidadTexto(t) {
  const s = t.replace(/\s/g, '');
  if (s.length < 15) return 0;
  const buenos = (s.match(/[\p{L}\p{N}.,;:¿?¡!()"'%$-]/gu) || []).length;
  return buenos / s.length;
}

// Importa un rango de páginas. onProgreso({pagina, total, fase, fraccion})
export async function importarPdf(abierto, { desde = 1, hasta, forzarOcr = false, ocrListo = false, onProgreso, signal }) {
  const { pdf } = abierto;
  hasta = Math.min(hasta || pdf.numPages, pdf.numPages);
  if (desde < 1 || desde > hasta) throw new Error('El rango de páginas no es válido.');
  const paginas = [];
  const total = hasta - desde + 1;
  // 1) Extraer texto digital
  for (let n = desde; n <= hasta; n++) {
    if (signal && signal.aborted) throw abortado();
    onProgreso && onProgreso({ pagina: n, total, fase: 'texto', fraccion: (n - desde) / total * (forzarOcr ? 0.1 : 0.5) });
    const page = await pdf.getPage(n);
    const { lineas, ancho, alto } = await lineasDePagina(page);
    const texto = lineas.map((l) => l.text).join(' ');
    paginas.push({ n, page, lineas, ancho, alto, calidad: calidadTexto(texto) });
  }
  // 2) Quitar encabezados/pies repetidos y números de página
  const conteo = new Map();
  for (const p of paginas) {
    const bordes = p.lineas.filter((l) => l.y > p.alto * 0.92 || l.y < p.alto * 0.08);
    for (const l of new Set(bordes.map((l) => claveRepeticion(l.text)))) conteo.set(l, (conteo.get(l) || 0) + 1);
  }
  const umbral = Math.max(2, Math.ceil(paginas.length * 0.4));
  for (const p of paginas) {
    p.lineas = p.lineas.filter((l) => {
      const borde = l.y > p.alto * 0.92 || l.y < p.alto * 0.08;
      if (!borde) return true;
      if (NUM_PAGINA.test(l.text)) return false;
      return !(paginas.length >= 2 && conteo.get(claveRepeticion(l.text)) >= umbral && l.text.length < 120);
    });
  }
  // 2b) Notas al pie (solo texto digital)
  const hCuerpo = mediana(paginas.flatMap((p) => p.lineas.map((l) => l.hmax)));
  if (hCuerpo) for (const p of paginas) marcarNotasAlPie(p, hCuerpo);

  // 3) OCR donde haga falta
  const necesitanOcr = paginas.filter((p) => forzarOcr || p.calidad < 0.6);
  const sinOcr = [];
  if (necesitanOcr.length && !ocrListo) {
    for (const p of necesitanOcr) sinOcr.push(p.n);
  } else {
    let i = 0;
    for (const p of necesitanOcr) {
      if (signal && signal.aborted) throw abortado();
      const base = 0.5 + (i / necesitanOcr.length) * 0.5;
      onProgreso && onProgreso({ pagina: p.n, total, fase: 'ocr', fraccion: forzarOcr ? 0.1 + 0.9 * i / necesitanOcr.length : base, ocrIndice: i + 1, ocrTotal: necesitanOcr.length });
      const vp1 = p.page.getViewport({ scale: 1 });
      const escala = Math.min(3, Math.max(1.5, 2200 / vp1.width));
      const vp = p.page.getViewport({ scale: escala });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await p.page.render({ canvasContext: ctx, viewport: vp }).promise;
      const gris = dibujarGris(canvas, canvas.width, canvas.height);
      canvas.width = canvas.height = 0;
      const png = await canvasAPng(gris);
      gris.width = gris.height = 0;
      const r = await reconocer(png, (f) => {
        onProgreso && onProgreso({ pagina: p.n, total, fase: 'ocr', fraccion: (forzarOcr ? 0.1 + 0.9 * (i + f) / necesitanOcr.length : 0.5 + 0.5 * (i + f) / necesitanOcr.length), ocrIndice: i + 1, ocrTotal: necesitanOcr.length });
      }, signal);
      p.ocr = { texto: r.texto, confianza: r.confianza };
      i++;
    }
  }
  // 4) Construir párrafos con su página
  const paragraphs = [];
  for (const p of paginas) {
    let pars;
    if (p.ocr) pars = reconstruirParrafos(p.ocr.texto).map((t) => ({ text: t, kind: 'p', ocr: true }));
    else {
      pars = parrafosDeLineas(p.lineas.filter((l) => !l.pie), p.ancho);
      // Cada nota al pie empieza en una línea con su llamada
      const pies = [];
      for (const l of p.lineas.filter((x) => x.pie)) {
        if (!pies.length || /^\s*([\d¹²³⁴⁵⁶⁷⁸⁹⁰]{1,3}|[*†])[\s.)]?/.test(l.text)) pies.push(l.text);
        else pies[pies.length - 1] = juntar(pies[pies.length - 1], l.text);
      }
      pars.push(...pies.map((t) => ({ text: t, kind: 'pie' })));
    }
    // Unir párrafo partido entre páginas (sin punto final y la siguiente empieza en minúscula)
    if (paragraphs.length && pars.length) {
      let ult = paragraphs[paragraphs.length - 1];
      for (let k = paragraphs.length - 1; k >= 0 && paragraphs[k].kind === 'pie'; k--) ult = paragraphs[k - 1] || ult;
      if (ult.kind === 'p' && !/[.!?:"”»)]$/.test(ult.text) && /^\p{Ll}/u.test(pars[0].text)) {
        ult.text = juntar(ult.text, pars[0].text);
        ult.pageEnd = p.n;
        pars.shift();
      }
    }
    for (const q of pars) paragraphs.push({ id: uid('p'), text: q.text, page: p.n, kind: q.kind, ...(q.ocr ? { ocr: true } : {}) });
  }
  const ocrConf = paginas.filter((p) => p.ocr).map((p) => ({ n: p.n, confianza: p.ocr.confianza }));
  for (const p of paginas) p.page.cleanup();
  return { paragraphs, paginasOcr: ocrConf, paginasSinTexto: sinOcr, desde, hasta, notasAlPie: paragraphs.filter((x) => x.kind === 'pie').length };
}

function abortado() { const e = new Error('Importación cancelada'); e.name = 'AbortError'; return e; }
