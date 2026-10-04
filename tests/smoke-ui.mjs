import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pg = await ctx.newPage();
const errs = [];
pg.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await pg.goto('http://127.0.0.1:8080/index.html');
await pg.waitForFunction(() => window.__voziListo, null, { timeout: 30000 });
await pg.screenshot({ path: '/tmp/s-biblioteca.png' });
for (const v of ['importar', 'ajustes', 'estudiar']) {
  await pg.click(`#pestanas button[data-vista="${v}"]`);
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: `/tmp/s-${v}.png`, fullPage: false });
}
console.log(errs.join('\n') || 'sin errores');
await b.close();
