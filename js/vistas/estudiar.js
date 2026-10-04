// VOZI — Estudio: notas y citas, tarjetas de repaso, marcadores, temporizador y exportación.
import { ctx } from '../estado.js';
import { db, uid, getSetting, setSetting, listarDocs } from '../db.js';
import { h, aviso, dialogo, confirmar, pedirTexto, fecha, compartirODescargar } from '../ui.js';
import { ir, abrirDocumento } from '../app.js';

let pestana = 'notas';

export async function vistaEstudiar(main, opciones = {}) {
  document.getElementById('cabeceraTitulo').textContent = 'Estudiar';
  if (opciones.pestana) pestana = opciones.pestana;
  const docs = (await listarDocs()).sort((a, b) => (b.ultimaLectura || b.updatedAt) - (a.ultimaLectura || a.updatedAt));
  const cont = h('section', { class: 'vista vista-estudiar' });
  main.append(cont);
  if (!docs.length) { cont.append(h('div', { class: 'vacio' }, h('p', {}, 'Importa un documento para tomar notas y crear tarjetas.'), h('button', { class: 'boton primario', onclick: () => ir('importar') }, 'Importar'))); return; }
  let doc = ctx.doc || await db.get('docs', docs[0].id);
  const selector = h('select', { class: 'campo', 'aria-label': 'Documento' }, docs.map((d) => h('option', { value: d.id, selected: d.id === doc.id }, d.title)));
  selector.addEventListener('change', async () => { doc = (ctx.doc && ctx.doc.id === selector.value) ? ctx.doc : await db.get('docs', selector.value); pintar(); });
  const tabs = h('div', { class: 'pestanas-internas', role: 'tablist' });
  const cuerpo = h('div', { class: 'cuerpo-estudio' });
  const TABS = [['notas', 'Notas y citas'], ['tarjetas', 'Tarjetas'], ['marcadores', 'Marcadores'], ['temporizador', 'Temporizador']];
  for (const [id, t] of TABS) {
    tabs.append(h('button', { role: 'tab', 'aria-selected': String(pestana === id), class: pestana === id ? 'activa' : '', onclick: () => { pestana = id; pintar(); } }, t));
  }
  cont.append(h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Documento'), selector), tabs, cuerpo);

  async function pintar() {
    tabs.querySelectorAll('button').forEach((b, i) => { const act = TABS[i][0] === pestana; b.classList.toggle('activa', act); b.setAttribute('aria-selected', String(act)); });
    cuerpo.innerHTML = '';
    if (pestana === 'notas') await pintarNotas(cuerpo, doc, pintar);
    else if (pestana === 'tarjetas') await pintarTarjetas(cuerpo, doc, pintar);
    else if (pestana === 'marcadores') await pintarMarcadores(cuerpo, doc);
    else pintarTemporizador(cuerpo);
  }
  pintar();
}

function irAParrafo(doc, pid) {
  const idx = doc.paragraphs.findIndex((p) => p.id === pid);
  abrirDocumento(doc.id, { pidx: idx >= 0 ? idx : 0 });
}

async function pintarNotas(cuerpo, doc, repintar) {
  const notas = (await db.byIndex('notes', 'docId', doc.id)).sort((a, b) => ordenPid(doc, a.pid) - ordenPid(doc, b.pid) || a.creado - b.creado);
  cuerpo.append(h('div', { class: 'fila-botones' },
    h('button', { class: 'boton', onclick: async () => {
      const t = await pedirTexto('Nota general', { multilinea: true, placeholder: 'Escribe tu nota…' });
      if (t && t.trim()) { await db.put('notes', { id: uid('n'), docId: doc.id, tipo: 'nota', texto: t.trim(), pid: null, page: null, creado: Date.now(), actualizado: Date.now() }); repintar(); }
    } }, '+ Nota'),
    h('button', { class: 'boton', disabled: !notas.length, onclick: () => exportarNotas(doc, notas, 'md') }, 'Exportar (Markdown)'),
    h('button', { class: 'boton', disabled: !notas.length, onclick: () => exportarNotas(doc, notas, 'txt') }, 'Exportar (texto)')));
  if (!notas.length) { cuerpo.append(h('p', { class: 'vacio' }, 'Sin notas todavía. En la lectura, toca un párrafo para escribir una nota, o selecciona texto y pulsa «Guardar como cita».')); return; }
  const ul = h('ul', { class: 'lista-notas' });
  for (const n of notas) {
    ul.append(h('li', { class: 'nota ' + n.tipo },
      n.tipo === 'cita' ? h('blockquote', {}, '«' + n.cita + '»') : null,
      n.texto ? h('p', {}, n.texto) : null,
      h('div', { class: 'nota-pie' },
        h('span', {}, [n.tipo === 'cita' ? 'Cita' : 'Nota', n.page != null ? `pág. ${n.page}` : null, fecha(n.creado)].filter(Boolean).join(' · ')),
        n.pid ? h('button', { class: 'enlace', onclick: () => irAParrafo(doc, n.pid) }, 'Ir al texto') : null,
        h('button', { class: 'enlace', onclick: async () => {
          const t = await pedirTexto('Editar', { multilinea: true, valor: n.texto || '' });
          if (t !== null) { n.texto = t.trim(); n.actualizado = Date.now(); await db.put('notes', n); repintar(); }
        } }, 'Editar'),
        h('button', { class: 'enlace peligro', onclick: async () => { if (await confirmar('¿Eliminar esta nota?', { si: 'Eliminar', peligro: true })) { await db.del('notes', n.id); repintar(); } } }, 'Eliminar'))));
  }
  cuerpo.append(ul);
}

function ordenPid(doc, pid) { if (!pid) return -1; const i = doc.paragraphs.findIndex((p) => p.id === pid); return i < 0 ? 1e9 : i; }

export function notasComoTexto(doc, notas, formato) {
  const md = formato === 'md';
  const lineas = [md ? `# Notas — ${doc.title}` : `NOTAS — ${doc.title}`, '', `Exportado de VOZI el ${new Date().toLocaleString('es-CO')}`, ''];
  for (const n of notas) {
    const ref = n.page != null ? ` (pág. ${n.page})` : '';
    if (n.tipo === 'cita') {
      lineas.push(md ? `> ${n.cita.replace(/\n/g, '\n> ')}${ref}` : `«${n.cita}»${ref}`);
      if (n.texto) lineas.push('', md ? n.texto : `  Comentario: ${n.texto}`);
    } else lineas.push(md ? `- ${n.texto}${ref}` : `• ${n.texto}${ref}`);
    lineas.push('');
  }
  return lineas.join('\n');
}

function exportarNotas(doc, notas, formato) {
  const txt = notasComoTexto(doc, notas, formato);
  const nombre = `notas-${doc.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 50)}.${formato}`;
  compartirODescargar(new Blob([txt], { type: formato === 'md' ? 'text/markdown' : 'text/plain' }), nombre, 'Notas de ' + doc.title);
}

// ---------- Tarjetas (repaso con cajas tipo Leitner) ----------
const INTERVALOS = [0, 0, 1, 3, 7, 14, 30]; // días por caja

async function pintarTarjetas(cuerpo, doc, repintar) {
  const cards = await db.byIndex('cards', 'docId', doc.id);
  const ahora = Date.now();
  const pendientes = cards.filter((c) => (c.proxima || 0) <= ahora);
  cuerpo.append(h('div', { class: 'fila-botones' },
    h('button', { class: 'boton primario', disabled: !pendientes.length, onclick: () => repasar(pendientes, repintar) }, pendientes.length ? `Repasar ${pendientes.length} tarjeta(s)` : 'Nada pendiente hoy'),
    h('button', { class: 'boton', onclick: () => editarTarjeta(doc, null, repintar) }, '+ Tarjeta')));
  if (!cards.length) { cuerpo.append(h('p', { class: 'vacio' }, 'Crea tus propias tarjetas de pregunta y respuesta. También desde la lectura: toca un párrafo → «Crear tarjeta de repaso».')); return; }
  cuerpo.append(h('ul', { class: 'lista-notas' }, cards.sort((a, b) => a.creado - b.creado).map((c) => h('li', { class: 'nota' },
    h('p', {}, h('strong', {}, c.q)), h('p', { class: 'nota-suave' }, c.a),
    h('div', { class: 'nota-pie' },
      h('span', {}, `Caja ${c.caja || 1}${c.page != null ? ' · pág. ' + c.page : ''}`),
      h('button', { class: 'enlace', onclick: () => editarTarjeta(doc, c, repintar) }, 'Editar'),
      h('button', { class: 'enlace peligro', onclick: async () => { if (await confirmar('¿Eliminar esta tarjeta?', { si: 'Eliminar', peligro: true })) { await db.del('cards', c.id); repintar(); } } }, 'Eliminar'))))));
}

async function editarTarjeta(doc, c, repintar) {
  const preg = h('textarea', { class: 'campo', rows: 3 }, c ? c.q : '');
  const resp = h('textarea', { class: 'campo', rows: 4 }, c ? c.a : '');
  const r = await dialogo({
    titulo: c ? 'Editar tarjeta' : 'Nueva tarjeta',
    contenido: h('div', {}, h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Pregunta'), preg), h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Respuesta'), resp)),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', valor: () => ({ q: preg.value.trim(), a: resp.value.trim() }), clase: 'primario' }],
  });
  if (!r || !r.q) return;
  const card = c || { id: uid('c'), docId: doc.id, pid: null, page: null, caja: 1, proxima: Date.now(), creado: Date.now() };
  card.q = r.q; card.a = r.a;
  await db.put('cards', card);
  repintar();
}

