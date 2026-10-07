// VOZI — Ajustes: voces, lectura, apariencia, recursos sin conexión, almacenamiento,
// pronunciación, copia de seguridad y créditos.
import { ctx, guardarAjustes, PASOS_CALIDAD } from '../estado.js';
import { db, estimarAlmacenamiento, pedirPersistencia } from '../db.js';
import { h, aviso, confirmar, elegirArchivo, compartirODescargar, dialogo } from '../ui.js';
import { ir, aplicarTema, actualizarReproductor, VERSION, dialogoNuevoPerfil, cambiarDePerfil, pedirPin, conectarCuenta, cerrarSesionCuenta } from '../app.js';
import * as N from '../nube.js';
import { textoEstadoSync, dialogoNuevaPassword } from './cuenta.js';
import * as P from '../perfiles.js';
import { VOCES_ES, VOCES_EN, vozPorId } from '../voices.js';
import { cargarManifiesto, estadoPaquete, descargarPaquete, borrarPaquete, limpiarObsoletos, mb } from '../resources.js';
import { normalizar } from '../tts/normalize-es.js';
import { exportarCopia, leerCopia, restaurarCopia } from '../backup.js';

const descargas = new Map(); // packId → {abort, bytesHechos, bytesTotal, error}
let muestra = null;

export async function vistaAjustes(main, opciones = {}) {
  document.getElementById('cabeceraTitulo').textContent = 'Ajustes';
  const cont = h('section', { class: 'vista vista-ajustes' });
  main.append(cont);
  let man = null;
  try { man = await cargarManifiesto(); } catch (e) { cont.append(h('div', { class: 'aviso-ocr falta' }, e.message)); }
  const secciones = [
    ['voz', 'Voz', () => seccionVoz(man)],
    ['sesiones', 'Cuenta y sesiones', () => seccionSesiones()],
    ['lectura', 'Lectura', () => seccionLectura()],
    ['recursos', 'Recursos sin conexión', () => seccionRecursos(man)],
    ['ia', 'Inteligencia artificial (en el equipo)', async () => (await import('./ia.js')).seccionIA()],
    ['apariencia', 'Apariencia', () => seccionApariencia()],
    ['pronunciacion', 'Pronunciación personalizada', () => seccionPronunciacion()],
    ['almacenamiento', 'Almacenamiento', () => seccionAlmacenamiento()],
    ['copia', 'Copia de seguridad', () => seccionCopia()],
    ['acerca', 'Acerca de, créditos y licencias', () => seccionAcerca()],
  ];
  for (const [id, titulo, fn] of secciones) {
    const cuerpo = h('div', { class: 'seccion-cuerpo' });
    const sec = h('details', { class: 'seccion', id: 'sec-' + id, open: opciones.seccion ? opciones.seccion === id : id === 'voz' }, h('summary', {}, h('h2', {}, titulo)), cuerpo);
    cont.append(sec);
    const cargar = async () => { if (!cuerpo.dataset.cargado) { cuerpo.dataset.cargado = '1'; cuerpo.append(await fn()); } };
    if (sec.open) await cargar();
    sec.addEventListener('toggle', () => { if (sec.open) cargar(); });
  }
  if (opciones.seccion) setTimeout(() => document.getElementById('sec-' + opciones.seccion)?.scrollIntoView({ block: 'start' }), 50);
}

// ---------- Voz ----------
async function seccionVoz(man) {
  const cont = h('div', {});
  cont.append(await bloqueMotorVoz());
  cont.append(h('h3', {}, 'Voces de VOZI'));
  cont.append(h('p', { class: 'nota-suave' }, 'Escucha las muestras (ya incluidas, no requieren descargar nada) y elige una voz. Las voces naturales comparten una sola descarga.'));
  cont.append(h('h3', {}, 'Voz en español'));
  cont.append(await listaVoces(man, VOCES_ES, 'vozId', 'Voz en español'));
  cont.append(h('h3', {}, 'Voz en inglés'),
    h('p', { class: 'nota-suave' }, 'VOZI reconoce automáticamente si cada párrafo está en español o en inglés y usa la voz correspondiente. Las voces en inglés usan el mismo modelo natural: no requieren otra descarga. Puedes fijar el idioma de un documento en Biblioteca → ⋯ → Idioma.'));
  cont.append(await listaVoces(man, VOCES_EN, 'vozIdEn', 'Voz en inglés'));
  cont.append(h('h3', {}, 'Calidad de las voces naturales'),
    h('p', { class: 'nota-suave' }, '«Rápida» prepara el audio casi el doble de rápido que «Natural» y en las pruebas se entiende igual de bien; «Natural» suena un poco más pulida. El audio ya preparado se conserva; la nueva calidad se aplica a lo que falta.'),
    opcionesCalidad());
  cont.append(h('p', { class: 'nota-suave' }, 'Las muestras se generaron con los mismos modelos que usa la app. La calidad final depende del texto. Ninguna voz es humana.'));
  return cont;
}

