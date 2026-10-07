// VOZI — Asistente de estudio con IA del dispositivo: resumir, preguntas de repaso,
// preguntar sobre el texto y explicar un párrafo. Nada sale del equipo.
import { ctx } from '../estado.js';
import { db, uid } from '../db.js';
import { h, aviso, dialogo } from '../ui.js';
import { ir } from '../app.js';
import * as IA from '../ia/ia.js';

let trabajo = null; // {abort}

function detener() { if (trabajo) { trabajo.abort.abort(); trabajo = null; } }

// Comprueba soporte y descarga; si falta el modelo, ofrece descargarlo
async function asegurarModelo() {
  const s = await IA.soporteIA();
  if (!s.ok) { await dialogo({ titulo: 'IA no disponible en este equipo', contenido: h('p', {}, s.motivo), botones: [{ texto: 'Entendido', valor: null }] }); return false; }
  if (await IA.modeloDescargado()) return true;
  const m = IA.modeloElegido();
  const r = await dialogo({
    titulo: 'Descargar la IA de estudio',
    contenido: h('div', {},
      h('p', {}, `Para resumir y analizar textos sin internet y sin costo, VOZI necesita descargar una sola vez el modelo «${m.nombre}» (${m.detalle.split('·').pop().trim()}).`),
      h('p', { class: 'nota-suave' }, 'Mejor con wifi. Funciona dentro de tu equipo: tus textos no se envían a ningún servidor. Puedes cambiar o borrar el modelo en Ajustes → Inteligencia artificial.')),
    botones: [{ texto: 'Ahora no', valor: false }, { texto: 'Descargar', valor: true, clase: 'primario' }],
  });
  return !!r;
}