async function repasar(lista, repintar) {
  const cola = [...lista].sort(() => Math.random() - 0.5);
  for (const c of cola) {
    const resp = h('div', { class: 'respuesta', hidden: true }, h('p', {}, c.a || '(sin respuesta)'));
    const mostrar = h('button', { type: 'button', class: 'boton', onclick: () => { resp.hidden = false; mostrar.hidden = true; } }, 'Mostrar respuesta');
    const r = await dialogo({
      titulo: 'Repaso',
      contenido: h('div', { class: 'tarjeta-repaso' }, h('p', { class: 'pregunta' }, c.q), mostrar, resp),
      botones: [{ texto: 'Terminar', valor: 'fin' }, { texto: 'Repasar otra vez', valor: 'mal' }, { texto: 'La sabía', valor: 'bien', clase: 'primario' }],
    });
    if (r === 'fin' || r == null) break;
    c.caja = r === 'bien' ? Math.min(6, (c.caja || 1) + 1) : 1;
    c.proxima = Date.now() + INTERVALOS[c.caja] * 86400000;
    await db.put('cards', c);
  }
  repintar();
}

async function pintarMarcadores(cuerpo, doc) {
  const marcas = (await db.byIndex('bookmarks', 'docId', doc.id)).sort((a, b) => ordenPid(doc, a.pid) - ordenPid(doc, b.pid));
  if (!marcas.length) { cuerpo.append(h('p', { class: 'vacio' }, 'Sin marcadores. En la lectura, toca un párrafo y elige «Añadir marcador».')); return; }
  cuerpo.append(h('ul', { class: 'lista-notas' }, marcas.map((m) => h('li', { class: 'nota' },
    h('p', {}, m.extracto + '…'),
    h('div', { class: 'nota-pie' }, h('span', {}, m.page != null ? `pág. ${m.page}` : ''),
      h('button', { class: 'enlace', onclick: () => irAParrafo(doc, m.pid) }, 'Ir al texto'),
      h('button', { class: 'enlace peligro', onclick: async () => { await db.del('bookmarks', m.id); m.borrado = true; aviso('Marcador eliminado.'); ir('estudiar'); } }, 'Eliminar'))))));
}

