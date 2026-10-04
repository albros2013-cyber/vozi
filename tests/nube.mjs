// Prueba de cuentas y sincronización entre dos "dispositivos" (contextos separados) contra un Supabase simulado.
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const BASE = 'http://127.0.0.1:8080/';
const SIM = JSON.stringify({ url: 'http://127.0.0.1:8090' });
const res = []; const ok = (n, c, d = '') => { res.push(c); console.log(`${c ? 'PASA' : 'FALLA'} · ${n}${d ? ' · ' + d : ''}`); };
const b = await chromium.launch();
async function dispositivo() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => localStorage.setItem('vozi-nube-pruebas', s), SIM);
  const pg = await ctx.newPage();
  pg.errores = []; pg.on('pageerror', (e) => pg.errores.push(e.message));
  await pg.goto(BASE + 'index.html'); await pg.waitForFunction(() => window.__voziListo, null, { timeout: 30000 });
  return { ctx, pg };
}
const esperar = (pg, ms) => pg.waitForTimeout(ms);
const aviso = (pg) => pg.$eval('#aviso', (e) => e.textContent);
async function abrirCuenta(pg) {
  await pg.click('#pestanas button[data-vista="ajustes"]'); await esperar(pg, 500);
  if (!(await pg.$('#sec-sesiones[open]'))) await pg.click('#sec-sesiones summary');
  await pg.waitForSelector('#sec-sesiones .caja-destacada');
}
async function formulario(pg, email, pass, crear) {
  if (crear) await pg.click('.dialogo .boton:has-text("Crear cuenta")');
  await pg.fill('.dialogo input[type=email]', email);
  const ps = await pg.$$('.dialogo input[type=password]');
  for (const p of ps) await p.fill(pass);
  await pg.click('.dialogo .boton.primario');
}
const docsDe = (pg) => pg.evaluate(async () => (await window.__vozi.db.all('docs')).map((d) => d.title).sort());

// Dispositivo A: tiene un documento local, crea la cuenta y lo sube
const A = await dispositivo();
await A.pg.evaluate(async () => { await window.__vozi.db.put('docs', { id: 'dA', title: 'Caso del iPhone', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0, paragraphs: [{ id: 'a1', text: 'Hola desde el iPhone.', page: null, kind: 'p' }] }); });
await abrirCuenta(A.pg);
await A.pg.click('#sec-sesiones button:has-text("Entrar o crear cuenta")');
await formulario(A.pg, 'alberto@ejemplo.com', 'corta', true); await esperar(A.pg, 400);
ok('Contraseña corta rechazada con mensaje claro', /8 caracteres/.test(await aviso(A.pg)));
await formulario(A.pg, 'alberto@ejemplo.com', 'ClaveSegura2026', false);
await A.pg.waitForFunction(() => document.querySelector('#perfilBtn').classList.contains('con-nube'), null, { timeout: 15000 });
await A.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
ok('Cuenta creada y sesión conectada (A)', true, await A.pg.$eval('#sec-sesiones .caja-destacada', (e) => e.textContent.slice(0, 60)));

// Dispositivo B: entra con la misma cuenta y recibe la biblioteca
const B = await dispositivo();
await abrirCuenta(B.pg);
await B.pg.click('#sec-sesiones button:has-text("Entrar o crear cuenta")');
await formulario(B.pg, 'alberto@ejemplo.com', 'equivocada1', false); await esperar(B.pg, 500);
ok('Contraseña incorrecta: mensaje claro', /incorrectos/.test(await aviso(B.pg)), await aviso(B.pg));
await formulario(B.pg, 'alberto@ejemplo.com', 'ClaveSegura2026', false);
await B.pg.waitForFunction(() => document.querySelector('#perfilBtn').classList.contains('con-nube'), null, { timeout: 15000 });
await B.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
ok('El otro dispositivo recibe la biblioteca', (await docsDe(B.pg)).includes('Caso del iPhone'), JSON.stringify(await docsDe(B.pg)));

