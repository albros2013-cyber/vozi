/* VOZI — Trabajador de síntesis de voz (sherpa-onnx compilado a WebAssembly).
 * Se ejecuta fuera del hilo principal para no bloquear la interfaz.
 * Mensajes de entrada:
 *   {type:'init', engineBase, cacheName, voice:{engine, files:{nombreFS:[urls...]}, config}}
 *   {type:'synth', jobId, items:[{id, text}], sid, speed, numSteps, lang, seed}
 *   {type:'cancel', jobId}
 * Mensajes de salida: 'status', 'ready', 'item', 'done', 'error', 'cancelled'
 */
'use strict';

let tts = null;
let cancelled = new Set();
let queue = Promise.resolve();

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

async function leerArchivo(cache, urls, nombre, onBytes) {
  const partes = [];
  let total = 0;
  for (const url of urls) {
    let resp = cache ? await cache.match(url) : null;
    if (!resp) {
      // Respaldo: intentar red (solo ocurre si el recurso no está guardado)
      resp = await fetch(url).catch(() => null);
      if (!resp || !resp.ok) throw new Error(`FALTA_RECURSO:${nombre}`);
    }
    const buf = new Uint8Array(await resp.arrayBuffer());
    partes.push(buf);
    total += buf.length;
    onBytes(buf.length);
  }
  if (partes.length === 1) return partes[0];
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of partes) { out.set(p, off); off += p.length; }
  return out;
}

async function init({ engineBase, cacheName, voice }) {
  post({ type: 'status', stage: 'cargando', progress: 0 });
  const cache = cacheName && self.caches ? await caches.open(cacheName) : null;
  const entradas = Object.entries(voice.files);
  const totalBytes = voice.totalBytes || 1;
  let leidos = 0;
  const datos = {};
  for (const [nombre, urls] of entradas) {
    datos[nombre] = await leerArchivo(cache, urls, nombre, (n) => {
      leidos += n;
      post({ type: 'status', stage: 'cargando', progress: Math.min(0.95, leidos / totalBytes) });
    });
  }

  await new Promise((resolve, reject) => {
    self.Module = {
      skipPreload: true,
      locateFile: (p) => engineBase + p,
      print: () => {},
      printErr: (t) => { if (/error|invalid|fail/i.test(t)) console.warn('[sherpa]', t); },
      preRun: [function () {
        const M = self.Module;
        const dirs = new Set();
        for (const nombre of Object.keys(datos)) {
          const partes = nombre.split('/').slice(0, -1);
          let ruta = '';
          for (const p of partes) {
            const padre = ruta || '/';
            ruta = ruta + '/' + p;
            if (!dirs.has(ruta)) { M.FS_createPath(padre, p, true, true); dirs.add(ruta); }
          }
        }
        for (const [nombre, data] of Object.entries(datos)) {
          const i = nombre.lastIndexOf('/');
          const dir = i > 0 ? '/' + nombre.slice(0, i) : '/';
          M.FS_createDataFile(dir, nombre.slice(i + 1), data, true, false, true);
        }
      }],
      onRuntimeInitialized: () => resolve(),
      onAbort: (r) => reject(new Error('MOTOR_ABORTADO:' + r)),
    };
    try {
      importScripts(engineBase + 'sherpa-onnx-wasm-main-tts.js', engineBase + 'sherpa-onnx-tts.js');
    } catch (e) { reject(e); }
  });

  post({ type: 'status', stage: 'iniciando', progress: 0.97 });
  const t0 = performance.now();
  tts = createOfflineTts(self.Module, voice.config);
  if (!tts || !tts.handle) throw new Error('No se pudo iniciar el modelo de voz');
  // Liberar copias de los archivos: el modelo ya está en memoria del motor
  // (los datos de pronunciación de espeak se leen bajo demanda y se conservan)
  for (const nombre of Object.keys(datos)) {
    if (/\.onnx$|voice\.bin$/.test(nombre)) {
      try { self.Module.FS_unlink('/' + nombre); } catch (e) { /* sin efecto */ }
    }
    delete datos[nombre];
  }
  post({ type: 'ready', sampleRate: tts.sampleRate, numSpeakers: tts.numSpeakers, initMs: performance.now() - t0 });
}

