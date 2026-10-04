// VOZI — Orquestación de la escucha: preparar tramos, reproducir de forma continua,
// preparar el siguiente tramo mientras se escucha y guardar el punto de lectura.
import { ctx, guardarAjustes } from './estado.js';
import { db } from './db.js';
import { vozPorId } from './voices.js';
import { cargarManifiesto, estadoPaquete } from './resources.js';
import { planificarTramo, buscarTramoGuardado, prepararTramo } from './tts/tramos.js';
import { aviso, formatoRestante, formatoTiempo, h, dialogo } from './ui.js';

const ev = new EventTarget();
export const eventos = ev;
function emitir(tipo, detalle) { ev.dispatchEvent(new CustomEvent(tipo, { detail: detalle })); }

const est = {
  preparando: null,     // {abort, fraccion, restanteSeg, fase, inicio}
  siguiente: null,      // {plan, promesa, rec, abort}
  posicion: null,
  guardarTimer: null,
  esperandoSiguiente: false,
};
export const estadoLectura = est;

// Comprueba que la voz elegida y el motor estén descargados
export async function vozLista() {
  const voz = vozPorId(ctx.ajustes.vozId);
  const man = await cargarManifiesto();
  const pack = man.packs.find((p) => p.id === voz.pack);
  const motor = man.packs.find((p) => p.id === 'motor-voz');
  if (!pack || !motor) return { ok: false, voz, faltan: [] };
  const faltan = [];
  for (const p of [motor, pack]) if (!(await estadoPaquete(p)).instalado) faltan.push(p);
  return { ok: faltan.length === 0, voz, pack, faltan };
}

function indicePorPid(doc, pid) { return doc.paragraphs.findIndex((p) => p.id === pid); }

export function prepararActivo() { return !!est.preparando; }

export function cancelarPreparacion() {
  if (est.preparando) est.preparando.abort.abort();
}

function cancelarSiguiente() {
  if (est.siguiente && est.siguiente.abort) est.siguiente.abort.abort();
  est.siguiente = null;
}

async function asegurarMotor(pack, alEstado) {
  return ctx.motor.preparar(pack, (m) => alEstado && alEstado(m), Math.max(1, Math.min(2, ctx.ajustes.procesos || 1)));
}

// Prepara un tramo (o lo recupera si ya estaba guardado)
async function obtenerTramo(doc, inicioIdx, minutos, { visible, signal }) {
  const { ok, voz, pack, faltan } = await vozLista();
  if (!ok) {
    const e = new Error('FALTA_VOZ');
    e.faltan = faltan;
    throw e;
  }
  const plan = planificarTramo(doc, inicioIdx, minutos, ctx.ajustes.cps, ctx.ajustes.diccionario);
  if (!plan.items.length) return null;
  const guardado = await buscarTramoGuardado(doc, plan, voz, ctx.ajustes);
  if (guardado) return guardado;
  const progreso = (p) => {
    if (visible) { Object.assign(est.preparando, p); emitir('preparacion', est.preparando); }
    else if (est.siguiente) { est.siguiente.fraccion = p.fraccion; emitir('siguiente', est.siguiente); }
  };
  if (visible) emitir('preparacion', Object.assign(est.preparando, { fase: 'motor', fraccion: 0 }));
  await asegurarMotor(pack, (m) => {
    if (visible) emitir('preparacion', Object.assign(est.preparando, { fase: 'motor', fraccion: 0, carga: m.progress }));
  });
  if (visible) emitir('preparacion', Object.assign(est.preparando, { fase: 'voz', fraccion: 0, restanteSeg: null }));
  const rec = await prepararTramo({ motor: ctx.motor, doc, plan, voz, pack, ajustes: ctx.ajustes, onProgreso: progreso, signal });
  // Ajustar la estimación de velocidad de habla con lo medido
  if (rec.cpsMedido && isFinite(rec.cpsMedido)) {
    const cps = Math.round((ctx.ajustes.cps * 0.6 + rec.cpsMedido * 0.4) * 10) / 10;
    if (Math.abs(cps - ctx.ajustes.cps) > 0.2) guardarAjustes({ cps });
  }
  return rec;
}

