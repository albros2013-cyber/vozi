// VOZI — Reproductor continuo: un único elemento <audio> para todo el tramo.
// Cambiar la velocidad no altera el tono (preservesPitch). Compatible con Safari en iOS:
// el elemento se "desbloquea" con el primer toque del usuario y luego se reutiliza.
import { db } from './db.js';

const SILENCIO = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

export class Reproductor extends EventTarget {
  constructor() {
    super();
    this.audio = document.createElement('audio');
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.audio.preservesPitch = true;
    this.audio.mozPreservesPitch = true;
    this.audio.webkitPreservesPitch = true;
    document.body.appendChild(this.audio);
    this.tramo = null;
    this.url = null;
    this.velocidad = 1;
    this.ultimoIdx = -1;
    this.desbloqueado = false;
    this.audio.addEventListener('timeupdate', () => this._tick());
    this.audio.addEventListener('play', () => { if (this.tramo) this._emit('estado'); });
    this.audio.addEventListener('pause', () => { if (this.tramo) this._emit('estado'); });
    this.audio.addEventListener('ended', () => { if (this.tramo) this._emit('fin'); });
    this.audio.addEventListener('error', () => {
      if (this.tramo) this._emit('error', { mensaje: 'No se pudo reproducir el audio guardado. Puedes volver a prepararlo.' });
    });
    this._raf = null;
    this._configurarSesion();
  }

