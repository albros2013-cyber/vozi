import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const OUT = '/home/claude/vozi/tests/out/';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function sesion(nombre, opts) {
  const ctx = await b.newContext(opts);
  const pg = await ctx.newPage();
  await pg.goto('http://127.0.0.1:8080/index.html');
  await pg.waitForFunction(() => window.__voziListo);
  return { ctx, pg };
}
const { ctx, pg } = await sesion('iphone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// recursos
await pg.click('#pestanas button[data-vista="ajustes"]'); await pg.waitForTimeout(500);
await pg.click('#sec-recursos summary'); await pg.waitForSelector('#sec-recursos .caja-destacada');
await pg.screenshot({ path: OUT + 'c-recursos-antes.png' });
const bt = await pg.$('#sec-recursos .caja-destacada button'); await bt.click();
await pg.waitForSelector('#sec-recursos .caja-destacada.ok', { timeout: 300000 });
await pg.screenshot({ path: OUT + 'c-recursos.png' });
// documento
await pg.evaluate(async () => {
  const { db } = window.__vozi;
  const pars = [
    ['Capítulo 3. La toma de decisiones', 'h', 12], ['¿Por qué algunas organizaciones aprenden más rápido que otras? La respuesta, según la literatura, no está en la cantidad de información disponible, sino en la calidad de las conversaciones que la interpretan.', 'p', 12],
    ['En 2024, un estudio con 1.200 empresas latinoamericanas encontró que las que revisaban sus supuestos cada trimestre crecieron 2,3 veces más que el promedio del sector.', 'p', 12],
    ['Sin embargo, el mismo estudio advierte: revisar no es lo mismo que cambiar. Muchas juntas directivas dedican horas a analizar datos y, al final, mantienen las decisiones de siempre.', 'p', 13],
    ['Para el caso de esta semana, identifique tres supuestos que la empresa nunca ha cuestionado y proponga cómo ponerlos a prueba con un experimento de bajo costo.', 'p', 13],
    ['Las preguntas guía son las siguientes. ¿Qué evidencia respaldaría cada supuesto? ¿Quién debería participar en la decisión? ¿Cuánto costaría equivocarse?', 'p', 13]];
  await db.put('docs', { id: 'dcap', title: 'Gestión estratégica — Capítulo 3', createdAt: Date.now() - 86400000, updatedAt: Date.now(), source: { type: 'pdf' }, pages: 48,
    paragraphs: pars.map(([t, k, pg], i) => ({ id: 'c' + i, text: t, kind: k, page: pg })), progresoPct: 35, ultimaLectura: Date.now() });
  await db.put('docs', { id: 'dfoto', title: 'Apuntes de clase (foto)', createdAt: Date.now() - 3 * 86400000, updatedAt: Date.now() - 86400000, source: { type: 'foto' }, pages: 1,
    paragraphs: [{ id: 'f1', text: 'Texto de ejemplo reconocido.', kind: 'p', page: 1, ocr: true }], progresoPct: 100 });
  await db.put('notes', { id: 'n1', docId: 'dcap', tipo: 'cita', cita: 'revisar no es lo mismo que cambiar', texto: 'Idea clave para el ensayo.', pid: 'c3', page: 13, creado: Date.now(), actualizado: Date.now() });
  await db.put('notes', { id: 'n2', docId: 'dcap', tipo: 'nota', texto: 'Comparar con el caso de la semana pasada.', pid: 'c4', page: 13, creado: Date.now(), actualizado: Date.now() });
});
await pg.reload(); await pg.waitForFunction(() => window.__voziListo);
await pg.click('#pestanas button[data-vista="biblioteca"]'); await pg.waitForTimeout(600);
await pg.screenshot({ path: OUT + 'c-biblioteca.png' });
await pg.click('.doc-abrir:has-text("Gestión")'); await pg.waitForSelector('.texto-lectura');
await pg.evaluate(() => { window.__vozi.L.escucharDesde(1); });
await pg.waitForFunction(() => document.querySelector('#repEstado').textContent.includes('Preparando'), null, { timeout: 120000 });
await pg.waitForTimeout(3000);
await pg.screenshot({ path: OUT + 'c-preparando.png' });
await pg.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo && window.__vozi.ctx.rep.tiempo > 13, null, { timeout: 600000 });
await pg.screenshot({ path: OUT + 'c-lectura.png' });
await pg.evaluate(() => window.__vozi.ctx.rep.pausar());
await pg.click('.parrafo[data-idx="3"]'); await pg.waitForTimeout(400);
await pg.screenshot({ path: OUT + 'c-menu-parrafo.png' });
await pg.keyboard.press('Escape');
await pg.click('#pestanas button[data-vista="estudiar"]'); await pg.waitForTimeout(700);
await pg.screenshot({ path: OUT + 'c-estudiar.png' });
await pg.click('#pestanas button[data-vista="importar"]'); await pg.waitForTimeout(700);
await pg.screenshot({ path: OUT + 'c-importar.png' });
// Oscuro
await pg.emulateMedia({ colorScheme: 'dark' });
await pg.click('#pestanas button[data-vista="leer"]'); await pg.waitForTimeout(900);
await pg.screenshot({ path: OUT + 'c-lectura-oscuro.png' });
// iPad horizontal (mismo almacenamiento: misma sesión, ventana nueva)
const ipad = await ctx.newPage();
await ipad.setViewportSize({ width: 1180, height: 820 });
await ipad.goto('http://127.0.0.1:8080/index.html'); await ipad.waitForFunction(() => window.__voziListo);
await ipad.click('#pestanas button[data-vista="leer"]'); await ipad.waitForTimeout(1200);
await ipad.screenshot({ path: OUT + 'c-ipad.png' });
await b.close();
console.log('ok');
