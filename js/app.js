// VOZI — Arranque, navegación, tema y reproductor.
import { ctx, cargarAjustes, guardarAjustes } from './estado.js';
import { abrir, db, pedirPersistencia, usarBase } from './db.js';
import * as P from './perfiles.js';
import { MotorVoz } from './tts/engine.js';
import { Reproductor } from './player.js';
import * as L from './lectura.js';
import { aviso, dialogo, h, formatoTiempo } from './ui.js';
import { vozPorId } from './voices.js';
import { vistaBiblioteca } from './vistas/biblioteca.js';
import { vistaImportar } from './vistas/importar.js';
import { vistaLeer, resaltarPosicion, actualizarAccionesLeer } from './vistas/leer.js';
import { vistaEstudiar, chipTemporizador } from './vistas/estudiar.js';
import { vistaAjustes } from './vistas/ajustes.js';

export const VERSION = '1.0.0';

const VISTAS = { biblioteca: vistaBiblioteca, importar: vistaImportar, leer: vistaLeer, estudiar: vistaEstudiar, ajustes: vistaAjustes };

export async function ir(vista, opciones = {}) {
  if (vista === 'leer' && !ctx.doc) {
    const ultimo = await ultimoDocumento();
    if (ultimo) { await abrirDocumento(ultimo.id, { navegar: false }); }
    else { aviso('Primero abre o importa un documento.'); vista = 'biblioteca'; }
  }
  ctx.vista = vista;
  document.body.dataset.vista = vista;
  for (const b of document.querySelectorAll('#pestanas button')) {
    const activo = b.dataset.vista === vista;
    b.classList.toggle('activo', activo);
    if (activo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  const main = document.getElementById('principal');
  main.innerHTML = '';
  document.getElementById('cabeceraAcciones').innerHTML = '';
  document.getElementById('cabeceraTitulo').textContent = '';
  try {
    await VISTAS[vista](main, opciones);
  } catch (e) {
    console.error(e);
    main.append(h('div', { class: 'vacio' }, h('p', {}, 'Ocurrió un error al mostrar esta sección: ' + e.message)));
  }
  actualizarReproductor();
  if (opciones.enfocar !== false) main.focus({ preventScroll: true });
  if (vista !== 'leer') window.scrollTo(0, 0);
}

async function ultimoDocumento() {
  const docs = await db.all('docs');
  docs.sort((a, b) => (b.ultimaLectura || b.updatedAt || 0) - (a.ultimaLectura || a.updatedAt || 0));
  return docs[0] || null;
}

export async function abrirDocumento(id, { navegar = true, pidx = null } = {}) {
  const doc = await db.get('docs', id);
  if (!doc) { aviso('No se encontró el documento.'); return; }
  if (ctx.doc && ctx.doc.id !== doc.id) L.soltarDocumento();
  const cambio = !ctx.doc || ctx.doc.id !== doc.id;
  ctx.doc = doc;
  ctx.rep.setTitulo(doc.title);
  let pos = null;
  if (cambio) pos = await L.restaurarPosicion(doc);
  if (navegar) await ir('leer', { pidx: pidx != null ? pidx : (pos ? pos.pidx : 0), s: pos ? pos.s : 0 });
}

export function aplicarTema() {
  const t = ctx.ajustes.tema;
  const raiz = document.documentElement;
  if (t === 'sistema') raiz.removeAttribute('data-theme'); else raiz.dataset.theme = t === 'oscuro' ? 'dark' : 'light';
  raiz.style.setProperty('--letra-lectura', ctx.ajustes.letra + 'px');
  raiz.style.setProperty('--interlineado', ctx.ajustes.interlineado);
  const oscuro = t === 'oscuro' || (t === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', oscuro ? '#121714' : '#F7F3EA'));
}

// ---------- Reproductor (barra inferior) ----------
const $ = (id) => document.getElementById(id);

export function actualizarReproductor() {
  const rep = ctx.rep;
  const dock = $('reproductor');
  const hayDoc = !!ctx.doc;
  dock.hidden = !hayDoc || ctx.vista === 'ajustes' || ctx.vista === 'importar';
  document.body.classList.toggle('con-reproductor', !dock.hidden);
  const prep = L.estadoLectura.preparando;
  const playBtn = $('repPlay');
  const repro = rep.reproduciendo;
  playBtn.classList.toggle('pausa', repro);
  playBtn.setAttribute('aria-label', repro ? 'Pausar' : (rep.tramo ? 'Reanudar' : 'Escuchar'));
  $('repVel').textContent = formatoVel(rep.velocidad);
  let estado = '';
  if (prep) {
    estado = h('span', { class: 'rep-prep' },
      h('span', { class: 'rueda', 'aria-hidden': 'true' }),
      h('span', {}, L.textoEstadoPreparacion(prep)),
      h('button', { class: 'enlace', onclick: () => L.cancelarPreparacion() }, 'Cancelar'));
    $('repRelleno').style.width = Math.round((prep.fraccion || 0) * 100) + '%';
    $('repBarra').classList.add('preparando');
  } else {
    $('repBarra').classList.remove('preparando');
    const voz = vozPorId(ctx.ajustes.vozId);
    if (L.estadoLectura.esperandoSiguiente) estado = 'Terminando de preparar la continuación…';
    else if (rep.tramo) {
      const sig = L.estadoLectura.siguiente;
      const extra = sig && !sig.rec && sig.fraccion != null ? ` · siguiente tramo ${Math.round((sig.fraccion || 0) * 100)} %` : (sig && sig.rec ? ' · siguiente tramo listo' : '');
      estado = `${voz.nombre} · ${formatoTiempo(rep.tiempo)} / ${formatoTiempo(rep.duracion)}${extra}`;
    } else estado = hayDoc ? `${voz.nombre} · toca ▶ para escuchar desde el punto guardado` : '';
  }
  const el = $('repEstado');
  el.innerHTML = '';
  el.append(estado);
}

function formatoVel(v) { return (Math.round(v * 100) / 100).toString().replace('.', ',') + '×'; }

function actualizarProgresoReproductor() {
  const rep = ctx.rep;
  if (L.estadoLectura.preparando) return;
  const pct = rep.duracion ? (100 * rep.tiempo / rep.duracion) : 0;
  $('repRelleno').style.width = pct + '%';
  $('repBarra').setAttribute('aria-valuenow', Math.round(pct));
  $('repBarra').setAttribute('aria-valuetext', `${formatoTiempo(rep.tiempo)} de ${formatoTiempo(rep.duracion)}`);
}

let ultimaActualizacionEstado = 0;
function configurarReproductor() {
  const rep = ctx.rep;
  $('repPlay').addEventListener('click', async () => {
    rep.desbloquear();
    if (L.estadoLectura.preparando) return;
    if (rep.reproduciendo) { rep.pausar(); L.guardarPosicion(); return; }
    if (rep.tramo && rep.tramo.docId === (ctx.doc && ctx.doc.id)) { rep.reproducir(); return; }
    const pidx = ctx.vistas.leer && ctx.vistas.leer.parrafoVisible ? ctx.vistas.leer.parrafoVisible() : null;
    const pr = ctx.doc ? await db.get('progress', ctx.doc.id) : null;
    let inicio = pr ? Math.max(0, ctx.doc.paragraphs.findIndex((p) => p.id === pr.pid)) : 0;
    if (pidx != null && ctx.vista === 'leer' && !pr) inicio = pidx;
    L.escucharDesde(inicio);
  });
  $('repAtras').addEventListener('click', () => rep.oracion(-1));
  $('repAdelante').addEventListener('click', () => rep.oracion(1));
  $('repVel').addEventListener('click', elegirVelocidad);
  $('repMas').addEventListener('click', menuReproductor);
  const barra = $('repBarra');
  const buscar = (x) => {
    const r = barra.getBoundingClientRect();
    rep.irA(Math.max(0, Math.min(1, (x - r.left) / r.width)) * rep.duracion);
  };
  barra.addEventListener('click', (e) => { if (rep.tramo && !L.estadoLectura.preparando) buscar(e.clientX); });
  barra.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { rep.saltar(-10); e.preventDefault(); }
    if (e.key === 'ArrowRight') { rep.saltar(10); e.preventDefault(); }
  });

  rep.addEventListener('estado', () => { actualizarReproductor(); if (!rep.reproduciendo) L.guardarPosicion(); });
  rep.addEventListener('tiempo', () => {
    actualizarProgresoReproductor();
    const ahora = performance.now();
    if (ahora - ultimaActualizacionEstado > 900) { ultimaActualizacionEstado = ahora; actualizarReproductor(); }
  });
  rep.addEventListener('posicion', (e) => {
    L.registrarPosicion(e.detail);
    resaltarPosicion(e.detail);
  });
  rep.addEventListener('fin', () => L.alTerminarTramo());
  rep.addEventListener('error', (e) => aviso(e.detail.mensaje, { tipo: e.detail.bloqueo ? 'info' : 'error', ms: 6000 }));

  L.eventos.addEventListener('preparacion', () => actualizarReproductor());
  L.eventos.addEventListener('siguiente', () => actualizarReproductor());
  L.eventos.addEventListener('esperando', () => actualizarReproductor());
  L.eventos.addEventListener('tramo', () => { actualizarReproductor(); actualizarAccionesLeer(); });
  L.eventos.addEventListener('faltaVoz', (e) => L.avisoFaltaVoz(e.detail || [], (sec) => ir('ajustes', { seccion: sec })));

  // Atajos de teclado (iPad con teclado)
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'Space' && ctx.doc) { e.preventDefault(); $('repPlay').click(); }
    if (e.key === 'ArrowRight' && e.altKey) rep.oracion(1);
    if (e.key === 'ArrowLeft' && e.altKey) rep.oracion(-1);
  });
  // Guardar al salir o pasar a segundo plano
  document.addEventListener('visibilitychange', () => { if (document.hidden) L.guardarPosicion(); });
  window.addEventListener('pagehide', () => L.guardarPosicion());
}

