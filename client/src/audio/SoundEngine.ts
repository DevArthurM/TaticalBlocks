import type { SoundProfile } from '@shared/weapons/types';

export type SoundName =
  | 'dryFire'
  | 'magOut'
  | 'magIn'
  | 'slideBack'
  | 'slideRelease'
  | 'chargeBack'
  | 'chargeRelease'
  | 'cylinderOpen'
  | 'cylinderClose'
  | 'casings'
  | 'shellInsert'
  | 'pumpBack'
  | 'pumpForward'
  | 'boltUp'
  | 'boltBack'
  | 'boltForward'
  | 'boltDown'
  | 'coverOpen'
  | 'coverClose'
  | 'beltIn'
  | 'spinUp'
  | 'rocketSlide'
  | 'rocketLoad'
  | 'swing'
  | 'swingHeavy'
  | 'meleeHit'
  | 'pinPull'
  | 'ignite'
  | 'throw'
  | 'draw'
  | 'bounce'
  | 'explosion'
  | 'flashbang'
  | 'glass'
  | 'fire'
  | 'hitConcrete'
  | 'hitWood'
  | 'hitMetal'
  | 'hitPlastic'
  | 'flesh'
  | 'gore'
  | 'zombieGroan'
  | 'zombieAttack'
  | 'zombieDeath'
  | 'playerHurt'
  | 'step'
  | 'stepRun'
  | 'boardBreak'
  | 'hammer'
  | 'hitmarker'
  | 'slide';

interface ShotSpec {
  /** Volume do estampido de ruído. */
  crack: number;
  /** Frequência inicial do filtro passa-baixa. */
  bright: number;
  decay: number;
  /** "Corpo" grave. */
  thump: number;
  thumpFreq: number;
}

const SHOTS: Record<SoundProfile, ShotSpec> = {
  pistol: { crack: 0.9, bright: 5200, decay: 0.2, thump: 0.8, thumpFreq: 140 },
  heavyPistol: { crack: 1.1, bright: 4200, decay: 0.35, thump: 1.1, thumpFreq: 100 },
  smg: { crack: 0.7, bright: 6000, decay: 0.12, thump: 0.5, thumpFreq: 160 },
  rifle: { crack: 1, bright: 6500, decay: 0.22, thump: 0.9, thumpFreq: 120 },
  shotgun: { crack: 1.2, bright: 3500, decay: 0.4, thump: 1.3, thumpFreq: 80 },
  sniper: { crack: 1.25, bright: 7000, decay: 0.55, thump: 1.2, thumpFreq: 90 },
  lmg: { crack: 0.95, bright: 5500, decay: 0.2, thump: 0.9, thumpFreq: 115 },
  minigun: { crack: 0.45, bright: 6000, decay: 0.08, thump: 0.35, thumpFreq: 150 },
  rocket: { crack: 0.8, bright: 2200, decay: 0.7, thump: 1.2, thumpFreq: 70 },
  launcher: { crack: 0.5, bright: 1800, decay: 0.15, thump: 1.0, thumpFreq: 90 },
};