function textoAHtml(t) {
  // Viñetas «- » como lista; el resto como párrafos
  const cont = h('div', { class: 'ia-texto' });
  let ul = null;
  for (const linea of t.split('\n')) {
    const l = linea.trim();
    if (!l) { ul = null; continue; }
    if (/^[-•*]\s+/.test(l)) { if (!ul) { ul = h('ul', {}); cont.append(ul); } ul.append(h('li', {}, l.replace(/^[-•*]\s+/, '').replace(/\*\*/g, ''))); }
    else { ul = null; cont.append(h('p', {}, l.replace(/\*\*/g, '').replace(/^#+\s*/, ''))); }
  }
  return cont;
}

async function guardarNota(doc, texto, titulo, pid = null, page = null) {
  await db.put('notes', { id: uid('n'), docId: doc.id, tipo: 'nota', texto: `${titulo} (IA)\n\n${texto}`, pid, page, creado: Date.now(), actualizado: Date.now() });
  aviso('Guardado en Estudiar → Notas.');
}

// Panel principal del asistente para el documento abierto
export async function panelIA() {
  const doc = ctx.doc;
  if (!doc) return;
  if (!(await asegurarModelo())) return;
  const salida = h('div', { class: 'ia-salida', 'aria-live': 'polite' });
  const estado = h('p', { class: 'nota-suave ia-estado' });
  const barra = h('div', { class: 'ia-barra', hidden: true }, h('span', {}));
  const pie = h('div', { class: 'ia-acciones-resultado' });
  const campo = h('input', { class: 'campo', type: 'text', placeholder: 'Escribe una pregunta sobre el texto…', enterkeyhint: 'send' });
  const botones = h('div', { class: 'ia-botones' });
  const m = IA.modeloElegido();

  const progreso = (f, txt) => { barra.hidden = f == null; if (f != null) barra.firstChild.style.width = Math.round(f * 100) + '%'; estado.textContent = txt || ''; };
  const ocupado = (si) => { for (const b of botones.querySelectorAll('button')) b.disabled = si; campo.disabled = si; };

  async function ejecutar(nombre, fn) {
    if (trabajo) return;
    const abort = new AbortController();
    trabajo = { abort };
    ocupado(true); pie.innerHTML = ''; salida.innerHTML = '';
    const cancelar = h('button', { class: 'enlace peligro', onclick: () => detener() }, 'Detener');
    pie.append(cancelar);
    try {
      await IA.prepararIA((p) => progreso(p.fraccion, p.texto));
      progreso(0, `${nombre}…`);
      await fn(abort.signal);
    } catch (e) {
      if (e.name === 'AbortError') estado.textContent = 'Detenido.';
      else { estado.textContent = ''; salida.append(h('p', { class: 'nota-error' }, e.message)); }
      cancelar.remove();
    } finally {
      trabajo = null; ocupado(false); barra.hidden = true;
      if (cancelar.isConnected) cancelar.remove();
    }
  }

  const mostrarResumen = (texto, desdeGuardado) => {
    salida.innerHTML = ''; salida.append(textoAHtml(texto));
    pie.innerHTML = '';
    pie.append(
      h('button', { class: 'boton pequeno', onclick: () => guardarNota(doc, texto, 'Resumen') }, 'Guardar en notas'),
      h('button', { class: 'boton pequeno', onclick: () => navigator.clipboard && navigator.clipboard.writeText(texto).then(() => aviso('Copiado.')) }, 'Copiar'),
      ...(desdeGuardado ? [h('button', { class: 'enlace', onclick: () => accionResumen(true) }, 'Volver a resumir')] : []));
  };

  async function accionResumen(forzar = false) {
    const previo = !forzar && await IA.resultadoGuardado(doc.id, 'resumen');
    if (previo) { estado.textContent = `Resumen guardado del ${new Date(previo.fecha).toLocaleDateString('es-CO')}.`; mostrarResumen(previo.valor, true); return; }
    await ejecutar('Resumiendo', async (signal) => {
      const t0 = Date.now();
      const texto = await IA.resumir(doc, { signal, onEstado: (s) => {
        if (s.fase === 'parte') progreso((s.i - 1) / s.n, `Leyendo la parte ${s.i} de ${s.n}…`);
        else progreso(0.95, 'Escribiendo el resumen…');
        salida.innerHTML = ''; if (s.texto) salida.append(textoAHtml(s.texto));
      } });
      await IA.guardarResultado(doc.id, 'resumen', texto);
      estado.textContent = `Listo en ${Math.round((Date.now() - t0) / 1000)} s.`;
      mostrarResumen(texto, false);
    });
  }

  async function accionPreguntas() {
    await ejecutar('Preparando preguntas', async (signal) => {
      const lista = await IA.preguntasRepaso(doc, { signal, onEstado: (s) => {
        progreso((s.i - 1) / s.n, `Preguntas de la parte ${s.i} de ${s.n}…`);
        salida.innerHTML = ''; if (s.texto) salida.append(h('pre', { class: 'ia-borrador' }, s.texto));
      } });
      salida.innerHTML = '';
      if (!lista.length) { estado.textContent = 'No salieron preguntas válidas. Intenta de nuevo.'; return; }
      estado.textContent = `${lista.length} preguntas. Desmarca las que no quieras y crea las tarjetas.`;
      const checks = lista.map((x) => {
        const c = h('input', { type: 'checkbox', checked: true });
        salida.append(h('label', { class: 'ia-pregunta' }, c, h('span', {}, h('strong', {}, x.q), h('br'), h('span', { class: 'nota-suave' }, x.a + (x.page != null ? ` · pág. ${x.page}` : '')))));
        return c;
      });
      pie.innerHTML = '';
      pie.append(h('button', { class: 'boton primario pequeno', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        let n = 0;
        for (let i = 0; i < lista.length; i++) if (checks[i].checked) {
          await db.put('cards', { id: uid('c'), docId: doc.id, q: lista[i].q, a: lista[i].a, pid: null, page: lista[i].page, caja: 1, proxima: Date.now(), creado: Date.now(), ia: true });
          n++;
        }
        aviso(`${n} tarjeta(s) creadas. Repásalas en Estudiar → Tarjetas.`);
      } }, 'Crear tarjetas'));
    });
  }

  async function accionPreguntar() {
    const q = campo.value.trim();
    if (!q) { campo.focus(); return; }
    await ejecutar('Buscando en el texto', async (signal) => {
      progreso(0.5, 'Pensando la respuesta…');
      const r = await IA.preguntar(doc, q, { signal, onTexto: (t) => { salida.innerHTML = ''; salida.append(h('p', { class: 'ia-pregunta-hecha' }, q), textoAHtml(t)); } });
      estado.textContent = r.paginas.length ? `Basado en las páginas ${[...new Set(r.paginas)].join(', ')}.` : '';
      pie.innerHTML = '';
      pie.append(h('button', { class: 'boton pequeno', onclick: () => guardarNota(doc, `Pregunta: ${q}\n\n${r.texto}`, 'Pregunta') }, 'Guardar en notas'));
    });
  }

  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); accionPreguntar(); } });
  async function accionCuadros() {
    await ejecutar('Interpretando cuadros', async (signal) => {
      const n = await IA.interpretarCuadros(doc, { signal,
        onEstado: (s) => { progreso((s.i - 1) / s.n, `Cuadro ${s.i} de ${s.n}…`); salida.innerHTML = ''; if (s.texto) salida.append(textoAHtml(s.texto)); },
        alGuardar: (p) => { import('./leer.js').then((m) => m.repintarTabla(p.id)); ctx.rep && ctx.rep.descargar && !ctx.rep.reproduciendo && ctx.rep.descargar(); } });
      estado.textContent = n ? `${n} cuadro(s) interpretados. Al escuchar, VOZI dirá primero la interpretación y luego las filas.` : 'No había cuadros pendientes.';
      pintarBotonCuadros();
    });
  }
  const btnCuadros = h('button', { class: 'boton', onclick: () => accionCuadros() });
  const pintarBotonCuadros = () => {
    const total = IA.cuadrosDe(doc).length, pend = IA.cuadrosSinInterpretar(doc).length;
    btnCuadros.hidden = !total;
    btnCuadros.textContent = pend ? `▦ Interpretar cuadros (${pend})` : `▦ Cuadros interpretados (${total})`;
    btnCuadros.disabled = !pend;
  };
  pintarBotonCuadros();
  botones.append(
    h('button', { class: 'boton', onclick: () => accionResumen() }, '📝 Resumir'),
    h('button', { class: 'boton', onclick: () => accionPreguntas() }, '🗂 Preguntas de repaso'),
    btnCuadros);

  dialogo({
    titulo: 'Asistente de estudio',
    contenido: h('div', { class: 'panel-ia' },
      h('p', { class: 'nota-suave' }, `IA dentro de tu equipo · modelo ${m.nombre}. Puede equivocarse: verifica con el texto.`),
      botones,
      h('div', { class: 'fila-pregunta' }, campo, h('button', { class: 'boton primario', onclick: () => accionPreguntar() }, 'Preguntar')),
      barra, estado, salida, pie),
    botones: [{ texto: 'Cerrar', valor: null }],
  }).then(() => detener());
  // Mostrar el resumen guardado si existe
  const previo = await IA.resultadoGuardado(doc.id, 'resumen');
  if (previo && !salida.childNodes.length) { estado.textContent = 'Último resumen guardado:'; mostrarResumen(previo.valor, true); }
}

