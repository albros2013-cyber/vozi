/* VOZI — Service worker: funcionamiento sin conexión y actualizaciones seguras.
 * - La app (código) se guarda en una caché por versión: nunca se mezclan módulos de versiones distintas.
 * - Voces, motores y OCR se guardan aparte (vozi-res-v1) y se conservan entre versiones.
 * - Los datos del usuario (IndexedDB) nunca se tocan aquí. */
const VERSION = '3dac1c5b8e';
const APP_CACHE = 'vozi-app-' + VERSION;
const RES_CACHE = 'vozi-res-v1';
const SHELL = [
"./css/app.css",
"./icons/apple-touch-icon.png",
"./icons/icon-192.png",
"./icons/icon-512.png",
"./icons/icon-maskable-512.png",
"./index.html",
"./js/app.js",
"./js/backup.js",
"./js/db.js",
"./js/estado.js",
"./js/import/ocr-worker.js",
"./js/import/ocr.js",
"./js/import/pdf.js",
"./js/import/textos.js",
"./js/lectura.js",
"./js/player.js",
"./js/resources.js",
"./js/tts/engine.js",
"./js/tts/idioma.js",
"./js/tts/normalize-en.js",
"./js/tts/normalize-es.js",
"./js/tts/segmenter.js",
"./js/tts/tramos.js",
"./js/tts/tts-worker.js",
"./js/ui.js",
"./js/vistas/ajustes.js",
"./js/vistas/biblioteca.js",
"./js/vistas/estudiar.js",
"./js/vistas/importar.js",
"./js/vistas/leer.js",
"./js/voices.js",
"./js/zip.js",
"./licencias.html",
"./licenses/apache-2.0.txt",
"./licenses/bigscience-open-rail-m.txt",
"./licenses/gpl-3.0.txt",
"./licenses/pdfjs-LICENSE.txt",
"./licenses/sherpa-onnx-LICENSE.txt",
"./licenses/supertonic-code-MIT.txt",
"./licenses/tessdata-LICENSE.txt",
"./licenses/tesseract.js-core-LICENSE.txt",
"./licenses/unlicense.txt",
"./manifest.webmanifest",
"./samples/en-st0.m4a",
"./samples/en-st3.m4a",
"./samples/en-st5.m4a",
"./samples/en-st6.m4a",
"./samples/es_MX-ald-medium.m4a",
"./samples/es_MX-claude-high.m4a",
"./samples/st2.m4a",
"./samples/st4.m4a",
"./samples/st8.m4a",
"./samples/st9.m4a",
"./vendor/pdfjs/pdf.mjs",
"./vendor/pdfjs/pdf.worker.mjs",
"./vendor/pdfjs/standard_fonts/FoxitDingbats.pfb",
"./vendor/pdfjs/standard_fonts/FoxitFixed.pfb",
"./vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb",
"./vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
"./vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
"./vendor/pdfjs/standard_fonts/FoxitSerif.pfb",
"./vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb",
"./vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
"./vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
"./vendor/pdfjs/standard_fonts/FoxitSymbol.pfb",
"./vendor/pdfjs/standard_fonts/LICENSE_FOXIT",
"./vendor/pdfjs/standard_fonts/LICENSE_LIBERATION",
"./vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
"./vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
"./vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
"./vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf"
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // Descarga atómica: si un archivo falla, la versión nueva no se instala y sigue la anterior
    await Promise.all(SHELL.map(async (url) => {
      const resp = await fetch(new Request(url, { cache: 'reload' }));
      if (!resp.ok) throw new Error('No se pudo guardar ' + url);
      await cache.put(url, resp);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('vozi-app-') && k !== APP_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'ACTIVAR') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Lista de recursos: primero la red (para conocer versiones nuevas), luego la copia guardada
  if (url.pathname.endsWith('/res/manifest.json')) {
    event.respondWith(fetch(req).catch(() => caches.open(RES_CACHE).then((c) => c.match(url.href))));
    return;
  }
  event.respondWith((async () => {
    const res = await caches.open(RES_CACHE);
    const enRes = await res.match(url.href);
    if (enRes) return enRes;
    const app = await caches.open(APP_CACHE);
    if (req.mode === 'navigate') {
      return (await app.match('./index.html')) || fetch(req);
    }
    const enApp = await app.match(req, { ignoreSearch: true });
    if (enApp) return enApp;
    try {
      const r = await fetch(req);
      // Guardar bajo demanda archivos auxiliares (p. ej., tablas de PDF.js)
      if (r.ok && url.pathname.includes('/vendor/pdfjs/')) app.put(req, r.clone());
      return r;
    } catch (e) {
      return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
