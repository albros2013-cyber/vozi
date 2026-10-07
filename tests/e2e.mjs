// VOZI — Prueba de extremo a extremo en Chromium (Playwright).
// Ejecuta: node tests/e2e.mjs [fase...]   (servidor en http://127.0.0.1:8080)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
const OUT = '/home/claude/vozi/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const FIX = '/home/claude/vozi/tests/fixtures/';
const fases = process.argv.slice(2);
const quiere = (f) => !fases.length || fases.includes(f);
const resultados = [];
const ok = (nombre, cond, detalle = '') => { resultados.push({ nombre, ok: !!cond, detalle }); console.log(`${cond ? 'PASA' : 'FALLA'} · ${nombre}${detalle ? ' · ' + detalle : ''}`); };

const TEXTO = `Capítulo 1. Estrategia comercial

¿Qué factores explican el crecimiento de una empresa en un mercado competitivo? Según el Dr. Pérez, en 2025 las ventas aumentaron 32 % y el margen operativo llegó a 18,5 %, lo que equivale a $1.500.000 por cliente.

Sin embargo, la directora advirtió: ¡no podemos confiarnos! La competencia regional se intensificó durante el segundo semestre del año.

Para el análisis del caso, los estudiantes deberán identificar a los actores principales (p. ej., clientes y proveedores) y justificar cuál alternativa resulta más conveniente antes del 15/11/2026.

Capítulo 2. Indicadores

La tasa de retención de clientes pasó del 71 % al 78 % entre 2023 y 2025. ¿Fue suficiente? Los analistas consideran que sí, aunque recomiendan revisar el costo de adquisición, que subió a $85.000 por cliente.

Finalmente, el informe propone tres acciones: fortalecer la capacitación, simplificar el portafolio y medir cada trimestre la satisfacción de los usuarios. La Sra. Gómez concluyó que la disciplina operativa sería decisiva durante los próximos 18 meses.`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.addInitScript(() => localStorage.setItem('vozi-pruebas-local', '1'));
const page = await context.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

async function abrirApp() {
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => window.__voziListo, null, { timeout: 60000 });
}
async function irA(vista) { await page.click(`#pestanas button[data-vista="${vista}"]`); await page.waitForTimeout(600); }
async function elegir(selectorBoton, archivo) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(selectorBoton)]);
  await fc.setFiles(archivo);
}
const esperar = (ms) => page.waitForTimeout(ms);
async function textoAviso() { return page.$eval('#aviso', (e) => e.textContent); }

await abrirApp();
ok('La app carga sin errores', errores.length === 0, errores.join(' | '));

// 1) Descarga de recursos sin conexión
if (quiere('recursos')) {
  await irA('ajustes');
  await page.click('#sec-recursos summary');
  await page.waitForSelector('#sec-recursos .caja-destacada', { timeout: 30000 });
  const t0 = Date.now();
  const boton = await page.$('#sec-recursos .caja-destacada button');
  if (boton) {
    await boton.click();
    await page.waitForFunction(() => document.querySelector('#sec-recursos .caja-destacada.ok'), null, { timeout: 600000 });
  }
  ok('Descarga explícita de voz, motor y OCR completa', await page.$('#sec-recursos .caja-destacada.ok'), `${Math.round((Date.now() - t0) / 1000)} s`);
  const cacheInfo = await page.evaluate(async () => { const c = await caches.open('vozi-res-v1'); return (await c.keys()).length; });
  ok('Recursos guardados en caché local', cacheInfo > 10, `${cacheInfo} archivos`);
  await page.screenshot({ path: OUT + '/recursos.png' });
}

// 2) Pegar texto y escuchar
let docId = null;
if (quiere('voz')) {
  await irA('importar');
  await page.click('.tarjeta-import:has-text("Pegar texto")');
  await page.fill('.vista-revision textarea', TEXTO);
  await page.fill('.vista-revision input.titulo', 'Prueba de lectura');
  await page.click('button:has-text("Guardar en la biblioteca")');
  await page.waitForSelector('.texto-lectura .parrafo', { timeout: 15000 });
  docId = await page.evaluate(() => window.__vozi.ctx.doc.id);
  const npars = await page.$$eval('.texto-lectura .parrafo', (e) => e.length);
  ok('Texto pegado guardado como documento', npars === 7, `${npars} párrafos`);

  const t0 = Date.now();
  await page.click('#repPlay');
  await page.waitForFunction(() => document.querySelector('#repEstado').textContent.includes('Preparando') || document.querySelector('#repEstado').textContent.includes('Cargando'), null, { timeout: 20000 });
  const progresoVisto = [];
  const tProg = setInterval(async () => { try { progresoVisto.push(await page.$eval('#repEstado', (e) => e.textContent)); } catch { } }, 1500);
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo && window.__vozi.ctx.rep.tiempo > 0.5, null, { timeout: 600000 });
  clearInterval(tProg);
  const prep = (Date.now() - t0) / 1000;
  const info = await page.evaluate(() => ({ dur: window.__vozi.ctx.rep.duracion, n: window.__vozi.ctx.rep.tramo.tiempos.length, sint: window.__vozi.ctx.rep.tramo.segSintesis }));
  ok('Audio real generado y reproduciéndose (voz femenina Valeria)', info.dur > 5, `tramo ${info.dur.toFixed(1)} s, ${info.n} piezas, síntesis ${info.sint.toFixed(1)} s, espera total ${prep.toFixed(1)} s, RTF ${(info.sint / info.dur).toFixed(2)}`);
  ok('Progreso de preparación visible con porcentaje', progresoVisto.some((t) => /\d+ %/.test(t)), progresoVisto.slice(-2).join(' / '));
  await esperar(1500);
  const resalte = await page.evaluate(() => ({ p: !!document.querySelector('.parrafo.actual'), s: !!document.querySelector('.parrafo.actual .oracion.activa'), t: document.querySelector('.parrafo.actual .oracion.activa')?.textContent }));
  ok('Párrafo y oración actuales resaltados durante la reproducción', resalte.p && resalte.s, resalte.t);
  await page.screenshot({ path: OUT + '/lectura.png' });

  // Guardar el WAV para análisis externo (continuidad, ASR, tono)
  const wav = await page.evaluate(async () => {
    const id = window.__vozi.ctx.rep.tramo.id;
    const r = await window.__vozi.db.get('audioBlobs', id);
    const b = new Uint8Array(await r.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
    return { b64: btoa(s), tiempos: window.__vozi.ctx.rep.tramo.tiempos };
  });
  fs.writeFileSync(OUT + '/tramo-valeria.wav', Buffer.from(wav.b64, 'base64'));
  fs.writeFileSync(OUT + '/tramo-valeria.json', JSON.stringify(wav.tiempos, null, 1));

  // Pausa, reanudación y velocidad
  await page.click('#repPlay');
  await esperar(400);
  const t1 = await page.evaluate(() => window.__vozi.ctx.rep.tiempo);
  await esperar(1200);
  const t2 = await page.evaluate(() => window.__vozi.ctx.rep.tiempo);
  ok('Pausa detiene el audio', Math.abs(t2 - t1) < 0.05 && !(await page.evaluate(() => window.__vozi.ctx.rep.reproduciendo)));
  await page.click('#repPlay');
  await esperar(1500);
  const t3 = await page.evaluate(() => window.__vozi.ctx.rep.tiempo);
  ok('Reanudación continúa desde el mismo punto', t3 > t2 && t3 - t2 < 3, `${t2.toFixed(2)} → ${t3.toFixed(2)} s`);
  await page.click('#repVel');
  await page.click('.dialogo .opcion:has-text("1,5×")');
  await esperar(300);
  const vel = await page.evaluate(() => ({ r: window.__vozi.ctx.rep.audio.playbackRate, p: window.__vozi.ctx.rep.audio.preservesPitch }));
  ok('Velocidad 1,5× sin cambiar el tono (preservesPitch)', vel.r === 1.5 && vel.p === true, JSON.stringify(vel));
  const a = await page.evaluate(() => window.__vozi.ctx.rep.tiempo); await esperar(2000);
  const bb = await page.evaluate(() => window.__vozi.ctx.rep.tiempo);
  ok('El audio avanza más rápido a 1,5×', (bb - a) > 2.4, `${(bb - a).toFixed(2)} s en 2 s`);
  // Navegación por oración
  await page.evaluate(() => window.__vozi.ctx.rep.irA(0.2)); await esperar(300);
  const antes = await page.evaluate(() => ({ ...window.__vozi.ctx.rep.posicionActual(), t: window.__vozi.ctx.rep.tramo.id }));
  await page.click('#repAdelante'); await esperar(600);
  const despues = await page.evaluate(() => ({ ...window.__vozi.ctx.rep.posicionActual(), t: window.__vozi.ctx.rep.tramo.id }));
  ok('Navegación a la oración siguiente', despues.idx > antes.idx || despues.t !== antes.t, `${antes.idx} → ${despues.idx}`);
  await page.click('#repVel'); await page.click('.dialogo .opcion:has-text("1×")');

  // Esperar continuidad: debe pasar al siguiente tramo sin intervención
  await page.waitForFunction(() => { const r = window.__vozi.ctx.rep; return r.tramo && r.tramo.inicio > 0 && r.reproduciendo; }, null, { timeout: 600000 }).then(
    () => ok('Continúa automáticamente con el siguiente tramo', true),
    () => ok('Continúa automáticamente con el siguiente tramo', false));
  await page.click('#repPlay'); // pausa
  await esperar(1500);
}