const VELOCIDADES = [0.75, 0.85, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];
async function elegirVelocidad() {
  const actual = ctx.rep.velocidad;
  const v = await dialogo({
    titulo: 'Velocidad de lectura',
    contenido: h('div', {},
      h('p', { class: 'nota-suave' }, 'Cambia el ritmo sin alterar el tono de la voz.'),
      h('div', { class: 'rejilla-opciones' }, VELOCIDADES.map((x) => h('button', {
        type: 'button', class: 'opcion' + (Math.abs(x - actual) < 0.01 ? ' activa' : ''),
        onclick: () => { document.getElementById('dialogo').close(); fijarVelocidad(x); },
      }, formatoVel(x))))),
    botones: [{ texto: 'Cerrar', valor: null }],
  });
  if (v) fijarVelocidad(v);
}
function fijarVelocidad(v) {
  ctx.rep.setVelocidad(v);
  guardarAjustes({ velocidad: v });
  actualizarReproductor();
}

async function menuReproductor() {
  const rep = ctx.rep;
  const accion = (fn) => () => { document.getElementById('dialogo').close(); fn(); };
  await dialogo({
    titulo: 'Reproducción',
    contenido: h('div', { class: 'lista-acciones' },
      h('button', { type: 'button', class: 'accion', onclick: accion(() => rep.saltar(-15)) }, '↺ Retroceder 15 segundos'),
      h('button', { type: 'button', class: 'accion', onclick: accion(() => rep.saltar(15)) }, '↻ Avanzar 15 segundos'),
      h('button', { type: 'button', class: 'accion', onclick: accion(() => rep.parrafo(-1)) }, '⇤ Párrafo anterior'),
      h('button', { type: 'button', class: 'accion', onclick: accion(() => rep.parrafo(1)) }, '⇥ Párrafo siguiente'),
      h('button', { type: 'button', class: 'accion', onclick: accion(() => ir('ajustes', { seccion: 'voz' })) }, '🎙 Cambiar voz o duración del tramo'),
      L.estadoLectura.preparando ? h('button', { type: 'button', class: 'accion peligro', onclick: accion(() => L.cancelarPreparacion()) }, '✕ Cancelar preparación') : null,
    ),
    botones: [{ texto: 'Cerrar', valor: null }],
  });
}

