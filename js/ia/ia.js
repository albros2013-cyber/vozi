// VOZI — Inteligencia artificial DENTRO del dispositivo (sin internet después de la descarga, sin costo).
// Usa WebLLM (WebGPU) con modelos abiertos pequeños. El texto nunca sale del equipo.
// Tareas: resumir, preguntas de repaso, preguntar sobre el texto y explicar un párrafo.
import { ctx, guardarAjustes } from '../estado.js';
import { getSetting, setSetting } from '../db.js';

import { instalarFetchResistente } from './red.js';

const LIB = new URL('../../vendor/webllm/web-llm.js', import.meta.url).href;
if (typeof window !== 'undefined') instalarFetchResistente(window);

// Modelos ofrecidos (si la versión de WebLLM los trae). f16 = más rápido y liviano si el equipo lo permite.
export const MODELOS_IA = [
  { id: 'qwen3-1.7b', nombre: 'Equilibrado', detalle: 'Qwen3 1,7B · buen español · ≈1 GB', base: 'Qwen3-1.7B', piensa: true },
  { id: 'qwen2.5-1.5b', nombre: 'Ligero', detalle: 'Qwen2.5 1,5B · el más rápido · ≈0,9 GB', base: 'Qwen2.5-1.5B-Instruct' },
  { id: 'qwen3-4b', nombre: 'Más capaz', detalle: 'Qwen3 4B · mejor análisis, más lento · ≈2,3 GB', base: 'Qwen3-4B', piensa: true },
];

const simulada = () => { try { return localStorage.getItem('vozi-ia-simulada') === '1'; } catch (e) { return false; } };

let lib = null, motor = null, cargadoId = null, cargando = null, f16 = null, ocioso = null;

export function modeloElegido() { return MODELOS_IA.find((m) => m.id === ctx.ajustes.iaModelo) || MODELOS_IA[0]; }

// ¿Este navegador puede usar la tarjeta gráfica (WebGPU)?
export async function soporteIA() {
  if (simulada()) return { ok: true, f16: true };
  if (!('gpu' in navigator)) return { ok: false, motivo: 'Este navegador no permite usar la tarjeta gráfica (WebGPU). En iPhone necesitas iOS 26 o posterior.' };
  try {
    const ad = await navigator.gpu.requestAdapter();
    if (!ad) return { ok: false, motivo: 'No se encontró una tarjeta gráfica compatible.' };
    f16 = ad.features.has('shader-f16');
    return { ok: true, f16 };
  } catch (e) { return { ok: false, motivo: 'WebGPU no está disponible: ' + e.message }; }
}

async function cargarLib() {
  if (!lib) {
    try { lib = await import(LIB); } catch (e) { throw new Error('No se pudo cargar el motor de IA. Revisa la conexión la primera vez.'); }
  }
  return lib;
}

async function idReal(m) {
  if (f16 == null) await soporteIA();
  const l = await cargarLib();
  const lista = l.prebuiltAppConfig.model_list.map((x) => x.model_id);
  const prefer = [`${m.base}-q4f${f16 ? 16 : 32}_1-MLC`, `${m.base}-q4f32_1-MLC`];
  const id = prefer.find((x) => lista.includes(x));
  if (!id) throw new Error(`El modelo ${m.nombre} no está disponible en esta versión.`);
  return id;
}

export async function modeloDescargado(m = modeloElegido()) {
  if (simulada()) return !!(await getSetting('ia-sim-descargado', false));
  try { const l = await cargarLib(); return await l.hasModelInCache(await idReal(m), configApp(l)); } catch (e) { return false; }
}

export async function borrarModelo(m = modeloElegido()) {
  if (simulada()) { await setSetting('ia-sim-descargado', false); return; }
  await descargarMotor();
  const l = await cargarLib();
  await l.deleteModelAllInfoInCache(await idReal(m), configApp(l));
}

export async function descargarMotor() {
  clearTimeout(ocioso);
  if (motor) { try { await motor.unload(); } catch (e) { /* nada */ } }
  motor = null; cargadoId = null; cargando = null;
}

