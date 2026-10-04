// VOZI — Cliente de OCR y preparación de imágenes (fotos, capturas, páginas escaneadas).
import { cargarManifiesto, estadoPaquete, abs, RES_CACHE } from '../resources.js';

// Hasta dos procesos de reconocimiento en paralelo (dos páginas a la vez en equipos con varios núcleos)
let pool = [], seq = 0;
const pendientes = new Map();

export function paralelosOcr() {
  const n = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory; // no existe en Safari
  return n >= 2 && !(mem && mem < 2) ? 2 : 1;
}

export async function ocrDisponible() {
  const man = await cargarManifiesto();
  const p = man.packs.find((x) => x.id === 'ocr-spa');
  if (!p) return false;
  return (await estadoPaquete(p)).instalado;
}

function crearProceso(p) {
  const w = new Worker('js/import/ocr-worker.js');
  const slot = { w, ocupado: 0 };
  slot.listo = new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') resolve();
      else if (m.type === 'progress') pendientes.get(m.id)?.onProgreso?.(m.progress);
      else if (m.type === 'result') { const t = pendientes.get(m.id); if (t) { slot.ocupado--; t.resolve(m); pendientes.delete(m.id); } }
      else if (m.type === 'error') {
        const err = new Error(/FALTA_OCR/.test(m.message) ? 'Falta el paquete de reconocimiento de texto. Descárgalo en Ajustes → Recursos sin conexión.' : 'Error al reconocer el texto: ' + m.message);
        if (m.id != null && pendientes.has(m.id)) { slot.ocupado--; pendientes.get(m.id).reject(err); pendientes.delete(m.id); } else reject(err);
      }
    };
    w.onerror = (e) => reject(new Error('El reconocimiento de texto no pudo iniciarse: ' + (e.message || '')));
  });
  w.postMessage({ type: 'init', base: abs('vendor/tesseract/'), cacheName: RES_CACHE, datos: p.files.map((f) => ({ nombre: f.fs, urls: f.chunks.map((c) => abs(c.url)) })) });
  return slot;
}

// Elige el proceso menos ocupado; abre el segundo solo cuando el primero está trabajando
async function procesoLibre() {
  const man = await cargarManifiesto();
  const p = man.packs.find((x) => x.id === 'ocr-spa');
  // Elegir y reservar sin pausas intermedias: dos llamadas seguidas no deben caer en el mismo proceso
  let slot = pool.slice().sort((a, b) => a.ocupado - b.ocupado)[0];
  if (!slot || (slot.ocupado > 0 && pool.length < paralelosOcr())) { slot = crearProceso(p); pool.push(slot); }
  slot.ocupado++;
  try { await slot.listo; } catch (e) {
    slot.ocupado--; slot.w.terminate(); pool = pool.filter((x) => x !== slot);
    if (!pool.length) throw e; // ni siquiera el primero pudo iniciar
    slot = pool[0];            // el segundo no cupo en memoria: seguir con uno
    slot.ocupado++;
    await slot.listo;
  }
  return slot;
}

export function cerrarOcr() {
  for (const s of pool) s.w.terminate();
  pool = [];
  for (const p of pendientes.values()) p.reject(Object.assign(new Error('Reconocimiento cancelado'), { name: 'AbortError' }));
  pendientes.clear();
}

// png: ArrayBuffer de una imagen PNG ya preparada
export async function reconocer(png, onProgreso, signal) {
  if (signal && signal.aborted) throw Object.assign(new Error('Reconocimiento cancelado'), { name: 'AbortError' });
  const slot = await procesoLibre();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pendientes.set(id, { resolve, reject, onProgreso });
    if (signal) signal.addEventListener('abort', () => cerrarOcr(), { once: true });
    slot.w.postMessage({ type: 'ocr', id, png }, [png]);
  });
}

// Prepara una imagen para OCR: orientación EXIF, escala adecuada y escala de grises.
export async function prepararImagen(fuente) {
  let bmp;
  try {
    bmp = await createImageBitmap(fuente, { imageOrientation: 'from-image' });
  } catch {
    // Respaldo con <img> (algunos formatos o versiones de Safari)
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(fuente);
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo abrir la imagen. Usa JPG, PNG o HEIC compatible con tu dispositivo.')); };
      img.src = url;
    });
  }
  const w0 = bmp.width, h0 = bmp.height;
  if (!w0 || !h0) throw new Error('La imagen está vacía o dañada.');
  const maxLado = 3000, minLado = 1400;
  let esc = 1;
  const lado = Math.max(w0, h0);
  if (lado > maxLado) esc = maxLado / lado;
  else if (lado < minLado) esc = Math.min(2.5, minLado / lado);
  const w = Math.round(w0 * esc), h = Math.round(h0 * esc);
  return canvasAPng(dibujarGris(bmp, w, h));
}

export function dibujarGris(fuente, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente, 0, 0, w, h);
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  // Escala de grises + estiramiento de contraste (percentiles 1–99)
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = g; hist[g]++; }
  const n = w * h; let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
  const rango = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / rango));
    d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

export function canvasAPng(c) {
  return new Promise((res, rej) => c.toBlob((b) => b ? b.arrayBuffer().then(res, rej) : rej(new Error('No se pudo procesar la imagen (memoria insuficiente).')), 'image/png'));
}
