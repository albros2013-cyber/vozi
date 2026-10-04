// VOZI — Descarga explícita de recursos para usar sin conexión (voces, motor, OCR).
// Cada archivo se divide en trozos verificados con SHA-256. Lo ya descargado se conserva
// si la descarga se interrumpe, y se reanuda desde el último trozo correcto.
import { db } from './db.js';

export const RES_CACHE = 'vozi-res-v1';
let manifestCache = null;

export async function cargarManifiesto() {
  if (manifestCache) return manifestCache;
  let resp = null;
  try { resp = await fetch('res/manifest.json', { cache: 'no-cache' }); } catch { /* sin conexión */ }
  if (!resp || !resp.ok) {
    const c = await caches.open(RES_CACHE);
    resp = await c.match(new URL('res/manifest.json', location.href).href);
  }
  if (!resp) throw new Error('No se pudo leer la lista de recursos. Conéctate a internet una vez para descargarla.');
  const man = await resp.clone().json();
  // Guardar copia para uso sin conexión
  try { (await caches.open(RES_CACHE)).put(new URL('res/manifest.json', location.href).href, resp); } catch { /* ignorar */ }
  manifestCache = man;
  return man;
}

export function abs(url) { return new URL(url, location.href).href; }

function claveRegistro(pack) { return `pack:${pack.id}@${pack.version}`; }

export function trozos(pack) {
  const out = [];
  for (const f of pack.files) for (const c of f.chunks) out.push(c);
  return out;
}

// Estado: {instalado, bytesHechos, bytesTotal}
export async function estadoPaquete(pack) {
  const reg = await db.get('resources', claveRegistro(pack));
  const hechos = new Set(reg ? reg.ok : []);
  const total = trozos(pack).reduce((s, c) => s + c.size, 0);
  let bytes = 0, completos = true;
  const cache = await caches.open(RES_CACHE);
  for (const c of trozos(pack)) {
    if (hechos.has(c.sha256)) {
      // Verificar que el trozo siga existiendo (el sistema pudo haber liberado espacio)
      const r = await cache.match(abs(c.url));
      if (r) { bytes += c.size; continue; }
    }
    completos = false;
  }
  return { instalado: completos, bytesHechos: bytes, bytesTotal: total };
}

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class ErrorDescarga extends Error {
  constructor(tipo, mensaje) { super(mensaje); this.tipo = tipo; }
}

