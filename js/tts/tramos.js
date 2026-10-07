// VOZI — Preparación de "tramos": bloques continuos de audio de varios minutos.
// Un tramo se sintetiza completo, se une en un solo archivo y se reproduce con un único
// reproductor, sin reinicios entre oraciones o párrafos.
import { normalizar } from './normalize-es.js';
import { normalizarEn } from './normalize-en.js';
import { dividirOraciones, partirLarga } from './segmenter.js';
import { db, uid } from '../db.js';
import { textoVozTabla } from '../tablas.js';

export const PAUSAS = { parte: 0.12, oracion: 0.3, fila: 0.45, parrafo: 0.75, titulo: 0.9 };
const MAX_GRUPO = 220;

// Hash corto (FNV-1a) para detectar cambios de texto
export function hashTexto(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// Planifica un tramo a partir del párrafo `inicio`. Termina en un final de párrafo cuando
// la duración estimada alcanza `minutos`.
export function planificarTramo(doc, inicio, minutos, cps, diccionario, { leerNotasPie = false, idiomas = null, desdeOracion = 0, rapido = false, cuadros = 'ambos' } = {}) {
  // rapido: inicio inmediato — la primera unidad es una sola oración y el tramo puede cortarse
  // entre oraciones (no solo al final de un párrafo).
  const objetivo = minutos * 60;
  const items = [];
  const parrafos = [];
  let est = 0, finS = 0, completo = true;
  for (let i = inicio; i < doc.paragraphs.length; i++) {
    const p = doc.paragraphs[i];
    if (!p.text.trim()) continue;
    if (p.kind === 'pie' && !leerNotasPie) continue; // notas al pie: se muestran, la voz las omite
    // Cuadros: interpretación (si hay) y/o fila por fila, en lugar del texto suelto
    const fuente = p.kind === 'tabla' ? textoVozTabla(p, cuadros).texto : p.text;
    const oraciones = dividirOraciones(fuente);
    const lang = (idiomas && idiomas[i]) || 'es';
    // Fluidez: las oraciones cortas consecutivas se sintetizan juntas (hasta ~220 caracteres),
    // para que la voz enlace la entonación entre ellas como lo haría una persona.
    const unidades = [];
    let grupo = null;
    const cerrarGrupo = () => { if (grupo) unidades.push(grupo); grupo = null; };
    oraciones.forEach((o, si) => {
      if (i === inicio && si < desdeOracion) return;
      const original = fuente.slice(o.start, o.end);
      const dicho = lang === 'en' ? normalizarEn(original, { diccionario }) : normalizar(original, { diccionario });
      if (!dicho.trim()) return;
      if (dicho.length > MAX_GRUPO || p.kind === 'h' || p.kind === 'tabla') { // títulos y filas de cuadros no se agrupan: conservan su pausa
        cerrarGrupo();
        const partes = partirLarga(dicho, 280);
        partes.forEach((t, pi) => unidades.push({ text: t, oraciones: [{ s: si, n: t.length }], s: si, pi, ultimaParte: pi === partes.length - 1 }));
        return;
      }
      const primeraSola = rapido && !items.length && !unidades.length && !grupo;
      if (primeraSola) { unidades.push({ text: dicho, oraciones: [{ s: si, n: dicho.length }], s: si, pi: 0, ultimaParte: true }); return; }
      if (grupo && grupo.text.length + 1 + dicho.length <= MAX_GRUPO) {
        grupo.text += ' ' + dicho;
        grupo.oraciones.push({ s: si, n: dicho.length + 1 });
      } else {
        cerrarGrupo();
        grupo = { text: dicho, oraciones: [{ s: si, n: dicho.length }], s: si, pi: 0, ultimaParte: true };
      }
    });
    cerrarGrupo();
    let cortado = false;
    for (let ui = 0; ui < unidades.length; ui++) {
      const u = unidades[ui];
      const ultima = ui === unidades.length - 1;
      const pausa = ultima ? (p.kind === 'h' || p.kind === 'tabla' ? PAUSAS.titulo : PAUSAS.parrafo) : (u.ultimaParte ? (p.kind === 'tabla' ? PAUSAS.fila : PAUSAS.oracion) : PAUSAS.parte);
      items.push({ id: `${p.id}|${u.s}|${u.pi}`, pid: p.id, pidx: i, s: u.s, oraciones: u.oraciones, text: u.text, pausa, lang });
      est += u.text.length / cps + pausa;
      finS = u.oraciones[u.oraciones.length - 1].s;
      if (rapido && est >= objetivo && !ultima && u.ultimaParte) { cortado = true; break; }
    }
    if (unidades.length) parrafos.push(p.id);
    completo = !cortado;
    if (est >= objetivo) break;
  }
  const textHash = hashTexto(items.map((x) => x.lang + ':' + x.text).join('\n'));
  const fin = items.length ? items[items.length - 1].pidx : inicio;
  return { items, parrafos, inicio, desdeOracion, fin, finS, completo, estimadoSeg: est, textHash };
}

export function hashParrafos(doc, ids) {
  const mapa = new Map(doc.paragraphs.map((p) => [p.id, p]));
  return hashTexto(ids.map((id) => { const p = mapa.get(id); return p ? p.kind + ':' + p.text + (p.interpretacion ? '|' + p.interpretacion : '') : '∅'; }).join('\n') + '|' + (doc.idioma || 'auto'));
}

export function claveTramo(doc, plan, voz, ajustes) {
  return [doc.id, voz.id, plan.parrafos[0] + '@' + (plan.desdeOracion || 0) + '-' + plan.finS + (plan.completo ? 'c' : ''), plan.parrafos.length, plan.textHash, ajustes.numSteps || 5, ajustes.velocidadVoz || 1].join(':');
}

export async function buscarTramoGuardado(doc, plan, voz, ajustes) {
  const clave = claveTramo(doc, plan, voz, ajustes);
  const lista = await db.byIndex('audio', 'docId', doc.id);
  return lista.find((a) => a.clave === clave) || null;
}

// Ensambla las piezas sintetizadas en un único audio con pausas controladas y volumen uniforme.
export function ensamblar(piezas, sampleRate) {
  // Igualación suave de volumen: cada pieza se acerca a la mediana (máximo ±4 dB)
  const rms = piezas.map((p) => {
    let s = 0; const x = p.samples;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return x.length ? Math.sqrt(s / x.length) : 0;
  });
  const validos = rms.filter((r) => r > 0.005).sort((a, b) => a - b);
  const mediana = validos.length ? validos[validos.length >> 1] : 0.1;
  let total = 0;
  for (const p of piezas) total += p.samples.length + Math.round(p.pausa * sampleRate);
  const out = new Float32Array(total);
  const tiempos = [];
  let off = 0;
  piezas.forEach((p, i) => {
    let g = rms[i] > 0.005 ? mediana / rms[i] : 1;
    g = Math.min(1.585, Math.max(0.63, g));
    const x = p.samples;
    for (let k = 0; k < x.length; k++) out[off + k] = x[k] * g;
    const t0 = off / sampleRate;
    off += x.length;
    if (p.oraciones && p.oraciones.length > 1) {
      const cortes = cortesOraciones(x, sampleRate, p.oraciones);
      p.oraciones.forEach((o, k) => tiempos.push({ id: p.id + '#' + k, pid: p.pid, s: o.s, t0: t0 + cortes[k], t1: t0 + cortes[k + 1] }));
    } else tiempos.push({ id: p.id, pid: p.pid, s: p.s, t0, t1: off / sampleRate });
    off += Math.round(p.pausa * sampleRate);
  });
  // Normalización de pico a -1 dBFS
  let pico = 0;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > pico) pico = a; }
  if (pico > 0) { const g = 0.89 / pico; for (let i = 0; i < out.length; i++) out[i] *= g; }
  return { samples: out, tiempos, duracion: total / sampleRate };
}

