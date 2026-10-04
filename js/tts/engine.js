// VOZI — Gestor del motor de voz en el hilo principal.
// Puede usar 1 o 2 procesos en paralelo (cada uno con su copia del modelo) para preparar
// los tramos más rápido en dispositivos con varios núcleos.
import { cargarManifiesto, abs, RES_CACHE } from '../resources.js';

export function configuracionMotor(pack) {
  if (pack.engine === 'supertonic') {
    return {
      offlineTtsModelConfig: {
        supertonic: {
          durationPredictor: '/st/duration_predictor.int8.onnx', textEncoder: '/st/text_encoder.int8.onnx',
          vectorEstimator: '/st/vector_estimator.int8.onnx', vocoder: '/st/vocoder.int8.onnx',
          ttsJson: '/st/tts.json', unicodeIndexer: '/st/unicode_indexer.bin', voiceStyle: '/st/voice.bin',
        },
        numThreads: 1, debug: 0, provider: 'cpu',
      },
      maxNumSentences: 1,
    };
  }
  const v = pack.id.replace(/^voz-/, '');
  return {
    offlineTtsModelConfig: {
      vits: { model: `/${v}/model.onnx`, tokens: `/${v}/tokens.txt`, dataDir: `/${v}/espeak-ng-data`, noiseScale: 0.667, noiseScaleW: 0.8, lengthScale: 1 },
      numThreads: 1, debug: 0, provider: 'cpu',
    },
    maxNumSentences: 1,
  };
}

function errorAbort() { const e = new Error('Preparación cancelada'); e.name = 'AbortError'; return e; }

class Proceso {
  constructor() {
    this.w = new Worker('js/tts/tts-worker.js');
    this.trabajos = new Map();
    this.seq = 0;
    this.w.onmessage = (e) => this._recibir(e.data);
    this.w.onerror = (e) => { const err = new Error('El motor de voz no pudo iniciarse en este navegador. ' + (e.message || '')); this._fallarTodo(err); };
  }
  _recibir(m) {
    if (m.type === 'status') { this.onEstado && this.onEstado(m); return; }
    if (m.type === 'ready') { this.init && this.init.resolve(m); this.init = null; return; }
    if (m.type === 'error' && m.jobId == null) { this.init && this.init.reject(traducirError(m.message)); this.init = null; return; }
    const t = this.trabajos.get(m.jobId);
    if (!t) return;
    if (m.type === 'item') t.items.push(m);
    else if (m.type === 'done') { this.trabajos.delete(m.jobId); t.resolve(t.items); }
    else if (m.type === 'cancelled') { this.trabajos.delete(m.jobId); t.reject(errorAbort()); }
    else if (m.type === 'error') { this.trabajos.delete(m.jobId); t.reject(traducirError(m.message)); }
  }
  _fallarTodo(err) {
    if (this.init) { this.init.reject(err); this.init = null; }
    for (const t of this.trabajos.values()) t.reject(err);
    this.trabajos.clear();
  }
  iniciar(pack, onEstado) {
    const files = {};
    for (const f of pack.files) files[f.fs] = f.chunks.map((c) => abs(c.url));
    this.onEstado = onEstado;
    return new Promise((resolve, reject) => {
      this.init = { resolve, reject };
      this.w.postMessage({
        type: 'init', engineBase: abs('vendor/sherpa/'), cacheName: RES_CACHE,
        voice: { engine: pack.engine, files, config: configuracionMotor(pack), totalBytes: pack.size },
      });
    });
  }
  trabajo(items, opts) {
    const jobId = ++this.seq;
    const p = new Promise((resolve, reject) => {
      this.trabajos.set(jobId, { resolve, reject, items: [] });
      this.w.postMessage({ type: 'synth', jobId, items, ...opts });
    });
    return { jobId, p };
  }
  cancelar(jobId) { this.w.postMessage({ type: 'cancel', jobId }); }
  terminar() { this.w.terminate(); this._fallarTodo(errorAbort()); }
}

export class MotorVoz {
  constructor() {
    this.procesos = [];
    this.packId = null;
    this.listo = null;
    this.info = null;
    this.paralelo = 1;
    this.gen = 0;
    this.cargando = null;
    this.activas = new Set();
  }

  get packIdActual() { return this.packId; }

  async preparar(pack, onEstado, paralelo = 1) {
    if (this.packId === pack.id && this.listo && this.pedido === paralelo) return this.listo;
    this.terminar();
    this.packId = pack.id;
    this.paralelo = paralelo;
    this.pedido = paralelo;
    const gen = ++this.gen;
    // El primer proceso basta para empezar a hablar; el segundo se suma en cuanto termina de cargar
    // (uno tras otro, para no duplicar el pico de memoria de la carga).
    this.listo = (async () => {
      const pr = new Proceso();
      this.procesos.push(pr);
      const info = await pr.iniciar(pack, (m) => onEstado && onEstado(m));
      this.info = info;
      if (paralelo > 1 && gen === this.gen) this._sumarProceso(pack, gen);
      return info;
    })();
    try { return await this.listo; } catch (e) { this.terminar(); throw e; }
  }

