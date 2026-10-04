import { dividirOraciones, reconstruirParrafos, partirLarga } from '../js/tts/segmenter.js';
const t = 'El Dr. Pérez llegó a las 3 p. m. con el informe. ¿Lo leyó? ¡Claro que sí! Según J. R. Gómez, el PIB creció 3.5 % (aprox.). Fin... Y después "otra cosa." Última';
for (const s of dividirOraciones(t)) console.log('[' + t.slice(s.start, s.end) + ']');
console.log(reconstruirParrafos('La econo-\nmía colombiana creció de forma\nsostenida durante el periodo.\n\nSegundo párrafo con un enfoque\nteórico-\npráctico muy claro.\n• Viñeta uno\n• Viñeta dos'));
console.log(partirLarga('Esta es una oración extremadamente larga que contiene muchas ideas, varias cláusulas subordinadas y enumeraciones; además incluye datos, cifras, referencias y comentarios adicionales que hacen que el modelo de voz tenga que procesar demasiado texto de una sola vez, lo cual podría afectar la entonación final de la frase completa.', 150));
