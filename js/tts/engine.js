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
  }

  get packIdActual() { return this.packId; }

  async preparar(pack, onEstado, paralelo = 1) {
    if (this.packId === pack.id && this.listo && this.paralelo === paralelo) return this.listo;
    this.terminar();
    this.packId = pack.id;
    this.paralelo = paralelo;
    this.listo = (async () => {
      const infos = [];
      for (let i = 0; i < paralelo; i++) {
        const pr = new Proceso();
        this.procesos.push(pr);
        // Iniciar uno tras otro para no duplicar el pico de memoria
        infos.push(await pr.iniciar(pack, (m) => onEstado && onEstado({ ...m, progress: (i + m.progress) / paralelo })));
      }
      this.info = infos[0];
      return infos[0];
    })();
    try { return await this.listo; } catch (e) {
      // Si el segundo proceso no cabe en memoria, seguir con uno
      if (this.procesos.length > 1 && this.info) { this.procesos.pop().terminar(); this.paralelo = 1; return this.info; }
      this.terminar(); throw e;
    }
  }

  // Reparte oraciones entre los procesos disponibles. onItem({index, samples, sampleRate, progress, elapsedMs, audioSeg})
  sintetizar(items, opts, onItem, signal) {
    if (!this.procesos.length) return Promise.reject(new Error('El motor de voz no está listo'));
    const total = items.reduce((s, it) => s + it.text.length, 0) || 1;
    const t0 = performance.now();
    let siguiente = 0, activos = 0, chars = 0, audioSeg = 0, fin = false;
    const enCurso = new Map();
    return new Promise((resolve, reject) => {
      const terminar = (err) => {
        if (fin) return;
        fin = true;
        for (const [pr, jobId] of enCurso) pr.cancelar(jobId);
        if (err) reject(err); else resolve({ elapsedMs: performance.now() - t0, audioSeg });
      };
      if (signal) { if (signal.aborted) { terminar(errorAbort()); return; } signal.addEventListener('abort', () => terminar(errorAbort()), { once: true }); }
      const lanzar = (pr) => {
        if (fin) return;
        if (siguiente >= items.length) { if (activos === 0) terminar(); return; }
        const i = siguiente++;
        activos++;
        const { jobId, p } = pr.trabajo([items[i]], opts);
        enCurso.set(pr, jobId);
        p.then((res) => {
          activos--; enCurso.delete(pr);
          if (fin) return;
          const m = res[0];
          chars += items[i].text.length;
          if (m) audioSeg += m.samples.length / m.sampleRate;
          onItem && onItem({ ...(m || { samples: new Float32Array(0), sampleRate: 24000 }), index: i, id: items[i].id, progress: chars / total, elapsedMs: performance.now() - t0, audioSeg });
          lanzar(pr);
        }, (e) => { activos--; enCurso.delete(pr); terminar(e); });
      };
      for (const pr of this.procesos) lanzar(pr);
    });
  }

  terminar() {
    for (const pr of this.procesos) pr.terminar();
    this.procesos = [];
    this.packId = null; this.listo = null; this.info = null;
  }
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