// Elegir entre las voces de VOZI (audio preparado) y las del propio equipo (Siri)
async function bloqueMotorVoz() {
  const { hayVozSistema, vocesSistema, vocesDeIdioma, calidadVoz, etiquetaCalidad, vozElegida, probarVoz } = await import('../voz-sistema.js');
  const cont = h('div', { class: 'bloque-motor' });
  cont.append(h('h3', {}, 'Qué voces usar'));
  if (!hayVozSistema()) { cont.append(h('p', { class: 'nota-suave' }, 'Este navegador no ofrece las voces del sistema; se usan las de VOZI.')); return cont; }
  const g = h('div', { class: 'rejilla-opciones', role: 'radiogroup', 'aria-label': 'Qué voces usar' });
  const actual = ctx.ajustes.motorVoz === 'sistema' ? 'sistema' : 'vozi';
  const lista = h('div', {});
  for (const [m, t] of [['vozi', 'Voces de VOZI'], ['sistema', 'Voces del iPhone/iPad']]) {
    g.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(actual === m), class: 'opcion' + (actual === m ? ' activa' : ''), onclick: async (e) => {
      const boton = e.currentTarget;
      await guardarAjustes({ motorVoz: m });
      ctx.rep.descargar(); // al cambiar de motor se empieza de nuevo desde el punto guardado
      g.querySelectorAll('.opcion').forEach((x) => { x.classList.remove('activa'); x.setAttribute('aria-checked', 'false'); });
      boton.classList.add('activa'); boton.setAttribute('aria-checked', 'true');
      lista.hidden = m !== 'sistema';
    } }, t));
  }
  cont.append(g, h('p', { class: 'nota-suave' }, '«Voces de VOZI»: se preparan antes, se guardan y suenan sin conexión, también con la pantalla bloqueada. «Voces del iPhone/iPad»: las de Siri; hablan al instante sin preparar nada, pero no se guardan y pueden detenerse al bloquear la pantalla.'));
  const voces = await vocesSistema();
  lista.hidden = actual !== 'sistema';
  const bloque = (lang, clave, titulo, prueba) => {
    const vs = vocesDeIdioma(voces, lang);
    const sel = vozElegida(voces, lang);
    const caja = h('div', { class: 'lista-voces', role: 'radiogroup', 'aria-label': titulo });
    if (!vs.length) caja.append(h('p', { class: 'nota-suave' }, 'No hay voces de este idioma en el equipo.'));
    for (const v of vs.slice(0, 14)) {
      const activa = sel && sel.voiceURI === v.voiceURI;
      caja.append(h('label', { class: 'voz' + (activa ? ' activa' : '') },
        h('input', { type: 'radio', name: 'vs-' + lang, checked: activa, onchange: async () => {
          await guardarAjustes({ [clave]: v.voiceURI });
          caja.querySelectorAll('.voz').forEach((x) => x.classList.remove('activa'));
          caja.querySelectorAll('input').forEach((x, k) => { if (x.checked) caja.querySelectorAll('.voz')[k].classList.add('activa'); });
          ctx.rep.sis && ctx.rep.descargar();
        } }),
        h('span', { class: 'voz-info' }, h('span', { class: 'voz-nombre' }, v.name.replace(/\s*\(.*\)$/, ''), calidadVoz(v) >= 2 ? h('span', { class: 'etiqueta' }, etiquetaCalidad(calidadVoz(v))) : null),
          h('span', { class: 'voz-desc' }, `${v.lang} · ${etiquetaCalidad(calidadVoz(v))}`)),
        h('button', { type: 'button', class: 'boton pequeno', onclick: (e) => { e.preventDefault(); probarVoz(v, prueba); } }, '▶ Probar')));
    }
    return [h('h3', {}, titulo), caja];
  };
  lista.append(...bloque('es', 'vozSistemaEs', 'Voz del equipo en español', 'Hola, soy tu voz de estudio. En dos mil veinticinco, las ventas aumentaron treinta y dos por ciento.'),
    ...bloque('en', 'vozSistemaEn', 'Voz del equipo en inglés', 'Hello, this is how I will read your English texts.'),
    h('p', { class: 'nota-suave' }, '¿Quieres voces más naturales? En el iPhone o iPad: Ajustes → Accesibilidad → Contenido leído → Voces → Español, y descarga una que diga «Mejorada» o «Premium» (por ejemplo Mónica o Paulina). Después vuelve aquí y elígela.'));
  cont.append(lista);
  return cont;
}

async function listaVoces(man, voces, clave, etiqueta) {
  const lista = h('div', { class: 'lista-voces', role: 'radiogroup', 'aria-label': etiqueta });
  for (const v of voces) {
    const pack = man && man.packs.find((p) => p.id === v.pack);
    const st = pack ? await estadoPaquete(pack) : { instalado: false };
    const sel = (ctx.ajustes[clave] || (clave === 'vozIdEn' ? 'en-emma' : '')) === v.id;
    const radio = h('input', { type: 'radio', name: clave, value: v.id, checked: sel, 'aria-label': v.nombre });
    radio.addEventListener('change', async () => {
      await guardarAjustes({ [clave]: v.id });
      ctx.rep.descargar();
      lista.querySelectorAll('.voz').forEach((x) => x.classList.toggle('activa', x.dataset.id === v.id));
      actualizarReproductor();
      aviso(`Voz elegida: ${v.nombre}.` + (st.instalado ? '' : ' Descárgala en «Recursos sin conexión».'));
    });
    lista.append(h('label', { class: 'voz' + (sel ? ' activa' : ''), 'data-id': v.id },
      radio,
      h('span', { class: 'voz-info' },
        h('span', { class: 'voz-nombre' }, v.nombre, v.recomendada ? h('span', { class: 'etiqueta' }, 'recomendada') : null),
        h('span', { class: 'voz-desc' }, v.descripcion),
        h('span', { class: 'voz-estado ' + (st.instalado ? 'ok' : '') }, st.instalado ? '✓ Descargada' : `Sin descargar · ${pack ? mb(pack.size) : ''}`)),
      h('button', { type: 'button', class: 'boton pequeno', 'aria-label': `Escuchar muestra de ${v.nombre}`, onclick: (e) => { e.preventDefault(); tocarMuestra(v, e.currentTarget); } }, '▶ Muestra')));
  }
  return lista;
}