// 3) Cancelación de la preparación
if (quiere('cancelar')) {
  await page.evaluate(() => window.__vozi.ctx.rep.descargar());
  await page.evaluate(async () => { const L = window.__vozi.L; for (const a of await window.__vozi.db.all('audio')) { await window.__vozi.db.del('audio', a.id); } });
  await page.evaluate(() => { window.__vozi.L.escucharDesde(1); });
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => [document.querySelector('#repEstado').textContent, document.querySelector('#aviso').textContent, JSON.stringify(window.__vozi.L.estadoLectura.preparando && { f: window.__vozi.L.estadoLectura.preparando.fase, x: window.__vozi.L.estadoLectura.preparando.fraccion })]);
    if (st[0].includes('Preparando')) break;
    if (i % 4 === 0) console.log('  esperando preparación…', st.join(' | '));
    await esperar(1500);
  }
  await esperar(1500);
  await page.click('#repEstado button:has-text("Cancelar")');
  await page.waitForFunction(() => !window.__vozi.L.estadoLectura.preparando, null, { timeout: 30000 });
  await esperar(500);
  ok('Cancelar la preparación detiene el trabajo y avisa', !(await page.evaluate(() => window.__vozi.ctx.rep.reproduciendo)), await textoAviso());
}

// 4) Punto de lectura y notas tras reabrir
if (quiere('reabrir')) {
  await page.evaluate(() => window.__vozi.L.escucharDesde(2));
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo && window.__vozi.ctx.rep.tiempo > 1, null, { timeout: 600000 });
  await esperar(1500);
  await page.click('#repPlay');
  await esperar(1500);
  const pos = await page.evaluate(() => ({ ...window.__vozi.ctx.rep.posicionActual(), audioId: window.__vozi.ctx.rep.tramo.id }));
  // Nota sobre un párrafo
  await page.click('.texto-lectura .parrafo[data-idx="1"]');
  await page.click('.dialogo .accion:has-text("Escribir una nota")');
  await page.fill('.dialogo textarea', 'Revisar la cifra del margen operativo.');
  await page.click('.dialogo .boton.primario');
  await esperar(500);
  await page.reload();
  await page.waitForFunction(() => window.__voziListo, null, { timeout: 60000 });
  await irA('leer');
  await esperar(1500);
  const rest = await page.evaluate(() => ({ pid: document.querySelector('.parrafo.actual')?.dataset.pid, audio: window.__vozi.ctx.rep.tramo && window.__vozi.ctx.rep.tramo.id, t: window.__vozi.ctx.rep.tiempo }));
  ok('Al reabrir se recupera el párrafo y el audio guardado', rest.pid === pos.pid && rest.audio === pos.audioId, `pid ${rest.pid === pos.pid ? 'igual' : 'distinto'}, tiempo ${rest.t.toFixed(1)} s (guardado ${pos.tiempo.toFixed(1)} s)`);
  await page.click('#repPlay');
  await esperar(1500);
  ok('El audio guardado se reproduce sin volver a sintetizar', await page.evaluate(() => window.__vozi.ctx.rep.reproduciendo && !window.__vozi.L.estadoLectura.preparando));
  await page.click('#repPlay');
  await irA('estudiar');
  await esperar(800);
  const nota = await page.$eval('.lista-notas', (e) => e.textContent).catch(() => '');
  ok('Las notas se recuperan tras recargar', nota.includes('margen operativo'), nota.slice(0, 80));
}

// 5) Voz masculina
if (quiere('masculina')) {
  await irA('ajustes');
  await page.click('label.voz[data-id="st-mateo"]');
  await esperar(500);
  await irA('leer');
  await page.evaluate(() => window.__vozi.L.escucharDesde(1));
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo && window.__vozi.ctx.rep.tiempo > 0.3, null, { timeout: 600000 });
  const wav = await page.evaluate(async () => {
    const r = await window.__vozi.db.get('audioBlobs', window.__vozi.ctx.rep.tramo.id);
    const b = new Uint8Array(await r.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
    return btoa(s);
  });
  fs.writeFileSync(OUT + '/tramo-mateo.wav', Buffer.from(wav, 'base64'));
  ok('Audio real con voz masculina (Mateo) generado', fs.statSync(OUT + '/tramo-mateo.wav').size > 100000);
  await page.click('#repPlay');
  await irA('ajustes'); await page.click('label.voz[data-id="st-valeria"]'); await esperar(300);
}

// 5b) Preparación rápida con 2 procesos
if (quiere('rapida')) {
  for (const n of [1, 2, 3]) {
    await page.evaluate(async (n) => {
      const { ctx, db } = window.__vozi;
      ctx.ajustes.paralelo = n; ctx.ajustes.primerTramoCorto = false; ctx.ajustes.tramoMin = 1; ctx.motor.terminar(); ctx.rep.descargar();
      for (const a of await db.all('audio')) { await db.del('audio', a.id); await db.del('audioBlobs', a.id); }
      if (!ctx.doc) {
        await db.put('docs', { id: 'drap', title: 'Rápida', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0,
          paragraphs: Array.from({ length: 6 }, (_, i) => ({ id: 'q' + i, text: 'La competencia regional se intensificó durante el segundo semestre, y las ventajas obtenidas podían desaparecer con rapidez si no se invertía en innovación. ¿Qué harían los directivos?', page: null, kind: 'p' })) });
        ctx.doc = await db.get('docs', 'drap');
      }
      window.__vozi.L.escucharDesde(0);
    }, n);
    await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo, null, { timeout: 600000 });
    const r = await page.evaluate(() => ({ s: window.__vozi.ctx.rep.tramo.segSintesis, d: window.__vozi.ctx.rep.tramo.duracion, n: window.__vozi.ctx.motor.procesos.length }));
    ok(`Preparación con ${n} proceso(s)`, r.d > 10 && r.n === n, `${r.d.toFixed(1)} s de audio en ${r.s.toFixed(1)} s (factor ${(r.s / r.d).toFixed(2)})`);
    await page.evaluate(() => window.__vozi.ctx.rep.pausar());
  }
}

