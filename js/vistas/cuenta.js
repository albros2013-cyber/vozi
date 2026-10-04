// VOZI — Pantallas de cuenta: entrar, crear cuenta, recuperar contraseña y estado de sincronización.
import { h, aviso, dialogo, confirmar, fecha } from '../ui.js';
import * as N from '../nube.js';

// Devuelve una sesión ({access, refresh, usuario}) o null si el usuario cancela
export async function dialogoCuenta(modo = 'entrar') {
  while (true) {
    const email = h('input', { class: 'campo', type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'tu@correo.com' });
    const pass = h('input', { class: 'campo', type: 'password', autocomplete: modo === 'crear' ? 'new-password' : 'current-password', placeholder: modo === 'crear' ? 'Mínimo 8 caracteres' : 'Contraseña' });
    const pass2 = modo === 'crear' ? h('input', { class: 'campo', type: 'password', autocomplete: 'new-password', placeholder: 'Repite la contraseña' }) : null;
    const r = await dialogo({
      titulo: modo === 'crear' ? 'Crear cuenta' : 'Entrar con tu cuenta',
      contenido: h('div', {},
        h('p', { class: 'nota-suave' }, modo === 'crear'
          ? 'Con una cuenta, tu biblioteca, notas, citas, tarjetas, marcadores y progreso se guardan en la nube y se sincronizan entre tus dispositivos. Las voces y el audio se generan en cada dispositivo.'
          : 'Entra para ver tu biblioteca y tus notas en este dispositivo.'),
        h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Correo'), email),
        h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Contraseña'), pass),
        pass2 ? h('label', { class: 'etiqueta-campo' }, h('span', {}, 'Repetir contraseña'), pass2) : null),
      botones: [
        { texto: 'Cancelar', valor: null },
        modo === 'entrar' ? { texto: '¿Olvidaste la contraseña?', valor: 'olvido' } : null,
        { texto: modo === 'crear' ? 'Ya tengo cuenta' : 'Crear cuenta', valor: 'cambiar' },
        { texto: modo === 'crear' ? 'Crear cuenta' : 'Entrar', valor: () => ({ e: email.value.trim().toLowerCase(), p: pass.value, p2: pass2 && pass2.value }), clase: 'primario' },
      ].filter(Boolean),
    });
    if (r == null) return null;
    if (r === 'cambiar') { modo = modo === 'crear' ? 'entrar' : 'crear'; continue; }
    if (r === 'olvido') { await dialogoOlvido(); continue; }
    if (!/^\S+@\S+\.\S+$/.test(r.e)) { aviso('Escribe un correo válido.', { tipo: 'error' }); continue; }
    if (modo === 'crear') {
      if (r.p.length < 8) { aviso('La contraseña debe tener al menos 8 caracteres.', { tipo: 'error' }); continue; }
      if (r.p !== r.p2) { aviso('Las contraseñas no coinciden.', { tipo: 'error' }); continue; }
      try {
        const res = await N.registrar(r.e, r.p);
        if (res.sesion) return res.sesion;
        await dialogo({
          titulo: 'Confirma tu correo',
          contenido: h('div', {}, h('p', {}, `Te enviamos un correo a ${r.e}. Abre el enlace para confirmar tu cuenta.`),
            h('p', { class: 'nota-suave' }, 'Después vuelve a VOZI y entra con tu correo y contraseña. Si no lo ves, revisa la carpeta de correo no deseado.')),
          botones: [{ texto: 'Entendido', valor: true, clase: 'primario' }],
        });
        modo = 'entrar';
        continue;
      } catch (e) { aviso(e.message, { tipo: 'error', ms: 7000 }); continue; }
    }
    try { return await N.entrar(r.e, r.p); } catch (e) { aviso(e.message, { tipo: 'error', ms: 7000 }); }
  }
}

async function dialogoOlvido() {
  const email = h('input', { class: 'campo', type: 'email', autocomplete: 'email', placeholder: 'tu@correo.com' });
  const r = await dialogo({
    titulo: 'Recuperar contraseña',
    contenido: h('div', {}, h('p', { class: 'nota-suave' }, 'Te enviaremos un enlace para crear una contraseña nueva.'), email),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Enviar enlace', valor: () => email.value.trim(), clase: 'primario' }],
  });
  if (!r) return;
  try { await N.recuperar(r); aviso('Listo: revisa tu correo y abre el enlace.', { ms: 7000 }); } catch (e) { aviso(e.message, { tipo: 'error', ms: 7000 }); }
}

// Pantalla que aparece al abrir el enlace de «nueva contraseña» del correo
export async function dialogoNuevaPassword(token) {
  while (true) {
    const p1 = h('input', { class: 'campo', type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo 8 caracteres' });
    const p2 = h('input', { class: 'campo', type: 'password', autocomplete: 'new-password', placeholder: 'Repite la contraseña' });
    const r = await dialogo({
      titulo: 'Crea tu nueva contraseña',
      contenido: h('div', {}, p1, h('div', { style: { height: '10px' } }), p2),
      botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', valor: () => [p1.value, p2.value], clase: 'primario' }],
    });
    if (!r) return false;
    if (r[0].length < 8) { aviso('Usa al menos 8 caracteres.', { tipo: 'error' }); continue; }
    if (r[0] !== r[1]) { aviso('Las contraseñas no coinciden.', { tipo: 'error' }); continue; }
    try { await N.cambiarPassword(r[0], token); aviso('Contraseña actualizada. Ya puedes entrar con ella.', { ms: 6000 }); return true; } catch (e) { aviso(e.message, { tipo: 'error', ms: 7000 }); }
  }
}

export function textoEstadoSync(s) {
  if (s.sincronizando) return 'Sincronizando…';
  if (s.error) return 'Pendiente: ' + s.error;
  if (s.pendientes) return `${s.pendientes} cambio(s) por subir`;
  if (s.ultima) return 'Sincronizado ' + tiempoRelativo(s.ultima);
  return 'Aún no se ha sincronizado';
}

function tiempoRelativo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return 'el ' + fecha(ts);
}