// ---------- Service worker y actualizaciones ----------
async function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    const avisar = (w) => {
      const banda = h('div', { class: 'banda-actualizacion', role: 'status' },
        h('span', {}, 'Hay una nueva versión de VOZI. Tus lecturas y notas se conservan.'),
        h('button', { class: 'boton primario pequeno', onclick: () => { L.guardarPosicion(); w.postMessage({ tipo: 'ACTIVAR' }); } }, 'Actualizar'));
      document.body.append(banda);
    };
    if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) avisar(w); });
    });
    // Solo recargar cuando una versión nueva reemplaza a otra (no en la primera instalación)
    const habiaControlador = !!navigator.serviceWorker.controller;
    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!habiaControlador || recargando) return;
      recargando = true; L.guardarPosicion(); location.reload();
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  } catch (e) { console.warn('Service worker no disponible', e); }
}

// ---------- Inicio ----------
// ---------- Sesiones de usuario ----------
async function elegirPerfil() {
  const lista = await P.listarPerfiles();
  const activo = await P.perfilActivoId();
  const actual = lista.find((p) => p.id === activo);
  const forzar = sessionStorage.getItem('vozi-elegir') === '1';
  sessionStorage.removeItem('vozi-elegir');
  if (actual && !forzar && !actual.pinHash && !(lista.length > 1 && await P.preguntarAlIniciar())) return actual;
  if (lista.length === 1 && !lista[0].pinHash && !forzar) { await P.fijarPerfilActivo(lista[0].id); return lista[0]; }
  // Pantalla «¿Quién va a estudiar?»
  document.body.classList.add('eligiendo-perfil');
  const main = document.getElementById('principal');
  return new Promise((resolve) => {
    const pintar = async () => {
      const perfiles = await P.listarPerfiles();
      main.innerHTML = '';
      main.append(h('section', { class: 'vista selector-perfiles' },
        h('h1', {}, '¿Quién va a estudiar?'),
        h('p', { class: 'nota-suave' }, 'Cada persona tiene su propia biblioteca, notas, progreso y ajustes en este dispositivo.'),
        h('div', { class: 'rejilla-perfiles' },
          perfiles.map((p) => h('button', { class: 'perfil', onclick: async () => {
            if (p.pinHash) {
              const pin = await pedirPin(`PIN de ${p.nombre}`);
              if (pin == null) return;
              if (!(await P.verificarPin(p, pin))) { aviso('PIN incorrecto.', { tipo: 'error' }); return; }
            }
            await P.fijarPerfilActivo(p.id);
            document.body.classList.remove('eligiendo-perfil');
            resolve(p);
          } }, h('span', { class: 'avatar grande', style: { background: p.color } }, P.iniciales(p.nombre)), h('span', {}, p.nombre), p.pinHash ? h('span', { class: 'nota-suave' }, '🔒 con PIN') : null)),
          h('button', { class: 'perfil nuevo', onclick: async () => { if (await dialogoNuevoPerfil()) pintar(); } },
            h('span', { class: 'avatar grande vacio-av' }, '+'), h('span', {}, 'Añadir persona')))));
    };
    pintar();
  });
}