// ---------- Temporizador de estudio ----------
const tempo = { fin: null, fase: 'estudio', min: 25, descanso: 5, timer: null, pausadoRestante: null };

function pintarTemporizador(cuerpo) {
  const reloj = h('div', { class: 'reloj', 'aria-live': 'polite' }, '');
  const fase = h('p', { class: 'nota-suave' }, '');
  const minutos = h('select', { class: 'campo corto', 'aria-label': 'Minutos de estudio' }, [15, 20, 25, 30, 45, 50, 60, 90].map((m) => h('option', { value: m, selected: m === tempo.min }, `${m} min`)));
  const descanso = h('select', { class: 'campo corto', 'aria-label': 'Minutos de descanso' }, [3, 5, 10, 15].map((m) => h('option', { value: m, selected: m === tempo.descanso }, `${m} min`)));
  minutos.addEventListener('change', () => { tempo.min = +minutos.value; });
  descanso.addEventListener('change', () => { tempo.descanso = +descanso.value; });
  const btn = h('button', { class: 'boton primario grande' }, '');
  const reiniciar = h('button', { class: 'boton' }, 'Reiniciar');
  const actualizar = () => {
    const rest = restante();
    reloj.textContent = fmt(rest != null ? rest : tempo.min * 60);
    fase.textContent = tempo.fin || tempo.pausadoRestante != null ? (tempo.fase === 'estudio' ? 'Tiempo de estudio' : 'Descanso') : 'Elige la duración y empieza.';
    btn.textContent = tempo.fin ? 'Pausar' : (tempo.pausadoRestante != null ? 'Continuar' : 'Empezar');
  };
  btn.addEventListener('click', () => {
    if (tempo.fin) { tempo.pausadoRestante = restante(); tempo.fin = null; }
    else if (tempo.pausadoRestante != null) { tempo.fin = Date.now() + tempo.pausadoRestante * 1000; tempo.pausadoRestante = null; }
    else { tempo.fase = 'estudio'; tempo.fin = Date.now() + tempo.min * 60000; }
    iniciarTic(); actualizar();
  });
  reiniciar.addEventListener('click', () => { tempo.fin = null; tempo.pausadoRestante = null; tempo.fase = 'estudio'; actualizar(); chipTemporizador(); });
  cuerpo.append(h('div', { class: 'temporizador' }, reloj, fase,
    h('div', { class: 'fila-campos' }, h('label', {}, 'Estudio ', minutos), h('label', {}, ' Descanso ', descanso)),
    h('div', { class: 'fila-botones' }, btn, reiniciar),
    h('p', { class: 'nota-suave' }, 'El temporizador sigue mientras usas la app. En iPhone, si la app pasa a segundo plano, el aviso aparecerá al volver.')));
  actualizar();
  const iv = setInterval(() => { if (!document.body.contains(reloj)) clearInterval(iv); else actualizar(); }, 500);
}