// Recorta silencio inicial y final (umbral relativo) dejando un margen pequeño
function recortar(samples, sr) {
  // Umbral bajo y margen amplio: no cortar finales suaves (s, f, respiración) que dan naturalidad
  const thr = 0.004;
  const margen = Math.round(sr * 0.08);
  let a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < thr) a++;
  while (b > a && Math.abs(samples[b]) < thr) b--;
  a = Math.max(0, a - margen);
  b = Math.min(samples.length - 1, b + margen);
  const out = samples.slice(a, b + 1);
  // Fundidos de 6 ms para evitar chasquidos al unir
  const f = Math.min(Math.round(sr * 0.006), out.length >> 1);
  for (let i = 0; i < f; i++) { const g = i / f; out[i] *= g; out[out.length - 1 - i] *= g; }
  return out;
}

// Remuestreo de calidad (sinc con ventana) para reducir el tamaño del audio guardado
function remuestrear(x, inRate, outRate) {
  if (!outRate || outRate >= inRate) return x;
  const r = outRate / inRate;
  const n = Math.floor(x.length * r);
  const y = new Float32Array(n);
  const fc = r * 0.94;
  const W = Math.ceil(10 / fc);
  for (let i = 0; i < n; i++) {
    const t = i / r;
    const c = Math.floor(t);
    let acc = 0, wsum = 0;
    const k0 = Math.max(0, c - W + 1), k1 = Math.min(x.length - 1, c + W);
    for (let k = k0; k <= k1; k++) {
      const d = t - k;
      const arg = Math.PI * fc * d;
      const h = (d === 0 ? 1 : Math.sin(arg) / arg) * (0.5 + 0.5 * Math.cos(Math.PI * d / W));
      acc += x[k] * h; wsum += h;
    }
    y[i] = wsum ? acc / wsum : 0;
  }
  return y;
}

function generar(text, opts) {
  const gen = {
    sid: opts.sid || 0,
    speed: opts.speed || 1.0,
    numSteps: opts.numSteps || 5,
    silenceScale: 0.2,
  };
  const extra = {};
  if (opts.lang) extra.lang = opts.lang;
  if (opts.seed != null) extra.seed = opts.seed;
  if (Object.keys(extra).length) gen.extra = extra;
  return tts.generateWithConfig(text, gen);
}

async function synth(msg) {
  const { jobId, items } = msg;
  if (!tts) throw new Error('El motor de voz no está listo');
  let charsHechos = 0;
  const charsTotal = items.reduce((s, it) => s + it.text.length, 0) || 1;
  const t0 = performance.now();
  let audioSeg = 0;
  for (let i = 0; i < items.length; i++) {
    if (cancelled.has(jobId)) { cancelled.delete(jobId); post({ type: 'cancelled', jobId }); return; }
    const it = items[i];
    let out = null;
    if (it.text.trim()) {
      let intento = 0;
      let seed = msg.seed != null ? msg.seed : 1234;
      while (true) {
        const r = generar(it.text, { ...msg, ...(it.lang ? { lang: it.lang } : {}), ...(it.sid != null ? { sid: it.sid } : {}), seed });
        let s = recortar(r.samples, r.sampleRate);
        const dur = s.length / r.sampleRate;
        let sr = r.sampleRate;
        if (msg.outRate && msg.outRate < sr) { s = remuestrear(s, sr, msg.outRate); sr = msg.outRate; }
        // Control de calidad: duración anómala (posible repetición u omisión) → reintentar con otra semilla
        const esperado = it.text.length / (msg.charsPorSegundo || 14);
        const anomalo = it.text.length > 25 && (dur > esperado * 1.9 + 1 || dur < esperado * 0.45);
        if (!anomalo || intento >= 2) { out = { samples: s, sampleRate: sr, reintentos: intento, anomalo }; break; }
        intento++; seed += 7919;
      }
    }
    charsHechos += it.text.length;
    const ms = performance.now() - t0;
    if (out) audioSeg += out.samples.length / out.sampleRate;
    post({
      type: 'item', jobId, index: i, id: it.id,
      samples: out ? out.samples : new Float32Array(0), sampleRate: out ? out.sampleRate : tts.sampleRate,
      reintentos: out ? out.reintentos : 0,
      progress: charsHechos / charsTotal, elapsedMs: ms, audioSeg,
    }, out ? [out.samples.buffer] : []);
    // Ceder el control para poder recibir "cancel"
    await new Promise((r) => setTimeout(r, 0));
  }
  post({ type: 'done', jobId, elapsedMs: performance.now() - t0, audioSeg });
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled.add(msg.jobId); return; }
  queue = queue.then(async () => {
    try {
      if (msg.type === 'init') await init(msg);
      else if (msg.type === 'synth') await synth(msg);
    } catch (err) {
      post({ type: 'error', jobId: msg.jobId, message: String(err && err.message || err) });
    }
  });
};