// Punto de entrada: escuchar el documento actual desde un párrafo
export async function escucharDesde(pidx, { reproducir = true } = {}) {
  const doc = ctx.doc;
  if (!doc) return;
  ctx.rep.desbloquear();
  // ¿Está dentro del tramo cargado?
  const pid = doc.paragraphs[pidx] && doc.paragraphs[pidx].id;
  if (ctx.rep.tramo && ctx.rep.tramo.docId === doc.id && ctx.rep.irAParrafo(pid)) {
    if (reproducir) ctx.rep.reproducir();
    return;
  }
  cancelarPreparacion();
  cancelarSiguiente();
  const abort = new AbortController();
  est.preparando = { abort, fraccion: 0, restanteSeg: null, fase: 'inicio', inicio: pidx };
  emitir('preparacion', est.preparando);
  const minutos = ctx.ajustes.primerTramoCorto ? Math.min(1, ctx.ajustes.tramoMin) : ctx.ajustes.tramoMin;
  try {
    const rec = await obtenerTramo(doc, pidx, minutos, { visible: true, signal: abort.signal });
    est.preparando = null;
    emitir('preparacion', null);
    if (!rec) { aviso('No hay más texto para leer desde aquí.'); return; }
    if (ctx.doc !== doc) return;
    await ctx.rep.cargar(rec, 0);
    if (reproducir) await ctx.rep.reproducir();
    emitir('tramo', rec);
    programarSiguiente(rec);
  } catch (e) {
    est.preparando = null;
    emitir('preparacion', null);
    manejarError(e);
  }
}

function manejarError(e) {
  if (e && e.name === 'AbortError') { aviso('Preparación cancelada.'); return; }
  if (e && e.message === 'FALTA_VOZ') { emitir('faltaVoz', e.faltan); return; }
  console.error(e);
  aviso(e && e.message ? e.message : 'Ocurrió un error al preparar el audio.', { tipo: 'error', ms: 7000 });
}

// Prepara en segundo plano el tramo que sigue al actual
function programarSiguiente(rec) {
  if (!ctx.ajustes.prepararSiguiente) return;
  const doc = ctx.doc;
  const desde = rec.fin + 1;
  if (!doc || desde >= doc.paragraphs.length) return;
  if (est.siguiente && est.siguiente.desde === desde) return;
  cancelarSiguiente();
  const abort = new AbortController();
  const sig = { desde, abort, fraccion: 0, rec: null, docId: doc.id };
  sig.promesa = obtenerTramo(doc, desde, ctx.ajustes.tramoMin, { visible: false, signal: abort.signal })
    .then((r) => { sig.rec = r; emitir('siguiente', sig); return r; })
    .catch((e) => { if (e.name !== 'AbortError') console.warn('Siguiente tramo:', e); sig.error = e; emitir('siguiente', sig); return null; });
  est.siguiente = sig;
  emitir('siguiente', sig);
}

// Fin del tramo actual: continuar sin cortes con el siguiente
export async function alTerminarTramo() {
  const doc = ctx.doc;
  const actual = ctx.rep.tramo;
  if (!doc || !actual) return;
  const desde = actual.fin + 1;
  if (desde >= doc.paragraphs.length) {
    emitir('finDocumento');
    aviso('Llegaste al final del documento.');
    return;
  }
  let rec = null;
  if (est.siguiente && est.siguiente.desde === desde && est.siguiente.docId === doc.id) {
    if (!est.siguiente.rec) {
      est.esperandoSiguiente = true;
      emitir('esperando', true);
      rec = await est.siguiente.promesa;
      est.esperandoSiguiente = false;
      emitir('esperando', false);
    } else rec = est.siguiente.rec;
    est.siguiente = null;
  }
  if (!rec) { await escucharDesde(desde); return; }
  if (ctx.doc !== doc) return;
  await ctx.rep.cargar(rec, 0);
  await ctx.rep.reproducir();
  emitir('tramo', rec);
  programarSiguiente(rec);
}