// 5c) Sesiones de usuario independientes
if (fases.includes('sesiones-locales')) { // reemplazado por las cuentas (tests/nube.mjs)
  await page.evaluate(async () => { await window.__vozi.db.put('docs', { id: 'dyo', title: 'Documento de Yo', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0, paragraphs: [{ id: 'y1', text: 'Hola.', page: null, kind: 'p' }] }); });
  await irA('ajustes');
  await page.click('#sec-sesiones summary');
  await page.screenshot({ path: OUT + '/sesiones-antes.png' });
  await page.click('#sec-sesiones button:has-text("Añadir persona")');
  await page.fill('.dialogo input:not(.pin)', 'Ana');
  await page.fill('.dialogo input.pin', '1234');
  await page.click('.dialogo .boton.primario');
  await esperar(600);
  await page.click('#sec-sesiones button:has-text("Cambiar")');
  await page.waitForSelector('.selector-perfiles', { timeout: 20000 });
  await page.click('.perfil:has-text("Ana")');
  await page.fill('.dialogo input.pin', '9999'); await page.click('.dialogo .boton.primario'); await esperar(500);
  ok('PIN incorrecto rechazado', /incorrecto/i.test(await textoAviso()) && await page.$('.selector-perfiles'));
  await page.click('.perfil:has-text("Ana")');
  await page.fill('.dialogo input.pin', '1234'); await page.click('.dialogo .boton.primario');
  await page.waitForFunction(() => window.__voziListo, null, { timeout: 30000 });
  const docsAna = await page.evaluate(async () => (await window.__vozi.db.all('docs')).map((d) => d.title));
  ok('La sesión nueva empieza con su propia biblioteca vacía', docsAna.length === 0, JSON.stringify(docsAna));
  await page.evaluate(async () => { await window.__vozi.db.put('docs', { id: 'dana', title: 'Documento de Ana', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0, paragraphs: [{ id: 'a1', text: 'Hola Ana.', page: null, kind: 'p' }] }); });
  await page.click('#perfilBtn'); await page.click('.dialogo .boton.primario:has-text("Cambiar de persona")');
  await page.waitForSelector('.selector-perfiles', { timeout: 20000 });
  await page.click('.perfil:has-text("Yo")');
  await page.waitForFunction(() => window.__voziListo, null, { timeout: 30000 });
  const docsYo = await page.evaluate(async () => (await window.__vozi.db.all('docs')).map((d) => d.title));
  ok('Cada sesión ve solo su información', docsYo.includes('Documento de Yo') && !docsYo.includes('Documento de Ana'), JSON.stringify(docsYo));
  await page.reload(); await page.waitForFunction(() => window.__voziListo, null, { timeout: 30000 });
  ok('Al reabrir sigue en la última sesión sin PIN', await page.evaluate(() => window.__vozi.ctx.perfil.nombre) === 'Yo');
  const voces = await page.evaluate(async () => (await (await caches.open('vozi-res-v1')).keys()).length);
  ok('Las voces descargadas se comparten entre sesiones', voces > 10, `${voces} archivos`);
}