export async function pedirPin(titulo) {
  const campo = h('input', { class: 'campo pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 8, placeholder: '••••' });
  return dialogo({ titulo, contenido: campo, botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Entrar', valor: () => campo.value, clase: 'primario' }] });
}

export async function dialogoNuevoPerfil() {
  const nombre = h('input', { class: 'campo', placeholder: 'Nombre', maxlength: 40 });
  const pin = h('input', { class: 'campo pin', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', maxlength: 8, placeholder: 'PIN opcional (4 a 8 números)' });
  const r = await dialogo({
    titulo: 'Nueva persona',
    contenido: h('div', {}, h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Nombre'), nombre), h('label', { class: 'etiqueta-campo' }, h('span', {}, 'PIN (opcional)'), pin),
      h('p', { class: 'nota-suave' }, 'El PIN evita que otra persona abra tu sesión por error en este dispositivo. No cifra los datos.')),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Crear', valor: () => ({ n: nombre.value.trim(), p: pin.value.trim() }), clase: 'primario' }],
  });
  if (!r || !r.n) return null;
  if (r.p && !/^\d{4,8}$/.test(r.p)) { aviso('El PIN debe tener entre 4 y 8 números.', { tipo: 'error' }); return null; }
  const p = await P.crearPerfil(r.n, r.p || null);
  aviso(`Se creó la sesión de ${p.nombre}.`);
  return p;
}

export function cambiarDePerfil() {
  L.guardarPosicion();
  sessionStorage.setItem('vozi-elegir', '1');
  location.reload();
}

function pintarAvatar(perfil, total) {
  const b = document.getElementById('perfilBtn');
  b.hidden = false;
  b.textContent = P.iniciales(perfil.nombre);
  b.style.background = perfil.color;
  b.setAttribute('aria-label', `Sesión de ${perfil.nombre}. Toca para cambiar de persona`);
  b.title = perfil.nombre;
  b.onclick = async () => {
    const v = await dialogo({
      titulo: `Sesión de ${perfil.nombre}`,
      contenido: h('p', { class: 'nota-suave' }, total > 1 ? 'Cambia de persona para ver su biblioteca y sus notas.' : 'Puedes crear sesiones para otras personas que usen este dispositivo.'),
      botones: [{ texto: 'Gestionar sesiones', valor: 'gestionar' }, { texto: 'Cambiar de persona', valor: 'cambiar', clase: 'primario' }, { texto: 'Cerrar', valor: null }],
    });
    if (v === 'cambiar') cambiarDePerfil();
    if (v === 'gestionar') ir('ajustes', { seccion: 'sesiones' });
  };
}

async function iniciar() {
  let perfil;
  try {
    perfil = await elegirPerfil();
    usarBase(P.nombreBase(perfil.id));
    ctx.perfil = perfil;
    await abrir();
  } catch (e) {
    document.getElementById('principal').append(h('div', { class: 'vacio' }, h('p', {}, 'No se pudo abrir el almacenamiento local: ' + e.message + ' Si usas navegación privada, ábrela en una ventana normal.')));
    return;
  }
  await cargarAjustes();
  aplicarTema();
  pintarAvatar(perfil, (await P.listarPerfiles()).length);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema);
  ctx.motor = new MotorVoz();
  ctx.rep = new Reproductor();
  ctx.rep.setVelocidad(ctx.ajustes.velocidad || 1);
  configurarReproductor();
  for (const b of document.querySelectorAll('#pestanas button')) b.addEventListener('click', () => ir(b.dataset.vista));
  chipTemporizador();
  registrarSW();
  pedirPersistencia();
  const docs = await db.all('docs');
  const destino = new URLSearchParams(location.search).get('v');
  if (destino && VISTAS[destino]) await ir(destino);
  else if (docs.length) {
    const ult = await ultimoDocumento();
    await abrirDocumento(ult.id, { navegar: false });
    await ir('biblioteca');
  } else await ir('biblioteca');
  window.__vozi = { ctx, db, L }; // acceso para diagnóstico y pruebas automáticas
  window.__voziListo = true;
}

iniciar();
