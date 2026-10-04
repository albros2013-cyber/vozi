// VOZI — Orquestación de la escucha: preparar tramos, reproducir de forma continua,
// preparar el siguiente tramo mientras se escucha y guardar el punto de lectura.
import { ctx, guardarAjustes } from './estado.js';
import { db, actualizarMeta } from './db.js';
import { vozPorId } from './voices.js';
import { cargarManifiesto, estadoPaquete } from './resources.js';
import { idiomasDeParrafos } from './tts/idioma.js';
import { planificarTramo, buscarTramoGuardado, prepararTramo, hashParrafos } from './tts/tramos.js';
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

// Elige el paquete de voz y las voces (español/inglés) para un tramo y comprueba que estén descargados.
// El inglés usa siempre las voces naturales (Supertonic 3): el mismo modelo habla ambos idiomas.
export async function vozLista({ necesitaEn = false, necesitaEs = true } = {}) {
  const vozEs = vozPorId(ctx.ajustes.vozId);
  const vozEn = vozPorId(ctx.ajustes.vozIdEn || 'en-emma');
  const man = await cargarManifiesto();
  const motor = man.packs.find((p) => p.id === 'motor-voz');
  const packId = necesitaEn ? 'voz-supertonic3' : vozEs.pack;
  const pack = man.packs.find((p) => p.id === packId);
  if (!pack || !motor) return { ok: false, voz: vozEs, faltan: [] };
  const faltan = [];
  for (const p of [motor, pack]) if (!(await estadoPaquete(p)).instalado) faltan.push(p);
  const natural = vozEs.pack === 'voz-supertonic3';
  const voz = {
    id: vozEs.id + (necesitaEn ? '+' + vozEn.id : ''), vozEsId: vozEs.id, vozEnId: necesitaEn ? vozEn.id : null,
    nombre: vozEs.nombre,
    sidEs: pack.engine === 'supertonic' ? (natural ? vozEs.sid : (vozEs.genero === 'm' ? 8 : 2)) : vozEs.sid,
    sidEn: vozEn.sid,
  };
  return { ok: faltan.length === 0, voz, pack, faltan, soloEn: !necesitaEs };
}