// Carga (y descarga la primera vez) el modelo elegido. onProgreso({fraccion, texto})
export async function prepararIA(onProgreso) {
  const m = modeloElegido();
  if (motor && cargadoId === m.id) return motor;
  if (cargando && cargando.id === m.id) return cargando.p;
  await descargarMotor();
  // Liberar la memoria de la voz si no está sonando: el modelo de IA ocupa 1-3 GB
  if (ctx.motor && !(ctx.rep && ctx.rep.reproduciendo)) ctx.motor.terminar();
  const p = (async () => {
    if (simulada()) {
      for (let i = 1; i <= 5; i++) { onProgreso && onProgreso({ fraccion: i / 5, texto: 'Descargando modelo (simulado)…' }); await new Promise((r) => setTimeout(r, 60)); }
      await setSetting('ia-sim-descargado', true);
      motor = new MotorSimulado(); cargadoId = m.id; return motor;
    }
    const s = await soporteIA();
    if (!s.ok) throw new Error(s.motivo);
    const l = await cargarLib();
    const id = await idReal(m);
    const conf = () => ({
      appConfig: configApp(l),
      initProgressCallback: (r) => onProgreso && onProgreso({ fraccion: r.progress || 0, texto: traducirProgreso(r.text || '') }),
    });
    const enProceso = async () => {
      const w = new Worker(new URL('./ia-worker.js', import.meta.url), { type: 'module' });
      try { return await l.CreateWebWorkerMLCEngine(w, id, conf()); } catch (e) { w.terminate(); throw e; }
    };
    const esRed = (e) => (e && e.red) || /Load failed|fetch|network|NetworkError|descargar/i.test(String(e && e.message));
    await mantenerPantalla(true); // que el iPhone/iPad no se duerma a mitad de la descarga
    try {
      try { motor = await enProceso(); } catch (e) {
        if (/memory|OOM/i.test(String(e && e.message))) throw e;
        if (esRed(e) && !usaIDB()) {
          // Safari a veces falla guardando archivos grandes en la caché web: probar con IndexedDB
          usarIDB(true);
          onProgreso && onProgreso({ fraccion: 0, texto: 'Reintentando la descarga con otro almacenamiento…' });
          try { motor = await enProceso(); } catch (e2) { if (esRed(e2)) usarIDB(false); throw e2; }
        } else if (!esRed(e)) {
          // Si el navegador no permite la tarjeta gráfica dentro del proceso, se usa en la página
          motor = await l.CreateMLCEngine(id, conf());
        } else throw e;
      }
    } finally { await mantenerPantalla(false); }
    cargadoId = m.id;
    return motor;
  })();
  cargando = { id: m.id, p };
  try { return await p; } catch (e) { motor = null; cargadoId = null; throw traducirError(e); } finally { cargando = null; }
}

// Dónde guarda WebLLM los modelos: caché web (normal) o IndexedDB (respaldo para Safari)
function usaIDB() { try { return localStorage.getItem('vozi-ia-idb') === '1'; } catch (e) { return false; } }
function usarIDB(si) { try { if (si) localStorage.setItem('vozi-ia-idb', '1'); else localStorage.removeItem('vozi-ia-idb'); } catch (e) { /* nada */ } }
function configApp(l) { return usaIDB() ? { ...l.prebuiltAppConfig, cacheBackend: 'indexeddb', useIndexedDBCache: true } : l.prebuiltAppConfig; }

let candado = null;
async function mantenerPantalla(si) {
  try {
    if (si && 'wakeLock' in navigator && !candado) candado = await navigator.wakeLock.request('screen');
    if (!si && candado) { await candado.release(); candado = null; }
  } catch (e) { /* no disponible */ }
}

function traducirProgreso(t) {
  if (/Fetching param cache|Loading model from cache|fetch/i.test(t)) {
    const mb = t.match(/(\d+)MB/g);
    return 'Descargando el modelo' + (mb && mb.length >= 1 ? ` (${mb.join(' de ')})` : '') + '…';
  }
  if (/Loading GPU shader|shader/i.test(t)) return 'Preparando la tarjeta gráfica…';
  if (/Finish loading/i.test(t)) return 'Modelo listo.';
  return 'Cargando el modelo…';
}

function traducirError(e) {
  const m = String(e && e.message || e);
  if (/memory|OOM|allocation|Device was lost|lost/i.test(m)) return new Error('El equipo se quedó sin memoria para la IA. Cierra otras apps o elige el modelo «Ligero».');
  if (/shader-f16|f16/i.test(m)) return new Error('La tarjeta gráfica no admite este formato. Prueba otra vez: VOZI usará el formato compatible.');
  if (e && e.red) return new Error(m + '. Revisa el wifi, deja la pantalla encendida y vuelve a intentarlo: lo ya descargado se conserva.');
  if (/Load failed|fetch|network/i.test(m)) return new Error('La descarga del modelo se interrumpió (' + m + '). Revisa el wifi, deja la pantalla encendida y vuelve a intentarlo: lo ya descargado se conserva.');
  return new Error('Error de la IA: ' + m);
}