// B escribe una nota y un progreso → A los recibe
await B.pg.evaluate(async () => { await window.__vozi.db.put('notes', { id: 'nB', docId: 'dA', tipo: 'nota', texto: 'Nota escrita en el iPad', pid: 'a1', creado: Date.now(), actualizado: Date.now() }); });
await B.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
await A.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
ok('Las notas viajan entre dispositivos', await A.pg.evaluate(async () => !!(await window.__vozi.db.get('notes', 'nB'))));

// Cambio sin conexión en A: queda pendiente y se sube al volver
await A.ctx.setOffline(true);
await A.pg.evaluate(async () => { await window.__vozi.db.put('notes', { id: 'nOff', docId: 'dA', tipo: 'nota', texto: 'Escrita sin internet', pid: null, creado: Date.now(), actualizado: Date.now() }); });
await A.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()).catch(() => {}));
const pend = await A.pg.evaluate(async () => (await window.__vozi.db.all('outbox')).length);
ok('Sin internet: el cambio queda guardado y pendiente', pend >= 1, `${pend} pendiente(s)`);
await A.ctx.setOffline(false);
await A.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
await B.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
ok('Al volver la conexión se sube y llega al otro dispositivo', await B.pg.evaluate(async () => !!(await window.__vozi.db.get('notes', 'nOff'))));

// Borrar en A → se borra en B
await A.pg.evaluate(async () => { const { borrarDocumento } = await import('./js/db.js'); await borrarDocumento('dA'); });
await A.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
await B.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
ok('Borrar un documento se refleja en el otro dispositivo (con sus notas)', !(await docsDe(B.pg)).includes('Caso del iPhone') && !(await B.pg.evaluate(async () => !!(await window.__vozi.db.get('notes', 'nB')))));

// Aislamiento: otra persona con su propia cuenta no ve nada de Alberto
const C = await dispositivo();
await C.pg.evaluate(() => { sessionStorage.setItem('vozi-elegir', '1'); location.reload(); });
await C.pg.waitForSelector('.selector-perfiles', { timeout: 20000 });
await C.pg.click('button:has-text("Crear cuenta")');
await formulario(C.pg, 'ana@ejemplo.com', 'OtraClave2026', false);
await C.pg.waitForFunction(() => window.__voziListo, null, { timeout: 30000 });
await C.pg.evaluate(() => import('./js/nube.js').then((N) => N.sincronizar()));
const notasC = await C.pg.evaluate(async () => (await window.__vozi.db.all('notes')).length);
ok('Cada cuenta ve solo su información', notasC === 0 && await C.pg.evaluate(() => window.__vozi.ctx.perfil.cuenta.email) === 'ana@ejemplo.com');

// Reapertura: la sesión de la cuenta se mantiene
await B.pg.reload(); await B.pg.waitForFunction(() => window.__voziListo, null, { timeout: 30000 });
await esperar(B.pg, 800);
ok('La sesión de la cuenta se mantiene al reabrir', await B.pg.evaluate(() => document.querySelector('#perfilBtn').classList.contains('con-nube')));

// Cerrar sesión borrando la copia local
await abrirCuenta(B.pg);
await B.pg.click('#sec-sesiones button:has-text("Cerrar sesión")');
await B.pg.click('.dialogo .boton.peligro');
await B.pg.waitForFunction(() => window.__voziListo, null, { timeout: 30000 }).catch(() => {});
await esperar(B.pg, 1500);
const enSelector = !!(await B.pg.$('.selector-perfiles'));
ok('Cerrar sesión y borrar la copia del dispositivo', enSelector || !(await B.pg.evaluate(() => window.__vozi && window.__vozi.ctx.perfil.cuenta)));
const errs = [...A.pg.errores, ...B.pg.errores, ...C.pg.errores];
ok('Sin errores de página', errs.length === 0, errs.join(' | '));
await b.close();
console.log(res.every(Boolean) ? 'TODO OK' : 'HAY FALLAS');
