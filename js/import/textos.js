// VOZI — Importación de texto pegado, TXT y DOCX.
import { reconstruirParrafos } from '../tts/segmenter.js';
import { leerZip } from '../zip.js';
import { uid } from '../db.js';

export const LIMITE_ARCHIVO = 200 * 1024 * 1024; // 200 MB

export function parrafosDesdeTexto(texto, pagina = null) {
  return reconstruirParrafos(texto).map((t) => ({ id: uid('p'), text: t, page: pagina, kind: esTitulo(t) ? 'h' : 'p' }));
}

function esTitulo(t) {
  return t.length < 90 && !/[.,;:]$/.test(t) && /^[\p{Lu}\d]/u.test(t) && t.split(/\s+/).length <= 12 && !/[.!?]\s/.test(t);
}

export async function importarTxt(file) {
  if (file.size > LIMITE_ARCHIVO) throw new Error('El archivo es demasiado grande (máximo 200 MB).');
  const buf = new Uint8Array(await file.arrayBuffer());
  let texto;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {
    texto = new TextDecoder('windows-1252').decode(buf); // archivos antiguos en Windows
  }
  texto = texto.replace(/^﻿/, '');
  if (!texto.trim()) throw new Error('El archivo de texto está vacío.');
  if (/\u0000/.test(texto.slice(0, 2000))) throw new Error('El archivo no parece ser texto plano.');
  return { titulo: file.name.replace(/\.[^.]+$/, ''), paragraphs: parrafosDesdeTexto(texto), paginas: 0, fuente: 'txt' };
}

export async function importarDocx(file) {
  if (file.size > LIMITE_ARCHIVO) throw new Error('El archivo es demasiado grande (máximo 200 MB).');
  let zip;
  try { zip = await leerZip(await file.arrayBuffer()); } catch (e) {
    throw new Error(/contraseña/.test(e.message) ? 'El documento Word está protegido con contraseña.' : 'El documento Word está dañado o no es un archivo .docx válido.');
  }
  const ent = zip.get('word/document.xml');
  if (!ent) {
    if (zip.has('EncryptedPackage') || zip.has('EncryptionInfo')) throw new Error('El documento Word está protegido con contraseña.');
    throw new Error('El archivo no es un documento Word (.docx) válido.');
  }
  const xml = new TextDecoder().decode(await ent.leer());
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El documento Word está dañado.');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const paragraphs = [];
  let pagina = 1, huboSaltos = false;
  const procesarP = (p) => {
    let texto = '';
    let salto = false;
    const recorrer = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 't') texto += c.textContent;
        else if (ln === 'tab') texto += ' ';
        else if (ln === 'br') { if (c.getAttributeNS(W, 'type') === 'page') salto = true; else texto += ' '; }
        else if (ln === 'lastRenderedPageBreak') salto = true;
        else if (ln === 'noBreakHyphen') texto += '-';
        else if (ln === 'softHyphen') { /* guion opcional: no se lee */ }
        else if (ln === 'delText' || ln === 'instrText' || ln === 'footnoteReference') { /* omitir */ }
        else if (ln === 'del') { /* texto eliminado en control de cambios */ }
        else recorrer(c);
      }
    };
    recorrer(p);
    if (salto && paragraphs.length) { pagina++; huboSaltos = true; }
    const estilo = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const val = estilo ? (estilo.getAttributeNS(W, 'val') || '') : '';
    const titulo = /^(heading|t[ií]tulo|ttulo|title|encabezado)/i.test(val);
    const t = texto.replace(/\s+/g, ' ').trim();
    if (t) paragraphs.push({ id: uid('p'), text: t, page: pagina, kind: titulo ? 'h' : 'p' });
  };
  const recorrerCuerpo = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'p') procesarP(c);
      else if (['tbl', 'tr', 'tc', 'sdt', 'sdtContent', 'customXml', 'txbxContent'].includes(c.localName)) recorrerCuerpo(c);
    }
  };
  recorrerCuerpo(body);
  if (!paragraphs.length) throw new Error('El documento Word no contiene texto.');
  if (!huboSaltos) for (const p of paragraphs) p.page = null;
  return { titulo: file.name.replace(/\.[^.]+$/, ''), paragraphs, paginas: huboSaltos ? pagina : 0, fuente: 'docx', paginasAproximadas: huboSaltos };
}
