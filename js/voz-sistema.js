// VOZI — Voces del propio iPhone/iPad/Mac (las de Siri, «Mejorada» y «Premium») con la API de voz del navegador.
// Hablan al instante, sin preparar audio y sin internet. No se pueden guardar como archivo de audio.
import { ctx } from './estado.js';
import { dividirOraciones } from './tts/segmenter.js';
import { normalizar } from './tts/normalize-es.js';
import { normalizarEn } from './tts/normalize-en.js';
import { idiomasDeParrafos } from './tts/idioma.js';
import { textoVozTabla } from './tablas.js';

export const hayVozSistema = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

let cacheVoces = null;
export function vocesSistema() {
  if (!hayVozSistema()) return Promise.resolve([]);
  const ya = speechSynthesis.getVoices();
  if (ya.length) { cacheVoces = ya; return Promise.resolve(ya); }
  return new Promise((res) => {
    const fin = () => { cacheVoces = speechSynthesis.getVoices(); res(cacheVoces); };
    speechSynthesis.addEventListener('voiceschanged', fin, { once: true });
    setTimeout(fin, 1500);
  });
}

// Calidad según el nombre o identificador que da el sistema
export function calidadVoz(v) {
  const s = (v.name + ' ' + v.voiceURI).toLowerCase();
  if (/premium/.test(s)) return 3;
  if (/enhanced|mejorada|neural|natural/.test(s)) return 2;
  if (/eloquence|espeak|novelty|bad news|bells|bubbles|cellos|jester|organ|superstar|trinoids|whisper|zarvox|albert|boing|wobble|bahh|fred|junior|ralph|kathy/i.test(s)) return 0;
  return 1;
}
export const etiquetaCalidad = (q) => ['Básica', 'Estándar', 'Mejorada', 'Premium'][q];

// Voces de un idioma, las mejores primero (en español: primero las latinoamericanas)
export function vocesDeIdioma(voces, lang) {
  const pref = lang === 'es' ? ['es-CO', 'es-MX', 'es-US', 'es-419', 'es-AR', 'es-CL', 'es-ES'] : ['en-US', 'en-GB'];
  return voces.filter((v) => (v.lang || '').toLowerCase().startsWith(lang) && calidadVoz(v) > 0)
    .sort((a, b) => calidadVoz(b) - calidadVoz(a) || idx(pref, a.lang) - idx(pref, b.lang) || a.name.localeCompare(b.name));
}
function idx(arr, lang) { const i = arr.findIndex((p) => (lang || '').replace('_', '-').toLowerCase() === p.toLowerCase()); return i < 0 ? 99 : i; }

export function vozElegida(voces, lang) {
  const id = lang === 'en' ? ctx.ajustes.vozSistemaEn : ctx.ajustes.vozSistemaEs;
  return voces.find((v) => v.voiceURI === id) || vocesDeIdioma(voces, lang)[0] || null;
}

// Frase de prueba
export async function probarVoz(v, texto) {
  if (!hayVozSistema()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.voice = v; u.lang = v.lang; u.rate = 1;
  speechSynthesis.speak(u);
}

// Unidades a leer (una oración por unidad) desde un párrafo; texto ya normalizado para la voz
export function unidadesDesde(doc, pidx, desdeOracion = 0) {
  const idiomas = idiomasDeParrafos(doc);
  const out = [];
  for (let i = pidx; i < doc.paragraphs.length; i++) {
    const p = doc.paragraphs[i];
    if (!p.text || !p.text.trim()) continue;
    if (p.kind === 'pie' && !ctx.ajustes.leerNotasPie) continue;
    const fuente = p.kind === 'tabla' ? textoVozTabla(p, ctx.ajustes.cuadros || 'ambos').texto : p.text;
    const lang = idiomas[i] || 'es';
    dividirOraciones(fuente).forEach((o, s) => {
      if (i === pidx && s < desdeOracion) return;
      const original = fuente.slice(o.start, o.end);
      const dicho = (lang === 'en' ? normalizarEn(original, { diccionario: ctx.ajustes.diccionario }) : normalizar(original, { diccionario: ctx.ajustes.diccionario })).trim();
      if (dicho) out.push({ pid: p.id, pidx: i, s, texto: dicho, lang, chars: original.length, titulo: p.kind === 'h' });
    });
  }
  return out;
}