function tocarMuestra(v, btn) {
  if (muestra) { muestra.pause(); muestra.btn.textContent = '▶ Muestra'; if (muestra.vid === v.id) { muestra = null; return; } }
  const a = new Audio(v.muestra);
  a.btn = btn; a.vid = v.id;
  muestra = a;
  btn.textContent = '■ Detener';
  a.addEventListener('ended', () => { btn.textContent = '▶ Muestra'; muestra = null; });
  a.play().catch(() => { btn.textContent = '▶ Muestra'; aviso('No se pudo reproducir la muestra.'); });
}

// ---------- Sesiones de usuario ----------
async function seccionSesiones() {
  const cont = h('div', {});
  const pintar = async () => {
    cont.innerHTML = '';
    const perfiles = await P.listarPerfiles();
    const activo = ctx.perfil && ctx.perfil.id;
    // Cuenta en la nube de la sesión abierta
    const cajaCuenta = h('div', { class: 'caja-destacada' });
    if (ctx.perfil.cuenta && N.hayCuenta()) {
      const estado = h('p', { class: 'nota-suave', 'aria-live': 'polite' }, textoEstadoSync(N.estadoSync));
      const quitar = N.alCambiarEstado((s) => { if (!document.body.contains(estado)) quitar(); else estado.textContent = textoEstadoSync(s); });
      cajaCuenta.append(
        h('p', {}, h('strong', {}, '☁ Cuenta: '), ctx.perfil.cuenta.email), estado,
        h('p', { class: 'nota-suave' }, 'Se sincronizan tus documentos, notas, citas, tarjetas, marcadores, progreso y ajustes. El audio y las voces se quedan en cada dispositivo.'),
        h('div', { class: 'fila-botones' },
          h('button', { class: 'boton pequeno primario', onclick: async () => { try { await N.sincronizar(); aviso('Sincronizado.'); } catch (e) { aviso(e.message, { tipo: 'error', ms: 7000 }); } } }, 'Sincronizar ahora'),
          h('button', { class: 'boton pequeno', onclick: () => dialogoNuevaPassword() }, 'Cambiar contraseña'),
          h('button', { class: 'boton pequeno peligro', onclick: () => cerrarSesionCuenta() }, 'Cerrar sesión')));
    } else {
      cajaCuenta.append(
        h('p', {}, h('strong', {}, 'Esta sesión está solo en este dispositivo.')),
        h('p', { class: 'nota-suave' }, 'Conéctala a una cuenta para guardar tu biblioteca y tus notas en la nube y usarlas en el iPhone, el iPad o el computador. Lo que ya tienes aquí se sube a tu cuenta.'),
        h('div', { class: 'fila-botones' },
          h('button', { class: 'boton pequeno primario', onclick: async () => { if (await conectarCuenta()) pintar(); } }, 'Entrar o crear cuenta')));
    }
    cont.append(cajaCuenta);
    cont.append(h('h3', {}, 'Sesiones en este dispositivo'), h('p', { class: 'nota-suave' }, 'Cada persona tiene su propia biblioteca, notas, citas, tarjetas, marcadores, progreso, audios y ajustes. Las voces descargadas se comparten, así que no ocupan espacio extra.'));
    const ul = h('ul', { class: 'lista-recursos' });
    for (const p of perfiles) {
      const esActivo = p.id === activo;
      ul.append(h('li', { class: 'recurso' },
        h('span', { class: 'avatar', style: { background: p.color } }, P.iniciales(p.nombre)),
        h('div', { class: 'recurso-info' }, h('strong', {}, p.nombre + (esActivo ? ' (sesión actual)' : '')), h('span', { class: 'nota-suave' }, [p.cuenta ? '☁ ' + p.cuenta.email : 'Solo en este dispositivo', p.pinHash ? '🔒 Con PIN' : null].filter(Boolean).join(' · '))),
        h('div', { class: 'recurso-acciones' },
          h('button', { class: 'boton pequeno', onclick: async () => {
            const v = await dialogo({ titulo: p.nombre, contenido: h('p', { class: 'nota-suave' }, 'Elige una acción.'), botones: [
              { texto: 'Renombrar', valor: 'nombre' }, { texto: p.pinHash ? 'Cambiar o quitar PIN' : 'Poner PIN', valor: 'pin' },
              ...(esActivo ? [] : [{ texto: 'Eliminar', valor: 'eliminar', clase: 'peligro' }]), { texto: 'Cerrar', valor: null }] });
            if (v === 'nombre') {
              const { pedirTexto } = await import('../ui.js');
              const n = await pedirTexto('Nuevo nombre', { valor: p.nombre });
              if (n && n.trim()) { await P.actualizarPerfil(p.id, { nombre: n }); if (esActivo) ctx.perfil.nombre = n.trim(); pintar(); }
            } else if (v === 'pin') {
              if (p.pinHash) { const actual = await pedirPin('PIN actual'); if (actual == null) return; if (!(await P.verificarPin(p, actual))) { aviso('PIN incorrecto.', { tipo: 'error' }); return; } }
              const nuevo = await pedirPin('Nuevo PIN (déjalo vacío para quitarlo)');
              if (nuevo == null) return;
              if (nuevo && !/^\d{4,8}$/.test(nuevo)) { aviso('El PIN debe tener entre 4 y 8 números.', { tipo: 'error' }); return; }
              await P.actualizarPerfil(p.id, { pin: nuevo || null });
              aviso(nuevo ? 'PIN guardado.' : 'PIN eliminado.'); pintar();
            } else if (v === 'eliminar') {
              if (p.pinHash) { const pin = await pedirPin(`PIN de ${p.nombre}`); if (pin == null) return; if (!(await P.verificarPin(p, pin))) { aviso('PIN incorrecto.', { tipo: 'error' }); return; } }
              if (await confirmar(`Se borrarán la biblioteca, notas, progreso y audios de ${p.nombre} en este dispositivo. No se puede deshacer.`, { si: 'Eliminar sesión', peligro: true })) {
                await P.eliminarPerfil(p.id); aviso('Sesión eliminada.'); pintar();
              }
            }
          } }, 'Opciones'),
          esActivo ? null : h('button', { class: 'boton pequeno primario', onclick: () => cambiarDePerfil() }, 'Cambiar'))));
    }
    cont.append(ul);
    const preguntar = h('input', { type: 'checkbox', role: 'switch', checked: await P.preguntarAlIniciar() });
    preguntar.addEventListener('change', () => P.fijarPreguntarAlIniciar(preguntar.checked));
    cont.append(
      h('div', { class: 'fila-botones' }, h('button', { class: 'boton', onclick: () => cambiarDePerfil() }, 'Entrar con otra cuenta')),
      h('label', { class: 'interruptor' }, h('span', {}, 'Preguntar quién va a estudiar al abrir VOZI'), preguntar),
      h('p', { class: 'nota-suave' }, 'Las sesiones con PIN siempre lo piden al abrir la app. El PIN evita el acceso casual entre personas que comparten el dispositivo; no cifra los datos. Las copias de seguridad se hacen por sesión.'));
  };
  await pintar();
  return cont;
}