// Descarga un paquete. onProgreso({bytesHechos, bytesTotal, velocidad})
export async function descargarPaquete(pack, onProgreso, signal) {
  const cache = await caches.open(RES_CACHE);
  const clave = claveRegistro(pack);
  const reg = (await db.get('resources', clave)) || { key: clave, ok: [], id: pack.id, version: pack.version };
  const hechos = new Set(reg.ok);
  const lista = trozos(pack);
  const total = lista.reduce((s, c) => s + c.size, 0);
  let bytes = 0;
  const pendientes = [];
  for (const c of lista) {
    if (hechos.has(c.sha256) && await cache.match(abs(c.url))) bytes += c.size;
    else pendientes.push(c);
  }
  // Comprobar espacio disponible antes de empezar
  const faltan = pendientes.reduce((s, c) => s + c.size, 0);
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { quota, usage } = await navigator.storage.estimate();
      if (quota && usage != null && quota - usage < faltan * 1.1) {
        throw new ErrorDescarga('espacio', `No hay espacio suficiente: se necesitan ${mb(faltan)} y quedan unos ${mb(quota - usage)} disponibles para VOZI. Libera espacio en el dispositivo o borra audios guardados.`);
      }
    } catch (e) { if (e instanceof ErrorDescarga) throw e; }
  }
  const t0 = performance.now();
  let bajadosSesion = 0;
  onProgreso && onProgreso({ bytesHechos: bytes, bytesTotal: total, velocidad: 0 });
  for (const c of pendientes) {
    let intentos = 0;
    while (true) {
      if (signal && signal.aborted) throw new ErrorDescarga('cancelada', 'Descarga en pausa. Lo descargado se conserva.');
      try {
        const buf = await bajarTrozo(abs(c.url), c.size, signal, (n) => {
          const vel = (bajadosSesion + n) / ((performance.now() - t0) / 1000);
          onProgreso && onProgreso({ bytesHechos: bytes + n, bytesTotal: total, velocidad: vel });
        });
        const h = await sha256Hex(buf);
        if (h !== c.sha256 || buf.byteLength !== c.size) throw new ErrorDescarga('integridad', 'Un archivo llegó incompleto o dañado.');
        try {
          await cache.put(abs(c.url), new Response(buf, { headers: { 'Content-Type': tipoContenido(c.url), 'Content-Length': String(buf.byteLength) } }));
        } catch (e) {
          throw new ErrorDescarga('espacio', 'El dispositivo no tiene espacio suficiente para guardar las voces. Libera espacio e inténtalo de nuevo; lo ya descargado se conserva.');
        }
        hechos.add(c.sha256);
        reg.ok = Array.from(hechos);
        await db.put('resources', reg);
        bytes += c.size; bajadosSesion += c.size;
        break;
      } catch (e) {
        if (e.name === 'AbortError' || (signal && signal.aborted)) throw new ErrorDescarga('cancelada', 'Descarga en pausa. Lo descargado se conserva.');
        if (e instanceof ErrorDescarga && e.tipo === 'espacio') throw e;
        intentos++;
        if (intentos >= 3) {
          if (e instanceof ErrorDescarga) throw e;
          throw new ErrorDescarga('red', navigator.onLine === false
            ? 'Sin conexión a internet. La descarga se reanudará donde quedó cuando vuelvas a intentarlo.'
            : 'La descarga se interrumpió. Puedes reanudarla: lo ya descargado se conserva.');
        }
        await new Promise((r) => setTimeout(r, 1200 * intentos));
      }
    }
  }
  reg.completo = true; reg.fecha = Date.now();
  await db.put('resources', reg);
  onProgreso && onProgreso({ bytesHechos: total, bytesTotal: total, velocidad: 0 });
  return true;
}

function tipoContenido(url) {
  if (/\.m?js$/.test(url)) return 'text/javascript';
  if (/\.wasm$/.test(url)) return 'application/wasm';
  if (/\.json$/.test(url)) return 'application/json';
  return 'application/octet-stream';
}

async function bajarTrozo(url, size, signal, onBytes) {
  const resp = await fetch(url, { cache: 'no-store', signal });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  if (!resp.body || !resp.body.getReader) return await resp.arrayBuffer();
  const reader = resp.body.getReader();
  const out = new Uint8Array(size);
  let off = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (off + value.length > size) throw new ErrorDescarga('integridad', 'Un archivo llegó con un tamaño inesperado.');
    out.set(value, off); off += value.length;
    onBytes(off);
  }
  return off === size ? out.buffer : out.slice(0, off).buffer;
}

export async function borrarPaquete(pack) {
  const cache = await caches.open(RES_CACHE);
  for (const c of trozos(pack)) await cache.delete(abs(c.url));
  await db.del('resources', claveRegistro(pack));
}

// Elimina versiones antiguas de paquetes que ya no están en el manifiesto
export async function limpiarObsoletos(man) {
  const vigentes = new Set();
  for (const p of man.packs) for (const c of trozos(p)) vigentes.add(abs(c.url));
  const cache = await caches.open(RES_CACHE);
  let borrados = 0;
  for (const req of await cache.keys()) {
    if (req.url.includes('/res/') && !req.url.endsWith('manifest.json') && !vigentes.has(req.url)) {
      await cache.delete(req); borrados++;
    }
  }
  const regs = await db.all('resources');
  for (const r of regs) {
    if (r.key.startsWith('pack:') && !man.packs.some((p) => claveRegistro(p) === r.key)) await db.del('resources', r.key);
  }
  return borrados;
}

export function mb(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1).replace('.', ',') + ' GB';
  return Math.max(0.1, b / 1e6).toFixed(b < 1e7 ? 1 : 0).replace('.', ',') + ' MB';
}