/** Efeitos sonoros sintetizados com WebAudio (sem arquivos). */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Destino dos sons em síntese (master, ou um panner durante `at`). */
  private out: AudioNode | null = null;
  /** Ouvinte (câmera) para sons posicionados. */
  private listenerX = 0;
  private listenerZ = 0;
  private listenerYaw = 0;

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      this.noise = this.createNoise(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Posição/direção do ouvinte (chamar todo quadro). */
  setListener(x: number, z: number, yaw: number): void {
    this.listenerX = x;
    this.listenerZ = z;
    this.listenerYaw = yaw;
  }

  /**
   * Toca `fn` como se viesse do ponto (x, z): volume cai com a distância até `range`,
   * panorâmica esquerda/direita pela direção e agudos abafados de longe.
   * @returns false se estiver longe demais para ouvir
   */
  at(x: number, z: number, range: number, fn: (volume: number) => void): boolean {
    if (!this.ready()) return false;
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const dist = Math.hypot(dx, dz);
    if (dist > range) return false;
    const ctx = this.ctx!;
    const fx = -Math.sin(this.listenerYaw);
    const fz = -Math.cos(this.listenerYaw);
    const side = dist > 0.01 ? (dx * -fz + dz * fx) / dist : 0; // -1 esquerda … 1 direita
    const near = 1 - dist / range;
    const pan = ctx.createStereoPanner();
    pan.pan.value = side * Math.min(0.85, 0.25 + dist / 12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200 + 16000 * near * near;
    pan.connect(lp).connect(this.master!);
    this.out = pan;
    try {
      fn(Math.max(0.02, near * near * 0.85 + near * 0.15));
    } finally {
      this.out = null;
    }
    // libera os nós quando os sons terminam
    setTimeout(() => {
      pan.disconnect();
      lp.disconnect();
    }, 3000);
    return true;
  }

  /** `volume` < 1 para sons distantes. */
  /** `suppressed`: silenciador — estalo abafado e grave, bem mais baixo. */
  shot(profile: SoundProfile, volume = 1, suppressed = false): void {
    if (!this.ready()) return;
    const s = SHOTS[profile];
    if (suppressed) {
      this.noiseBurst({ filter: 'lowpass', freq: Math.min(1800, s.bright * 0.3), endFreq: 300, vol: s.crack * volume * 0.32, dur: s.decay * 0.55 });
      this.tone(s.thumpFreq * 0.8, s.decay * 0.4, s.thump * volume * 0.25, 'sine', 0.4);
      this.click(5200, 0.012, 0.2 * volume); // mecânica da arma
      return;
    }
    this.noiseBurst({ filter: 'lowpass', freq: s.bright, endFreq: 400, vol: s.crack * volume, dur: s.decay });
    this.tone(s.thumpFreq, s.decay * 0.7, s.thump * volume, 'sine', 0.3);
    if (profile === 'rocket') this.noiseBurst({ filter: 'bandpass', freq: 900, vol: 0.6 * volume, dur: 1.1, q: 0.6 });
  }

  play(name: SoundName, volume = 1): void {
    if (!this.ready()) return;
    const v = volume;
    switch (name) {
      case 'dryFire':
        return this.click(3200, 0.025, 0.35 * v);
      case 'magOut':
        this.click(1400, 0.04, 0.4 * v);
        return this.click(900, 0.05, 0.25 * v, 0.05);
      case 'magIn':
        this.tone(180, 0.06, 0.5 * v);
        return this.click(2200, 0.03, 0.5 * v, 0.01);
      case 'slideBack':
      case 'chargeBack':
        return this.noiseBurst({ filter: 'bandpass', freq: 2400, endFreq: 1200, vol: 0.35 * v, dur: 0.08, q: 2 });
      case 'slideRelease':
      case 'chargeRelease':
        this.click(1800, 0.05, 0.45 * v);
        return this.click(2600, 0.03, 0.55 * v, 0.04);
      case 'cylinderOpen':
      case 'coverOpen':
        return this.click(1200, 0.06, 0.4 * v);
      case 'cylinderClose':
      case 'coverClose':
        this.tone(220, 0.05, 0.4 * v);
        return this.click(1600, 0.04, 0.5 * v);
      case 'casings':
        for (let i = 0; i < 6; i++) this.click(4000 + Math.random() * 2000, 0.03, 0.18 * v, 0.05 + Math.random() * 0.3);
        return;
      case 'shellInsert':
        this.click(1500, 0.04, 0.4 * v);
        return this.tone(260, 0.04, 0.25 * v);
      case 'pumpBack':
        return this.noiseBurst({ filter: 'bandpass', freq: 1300, endFreq: 700, vol: 0.5 * v, dur: 0.1, q: 2 });
      case 'pumpForward':
        this.noiseBurst({ filter: 'bandpass', freq: 900, endFreq: 1600, vol: 0.5 * v, dur: 0.08, q: 2 });
        return this.click(2000, 0.03, 0.4 * v, 0.07);
      case 'boltUp':
      case 'boltDown':
        return this.click(2400, 0.03, 0.35 * v);
      case 'boltBack':
      case 'boltForward':
        return this.noiseBurst({ filter: 'bandpass', freq: 2800, endFreq: 1800, vol: 0.35 * v, dur: 0.07, q: 3 });
      case 'beltIn':
        for (let i = 0; i < 4; i++) this.click(3000, 0.02, 0.2 * v, i * 0.03);
        return;
      case 'spinUp':
        return this.tone(80, 0.5, 0.25 * v, 'sawtooth', 4);
      case 'rocketSlide':
        return this.noiseBurst({ filter: 'bandpass', freq: 600, vol: 0.3 * v, dur: 0.25, q: 1.5 });
      case 'rocketLoad':
        this.tone(140, 0.08, 0.5 * v);
        return this.click(1400, 0.04, 0.5 * v, 0.02);
      case 'swing':
        return this.noiseBurst({ filter: 'bandpass', freq: 700, endFreq: 2000, vol: 0.35 * v, dur: 0.18, q: 1.2 });
      case 'swingHeavy':
        return this.noiseBurst({ filter: 'bandpass', freq: 400, endFreq: 1000, vol: 0.5 * v, dur: 0.3, q: 1 });
      case 'meleeHit':
        this.tone(120, 0.12, 0.8 * v);
        return this.noiseBurst({ filter: 'lowpass', freq: 2500, endFreq: 300, vol: 0.6 * v, dur: 0.12 });
      case 'pinPull':
        this.click(3500, 0.02, 0.35 * v);
        return this.click(5000, 0.02, 0.25 * v, 0.06);
      case 'ignite':
        return this.noiseBurst({ filter: 'bandpass', freq: 1500, vol: 0.35 * v, dur: 0.4, q: 0.8 });
      case 'throw':
        return this.noiseBurst({ filter: 'bandpass', freq: 500, endFreq: 1400, vol: 0.3 * v, dur: 0.2, q: 1 });
      case 'draw':
        return this.noiseBurst({ filter: 'bandpass', freq: 1800, vol: 0.15 * v, dur: 0.08, q: 2 });
      case 'bounce':
        return this.click(1100, 0.05, 0.35 * v);
      case 'explosion':
        this.noiseBurst({ filter: 'lowpass', freq: 3000, endFreq: 150, vol: 1.4 * v, dur: 1.4 });
        return this.tone(60, 0.9, 1.4 * v, 'sine', 0.25);
      case 'flashbang':
        this.noiseBurst({ filter: 'highpass', freq: 1500, vol: 1.2 * v, dur: 0.6 });
        return this.tone(90, 0.4, 1 * v);
      case 'glass':
        for (let i = 0; i < 8; i++) this.click(3000 + Math.random() * 4000, 0.04, 0.3 * v, Math.random() * 0.15);
        return;
      case 'hitConcrete':
        this.noiseBurst({ filter: 'lowpass', freq: 2200, endFreq: 400, vol: 0.45 * v, dur: 0.09 });
        return this.tone(140, 0.05, 0.25 * v);
      case 'hitWood':
        this.noiseBurst({ filter: 'bandpass', freq: 650, endFreq: 380, vol: 0.5 * v, dur: 0.1, q: 2 });
        return this.tone(210, 0.06, 0.35 * v, 'triangle', 0.6);
      case 'hitMetal':
        this.tone(1650 + Math.random() * 500, 0.22, 0.22 * v, 'square', 0.97);
        this.tone(2900 + Math.random() * 700, 0.14, 0.12 * v, 'sine', 0.98);
        return this.click(5200, 0.03, 0.4 * v);
      case 'hitPlastic':
        this.noiseBurst({ filter: 'bandpass', freq: 1900, endFreq: 1100, vol: 0.4 * v, dur: 0.06, q: 3 });
        return this.tone(420, 0.04, 0.2 * v, 'triangle', 0.8);
      case 'flesh':
        this.noiseBurst({ filter: 'lowpass', freq: 900, endFreq: 200, vol: 0.55 * v, dur: 0.09 });
        return this.tone(110, 0.07, 0.35 * v);
      case 'gore':
        this.noiseBurst({ filter: 'bandpass', freq: 500, endFreq: 150, vol: 0.7 * v, dur: 0.22, q: 1.2 });
        for (let i = 0; i < 4; i++) this.click(700 + Math.random() * 400, 0.04, 0.25 * v, 0.03 + i * 0.04);
        return this.tone(80, 0.18, 0.5 * v);
      case 'zombieGroan': {
        const f = 70 + Math.random() * 40;
        this.tone(f, 0.9 + Math.random() * 0.5, 0.18 * v, 'sawtooth', 0.7 + Math.random() * 0.2);
        return this.noiseBurst({ filter: 'bandpass', freq: 350, endFreq: 220, vol: 0.12 * v, dur: 0.9, q: 3 });
      }
      case 'zombieAttack':
        this.noiseBurst({ filter: 'bandpass', freq: 400, endFreq: 900, vol: 0.4 * v, dur: 0.18, q: 1.5 });
        return this.tone(140, 0.25, 0.25 * v, 'sawtooth', 0.6);
      case 'zombieDeath':
        this.tone(95, 0.7, 0.3 * v, 'sawtooth', 0.4);
        return this.noiseBurst({ filter: 'lowpass', freq: 700, endFreq: 120, vol: 0.3 * v, dur: 0.6 });
      case 'slide':
        // atrito longo no chão (ruído grave que vai sumindo) + tecido
        this.noiseBurst({ filter: 'lowpass', freq: 900, endFreq: 260, vol: 0.55 * v, dur: 0.75, q: 0.7 });
        return this.noiseBurst({ filter: 'bandpass', freq: 2600, endFreq: 1400, vol: 0.18 * v, dur: 0.35, q: 1.2 });
      case 'hitmarker':
        // estalo seco e agudo (confirmação de acerto)
        this.click(3200, 0.025, 0.55 * v);
        return this.tone(1900, 0.05, 0.25 * v, 'square', 0.6);
      case 'boardBreak':
        this.noiseBurst({ filter: 'bandpass', freq: 900, endFreq: 300, vol: 0.7 * v, dur: 0.18, q: 1.5 });
        for (let i = 0; i < 3; i++) this.click(1500 + Math.random() * 1500, 0.03, 0.35 * v, 0.02 + i * 0.05);
        return this.tone(160, 0.12, 0.35 * v, 'triangle', 0.5);
      case 'hammer':
        this.tone(260, 0.06, 0.5 * v, 'triangle', 0.6);
        this.click(2400, 0.03, 0.45 * v);
        this.tone(250, 0.06, 0.45 * v, 'triangle', 0.6, 0.18);
        return this.click(2300, 0.03, 0.4 * v, 0.18);
      case 'playerHurt':
        this.tone(220, 0.12, 0.35 * v, 'square', 0.6);
        return this.noiseBurst({ filter: 'lowpass', freq: 1200, endFreq: 300, vol: 0.4 * v, dur: 0.15 });
      case 'step':
        // passo: baque grave da bota + raspado curto no chão
        this.tone(70 + Math.random() * 25, 0.07, 0.5 * v, 'sine', 0.5);
        return this.noiseBurst({ filter: 'bandpass', freq: 500 + Math.random() * 400, vol: 0.45 * v, dur: 0.07, q: 1.4 });
      case 'stepRun':
        this.tone(65 + Math.random() * 25, 0.09, 0.7 * v, 'sine', 0.45);
        this.noiseBurst({ filter: 'bandpass', freq: 650 + Math.random() * 500, vol: 0.6 * v, dur: 0.09, q: 1.2 });
        return this.click(2600 + Math.random() * 1500, 0.02, 0.12 * v, 0.03); // equipamento chacoalhando
      case 'fire':
        return this.noiseBurst({ filter: 'lowpass', freq: 1200, endFreq: 300, vol: 0.8 * v, dur: 1 });
    }
  }

  private ready(): boolean {
    return !!this.ctx && !!this.master;
  }

  private noiseBurst(o: { filter: BiquadFilterType; freq: number; endFreq?: number; vol: number; dur: number; q?: number; delay?: number }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.endFreq) f.frequency.exponentialRampToValueAtTime(o.endFreq, t + o.dur);
    if (o.q) f.Q.value = o.q;
    src.connect(f).connect(this.env(t, o.vol, o.dur)).connect(this.out ?? this.master!);
    src.start(t);
    src.stop(t + o.dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', endRatio = 0.3, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * endRatio, t + dur);
    osc.connect(this.env(t, vol, dur)).connect(this.out ?? this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private click(freq: number, dur: number, vol: number, delay = 0): void {
    this.noiseBurst({ filter: 'bandpass', freq, vol, dur, q: 4, delay });
  }

  private env(t: number, peak: number, dur: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  private createNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
