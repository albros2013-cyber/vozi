// VOZI — Sesiones de usuario (perfiles locales).
// Cada perfil tiene su PROPIA base de datos: biblioteca, notas, citas, tarjetas, marcadores,
// progreso, audios preparados y ajustes. Las voces y el OCR descargados se comparten (no se
// duplican). Todo queda en el dispositivo; no hay servidor ni cuentas en internet.
// El PIN opcional evita el acceso casual entre personas que comparten el equipo; no cifra los datos.

const CUENTAS_DB = 'vozi-cuentas';
const COLORES = ['#1F4D3A', '#8A5A3B', '#3D5A80', '#7A4E7E', '#5B6B2F', '#A0453A'];

let dbp = null;
function abrirCuentas() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(CUENTAS_DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('perfiles', { keyPath: 'id' });
      db.createObjectStore('estado', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function op(store, modo, fn) {
  const db = await abrirCuentas();
  return new Promise((res, rej) => {
    const t = db.transaction(store, modo);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}

// El primer perfil usa la base «vozi» existente: así no se pierde nada de lo ya guardado.
export function nombreBase(perfilId) { return perfilId === 'principal' ? 'vozi' : 'vozi-u-' + perfilId; }

export async function listarPerfiles() {
  let lista = (await op('perfiles', 'readonly', (s) => s.getAll())) || [];
  if (!lista.length) {
    const p = { id: 'principal', nombre: 'Yo', color: COLORES[0], creado: Date.now() };
    await op('perfiles', 'readwrite', (s) => s.put(p));
    lista = [p];
  }
  return lista.sort((a, b) => a.creado - b.creado);
}

export async function perfilActivoId() {
  const r = await op('estado', 'readonly', (s) => s.get('activo'));
  return r ? r.value : null;
}
export async function fijarPerfilActivo(id) { await op('estado', 'readwrite', (s) => s.put({ key: 'activo', value: id })); }

export async function preguntarAlIniciar() {
  const r = await op('estado', 'readonly', (s) => s.get('preguntar'));
  return r ? !!r.value : false;
}
export async function fijarPreguntarAlIniciar(v) { await op('estado', 'readwrite', (s) => s.put({ key: 'preguntar', value: !!v })); }

function aleatorio(n = 16) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join(''); }
async function hashPin(pin, sal) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sal + ':' + pin));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function crearPerfil(nombre, pin) {
  const lista = await listarPerfiles();
  const p = { id: Date.now().toString(36) + aleatorio(3), nombre: nombre.trim().slice(0, 40), color: COLORES[lista.length % COLORES.length], creado: Date.now() };
  if (pin) { p.sal = aleatorio(); p.pinHash = await hashPin(pin, p.sal); }
  await op('perfiles', 'readwrite', (s) => s.put(p));
  return p;
}

export async function actualizarPerfil(id, cambios) {
  const p = await op('perfiles', 'readonly', (s) => s.get(id));
  if (!p) return null;
  if ('nombre' in cambios) p.nombre = cambios.nombre.trim().slice(0, 40) || p.nombre;
  if ('pin' in cambios) {
    if (cambios.pin) { p.sal = aleatorio(); p.pinHash = await hashPin(cambios.pin, p.sal); }
    else { delete p.sal; delete p.pinHash; }
  }
  await op('perfiles', 'readwrite', (s) => s.put(p));
  return p;
}

export async function verificarPin(perfil, pin) {
  if (!perfil.pinHash) return true;
  return (await hashPin(pin || '', perfil.sal)) === perfil.pinHash;
}

// Borra el perfil y TODA su información (no toca las voces descargadas)
export async function eliminarPerfil(id) {
  await op('perfiles', 'readwrite', (s) => s.delete(id));
  await new Promise((res) => {
    const r = indexedDB.deleteDatabase(nombreBase(id));
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
  if ((await perfilActivoId()) === id) await fijarPerfilActivo(null);
}

export function iniciales(nombre) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}