function restante() { return tempo.fin ? Math.max(0, Math.round((tempo.fin - Date.now()) / 1000)) : tempo.pausadoRestante; }
function fmt(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

function iniciarTic() {
  clearInterval(tempo.timer);
  tempo.timer = setInterval(() => {
    chipTemporizador();
    if (tempo.fin && Date.now() >= tempo.fin) {
      sonar();
      if (tempo.fase === 'estudio') { tempo.fase = 'descanso'; tempo.fin = Date.now() + tempo.descanso * 60000; aviso('¡Tiempo de descanso! Buen trabajo.', { ms: 8000 }); }
      else { tempo.fase = 'estudio'; tempo.fin = null; aviso('Descanso terminado. Cuando quieras, empieza otra sesión.', { ms: 8000 }); }
    }
  }, 1000);
}

export function chipTemporizador() {
  let chip = document.getElementById('chipTempo');
  const rest = restante();
  if (!tempo.fin) { if (chip) chip.remove(); return; }
  if (!chip) {
    chip = h('button', { id: 'chipTempo', class: 'chip-tempo', onclick: () => ir('estudiar', { pestana: 'temporizador' }) });
    document.querySelector('.cabecera').append(chip);
  }
  chip.textContent = (tempo.fase === 'estudio' ? '⏱ ' : '☕ ') + fmt(rest || 0);
  chip.setAttribute('aria-label', `Temporizador: ${fmt(rest || 0)} restantes`);
}

function sonar() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = [660, 880, 990][i]; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.22);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.25);
    });
    setTimeout(() => ac.close(), 1200);
  } catch { /* sin audio */ }
}
