// VOZI — Utilidades de interfaz.

export function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let avisoTimer = null;
export function aviso(texto, { tipo = 'info', ms = 3800 } = {}) {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.dataset.tipo = tipo;
  el.classList.add('visible');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => el.classList.remove('visible'), ms);
}

// Diálogo modal accesible. contenido: Node; botones: [{texto, valor, clase}]
export function dialogo({ titulo, contenido, botones = [{ texto: 'Aceptar', valor: true, clase: 'primario' }], cerrable = true }) {
  const dlg = document.getElementById('dialogo');
  dlg.innerHTML = '';
  return new Promise((resolve) => {
    const cerrar = (v) => { dlg.close(); resolve(v); };
    const caja = h('form', { method: 'dialog', class: 'dialogo-caja', onsubmit: (e) => e.preventDefault() },
      titulo ? h('h2', { class: 'dialogo-titulo' }, titulo) : null,
      h('div', { class: 'dialogo-cuerpo' }, contenido),
      h('div', { class: 'dialogo-botones' }, botones.map((b) => h('button', {
        type: 'button', class: 'boton ' + (b.clase || ''), onclick: () => cerrar(typeof b.valor === 'function' ? b.valor() : b.valor),
      }, b.texto))));
    dlg.append(caja);
    dlg.oncancel = (e) => { if (!cerrable) e.preventDefault(); else resolve(null); };
    dlg.showModal();
    const foco = dlg.querySelector('input, textarea, select') || dlg.querySelector('.boton.primario');
    if (foco) setTimeout(() => foco.focus(), 30);
  });
}

export async function confirmar(texto, { si = 'Sí', no = 'Cancelar', peligro = false, titulo = null } = {}) {
  return !!(await dialogo({ titulo, contenido: h('p', {}, texto), botones: [{ texto: no, valor: false }, { texto: si, valor: true, clase: peligro ? 'peligro' : 'primario' }] }));
}

export async function pedirTexto(titulo, { valor = '', etiqueta = '', tipo = 'text', multilinea = false, placeholder = '' } = {}) {
  const campo = multilinea
    ? h('textarea', { class: 'campo', rows: 6, placeholder }, valor)
    : h('input', { class: 'campo', type: tipo, value: valor, placeholder, autocomplete: tipo === 'password' ? 'off' : null });
  const r = await dialogo({
    titulo,
    contenido: h('label', { class: 'etiqueta-campo' }, etiqueta ? h('span', {}, etiqueta) : null, campo),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Aceptar', valor: () => campo.value, clase: 'primario' }],
  });
  return r;
}

export function formatoTiempo(seg) {
  if (!isFinite(seg) || seg < 0) seg = 0;
  const m = Math.floor(seg / 60), s = Math.floor(seg % 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatoRestante(seg) {
  if (seg == null || !isFinite(seg)) return 'calculando…';
  if (seg < 50) return 'menos de un minuto';
  const m = Math.round(seg / 60);
  if (m >= 90) return `alrededor de ${duracionCorta(seg)}`;
  return m === 1 ? 'alrededor de 1 minuto' : `alrededor de ${m} minutos`;
}

// «45 min», «2 h 10 min»
export function duracionCorta(seg) {
  const m = Math.max(1, Math.round(seg / 60));
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

export function fecha(ts) {
  return new Date(ts).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function descargarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Compartir (iOS: hoja de compartir permite "Guardar en Archivos"); si no, descarga
export async function compartirODescargar(blob, nombre, titulo) {
  const file = new File([blob], nombre, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: titulo || nombre }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  descargarArchivo(blob, nombre);
}

export function elegirArchivo({ accept = '', multiple = false, capture = null } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, capture, style: { display: 'none' } });
    document.body.append(inp);
    inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); }, { once: true });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); }, { once: true });
    inp.click();
  });
}

export function escapar(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export const ICONOS = {
  marcador: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12v17l-6-4-6 4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  buscar: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  texto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 9 6l5 12M5.8 14h6.4M15 18l3-7.5 3 7.5M15.8 16h4.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  foco: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  paginas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h8l4 4v13H7zM15 3.5v4h4M4 7v13.5h11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  editar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  reloj: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 9v4l2.5 2M9.5 2.8h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  nota: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v11l-5 5H5zM14 20v-5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  cerrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  volver: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function icono(nombre) { const s = h('span', { class: 'icono', html: ICONOS[nombre] }); return s; }
