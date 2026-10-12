/** Sonido sintetizado con WebAudio: motor, derrapes, golpes, cláxones y una pista synthwave. */
export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine!: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode };
  private skid!: { g: GainNode };
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  musicOn = true;
  private step = 0;
  private nextTime = 0;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.engine = { o1, o2, f, g };

    const sk = ctx.createBufferSource();
    sk.buffer = this.noise;
    sk.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 3;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    sk.connect(bp); bp.connect(sg); sg.connect(this.master);
    sk.start();
    this.skid = { g: sg };

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);
    this.nextTime = ctx.currentTime + 0.1;
    setInterval(() => this.schedule(), 25);
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    this.applyRadio();
    return this.musicOn;
  }

  // ------------------------------------------------------------ radio
  static STATIONS = ['FLASH BCN · SYNTHWAVE', 'RÀDIO RUMBA · RUMBA CATALANA', 'WAVE 93 · DARKWAVE', 'RADIO APAGADA'];
  station = 0;
  /** La radio solo suena dentro de un vehículo (como en GTA). */
  private inCar = true;

  /** Siguiente emisora; devuelve su nombre. */
  nextStation() {
    this.station = (this.station + 1) % Sound.STATIONS.length;
    this.step = 0;
    this.applyRadio();
    return Sound.STATIONS[this.station];
  }

  setInCar(on: boolean) {
    if (on === this.inCar) return;
    this.inCar = on;
    this.applyRadio();
  }

  private get playing() {
    return this.musicOn && this.inCar && this.station < Sound.STATIONS.length - 1;
  }

  private applyRadio() {
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.playing ? 0.32 : 0, this.ctx!.currentTime, 0.1);
  }

  /** speed en m/s; throttle 0..1. Simula un cambio de 5 marchas. */
  setEngine(speed: number, throttle: number, skid: number, on = true) {
    if (!this.ctx) return;
    if (!on) {
      const t = this.ctx.currentTime;
      this.engine.g.gain.setTargetAtTime(0, t, 0.08);
      this.skid.g.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    const gears = [0, 12, 22, 33, 45, 70];
    let g = 1;
    while (g < gears.length - 1 && speed > gears[g]) g++;
    const lo = gears[g - 1], hi = gears[g];
    const rpm = 0.25 + 0.75 * Math.min(1, (speed - lo) / (hi - lo));
    const t = this.ctx.currentTime;
    const f = 42 + rpm * 95 + g * 6;
    this.engine.o1.frequency.setTargetAtTime(f, t, 0.04);
    this.engine.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.engine.f.frequency.setTargetAtTime(350 + rpm * 900 + throttle * 600, t, 0.05);
    this.engine.g.gain.setTargetAtTime(0.05 + throttle * 0.07 + rpm * 0.03, t, 0.05);
    this.skid.g.gain.setTargetAtTime(skid * 0.12, t, 0.05);
  }

  private burst(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', when = 0) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = (when || ctx.currentTime);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g);
    return { s, g, t };
  }

  crash(k: number) {
    if (!this.ctx) return;
    const { s, g, t } = this.burst(0.35, 700, Math.min(0.6, 0.1 + k * 0.03));
    g.connect(this.master);
    s.start(t, Math.random() * 0.5, 0.4);
  }

  thud() {
    if (!this.ctx) return;
    const { s, g, t } = this.burst(0.18, 300, 0.4);
    g.connect(this.master);
    s.start(t, Math.random() * 0.5, 0.2);
  }

  private rotor: { g: GainNode; lfo: OscillatorNode; turb: OscillatorNode; tg: GainNode } | null = null;

  /** "Wop-wop" del rotor: ruido grave modulado al ritmo de las palas. `level` 0..1 (distancia), `rpm` 0..1. */
  setRotor(level: number, rpm: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.rotor) {
      if (level <= 0) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      const g = ctx.createGain();
      g.gain.value = 0;
      const mod = ctx.createGain();
      mod.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 6;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth);
      depth.connect(mod.gain);
      src.connect(f); f.connect(mod); mod.connect(g); g.connect(this.master);
      const turb = ctx.createOscillator();
      turb.type = 'triangle';
      const tg = ctx.createGain();
      tg.gain.value = 0;
      turb.connect(tg); tg.connect(this.master);
      src.start(); lfo.start(); turb.start();
      this.rotor = { g, lfo, turb, tg };
    }
    const r = this.rotor;
    r.g.gain.setTargetAtTime(level * (0.15 + rpm * 0.55), t, 0.1);
    r.lfo.frequency.setTargetAtTime(2 + rpm * 13, t, 0.1);
    r.turb.frequency.setTargetAtTime(120 + rpm * 260, t, 0.2);
    r.tg.gain.setTargetAtTime(level * rpm * 0.025, t, 0.1);
  }

  /** Disparo: 'smg' corto y seco, 'shotgun' grave y largo, el resto pistola. */
  gunshot(kind = 'pistol') {
    if (!this.ctx) return;
    const [dur, freq, gain, boom] = kind === 'smg' ? [0.09, 3400, 0.35, 0.25] : kind === 'shotgun' ? [0.45, 1500, 0.8, 0.7] : [0.22, 2600, 0.55, 0.4];
    const { s, g, t } = this.burst(dur, freq, gain);
    g.connect(this.master);
    s.start(t, Math.random() * 0.5, dur + 0.05);
    // golpe grave del disparo
    const o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.frequency.setValueAtTime(kind === 'shotgun' ? 120 : 180, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    og.gain.setValueAtTime(boom, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.12);
  }

  private siren: { g: GainNode } | null = null;

  /** Sirena de dos tonos (nee-naw) de la policía; `level` 0..1 según la distancia. */
  setSiren(level: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.siren) {
      if (level <= 0) return;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 760;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.25;
      const depth = ctx.createGain();
      depth.gain.value = 140;
      lfo.connect(depth);
      depth.connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(); lfo.start();
      this.siren = { g };
    }
    this.siren.g.gain.setTargetAtTime(level * 0.05, ctx.currentTime, 0.15);
  }

  /** Salida del cohete: silbido que se aleja. */
  rocket() {
    if (!this.ctx) return;
    const { s, g, t } = this.burst(0.9, 1200, 0.45, 'bandpass');
    g.connect(this.master);
    s.start(t, 0, 0.9);
  }

  /** Lanzar una granada. */
  throw() {
    if (!this.ctx) return;
    const { s, g, t } = this.burst(0.15, 900, 0.18, 'bandpass');
    g.connect(this.master);
    s.start(t, Math.random() * 0.5, 0.15);
  }

  /** Sintonía de misión superada (o fallida). */
  jingle(win: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    const notes = win ? [69, 73, 76, 81, 76, 81] : [64, 63, 62, 59];
    notes.forEach((n, i) => {
      const o = this.ctx!.createOscillator(), g = this.ctx!.createGain();
      o.type = 'square';
      o.frequency.value = 440 * Math.pow(2, (n - 69) / 12);
      const at = t + i * (win ? 0.11 : 0.22);
      g.gain.setValueAtTime(0.08, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + (i === notes.length - 1 ? 0.6 : 0.2));
      o.connect(g); g.connect(this.master);
      o.start(at); o.stop(at + 0.7);
    });
  }

  /** Bala contra chapa. */
  ping() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.03;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(2400 + Math.random() * 800, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.12);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.16);
  }

  explosion() {
    if (!this.ctx) return;
    const { s, g, t } = this.burst(1.6, 420, 0.9);
    g.connect(this.master);
    s.start(t, 0, 1.6);
    const o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.85);
  }

  /** Portazo al subir o bajar del coche. */
  door() {
    if (!this.ctx) return;
    const { s, g, t } = this.burst(0.12, 500, 0.35);
    g.connect(this.master);
    s.start(t, Math.random() * 0.5, 0.15);
  }

  horn(dist: number) {
    if (!this.ctx || dist > 60) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06 * (1 - dist / 60), t + 0.02);
    g.gain.setValueAtTime(0.06 * (1 - dist / 60), t + 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    g.connect(this.master);
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.42);
    }
  }

  // ------------------------------------------------------------ música
  // La menor, 116 bpm: Am - F - C - G con bajo en corcheas, arpegio y melodía.
  private schedule() {
    const ctx = this.ctx!;
    const spb = 60 / [116, 104, 96, 116][this.station] / 4; // semicorchea
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (this.playing) {
        if (this.station === 1) this.rumba(this.step, this.nextTime, spb);
        else if (this.station === 2) this.darkwave(this.step, this.nextTime, spb);
        else this.playStep(this.step, this.nextTime, spb);
      }
      this.nextTime += spb;
      this.step = (this.step + 1) % 128;
    }
  }

  private note(midi: number, t: number, dur: number, type: OscillatorType, gain: number, cutoff = 2400) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private playStep(step: number, t: number, spb: number) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    const ch = chords[bar];
    if (s % 2 === 0) this.note(ch[0] - 24 + (s % 4 === 2 ? 12 : 0), t, spb * 1.8, 'sawtooth', 0.22, 700);
    const arp = [0, 1, 2, 1];
    this.note(ch[arp[s % 4]] + 12, t, spb * 0.9, 'square', 0.05, 3000);
    // melodía en la segunda mitad del ciclo
    if (step >= 64) {
      const mel: Record<number, number> = { 0: 76, 3: 74, 6: 72, 8: 74, 10: 76, 12: 79 };
      const m2: Record<number, number> = { 0: 77, 4: 76, 8: 72, 12: 74 };
      const m = (bar % 2 === 0 ? mel : m2)[s];
      if (m) this.note(m - (bar === 3 ? 2 : 0), t, spb * 3, 'triangle', 0.12, 5000);
    }
    // batería
    if (s % 8 === 0) this.kick(t);
    if (s % 8 === 4) {
      const { s: src, g } = this.burst(0.16, 1800, 0.22, 'bandpass', t);
      g.connect(this.musicGain);
      src.start(t, Math.random() * 0.5, 0.2);
    }
    if (s % 2 === 1) {
      const { s: src, g } = this.burst(0.04, 7000, 0.06, 'highpass', t);
      g.connect(this.musicGain);
      src.start(t, Math.random() * 0.5, 0.05);
    }
  }

  /** Ràdio Rumba: rasgueo de ventilador, palmas y bajo (Am - G - F - E, la cadencia andaluza). */
  private rumba(step: number, t: number, spb: number) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const chords = [[57, 60, 64, 69], [55, 59, 62, 67], [53, 57, 60, 65], [52, 56, 59, 64]];
    const ch = chords[bar];
    // rasgueo: golpes en 0, 3, 6, 8, 10, 12, 14 (arpegiados muy deprisa)
    if ([0, 3, 6, 8, 10, 12, 14].includes(s)) {
      const up = s % 4 === 2;
      ch.forEach((n, i) => this.note(n, t + (up ? 3 - i : i) * 0.012, spb * 1.6, 'triangle', s === 0 || s === 8 ? 0.09 : 0.06, 3200));
    }
    if (s === 0 || s === 8) this.note(ch[0] - 24, t, spb * 3, 'sawtooth', 0.2, 500);
    if (s === 6 || s === 14) this.note(ch[2] - 24, t, spb * 2, 'sawtooth', 0.15, 500);
    // palmas
    if (s === 4 || s === 12 || (s === 10 && bar % 2)) {
      const { s: src, g } = this.burst(0.08, 2400, 0.28, 'bandpass', t);
      g.connect(this.musicGain);
      src.start(t, Math.random() * 0.5, 0.1);
    }
    // melodía flamenca (frigio) en la segunda vuelta
    if (step >= 64 && [0, 2, 4, 7, 10].includes(s)) {
      const mel = [[76, 74, 72, 71, 72], [74, 72, 71, 69, 71], [72, 71, 69, 67, 69], [71, 69, 68, 68, 64]][bar];
      this.note(mel[[0, 2, 4, 7, 10].indexOf(s)], t, spb * 2.5, 'square', 0.05, 2600);
    }
  }

  /** Wave 93: darkwave lenta en re menor con pads y arpegio. */
  private darkwave(step: number, t: number, spb: number) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const chords = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]];
    const ch = chords[bar];
    if (s === 0) ch.forEach((n) => this.note(n, t, spb * 15, 'sawtooth', 0.05, 900));
    if (s % 2 === 0) this.note(ch[(s / 2) % 3] + 12 + (s % 8 === 6 ? 12 : 0), t, spb * 1.5, 'square', 0.04, 1800);
    if (s % 4 === 0) this.note(ch[0] - 12, t, spb * 3, 'triangle', 0.25, 400);
    if (s === 0 || s === 10) this.kick(t);
    if (s === 4 || s === 12) {
      const { s: src, g } = this.burst(0.25, 1200, 0.2, 'bandpass', t);
      g.connect(this.musicGain);
      src.start(t, Math.random() * 0.5, 0.3);
    }
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.musicGain);
    o.start(t);
    o.stop(t + 0.22);
  }
}