// Ubica dónde termina cada oración dentro de un audio agrupado: parte de la proporción de
// caracteres y busca el silencio más claro cercano. Devuelve [0, c1, ..., duración] en segundos.
export function cortesOraciones(x, sr, oraciones) {
  const dur = x.length / sr;
  const hop = Math.round(sr * 0.01);
  const energia = new Float32Array(Math.ceil(x.length / hop));
  for (let f = 0; f < energia.length; f++) {
    let e = 0; const a = f * hop, b = Math.min(x.length, a + hop);
    for (let k = a; k < b; k++) e += x[k] * x[k];
    energia[f] = Math.sqrt(e / Math.max(1, b - a));
  }
  const total = oraciones.reduce((s, o) => s + o.n, 0);
  const cortes = [0];
  let acum = 0;
  for (let k = 0; k < oraciones.length - 1; k++) {
    acum += oraciones[k].n;
    const esperado = (acum / total) * dur;
    const ventana = Math.max(0.6, dur * 0.12);
    const f0 = Math.max(Math.round((cortes[k] + 0.2) * 100), Math.round((esperado - ventana) * 100));
    const f1 = Math.min(energia.length - 1, Math.round((esperado + ventana) * 100));
    // Buscar el tramo de 80 ms con menor energía (pausa entre oraciones)
    let mejor = Math.round(esperado * 100), minimo = Infinity;
    for (let f = f0; f + 8 <= f1; f++) {
      let e = 0; for (let j = 0; j < 8; j++) e += energia[f + j];
      const penal = Math.abs(f + 4 - esperado * 100) * 0.0004;
      if (e + penal < minimo) { minimo = e + penal; mejor = f + 4; }
    }
    cortes.push(Math.min(dur, Math.max(cortes[k] + 0.1, mejor / 100)));
  }
  cortes.push(dur);
  return cortes;
}