// ---------- Lectura ----------
function seccionLectura() {
  const a = ctx.ajustes;
  const cont = h('div', {});
  const chips = h('div', { class: 'rejilla-opciones', role: 'radiogroup', 'aria-label': 'Duración del tramo' });
  for (const m of [1, 3, 5, 10]) {
    chips.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(a.tramoMin === m), class: 'opcion' + (a.tramoMin === m ? ' activa' : ''), onclick: async (e) => {
      const boton = e.currentTarget;
      await guardarAjustes({ tramoMin: m });
      chips.querySelectorAll('.opcion').forEach((x) => { x.classList.remove('activa'); x.setAttribute('aria-checked', 'false'); });
      boton.classList.add('activa'); boton.setAttribute('aria-checked', 'true');
    } }, `${m} min`));
  }
  cont.append(
    h('h3', {}, 'Duración de cada tramo de audio'),
    h('p', { class: 'nota-suave' }, 'VOZI prepara cada tramo completo antes de reproducirlo, para que no haya cortes. Tramos más largos tardan más en estar listos, pero interrumpen menos. Mientras escuchas, prepara el siguiente.'),
    chips,
    interruptor('Empezar rápido: el primer tramo dura 1 minuto', 'primerTramoCorto'),
    interruptor('Preparar el siguiente tramo mientras escucho', 'prepararSiguiente'),
    interruptor('Desplazar el texto siguiendo la lectura', 'seguirLectura'),
    interruptor('Leer en voz alta las notas al pie', 'leerNotasPie', () => ctx.rep.descargar()),
    h('p', { class: 'nota-suave' }, 'En los PDF, VOZI detecta las notas al pie (letra pequeña al final de la página) y las llamadas de nota (números volados). Siempre se muestran en el texto; por defecto la voz las omite. Encabezados, pies de página repetidos y números de página se quitan al importar.'),
    h('h3', {}, 'Cuadros y tablas'),
    h('p', { class: 'nota-suave' }, 'VOZI lee los cuadros fila por fila, diciendo el nombre de cada columna. Si los interpretaste con la IA (✨ al leer), puede decir primero la interpretación.'),
    opcionesCuadros(),
    h('h3', {}, 'Velocidad de preparación'),
    h('p', { class: 'nota-suave' }, `Cada proceso prepara audio en paralelo y ocupa unos 250 MB. «Automática» usa 3 en equipos de 6 núcleos o más (como el iPhone Pro) y 2 en los demás; si la app llegara a cerrarse por memoria, baja sola uno. Este equipo: ${navigator.hardwareConcurrency || '?'} núcleos.`),
    opcionesProcesos(),
    h('h3', {}, 'Prueba de rendimiento'),
    pruebaRendimiento());
  return cont;
}

