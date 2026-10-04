// VOZI — Lectura y escritura mínima de archivos ZIP (para DOCX y copias de seguridad).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data, crc = 0) {
  crc = crc ^ 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflarRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no puede descomprimir el archivo (requiere iOS 16.4 o posterior).');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Lee un ZIP desde ArrayBuffer/Blob. Devuelve Map(nombre → {leer: async () => Uint8Array, tam})
export async function leerZip(fuente) {
  const buf = fuente instanceof Blob ? await fuente.arrayBuffer() : fuente;
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo está dañado o no es un documento válido.');
  let n = dv.getUint16(eocd + 10, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  // ZIP64
  if (cdOff === 0xffffffff || n === 0xffff) {
    const loc = eocd - 20;
    if (dv.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      n = Number(dv.getBigUint64(z64 + 32, true));
      cdOff = Number(dv.getBigUint64(z64 + 48, true));
    }
  }
  const dec = new TextDecoder();
  const entradas = new Map();
  let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('El archivo está dañado (directorio interno inválido).');
    const flags = dv.getUint16(p + 8, true);
    const metodo = dv.getUint16(p + 10, true);
    let comp = dv.getUint32(p + 20, true);
    let tam = dv.getUint32(p + 24, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
    let local = dv.getUint32(p + 42, true);
    const nombre = dec.decode(u8.subarray(p + 46, p + 46 + ln));
    // Campo extra ZIP64
    let e = p + 46 + ln;
    const eFin = e + le;
    while (e < eFin) {
      const id = dv.getUint16(e, true), sz = dv.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (tam === 0xffffffff) { tam = Number(dv.getBigUint64(q, true)); q += 8; }
        if (comp === 0xffffffff) { comp = Number(dv.getBigUint64(q, true)); q += 8; }
        if (local === 0xffffffff) { local = Number(dv.getBigUint64(q, true)); }
      }
      e += 4 + sz;
    }
    if (flags & 1) throw new Error('El documento está protegido con contraseña.');
    const lnL = dv.getUint16(local + 26, true), leL = dv.getUint16(local + 28, true);
    const ini = local + 30 + lnL + leL;
    entradas.set(nombre, {
      tam,
      leer: async () => {
        const datos = u8.subarray(ini, ini + comp);
        if (metodo === 0) return datos.slice();
        if (metodo === 8) return inflarRaw(datos);
        throw new Error('Formato de compresión no compatible.');
      },
    });
    p += 46 + ln + le + lc;
  }
  return entradas;
}

// Escribe un ZIP sin compresión (los audios WAV y JSON ya ocupan lo que ocupan).
// archivos: [{nombre, datos: Uint8Array|Blob}] → Blob
export async function escribirZip(archivos) {
  const enc = new TextEncoder();
  const partes = [];
  const central = [];
  let off = 0;
  for (const a of archivos) {
    const datos = a.datos instanceof Blob ? new Uint8Array(await a.datos.arrayBuffer()) : a.datos;
    const nombre = enc.encode(a.nombre);
    const crc = crc32(datos);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, datos.length, true); h.setUint32(22, datos.length, true);
    h.setUint16(26, nombre.length, true);
    partes.push(new Uint8Array(h.buffer), nombre, datos);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, datos.length, true); c.setUint32(24, datos.length, true);
    c.setUint16(28, nombre.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nombre);
    off += 30 + nombre.length + datos.length;
  }
  const tamCentral = central.reduce((s, x) => s + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, off, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: 'application/zip' });
}