// Guarda el punto de lectura (párrafo, oración, audio y tiempo)
export function registrarPosicion(pos) {
  est.posicion = pos;
  clearTimeout(est.guardarTimer);
  est.guardarTimer = setTimeout(() => guardarPosicion(), 1200);
}
export async function guardarPosicion() {
  const doc = ctx.doc, pos = est.posicion;
  if (!doc || !pos) return;
  const pidx = indicePorPid(doc, pos.pid);
  await db.put('progress', {
    docId: doc.id, pid: pos.pid, pidx, s: pos.s, audioId: ctx.rep.tramo ? ctx.rep.tramo.id : null,
    tiempo: ctx.rep.tiempo, actualizado: Date.now(),
  });
  if (doc.ultimaLectura !== Date.now()) { doc.ultimaLectura = Date.now(); doc.progresoPct = Math.round(100 * Math.max(0, pidx) / Math.max(1, doc.paragraphs.length - 1)); db.put('docs', doc); }
}

// Al abrir un documento: recuperar el último punto (y su audio si sigue siendo válido)
export async function restaurarPosicion(doc) {
  const pr = await db.get('progress', doc.id);
  if (!pr) return null;
  let pidx = indicePorPid(doc, pr.pid);
  if (pidx < 0) pidx = Math.min(pr.pidx || 0, doc.paragraphs.length - 1);
  if (pr.audioId) {
    const rec = await db.get('audio', pr.audioId);
    const voz = vozPorId(ctx.ajustes.vozId);
    if (rec && rec.vozId === voz.id && rec.parrafos.every((id) => doc.paragraphs.some((p) => p.id === id))) {
      try { await ctx.rep.cargar(rec, Math.max(0, (pr.tiempo || 0) - 1.5)); emitir('tramo', rec); return { pidx, s: pr.s, conAudio: true }; } catch { /* audio no disponible */ }
    }
  }
  return { pidx, s: pr.s, conAudio: false };
}

export function soltarDocumento() {
  cancelarPreparacion();
  cancelarSiguiente();
  guardarPosicion();
  ctx.rep.pausar();
  ctx.rep.descargar();
  est.posicion = null;
}

export function textoEstadoPreparacion(p) {
  if (!p) return '';
  if (p.fase === 'motor' || p.fase === 'inicio') {
    return p.carga != null && p.carga < 0.97 ? `Cargando la voz en memoria… ${Math.round((p.carga || 0) * 100)} %` : 'Cargando la voz en memoria…';
  }
  if (p.fase === 'guardando') return 'Uniendo y guardando el audio…';
  return `Preparando el audio · ${Math.round(p.fraccion * 100)} % · falta ${formatoRestante(p.restanteSeg)}`;
}

export function describirTramo(rec) {
  if (!rec) return '';
  return `Tramo de ${formatoTiempo(rec.duracion)}`;
}

export async function avisoFaltaVoz(faltan, irAjustes) {
  const total = faltan.reduce((s, p) => s + p.size, 0);
  const r = await dialogo({
    titulo: 'Descarga la voz para escuchar',
    contenido: h('div', {},
      h('p', {}, 'Para leer en voz alta sin conexión, VOZI necesita descargar una sola vez:'),
      h('ul', {}, faltan.map((p) => h('li', {}, `${p.title} (${(p.size / 1e6).toFixed(0)} MB)`))),
      h('p', { class: 'nota-suave' }, `Total aproximado: ${(total / 1e6).toFixed(0)} MB. Se guarda en este dispositivo y se reutiliza.`)),
    botones: [{ texto: 'Ahora no', valor: false }, { texto: 'Ir a descargar', valor: true, clase: 'primario' }],
  });
  if (r) irAjustes('recursos');
}