  // Llamar SIEMPRE dentro de un toque del usuario (requisito de iOS)
  desbloquear() {
    // Voces del sistema: iOS exige que la primera frase se pida dentro de un toque
    if (this.usarSistema && !this.sisDesbloqueado && 'speechSynthesis' in window) {
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); this.sisDesbloqueado = true; } catch { /* nada */ }
    }
    if (this.desbloqueado || this.tramo) return;
    try {
      this.audio.src = SILENCIO;
      const p = this.audio.play();
      if (p && p.then) p.then(() => { if (!this.tramo) this.audio.pause(); this.desbloqueado = true; }).catch(() => {});
    } catch { /* ignorar */ }
  }

  async cargar(tramo, desde = 0) {
    this._pararSistema(true);
    const reg = await db.get('audioBlobs', tramo.id);
    if (!reg || !reg.blob) throw new Error('El audio guardado no está disponible. Vuelve a prepararlo.');
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(reg.blob);
    this.tramo = tramo;
    this.ultimoIdx = -1;
    this.audio.src = this.url;
    this.audio.playbackRate = this.velocidad;
    this.audio.defaultPlaybackRate = this.velocidad;
    await new Promise((res, rej) => {
      const ok = () => { limpiar(); res(); };
      const ko = () => { limpiar(); rej(new Error('El navegador no pudo abrir el audio.')); };
      const limpiar = () => { this.audio.removeEventListener('loadedmetadata', ok); this.audio.removeEventListener('error', ko); };
      this.audio.addEventListener('loadedmetadata', ok);
      this.audio.addEventListener('error', ko);
      this.audio.load();
    });
    if (desde > 0) this.audio.currentTime = Math.min(desde, Math.max(0, this.audio.duration - 0.1));
    this._actualizarSesion();
    this._tick();
  }

  async reproducir() {
    if (this.sis) { this.sis.activo = true; this._hablar(); this._emit('estado'); return; }
    if (!this.tramo) return;
    this.audio.playbackRate = this.velocidad;
    try { await this.audio.play(); this.desbloqueado = true; } catch (e) {
      this._emit('error', { mensaje: 'Toca ▶ para continuar: el sistema pidió confirmar la reproducción.', bloqueo: true });
    }
    this._bucle();
  }
  pausar() {
    if (this.sis) { this.sis.activo = false; this.sis.turno++; speechSynthesis.cancel(); this._emit('estado'); return; }
    this.audio.pause();
  }
  get reproduciendo() { return this.sis ? this.sis.activo : (!!this.tramo && !this.audio.paused && !this.audio.ended); }
  get tiempo() { return this.sis ? (this.sis.antes + this.sis.prefijo[this.sis.i]) / this.sis.cps : (this.audio.currentTime || 0); }
  get duracion() { return this.sis ? this.sis.total / this.sis.cps : (this.tramo ? this.tramo.duracion : 0); }

  setVelocidad(v) {
    this.velocidad = v;
    this.audio.defaultPlaybackRate = v;
    this.audio.playbackRate = v;
    this.audio.preservesPitch = true; this.audio.webkitPreservesPitch = true;
    if (this.sis && this.sis.activo) this._hablar(); // voces del sistema: repetir la oración con la nueva velocidad
  }

  saltar(seg) { if (this.sis) { this.irA(this.tiempo + seg); return; } if (this.tramo) this.audio.currentTime = Math.max(0, Math.min(this.duracion - 0.05, this.tiempo + seg)); this._tick(); }
  irA(t) {
    if (this.sis) {
      const objetivo = t * this.sis.cps - this.sis.antes;
      let j = 0; while (j + 1 < this.sis.unidades.length && this.sis.prefijo[j + 1] <= objetivo) j++;
      this._irUnidad(Math.max(0, j)); return;
    }
    if (this.tramo) { this.audio.currentTime = Math.max(0, Math.min(this.duracion - 0.05, t)); this._tick(); } }

  // Navegación por oraciones (+1/-1) y párrafos
  oracion(dir) {
    if (this.sis) { this._irUnidad(Math.max(0, Math.min(this.sis.unidades.length - 1, this.sis.i + dir))); return; }
    if (!this.tramo) return;
    const ts = this.tramo.tiempos;
    const i = this._indice();
    let j = i + dir;
    if (dir < 0 && i >= 0 && this.tiempo - ts[i].t0 > 1.2) j = i; // volver al inicio de la oración actual
    if (j < 0) j = 0;
    if (j >= ts.length) { this._emit('fin'); return; }
    this.irA(ts[j].t0);
  }
  parrafo(dir) {
    if (this.sis) {
      const us = this.sis.unidades, i = this.sis.i, pid = us[i] && us[i].pid;
      let j;
      if (dir > 0) { j = us.findIndex((u, k) => k > i && u.pid !== pid); if (j < 0) return; }
      else { j = us.findIndex((u) => u.pid === pid); if (i - j < 1 && j > 0) { const prev = us[j - 1].pid; j = us.findIndex((u) => u.pid === prev); } }
      this._irUnidad(j); return;
    }
    if (!this.tramo) return;
    const ts = this.tramo.tiempos;
    const i = Math.max(0, this._indice());
    const pid = ts[i].pid;
    if (dir > 0) {
      const j = ts.findIndex((t, k) => k > i && t.pid !== pid);
      if (j < 0) { this._emit('fin'); return; }
      this.irA(ts[j].t0);
    } else {
      let k = ts.findIndex((t) => t.pid === pid);
      if (this.tiempo - ts[k].t0 < 1.5 && k > 0) { const prev = ts[k - 1].pid; k = ts.findIndex((t) => t.pid === prev); }
      this.irA(ts[k].t0);
    }
  }
  // Ir a un párrafo concreto si está dentro del tramo
  irAParrafo(pid) {
    if (this.sis) { const j = this.sis.unidades.findIndex((u) => u.pid === pid); if (j < 0) return false; this._irUnidad(j); return true; }
    if (!this.tramo) return false;
    const t = this.tramo.tiempos.find((x) => x.pid === pid);
    if (!t) return false;
    this.irA(t.t0);
    return true;
  }

  _indice() {
    if (!this.tramo) return -1;
    const t = this.tiempo, ts = this.tramo.tiempos;
    let lo = 0, hi = ts.length - 1, r = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ts[m].t0 <= t + 0.03) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }

  posicionActual() {
    if (this.sis) { const u = this.sis.unidades[this.sis.i]; return u ? { pid: u.pid, s: u.s, idx: this.sis.i, tiempo: this.tiempo } : null; }
    const i = this._indice();
    if (i < 0) return null;
    const t = this.tramo.tiempos[i];
    return { pid: t.pid, s: t.s, idx: i, tiempo: this.tiempo };
  }

  _tick() {
    if (!this.tramo) return;
    const i = this._indice();
    if (i !== this.ultimoIdx) {
      this.ultimoIdx = i;
      const t = this.tramo.tiempos[i];
      this._emit('posicion', { pid: t.pid, s: t.s, idx: i, tiempo: this.tiempo });
    }
    this._emit('tiempo', { tiempo: this.tiempo, duracion: this.duracion });
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && this.duracion) {
      try { navigator.mediaSession.setPositionState({ duration: this.duracion, playbackRate: this.velocidad, position: Math.min(this.tiempo, this.duracion) }); } catch { /* ignorar */ }
    }
  }
  _bucle() {
    cancelAnimationFrame(this._raf);
    const paso = () => {
      if (!this.reproduciendo) return;
      if (!document.hidden) this._tick();
      this._raf = requestAnimationFrame(paso);
    };
    this._raf = requestAnimationFrame(paso);
  }

  _emit(tipo, detalle) { this.dispatchEvent(new CustomEvent(tipo, { detail: detalle })); }

  _configurarSesion() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* no soportado */ } };
    h('play', () => this.reproducir());
    h('pause', () => this.pausar());
    h('seekbackward', () => this.saltar(-15));
    h('seekforward', () => this.saltar(15));
    h('previoustrack', () => this.parrafo(-1));
    h('nexttrack', () => this.parrafo(1));
    h('seekto', (d) => this.irA(d.seekTime));
  }
  _actualizarSesion() {
    if (!('mediaSession' in navigator) || !this.titulo) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.titulo, artist: 'VOZI', album: 'Lectura',
        artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch { /* ignorar */ }
  }
  setTitulo(t) { this.titulo = t; this._actualizarSesion(); }

  // ---------- Voces del sistema (speechSynthesis): una oración por vez ----------
  // unidades: [{pid, s, texto, lang, chars}] · voces: {es, en} (SpeechSynthesisVoice)
  hablarSistema({ docId, unidades, antes = 0, total, cps = 14, voces, reproducir = true }) {
    this._pararSistema(true);
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.tramo = null;
    this.audio.removeAttribute('src');
    const prefijo = [0];
    for (const u of unidades) prefijo.push(prefijo[prefijo.length - 1] + u.chars);
    this.sis = { docId, unidades, i: 0, activo: false, turno: 0, antes, total: total || antes + prefijo[prefijo.length - 1], cps, voces, prefijo };
    this._actualizarSesion();
    if (reproducir) this.reproducir(); else this._emitPosSistema();
  }
  _irUnidad(j) {
    if (!this.sis) return;
    this.sis.i = j;
    if (this.sis.activo) this._hablar(); else this._emitPosSistema();
  }
  _emitPosSistema() {
    const u = this.sis && this.sis.unidades[this.sis.i];
    if (!u) return;
    this._emit('posicion', { pid: u.pid, s: u.s, idx: this.sis.i, tiempo: this.tiempo });
    this._emit('tiempo', { tiempo: this.tiempo, duracion: this.duracion });
  }
  _hablar() {
    const sis = this.sis;
    if (!sis) return;
    const turno = ++sis.turno;
    speechSynthesis.cancel();
    const u = sis.unidades[sis.i];
    if (!u) { sis.activo = false; this._emit('estado'); this._emit('finSistema'); return; }
    const ut = new SpeechSynthesisUtterance(u.texto);
    const v = u.lang === 'en' ? (sis.voces.en || sis.voces.es) : sis.voces.es;
    if (v) { ut.voice = v; ut.lang = v.lang; } else ut.lang = u.lang === 'en' ? 'en-US' : 'es-MX';
    ut.rate = Math.max(0.5, Math.min(2, this.velocidad));
    ut.onstart = () => { if (turno === sis.turno) this._emitPosSistema(); };
    ut.onend = () => {
      if (turno !== sis.turno || !sis.activo || this.sis !== sis) return;
      sis.i++;
      // Pausa corta entre párrafos y después de los títulos
      const sig = sis.unidades[sis.i];
      const pausa = sig && (sig.pid !== u.pid || u.titulo) ? 260 : 0;
      setTimeout(() => { if (turno === sis.turno && sis.activo) this._hablar(); }, pausa);
    };
    ut.onerror = (e) => {
      if (turno !== sis.turno || ['interrupted', 'canceled'].includes(e.error)) return;
      if (e.error === 'not-allowed') { sis.activo = false; this._emit('estado'); this._emit('error', { mensaje: 'Toca ▶ para empezar: el sistema pidió confirmar la lectura.', bloqueo: true }); return; }
      sis.i++; if (sis.activo) this._hablar();
    };
    this._emitPosSistema();
    speechSynthesis.speak(ut);
  }
  _pararSistema(borrar) {
    if (!this.sis) return;
    this.sis.activo = false; this.sis.turno++;
    try { speechSynthesis.cancel(); } catch { /* nada */ }
    if (borrar) this.sis = null;
  }

  descargar() {
    this._pararSistema(true);
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.tramo = null;
    this.audio.removeAttribute('src');
    this.audio.load();
  }
}
