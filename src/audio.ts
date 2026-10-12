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
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, this.ctx!.currentTime, 0.1);
    return this.musicOn;
  }

  /** speed en m/s; throttle 0..1. Simula un cambio de 5 marchas. */
  setEngine(speed: number, throttle: number, skid: number) {
    if (!this.ctx) return;
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
    const spb = 60 / 116 / 4; // semicorchea
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (this.musicOn) this.playStep(this.step, this.nextTime, spb);
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
