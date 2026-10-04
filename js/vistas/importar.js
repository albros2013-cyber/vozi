// VOZI — Importación: pegar texto, PDF, TXT, DOCX, imágenes y cámara (con OCR real).
import { db, uid } from '../db.js';
import { h, aviso, elegirArchivo, pedirTexto, confirmar } from '../ui.js';
import { ir, abrirDocumento } from '../app.js';
import { importarTxt, importarDocx, parrafosDesdeTexto, LIMITE_ARCHIVO } from '../import/textos.js';
import { ocrDisponible, prepararImagen, reconocer, cerrarOcr } from '../import/ocr.js';
import { cargarManifiesto, estadoPaquete } from '../resources.js';
import { detectarIdioma, idiomaPredominante } from '../tts/idioma.js';

let borrador = null; // documento en revisión antes de guardar

export async function vistaImportar(main, opciones = {}) {
  document.getElementById('cabeceraTitulo').textContent = 'Importar';
  if (borrador && opciones.revisar !== false) return vistaRevision(main);
  const cont = h('section', { class: 'vista vista-importar' });
  const ocrOk = await ocrListo();
  cont.append(
    h('p', { class: 'intro' }, 'Todo se procesa en este dispositivo. Nada se envía a internet.'),
    h('div', { class: 'rejilla-import' },
      tarjeta('📄', 'Archivo', 'PDF, Word (.docx) o texto (.txt)', () => importarArchivo(main)),
      tarjeta('🖼', 'Imágenes', 'Fotos o capturas con texto', () => importarImagenes(main, false)),
      tarjeta('📷', 'Tomar foto', 'Fotografía una página', () => importarImagenes(main, true)),
      tarjeta('✎', 'Pegar texto', 'Escribe o pega y edita', () => pegarTexto(main))),
    h('div', { class: 'aviso-ocr ' + (ocrOk ? 'ok' : 'falta') },
      h('strong', {}, 'Reconocimiento de texto (OCR): '),
      ocrOk ? 'listo para usar sin conexión.' : 'aún no está descargado. Es necesario para fotos y PDF escaneados en español e inglés (32 MB).',
      ocrOk ? null : h('button', { class: 'enlace', onclick: () => ir('ajustes', { seccion: 'recursos' }) }, 'Descargar ahora')),
    h('p', { class: 'nota-suave' }, 'El OCR extrae el texto escrito en una imagen. No describe fotografías ni interpreta gráficos, tablas complejas o fórmulas: revisa siempre el texto reconocido.'));
  main.append(cont);
}

function tarjeta(ico, titulo, desc, fn) {
  return h('button', { class: 'tarjeta-import', onclick: fn },
    h('span', { class: 'tarjeta-ico', 'aria-hidden': 'true' }, ico),
    h('span', { class: 'tarjeta-titulo' }, titulo),
    h('span', { class: 'tarjeta-desc' }, desc));
}

async function ocrListo() {
  try {
    const man = await cargarManifiesto();
    const a = man.packs.find((p) => p.id === 'ocr-spa'), b = man.packs.find((p) => p.id === 'motor-ocr');
    return (await estadoPaquete(a)).instalado && (await estadoPaquete(b)).instalado;
  } catch { return false; }
}