export function codificarWav(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  const pcm = new Int16Array(buf, 44, n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Prepara (sintetiza, ensambla y guarda) un tramo. onProgreso({fraccion, restanteSeg, fase})
// Recorta un plan hasta la unidad k (incluida): queda un tramo válido y más corto
export function truncarPlan(plan, k) {
  const items = plan.items.slice(0, k + 1);
  const ult = items[k], sig = plan.items[k + 1];
  const fin = ult.pidx;
  const finS = ult.oraciones[ult.oraciones.length - 1].s;
  const completo = !sig || sig.pidx !== fin;
  const usados = new Set(items.map((x) => x.pid));
  return { ...plan, items, parrafos: plan.parrafos.filter((id) => usados.has(id)), fin, finS, completo,
    textHash: hashTexto(items.map((x) => x.lang + ':' + x.text).join('\n')) };
}

// corte: {pedido, alPedir} — si quien escucha ya está esperando, se entrega YA lo que esté listo
// (las primeras oraciones terminadas) y el resto pasa al tramo siguiente.
export async function prepararTramo({ motor, doc, plan, voz, pack, ajustes, onProgreso, signal, corte }) {
  let piezas = new Array(plan.items.length);
  const interno = new AbortController();
  if (signal) { if (signal.aborted) interno.abort(); else signal.addEventListener('abort', () => interno.abort(), { once: true }); }
  let cortarEn = -1;
  const intentarCorte = () => {
    if (!corte || !corte.pedido || cortarEn >= 0) return;
    let k = -1;
    for (let i = 0; i < piezas.length && piezas[i]; i++) if (plan.items[i].pausa !== PAUSAS.parte) k = i; // nunca a mitad de oración
    if (k < 0 || k >= plan.items.length - 1) return;
    cortarEn = k;
    interno.abort();
  };
  if (corte) corte.alPedir = intentarCorte;
  const outRate = pack.engine === 'supertonic' ? 24000 : undefined;
  let sr = outRate || pack.sampleRate || 22050;
  const t0 = performance.now();
  await motor.sintetizar(
    plan.items.map((it) => (pack.engine === 'supertonic'
      ? { id: it.id, text: it.text, lang: it.lang, sid: it.lang === 'en' ? voz.sidEn : voz.sidEs }
      : { id: it.id, text: it.text })),
    { sid: voz.sidEs || 0, lang: pack.engine === 'supertonic' ? 'es' : undefined, numSteps: ajustes.numSteps || 5,
      speed: ajustes.velocidadVoz || 1.0, outRate, charsPorSegundo: ajustes.cps || 14 },
    (m) => {
      const it = plan.items[m.index];
      piezas[m.index] = { id: it.id, pid: it.pid, s: it.s, oraciones: it.oraciones, pausa: it.pausa, samples: m.samples };
      sr = m.sampleRate;
      const trans = (performance.now() - t0) / 1000;
      const restante = m.progress > 0.02 ? trans * (1 - m.progress) / m.progress : null;
      onProgreso && onProgreso({ fraccion: m.progress, restanteSeg: restante, fase: 'voz', rtf: m.audioSeg ? trans / m.audioSeg : null });
      intentarCorte();
    },
    interno.signal,
  ).catch((e) => { if (!(cortarEn >= 0 && e.name === 'AbortError' && !(signal && signal.aborted))) throw e; });
  if (corte) corte.alPedir = null;
  if (cortarEn >= 0) { plan = truncarPlan(plan, cortarEn); piezas = piezas.slice(0, cortarEn + 1); }
  onProgreso && onProgreso({ fraccion: 1, restanteSeg: 0, fase: 'guardando' });
  const { samples, tiempos, duracion } = ensamblar(piezas.filter(Boolean), sr);
  const blob = codificarWav(samples, sr);
  const segSintesis = (performance.now() - t0) / 1000;
  const chars = plan.items.reduce((s, x) => s + x.text.length, 0);
  const rec = {
    id: uid('au'), docId: doc.id, clave: claveTramo(doc, plan, voz, ajustes), vozId: voz.id,
    inicio: plan.inicio, desdeOracion: plan.desdeOracion || 0, fin: plan.fin, finS: plan.finS, completo: plan.completo !== false, parrafos: plan.parrafos, tiempos, duracion, sampleRate: sr,
    bytes: blob.size, creado: Date.now(), segSintesis, cpsMedido: chars / Math.max(0.1, duracion),
    vozEsId: voz.vozEsId || voz.id, vozEnId: voz.vozEnId || null, numSteps: ajustes.numSteps || 5, notasPie: !!ajustes.leerNotasPie,
    parrafosHash: hashParrafos(doc, plan.parrafos),
  };
  await db.put('audioBlobs', { id: rec.id, blob });
  await db.put('audio', rec);
  return rec;
}
