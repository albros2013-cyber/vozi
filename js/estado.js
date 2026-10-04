// VOZI — Estado compartido de la aplicación.
import { getSetting, setSetting } from './db.js';

export const AJUSTES_DEF = {
  tema: 'sistema',          // 'claro' | 'oscuro' | 'sistema'
  letra: 20,                // tamaño de letra de lectura (px)
  interlineado: 1.65,
  vozId: 'st-valeria',
  vozIdEn: 'en-emma',       // voz para los párrafos en inglés (detección automática)
  tramoMin: 5,              // duración aproximada del tramo (min)
  primerTramoCorto: true,   // el primer tramo dura ~1 min para empezar antes
  velocidad: 1,             // velocidad de reproducción (sin cambiar tono)
  seguirLectura: true,      // desplazar el texto con el audio
  cps: 13.5,                // caracteres por segundo medidos (se ajusta solo)
  numSteps: 3,
  calidadVoz: 'rapida',      // natural (5 pasos) · equilibrada (4) · rapida (3)
  diccionario: [],          // [{escrito, dicho}]
  prepararSiguiente: true,  // preparar el siguiente tramo mientras se escucha
  leerNotasPie: false,      // las notas al pie se muestran pero la voz las omite
  rtf: null,                // velocidad medida de preparación en este dispositivo
  iaModelo: 'qwen3-1.7b',   // modelo de IA del dispositivo
  paralelo: 'auto',         // procesos de síntesis: 'auto' (2 si el equipo lo aguanta), 1 o 2
};

export const ctx = {
  ajustes: { ...AJUSTES_DEF },
  vista: 'biblioteca',
  doc: null,
  docsCache: null,
  motor: null,
  rep: null,
  vistas: {},
};

export const PASOS_CALIDAD = { natural: 5, equilibrada: 4, rapida: 3 };

export async function cargarAjustes() {
  const a = await getSetting('ajustes', {});
  ctx.ajustes = { ...AJUSTES_DEF, ...(a || {}) };
  ctx.ajustes.numSteps = PASOS_CALIDAD[ctx.ajustes.calidadVoz] || 3;
  return ctx.ajustes;
}

export async function guardarAjustes(cambios) {
  Object.assign(ctx.ajustes, cambios);
  await setSetting('ajustes', ctx.ajustes);
}
