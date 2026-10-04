/* VOZI — Service worker: funcionamiento sin conexión y actualizaciones seguras.
 * - La app (código) se guarda en una caché por versión: nunca se mezclan módulos de versiones distintas.
 * - Voces, motores y OCR se guardan aparte (vozi-res-v1) y se conservan entre versiones.
 * - Los datos del usuario (IndexedDB) nunca se tocan aquí. */
const VERSION = '__VERSION__';
const APP_CACHE = 'vozi-app-' + VERSION;
const RES_CACHE = 'vozi-res-v1';
const SHELL = __SHELL__;

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