// Genera texto con el modelo. onTexto(textoAcumulado). Devuelve {texto, tokens, seg}
export async function generar(mensajes, { maxTokens = 450, temperatura = 0.3, onTexto, signal } = {}) {
  const eng = await prepararIA();
  clearTimeout(ocioso);
  const m = modeloElegido();
  const t0 = performance.now();
  let texto = '', tokens = 0;
  const onAbort = () => { try { eng.interruptGenerate(); } catch (e) { /* nada */ } };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const flujo = await eng.chat.completions.create({
      messages: mensajes, stream: true, max_tokens: maxTokens, temperature: temperatura, top_p: 0.9,
      stream_options: { include_usage: true },
      ...(m.piensa ? { extra_body: { enable_thinking: false } } : {}),
    });
    for await (const parte of flujo) {
      const d = parte.choices && parte.choices[0] && parte.choices[0].delta && parte.choices[0].delta.content;
      if (d) { texto += d; tokens++; onTexto && onTexto(limpiar(texto)); }
      if (parte.usage && parte.usage.completion_tokens) tokens = parte.usage.completion_tokens;
      if (signal && signal.aborted) break;
    }
  } catch (e) { if (!(signal && signal.aborted)) throw traducirError(e); }
  finally { if (signal) signal.removeEventListener('abort', onAbort); }
  // Liberar memoria tras 5 minutos sin uso
  ocioso = setTimeout(() => descargarMotor(), 5 * 60 * 1000);
  if (signal && signal.aborted) { const e = new Error('Cancelado'); e.name = 'AbortError'; throw e; }
  return { texto: limpiar(texto), tokens, seg: (performance.now() - t0) / 1000 };
}

// Quita restos de «pensamiento» de Qwen3 y espacios sobrantes
function limpiar(t) { return t.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, ''); }

// ---------- Texto del documento en fragmentos ----------
function textoParrafos(doc) {
  return doc.paragraphs.filter((p) => p.text && p.text.trim() && p.kind !== 'pie');
}

// Fragmentos de hasta `max` caracteres que respetan los párrafos; guardan las páginas que abarcan
export function fragmentar(doc, max = 5000) {
  const out = [];
  let cur = null;
  for (const p of textoParrafos(doc)) {
    const t = p.kind === 'h' ? `## ${p.text}` : p.text;
    if (cur && cur.texto.length + t.length + 1 > max) { out.push(cur); cur = null; }
    if (!cur) cur = { texto: '', desde: p.page, hasta: p.page, pids: [] };
    if (t.length > max) { // párrafo enorme: partirlo
      for (let i = 0; i < t.length; i += max) out.push({ texto: t.slice(i, i + max), desde: p.page, hasta: p.page, pids: [p.id] });
      continue;
    }
    cur.texto += (cur.texto ? '\n' : '') + t; cur.hasta = p.page; cur.pids.push(p.id);
  }
  if (cur && cur.texto) out.push(cur);
  return out;
}

const SISTEMA = 'Eres un asistente de estudio. Respondes SIEMPRE en español claro y natural, sin inventar datos que no estén en el texto.';

function paginas(f) { return f.desde == null ? '' : (f.desde === f.hasta ? ` (pág. ${f.desde})` : ` (págs. ${f.desde}-${f.hasta})`); }

