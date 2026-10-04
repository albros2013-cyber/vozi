// VOZI — Copia de seguridad (exportar y restaurar) en un archivo .zip.
import { db } from './db.js';
import { leerZip, escribirZip } from './zip.js';

const STORES = ['docs', 'progress', 'bookmarks', 'notes', 'cards', 'settings'];

export async function exportarCopia({ incluirAudios = false } = {}) {
  const datos = { app: 'VOZI', formato: 1, creado: new Date().toISOString() };
  for (const s of STORES) datos[s] = await db.all(s);
  const archivos = [];
  if (incluirAudios) {
    datos.audio = await db.all('audio');
    for (const a of datos.audio) {
      const b = await db.get('audioBlobs', a.id);
      if (b && b.blob) archivos.push({ nombre: `audio/${a.id}.wav`, datos: b.blob });
    }
  }
  const json = new TextEncoder().encode(JSON.stringify(datos));
  return escribirZip([{ nombre: 'vozi-copia.json', datos: json }, ...archivos]);
}

export async function leerCopia(file) {
  let zip;
  try { zip = await leerZip(await file.arrayBuffer()); } catch { throw new Error('El archivo no es una copia de seguridad de VOZI válida.'); }
  const ent = zip.get('vozi-copia.json');
  if (!ent) throw new Error('El archivo no es una copia de seguridad de VOZI.');
  let datos;
  try { datos = JSON.parse(new TextDecoder().decode(await ent.leer())); } catch { throw new Error('La copia de seguridad está dañada.'); }
  if (datos.app !== 'VOZI') throw new Error('El archivo no es una copia de seguridad de VOZI.');
  return { datos, zip };
}

// Restaura sumando a lo existente (no borra nada que ya esté en el dispositivo)
export async function restaurarCopia({ datos, zip }) {
  const r = { docs: 0, notes: 0, audio: 0 };
  for (const s of STORES) {
    for (const item of datos[s] || []) {
      if (s === 'settings' && item.key !== 'ajustes') continue;
      await db.put(s, item);
      if (r[s] != null) r[s]++;
    }
  }
  for (const a of datos.audio || []) {
    const ent = zip.get(`audio/${a.id}.wav`);
    if (!ent) continue;
    const bytes = await ent.leer();
    await db.put('audioBlobs', { id: a.id, blob: new Blob([bytes], { type: 'audio/wav' }) });
    await db.put('audio', a);
    r.audio++;
  }
  return r;
}