function opcionesCuadros() {
  const g = h('div', { class: 'rejilla-opciones', role: 'radiogroup', 'aria-label': 'Cómo leer los cuadros' });
  for (const [c, t] of [['ambos', 'Interpretación y filas'], ['interpretacion', 'Solo interpretación'], ['filas', 'Solo filas']]) {
    const activa = (ctx.ajustes.cuadros || 'ambos') === c;
    g.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(activa), class: 'opcion' + (activa ? ' activa' : ''), onclick: async (e) => {
      const boton = e.currentTarget;
      await guardarAjustes({ cuadros: c });
      g.querySelectorAll('.opcion').forEach((x) => { x.classList.remove('activa'); x.setAttribute('aria-checked', 'false'); });
      boton.classList.add('activa'); boton.setAttribute('aria-checked', 'true');
    } }, t));
  }
  return g;
}

function opcionesCalidad() {
  const g = h('div', { class: 'rejilla-opciones', role: 'radiogroup', 'aria-label': 'Calidad de las voces naturales' });
  for (const [c, t] of [['rapida', 'Rápida'], ['equilibrada', 'Equilibrada'], ['natural', 'Natural']]) {
    const activa = (ctx.ajustes.calidadVoz || 'rapida') === c;
    g.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(activa), class: 'opcion' + (activa ? ' activa' : ''), onclick: async (e) => {
      const boton = e.currentTarget;
      await guardarAjustes({ calidadVoz: c, numSteps: PASOS_CALIDAD[c] });
      g.querySelectorAll('.opcion').forEach((x) => { x.classList.remove('activa'); x.setAttribute('aria-checked', 'false'); });
      boton.classList.add('activa'); boton.setAttribute('aria-checked', 'true');
    } }, t));
  }
  return g;
}

function opcionesProcesos() {
  const g = h('div', { class: 'rejilla-opciones', role: 'radiogroup', 'aria-label': 'Velocidad de preparación' });
  const actual = [1, 2, 3].includes(ctx.ajustes.paralelo) ? ctx.ajustes.paralelo : 'auto';
  for (const [n, t] of [['auto', 'Automática'], [1, '1 proceso'], [2, '2 procesos'], [3, '3 procesos']]) {
    g.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(actual === n), class: 'opcion' + (actual === n ? ' activa' : ''), onclick: async (e) => {
      const boton = e.currentTarget;
      await guardarAjustes({ paralelo: n });
      try { localStorage.removeItem('vozi-max-procesos'); } catch (err) { /* sin almacenamiento */ }
      ctx.motor.terminar();
      g.querySelectorAll('.opcion').forEach((x) => { x.classList.remove('activa'); x.setAttribute('aria-checked', 'false'); });
      boton.classList.add('activa'); boton.setAttribute('aria-checked', 'true');
    } }, t));
  }
  return g;
}

// Mide cuánto tarda este dispositivo en generar audio con la voz elegida
function pruebaRendimiento() {
  const salida = h('p', { class: 'nota-suave', 'aria-live': 'polite' }, 'Genera una frase de prueba y mide la velocidad real de tu dispositivo.');
  const btn = h('button', { class: 'boton', onclick: async () => {
    btn.disabled = true;
    try {
      const { vozLista } = await import('../lectura.js');
      const { ok, voz, pack, faltan } = await vozLista();
      if (!ok) { salida.textContent = `Primero descarga: ${faltan.map((p) => p.title).join(', ')}.`; btn.disabled = false; return; }
      salida.textContent = 'Cargando la voz en memoria…';
      const t0 = performance.now();
      await ctx.motor.preparar(pack, (m) => { salida.textContent = `Cargando la voz en memoria… ${Math.round((m.progress || 0) * 100)} %`; }, (await import('../lectura.js')).procesosEfectivos());
      const carga = (performance.now() - t0) / 1000;
      salida.textContent = 'Generando audio de prueba…';
      const frases = ['¿Qué factores explican el crecimiento de una empresa?', 'En dos mil veinticinco, las ventas aumentaron treinta y dos por ciento.', 'Sin embargo, la directora advirtió que no podían confiarse.', 'Los estudiantes deberán comparar las alternativas disponibles.'];
      const r = await ctx.motor.sintetizar(frases.map((t, i) => ({ id: 'p' + i, text: t })), { sid: voz.sidEs, lang: pack.engine === 'supertonic' ? 'es' : undefined, numSteps: ctx.ajustes.numSteps, outRate: pack.engine === 'supertonic' ? 24000 : undefined }, null);
      const rtf = (r.elapsedMs / 1000) / r.audioSeg;
      const min5 = Math.round(5 * rtf * 10) / 10;
      salida.textContent = `Carga de la voz: ${carga.toFixed(1)} s. Generó ${r.audioSeg.toFixed(1)} s de audio en ${(r.elapsedMs / 1000).toFixed(1)} s (factor ${rtf.toFixed(2)}). Un tramo de 5 minutos tardaría unos ${min5.toString().replace('.', ',')} minutos en prepararse.` +
        (rtf < 1 ? ' Mientras escuchas, el siguiente tramo alcanza a prepararse.' : ' Tu dispositivo genera más lento que el tiempo real: usa tramos cortos al empezar o la voz ligera.');
    } catch (e) { salida.textContent = 'No se pudo completar la prueba: ' + e.message; }
    btn.disabled = false;
  } }, 'Probar rendimiento en este dispositivo');
  return h('div', {}, btn, salida);
}

