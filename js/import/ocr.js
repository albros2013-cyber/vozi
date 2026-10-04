// VOZI — Cliente de OCR y preparación de imágenes (fotos, capturas, páginas escaneadas).
import { cargarManifiesto, estadoPaquete, abs, RES_CACHE } from '../resources.js';

let worker = null, listo = null, seq = 0;
const pendientes = new Map();

export async function ocrDisponible() {
  const man = await cargarManifiesto();
  const p = man.packs.find((x) => x.id === 'ocr-spa');
  if (!p) return false;
  return (await estadoPaquete(p)).instalado;
}

async function asegurar() {
  if (listo) return listo;
  const man = await cargarManifiesto();
  const p = man.packs.find((x) => x.id === 'ocr-spa');
  worker = new Worker('js/import/ocr-worker.js');
  listo = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') resolve();
      else if (m.type === 'progress') pendientes.get(m.id)?.onProgreso?.(m.progress);
      else if (m.type === 'result') { pendientes.get(m.id)?.resolve(m); pendientes.delete(m.id); }
      else if (m.type === 'error') {
        const err = new Error(/FALTA_OCR/.test(m.message) ? 'Falta el paquete de reconocimiento de texto. Descárgalo en Ajustes → Recursos sin conexión.' : 'Error al reconocer el texto: ' + m.message);
        if (m.id != null && pendientes.has(m.id)) { pendientes.get(m.id).reject(err); pendientes.delete(m.id); } else reject(err);
      }
    };
  });
  worker.postMessage({ type: 'init', base: abs('vendor/tesseract/'), cacheName: RES_CACHE, dataUrl: abs(p.files[0].chunks[0].url) });
  try { await listo; } catch (e) { cerrarOcr(); throw e; }
  return listo;
}

export function cerrarOcr() {
  if (worker) worker.terminate();
  worker = null; listo = null;
  for (const p of pendientes.values()) p.reject(Object.assign(new Error('Reconocimiento cancelado'), { name: 'AbortError' }));
  pendientes.clear();
}

// png: ArrayBuffer de una imagen PNG ya preparada
export async function reconocer(png, onProgreso, signal) {
  await asegurar();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pendientes.set(id, { resolve, reject, onProgreso });
    if (signal) signal.addEventListener('abort', () => cerrarOcr(), { once: true });
    worker.postMessage({ type: 'ocr', id, png }, [png]);
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
