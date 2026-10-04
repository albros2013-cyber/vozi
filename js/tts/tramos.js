// VOZI — Preparación de "tramos": bloques continuos de audio de varios minutos.
// Un tramo se sintetiza completo, se une en un solo archivo y se reproduce con un único
// reproductor, sin reinicios entre oraciones o párrafos.
import { normalizar } from './normalize-es.js';
import { normalizarEn } from './normalize-en.js';
import { dividirOraciones, partirLarga } from './segmenter.js';
import { db, uid } from '../db.js';

export const PAUSAS = { parte: 0.12, oracion: 0.34, parrafo: 0.78, titulo: 0.95 };

// Hash corto (FNV-1a) para detectar cambios de texto
export function hashTexto(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// Planifica un tramo a partir del párrafo `inicio`. Termina en un final de párrafo cuando
// la duración estimada alcanza `minutos`.
export function planificarTramo(doc, inicio, minutos, cps, diccionario, { leerNotasPie = false, idiomas = null } = {}) {
  const objetivo = minutos * 60;
  const items = [];
  const parrafos = [];
  let est = 0;
  for (let i = inicio; i < doc.paragraphs.length; i++) {
    const p = doc.paragraphs[i];
    if (!p.text.trim()) continue;
    if (p.kind === 'pie' && !leerNotasPie) continue; // notas al pie: se muestran, la voz las omite
    const oraciones = dividirOraciones(p.text);
    oraciones.forEach((o, si) => {
      const original = p.text.slice(o.start, o.end);
      const lang = (idiomas && idiomas[i]) || 'es';
      const dicho = lang === 'en' ? normalizarEn(original, { diccionario }) : normalizar(original, { diccionario });
      const partes = partirLarga(dicho, 280);
      partes.forEach((t, pi) => {
        const ultimaParte = pi === partes.length - 1;
        const ultimaOracion = si === oraciones.length - 1;
        let pausa = PAUSAS.parte;
        if (ultimaParte) pausa = ultimaOracion ? (p.kind === 'h' ? PAUSAS.titulo : PAUSAS.parrafo) : PAUSAS.oracion;
        items.push({ id: `${p.id}|${si}|${pi}`, pid: p.id, pidx: i, s: si, text: t, pausa, lang });
        est += t.length / cps + pausa;
      });
    });
    parrafos.push(p.id);
    if (est >= objetivo) break;
  }
  const textHash = hashTexto(items.map((x) => x.lang + ':' + x.text).join('\n'));
  return { items, parrafos, inicio, fin: items.length ? items[items.length - 1].pidx : inicio, estimadoSeg: est, textHash };
}

export function claveTramo(doc, plan, voz, ajustes) {
  return [doc.id, voz.id, plan.parrafos[0], plan.parrafos.length, plan.textHash, ajustes.numSteps || 5, ajustes.velocidadVoz || 1].join(':');
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
    tiempos.push({ id: p.id, pid: p.pid, s: p.s, t0, t1: off / sampleRate });
    off += Math.round(p.pausa * sampleRate);
  });
  // Normalización de pico a -1 dBFS
  let pico = 0;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > pico) pico = a; }
  if (pico > 0) { const g = 0.89 / pico; for (let i = 0; i < out.length; i++) out[i] *= g; }
  return { samples: out, tiempos, duracion: total / sampleRate };
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
export async function prepararTramo({ motor, doc, plan, voz, pack, ajustes, onProgreso, signal }) {
  const piezas = new Array(plan.items.length);
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
      piezas[m.index] = { id: it.id, pid: it.pid, s: it.s, pausa: it.pausa, samples: m.samples };
      sr = m.sampleRate;
      const trans = (performance.now() - t0) / 1000;
      const restante = m.progress > 0.02 ? trans * (1 - m.progress) / m.progress : null;
      onProgreso && onProgreso({ fraccion: m.progress, restanteSeg: restante, fase: 'voz', rtf: m.audioSeg ? trans / m.audioSeg : null });
    },
    signal,
  );
  onProgreso && onProgreso({ fraccion: 1, restanteSeg: 0, fase: 'guardando' });
  const { samples, tiempos, duracion } = ensamblar(piezas.filter(Boolean), sr);
  const blob = codificarWav(samples, sr);
  const segSintesis = (performance.now() - t0) / 1000;
  const chars = plan.items.reduce((s, x) => s + x.text.length, 0);
  const rec = {
    id: uid('au'), docId: doc.id, clave: claveTramo(doc, plan, voz, ajustes), vozId: voz.id,
    inicio: plan.inicio, fin: plan.fin, parrafos: plan.parrafos, tiempos, duracion, sampleRate: sr,
    bytes: blob.size, creado: Date.now(), segSintesis, cpsMedido: chars / Math.max(0.1, duracion),
  };
  await db.put('audioBlobs', { id: rec.id, blob });
  await db.put('audio', rec);
  return rec;
}