function interruptor(texto, clave, alCambiar) {
  const inp = h('input', { type: 'checkbox', role: 'switch', checked: !!ctx.ajustes[clave] });
  inp.addEventListener('change', async () => { await guardarAjustes({ [clave]: inp.checked }); alCambiar && alCambiar(inp.checked); });
  return h('label', { class: 'interruptor' }, h('span', {}, texto), inp);
}

// ---------- Recursos sin conexión ----------
async function seccionRecursos(man) {
  const cont = h('div', {});
  if (!man) return h('p', {}, 'No se pudo leer la lista de recursos. Conéctate a internet e inténtalo de nuevo.');
  const voz = vozPorId(ctx.ajustes.vozId);
  cont.append(h('p', { class: 'nota-suave' }, 'Descarga una sola vez lo que necesitas. Después, la lectura en voz alta, el reconocimiento de texto y tus documentos funcionan sin conexión. Si la descarga se interrumpe, se reanuda donde quedó.'));
  const necesarios = [...new Set(['motor-voz', voz.pack, 'voz-supertonic3', 'motor-ocr', 'ocr-spa'])].map((id) => man.packs.find((p) => p.id === id)).filter(Boolean);
  const pendientes = [];
  for (const p of necesarios) if (!(await estadoPaquete(p)).instalado) pendientes.push(p);
  if (pendientes.length) {
    const total = pendientes.reduce((s, p) => s + p.size, 0);
    cont.append(h('div', { class: 'caja-destacada' },
      h('p', {}, h('strong', {}, `Para usar VOZI sin conexión con la voz «${voz.nombre}»: `), `${mb(total)} en total.`),
      h('button', { class: 'boton primario', onclick: async () => {
        for (const p of pendientes) { await descargar(p, filas.get(p.id)); if (descargas.get(p.id)?.error) break; }
        ir('ajustes', { seccion: 'recursos' });
      } }, 'Descargar todo lo necesario')));
  } else cont.append(h('div', { class: 'caja-destacada ok' }, '✓ Todo lo necesario para la voz elegida y el OCR está descargado. VOZI funciona sin conexión.'));
  const filas = new Map();
  const lista = h('ul', { class: 'lista-recursos' });
  for (const p of man.packs) {
    const fila = h('li', { class: 'recurso' });
    filas.set(p.id, fila);
    lista.append(fila);
    await pintarRecurso(p, fila);
  }
  cont.append(lista);
  cont.append(h('p', { class: 'nota-suave' }, 'Las descargas usan tu conexión de datos si no estás en wifi.'));
  limpiarObsoletos(man).catch(() => {});
  return cont;
}

async function pintarRecurso(p, fila) {
  const st = await estadoPaquete(p);
  const d = descargas.get(p.id);
  fila.innerHTML = '';
  const pct = st.bytesTotal ? Math.round(100 * (d ? d.bytesHechos : st.bytesHechos) / st.bytesTotal) : 0;
  const estado = d && !d.error ? `Descargando… ${pct} % (${mb(d.bytesHechos)} de ${mb(st.bytesTotal)})${d.velocidad ? ` · ${mb(d.velocidad)}/s` : ''}`
    : st.instalado ? `✓ Descargado · ${mb(st.bytesTotal)}`
      : st.bytesHechos ? `Incompleto: ${mb(st.bytesHechos)} de ${mb(st.bytesTotal)}` : `Sin descargar · ${mb(st.bytesTotal)}`;
  fila.append(
    h('div', { class: 'recurso-info' },
      h('strong', {}, p.title), h('span', { class: 'nota-suave' }, p.description),
      h('span', { class: 'recurso-estado' + (st.instalado ? ' ok' : '') }, estado),
      d && d.error ? h('span', { class: 'recurso-error', role: 'alert' }, d.error) : null,
      (d && !d.error) || (st.bytesHechos && !st.instalado) ? h('div', { class: 'barra-progreso', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: pct + '%' } })) : null),
    h('div', { class: 'recurso-acciones' },
      d && !d.error ? h('button', { class: 'boton pequeno', onclick: () => d.abort.abort() }, 'Pausar')
        : st.instalado ? h('button', { class: 'boton pequeno peligro', onclick: async () => {
          if (await confirmar(`¿Borrar «${p.title}» de este dispositivo? Podrás descargarlo de nuevo.`, { si: 'Borrar', peligro: true })) {
            if (ctx.motor.packId === p.id || p.id === 'motor-voz') ctx.motor.terminar();
            await borrarPaquete(p); pintarRecurso(p, fila);
          }
        } }, 'Borrar')
          : h('button', { class: 'boton pequeno primario', onclick: () => descargar(p, fila) }, st.bytesHechos ? 'Reanudar' : 'Descargar')));
}

