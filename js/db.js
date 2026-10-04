// VOZI — Almacenamiento local (IndexedDB). Todo queda en el dispositivo.
let dbPromise = null;
let DB_NAME = 'vozi';
// Cada sesión de usuario usa su propia base de datos (ver perfiles.js)
export function usarBase(nombre) { DB_NAME = nombre; dbPromise = null; }
const DB_VERSION = 2;
// Las migraciones solo AÑADEN almacenes/índices: nunca se borran lecturas, notas ni marcadores.
const STORES = {
  docs: { keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] },
  meta: { keyPath: 'id' }, // datos ligeros de cada documento (para listas rápidas sin cargar todo el texto)
  progress: { keyPath: 'docId' },
  bookmarks: { keyPath: 'id', indexes: [['docId', 'docId']] },
  notes: { keyPath: 'id', indexes: [['docId', 'docId']] },
  cards: { keyPath: 'id', indexes: [['docId', 'docId']] },
  audio: { keyPath: 'id', indexes: [['docId', 'docId']] },
  audioBlobs: { keyPath: 'id' },
  settings: { keyPath: 'key' },
  resources: { keyPath: 'key' },
};


export function abrir() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const migrarMeta = ev.oldVersion >= 1 && ev.oldVersion < 2;
      for (const [nombre, def] of Object.entries(STORES)) {
        let st;
        if (!db.objectStoreNames.contains(nombre)) st = db.createObjectStore(nombre, { keyPath: def.keyPath });
        else st = req.transaction.objectStore(nombre);
        for (const [iname, path] of def.indexes || []) {
          if (!st.indexNames.contains(iname)) st.createIndex(iname, path);
        }
      }
      if (migrarMeta) {
        const tx = req.transaction;
        tx.objectStore('docs').openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (!c) return;
          tx.objectStore('meta').put(metaDe(c.value));
          c.continue();
        };
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base de datos está abierta en otra pestaña con una versión anterior. Cierra las demás pestañas de VOZI.'));
  });
  return dbPromise;
}

function prom(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

async function tx(store, mode, fn) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    Promise.resolve(fn(t.objectStore(store), t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Operación cancelada'));
  });
}

export function metaDe(d) {
  return { id: d.id, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt, ultimaLectura: d.ultimaLectura || null,
    progresoPct: d.progresoPct || 0, pages: d.pages || 0, source: d.source || null, idioma: d.idioma || 'auto', npar: d.paragraphs ? d.paragraphs.length : 0 };
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => prom(s.get(key))),
  // Guardar un documento actualiza también su ficha ligera
  put: (store, val) => store === 'docs'
    ? txMulti(['docs', 'meta'], (t) => { t.objectStore('docs').put(val); t.objectStore('meta').put(metaDe(val)); })
    : tx(store, 'readwrite', (s) => prom(s.put(val))),
  del: (store, key) => store === 'docs'
    ? txMulti(['docs', 'meta'], (t) => { t.objectStore('docs').delete(key); t.objectStore('meta').delete(key); })
    : tx(store, 'readwrite', (s) => prom(s.delete(key))),
  all: (store) => tx(store, 'readonly', (s) => prom(s.getAll())),
  byIndex: (store, index, value) => tx(store, 'readonly', (s) => prom(s.index(index).getAll(value))),
  clear: (store) => tx(store, 'readwrite', (s) => prom(s.clear())),
  async delWhere(store, index, value) {
    return tx(store, 'readwrite', async (s) => {
      const keys = await prom(s.index(index).getAllKeys(value));
      for (const k of keys) s.delete(k);
      return keys.length;
    });
  },
};

async function txMulti(stores, fn) {
  const d = await abrir();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, 'readwrite');
    fn(t);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

// Lista rápida de documentos (sin cargar el texto completo)
export async function listarDocs() {
  let m = await db.all('meta');
  if (!m.length) {
    const docs = await db.all('docs');
    if (docs.length) { for (const d of docs) await db.put('meta', metaDe(d)); m = docs.map(metaDe); }
  }
  return m;
}

// Actualiza solo la ficha ligera (p. ej., avance de lectura) sin reescribir el documento
export async function actualizarMeta(id, cambios) {
  const m = await db.get('meta', id);
  if (m) await db.put('meta', { ...m, ...cambios });
}

export async function getSetting(key, def) {
  const r = await db.get('settings', key).catch(() => null);
  return r ? r.value : def;
}
export function setSetting(key, value) { return db.put('settings', { key, value }); }

export function uid(prefix = '') {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return prefix + Date.now().toString(36) + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
}

// Borra un documento y todo lo asociado (solo cuando el usuario lo pide)
export async function borrarDocumento(docId) {
  const audios = await db.byIndex('audio', 'docId', docId);
  for (const a of audios) await db.del('audioBlobs', a.id);
  for (const st of ['audio', 'bookmarks', 'notes', 'cards']) await db.delWhere(st, 'docId', docId);
  await db.del('progress', docId);
  await db.del('docs', docId);
}

export async function estimarAlmacenamiento() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export async function pedirPersistencia() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}
