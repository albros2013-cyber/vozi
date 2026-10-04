// VOZI — Catálogo de voces. Selección basada en pruebas propias (ver docs/PRUEBAS.md):
// inteligibilidad medida con reconocimiento automático y comprobación de seseo latinoamericano.
export const VOCES = [
  { id: 'st-valeria', nombre: 'Valeria', genero: 'f', pack: 'voz-supertonic3', sid: 2, muestra: 'samples/st2.m4a',
    descripcion: 'Femenina · natural · acento neutro con seseo', recomendada: true },
  { id: 'st-mateo', nombre: 'Mateo', genero: 'm', pack: 'voz-supertonic3', sid: 8, muestra: 'samples/st8.m4a',
    descripcion: 'Masculina · natural · acento neutro con seseo', recomendada: true },
  { id: 'st-camila', nombre: 'Camila', genero: 'f', pack: 'voz-supertonic3', sid: 4, muestra: 'samples/st4.m4a',
    descripcion: 'Femenina · natural · tono más grave' },
  { id: 'st-andres', nombre: 'Andrés', genero: 'm', pack: 'voz-supertonic3', sid: 9, muestra: 'samples/st9.m4a',
    descripcion: 'Masculina · natural · tono grave' },
  { id: 'pi-lucia', nombre: 'Lucía (ligera)', genero: 'f', pack: 'voz-es_MX-claude-high', sid: 0, muestra: 'samples/es_MX-claude-high.m4a',
    descripcion: 'Femenina · México · más rápida de preparar, menos natural' },
  { id: 'pi-diego', nombre: 'Diego (ligera)', genero: 'm', pack: 'voz-es_MX-ald-medium', sid: 0, muestra: 'samples/es_MX-ald-medium.m4a',
    descripcion: 'Masculina · México · más rápida de preparar, menos natural' },
  // Inglés: mismo modelo Supertonic 3 (sin descarga adicional)
  { id: 'en-emma', idioma: 'en', nombre: 'Emma', genero: 'f', pack: 'voz-supertonic3', sid: 0, muestra: 'samples/en-st0.m4a',
    descripcion: 'Femenina · natural · inglés', recomendada: true },
  { id: 'en-james', idioma: 'en', nombre: 'James', genero: 'm', pack: 'voz-supertonic3', sid: 5, muestra: 'samples/en-st5.m4a',
    descripcion: 'Masculina · natural · inglés', recomendada: true },
  { id: 'en-grace', idioma: 'en', nombre: 'Grace', genero: 'f', pack: 'voz-supertonic3', sid: 3, muestra: 'samples/en-st3.m4a',
    descripcion: 'Femenina · natural · inglés · tono más claro' },
  { id: 'en-daniel', idioma: 'en', nombre: 'Daniel', genero: 'm', pack: 'voz-supertonic3', sid: 6, muestra: 'samples/en-st6.m4a',
    descripcion: 'Masculina · natural · inglés · tono grave' },
];

export const VOCES_ES = VOCES.filter((v) => v.idioma !== 'en');
export const VOCES_EN = VOCES.filter((v) => v.idioma === 'en');

export function vozPorId(id) { return VOCES.find((v) => v.id === id) || VOCES[0]; }
