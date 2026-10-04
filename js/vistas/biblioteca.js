// VOZI — Biblioteca de lecturas guardadas.
import { ctx } from '../estado.js';
import { db, borrarDocumento , listarDocs } from '../db.js';
import { h, fecha, confirmar, pedirTexto, aviso } from '../ui.js';
import { ir, abrirDocumento } from '../app.js';
import { soltarDocumento } from '../lectura.js';

export async function vistaBiblioteca(main) {
  document.getElementById('cabeceraTitulo').textContent = 'Biblioteca';
  const docs = await listarDocs();
  docs.sort((a, b) => (b.ultimaLectura || b.updatedAt || 0) - (a.ultimaLectura || a.updatedAt || 0));
  const audios = await db.all('audio');
  const audioPorDoc = new Map();
  for (const a of audios) audioPorDoc.set(a.docId, (audioPorDoc.get(a.docId) || 0) + a.duracion);

  const cont = h('section', { class: 'vista vista-biblioteca' });
  if (!docs.length) {
    cont.append(h('div', { class: 'bienvenida' },
      h('h1', {}, 'Escucha tus materiales de estudio'),
      h('p', {}, 'Importa un PDF, un documento de Word, una foto o pega un texto. VOZI lo lee en voz alta con una voz natural, mientras sigues el texto y tomas notas.'),
      h('ol', { class: 'pasos' },
        h('li', {}, h('strong', {}, 'Descarga una voz'), ' en Ajustes (una sola vez, funciona sin conexión).'),
        h('li', {}, h('strong', {}, 'Importa'), ' tu material.'),
        h('li', {}, h('strong', {}, 'Escucha'), ': VOZI prepara tramos de audio continuos y recuerda dónde te quedaste.')),
      h('div', { class: 'fila-botones' },
        h('button', { class: 'boton primario grande', onclick: () => ir('importar') }, 'Importar material'),
        h('button', { class: 'boton grande', onclick: () => ir('ajustes', { seccion: 'voz' }) }, 'Elegir y descargar voz'))));
    main.append(cont);
    return;
  }
  const buscador = h('input', { class: 'campo buscador', type: 'search', placeholder: 'Buscar en la biblioteca', 'aria-label': 'Buscar en la biblioteca' });
  const lista = h('ul', { class: 'lista-docs', role: 'list' });
  const pintar = () => {
    const q = buscador.value.trim().toLowerCase();
    lista.innerHTML = '';
    for (const d of docs) {
      if (q && !d.title.toLowerCase().includes(q)) continue;
      const pct = d.progresoPct || 0;
      const min = audioPorDoc.get(d.id);
      const actual = ctx.doc && ctx.doc.id === d.id;
      lista.append(h('li', { class: 'tarjeta-doc' + (actual ? ' actual' : '') },
        h('button', { class: 'doc-abrir', onclick: () => abrirDocumento(d.id), 'aria-label': `Abrir ${d.title}` },
          h('span', { class: 'doc-tipo', 'aria-hidden': 'true' }, (d.source && d.source.type || 'txt').toUpperCase()),
          h('span', { class: 'doc-info' },
            h('span', { class: 'doc-titulo' }, d.title),
            h('span', { class: 'doc-meta' },
              [d.pages ? `${d.pages} pág.` : null, `${d.npar} párrafos`, d.ultimaLectura ? `leído ${fecha(d.ultimaLectura)}` : `añadido ${fecha(d.createdAt)}`,
                min ? `${Math.round(min / 60)} min de audio guardado` : null].filter(Boolean).join(' · ')),
            h('span', { class: 'progreso', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `Avance ${pct} %` },
              h('span', { style: { width: pct + '%' } })))),
        h('button', { class: 'boton-icono', 'aria-label': `Opciones de ${d.title}`, onclick: () => opcionesDoc(d) }, '⋯')));
    }
    if (!lista.children.length) lista.append(h('li', { class: 'vacio' }, 'Sin resultados.'));
  };
  buscador.addEventListener('input', pintar);
  pintar();
  cont.append(
    h('div', { class: 'barra-vista' }, buscador, h('button', { class: 'boton primario', onclick: () => ir('importar') }, '+ Importar')),
    lista,
    h('p', { class: 'nota-suave' }, ctx.perfil && ctx.perfil.cuenta && ctx.perfil.conectada
      ? 'Tus documentos, notas y avance se guardan en este dispositivo y en tu cuenta. El audio preparado queda solo en este dispositivo.'
      : 'Todo se guarda solo en este dispositivo. Borrar los datos del navegador o de la app eliminaría tus lecturas: usa Ajustes → Copia de seguridad.'));
  main.append(cont);

  async function opcionesDoc(meta) {
    const d = await db.get('docs', meta.id);
    if (!d) return;
    const { dialogo } = await import('../ui.js');
    const r = await dialogo({
      titulo: d.title,
      contenido: h('p', { class: 'nota-suave' }, 'Elige una acción.'),
      botones: [
        { texto: 'Renombrar', valor: 'renombrar' },
        { texto: 'Idioma', valor: 'idioma' },
        { texto: 'Borrar audios', valor: 'audios' },
        { texto: 'Eliminar', valor: 'eliminar', clase: 'peligro' },
        { texto: 'Cerrar', valor: null },
      ],
    });
    if (r === 'renombrar') {
      const t = await pedirTexto('Nuevo nombre', { valor: d.title });
      if (t && t.trim()) { d.title = t.trim(); d.updatedAt = Date.now(); await db.put('docs', d); if (ctx.doc && ctx.doc.id === d.id) ctx.doc.title = d.title; ir('biblioteca'); }
    } else if (r === 'idioma') {
      const actual = d.idioma || 'auto';
      const v = await dialogo({
        titulo: 'Idioma del documento',
        contenido: h('p', { class: 'nota-suave' }, 'En «Automático», VOZI reconoce el idioma de cada párrafo (español o inglés) y usa la voz correspondiente.'),
        botones: [['auto', 'Automático'], ['es', 'Español'], ['en', 'Inglés']].map(([val, t]) => ({ texto: (val === actual ? '✓ ' : '') + t, valor: val, clase: val === actual ? 'primario' : '' })),
      });
      if (v && v !== actual) {
        d.idioma = v; d.updatedAt = Date.now(); await db.put('docs', d);
        if (ctx.doc && ctx.doc.id === d.id) { ctx.doc.idioma = v; ctx.rep.descargar(); }
        aviso('Idioma actualizado. El audio se preparará de nuevo con la voz correspondiente.');
      }
    } else if (r === 'audios') {
      if (await confirmar('Se borrará el audio preparado de este documento. Podrás volver a prepararlo cuando quieras. Las notas y el texto no se tocan.', { si: 'Borrar audios', peligro: true })) {
        if (ctx.doc && ctx.doc.id === d.id) ctx.rep.descargar();
        const lista = await db.byIndex('audio', 'docId', d.id);
        for (const a of lista) { await db.del('audioBlobs', a.id); await db.del('audio', a.id); }
        aviso('Audios borrados.');
        ir('biblioteca');
      }
    } else if (r === 'eliminar') {
      if (await confirmar(`¿Eliminar «${d.title}» con sus notas, marcadores, tarjetas y audios? Esta acción no se puede deshacer.`, { si: 'Eliminar', peligro: true })) {
        if (ctx.doc && ctx.doc.id === d.id) { soltarDocumento(); ctx.doc = null; }
        await borrarDocumento(d.id);
        aviso('Documento eliminado.');
        ir('biblioteca');
      }
    }
  }
}