// Dónde empieza el tramo que sigue a `rec` (párrafo y oración)
function siguientePos(rec) {
  if (rec.completo === false) return { p: rec.fin, s: (rec.finS || 0) + 1 };
  return { p: rec.fin + 1, s: 0 };
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
async function obtenerTramo(doc, inicioIdx, minutos, { visible, signal, onPlan, desdeOracion = 0, rapido = false }) {
  const propio = visible ? est.preparando : null;
  const actualizar = (cambios) => {
    if (!propio) return;
    Object.assign(propio, cambios);
    if (est.preparando === propio) emitir('preparacion', propio);
  };
  const plan = planificarTramo(doc, inicioIdx, minutos, ctx.ajustes.cps, ctx.ajustes.diccionario,
    { leerNotasPie: !!ctx.ajustes.leerNotasPie, idiomas: idiomasDeParrafos(doc), desdeOracion, rapido });
  if (!plan.items.length) return null;
  const { ok, voz, pack, faltan } = await vozLista({ necesitaEn: plan.items.some((x) => x.lang === 'en'), necesitaEs: plan.items.some((x) => x.lang !== 'en') });
  if (!ok) {
    const e = new Error('FALTA_VOZ');
    e.faltan = faltan;
    throw e;
  }
  const guardado = await buscarTramoGuardado(doc, plan, voz, ctx.ajustes);
  if (guardado) return guardado;
  if (onPlan) onPlan(plan);
  const progreso = (p) => {
    if (visible) actualizar(p);
    else if (est.siguiente) {
      est.siguiente.fraccion = p.fraccion; emitir('siguiente', est.siguiente);
      if (est.siguiente.visible && est.preparando && est.preparando.deFondo) { Object.assign(est.preparando, p); emitir('preparacion', est.preparando); }
    }
  };
  if (visible) actualizar({ fase: 'motor', fraccion: 0 });
  await asegurarMotor(pack, (m) => {
    if (visible) actualizar({ fase: 'motor', fraccion: 0, carga: m.progress });
  });
  if (visible) actualizar({ fase: 'voz', fraccion: 0, restanteSeg: null });
  const rec = await prepararTramo({ motor: ctx.motor, doc, plan, voz, pack, ajustes: ctx.ajustes, onProgreso: progreso, signal });
  // Velocidad real de preparación en este dispositivo (para dimensionar el siguiente tramo)
  if (rec.segSintesis && rec.duracion > 3) {
    const r = rec.segSintesis / rec.duracion;
    guardarAjustes({ rtf: Math.round(((ctx.ajustes.rtf || r) * 0.6 + r * 0.4) * 100) / 100 });
  }
  // Ajustar la estimación de velocidad de habla con lo medido
  if (rec.cpsMedido && isFinite(rec.cpsMedido)) {
    const cps = Math.round((ctx.ajustes.cps * 0.6 + rec.cpsMedido * 0.4) * 10) / 10;
    if (Math.abs(cps - ctx.ajustes.cps) > 0.2) guardarAjustes({ cps });
  }
  return rec;
}

// Busca un tramo ya preparado que CONTENGA el párrafo (no solo que empiece en él) y siga válido
async function tramoGuardadoQueContiene(doc, pid) {
  const lista = await db.byIndex('audio', 'docId', doc.id);
  const vozEs = ctx.ajustes.vozId, vozEn = ctx.ajustes.vozIdEn || 'en-emma';
  const candidatos = lista.filter((a) => a.parrafos && a.parrafos.includes(pid) && a.parrafosHash && a.tiempos && a.tiempos.some((t) => t.pid === pid && t.s === 0)
    && (a.vozEsId || String(a.vozId).split('+')[0]) === vozEs && (!a.vozEnId || a.vozEnId === vozEn)
    && (a.numSteps || 5) === (ctx.ajustes.numSteps || 5) && !!a.notasPie === !!ctx.ajustes.leerNotasPie)
    .sort((x, y) => y.creado - x.creado);
  for (const a of candidatos) if (hashParrafos(doc, a.parrafos) === a.parrafosHash) return a;
  return null;
}

// Punto de entrada: escuchar el documento actual desde un párrafo
export async function escucharDesde(pidx, { reproducir = true, desdeOracion = 0 } = {}) {
  const doc = ctx.doc;
  if (!doc) return;
  ctx.rep.desbloquear();
  const pid = doc.paragraphs[pidx] && doc.paragraphs[pidx].id;
  emitir('objetivo', { pid, s: 0 }); // resaltar al instante el párrafo elegido
  // 1) ¿Está dentro del tramo cargado? → salto inmediato
  if (ctx.rep.tramo && ctx.rep.tramo.docId === doc.id && ctx.rep.irAParrafo(pid)) {
    if (reproducir) ctx.rep.reproducir();
    return;
  }
  // 2) ¿Hay audio ya preparado que lo contenga? → se usa sin volver a sintetizar
  const guardado = await tramoGuardadoQueContiene(doc, pid).catch(() => null);
  if (guardado) {
    cancelarPreparacion();
    try {
      await ctx.rep.cargar(guardado, 0);
      ctx.rep.irAParrafo(pid);
      if (reproducir) await ctx.rep.reproducir();
      emitir('tramo', guardado);
      programarSiguiente(guardado);
      return;
    } catch { /* si el audio falla, se prepara de nuevo */ }
  }
  // 3) ¿Se está preparando en segundo plano el tramo que lo contiene? → esperar ese trabajo, no empezar de cero
  const sig = est.siguiente;
  if (sig && sig.docId === doc.id && sig.parrafos && sig.parrafos.includes(pid) && !sig.error && !(sig.parrafos[0] === pid && sig.desdeS > 0)) {
    cancelarPreparacion();
    est.preparando = { abort: sig.abort, fraccion: sig.fraccion || 0, restanteSeg: null, fase: 'voz', inicio: pidx, deFondo: true };
    sig.visible = true;
    emitir('preparacion', est.preparando);
    const esperando = est.preparando;
    const rec = await sig.promesa;
    if (est.preparando === esperando) { est.preparando = null; emitir('preparacion', null); }
    if (rec && ctx.doc === doc) {
      est.siguiente = null;
      await ctx.rep.cargar(rec, 0);
      ctx.rep.irAParrafo(pid);
      if (reproducir) await ctx.rep.reproducir();
      emitir('tramo', rec);
      programarSiguiente(rec);
      return;
    }
  }
  // 4) Preparar desde aquí: primero un tramo corto para empezar pronto
  cancelarPreparacion();
  cancelarSiguiente();
  const abort = new AbortController();
  est.preparando = { abort, fraccion: 0, restanteSeg: null, fase: 'inicio', inicio: pidx };
  emitir('preparacion', est.preparando);
  // Inicio rápido: la primera oración sola (~5-15 s de audio) para oír la voz cuanto antes;
  // los tramos siguientes crecen según la velocidad real del dispositivo.
  const rapido = ctx.ajustes.primerTramoCorto !== false;
  const minutos = rapido ? 0.15 : ctx.ajustes.tramoMin;
  const propio = est.preparando;
  const soltar = () => { if (est.preparando === propio) { est.preparando = null; emitir('preparacion', null); } };
  try {
    const rec = await obtenerTramo(doc, pidx, minutos, { visible: true, signal: abort.signal, desdeOracion, rapido });
    soltar();
    if (abort.signal.aborted) return;
    if (!rec) { aviso('No hay más texto para leer desde aquí.'); return; }
    if (ctx.doc !== doc) return;
    await ctx.rep.cargar(rec, 0);
    if (reproducir) await ctx.rep.reproducir();
    emitir('tramo', rec);
    programarSiguiente(rec);
  } catch (e) {
    soltar();
    if (est.preparando && est.preparando !== propio && e && e.name === 'AbortError') return; // reemplazada por otra petición
    manejarError(e);
  }
}

// Precarga la voz en memoria para que el primer «Escuchar» no espere la carga del modelo
export async function precalentar() {
  try {
    if (!ctx.doc || ctx.motor.listo) return;
    const { ok, pack } = await vozLista();
    if (!ok) return;
    await ctx.motor.preparar(pack, null, Math.max(1, Math.min(2, ctx.ajustes.procesos || 1)));
    // Preparar ya el comienzo en el punto guardado: al tocar ▶ suena casi de inmediato
    const doc = ctx.doc;
    if (!doc || ctx.rep.tramo || est.preparando || est.siguiente) return;
    const pr = await db.get('progress', doc.id);
    let pidx = pr ? indicePorPid(doc, pr.pid) : 0;
    if (pidx < 0) pidx = 0;
    if (await tramoGuardadoQueContiene(doc, doc.paragraphs[pidx].id)) return;
    const abort = new AbortController();
    const sig = { desde: 'pre:' + pidx, abort, fraccion: 0, rec: null, docId: doc.id, parrafos: null, desdeS: 0 };
    sig.promesa = obtenerTramo(doc, pidx, 0.15, { visible: false, signal: abort.signal, rapido: true, onPlan: (p) => { sig.parrafos = p.parrafos; } })
      .then((r) => { sig.rec = r; return r; })
      .catch((e) => { sig.error = e; return null; });
    est.siguiente = sig;
  } catch { /* se reintentará al escuchar */ }
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
  const { p: desde, s: desdeS } = siguientePos(rec);
  if (!doc || desde >= doc.paragraphs.length) return;
  const clave = desde + ':' + desdeS;
  if (est.siguiente && est.siguiente.desde === clave) return;
  cancelarSiguiente();
  const abort = new AbortController();
  const sig = { desde: clave, abort, fraccion: 0, rec: null, docId: doc.id, parrafos: null };
  // Tamaño adaptativo: que el siguiente tramo alcance a estar listo antes de que termine el actual
  const rtf = Math.max(0.25, ctx.ajustes.rtf || 1);
  const minutos = Math.max(0.5, Math.min(ctx.ajustes.tramoMin, (rec.duracion * 0.85) / rtf / 60));
  // Mientras el dispositivo no sea mucho más rápido que el tiempo real, los tramos se cortan entre oraciones
  sig.promesa = obtenerTramo(doc, desde, minutos, { visible: false, signal: abort.signal, desdeOracion: desdeS, rapido: rtf > 0.6, onPlan: (p) => { sig.parrafos = p.parrafos; sig.desdeS = desdeS; } })
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
  const { p: desde, s: desdeS } = siguientePos(actual);
  const clave = desde + ':' + desdeS;
  if (desde >= doc.paragraphs.length) {
    emitir('finDocumento');
    aviso('Llegaste al final del documento.');
    return;
  }
  let rec = null;
  if (est.siguiente && est.siguiente.desde === clave && est.siguiente.docId === doc.id) {
    if (!est.siguiente.rec) {
      est.esperandoSiguiente = true;
      emitir('esperando', true);
      rec = await est.siguiente.promesa;
      est.esperandoSiguiente = false;
      emitir('esperando', false);
    } else rec = est.siguiente.rec;
    est.siguiente = null;
  }
  if (!rec) { await escucharDesde(desde, { desdeOracion: desdeS }); return; }
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
  // Solo la ficha ligera: no se reescribe el documento completo en cada avance
  doc.ultimaLectura = Date.now();
  doc.progresoPct = Math.round(100 * Math.max(0, pidx) / Math.max(1, doc.paragraphs.length - 1));
  await actualizarMeta(doc.id, { ultimaLectura: doc.ultimaLectura, progresoPct: doc.progresoPct });
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
    if (rec && (rec.vozId === voz.id || String(rec.vozId).startsWith(voz.id + '+')) && rec.parrafos.every((id) => doc.paragraphs.some((p) => p.id === id))) {
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
