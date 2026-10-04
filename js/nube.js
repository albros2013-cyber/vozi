// VOZI — Cuenta en la nube (Supabase): inicio de sesión con correo y sincronización.
// Funciona "primero sin conexión": todo se guarda en el dispositivo y, cuando hay internet,
// los cambios se suben y se descargan los de otros dispositivos. Cada usuario solo puede
// leer y escribir su propia información (reglas de seguridad por fila en el servidor).
// Se sincroniza: documentos (texto), progreso, marcadores, notas, citas, tarjetas y ajustes.
// No se sincroniza: audio preparado ni voces (cada dispositivo los genera o descarga).
import { db, crudo, SINCRONIZADOS, activarSeguimiento, getSetting, setSetting } from './db.js';

const CONFIG = {
  url: 'https://ttcmxhmumxyisyivyzlv.supabase.co',
  key: 'sb_publishable_umfmFRom5GJj0MMDPbxItw_Y2jkJyjn',
};
// Solo para pruebas automáticas: permite apuntar a un servidor local
try {
  const o = localStorage.getItem('vozi-nube-pruebas');
  if (o) Object.assign(CONFIG, JSON.parse(o));
} catch { /* sin localStorage */ }

export const APP_URL = 'https://albros2013-cyber.github.io/vozi/';
const TABLA = 'vozi_items';
const LOCALES = ['rtf', 'procesos', 'cps']; // ajustes propios de cada dispositivo: no se sincronizan

// ---------- Errores en lenguaje claro ----------
function mensajeError(status, cuerpo) {
  const t = JSON.stringify(cuerpo || '').toLowerCase();
  if (/invalid login credentials|invalid_credentials/.test(t)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed|email_not_confirmed/.test(t)) return 'Falta confirmar tu correo: abre el enlace que te enviamos y vuelve a entrar.';
  if (/already registered|user_already_exists/.test(t)) return 'Ya existe una cuenta con ese correo. Usa «Entrar».';
  if (/password should be at least|weak_password/.test(t)) return 'La contraseña es muy corta: usa al menos 8 caracteres.';
  if (/rate limit|over_email_send_rate_limit|too many/.test(t)) return 'Demasiados intentos seguidos. Espera unos minutos.';
  if (/invalid email|validation_failed/.test(t)) return 'El correo no es válido.';
  if (status === 401 || status === 403) return 'Tu sesión expiró. Vuelve a entrar con tu correo y contraseña.';
  if (/relation .* does not exist|42p01/.test(t)) return 'Falta crear la tabla de VOZI en Supabase (paso del SQL).';
  return 'No se pudo conectar con tu cuenta (' + status + ').';
}

