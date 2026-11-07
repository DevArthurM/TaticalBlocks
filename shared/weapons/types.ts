export type WeaponCategory = 'melee' | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'heavy' | 'throwable';
export type LoadoutSlot = 'primary' | 'secondary' | 'melee' | 'grenade';
export type Tier = 1 | 2 | 3 | 4 | 5;

export type FireMode = 'semi' | 'auto' | 'burst' | 'pump' | 'bolt';
export type SightType = 'iron' | 'reddot' | 'scope' | 'none';
export type ShellType = 'pistol' | 'rifle' | 'shotgun' | 'none';
export type SoundProfile =
  | 'pistol'
  | 'heavyPistol'
  | 'smg'
  | 'rifle'
  | 'shotgun'
  | 'sniper'
  | 'lmg'
  | 'minigun'
  | 'rocket'
  | 'launcher';
export type ProjectileKind = 'rocket' | 'grenade40';
export type MeleeStyle = 'stab' | 'chop' | 'smash';
export type ThrowableEffect = 'frag' | 'flash' | 'fire';

/** `magazine`: troca o pente inteiro. `shell`: insere munição uma a uma. */
export type ReloadSpec =
  | { kind: 'magazine'; time: number }
  | { kind: 'shell'; startTime: number; insertTime: number; endTime: number };

interface BaseDef {
  id: string;
  name: string;
  category: WeaponCategory;
  slot: LoadoutSlot;
  tier: Tier;
  description: string;
  /** Multiplicador da velocidade de movimento. */
  moveSpeed: number;
}

export interface FirearmDef extends BaseDef {
  kind: 'firearm';
  fireMode: FireMode;
  /** Disparos por minuto. */
  rpm: number;
  burstCount?: number;
  damage: number;
  /** Projéteis por disparo (escopetas > 1). */
  pellets: number;
  magazineSize: number;
  /** `null` = reserva infinita (fase de testes). */
  reserveAmmo: number | null;
  reload: ReloadSpec;
  range: number;
  /** Dispersão em radianos. */
  hipSpread: number;
  adsSpread: number;
  recoil: { pitch: number; yaw: number };
  adsFov: number;
  sight: SightType;
  shell: ShellType;
  sound: SoundProfile;
  projectile?: ProjectileKind;
  /** Segundos até girar totalmente (minigun). */
  spinUp?: number;
  /**
   * Tensão do braço: cada disparo aplica `force` (rad/s) no braço e a mola
   * (`tension`, `damping`) o traz de volta à posição inicial. Afeta a mira.
   */
  armSpring: ArmSpring;
}

export interface ArmSpring {
  /** Impulso angular por disparo (rad/s). */
  force: number;
  /** Rigidez da mola: quanto maior, mais rápido volta. */
  tension: number;
  /** Amortecimento: quanto maior, menos oscila. */
  damping: number;
}

export interface MeleeDef extends BaseDef {
  kind: 'melee';
  damage: number;
  range: number;
  swingTime: number;
  style: MeleeStyle;
}

export interface ThrowableDef extends BaseDef {
  kind: 'throwable';
  effect: ThrowableEffect;
  /** Segundos até explodir; `null` = explode no impacto. */
  fuse: number | null;
  radius: number;
  damage: number;
}

export type WeaponDef = FirearmDef | MeleeDef | ThrowableDef;