// Explicar un párrafo (desde el menú del párrafo)
export async function explicarConIA(idx) {
  const doc = ctx.doc;
  const p = doc.paragraphs[idx];
  if (!(await asegurarModelo())) return;
  const salida = h('div', { class: 'ia-salida', 'aria-live': 'polite' }, h('p', { class: 'nota-suave' }, 'Cargando la IA…'));
  const pie = h('div', { class: 'ia-acciones-resultado' });
  const abort = new AbortController();
  dialogo({
    titulo: 'Explicación',
    contenido: h('div', { class: 'panel-ia' }, h('blockquote', { class: 'cita-previa' }, p.text.length > 260 ? p.text.slice(0, 260) + '…' : p.text), salida, pie),
    botones: [{ texto: 'Cerrar', valor: null }],
  }).then(() => abort.abort());
  try {
    await IA.prepararIA((r) => { salida.innerHTML = ''; salida.append(h('p', { class: 'nota-suave' }, `${r.texto} ${Math.round(r.fraccion * 100)} %`)); });
    const texto = await IA.explicarParrafo(doc, idx, { signal: abort.signal, onTexto: (t) => { salida.innerHTML = ''; salida.append(textoAHtml(t)); } });
    pie.append(h('button', { class: 'boton pequeno', onclick: () => guardarNota(doc, texto, 'Explicación', p.id, p.page) }, 'Guardar en notas'));
  } catch (e) {
    if (e.name !== 'AbortError') { salida.innerHTML = ''; salida.append(h('p', { class: 'nota-error' }, e.message)); }
  }
}