// 6) Importaciones
async function importarArchivo(ruta) {
  await irA('importar');
  await elegir('.tarjeta-import:has-text("Archivo")', ruta);
}
if (quiere('pdf')) {
  await importarArchivo(FIX + 'digital.pdf');
  await page.waitForSelector('button:has-text("Importar")', { timeout: 30000 });
  await page.click('.vista button.primario:has-text("Importar")');
  await page.waitForSelector('.vista-revision', { timeout: 120000 });
  const txt = await page.$$eval('.vista-revision textarea', (t) => t.map((x) => x.value).join('\n\n'));
  fs.writeFileSync(OUT + '/pdf-digital.txt', txt);
  ok('PDF digital: texto extraído', txt.includes('¿Qué factores explican el crecimiento'), `${txt.length} caracteres`);
  ok('PDF digital: palabra cortada «compe-tencia» reconstruida', txt.includes('La competencia regional') && !txt.includes('compe-'));
  ok('PDF digital: encabezado repetido y números de página omitidos', !txt.includes('Manual de casos') && !/^\s*[12]\s*$/m.test(txt));
  ok('PDF digital: párrafos sin saltos de línea artificiales', txt.includes('mercado competitivo? Según'));
  await page.click('button:has-text("Guardar en la biblioteca")');
  await page.waitForSelector('.marca-pagina', { timeout: 15000 });
  const pags = await page.$$eval('.marca-pagina', (e) => e.map((x) => x.dataset.page));
  ok('PDF digital: relación texto-página conservada', pags.join(',') === '1,2', pags.join(','));
}
if (quiere('encabezados')) {
  await importarArchivo(FIX + 'encabezados.pdf');
  await page.waitForSelector('button:has-text("Importar")', { timeout: 30000 });
  await page.click('.vista button.primario:has-text("Importar")');
  await page.waitForSelector('.vista-revision', { timeout: 60000 });
  const txt = await page.$$eval('.vista-revision textarea', (t) => t.map((x) => x.value).join('\n\n'));
  fs.writeFileSync(OUT + '/encabezados.txt', txt);
  ok('Encabezados que cambian por capítulo omitidos', !/Estrategia|Finanzas|Personas|Manual de gestión/.test(txt), txt.slice(0, 100).replace(/\n/g, ' / '));
  ok('Pies de página omitidos', !/Universidad de Ejemplo/.test(txt));
  ok('Títulos del cuerpo conservados («Capítulo 2»)', /Capítulo 1/.test(txt) && /Capítulo 2/.test(txt) && /Capítulo 3/.test(txt));
  ok('Texto principal completo', (txt.match(/Este es el texto principal/g) || []).length === 4);
  await page.click('button:has-text("Descartar")'); await page.click('.dialogo .boton.peligro');
}
if (quiere('sello')) {
  await importarArchivo(FIX + 'sello.pdf');
  await page.waitForSelector('button:has-text("Importar")', { timeout: 30000 });
  await page.click('.vista button.primario:has-text("Importar")');
  await page.waitForSelector('.vista-revision', { timeout: 60000 });
  const txt = await page.$$eval('.vista-revision textarea', (t) => t.map((x) => x.value).join('\n\n'));
  ok('Sello lateral vertical omitido (sin letras sueltas)', !/exclusive/.test(txt) && !/^\S{1,3}$/m.test(txt) && /gated communities/.test(txt), txt.slice(0, 80));
  await page.click('button:has-text("Descartar")'); await page.click('.dialogo .boton.peligro');
  // Documento ya importado con letras sueltas: se repara al abrirlo
  await page.evaluate(async () => {
    await window.__vozi.db.put('docs', { id: 'dfrag', title: 'Con fragmentos', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'pdf' }, pages: 1,
      paragraphs: ['Texto normal del caso.', 'oc', 'tu', 'br', 'e', 'Otro párrafo normal.'].map((t, i) => ({ id: 'f' + i, text: t, page: 1, kind: 'p' })) });
  });
  await irA('biblioteca'); await page.click('.doc-abrir:has-text("Con fragmentos")'); await page.waitForSelector('.texto-lectura .parrafo');
  const n = await page.$$eval('.texto-lectura .parrafo', (e) => e.length);
  ok('Documentos ya importados se reparan al abrirlos', n === 2, `${n} párrafos`);
}
if (quiere('rapidez')) {
  await page.evaluate(async () => {
    await window.__vozi.db.put('docs', { id: 'drap2', title: 'Rapidez', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0,
      paragraphs: Array.from({ length: 8 }, (_, i) => ({ id: 'r' + i, text: `Párrafo número ${i + 1}. La competencia regional se intensificó durante el semestre y la empresa debió ajustar su estrategia comercial.`, page: null, kind: 'p' })) });
  });
  const errs0 = errores.length;
  await irA('biblioteca'); await page.click('.doc-abrir:has-text("Rapidez")'); await page.waitForSelector('.texto-lectura .parrafo');
  const t0 = Date.now();
  await page.evaluate(() => { window.__vozi.L.escucharDesde(0); });
  await esperar(1500);
  await page.evaluate(() => { window.__vozi.L.escucharDesde(3); }); // el usuario cambia de idea durante la preparación
  await esperar(300);
  await page.evaluate(() => { window.__vozi.L.escucharDesde(4); });
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo, null, { timeout: 300000 });
  const espera = (Date.now() - t0) / 1000;
  const av = await textoAviso();
  ok('Toques repetidos en «Escuchar desde aquí» sin errores', !/Object\.assign|undefined|null/.test(av) && errores.length === errs0, av);
  const pos = await page.evaluate(() => window.__vozi.ctx.rep.posicionActual().pid);
  ok('Empieza en el último párrafo elegido', pos === 'r4', `${pos}, primera voz en ${espera.toFixed(1)} s`);
  await page.evaluate(() => window.__vozi.ctx.rep.pausar());
  // Volver a un párrafo ya preparado: debe ser inmediato (sin sintetizar)
  await page.evaluate(() => { window.__vozi.ctx.rep.descargar(); });
  const t1 = Date.now();
  await page.evaluate(() => { window.__vozi.L.escucharDesde(4); });
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo, null, { timeout: 60000 });
  ok('Volver a un párrafo con audio guardado es inmediato', (Date.now() - t1) < 2500, `${Date.now() - t1} ms`);
  await page.evaluate(() => window.__vozi.ctx.rep.pausar());
}
if (quiere('todo')) {
  // «Preparar todo el documento»: varios tramos seguidos y luego lectura continua sin sintetizar
  await page.evaluate(async () => {
    await window.__vozi.db.put('docs', { id: 'dtodo', title: 'Todo junto', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0,
      paragraphs: Array.from({ length: 9 }, (_, i) => ({ id: 't' + i, text: `Sección ${i + 1}. La empresa revisó sus indicadores y decidió ajustar la estrategia comercial para el siguiente semestre.`, page: null, kind: 'p' })) });
    window.__vozi.ctx.ajustes.tramoMin = 0.3;
  });
  const errs0 = errores.length;
  await irA('biblioteca'); await page.click('.doc-abrir:has-text("Todo junto")'); await page.waitForSelector('.texto-lectura .parrafo');
  const est = await page.evaluate(async () => { const e = await window.__vozi.L.estimarTodo({ desdeInicio: true }); return e; });
  ok('Estimación de tiempo y espacio', est && est.audioSeg > 30 && est.bytes > 1e6, `${Math.round(est.audioSeg)} s de audio · ${(est.bytes / 1e6).toFixed(1)} MB`);
  const t0 = Date.now();
  await page.evaluate(() => { window.__vozi.L.prepararTodo({ desdeInicio: true }); });
  await esperar(2500);
  const barra = await page.$eval('#repTodo', (e) => !e.hidden && e.textContent);
  ok('Progreso visible en el reproductor', !!barra, barra || '');
  await page.waitForFunction(() => !window.__vozi.L.preparacionTodo.activo, null, { timeout: 900000 });
  const dur = (Date.now() - t0) / 1000;
  const r = await page.evaluate(async () => {
    const lista = (await window.__vozi.db.byIndex('audio', 'docId', 'dtodo')).sort((a, b) => a.inicio - b.inicio || (a.desdeOracion || 0) - (b.desdeOracion || 0));
    return { n: lista.length, tramos: lista.map((a) => [a.inicio, a.desdeOracion || 0, a.fin, a.finS, a.completo]), audio: lista.reduce((s, a) => s + a.duracion, 0), procesos: window.__vozi.ctx.motor.procesos.length, nucleos: navigator.hardwareConcurrency };
  });
  let contiguo = r.tramos.length > 0 && r.tramos[0][0] === 0;
  for (let i = 1; i < r.tramos.length; i++) {
    const [, , fin, finS, completo] = r.tramos[i - 1];
    const esperado = completo ? [fin + 1, 0] : [fin, finS + 1];
    if (r.tramos[i][0] !== esperado[0] || r.tramos[i][1] !== esperado[1]) contiguo = false;
  }
  const ultimo = r.tramos[r.tramos.length - 1];
  ok('Prepara todo el documento en tramos contiguos', contiguo && ultimo && ultimo[2] === 8, `${r.n} tramos · ${r.audio.toFixed(0)} s de audio en ${dur.toFixed(0)} s (factor ${(dur / r.audio).toFixed(2)}) · ${r.procesos} procesos, ${r.nucleos} núcleos`);
  // Escuchar después: todo sale de lo guardado, sin volver a sintetizar
  const rr = await page.evaluate(async () => {
    const V = window.__vozi; let llamadas = 0;
    const orig = V.ctx.motor.sintetizar.bind(V.ctx.motor);
    V.ctx.motor.sintetizar = (...a) => { llamadas++; return orig(...a); };
    V.ctx.rep.descargar();
    const t = performance.now();
    await V.L.escucharDesde(0);
    const primera = performance.now() - t;
    const vistos = [V.ctx.rep.tramo.inicio];
    for (let i = 0; i < 20; i++) {
      const antes = V.ctx.rep.tramo;
      const t1 = performance.now();
      await V.L.alTerminarTramo();
      if (V.ctx.rep.tramo === antes) break;
      vistos.push(V.ctx.rep.tramo.inicio + ':' + Math.round(performance.now() - t1) + 'ms');
    }
    V.ctx.rep.pausar();
    V.ctx.motor.sintetizar = orig;
    return { llamadas, primera, vistos };
  });
  ok('Lectura continua sin preparar de nuevo', rr.llamadas === 0 && rr.vistos.length === r.n, `primera voz ${Math.round(rr.primera)} ms · tramos ${rr.vistos.join(', ')} · síntesis nuevas: ${rr.llamadas}`);
  ok('Sin errores en «Preparar todo»', errores.length === errs0, errores.slice(errs0).join(' | '));
  await page.evaluate(() => { window.__vozi.ctx.ajustes.tramoMin = 5; });
}
if (quiere('autoescucha')) {
  // «Preparar todo» con inicio automático: empieza a sonar antes de terminar y sin cortes
  await page.evaluate(async () => {
    const { ctx, db } = window.__vozi;
    await db.put('docs', { id: 'dauto', title: 'Auto', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0,
      paragraphs: Array.from({ length: 10 }, (_, i) => ({ id: 'z' + i, text: `Parte ${i + 1}. El equipo comercial revisó los indicadores del trimestre y propuso nuevas metas para el año siguiente.`, page: null, kind: 'p' })) });
    window.__antes2 = ctx.ajustes.tramoMin; ctx.ajustes.tramoMin = 0.3;
  });
  const errs0 = errores.length;
  await irA('biblioteca'); await page.click('.doc-abrir:has-text("Auto")'); await page.waitForSelector('.texto-lectura .parrafo');
  await page.evaluate(() => { window.__vozi.ctx.rep.descargar(); window.__vozi.L.prepararTodo({ desdeInicio: true, autoEscuchar: true }); });
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo, null, { timeout: 600000 });
  const r = await page.evaluate(() => ({ f: window.__vozi.L.preparacionTodo.fraccion, activo: window.__vozi.L.preparacionTodo.activo, u: window.__vozi.L.umbralEscucha(), pid: window.__vozi.ctx.rep.posicionActual().pid }));
  ok('Empieza a escuchar sola antes de terminar de preparar', r.activo && r.f <= 0.6 && r.pid === 'z0', `sonó al ${Math.round(r.f * 100)} % (umbral ${Math.round(r.u * 100)} %), desde ${r.pid}`);
  await page.waitForFunction(() => !window.__vozi.L.preparacionTodo.activo, null, { timeout: 900000 });
  await page.evaluate(() => { window.__vozi.ctx.rep.pausar(); window.__vozi.ctx.ajustes.tramoMin = window.__antes2; });
  ok('Sin errores con inicio automático', errores.length === errs0, errores.slice(errs0).join(' | '));
}
if (quiere('ia')) {
  // Asistente de estudio con IA (motor simulado: el entorno de prueba no tiene tarjeta gráfica)
  await page.evaluate(async () => {
    localStorage.setItem('vozi-ia-simulada', '1');
    await window.__vozi.db.put('docs', { id: 'dia', title: 'Estudio IA', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 2,
      paragraphs: Array.from({ length: 14 }, (_, i) => ({ id: 'ia' + i, text: `Sección ${i + 1}. La empresa analizó su crecimiento en un mercado competitivo. La directora advirtió que la competencia regional se intensificó durante el segundo semestre y que las ventajas podían desaparecer sin innovación. `.repeat(3), page: i < 7 ? 1 : 2, kind: 'p' })) });
  });
  const errs0 = errores.length;
  await irA('biblioteca'); await page.click('.doc-abrir:has-text("Estudio IA")'); await page.waitForSelector('.texto-lectura .parrafo');
  await page.click('button[aria-label="Asistente de estudio con IA"]');
  await page.click('.dialogo button:has-text("Descargar")');
  await page.waitForSelector('.panel-ia');
  await page.click('.panel-ia button:has-text("Resumir")');
  await page.waitForSelector('.panel-ia button:has-text("Guardar en notas")', { timeout: 60000 });
  const resumen = await page.$eval('.ia-salida', (e) => e.textContent);
  const frs = await page.evaluate(async () => (await import('./js/ia/ia.js')).fragmentar(window.__vozi.ctx.doc).length);
  ok('IA: resumen por partes y final, sin restos de «pensamiento»', /Ideas clave/.test(resumen) && !/think/.test(resumen) && frs > 1, `${frs} partes · ${resumen.slice(0, 80)}`);
  await page.click('.panel-ia button:has-text("Guardar en notas")');
  await page.click('.panel-ia button:has-text("Preguntas de repaso")');
  await page.waitForSelector('.panel-ia button:has-text("Crear tarjetas")', { timeout: 60000 });
  const nPreg = await page.$$eval('.ia-pregunta', (e) => e.length);
  await page.click('.panel-ia button:has-text("Crear tarjetas")');
  await esperar(500);
  await page.fill('.panel-ia input.campo', '¿Cuándo se intensificó la competencia?');
  await page.click('.panel-ia button:has-text("Preguntar")');
  await page.waitForFunction(() => /segundo semestre/.test(document.querySelector('.ia-salida').textContent), null, { timeout: 30000 });
  const est = await page.$eval('.ia-estado', (e) => e.textContent);
  await page.click('.dialogo button:has-text("Cerrar")');
  const r = await page.evaluate(async () => {
    const db = window.__vozi.db;
    return { cards: (await db.byIndex('cards', 'docId', 'dia')).length, notas: (await db.byIndex('notes', 'docId', 'dia')).map((n) => n.texto.split('\n')[0]) };
  });
  ok('IA: preguntas de repaso convertidas en tarjetas', nPreg >= 3 && r.cards === nPreg, `${nPreg} preguntas, ${r.cards} tarjetas`);
  ok('IA: responde preguntas indicando páginas', /págin/.test(est), est);
  ok('IA: resumen guardado en notas', r.notas.includes('Resumen (IA)'), r.notas.join(', '));
  // Explicar un párrafo
  await page.click('.texto-lectura .parrafo[data-idx="2"]');
  await page.click('.dialogo button:has-text("Explicar con IA")');
  await page.waitForFunction(() => /en pocas palabras/.test(document.querySelector('.ia-salida')?.textContent || ''), null, { timeout: 30000 });
  ok('IA: explica un párrafo', true);
  await page.click('.dialogo button:has-text("Cerrar")');
  await page.screenshot({ path: OUT + '/ia.png' });
  ok('IA: sin errores', errores.length === errs0, errores.slice(errs0).join(' | '));
  await page.evaluate(() => localStorage.removeItem('vozi-ia-simulada'));
}
if (quiere('actualizar-motor')) {
  // Al actualizar el motor, una copia vieja guardada con la misma dirección no debe bloquear la descarga
  const r = await page.evaluate(async () => {
    const R = await import('./js/resources.js');
    const man = await R.cargarManifiesto();
    const motor = man.packs.find((p) => p.id === 'motor-voz');
    const c = await caches.open(R.RES_CACHE);
    const url = new URL(motor.files.find((f) => /\.wasm$/.test(f.fs)).chunks[0].url, location.href).href;
    await c.put(url, new Response(new Uint8Array(100000), { headers: { 'Content-Type': 'application/wasm' } })); // «versión vieja»
    await window.__vozi.db.del('resources', `pack:${motor.id}@${motor.version}`);
    let error = null;
    try { await R.descargarPaquete(motor, null); } catch (e) { error = e.message; }
    const st = await R.estadoPaquete(motor);
    const tam = (await (await c.match(url)).arrayBuffer()).byteLength;
    return { error, instalado: st.instalado, tam };
  });
  ok('Actualizar el motor reemplaza la copia vieja sin error de integridad', !r.error && r.instalado && r.tam > 1e6, JSON.stringify(r));
}
if (quiere('cuadros')) {
  // Cuadros: se detectan con filas y columnas y se leen en orden; la IA puede interpretarlos antes
  const errs0 = errores.length;
  // Los PDF de prueba sin tablas no deben tener «cuadros» falsos
  const falsos = await page.evaluate(async (fix) => {
    const { abrirPdf, importarPdf } = await import('./js/import/pdf.js');
    const out = {};
    for (const n of ['digital.pdf', 'notas.pdf', 'encabezados.pdf', 'sello.pdf']) {
      const b = await (await fetch('/tests/fixtures/' + n)).blob();
      const ab = await abrirPdf(new File([b], n));
      out[n] = (await importarPdf(ab, {})).tablas;
    }
    return out;
  });
  ok('Cuadros: sin cuadros falsos en documentos normales', Object.values(falsos).every((x) => x === 0), JSON.stringify(falsos));
  await importarArchivo(FIX + 'tablas.pdf');
  await page.waitForSelector('button:has-text("Importar")', { timeout: 30000 });
  await page.click('.vista button.primario:has-text("Importar")');
  await page.waitForSelector('.vista-revision', { timeout: 120000 });
  const aviso1 = await page.$$eval('.vista-revision .aviso-ocr', (e) => e.map((x) => x.textContent).join(' '));
  await page.click('button:has-text("Guardar en la biblioteca")');
  await page.waitForSelector('.texto-lectura .parrafo');
  const r = await page.evaluate(async () => {
    const d = window.__vozi.ctx.doc;
    const t = d.paragraphs.find((p) => p.kind === 'tabla');
    const { planificarTramo } = await import('./js/tts/tramos.js');
    const plan = planificarTramo(d, 0, 10, 13.5, [], { cuadros: 'ambos' });
    return { kinds: d.paragraphs.map((p) => p.kind).join(','), tabla: t && t.tabla, texto: t && t.text,
      voz: plan.items.filter((i) => t && i.pid === t.id).map((i) => i.text), html: !!document.querySelector('.tabla-doc table tbody tr') };
  });
  fs.writeFileSync(OUT + '/cuadros.json', JSON.stringify(r, null, 1));
  ok('Cuadros: tabla del PDF detectada con filas y columnas', r.tabla && r.tabla.filas.length === 5 && r.tabla.filas[0].length === 4 && r.kinds === 'p,tabla,p', `${r.kinds} · ${r.tabla && r.tabla.filas.map((f) => f.join('|')).join(' / ')}`);
  ok('Cuadros: título del cuadro reconocido', r.tabla && /^Tabla 1/.test(r.tabla.titulo), r.tabla && r.tabla.titulo);
  ok('Cuadros: lectura ordenada fila por fila con columnas', r.voz.length === 6 && /^Tabla uno: consumo/i.test(r.voz[0]) && /^Residencial: consumo en gigavatios hora, mil doscientos cincuenta; variación, seis coma cinco por ciento/.test(r.voz[2]), r.voz.slice(0, 3).join(' ‖ '));
  ok('Cuadros: se muestran como tabla y se avisa al importar', r.html && /cuadro/.test(aviso1), aviso1.slice(0, 90));
  // Resaltado de la fila en lectura
  const fila = await page.evaluate(async () => {
    const { resaltarPosicion } = await import('./js/vistas/leer.js');
    const t = window.__vozi.ctx.doc.paragraphs.find((p) => p.kind === 'tabla');
    resaltarPosicion({ pid: t.id, s: 3 }, {});
    const tr = document.querySelector('.tabla-doc tbody tr.fila-activa');
    return tr ? tr.textContent : null;
  });
  ok('Cuadros: resalta la fila que se está leyendo', /^Comercial/.test(fila || ''), fila || '');
  // DOCX con tabla
  const dx = await page.evaluate(async () => {
    const { importarDocx } = await import('./js/import/textos.js');
    const b = await (await fetch('/tests/fixtures/tablas.docx')).blob();
    const r = await importarDocx(new File([b], 'tablas.docx'));
    const t = r.paragraphs.find((p) => p.kind === 'tabla');
    return { kinds: r.paragraphs.map((p) => p.kind).join(','), titulo: t && t.tabla.titulo, filas: t && t.tabla.filas.length };
  });
  ok('Cuadros: tabla de Word detectada con su título', dx.kinds === 'p,tabla,p' && /^Tabla 1/.test(dx.titulo) && dx.filas === 5, JSON.stringify(dx));
  // Interpretación con IA (motor simulado) y lectura de la interpretación antes de las filas
  await page.evaluate(() => localStorage.setItem('vozi-ia-simulada', '1'));
  await page.click('button[aria-label="Asistente de estudio con IA"]');
  await page.waitForSelector('.panel-ia, .dialogo button:has-text("Descargar")');
  if (await page.$('.dialogo button:has-text("Descargar")')) await page.click('.dialogo button:has-text("Descargar")');
  await page.waitForSelector('.panel-ia');
  await page.click('.panel-ia button:has-text("Interpretar cuadros")');
  await page.waitForFunction(() => /interpretados/.test(document.querySelector('.ia-estado')?.textContent || ''), null, { timeout: 30000 });
  await page.click('.dialogo button:has-text("Cerrar")');
  const ri = await page.evaluate(async () => {
    const d = window.__vozi.ctx.doc;
    const t = d.paragraphs.find((p) => p.kind === 'tabla');
    const guardado = (await window.__vozi.db.get('docs', d.id)).paragraphs.find((p) => p.kind === 'tabla').interpretacion;
    const { planificarTramo } = await import('./js/tts/tramos.js');
    const voz = planificarTramo(d, 0, 10, 13.5, [], { cuadros: 'ambos' }).items.filter((i) => i.pid === t.id).map((i) => i.text);
    const solo = planificarTramo(d, 0, 10, 13.5, [], { cuadros: 'interpretacion' }).items.filter((i) => i.pid === t.id).map((i) => i.text);
    return { guardado, voz, solo, visible: document.querySelector('.tabla-interp')?.textContent || '' };
  });
  ok('Cuadros: la IA interpreta el cuadro y se guarda', !!ri.guardado && /Interpretación/.test(ri.visible), ri.guardado);
  ok('Cuadros: la voz dice primero la interpretación y luego las filas', /^Interpretación del cuadro/.test(ri.voz[0]) && ri.voz.some((x) => /^Residencial/.test(x)) && !ri.solo.some((x) => /^Residencial/.test(x)), `${ri.voz.length} partes; solo interpretación: ${ri.solo.length}`);
  await page.evaluate(() => localStorage.removeItem('vozi-ia-simulada'));
  ok('Cuadros: sin errores', errores.length === errs0, errores.slice(errs0).join(' | '));
}
if (quiere('vozsistema')) {
  // Voces del sistema (Siri): se simula la API de voz del navegador (el entorno de prueba no trae voces)
  await page.evaluate(async () => {
    const voces = [{ name: 'Mónica', voiceURI: 'com.apple.voice.compact.es-ES.Monica', lang: 'es-ES' },
      { name: 'Paulina (Mejorada)', voiceURI: 'com.apple.voice.enhanced.es-MX.Paulina', lang: 'es-MX' },
      { name: 'Samantha', voiceURI: 'com.apple.voice.compact.en-US.Samantha', lang: 'en-US' }];
    window.__habladas = [];
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => voces, addEventListener() {}, pause() {}, resume() {},
      speak(u) { window.__habladas.push({ t: u.text, v: u.voice && u.voice.name, rate: u.rate, vol: u.volume }); this._u = u;
        setTimeout(() => { if (this._u !== u) return; u.onstart && u.onstart(); setTimeout(() => { if (this._u === u) { this._u = null; u.onend && u.onend(); } }, 60); }, 5); },
      cancel() { const u = this._u; this._u = null; if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    } });
    const { guardarAjustes } = await import('./js/estado.js');
    await guardarAjustes({ motorVoz: 'sistema' });
    await window.__vozi.db.put('docs', { id: 'dsis', title: 'Voz del sistema', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0, paragraphs: [
      { id: 's0', text: 'Capítulo 1. Introducción', page: null, kind: 'h' },
      { id: 's1', text: 'La empresa creció 32 % en 2025. La directora advirtió que no podían confiarse.', page: null, kind: 'p' },
      { id: 's2', text: 'The market grew quickly during the second half of the year, according to the report.', page: null, kind: 'p' },
      { id: 's3', text: 'Finalmente, el informe propone medir cada trimestre la satisfacción de los usuarios.', page: null, kind: 'p' }] });
  });
  const errs0 = errores.length;
  await irA('biblioteca'); await page.click('.doc-abrir:has-text("Voz del sistema")'); await page.waitForSelector('.texto-lectura .parrafo');
  const t0 = Date.now();
  await page.click('#repPlay');
  await page.waitForFunction(() => window.__habladas.some((x) => x.vol !== 0), null, { timeout: 5000 });
  const inicio = Date.now() - t0;
  const r1 = await page.evaluate(() => ({ h: window.__habladas.filter((x) => x.vol !== 0)[0], prep: !!window.__vozi.L.estadoLectura.preparando, sis: !!window.__vozi.ctx.rep.sis }));
  ok('Voces del iPhone: empiezan al instante, sin preparar audio', inicio < 1500 && !r1.prep && r1.sis, `${inicio} ms`);
  ok('Voces del iPhone: usa la mejor voz en español (Mejorada) y el texto normalizado', r1.h && r1.h.v === 'Paulina (Mejorada)' && /Capítulo uno/.test(r1.h.t), JSON.stringify(r1.h));
  await page.waitForFunction(() => !window.__vozi.ctx.rep.reproduciendo, null, { timeout: 15000 });
  const r2 = await page.evaluate(async () => ({ hab: window.__habladas.filter((x) => x.vol !== 0).map((x) => x.v + '|' + x.t), prog: await window.__vozi.db.get('progress', 'dsis'), aviso: document.getElementById('aviso').textContent }));
  ok('Voces del iPhone: lee oración por oración y el inglés con voz inglesa', r2.hab.length === 6 && /^Samantha\|The market/.test(r2.hab[4]) && /treinta y dos por ciento/.test(r2.hab[2]), r2.hab.map((x) => x.slice(0, 40)).join(' ‖ '));
  ok('Voces del iPhone: llega al final y guarda el punto de lectura', /final del documento/.test(r2.aviso) && r2.prog && r2.prog.pid === 's3', r2.aviso + ' · ' + (r2.prog && r2.prog.pid));
  // Pausa, siguiente oración y reanudar
  const r3 = await page.evaluate(async () => {
    const { ctx, L } = window.__vozi;
    window.__habladas = [];
    await L.escucharDesde(1);
    await new Promise((x) => setTimeout(x, 20));
    ctx.rep.pausar();
    const pausado = !ctx.rep.reproduciendo;
    ctx.rep.oracion(1);
    const pos = ctx.rep.posicionActual();
    ctx.rep.reproducir();
    await new Promise((x) => setTimeout(x, 30));
    const ultima = window.__habladas[window.__habladas.length - 1].t;
    ctx.rep.pausar();
    return { pausado, pos, ultima, resaltado: document.querySelector('.parrafo.actual')?.dataset.pid };
  });
  ok('Voces del iPhone: pausa, siguiente oración y resaltado', r3.pausado && r3.pos.pid === 's1' && r3.pos.s === 1 && /directora/.test(r3.ultima) && r3.resaltado === 's1', JSON.stringify(r3));
  // Ajustes: lista de voces del equipo
  await irA('ajustes');
  const lista = await page.$$eval('#sec-voz .lista-voces .voz-nombre', (e) => e.map((x) => x.textContent));
  ok('Voces del iPhone: Ajustes muestra las voces del equipo, la mejor primero', lista[0] && lista[0].startsWith('Paulina'), lista.slice(0, 3).join(', '));
  await page.evaluate(async () => { const { guardarAjustes } = await import('./js/estado.js'); await guardarAjustes({ motorVoz: 'vozi' }); window.__vozi.ctx.rep.descargar(); });
  ok('Voces del iPhone: sin errores', errores.length === errs0, errores.slice(errs0).join(' | '));
}
if (quiere('corte')) {
  // Si el tramo actual termina antes de que el siguiente esté listo, se entrega ya lo que haya
  await page.evaluate(async () => {
    const { ctx, db } = window.__vozi;
    window.__antes = { p: ctx.ajustes.primerTramoCorto, m: ctx.ajustes.tramoMin, r: ctx.ajustes.rtf };
    await db.put('docs', { id: 'dcorte', title: 'Corte', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0,
      paragraphs: Array.from({ length: 8 }, (_, i) => ({ id: 'k' + i, text: `Punto ${i + 1}. La empresa revisó sus indicadores con cuidado. Luego decidió ajustar la estrategia comercial del semestre. Los resultados se medirán cada mes.`, page: null, kind: 'p' })) });
    ctx.ajustes.primerTramoCorto = true; ctx.ajustes.tramoMin = 5; ctx.ajustes.rtf = 1.4;
  });
  const errs0 = errores.length;
  await irA('biblioteca'); await page.click('.doc-abrir:has-text("Corte")'); await page.waitForSelector('.texto-lectura .parrafo');
  await page.evaluate(() => window.__vozi.L.escucharDesde(0));
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo && window.__vozi.L.estadoLectura.siguiente, null, { timeout: 300000 });
  const r = await page.evaluate(async () => {
    const { ctx, L } = window.__vozi;
    const primero = ctx.rep.tramo;
    await new Promise((x) => setTimeout(x, 1500));
    const t = performance.now();
    await L.alTerminarTramo(); // simula que el tramo actual se acabó antes de tiempo
    const espera = performance.now() - t;
    const b = ctx.rep.tramo;
    const esperado = primero.completo === false ? [primero.fin, primero.finS + 1] : [primero.fin + 1, 0];
    const sigDesde = L.estadoLectura.siguiente && L.estadoLectura.siguiente.desde;
    const esperadoSig = b.completo === false ? `${b.fin}:${b.finS + 1}` : `${b.fin + 1}:0`;
    ctx.rep.pausar();
    return { espera, contiguo: b.inicio === esperado[0] && (b.desdeOracion || 0) === esperado[1], durB: b.duracion, sigDesde, esperadoSig };
  });
  ok('Al quedarse sin audio, entrega lo listo en segundos', r.espera < 15000 && r.durB < 25, `espera ${(r.espera / 1000).toFixed(1)} s · continuación de ${r.durB.toFixed(1)} s`);
  ok('El corte continúa sin saltar ni repetir texto', r.contiguo && r.sigDesde === r.esperadoSig, `siguiente desde ${r.sigDesde} (esperado ${r.esperadoSig})`);
  ok('Sin errores en el corte', errores.length === errs0, errores.slice(errs0).join(' | '));
  await page.evaluate(() => { const a = window.__antes, c = window.__vozi.ctx.ajustes; c.primerTramoCorto = a.p; c.tramoMin = a.m; c.rtf = a.r; });
}
if (quiere('notas')) {
  await importarArchivo(FIX + 'notas.pdf');
  await page.waitForSelector('button:has-text("Importar")', { timeout: 30000 });
  await page.click('.vista button.primario:has-text("Importar")');
  await page.waitForSelector('.vista-revision', { timeout: 60000 });
  const av = await page.$$eval('.vista-revision .aviso-ocr', (e) => e.map((x) => x.textContent).join(' '));
  await page.click('button:has-text("Guardar en la biblioteca")');
  await page.waitForSelector('.texto-lectura .parrafo');
  const r = await page.evaluate(async () => {
    const d = window.__vozi.ctx.doc;
    const { planificarTramo } = await import('./js/tts/tramos.js');
    const plan = planificarTramo(d, 0, 10, 13.5, []);
    return { pies: d.paragraphs.filter((p) => p.kind === 'pie').map((p) => p.text), cuerpo: d.paragraphs.filter((p) => p.kind !== 'pie').map((p) => p.text), voz: plan.items.map((i) => i.text).join(' ') };
  });
  fs.writeFileSync(OUT + '/notas.json', JSON.stringify(r, null, 1));
  ok('Notas al pie detectadas (2 por página)', r.pies.length === 4, r.pies[0] + ' | ' + r.pies[1]);
  ok('Nota de varias líneas unida', r.pies.some((t) => t.includes('efecto en la negociación')));
  ok('Llamadas de nota conservadas como superíndice en el texto', r.cuerpo.some((t) => /precios¹/.test(t)), r.cuerpo[0]);
  ok('La voz omite notas al pie y llamadas', !/Banco de la República|indexación y su efecto/.test(r.voz) && !/[¹²]/.test(r.voz) && /precios durante/.test(r.voz), r.voz.slice(0, 120));
  ok('Aviso de notas detectadas al revisar', /nota\(s\) al pie/.test(av), av.slice(0, 80));
}
if (quiere('ingles')) {
  await page.evaluate(async () => {
    const { db, ctx } = window.__vozi;
    await db.put('docs', { id: 'dmix', title: 'Documento bilingüe', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0, paragraphs: [
      { id: 'm1', text: 'El caso de estudio describe una empresa colombiana que exporta café a Estados Unidos.', page: null, kind: 'p' },
      { id: 'm2', text: 'What factors explain the growth of the company? In 2025, sales increased by 32% to $1,500,000, according to Dr. Smith.', page: null, kind: 'p' },
      { id: 'm3', text: 'Executive summary', page: null, kind: 'h' },
      { id: 'm4', text: 'The board decided to expand into new markets while keeping its focus on quality.', page: null, kind: 'p' },
      { id: 'm5', text: '¿Qué opinan los estudiantes sobre esta decisión?', page: null, kind: 'p' }] });
  });
  await irA('biblioteca');
  await page.click('.doc-abrir:has-text("Documento bilingüe")');
  await page.waitForSelector('.texto-lectura .parrafo');
  const plan = await page.evaluate(async () => {
    const { planificarTramo } = await import('./js/tts/tramos.js');
    const { idiomasDeParrafos } = await import('./js/tts/idioma.js');
    const d = window.__vozi.ctx.doc;
    return planificarTramo(d, 0, 10, 13.5, [], { idiomas: idiomasDeParrafos(d) }).items.map((i) => i.lang + ': ' + i.text);
  });
  fs.writeFileSync(OUT + '/plan-bilingue.json', JSON.stringify(plan, null, 1));
  const langs = await page.evaluate(async () => { const { idiomasDeParrafos } = await import('./js/tts/idioma.js'); return idiomasDeParrafos(window.__vozi.ctx.doc).join(','); });
  ok('Idioma detectado por párrafo (es/en)', langs === 'es,en,en,en,es', langs);
  ok('Inglés normalizado en inglés', plan.some((x) => x.includes('twenty twenty-five') && x.includes('thirty-two percent') && x.includes('one million five hundred thousand dollars') && x.includes('Doctor Smith')));
  await page.evaluate(() => { window.__vozi.L.escucharDesde(0); });
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo, null, { timeout: 600000 });
  const wav = await page.evaluate(async () => {
    const t = window.__vozi.ctx.rep.tramo;
    const r = await window.__vozi.db.get('audioBlobs', t.id);
    const b = new Uint8Array(await r.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
    return { b64: btoa(s), tiempos: t.tiempos };
  });
  fs.writeFileSync(OUT + '/tramo-bilingue.wav', Buffer.from(wav.b64, 'base64'));
  fs.writeFileSync(OUT + '/tramo-bilingue.json', JSON.stringify(wav.tiempos, null, 1));
  ok('Audio bilingüe generado en un solo tramo', wav.tiempos.length === 6, `${wav.tiempos.length} piezas`);
  await page.evaluate(() => window.__vozi.ctx.rep.pausar());
}
if (quiere('escaneado')) {
  await importarArchivo(FIX + 'escaneado.pdf');
  await page.waitForSelector('button:has-text("Importar")', { timeout: 30000 });
  const t0 = Date.now();
  await page.click('.vista button.primario:has-text("Importar")');
  await page.waitForSelector('.vista-revision', { timeout: 600000 });
  const txt = await page.$$eval('.vista-revision textarea', (t) => t.map((x) => x.value).join('\n\n'));
  fs.writeFileSync(OUT + '/pdf-escaneado.txt', txt);
  const aviso_ = await page.$eval('.vista-revision .aviso-ocr', (e) => e.textContent).catch(() => '');
  ok('PDF escaneado: OCR real aplicado a páginas sin texto', /factores explican el crecimiento/i.test(txt) && /competencia regional/i.test(txt), `${Math.round((Date.now() - t0) / 1000)} s · ${aviso_}`);
  await page.click('button:has-text("Guardar en la biblioteca")');
  await page.waitForSelector('.texto-lectura', { timeout: 15000 });
}
if (quiere('imagen')) {
  await irA('importar');
  await elegir('.tarjeta-import:has-text("Imágenes")', FIX + 'foto.jpg');
  await page.waitForSelector('.vista-revision', { timeout: 300000 });
  const txt = await page.$$eval('.vista-revision textarea', (t) => t.map((x) => x.value).join('\n\n'));
  fs.writeFileSync(OUT + '/foto.txt', txt);
  ok('Imagen (foto inclinada con ruido): OCR real', /factores/i.test(txt) && /directora/i.test(txt), txt.slice(0, 90).replace(/\n/g, ' '));
  await page.click('button:has-text("Descartar")'); await page.click('.dialogo .boton.peligro');
}
if (quiere('docx')) {
  await importarArchivo(FIX + 'documento.docx');
  await page.waitForSelector('.vista-revision', { timeout: 30000 });
  const txt = await page.$$eval('.vista-revision textarea', (t) => t.map((x) => x.value).join('\n\n'));
  ok('DOCX: texto y títulos importados', txt.includes('Capítulo 2. Caso práctico') && txt.includes('¿Qué factores'), `${txt.length} caracteres`);
  await page.click('button:has-text("Descartar")'); await page.click('.dialogo .boton.peligro');
}
if (quiere('errores')) {
  fs.writeFileSync('/tmp/danado.pdf', '%PDF-1.4\nesto no es un pdf valido');
  await importarArchivo('/tmp/danado.pdf');
  await esperar(2500);
  const av = await textoAviso();
  ok('PDF dañado: error claro, sin simular éxito', /dañado|válido/i.test(av), av);
  fs.writeFileSync('/tmp/vacio.txt', '');
  await importarArchivo('/tmp/vacio.txt'); await esperar(1000);
  ok('Archivo vacío: error claro', /vacío/i.test(await textoAviso()), await textoAviso());
}

