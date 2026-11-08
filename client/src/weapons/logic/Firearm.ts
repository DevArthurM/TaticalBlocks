import type { FirearmDef } from '@shared/weapons/types';

export type ReloadPhase = 'full' | 'start' | 'insert' | 'end';

export interface ReloadState {
  phase: ReloadPhase;
  /** 0..1 dentro da fase atual. */
  progress: number;
  fromEmpty: boolean;
}

export type FireResult = 'fired' | 'empty' | 'none';

/** Lógica de uma arma de fogo: munição, cadência, modos de disparo e recarga. */
export class Firearm {
  ammo: number;
  reserve: number;
  /** Rotação da minigun (0..1). */
  spin = 0;
  /** Tempo restante da ação manual (pump/ferrolho). */
  cycleTime = 0;

  private cooldown = 0;
  private burstLeft = 0;
  private reload: { phase: ReloadPhase; elapsed: number; duration: number; fromEmpty: boolean; stop: boolean } | null = null;

  /** Atributos atuais (com acessórios). */
  constructor(public def: FirearmDef) {
    this.ammo = def.magazineSize;
    this.reserve = def.reserveAmmo ?? Number.POSITIVE_INFINITY;
  }

  get shotInterval(): number {
    return 60 / this.def.rpm;
  }

  get reloading(): boolean {
    return this.reload !== null;
  }

  get reloadState(): ReloadState | null {
    const r = this.reload;
    if (!r) return null;
    return { phase: r.phase, progress: Math.min(1, r.elapsed / r.duration), fromEmpty: r.fromEmpty };
  }

  /** Progresso total aproximado (para a barra do HUD). */
  get reloadProgress(): number {
    const r = this.reload;
    if (!r) return 0;
    if (r.phase === 'full') return Math.min(1, r.elapsed / r.duration);
    return this.ammo / this.def.magazineSize;
  }

  get manualAction(): boolean {
    return this.def.fireMode === 'pump' || this.def.fireMode === 'bolt';
  }

  /**
   * Processa o gatilho. `pressed` = clicou neste frame; `held` = segurando.
   * Retorna quantos tiros saíram (pode ser > 1 em cadências altas).
   */
  trigger(pressed: boolean, held: boolean): { shots: number; dry: boolean } {
    const def = this.def;
    if (this.reload) {
      // Atirar durante recarga cartucho-a-cartucho interrompe após o cartucho atual.
      if (pressed && this.reload.phase === 'insert' && this.ammo > 0) this.reload.stop = true;
      return { shots: 0, dry: false };
    }
    if (def.spinUp && this.spin < 1) return { shots: 0, dry: false };

    let wants = false;
    if (def.fireMode === 'auto') wants = held;
    else if (def.fireMode === 'burst') {
      if (pressed && this.burstLeft === 0 && this.cooldown <= 0) this.burstLeft = def.burstCount ?? 3;
      wants = this.burstLeft > 0;
    } else wants = pressed;

    if (!wants || this.cooldown > 0 || this.cycleTime > 0) return { shots: 0, dry: false };
    if (this.ammo <= 0) {
      this.cooldown = 0.25;
      this.burstLeft = 0;
      return { shots: 0, dry: pressed };
    }

    let shots = 0;
    // permite vários tiros por frame em cadências muito altas
    while (this.cooldown <= 0 && this.ammo > 0 && shots < 4) {
      this.ammo--;
      shots++;
      this.cooldown += this.shotInterval;
      if (def.fireMode === 'burst') {
        this.burstLeft--;
        if (this.burstLeft <= 0) {
          this.cooldown += 0.22;
          break;
        }
      }
      if (def.fireMode !== 'auto' && def.fireMode !== 'burst') break;
    }
    if (this.manualAction && this.ammo > 0) this.cycleTime = this.shotInterval * 0.9;
    return { shots, dry: false };
  }

  startReload(): boolean {
    if (this.reload || this.ammo >= this.def.magazineSize || this.reserve <= 0) return false;
    const r = this.def.reload;
    const fromEmpty = this.ammo === 0;
    this.burstLeft = 0;
    this.cycleTime = 0;
    this.reload =
      r.kind === 'magazine'
        ? { phase: 'full', elapsed: 0, duration: r.time, fromEmpty, stop: false }
        : { phase: 'start', elapsed: 0, duration: r.startTime, fromEmpty, stop: false };
    return true;
  }

  cancelReload(): void {
    this.reload = null;
  }

  /** Avança timers. Retorna eventos ocorridos neste frame. */
  update(dt: number, triggerHeld: boolean): { reloaded: boolean; shellInserted: boolean } {
    const def = this.def;
    this.cooldown = Math.max(-0.05, this.cooldown - dt);
    if (this.cooldown < 0 && !triggerHeld) this.cooldown = 0;
    this.cycleTime = Math.max(0, this.cycleTime - dt);
    if (def.spinUp) {
      const target = triggerHeld && !this.reload ? 1 : 0;
      this.spin = Math.max(0, Math.min(1, this.spin + (target ? dt / def.spinUp : -dt / (def.spinUp * 1.8))));
    }

    const result = { reloaded: false, shellInserted: false };
    const r = this.reload;
    if (!r) return result;
    r.elapsed += dt;
    if (r.elapsed < r.duration) return result;

    const spec = def.reload;
    if (spec.kind === 'magazine' || r.phase === 'end') {
      if (spec.kind === 'magazine') {
        const taken = Math.min(def.magazineSize - this.ammo, this.reserve);
        this.ammo += taken;
        if (Number.isFinite(this.reserve)) this.reserve -= taken;
      }
      this.reload = null;
      result.reloaded = true;
      return result;
    }

    if (r.phase === 'insert') {
      this.ammo++;
      if (Number.isFinite(this.reserve)) this.reserve--;
      result.shellInserted = true;
    }
    const full = this.ammo >= def.magazineSize || this.reserve <= 0;
    if (r.phase === 'start' || (r.phase === 'insert' && !full && !r.stop)) {
      r.phase = 'insert';
      r.elapsed = 0;
      r.duration = spec.insertTime;
    } else {
      r.phase = 'end';
      r.elapsed = 0;
      r.duration = spec.endTime;
    }
    return result;
  }
}