  _sumarProceso(pack, gen) {
    const pr = new Proceso();
    this.cargando = pr;
    pr.iniciar(pack, null).then(() => {
      if (this.cargando === pr) this.cargando = null;
      if (gen !== this.gen) { pr.terminar(); return; }
      this.procesos.push(pr);
      for (const sumar of this.activas) sumar(pr); // repartir también el trabajo en curso
    }, () => {
      if (this.cargando === pr) this.cargando = null;
      pr.terminar();
      if (gen !== this.gen) return;
      this.paralelo = 1; // el segundo no cupo en memoria: seguir con uno
      this.onDegradado && this.onDegradado();
    });
  }

  // Reparte oraciones entre los procesos disponibles. onItem({index, samples, sampleRate, progress, elapsedMs, audioSeg})
  sintetizar(items, opts, onItem, signal) {
    if (!this.procesos.length) return Promise.reject(new Error('El motor de voz no está listo'));
    const total = items.reduce((s, it) => s + it.text.length, 0) || 1;
    const t0 = performance.now();
    let siguiente = 0, activos = 0, chars = 0, audioSeg = 0, fin = false;
    const enCurso = new Map();
    const pendientes = []; // oraciones que fallaron en un proceso caído y se repiten en otro
    const reintentadas = new Set();
    marcarSintesis(this.procesos.length > 1);
    let sumar = null;
    return new Promise((resolve, reject) => {
      const terminar = (err) => {
        if (fin) return;
        fin = true;
        this.activas.delete(sumar);
        marcarSintesis(false);
        for (const [pr, jobId] of enCurso) pr.cancelar(jobId);
        if (err) reject(err); else resolve({ elapsedMs: performance.now() - t0, audioSeg });
      };
      if (signal) { if (signal.aborted) { terminar(errorAbort()); return; } signal.addEventListener('abort', () => terminar(errorAbort()), { once: true }); }
      const lanzar = (pr) => {
        if (fin) return;
        if (!pendientes.length && siguiente >= items.length) { if (activos === 0) terminar(); return; }
        const i = pendientes.length ? pendientes.shift() : siguiente++;
        activos++;
        const { jobId, p } = pr.trabajo([items[i]], opts);
        enCurso.set(pr, jobId);
        p.then((res) => {
          activos--; enCurso.delete(pr);
          if (fin) return;
          const m = res[0];
          chars += items[i].text.length;
          if (m) audioSeg += m.samples.length / m.sampleRate;
          marcarSintesis(this.procesos.length > 1);
          onItem && onItem({ ...(m || { samples: new Float32Array(0), sampleRate: 24000 }), index: i, id: items[i].id, progress: chars / total, elapsedMs: performance.now() - t0, audioSeg });
          lanzar(pr);
        }, (e) => {
          activos--; enCurso.delete(pr);
          if (fin) return;
          // Si un proceso se cae (p. ej. sin memoria) y hay otro, seguir solo con el otro
          if (e.name !== 'AbortError' && this.procesos.length > 1 && !reintentadas.has(i)) {
            reintentadas.add(i);
            this.procesos = this.procesos.filter((x) => x !== pr);
            pr.terminar();
            this.paralelo = 1;
            try { localStorage.setItem('vozi-un-proceso', '1'); } catch (err) { /* sin almacenamiento */ }
            this.onDegradado && this.onDegradado();
            pendientes.push(i);
            if (activos === 0) lanzar(this.procesos[0]);
            return;
          }
          terminar(e);
        });
      };
      sumar = (pr) => { if (!fin) lanzar(pr); };
      this.activas.add(sumar);
      for (const pr of this.procesos) lanzar(pr);
    });
  }

  terminar() {
    this.gen++;
    if (this.cargando) { this.cargando.terminar(); this.cargando = null; }
    for (const pr of this.procesos) pr.terminar();
    this.procesos = [];
    this.packId = null; this.listo = null; this.info = null;
  }
}

// Mientras se prepara con dos procesos se deja una marca. Si iOS cierra la app por memoria,
// la marca sobrevive y al volver a abrir VOZI pasa a un solo proceso.
const MARCA = 'vozi-sintesis-doble';
function marcarSintesis(activa) {
  try {
    if (activa && document.visibilityState === 'visible') localStorage.setItem(MARCA, String(Date.now()));
    else localStorage.removeItem(MARCA);
  } catch (e) { /* sin almacenamiento */ }
}
if (typeof document !== 'undefined') {
  const quitar = () => { try { localStorage.removeItem(MARCA); } catch (e) { /* nada */ } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') quitar(); });
  addEventListener('pagehide', quitar);
}
// Devuelve true si la última sesión se cerró de golpe mientras preparaba con dos procesos
export function revisarCierreInesperado() {
  try {
    const t = +localStorage.getItem(MARCA);
    localStorage.removeItem(MARCA);
    if (t && Date.now() - t < 15 * 60 * 1000) { localStorage.setItem('vozi-un-proceso', '1'); return true; }
  } catch (e) { /* sin almacenamiento */ }
  return false;
}

function traducirError(msg) {
  if (/FALTA_RECURSO/.test(msg)) return new Error('Faltan archivos de la voz. Ve a Ajustes → Recursos sin conexión y descárgala de nuevo.');
  if (/memory|Memory|OOM|allocation|Aborted/.test(msg)) return new Error('El dispositivo se quedó sin memoria al cargar la voz. Cierra otras apps, usa un solo proceso de preparación o prueba una voz ligera.');
  return new Error('Error del motor de voz: ' + msg);
}

export async function paquetePorId(id) {
  const man = await cargarManifiesto();
  return man.packs.find((p) => p.id === id);
}