async function descargar(p, fila) {
  const abort = new AbortController();
  const d = { abort, bytesHechos: 0, bytesTotal: p.size, velocidad: 0 };
  descargas.set(p.id, d);
  let ultimo = 0;
  try {
    await pedirPersistencia();
    await descargarPaquete(p, (pr) => {
      Object.assign(d, pr);
      const ahora = performance.now();
      if (fila && ahora - ultimo > 400) { ultimo = ahora; pintarRecurso(p, fila); }
    }, abort.signal);
    descargas.delete(p.id);
    aviso(`«${p.title}» descargado y verificado.`);
  } catch (e) {
    d.error = e.message;
    if (e.tipo === 'cancelada') descargas.delete(p.id);
  }
  if (fila && document.body.contains(fila)) pintarRecurso(p, fila);
}

// ---------- Apariencia ----------
function seccionApariencia() {
  const cont = h('div', {});
  const temas = h('div', { class: 'rejilla-opciones', role: 'radiogroup', 'aria-label': 'Tema' });
  for (const [id, t] of [['sistema', 'Automático'], ['claro', 'Claro'], ['oscuro', 'Oscuro']]) {
    temas.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(ctx.ajustes.tema === id), class: 'opcion' + (ctx.ajustes.tema === id ? ' activa' : ''), onclick: async (e) => {
      const boton = e.currentTarget;
      await guardarAjustes({ tema: id }); aplicarTema();
      temas.querySelectorAll('.opcion').forEach((x) => { x.classList.remove('activa'); x.setAttribute('aria-checked', 'false'); });
      boton.classList.add('activa'); boton.setAttribute('aria-checked', 'true');
    } }, t));
  }
  const tam = h('input', { type: 'range', min: 14, max: 34, step: 1, value: ctx.ajustes.letra, 'aria-label': 'Tamaño de letra' });
  const val = h('output', {}, ctx.ajustes.letra + ' px');
  const ejemplo = h('p', { class: 'ejemplo-letra' }, 'Así se verá el texto durante la lectura.');
  tam.addEventListener('input', async () => { val.textContent = tam.value + ' px'; await guardarAjustes({ letra: +tam.value }); aplicarTema(); });
  cont.append(h('h3', {}, 'Tema'), temas, h('h3', {}, 'Tamaño de letra de lectura'), h('div', { class: 'fila-rango' }, tam, val), ejemplo);
  return cont;
}

// ---------- Pronunciación ----------
function seccionPronunciacion() {
  const cont = h('div', {});
  cont.append(h('p', { class: 'nota-suave' }, 'Indica cómo leer siglas o palabras difíciles. Solo cambia la voz: el texto que ves no se modifica.'));
  const lista = h('ul', { class: 'lista-simple' });
  const pintar = () => {
    lista.innerHTML = '';
    for (const [i, e] of ctx.ajustes.diccionario.entries()) {
      lista.append(h('li', { class: 'fila-dic' }, h('span', {}, h('strong', {}, e.escrito), ' → ', e.dicho),
        h('button', { class: 'enlace peligro', onclick: async () => { ctx.ajustes.diccionario.splice(i, 1); await guardarAjustes({ diccionario: ctx.ajustes.diccionario }); pintar(); } }, 'Quitar')));
    }
    if (!ctx.ajustes.diccionario.length) lista.append(h('li', { class: 'nota-suave' }, 'Sin entradas. Ejemplo: «PIB» → «pe i be».'));
  };
  const esc = h('input', { class: 'campo', placeholder: 'Escrito (p. ej., PIB)' });
  const dic = h('input', { class: 'campo', placeholder: 'Se dice (p. ej., pe i be)' });
  const prueba = h('input', { class: 'campo', placeholder: 'Escribe un texto para ver cómo se leerá', value: 'El PIB creció 3,5 % en 2025 según el Dr. Gómez (pág. 12).' });
  const salida = h('p', { class: 'salida-normalizada', 'aria-live': 'polite' });
  const actualizar = () => { salida.textContent = normalizar(prueba.value, { diccionario: ctx.ajustes.diccionario }); };
  prueba.addEventListener('input', actualizar);
  cont.append(lista,
    h('div', { class: 'fila-campos' }, esc, dic, h('button', { class: 'boton', onclick: async () => {
      if (!esc.value.trim() || !dic.value.trim()) return;
      ctx.ajustes.diccionario.push({ escrito: esc.value.trim(), dicho: dic.value.trim() });
      await guardarAjustes({ diccionario: ctx.ajustes.diccionario });
      esc.value = dic.value = ''; pintar(); actualizar();
    } }, 'Añadir')),
    h('h3', {}, 'Vista previa de lo que dirá la voz'), prueba, salida,
    h('p', { class: 'nota-suave' }, 'VOZI interpreta cifras con la convención colombiana (1.500.000 = un millón quinientos mil; 18,5 = dieciocho coma cinco), porcentajes, fechas, horas, monedas y abreviaturas comunes.'));
  pintar(); actualizar();
  return cont;
}

