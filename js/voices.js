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
];

export function vozPorId(id) { return VOCES.find((v) => v.id === id) || VOCES[0]; }