// ---------- Sección de Ajustes ----------
export async function seccionIA() {
  const cont = h('div', {});
  const s = await IA.soporteIA();
  cont.append(h('p', { class: 'nota-suave' }, 'Resúmenes, preguntas de repaso, respuestas sobre el texto y explicaciones, hechos por un modelo de IA que funciona dentro de tu equipo: sin internet después de la descarga, sin costo y sin enviar tus textos a ningún servidor. Es más limitado que una IA en la nube: verifica lo importante.'));
  if (!s.ok) { cont.append(h('div', { class: 'aviso-ocr falta' }, s.motivo)); return cont; }
  cont.append(h('h3', {}, 'Modelo'));
  const lista = h('div', { class: 'lista-voces', role: 'radiogroup', 'aria-label': 'Modelo de IA' });
  const estado = h('p', { class: 'nota-suave', 'aria-live': 'polite' });
  const acciones = h('div', { class: 'fila-botones' });
  const pintar = async () => {
    lista.innerHTML = '';
    for (const m of IA.MODELOS_IA) {
      const activo = IA.modeloElegido().id === m.id;
      const listo = await IA.modeloDescargado(m);
      lista.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(activo), class: 'voz voz-ia' + (activo ? ' activa' : ''), onclick: async () => { await IA.elegirModelo(m.id); pintar(); } },
        h('span', { class: 'voz-info' }, h('span', { class: 'voz-nombre' }, m.nombre), h('span', { class: 'voz-desc' }, m.detalle),
          h('span', { class: 'voz-estado ' + (listo ? 'ok' : '') }, listo ? '✓ Descargado' : 'Sin descargar'))));
    }
    const listo = await IA.modeloDescargado();
    acciones.innerHTML = '';
    acciones.append(
      h('button', { class: 'boton primario', onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try {
          await IA.prepararIA((p) => { estado.textContent = `${p.texto} ${Math.round(p.fraccion * 100)} %`; });
          estado.textContent = 'Modelo listo. Midiendo velocidad…';
          const r = await IA.probarVelocidad();
          const tps = Math.max(0.5, r.tokensPorSeg);
          const min = Math.max(1, Math.round((7 * (250 / tps + 1500 / (tps * 8)) + 500 / tps) / 60));
          estado.textContent = `Velocidad: ${tps.toFixed(1).replace('.', ',')} fragmentos de palabra por segundo. Resumir un PDF de 12 páginas tardaría unos ${min} min. Muestra: «${r.texto.slice(0, 160)}…»`;
        } catch (err) { estado.textContent = err.message; }
        pintar();
      } }, listo ? 'Probar velocidad' : 'Descargar y probar'),
      ...(listo ? [h('button', { class: 'boton', onclick: async () => { await IA.borrarModelo(); estado.textContent = 'Modelo borrado del equipo.'; pintar(); } }, 'Borrar modelo')] : []));
  };
  await pintar();
  cont.append(lista, acciones, estado,
    h('p', { class: 'nota-suave' }, `Tarjeta gráfica: ${s.f16 ? 'admite el formato rápido (f16)' : 'formato compatible (f32)'}. Mientras la IA trabaja, la voz se libera de la memoria si no está sonando.`));
  return cont;
}

export function irAjustesIA() { ir('ajustes', { seccion: 'ia' }); }