// ---------- Tareas ----------
// Resumen por partes y luego un resumen final. onEstado({fase, i, n, texto})
export async function resumir(doc, { onEstado, signal } = {}) {
  const frs = fragmentar(doc);
  if (!frs.length) throw new Error('El documento no tiene texto para resumir.');
  const parciales = [];
  for (let i = 0; i < frs.length; i++) {
    onEstado && onEstado({ fase: 'parte', i: i + 1, n: frs.length, texto: '' });
    const r = await generar([
      { role: 'system', content: SISTEMA },
      { role: 'user', content: `Resume las ideas principales de este fragmento en 3 a 6 viñetas breves (empieza cada una con «- »).\n\nFRAGMENTO:\n${frs[i].texto}` },
    ], { maxTokens: 300, signal, onTexto: (t) => onEstado && onEstado({ fase: 'parte', i: i + 1, n: frs.length, texto: t }) });
    parciales.push(r.texto.trim());
  }
  if (frs.length === 1) {
    onEstado && onEstado({ fase: 'final', texto: '' });
    return (await generar([
      { role: 'system', content: SISTEMA },
      { role: 'user', content: `Escribe un resumen del siguiente texto: primero un párrafo de 3 a 5 oraciones con la idea general y luego «Ideas clave:» con 4 a 6 viñetas (empieza cada una con «- »).\n\nTEXTO:\n${frs[0].texto}` },
    ], { maxTokens: 500, signal, onTexto: (t) => onEstado && onEstado({ fase: 'final', texto: t }) })).texto;
  }
  // Reducir por grupos si hay muchas partes (el modelo admite unas 4.000 palabras-token a la vez)
  let notas = parciales;
  while (notas.join('\n').length > 7000) {
    const grupos = [];
    for (let i = 0; i < notas.length; i += 5) grupos.push(notas.slice(i, i + 5));
    const nuevas = [];
    for (const g of grupos) {
      const r = await generar([
        { role: 'system', content: SISTEMA },
        { role: 'user', content: `Une estas notas en 4 a 6 viñetas sin repetir ideas (empieza cada una con «- »).\n\n${g.join('\n')}` },
      ], { maxTokens: 300, signal });
      nuevas.push(r.texto.trim());
    }
    notas = nuevas;
  }
  onEstado && onEstado({ fase: 'final', texto: '' });
  return (await generar([
    { role: 'system', content: SISTEMA },
    { role: 'user', content: `Estas son notas de las distintas partes de un documento, en orden. Escribe el resumen del documento completo: primero un párrafo de 3 a 5 oraciones con la idea general y luego «Ideas clave:» con 5 a 7 viñetas (empieza cada una con «- »).\n\nNOTAS:\n${notas.join('\n')}` },
  ], { maxTokens: 550, signal, onTexto: (t) => onEstado && onEstado({ fase: 'final', texto: t }) })).texto;
}

// Preguntas de repaso con respuesta. Devuelve [{q, a, page}]
export async function preguntasRepaso(doc, { porFragmento = 3, maxFragmentos = 8, onEstado, signal } = {}) {
  let frs = fragmentar(doc, 4000);
  if (frs.length > maxFragmentos) { // repartir a lo largo del documento
    const paso = frs.length / maxFragmentos;
    frs = Array.from({ length: maxFragmentos }, (_, i) => frs[Math.floor(i * paso)]);
  }
  const todas = [];
  for (let i = 0; i < frs.length; i++) {
    onEstado && onEstado({ fase: 'parte', i: i + 1, n: frs.length, texto: '' });
    const r = await generar([
      { role: 'system', content: SISTEMA },
      { role: 'user', content: `Escribe ${porFragmento} preguntas de repaso sobre las ideas más importantes de este fragmento, cada una con su respuesta breve y exacta según el texto. Usa EXACTAMENTE este formato, sin numerar:\nP: pregunta\nR: respuesta\n\nFRAGMENTO:\n${frs[i].texto}` },
    ], { maxTokens: 400, signal, onTexto: (t) => onEstado && onEstado({ fase: 'parte', i: i + 1, n: frs.length, texto: t }) });
    for (const par of extraerPreguntas(r.texto)) todas.push({ ...par, page: frs[i].desde ?? null });
  }
  return todas;
}

export function extraerPreguntas(t) {
  const out = [];
  let q = null;
  for (const linea of t.split('\n').map((x) => x.trim().replace(/^[-*\d.)\s]+(?=[PR]\s*[:：])/i, ''))) {
    const mq = linea.match(/^(?:P|Pregunta)\s*[:：]\s*(.+)/i);
    const mr = linea.match(/^(?:R|Respuesta)\s*[:：]\s*(.+)/i);
    if (mq) q = mq[1].trim();
    else if (mr && q) { out.push({ q, a: mr[1].trim() }); q = null; }
  }
  return out;
}