// ---------- Progreso con cancelación ----------
function panelProgreso(main, titulo) {
  const abort = new AbortController();
  const barra = h('div', { class: 'barra-progreso', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span'));
  const texto = h('p', { class: 'progreso-texto', 'aria-live': 'polite' }, 'Preparando…');
  const panel = h('section', { class: 'vista panel-progreso' },
    h('h2', {}, titulo), barra, texto,
    h('button', { class: 'boton', onclick: () => { abort.abort(); cerrarOcr(); } }, 'Cancelar'));
  main.innerHTML = '';
  main.append(panel);
  return {
    signal: abort.signal,
    set(frac, msg) {
      barra.firstChild.style.width = Math.round(frac * 100) + '%';
      barra.setAttribute('aria-valuenow', Math.round(frac * 100));
      if (msg) texto.textContent = msg;
    },
  };
}

// ---------- Archivo ----------
async function importarArchivo(main) {
  const [file] = await elegirArchivo({ accept: '.pdf,.txt,.text,.md,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  if (!file) return;
  const nombre = file.name.toLowerCase();
  try {
    if (file.size === 0) throw new Error('El archivo está vacío.');
    if (file.size > LIMITE_ARCHIVO) throw new Error('El archivo es demasiado grande (máximo 200 MB).');
    if (nombre.endsWith('.pdf') || file.type === 'application/pdf') return await flujoPdf(main, file);
    if (nombre.endsWith('.docx')) {
      const r = await importarDocx(file);
      return revisar(main, { ...r, source: { type: 'docx', name: file.name, size: file.size } });
    }
    if (nombre.endsWith('.doc')) throw new Error('El formato .doc antiguo no es compatible. Guárdalo como .docx o PDF.');
    const r = await importarTxt(file);
    return revisar(main, { ...r, source: { type: 'txt', name: file.name, size: file.size } });
  } catch (e) {
    if (e.name === 'AbortError') { aviso('Importación cancelada.'); ir('importar', { revisar: false }); return; }
    aviso(e.message, { tipo: 'error', ms: 8000 });
    ir('importar', { revisar: false });
  }
}

async function flujoPdf(main, file) {
  const { abrirPdf, importarPdf } = await import('../import/pdf.js');
  const prog = panelProgreso(main, 'Abriendo PDF…');
  const abierto = await abrirPdf(file, async (incorrecta) => pedirTexto(incorrecta ? 'Contraseña incorrecta' : 'Este PDF tiene contraseña', { tipo: 'password', etiqueta: 'Escribe la contraseña para abrirlo' }));
  prog.set(1, `${abierto.numPages} páginas`);
  const ocrOk = await ocrListo();
  // Opciones: rango y OCR
  const desde = h('input', { class: 'campo corto', type: 'number', min: 1, max: abierto.numPages, value: 1, inputmode: 'numeric', 'aria-label': 'Desde la página' });
  const hasta = h('input', { class: 'campo corto', type: 'number', min: 1, max: abierto.numPages, value: abierto.numPages, inputmode: 'numeric', 'aria-label': 'Hasta la página' });
  const forzar = h('input', { type: 'checkbox', disabled: !ocrOk });
  const omitir = h('input', { type: 'checkbox', checked: true });
  const opciones = await new Promise((resolve) => {
    main.innerHTML = '';
    main.append(h('section', { class: 'vista' },
      h('h2', {}, file.name),
      h('p', {}, `${abierto.numPages} páginas.`),
      h('div', { class: 'fila-campos' }, h('label', {}, 'Desde la página ', desde), h('label', {}, ' hasta ', hasta)),
      h('label', { class: 'casilla' }, omitir, ' Omitir encabezados, pies de página y números de página'),
      h('label', { class: 'casilla' }, forzar, ' Forzar reconocimiento de texto (OCR) en todas las páginas del rango'),
      h('p', { class: 'nota-suave' }, ocrOk
        ? 'Las páginas escaneadas o sin texto seleccionable se reconocen automáticamente con OCR. Fuerza el OCR si el texto extraído sale con caracteres extraños.'
        : 'El OCR no está descargado: las páginas escaneadas quedarán vacías. Descárgalo en Ajustes → Recursos sin conexión.'),
      h('div', { class: 'fila-botones' },
        h('button', { class: 'boton', onclick: () => resolve(null) }, 'Cancelar'),
        h('button', { class: 'boton primario', onclick: () => resolve({ desde: +desde.value, hasta: +hasta.value, forzarOcr: forzar.checked, omitirEncabezados: omitir.checked }) }, 'Importar'))));
  });
  if (!opciones) { abierto.pdf.destroy(); ir('importar', { revisar: false }); return; }
  if (!(opciones.desde >= 1 && opciones.hasta <= abierto.numPages && opciones.desde <= opciones.hasta)) {
    aviso('El rango de páginas no es válido.', { tipo: 'error' }); abierto.pdf.destroy(); ir('importar', { revisar: false }); return;
  }
  const p2 = panelProgreso(main, 'Importando PDF');
  const t0 = performance.now();
  const r = await importarPdf(abierto, {
    ...opciones, ocrListo: ocrOk, signal: p2.signal,
    onProgreso: (p) => {
      const tr = (performance.now() - t0) / 1000;
      const resto = p.fraccion > 0.05 ? Math.round(tr * (1 - p.fraccion) / p.fraccion) : null;
      p2.set(p.fraccion, p.fase === 'ocr'
        ? `Reconociendo texto de la página ${p.pagina} (${p.ocrIndice} de ${p.ocrTotal})${resto ? ` · faltan ~${Math.max(1, Math.round(resto / 60))} min` : ''}`
        : `Extrayendo texto: página ${p.pagina} de ${p.total}`);
    },
  });
  abierto.pdf.destroy();
  if (!r.paragraphs.length) {
    throw new Error(r.paginasSinTexto.length
      ? 'Las páginas elegidas no tienen texto digital (parecen escaneadas). Descarga el OCR en Ajustes para reconocerlas.'
      : 'No se encontró texto en las páginas elegidas.');
  }
  revisar(main, {
    titulo: abierto.titulo && abierto.titulo.length > 3 ? abierto.titulo : file.name.replace(/\.pdf$/i, ''),
    paragraphs: r.paragraphs, paginas: abierto.numPages, rango: [r.desde, r.hasta],
    paginasOcr: r.paginasOcr, paginasSinTexto: r.paginasSinTexto, notasAlPie: r.notasAlPie, encabezados: r.encabezadosOmitidos,
    source: { type: 'pdf', name: file.name, size: file.size },
  });
}

// ---------- Imágenes y cámara ----------
async function importarImagenes(main, camara) {
  if (!(await ocrListo())) {
    if (await confirmar('Para leer el texto de imágenes necesitas descargar el reconocimiento de texto (16 MB, una sola vez).', { si: 'Ir a descargar' })) ir('ajustes', { seccion: 'recursos' });
    return;
  }
  const files = await elegirArchivo({ accept: 'image/*', multiple: !camara, capture: camara ? 'environment' : null });
  if (!files.length) return;
  const prog = panelProgreso(main, files.length > 1 ? `Reconociendo ${files.length} imágenes` : 'Reconociendo texto');
  const paragraphs = [];
  const paginasOcr = [];
  try {
    for (let i = 0; i < files.length; i++) {
      if (prog.signal.aborted) throw Object.assign(new Error('cancelada'), { name: 'AbortError' });
      const f = files[i];
      if (f.size > 60 * 1024 * 1024) throw new Error(`La imagen «${f.name}» es demasiado grande (máximo 60 MB).`);
      prog.set(i / files.length, `Preparando imagen ${i + 1} de ${files.length}…`);
      const png = await prepararImagen(f);
      const r = await reconocer(png, (fr) => prog.set((i + fr) / files.length, `Reconociendo texto de la imagen ${i + 1} de ${files.length}… ${Math.round(fr * 100)} %`), prog.signal);
      const pag = files.length > 1 ? i + 1 : 1;
      const pars = parrafosDesdeTexto(r.texto, pag).map((p) => ({ ...p, ocr: true }));
      paragraphs.push(...pars);
      paginasOcr.push({ n: pag, confianza: r.confianza, vacia: !pars.length });
    }
  } catch (e) {
    if (e.name === 'AbortError') { aviso('Reconocimiento cancelado.'); ir('importar', { revisar: false }); return; }
    aviso(e.message, { tipo: 'error', ms: 8000 }); ir('importar', { revisar: false }); return;
  }
  if (!paragraphs.length) {
    aviso('No se reconoció texto en la imagen. Prueba con más luz, la página completa y enfocada.', { tipo: 'error', ms: 8000 });
    ir('importar', { revisar: false });
    return;
  }
  revisar(main, {
    titulo: files.length === 1 ? (camara ? 'Foto ' + new Date().toLocaleDateString('es-CO') : files[0].name.replace(/\.[^.]+$/, '')) : `${files.length} imágenes`,
    paragraphs, paginas: files.length, paginasOcr, source: { type: camara ? 'foto' : 'imagen', name: files.map((f) => f.name).join(', ') },
  });
}

// ---------- Pegar texto ----------
async function pegarTexto(main) {
  revisar(main, { titulo: '', paragraphs: [], paginas: 0, source: { type: 'texto' }, vacio: true });
}

// ---------- Revisión y corrección antes de guardar ----------
function revisar(main, datos) {
  borrador = datos;
  vistaRevision(main);
}

function textoDePagina(pars) { return pars.map((p) => p.text).join('\n\n'); }

function agrupar(paragraphs) {
  const grupos = new Map();
  for (const p of paragraphs) {
    const k = p.page == null ? 0 : p.page;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  return grupos;
}

function vistaRevision(main) {
  const d = borrador;
  main.innerHTML = '';
  const titulo = h('input', { class: 'campo titulo', value: d.titulo || '', placeholder: 'Título del documento', 'aria-label': 'Título' });
  const cont = h('section', { class: 'vista vista-revision' });
  cont.append(h('h2', {}, d.vacio ? 'Pegar o escribir texto' : 'Revisa el texto antes de guardar'));
  cont.append(h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Título'), titulo));
  if (d.paginasOcr && d.paginasOcr.length) {
    const bajas = d.paginasOcr.filter((p) => p.confianza < 70);
    cont.append(h('div', { class: 'aviso-ocr ' + (bajas.length ? 'falta' : 'ok') },
      `Texto reconocido con OCR en ${d.paginasOcr.length} página(s). `,
      bajas.length ? `Confianza baja en: ${bajas.map((p) => p.n).join(', ')}. Revisa esas páginas.` : 'Revisa nombres propios, cifras y signos.'));
  }
  if (!d.vacio && d.paragraphs.length) {
    const det = idiomaPredominante(d.paragraphs);
    const mixto = d.paragraphs.some((p) => detectarIdioma(p.text) === (det === 'es' ? 'en' : 'es'));
    cont.append(h('p', { class: 'nota-suave' }, `Idioma detectado: ${det === 'en' ? 'inglés' : 'español'}${mixto ? ' (con partes en ' + (det === 'en' ? 'español' : 'inglés') + ': cada párrafo se leerá con la voz de su idioma)' : ''}.`));
  }
  if (d.encabezados) cont.append(h('p', { class: 'nota-suave' }, `Se omitieron ${d.encabezados} línea(s) de encabezado, pie de página o número de página.`));
  if (d.notasAlPie) {
    cont.append(h('div', { class: 'aviso-ocr ok' }, `Se detectaron ${d.notasAlPie} nota(s) al pie. Se conservan en el texto y la voz las omite (puedes cambiarlo en Ajustes → Lectura, o tocando el párrafo).`));
  }
  if (d.paginasSinTexto && d.paginasSinTexto.length) {
    cont.append(h('div', { class: 'aviso-ocr falta' }, `Sin texto (requieren OCR): páginas ${resumirPaginas(d.paginasSinTexto)}.`));
  }
  const areas = [];
  if (d.vacio) {
    const ta = h('textarea', { class: 'campo area-texto', rows: 14, placeholder: 'Pega o escribe aquí el texto. Separa los párrafos con una línea en blanco.' });
    areas.push({ page: null, ta });
    cont.append(ta);
  } else {
    const grupos = agrupar(d.paragraphs);
    cont.append(h('p', { class: 'nota-suave' }, 'Separa los párrafos con una línea en blanco. Puedes corregir el texto reconocido; el texto original importado se guarda tal cual lo dejes aquí.'));
    for (const [pag, pars] of grupos) {
      const ta = h('textarea', { class: 'campo area-texto', rows: Math.min(18, Math.max(5, Math.ceil(textoDePagina(pars).length / 70))), 'aria-label': pag ? `Texto de la página ${pag}` : 'Texto' }, textoDePagina(pars));
      areas.push({ page: pag || null, ta, pars });
      if (grupos.size > 1) {
        const ocr = d.paginasOcr && d.paginasOcr.find((p) => p.n === pag);
        cont.append(h('details', { class: 'pagina-revision', open: grupos.size <= 3 },
          h('summary', {}, `Página ${pag}`, ocr ? h('span', { class: 'etiqueta' }, `OCR ${Math.round(ocr.confianza)} %`) : null,
            h('span', { class: 'resumen' }, pars[0] ? ' — ' + pars[0].text.slice(0, 70) + '…' : '')), ta));
      } else cont.append(ta);
    }
  }
  cont.append(h('div', { class: 'fila-botones pegajosa' },
    h('button', { class: 'boton', onclick: async () => { if (await confirmar('¿Descartar esta importación?', { si: 'Descartar', peligro: true })) { borrador = null; ir('importar'); } } }, 'Descartar'),
    h('button', { class: 'boton primario', onclick: () => guardar() }, 'Guardar en la biblioteca')));
  main.append(cont);

  async function guardar() {
    const paragraphs = [];
    for (const a of areas) {
      const texto = a.ta.value;
      const previos = new Map((a.pars || []).map((p) => [p.text, p]));
      for (const bloque of texto.split(/\n\s*\n/)) {
        const t = bloque.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();
        if (!t) continue;
        const prev = previos.get(t);
        paragraphs.push(prev ? { ...prev, page: a.page } : { id: uid('p'), text: t, page: a.page, kind: prev ? prev.kind : 'p', ...(a.pars && a.pars.some((x) => x.ocr) ? { ocr: true } : {}) });
      }
    }
    if (!paragraphs.length) { aviso('No hay texto para guardar.', { tipo: 'error' }); return; }
    const ahora = Date.now();
    const doc = {
      id: uid('d'), title: titulo.value.trim() || paragraphs[0].text.slice(0, 60), createdAt: ahora, updatedAt: ahora,
      source: d.source, pages: d.paginas || 0, rango: d.rango || null, paragraphs,
      ocrPages: (d.paginasOcr || []).map((p) => p.n),
    };
    await db.put('docs', doc);
    borrador = null;
    aviso('Documento guardado.');
    abrirDocumento(doc.id);
  }
}

function resumirPaginas(ns) {
  const out = []; let ini = ns[0], prev = ns[0];
  for (let i = 1; i <= ns.length; i++) {
    if (ns[i] === prev + 1) { prev = ns[i]; continue; }
    out.push(ini === prev ? `${ini}` : `${ini}–${prev}`);
    ini = prev = ns[i];
  }
  return out.join(', ');
}