// ---------- Almacenamiento ----------
async function seccionAlmacenamiento() {
  const cont = h('div', {});
  const est = await estimarAlmacenamiento();
  const persist = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const audios = await db.all('audio');
  const bytesAudio = audios.reduce((s, a) => s + (a.bytes || 0), 0);
  const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  cont.append(
    h('dl', { class: 'datos' },
      h('dt', {}, 'Espacio usado por VOZI'), h('dd', {}, est ? `${mb(est.usage || 0)}${est.quota ? ` de ${mb(est.quota)} disponibles para la app` : ''}` : 'No disponible en este navegador'),
      h('dt', {}, 'Audio preparado guardado'), h('dd', {}, `${mb(bytesAudio)} en ${audios.length} tramo(s)`),
      h('dt', {}, 'Protección contra borrado automático'), h('dd', {}, persist ? 'Activada' : 'No garantizada por el navegador'),
      h('dt', {}, 'Instalada en pantalla de inicio'), h('dd', {}, instalada ? 'Sí' : 'No')),
    h('div', { class: 'fila-botones' },
      h('button', { class: 'boton peligro', disabled: !audios.length, onclick: async () => {
        if (!(await confirmar('Se borrará todo el audio preparado. Tus documentos, notas y marcadores no se tocan.', { si: 'Borrar audios', peligro: true }))) return;
        ctx.rep.descargar();
        for (const a of audios) { await db.del('audioBlobs', a.id); await db.del('audio', a.id); }
        aviso('Audio borrado.'); ir('ajustes', { seccion: 'almacenamiento' });
      } }, 'Borrar todo el audio guardado')),
    h('div', { class: 'caja-destacada' },
      h('p', {}, h('strong', {}, 'Importante: '), 'tus lecturas, notas, marcadores, audios y voces se guardan solo en este dispositivo. Si borras los datos de Safari o del sitio, o desinstalas la app de la pantalla de inicio, ese contenido se elimina.'),
      !instalada ? h('p', {}, 'En iPhone y iPad, Safari puede borrar los datos de sitios web que no se usan durante varios días. Instala VOZI en la pantalla de inicio (Compartir → «Agregar a inicio») para evitarlo.') : null,
      h('p', {}, 'Haz copias de seguridad con frecuencia.')));
  return cont;
}

// ---------- Copia de seguridad ----------
function seccionCopia() {
  const cont = h('div', {});
  const conAudio = h('input', { type: 'checkbox' });
  cont.append(
    h('p', { class: 'nota-suave' }, 'Guarda en un archivo tus documentos, notas, citas, tarjetas, marcadores, puntos de lectura y ajustes. En iPhone puedes elegir «Guardar en Archivos».'),
    h('label', { class: 'casilla' }, conAudio, ' Incluir el audio preparado (el archivo será mucho más grande)'),
    h('div', { class: 'fila-botones' },
      h('button', { class: 'boton primario', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Preparando copia…';
        try {
          const blob = await exportarCopia({ incluirAudios: conAudio.checked });
          const f = new Date().toISOString().slice(0, 10);
          await compartirODescargar(blob, `vozi-copia-${f}.zip`, 'Copia de seguridad de VOZI');
        } catch (err) { aviso('No se pudo crear la copia: ' + err.message, { tipo: 'error' }); }
        b.disabled = false; b.textContent = 'Exportar copia de seguridad';
      } }, 'Exportar copia de seguridad'),
      h('button', { class: 'boton', onclick: async () => {
        const [f] = await elegirArchivo({ accept: '.zip,application/zip' });
        if (!f) return;
        try {
          const copia = await leerCopia(f);
          const n = (copia.datos.docs || []).length;
          if (!(await confirmar(`La copia contiene ${n} documento(s) del ${new Date(copia.datos.creado).toLocaleDateString('es-CO')}. Se añadirán a tu biblioteca; si un documento ya existe, se reemplazará por la versión de la copia. Nada más se borra.`, { si: 'Restaurar' }))) return;
          const r = await restaurarCopia(copia);
          aviso(`Restaurado: ${r.docs} documento(s), ${r.notes} nota(s)${r.audio ? `, ${r.audio} audio(s)` : ''}.`, { ms: 6000 });
          ir('biblioteca');
        } catch (err) { aviso(err.message, { tipo: 'error', ms: 7000 }); }
      } }, 'Restaurar desde archivo')));
  return cont;
}

// ---------- Acerca de ----------
function seccionAcerca() {
  return h('div', {},
    h('p', {}, `VOZI ${VERSION}. Lector de estudio gratuito: sin suscripciones, sin cobros y sin enviar tus documentos a internet.`),
    h('p', {}, 'Las voces son sintéticas, generadas en tu dispositivo. Buscan la mayor naturalidad posible, pero no son voces humanas.'),
    h('p', {}, h('a', { href: 'licencias.html', target: '_blank', rel: 'noopener' }, 'Ver créditos y licencias completas')),
    h('ul', { class: 'lista-simple' },
      h('li', {}, 'Voces naturales: Supertonic 3 de Supertone Inc. — modelo bajo licencia OpenRAIL-M.'),
      h('li', {}, 'Voces ligeras: Piper (Rhasspy) — «ald» (dominio público / Unlicense) y «claude» (Apache 2.0).'),
      h('li', {}, 'Motor de voz: sherpa-onnx (k2-fsa) con ONNX Runtime y espeak-ng — Apache 2.0 / GPL-3.0 (espeak-ng).'),
      h('li', {}, 'Reconocimiento de texto: Tesseract OCR y tesseract.js-core — Apache 2.0.'),
      h('li', {}, 'Lectura de PDF: PDF.js de Mozilla — Apache 2.0.')));
}