async function llamar(ruta, { metodo = 'GET', cuerpo, token, encabezados = {} } = {}) {
  let r;
  try {
    r = await fetch(CONFIG.url + ruta, {
      method: metodo,
      headers: { apikey: CONFIG.key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...encabezados },
      body: cuerpo != null ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    const e = new Error('Sin conexión a internet. Tus cambios quedan guardados en el dispositivo y se subirán después.');
    e.sinRed = true;
    throw e;
  }
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  if (!r.ok) { const e = new Error(mensajeError(r.status, json)); e.status = r.status; throw e; }
  return { json, r };
}

// ---------- Sesión ----------
// La sesión (tokens) se guarda en la base local del perfil, nunca la contraseña.
let sesion = null;

export function sesionActual() { return sesion; }
export function hayCuenta() { return !!sesion; }

function desdeRespuesta(j) {
  return {
    access: j.access_token, refresh: j.refresh_token,
    expira: Date.now() + (j.expires_in || 3600) * 1000,
    usuario: { id: j.user.id, email: j.user.email },
  };
}

export async function registrar(email, password) {
  const { json } = await llamar('/auth/v1/signup?redirect_to=' + encodeURIComponent(APP_URL), { metodo: 'POST', cuerpo: { email, password } });
  if (json && json.access_token) return { sesion: desdeRespuesta(json) };
  if (json && json.user && Array.isArray(json.user.identities) && json.user.identities.length === 0) {
    throw new Error('Ya existe una cuenta con ese correo. Usa «Entrar».');
  }
  return { confirmar: true };
}

export async function entrar(email, password) {
  const { json } = await llamar('/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email, password } });
  return desdeRespuesta(json);
}

export async function recuperar(email) {
  await llamar('/auth/v1/recover?redirect_to=' + encodeURIComponent(APP_URL), { metodo: 'POST', cuerpo: { email } });
}

export async function cambiarPassword(nueva, token) {
  await llamar('/auth/v1/user', { metodo: 'PUT', cuerpo: { password: nueva }, token: token || await tokenVigente() });
}

async function refrescar() {
  const { json } = await llamar('/auth/v1/token?grant_type=refresh_token', { metodo: 'POST', cuerpo: { refresh_token: sesion.refresh } });
  sesion = { ...desdeRespuesta(json) };
  await setSetting('nube-sesion', sesion);
}

async function tokenVigente() {
  if (!sesion) throw new Error('No has iniciado sesión.');
  if (Date.now() > sesion.expira - 60000) await refrescar();
  return sesion.access;
}

// Enlaces de los correos (confirmación o nueva contraseña) llegan con los datos en el #
export function leerEnlaceDeCorreo() {
  const h = location.hash.startsWith('#') ? new URLSearchParams(location.hash.slice(1)) : null;
  if (!h || (!h.get('access_token') && !h.get('error_description'))) return null;
  history.replaceState(null, '', location.pathname + location.search);
  if (h.get('error_description')) return { error: h.get('error_description').replace(/\+/g, ' ') };
  return { tipo: h.get('type'), access: h.get('access_token'), refresh: h.get('refresh_token'), expiraEn: +h.get('expires_in') || 3600 };
}

export async function usuarioDeToken(access) {
  const { json } = await llamar('/auth/v1/user', { token: access });
  return { id: json.id, email: json.email };
}

// ---------- Sincronización ----------
let enCurso = null;
let temporizador = null;
let intervalo = null;
const escuchas = new Set();
export const estadoSync = { ultima: null, error: null, pendientes: 0, sincronizando: false };
export function alCambiarEstado(fn) { escuchas.add(fn); return () => escuchas.delete(fn); }
function notificar() { for (const f of escuchas) try { f(estadoSync); } catch { /* ignorar */ } }

// Activa la cuenta para el perfil abierto: desde aquí, cada cambio local queda pendiente de subir
export async function activar(nuevaSesion, { subirTodo = false } = {}) {
  sesion = nuevaSesion || await getSetting('nube-sesion', null);
  if (!sesion) { activarSeguimiento(false); return false; }
  if (nuevaSesion) await setSetting('nube-sesion', sesion);
  activarSeguimiento(true, () => programar(2500));
  estadoSync.ultima = await getSetting('nube-ultima', null);
  if (subirTodo) await encolarTodo();
  window.addEventListener('online', () => programar(500));
  document.addEventListener('visibilitychange', () => { if (document.hidden) sincronizar().catch(() => {}); else programar(800); });
  clearInterval(intervalo);
  intervalo = setInterval(() => programar(0), 90 * 1000);
  programar(300);
  return true;
}

export async function desactivar() {
  clearInterval(intervalo); clearTimeout(temporizador);
  try { if (sesion) await llamar('/auth/v1/logout', { metodo: 'POST', token: sesion.access }); } catch { /* sin red: igual se cierra aquí */ }
  sesion = null;
  activarSeguimiento(false);
  await setSetting('nube-sesion', null);
}

// Al conectar una sesión local existente a la cuenta, todo lo guardado se sube
async function encolarTodo() {
  const d = await db.all('outbox');
  const ya = new Set(d.map((x) => x.k));
  const ahora = Date.now();
  for (const [store, kp] of Object.entries(SINCRONIZADOS)) {
    for (const v of await db.all(store)) {
      if (store === 'settings' && v.key !== 'ajustes') continue;
      const k = store + '\u0001' + v[kp];
      if (!ya.has(k)) await crudo.put('outbox', { k, store, key: v[kp], borrado: false, ts: ahora });
    }
  }
}

export function programar(ms) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => sincronizar().catch(() => {}), ms);
}

export function sincronizar() {
  if (!sesion) return Promise.resolve(false);
  if (enCurso) return enCurso;
  enCurso = (async () => {
    estadoSync.sincronizando = true; notificar();
    try {
      await subir();
      const cambios = await bajar();
      estadoSync.ultima = Date.now(); estadoSync.error = null;
      await setSetting('nube-ultima', estadoSync.ultima);
      if (cambios.length) window.dispatchEvent(new CustomEvent('vozi-nube-cambios', { detail: cambios }));
      return true;
    } catch (e) {
      estadoSync.error = e.message;
      if (e.status === 401) { /* sesión vencida: se mostrará en Ajustes */ }
      throw e;
    } finally {
      estadoSync.sincronizando = false;
      estadoSync.pendientes = (await db.all('outbox').catch(() => [])).length;
      notificar();
      enCurso = null;
    }
  })();
  return enCurso;
}

function limpiarAjustes(v) {
  const value = { ...(v.value || {}) };
  for (const k of LOCALES) delete value[k];
  return { key: v.key, value };
}

async function subir() {
  const pendientes = await db.all('outbox');
  estadoSync.pendientes = pendientes.length; notificar();
  if (!pendientes.length) return;
  const token = await tokenVigente();
  // Lotes: los documentos (texto completo) van de a uno; lo demás en grupos
  const lotes = [];
  let lote = [], tam = 0;
  for (const p of pendientes) {
    let data = null;
    if (!p.borrado) {
      data = await db.get(p.store, p.key);
      if (!data) continue;
      if (p.store === 'settings') data = limpiarAjustes(data);
    }
    const fila = { user_id: sesion.usuario.id, store: p.store, key: String(p.key), data, deleted: !!p.borrado };
    const peso = p.store === 'docs' ? 1e6 : 2000;
    if (lote.length && (tam + peso > 1e6 || lote.length >= 100)) { lotes.push(lote); lote = []; tam = 0; }
    lote.push({ fila, p }); tam += peso;
  }
  if (lote.length) lotes.push(lote);
  for (const l of lotes) {
    await llamar(`/rest/v1/${TABLA}?on_conflict=user_id,store,key`, {
      metodo: 'POST', token, cuerpo: l.map((x) => x.fila),
      encabezados: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    // Quitar de pendientes solo si no cambió de nuevo mientras se subía
    for (const { p } of l) {
      const actual = await db.get('outbox', p.k);
      if (actual && actual.ts === p.ts) await crudo.del('outbox', p.k);
    }
  }
}

async function bajar() {
  const token = await tokenVigente();
  const cursor = await getSetting('nube-cursor', '1970-01-01T00:00:00.000Z');
  // Margen de 10 s para no perder escrituras simultáneas (aplicar dos veces es inofensivo)
  // (Safari no siempre interpreta más de 3 decimales de segundo: se recortan)
  const desde = new Date(new Date(cursor.replace(/(\.\d{3})\d+/, '$1')).getTime() - 10000).toISOString();
  const pendientes = new Set((await db.all('outbox')).map((x) => x.k));
  const cambios = [];
  let maximo = cursor, offset = 0;
  while (true) {
    const q = `/rest/v1/${TABLA}?select=store,key,data,deleted,updated_at&updated_at=gte.${encodeURIComponent(desde)}&order=updated_at.asc&limit=200&offset=${offset}`;
    const { json } = await llamar(q, { token });
    if (!json || !json.length) break;
    for (const f of json) {
      if (f.updated_at > maximo) maximo = f.updated_at;
      if (!(f.store in SINCRONIZADOS)) continue;
      const k = f.store + '\u0001' + f.key;
      if (pendientes.has(k)) continue; // hay un cambio local más reciente que se subirá
      if (f.deleted) {
        if (await db.get(f.store, f.key)) { await crudo.del(f.store, f.key); cambios.push({ store: f.store, key: f.key, borrado: true }); }
        continue;
      }
      let data = f.data;
      if (f.store === 'settings') {
        const local = await db.get('settings', 'ajustes');
        data = { key: 'ajustes', value: { ...(data.value || {}), ...Object.fromEntries(LOCALES.filter((x) => local && local.value && x in local.value).map((x) => [x, local.value[x]])) } };
      }
      const local = await db.get(f.store, f.key);
      if (local && JSON.stringify(local) === JSON.stringify(data)) continue;
      await crudo.put(f.store, data);
      cambios.push({ store: f.store, key: f.key });
    }
    if (json.length < 200) break;
    offset += json.length;
  }
  if (maximo !== cursor) await setSetting('nube-cursor', maximo);
  return cambios;
}