// 7) Sin conexión
if (quiere('offline')) {
  await page.evaluate(async () => {
    const docs = await window.__vozi.db.all('docs');
    if (!docs.some((d) => d.title === 'Prueba de lectura')) {
      await window.__vozi.db.put('docs', { id: 'dprueba', title: 'Prueba de lectura', createdAt: Date.now(), updatedAt: Date.now(), source: { type: 'texto' }, pages: 0,
        paragraphs: [{ id: 'p1', text: '¿Funciona sin conexión? Sí: la voz se genera en el dispositivo.', page: null, kind: 'p' }, { id: 'p2', text: 'El 12 % de los datos se procesa localmente.', page: null, kind: 'p' }] });
    }
  });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__voziListo, null, { timeout: 60000 });
  ok('La app abre sin conexión', true);
  await page.evaluate(async () => { for (const a of await window.__vozi.db.all('audio')) { await window.__vozi.db.del('audio', a.id); await window.__vozi.db.del('audioBlobs', a.id); } });
  const docs = await page.evaluate(async () => (await window.__vozi.db.all('docs')).map((d) => d.title));
  await page.evaluate(async () => { const d = (await window.__vozi.db.all('docs')).find((x) => x.title === 'Prueba de lectura'); window.__vozi.ctx.doc = null; });
  await irA('biblioteca');
  await page.click('.doc-abrir:has-text("Prueba de lectura")');
  await page.waitForSelector('.texto-lectura .parrafo');
  await page.evaluate(() => window.__vozi.L.escucharDesde(0));
  await page.waitForFunction(() => window.__vozi.ctx.rep.reproduciendo && window.__vozi.ctx.rep.tiempo > 0.3, null, { timeout: 600000 }).then(
    () => ok('Sin conexión: síntesis y lectura funcionan con recursos descargados', true, docs.join(', ')),
    async () => ok('Sin conexión: síntesis y lectura funcionan con recursos descargados', false, await textoAviso()));
  await page.click('#repPlay');
  await irA('importar');
  await elegir('.tarjeta-import:has-text("Imágenes")', FIX + 'foto.jpg');
  await page.waitForSelector('.vista-revision', { timeout: 300000 }).then(
    () => ok('Sin conexión: OCR funciona', true), () => ok('Sin conexión: OCR funciona', false));
  await context.setOffline(false);
}

console.log('\nErrores de consola:', errores.length ? errores.join('\n') : 'ninguno');
fs.writeFileSync(OUT + '/resultados.json', JSON.stringify({ resultados, errores }, null, 1));
await browser.close();