// Pregunta libre: busca los fragmentos más relacionados y responde solo con ellos
export async function preguntar(doc, pregunta, { onTexto, signal } = {}) {
  const frs = fragmentar(doc, 1500);
  const claves = palabras(pregunta);
  const puntaje = (f) => { const p = palabras(f.texto); let s = 0; for (const c of claves) if (p.has(c)) s++; return s; };
  const elegidos = frs.map((f, i) => ({ f, i, s: puntaje(f) })).sort((a, b) => b.s - a.s).slice(0, 3).sort((a, b) => a.i - b.i);
  const contexto = elegidos.map((x) => `[Fragmento${paginas(x.f)}]\n${x.f.texto}`).join('\n\n');
  const r = await generar([
    { role: 'system', content: SISTEMA + ' Responde solo con lo que dicen los fragmentos; si no está, dilo con claridad. Menciona la página cuando la sepas.' },
    { role: 'user', content: `FRAGMENTOS DEL DOCUMENTO:\n${contexto}\n\nPREGUNTA: ${pregunta}` },
  ], { maxTokens: 400, signal, onTexto });
  return { texto: r.texto, paginas: elegidos.map((x) => x.f.desde).filter((x) => x != null) };
}

// Explica un párrafo con palabras sencillas (con el párrafo anterior como contexto)
export async function explicarParrafo(doc, idx, { onTexto, signal } = {}) {
  const p = doc.paragraphs[idx];
  const prev = doc.paragraphs.slice(Math.max(0, idx - 2), idx).map((x) => x.text).join('\n');
  const r = await generar([
    { role: 'system', content: SISTEMA },
    { role: 'user', content: `${prev ? `Contexto previo:\n${prev}\n\n` : ''}Explica con palabras sencillas el siguiente párrafo de un texto de estudio, en 3 a 5 oraciones. Si hay términos técnicos, defínelos brevemente.\n\nPÁRRAFO:\n${p.text}` },
  ], { maxTokens: 350, signal, onTexto });
  return r.texto;
}

// Prueba de velocidad: palabras por segundo
export async function probarVelocidad() {
  const r = await generar([{ role: 'user', content: 'Explica en un párrafo de unas 80 palabras qué es la fotosíntesis.' }], { maxTokens: 160 });
  return { tokensPorSeg: r.tokens / Math.max(0.1, r.seg), texto: r.texto, seg: r.seg };
}

const VACIAS = new Set('el la los las un una unos unas de del al a en y o u que se por para con sin su sus es son fue como más pero lo le les ya este esta estos estas ese esa qué cuál cuáles cómo cuándo dónde quién porque sobre entre también muy hay ser'.split(' '));
function palabras(t) {
  return new Set(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2 && !VACIAS.has(w)).map((w) => w.replace(/(es|s)$/, '')));
}

// Resultados guardados por documento (para no repetir trabajo)
export async function resultadoGuardado(docId, tarea) { return getSetting(`ia:${docId}:${tarea}`, null); }
export async function guardarResultado(docId, tarea, valor) { return setSetting(`ia:${docId}:${tarea}`, { valor, modelo: modeloElegido().id, fecha: Date.now() }); }

export async function elegirModelo(id) { await guardarAjustes({ iaModelo: id }); await descargarMotor(); }

// ---------- Motor simulado (solo pruebas automáticas, sin tarjeta gráfica) ----------
class MotorSimulado {
  constructor() { this.chat = { completions: { create: (o) => this._crear(o) } }; this.parar = false; }
  interruptGenerate() { this.parar = true; }
  async unload() {}
  async *_flujo(texto) {
    this.parar = false;
    for (const w of texto.split(/(?<=\s)/)) { if (this.parar) return; await new Promise((r) => setTimeout(r, 4)); yield { choices: [{ delta: { content: w } }] }; }
    yield { choices: [], usage: { completion_tokens: texto.split(/\s+/).length } };
  }
  async _crear({ messages }) {
    const u = messages[messages.length - 1].content;
    let t;
    if (/preguntas de repaso/.test(u)) t = 'P: ¿Qué factor explica el crecimiento?\nR: La innovación constante.\nP: ¿Qué advirtió la directora?\nR: Que no podían confiarse.\n1. P: ¿Cuándo se intensificó la competencia?\nR: En el segundo semestre.';
    else if (/PREGUNTA:/.test(u)) t = 'Según el texto (pág. 1), la competencia regional se intensificó en el segundo semestre.';
    else if (/Explica con palabras sencillas/.test(u)) t = 'Este párrafo dice, en pocas palabras, que la empresa creció por varios factores.';
    else if (/Ideas clave/.test(u)) t = '<think></think>El documento analiza el crecimiento de una empresa en un mercado competitivo.\n\nIdeas clave:\n- Las ventas crecieron.\n- La competencia aumentó.';
    else t = '- Idea principal del fragmento.\n- Segunda idea.';
    return this._flujo(t);
  }
}
