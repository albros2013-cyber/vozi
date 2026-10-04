// VOZI — Detección automática de idioma (español / inglés) por párrafo.
// Usa palabras muy frecuentes y rasgos ortográficos; funciona sin conexión y es instantánea.
const ES = new Set('de la que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mi mis tú te ti tu tus ellas nosotras vosotros vosotras os mío mía tuyo tuya suyo suya nuestro nuestra vuestro vuestra esos esas estoy estás está estamos están son ser fue era han ha he había tiene tienen puede según cada debe deben'.split(' '));
const EN = new Set('the of and to in is that for it as was with be by on not he this are or his from at which but have an they you were her she there been their one all we can has more will if would so what when its also into than them about these no could some may then other only who do any our new my those such should after how most must over where between both through being under while very upon'.split(' '));

// Devuelve 'es', 'en' o null si no hay evidencia suficiente
export function detectarIdioma(texto) {
  const palabras = texto.toLowerCase().normalize('NFC').match(/[\p{L}']+/gu) || [];
  if (!palabras.length) return null;
  let es = 0, en = 0;
  for (const w of palabras) { if (ES.has(w)) es++; if (EN.has(w)) en++; }
  // Rasgos propios del español
  const rasgos = (texto.match(/[ñ¿¡áéíóú]/gi) || []).length;
  es += Math.min(rasgos, 6) * 0.8;
  // Rasgos propios del inglés: contracciones y terminaciones frecuentes
  en += (texto.match(/\b\w+'(s|t|re|ve|ll|d|m)\b/gi) || []).length * 0.8;
  en += palabras.filter((w) => /(ing|tion|ly|ed)$/.test(w) && !/ción$/.test(w)).length * 0.25;
  // Preguntas y exclamaciones sin ¿ ¡ apuntan al inglés
  if (/\?/.test(texto) && !/¿/.test(texto)) en += 0.8;
  if (/!/.test(texto) && !/¡/.test(texto)) en += 0.5;
  const total = es + en;
  if (total < 1.5) return null;
  if (es >= en * 1.4) return 'es';
  if (en >= es * 1.4) return 'en';
  return null;
}

// Idioma de cada párrafo: el del documento si se fijó; si no, detección por párrafo
// heredando el anterior (o el predominante) cuando un párrafo es ambiguo o muy corto.
export function idiomasDeParrafos(doc) {
  if (doc.idioma === 'es' || doc.idioma === 'en') return doc.paragraphs.map(() => doc.idioma);
  const det = doc.paragraphs.map((p) => detectarIdioma(p.text));
  const conteo = { es: 0, en: 0 };
  doc.paragraphs.forEach((p, i) => { if (det[i]) conteo[det[i]] += p.text.length; });
  const predominante = conteo.en > conteo.es ? 'en' : 'es';
  let previo = predominante;
  return det.map((d) => { if (d) previo = d; return d || previo; });
}

export function idiomaPredominante(paragraphs) {
  const c = { es: 0, en: 0 };
  for (const p of paragraphs) { const d = detectarIdioma(p.text); if (d) c[d] += p.text.length; }
  if (!c.es && !c.en) return 'es';
  return c.en > c.es ? 'en' : 'es';
}
