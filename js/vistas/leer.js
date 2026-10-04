// VOZI — Vista de lectura: texto original, párrafo y oración actuales, búsqueda,
// marcadores, citas con página, notas y modo concentración.
import { ctx, guardarAjustes } from '../estado.js';
import { db, uid } from '../db.js';
import { h, aviso, dialogo, pedirTexto, icono, confirmar } from '../ui.js';
import { ir, aplicarTema } from '../app.js';
import * as L from '../lectura.js';
import { dividirOraciones } from '../tts/segmenter.js';

let estadoVista = null;

export async function vistaLeer(main, opciones = {}) {
  const doc = ctx.doc;
  document.getElementById('cabeceraTitulo').textContent = doc.title;
  const acciones = document.getElementById('cabeceraAcciones');
  const btn = (nombre, etiqueta, fn) => h('button', { class: 'boton-icono', 'aria-label': etiqueta, title: etiqueta, onclick: fn }, icono(nombre));
  acciones.append(
    btn('buscar', 'Buscar en el documento', () => abrirBusqueda()),
    btn('paginas', 'Ir a página o fragmento', () => irAPagina()),
    btn('marcador', 'Marcadores', () => panelMarcadores()),
    btn('texto', 'Tamaño de letra', () => panelLetra()),
    btn('foco', 'Modo concentración', () => alternarFoco()),
    btn('editar', 'Editar texto', () => editarTexto()));

  // El texto pintado se reutiliza al volver a «Leer» (no se reconstruyen miles de párrafos)
  const marcadores = new Set((await db.byIndex('bookmarks', 'docId', doc.id)).map((b) => b.pid));
  const conNotas = new Set((await db.byIndex('notes', 'docId', doc.id)).map((n) => n.pid));
  let texto;
  const cache = ctx.cacheLector;
  if (cache && cache.docId === doc.id && cache.version === doc.updatedAt && cache.n === doc.paragraphs.length) {
    texto = cache.texto;
    for (const el of texto.querySelectorAll('.parrafo')) {
      el.classList.toggle('con-marcador', marcadores.has(el.dataset.pid));
      el.classList.toggle('con-nota', conNotas.has(el.dataset.pid));
    }
  } else {
    texto = h('article', { class: 'texto-lectura', lang: 'es', 'aria-label': 'Texto del documento' });
    const frag = document.createDocumentFragment();
    let pagina = undefined;
    doc.paragraphs.forEach((p, i) => {
      if (p.page != null && p.page !== pagina) {
        pagina = p.page;
        frag.append(h('div', { class: 'marca-pagina', id: `pag-${p.page}`, 'data-page': p.page }, `Página ${p.page}`, p.ocr ? h('span', { class: 'etiqueta' }, 'OCR') : null));
      }
      frag.append(h(p.kind === 'h' ? 'h3' : 'p', {
        class: 'parrafo' + (p.kind === 'pie' ? ' es-pie' : '') + (marcadores.has(p.id) ? ' con-marcador' : '') + (conNotas.has(p.id) ? ' con-nota' : ''),
        'data-pid': p.id, 'data-idx': i, tabindex: '-1',
      }, p.text));
    });
    texto.append(frag);
    texto.addEventListener('click', (e) => {
      const p = e.target.closest('.parrafo');
      if (!p) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return; // está seleccionando texto
      menuParrafo(+p.dataset.idx);
    });
    ctx.cacheLector = { docId: doc.id, version: doc.updatedAt, n: doc.paragraphs.length, texto };
  }
  const barraBusqueda = h('div', { class: 'barra-busqueda', hidden: true });
  const cont = h('section', { class: 'vista vista-leer' }, barraBusqueda, texto);
  main.append(cont);
  const actualPrevio = texto.querySelector('.parrafo.actual');

  estadoVista = { texto, barraBusqueda, actualPid: actualPrevio ? actualPrevio.dataset.pid : null, actualS: null, ultimoScrollUsuario: 0, busqueda: null };
  ctx.vistas.leer = { parrafoVisible };

  // Interacciones
  const btnCita = h('button', { class: 'boton-cita', hidden: true, onmousedown: (e) => e.preventDefault(), onclick: () => guardarCita() }, '❝ Guardar como cita');
  cont.append(btnCita);
  const onSel = () => {
    const sel = window.getSelection();
    const ok = sel && !sel.isCollapsed && sel.toString().trim().length > 2 && texto.contains(sel.anchorNode);
    btnCita.hidden = !ok;
  };
  document.addEventListener('selectionchange', onSel);
  const onScroll = () => { if (!estadoVista || estadoVista.scrollProgramado) return; estadoVista.ultimoScrollUsuario = Date.now(); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('touchmove', onScroll, { passive: true });
  const limpiar = new MutationObserver(() => {
    if (!document.body.contains(texto)) {
      document.removeEventListener('selectionchange', onSel);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchmove', onScroll);
      limpiar.disconnect();
      document.body.classList.remove('modo-foco');
      if (estadoVista && estadoVista.texto === texto) estadoVista = null;
    }
  });
  limpiar.observe(main, { childList: true });

  // Posición inicial
  const pr = await db.get('progress', doc.id);
  const idx = opciones.pidx != null ? opciones.pidx : (pr ? Math.max(0, doc.paragraphs.findIndex((p) => p.id === pr.pid)) : 0);
  const pos = ctx.rep.posicionActual && ctx.rep.tramo && ctx.rep.tramo.docId === doc.id ? ctx.rep.posicionActual() : null;
  if (pos) resaltarPosicion(pos, { forzarScroll: true });
  else if (doc.paragraphs[idx]) {
    marcarActual(doc.paragraphs[idx].id, pr ? pr.s : null);
    desplazarA(doc.paragraphs[idx].id, true);
  }
  actualizarAccionesLeer();
}

export function actualizarAccionesLeer() { /* reservado para estados de la barra de lectura */ }

function parrafoVisible() {
  if (!estadoVista) return null;
  const pars = estadoVista.texto.querySelectorAll('.parrafo');
  const alto = window.innerHeight;
  for (const p of pars) {
    const r = p.getBoundingClientRect();
    if (r.bottom > 80 && r.top < alto * 0.6) return +p.dataset.idx;
  }
  return null;
}

function marcarActual(pid, s) {
  if (!estadoVista) return;
  const t = estadoVista.texto;
  if (estadoVista.actualPid !== pid) {
    const ant = t.querySelector('.parrafo.actual');
    if (ant) { ant.classList.remove('actual'); restaurarParrafo(ant); }
    const el = t.querySelector(`[data-pid="${pid}"]`);
    if (el) { el.classList.add('actual'); el.setAttribute('aria-current', 'true'); }
    estadoVista.actualPid = pid;
    estadoVista.actualS = null;
  }
  if (s != null && estadoVista.actualS !== s) {
    const el = t.querySelector(`[data-pid="${pid}"]`);
    if (el) marcarOracion(el, s);
    estadoVista.actualS = s;
  }
}

function restaurarParrafo(el) {
  el.removeAttribute('aria-current');
  if (el.dataset.dividido) {
    const p = ctx.doc.paragraphs[+el.dataset.idx];
    el.textContent = p.text;
    delete el.dataset.dividido;
  }
}

function marcarOracion(el, s) {
  const p = ctx.doc.paragraphs[+el.dataset.idx];
  if (!el.dataset.dividido) {
    const os = dividirOraciones(p.text);
    el.textContent = '';
    os.forEach((o, i) => {
      el.append(h('span', { class: 'oracion', 'data-s': i }, p.text.slice(o.start, o.end)));
      if (i < os.length - 1) el.append(' ');
    });
    el.dataset.dividido = '1';
  }
  el.querySelectorAll('.oracion.activa').forEach((x) => x.classList.remove('activa'));
  const o = el.querySelector(`.oracion[data-s="${s}"]`);
  if (o) o.classList.add('activa');
}

function desplazarA(pid, inmediato) {
  if (!estadoVista) return;
  const el = estadoVista.texto.querySelector(`[data-pid="${pid}"]`);
  if (!el) return;
  estadoVista.scrollProgramado = true;
  el.scrollIntoView({ block: 'center', behavior: inmediato ? 'auto' : 'smooth' });
  setTimeout(() => { if (estadoVista) estadoVista.scrollProgramado = false; }, inmediato ? 50 : 700);
}

// Llamado por el reproductor cuando cambia la oración en reproducción
export function resaltarPosicion(pos, { forzarScroll = false } = {}) {
  if (!estadoVista || !ctx.doc || !pos) return;
  const cambioParrafo = estadoVista.actualPid !== pos.pid;
  marcarActual(pos.pid, pos.s);
  const usuarioReciente = Date.now() - estadoVista.ultimoScrollUsuario < 6000;
  if (forzarScroll || (cambioParrafo && ctx.ajustes.seguirLectura && !usuarioReciente)) {
    const el = estadoVista.texto.querySelector(`[data-pid="${pos.pid}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      if (forzarScroll || r.top < 90 || r.bottom > window.innerHeight * 0.62) desplazarA(pos.pid, forzarScroll);
    }
  }
}

// ---------- Menú del párrafo ----------
async function menuParrafo(idx) {
  const doc = ctx.doc;
  const p = doc.paragraphs[idx];
  const marcas = await db.byIndex('bookmarks', 'docId', doc.id);
  const tieneMarca = marcas.find((b) => b.pid === p.id);
  const cerrar = () => document.getElementById('dialogo').close();
  const acc = (txt, fn, clase = '') => h('button', { type: 'button', class: 'accion ' + clase, onclick: () => { cerrar(); fn(); } }, txt);
  await dialogo({
    titulo: p.page != null ? `Párrafo · página ${p.page}` : 'Párrafo',
    contenido: h('div', {},
      h('blockquote', { class: 'cita-previa' }, p.text.length > 220 ? p.text.slice(0, 220) + '…' : p.text),
      h('div', { class: 'lista-acciones' },
        acc('▶ Escuchar desde aquí', () => { L.escucharDesde(idx); }, 'destacada'),
        acc(tieneMarca ? '🔖 Quitar marcador' : '🔖 Añadir marcador', () => alternarMarcador(p, tieneMarca)),
        acc('✎ Escribir una nota sobre este párrafo', () => nuevaNota(p)),
        acc('❝ Guardar el párrafo como cita', () => crearCita(p, p.text)),
        acc('🗂 Crear tarjeta de repaso', () => nuevaTarjeta(p)),
        acc(p.kind === 'pie' ? '¶ Es texto normal (la voz lo leerá)' : '¶ Es una nota al pie (la voz la omitirá)', () => alternarPie(idx)),
        acc('⧉ Copiar texto', () => { navigator.clipboard && navigator.clipboard.writeText(p.text).then(() => aviso('Texto copiado.'), () => aviso('No se pudo copiar.')); }))),
    botones: [{ texto: 'Cerrar', valor: null }],
  });
}

async function alternarPie(idx) {
  const doc = ctx.doc;
  const p = doc.paragraphs[idx];
  p.kind = p.kind === 'pie' ? 'p' : 'pie';
  doc.updatedAt = Date.now();
  await db.put('docs', doc);
  const el = estadoVista && estadoVista.texto.querySelector(`[data-pid="${p.id}"]`);
  el && el.classList.toggle('es-pie', p.kind === 'pie');
  aviso(p.kind === 'pie' ? 'Marcado como nota al pie: la voz lo omitirá.' : 'Marcado como texto normal: la voz lo leerá.');
}

async function alternarMarcador(p, existente) {
  const el = estadoVista && estadoVista.texto.querySelector(`[data-pid="${p.id}"]`);
  if (existente) {
    await db.del('bookmarks', existente.id);
    el && el.classList.remove('con-marcador');
    aviso('Marcador quitado.');
  } else {
    await db.put('bookmarks', { id: uid('b'), docId: ctx.doc.id, pid: p.id, page: p.page, extracto: p.text.slice(0, 120), creado: Date.now() });
    el && el.classList.add('con-marcador');
    aviso('Marcador añadido.');
  }
}

async function nuevaNota(p) {
  const t = await pedirTexto('Nota', { multilinea: true, etiqueta: p.page != null ? `Sobre la página ${p.page}` : '', placeholder: 'Escribe tu nota…' });
  if (!t || !t.trim()) return;
  await db.put('notes', { id: uid('n'), docId: ctx.doc.id, tipo: 'nota', texto: t.trim(), pid: p.id, page: p.page, creado: Date.now(), actualizado: Date.now() });
  const el = estadoVista && estadoVista.texto.querySelector(`[data-pid="${p.id}"]`);
  el && el.classList.add('con-nota');
  aviso('Nota guardada. La encuentras en Estudiar.');
}

async function crearCita(p, cita) {
  const comentario = await pedirTexto('Guardar cita', { multilinea: true, etiqueta: `«${cita.length > 140 ? cita.slice(0, 140) + '…' : cita}»${p.page != null ? ` (pág. ${p.page})` : ''}`, placeholder: 'Comentario opcional' });
  if (comentario === null) return;
  await db.put('notes', { id: uid('n'), docId: ctx.doc.id, tipo: 'cita', cita, texto: comentario.trim(), pid: p.id, page: p.page, creado: Date.now(), actualizado: Date.now() });
  const el = estadoVista && estadoVista.texto.querySelector(`[data-pid="${p.id}"]`);
  el && el.classList.add('con-nota');
  aviso(p.page != null ? `Cita guardada con referencia a la página ${p.page}.` : 'Cita guardada.');
}

function guardarCita() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const texto = sel.toString().replace(/\s+/g, ' ').trim();
  const nodo = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
  const parEl = nodo && nodo.closest('.parrafo');
  if (!parEl || !texto) return;
  const p = ctx.doc.paragraphs[+parEl.dataset.idx];
  sel.removeAllRanges();
  crearCita(p, texto);
}

async function nuevaTarjeta(p) {
  const preg = h('textarea', { class: 'campo', rows: 3, placeholder: 'Pregunta' });
  const resp = h('textarea', { class: 'campo', rows: 4, placeholder: 'Respuesta' });
  const r = await dialogo({
    titulo: 'Nueva tarjeta de repaso',
    contenido: h('div', {}, h('p', { class: 'nota-suave' }, 'Escribe tu propia pregunta y respuesta. Referencia: ' + (p.page != null ? `página ${p.page}` : 'este párrafo') + '.'),
      h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Pregunta'), preg), h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Respuesta'), resp)),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', valor: () => ({ q: preg.value.trim(), a: resp.value.trim() }), clase: 'primario' }],
  });
  if (!r || !r.q) return;
  await db.put('cards', { id: uid('c'), docId: ctx.doc.id, q: r.q, a: r.a, pid: p.id, page: p.page, caja: 1, proxima: Date.now(), creado: Date.now() });
  aviso('Tarjeta creada.');
}

// ---------- Búsqueda ----------
function abrirBusqueda() {
  const b = estadoVista.barraBusqueda;
  b.hidden = false;
  b.innerHTML = '';
  const campo = h('input', { class: 'campo', type: 'search', placeholder: 'Buscar en el documento', 'aria-label': 'Buscar en el documento' });
  const info = h('span', { class: 'busqueda-info', 'aria-live': 'polite' }, '');
  let res = [], i = -1;
  const ir_ = (d) => {
    if (!res.length) return;
    i = (i + d + res.length) % res.length;
    info.textContent = `${i + 1} de ${res.length}`;
    const el = estadoVista.texto.querySelector(`[data-pid="${res[i].pid}"]`);
    estadoVista.texto.querySelectorAll('.resultado').forEach((x) => x.classList.remove('resultado'));
    if (el) { el.classList.add('resultado'); estadoVista.ultimoScrollUsuario = Date.now(); el.scrollIntoView({ block: 'center' }); }
  };
  const buscar = () => {
    const q = normal(campo.value.trim());
    estadoVista.texto.querySelectorAll('.resultado').forEach((x) => x.classList.remove('resultado'));
    res = []; i = -1;
    if (q.length < 2) { info.textContent = ''; return; }
    ctx.doc.paragraphs.forEach((p, k) => { if (normal(p.text).includes(q)) res.push({ pid: p.id, k }); });
    info.textContent = res.length ? `${res.length} resultado(s)` : 'Sin resultados';
    if (res.length) ir_(1);
  };
  let t = null;
  campo.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 250); });
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ir_(e.shiftKey ? -1 : 1); } });
  b.append(campo, info,
    h('button', { class: 'boton-icono', 'aria-label': 'Resultado anterior', onclick: () => ir_(-1) }, '↑'),
    h('button', { class: 'boton-icono', 'aria-label': 'Resultado siguiente', onclick: () => ir_(1) }, '↓'),
    h('button', { class: 'boton-icono', 'aria-label': 'Escuchar desde el resultado', onclick: () => { if (res[i]) L.escucharDesde(res[i].k); } }, '▶'),
    h('button', { class: 'boton-icono', 'aria-label': 'Cerrar búsqueda', onclick: () => { b.hidden = true; estadoVista.texto.querySelectorAll('.resultado').forEach((x) => x.classList.remove('resultado')); } }, icono('cerrar')));
  campo.focus();
}
function normal(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// ---------- Páginas y fragmentos ----------
async function irAPagina() {
  const doc = ctx.doc;
  const paginas = [...new Set(doc.paragraphs.map((p) => p.page).filter((x) => x != null))];
  const total = doc.paragraphs.length;
  const cerrar = () => document.getElementById('dialogo').close();
  const lista = h('div', { class: 'rejilla-opciones' });
  if (paginas.length) {
    for (const n of paginas) lista.append(h('button', { type: 'button', class: 'opcion', onclick: () => { cerrar(); saltarAPagina(n); } }, String(n)));
  } else {
    // Sin páginas: fragmentos del 10 % del texto
    for (let k = 0; k < 10; k++) {
      const idx = Math.floor((k / 10) * total);
      lista.append(h('button', { type: 'button', class: 'opcion', onclick: () => { cerrar(); saltarAIndice(idx); } }, `${k * 10} %`));
    }
  }
  await dialogo({ titulo: paginas.length ? 'Ir a la página' : 'Ir al fragmento', contenido: lista, botones: [{ texto: 'Cerrar', valor: null }] });
}
function saltarAPagina(n) {
  const el = document.getElementById(`pag-${n}`);
  if (el) { estadoVista.ultimoScrollUsuario = Date.now(); el.scrollIntoView({ block: 'start' }); }
  const idx = ctx.doc.paragraphs.findIndex((p) => p.page === n);
  ofrecerEscuchar(idx);
}
function saltarAIndice(idx) {
  const p = ctx.doc.paragraphs[idx];
  if (!p) return;
  estadoVista.ultimoScrollUsuario = Date.now();
  desplazarA(p.id, true);
  ofrecerEscuchar(idx);
}
function ofrecerEscuchar(idx) {
  if (idx < 0) return;
  aviso('Toca un párrafo y elige «Escuchar desde aquí» para continuar la lectura en este punto.', { ms: 4500 });
}

// ---------- Marcadores ----------
async function panelMarcadores() {
  const doc = ctx.doc;
  const marcas = (await db.byIndex('bookmarks', 'docId', doc.id)).sort((a, b) => idxDe(a.pid) - idxDe(b.pid));
  const cerrar = () => document.getElementById('dialogo').close();
  const contenido = marcas.length
    ? h('ul', { class: 'lista-simple' }, marcas.map((m) => h('li', {},
      h('button', { type: 'button', class: 'accion', onclick: () => { cerrar(); saltarAIndice(idxDe(m.pid)); } },
        h('strong', {}, m.page != null ? `Pág. ${m.page} · ` : ''), m.extracto + '…'))))
    : h('p', {}, 'Aún no hay marcadores. Toca un párrafo y elige «Añadir marcador».');
  await dialogo({ titulo: 'Marcadores', contenido, botones: [{ texto: 'Cerrar', valor: null }] });
}
function idxDe(pid) { return ctx.doc.paragraphs.findIndex((p) => p.id === pid); }

// ---------- Letra y concentración ----------
async function panelLetra() {
  const val = h('output', {}, ctx.ajustes.letra + ' px');
  const cambiar = (d) => {
    const v = Math.max(14, Math.min(34, ctx.ajustes.letra + d));
    guardarAjustes({ letra: v }); aplicarTema(); val.textContent = v + ' px';
  };
  const inter = (d) => { const v = Math.max(1.3, Math.min(2.2, Math.round((ctx.ajustes.interlineado + d) * 100) / 100)); guardarAjustes({ interlineado: v }); aplicarTema(); };
  await dialogo({
    titulo: 'Tamaño de letra',
    contenido: h('div', { class: 'fila-letra' },
      h('button', { type: 'button', class: 'boton', 'aria-label': 'Reducir letra', onclick: () => cambiar(-1) }, 'A−'), val,
      h('button', { type: 'button', class: 'boton', 'aria-label': 'Aumentar letra', onclick: () => cambiar(1) }, 'A+'),
      h('button', { type: 'button', class: 'boton', 'aria-label': 'Menos interlineado', onclick: () => inter(-0.1) }, '≡−'),
      h('button', { type: 'button', class: 'boton', 'aria-label': 'Más interlineado', onclick: () => inter(0.1) }, '≡+')),
    botones: [{ texto: 'Listo', valor: null, clase: 'primario' }],
  });
}

function alternarFoco() {
  const activo = document.body.classList.toggle('modo-foco');
  if (activo) {
    const salir = h('button', { class: 'salir-foco boton', onclick: () => { document.body.classList.remove('modo-foco'); salir.remove(); } }, 'Salir del modo concentración');
    document.body.append(salir);
    aviso('Modo concentración: solo el texto y el reproductor.');
  } else document.querySelector('.salir-foco')?.remove();
}

// ---------- Edición del texto ----------
async function editarTexto() {
  const doc = ctx.doc;
  const paginas = [...new Set(doc.paragraphs.map((p) => p.page))];
  let pagina = paginas[0];
  if (paginas.length > 1) {
    const actual = estadoVista.actualPid ? doc.paragraphs.find((p) => p.id === estadoVista.actualPid) : null;
    const v = await pedirTexto('¿Qué página quieres editar?', { tipo: 'number', valor: String(actual && actual.page != null ? actual.page : paginas[0]) });
    if (v === null) return;
    pagina = paginas.includes(+v) ? +v : null;
    if (pagina === null) { aviso('Esa página no existe en el documento.'); return; }
  }
  const pars = doc.paragraphs.filter((p) => p.page === pagina);
  const ta = h('textarea', { class: 'campo area-texto', rows: 16 }, pars.map((p) => p.text).join('\n\n'));
  const r = await dialogo({
    titulo: pagina != null ? `Editar página ${pagina}` : 'Editar texto',
    contenido: h('div', {}, h('p', { class: 'nota-suave' }, 'Separa los párrafos con una línea en blanco. Las notas y marcadores de párrafos sin cambios se conservan.'), ta),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar cambios', valor: () => ta.value, clase: 'primario' }],
  });
  if (r == null) return;
  const previos = new Map(pars.map((p) => [p.text, p]));
  const nuevos = [];
  for (const bloque of r.split(/\n\s*\n/)) {
    const t = bloque.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();
    if (!t) continue;
    const prev = previos.get(t);
    nuevos.push(prev ? prev : { id: uid('p'), text: t, page: pagina, kind: 'p', editado: true });
  }
  const primero = doc.paragraphs.findIndex((p) => p.page === pagina);
  const resto = doc.paragraphs.filter((p) => p.page !== pagina);
  resto.splice(primero, 0, ...nuevos);
  doc.paragraphs = resto;
  doc.updatedAt = Date.now();
  await db.put('docs', doc);
  aviso('Texto actualizado. El audio de los tramos afectados se volverá a preparar.');
  ir('leer', { pidx: Math.max(0, primero) });
}
