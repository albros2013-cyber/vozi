/* VOZI — Reconocimiento óptico de caracteres (Tesseract, WebAssembly) en segundo plano.
 * Extrae el TEXTO escrito en una imagen. No describe fotografías ni interpreta gráficos.
 * Mensajes: {type:'init', base, cacheName, dataUrl} · {type:'ocr', id, png:ArrayBuffer} */
'use strict';
let Tess = null, api = null, actual = null;

async function init({ base, cacheName, dataUrl }) {
  let resp = null;
  if (cacheName && self.caches) resp = await (await caches.open(cacheName)).match(dataUrl);
  if (!resp) { resp = await fetch(dataUrl).catch(() => null); if (!resp || !resp.ok) throw new Error('FALTA_OCR'); }
  const datos = new Uint8Array(await resp.arrayBuffer());
  importScripts(base + 'tesseract-core-simd-lstm.js');
  Tess = await self.TesseractCore({
    locateFile: (p) => base + p,
    TesseractProgress: (pct) => { if (actual != null) self.postMessage({ type: 'progress', id: actual, progress: Math.max(0, Math.min(1, (pct - 30) / 70)) }); },
    print: () => {}, printErr: () => {},
  });
  Tess.FS.writeFile('/spa.traineddata', datos);
  api = new Tess.TessBaseAPI();
  const st = api.Init(null, 'spa', 1);
  if (st !== 0) throw new Error('No se pudo iniciar el reconocimiento de texto');
  api.SetVariable('preserve_interword_spaces', '0');
  api.SetVariable('user_defined_dpi', '300');
  self.postMessage({ type: 'ready' });
}

function ocr({ id, png }) {
  actual = id;
  Tess.FS.writeFile('/input', new Uint8Array(png));
  const r = api.SetImageFile(1, 0);
  if (r === 1) throw new Error('No se pudo leer la imagen');
  api.SetPageSegMode(3); // segmentación automática de página
  api.Recognize(null);
  const texto = api.GetUTF8Text() || '';
  const confianza = api.MeanTextConf();
  api.Clear();
  try { Tess.FS.unlink('/input'); } catch { /* ignorar */ }
  actual = null;
  self.postMessage({ type: 'result', id, texto, confianza });
}

let cola = Promise.resolve();
self.onmessage = (e) => {
  const m = e.data;
  cola = cola.then(async () => {
    try {
      if (m.type === 'init') await init(m);
      else if (m.type === 'ocr') ocr(m);
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
    }
  });
};
