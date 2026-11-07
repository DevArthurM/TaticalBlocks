import type { ArmSpring, FirearmDef, MeleeDef, ThrowableDef, WeaponCategory, WeaponDef } from './types';

const INF = null;

/** Tensão base do braço por categoria (rigidez da mola). */
const BASE_TENSION: Record<WeaponCategory, number> = {
  pistol: 110, smg: 160, rifle: 130, shotgun: 80, sniper: 70, heavy: 150, melee: 0, throwable: 0,
};

/** Mola com ~22% de oscilação (amortecimento ζ ≈ 0,78). */
export const spring = (force: number, tension: number, zeta = 0.78): ArmSpring => ({
  force,
  tension,
  damping: 2 * Math.sqrt(tension) * zeta,
});

type FirearmInput = Omit<FirearmDef, 'kind' | 'reserveAmmo' | 'pellets' | 'armSpring'> & {
  pellets?: number;
  armSpring?: ArmSpring;
};
const gun = (d: FirearmInput): FirearmDef => ({
  kind: 'firearm',
  reserveAmmo: INF,
  pellets: 1,
  ...d,
  // padrão: força proporcional ao recuo, tensão da categoria
  armSpring: d.armSpring ?? spring(d.recoil.pitch * 55, BASE_TENSION[d.category]),
});
const melee = (d: Omit<MeleeDef, 'kind' | 'category' | 'slot'>): MeleeDef => ({
  kind: 'melee',
  category: 'melee',
  slot: 'melee',
  ...d,
});
const throwable = (d: Omit<ThrowableDef, 'kind' | 'category' | 'slot'>): ThrowableDef => ({
  kind: 'throwable',
  category: 'throwable',
  slot: 'grenade',
  ...d,
});

const mag = (time: number) => ({ kind: 'magazine' as const, time });
const shells = (startTime: number, insertTime: number, endTime: number) => ({
  kind: 'shell' as const,
  startTime,
  insertTime,
  endTime,
});

export const WEAPONS: readonly WeaponDef[] = [
  // ───────── Pistolas ─────────
  gun({
    id: 'g17', name: 'G17', armSpring: spring(1.2, 110), category: 'pistol', slot: 'secondary', tier: 1,
    description: 'Pistola de serviço confiável, polímero preto.',
    fireMode: 'semi', rpm: 400, damage: 24, magazineSize: 17, reload: mag(1.5), range: 150,
    hipSpread: 0.014, adsSpread: 0.002, recoil: { pitch: 0.022, yaw: 0.006 }, adsFov: 62,
    sight: 'iron', shell: 'pistol', sound: 'pistol', moveSpeed: 1,
  }),
  gun({
    id: 'g17_inox', name: 'G17 Inox', armSpring: spring(1.05, 125), category: 'pistol', slot: 'secondary', tier: 2,
    description: 'Ferrolho em aço inox polido, gatilho mais leve.',
    fireMode: 'semi', rpm: 430, damage: 25, magazineSize: 17, reload: mag(1.4), range: 150,
    hipSpread: 0.013, adsSpread: 0.0018, recoil: { pitch: 0.02, yaw: 0.005 }, adsFov: 62,
    sight: 'iron', shell: 'pistol', sound: 'pistol', moveSpeed: 1,
  }),
  gun({
    id: 'g34', name: 'G34 Competição', armSpring: spring(0.95, 140, 0.85), category: 'pistol', slot: 'secondary', tier: 3,
    description: 'Cano longo e janela no ferrolho. Precisão de competição.',
    fireMode: 'semi', rpm: 460, damage: 27, magazineSize: 17, reload: mag(1.55), range: 180,
    hipSpread: 0.011, adsSpread: 0.0012, recoil: { pitch: 0.018, yaw: 0.004 }, adsFov: 58,
    sight: 'iron', shell: 'pistol', sound: 'pistol', moveSpeed: 1,
  }),
  gun({
    id: 'g19_fde', name: 'G19 FDE', armSpring: spring(1.4, 100, 0.7), category: 'pistol', slot: 'secondary', tier: 2,
    description: 'Compacta com armação cor areia. Recarga muito rápida.',
    fireMode: 'semi', rpm: 450, damage: 23, magazineSize: 15, reload: mag(1.2), range: 130,
    hipSpread: 0.015, adsSpread: 0.0022, recoil: { pitch: 0.024, yaw: 0.007 }, adsFov: 62,
    sight: 'iron', shell: 'pistol', sound: 'pistol', moveSpeed: 1.02,
  }),
  gun({
    id: 'revolver', name: 'Revólver .357', armSpring: spring(2.8, 65, 0.72), category: 'pistol', slot: 'secondary', tier: 4,
    description: 'Seis tiros devastadores. Recarga com speedloader.',
    fireMode: 'semi', rpm: 160, damage: 70, magazineSize: 6, reload: mag(2.4), range: 170,
    hipSpread: 0.016, adsSpread: 0.0015, recoil: { pitch: 0.065, yaw: 0.012 }, adsFov: 58,
    sight: 'iron', shell: 'none', sound: 'heavyPistol', moveSpeed: 1,
  }),

  // ───────── Submetralhadoras ─────────
  gun({
    id: 'mp7', name: 'MP7', category: 'smg', slot: 'primary', tier: 3,
    description: 'PDW compacta com empunhadura vertical. Alta cadência, pouco recuo.',
    fireMode: 'auto', rpm: 950, damage: 18, magazineSize: 40, reload: mag(2.0), range: 120,
    hipSpread: 0.02, adsSpread: 0.004, recoil: { pitch: 0.009, yaw: 0.006 }, adsFov: 60,
    sight: 'iron', shell: 'pistol', sound: 'smg', moveSpeed: 0.98,
  }),
  gun({
    id: 'mp5k', name: 'MP5K', category: 'smg', slot: 'primary', tier: 2,
    description: 'Clássica encurtada. Recarga com o famoso “tapa” na alavanca.',
    fireMode: 'auto', rpm: 900, damage: 19, magazineSize: 30, reload: mag(2.2), range: 110,
    hipSpread: 0.022, adsSpread: 0.005, recoil: { pitch: 0.011, yaw: 0.007 }, adsFov: 60,
    sight: 'iron', shell: 'pistol', sound: 'smg', moveSpeed: 0.98,
  }),
  gun({
    id: 'tmp', name: 'TMP', category: 'smg', slot: 'primary', tier: 1,
    description: 'Pistola-metralhadora leve com coronha dobrável.',
    fireMode: 'auto', rpm: 1000, damage: 16, magazineSize: 30, reload: mag(1.9), range: 90,
    hipSpread: 0.025, adsSpread: 0.007, recoil: { pitch: 0.01, yaw: 0.009 }, adsFov: 62,
    sight: 'iron', shell: 'pistol', sound: 'smg', moveSpeed: 1,
  }),
  gun({
    id: 'mac10', name: 'MAC-10', armSpring: spring(0.75, 120, 0.6), category: 'smg', slot: 'primary', tier: 1,
    description: 'Caixote de aço que cospe balas. Impreciso, mas brutal de perto.',
    fireMode: 'auto', rpm: 1100, damage: 17, magazineSize: 32, reload: mag(1.8), range: 80,
    hipSpread: 0.03, adsSpread: 0.009, recoil: { pitch: 0.012, yaw: 0.011 }, adsFov: 62,
    sight: 'iron', shell: 'pistol', sound: 'smg', moveSpeed: 1,
  }),
  gun({
    id: 'ump45', name: 'UMP-45', category: 'smg', slot: 'primary', tier: 2,
    description: 'Calibre .45 com mais dano e cadência controlada.',
    fireMode: 'auto', rpm: 650, damage: 26, magazineSize: 25, reload: mag(2.3), range: 120,
    hipSpread: 0.021, adsSpread: 0.0045, recoil: { pitch: 0.013, yaw: 0.007 }, adsFov: 58,
    sight: 'iron', shell: 'pistol', sound: 'smg', moveSpeed: 0.97,
  }),
  gun({
    id: 'p90', name: 'P90', category: 'smg', slot: 'primary', tier: 4,
    description: 'Bullpup com carregador superior de 50 tiros e mira reflex.',
    fireMode: 'auto', rpm: 900, damage: 20, magazineSize: 50, reload: mag(2.7), range: 130,
    hipSpread: 0.018, adsSpread: 0.0035, recoil: { pitch: 0.008, yaw: 0.006 }, adsFov: 56,
    sight: 'reddot', shell: 'pistol', sound: 'smg', moveSpeed: 0.97,
  }),

  // ───────── Fuzis ─────────
  gun({
    id: 'm4a1', name: 'M4A1', category: 'rifle', slot: 'primary', tier: 3,
    description: 'Carabina versátil com alça de transporte e mira de ferro.',
    fireMode: 'auto', rpm: 800, damage: 27, magazineSize: 30, reload: mag(2.3), range: 250,
    hipSpread: 0.022, adsSpread: 0.0025, recoil: { pitch: 0.014, yaw: 0.006 }, adsFov: 55,
    sight: 'iron', shell: 'rifle', sound: 'rifle', moveSpeed: 0.93,
  }),
  gun({
    id: 'ak47', name: 'AK-47', armSpring: spring(1.15, 110, 0.7), category: 'rifle', slot: 'primary', tier: 2,
    description: 'Madeira e aço. Dano alto, recuo forte. Pente “encaixado no tranco”.',
    fireMode: 'auto', rpm: 600, damage: 34, magazineSize: 30, reload: mag(2.6), range: 240,
    hipSpread: 0.026, adsSpread: 0.003, recoil: { pitch: 0.021, yaw: 0.01 }, adsFov: 55,
    sight: 'iron', shell: 'rifle', sound: 'rifle', moveSpeed: 0.92,
  }),
  gun({
    id: 'm16a4', name: 'M16A4', category: 'rifle', slot: 'primary', tier: 2,
    description: 'Fuzil longo de rajada de 3 tiros. Excelente a média distância.',
    fireMode: 'burst', burstCount: 3, rpm: 900, damage: 29, magazineSize: 30, reload: mag(2.4), range: 300,
    hipSpread: 0.024, adsSpread: 0.0018, recoil: { pitch: 0.013, yaw: 0.005 }, adsFov: 52,
    sight: 'iron', shell: 'rifle', sound: 'rifle', moveSpeed: 0.91,
  }),
  gun({
    id: 'hk416', name: 'HK416', armSpring: spring(0.6, 170, 0.9), category: 'rifle', slot: 'primary', tier: 4,
    description: 'Pistão a gás, trilhos e mira red-dot. Recuo muito estável.',
    fireMode: 'auto', rpm: 850, damage: 28, magazineSize: 30, reload: mag(2.1), range: 260,
    hipSpread: 0.02, adsSpread: 0.0018, recoil: { pitch: 0.012, yaw: 0.005 }, adsFov: 52,
    sight: 'reddot', shell: 'rifle', sound: 'rifle', moveSpeed: 0.93,
  }),

  // ───────── Escopetas ─────────
  gun({
    id: 'r870', name: 'Escopeta 870', armSpring: spring(3.6, 60, 0.75), category: 'shotgun', slot: 'primary', tier: 1,
    description: 'Pump-action com coronha de madeira. Recarga cartucho a cartucho.',
    fireMode: 'pump', rpm: 70, damage: 14, pellets: 8, magazineSize: 6, reload: shells(0.4, 0.5, 0.45),
    range: 45, hipSpread: 0.06, adsSpread: 0.045, recoil: { pitch: 0.065, yaw: 0.012 }, adsFov: 62,
    sight: 'iron', shell: 'shotgun', sound: 'shotgun', moveSpeed: 0.93,
  }),
  gun({
    id: 'm590s', name: 'M590 Shorty', armSpring: spring(4.0, 65, 0.72), category: 'shotgun', slot: 'primary', tier: 2,
    description: 'Escopeta tática curta com empunhadura de pistola.',
    fireMode: 'pump', rpm: 85, damage: 13, pellets: 9, magazineSize: 5, reload: shells(0.35, 0.42, 0.4),
    range: 35, hipSpread: 0.07, adsSpread: 0.055, recoil: { pitch: 0.07, yaw: 0.014 }, adsFov: 64,
    sight: 'iron', shell: 'shotgun', sound: 'shotgun', moveSpeed: 0.96,
  }),
  gun({
    id: 'aa12', name: 'AA-12', category: 'shotgun', slot: 'primary', tier: 5,
    description: 'Escopeta totalmente automática com tambor de 20 cartuchos.',
    fireMode: 'auto', rpm: 300, damage: 12, pellets: 8, magazineSize: 20, reload: mag(3.1),
    range: 40, hipSpread: 0.065, adsSpread: 0.05, recoil: { pitch: 0.03, yaw: 0.012 }, adsFov: 58,
    sight: 'reddot', shell: 'shotgun', sound: 'shotgun', moveSpeed: 0.88,
  }),

  // ───────── Precisão ─────────
  gun({
    id: 'hunting', name: 'Rifle de Caça', category: 'sniper', slot: 'primary', tier: 1,
    description: 'Ferrolho manual e coronha de madeira. Munição inserida uma a uma.',
    fireMode: 'bolt', rpm: 50, damage: 80, magazineSize: 5, reload: shells(0.55, 0.5, 0.55), range: 400,
    hipSpread: 0.04, adsSpread: 0.0004, recoil: { pitch: 0.05, yaw: 0.008 }, adsFov: 45,
    sight: 'iron', shell: 'rifle', sound: 'sniper', moveSpeed: 0.92,
  }),
  gun({
    id: 'awm', name: 'AWM', armSpring: spring(3.2, 55, 0.8), category: 'sniper', slot: 'primary', tier: 5,
    description: 'Rifle de precisão com luneta de alta ampliação. Um tiro, um abate.',
    fireMode: 'bolt', rpm: 42, damage: 120, magazineSize: 5, reload: mag(3.3), range: 600,
    hipSpread: 0.06, adsSpread: 0, recoil: { pitch: 0.06, yaw: 0.01 }, adsFov: 12,
    sight: 'scope', shell: 'rifle', sound: 'sniper', moveSpeed: 0.85,
  }),
  gun({
    id: 'sr25', name: 'SR-25 DMR', category: 'sniper', slot: 'primary', tier: 4,
    description: 'Rifle designado semiautomático com luneta média.',
    fireMode: 'semi', rpm: 300, damage: 55, magazineSize: 20, reload: mag(2.7), range: 450,
    hipSpread: 0.035, adsSpread: 0.0006, recoil: { pitch: 0.03, yaw: 0.008 }, adsFov: 25,
    sight: 'scope', shell: 'rifle', sound: 'sniper', moveSpeed: 0.88,
  }),

  // ───────── Pesadas ─────────
  gun({
    id: 'm249', name: 'M249', category: 'heavy', slot: 'primary', tier: 4,
    description: 'Metralhadora leve com cinta de 100 tiros e bipé.',
    fireMode: 'auto', rpm: 750, damage: 26, magazineSize: 100, reload: mag(5.0), range: 260,
    hipSpread: 0.03, adsSpread: 0.008, recoil: { pitch: 0.011, yaw: 0.009 }, adsFov: 56,
    sight: 'iron', shell: 'rifle', sound: 'lmg', moveSpeed: 0.8,
  }),
  gun({
    id: 'minigun', name: 'Minigun M134', armSpring: spring(0.18, 230, 0.95), category: 'heavy', slot: 'primary', tier: 5,
    description: 'Seis canos rotativos. Precisa girar antes de disparar.',
    fireMode: 'auto', rpm: 2400, damage: 16, magazineSize: 300, reload: mag(5.5), range: 200,
    hipSpread: 0.045, adsSpread: 0.045, recoil: { pitch: 0.004, yaw: 0.004 }, adsFov: 75,
    sight: 'none', shell: 'rifle', sound: 'minigun', moveSpeed: 0.65, spinUp: 0.7,
  }),
  gun({
    id: 'rpg7', name: 'RPG-7', armSpring: spring(4.5, 45, 0.85), category: 'heavy', slot: 'primary', tier: 4,
    description: 'Lança-foguetes de ombro. Dano em área enorme.',
    fireMode: 'semi', rpm: 30, damage: 150, magazineSize: 1, reload: mag(2.9), range: 300,
    hipSpread: 0.02, adsSpread: 0.004, recoil: { pitch: 0.09, yaw: 0.01 }, adsFov: 55,
    sight: 'iron', shell: 'none', sound: 'rocket', moveSpeed: 0.8, projectile: 'rocket',
  }),
  gun({
    id: 'm32', name: 'M32 MGL', category: 'heavy', slot: 'primary', tier: 4,
    description: 'Lança-granadas de tambor com 6 cargas de 40 mm.',
    fireMode: 'semi', rpm: 120, damage: 100, magazineSize: 6, reload: shells(0.7, 0.45, 0.6), range: 200,
    hipSpread: 0.02, adsSpread: 0.006, recoil: { pitch: 0.05, yaw: 0.01 }, adsFov: 58,
    sight: 'iron', shell: 'none', sound: 'launcher', moveSpeed: 0.85, projectile: 'grenade40',
  }),

  // ───────── Brancas ─────────
  melee({
    id: 'knife', name: 'Faca de Combate', tier: 1, style: 'stab',
    description: 'Rápida e leve. Você corre mais com ela na mão.',
    damage: 45, range: 1.8, swingTime: 0.42, moveSpeed: 1.08,
  }),
  melee({
    id: 'hatchet', name: 'Machadinha', tier: 2, style: 'chop',
    description: 'Golpe diagonal pesado com bom alcance.',
    damage: 65, range: 2.0, swingTime: 0.62, moveSpeed: 1.04,
  }),
  melee({
    id: 'sledge', name: 'Marreta', tier: 3, style: 'smash',
    description: 'Lenta, mas cada golpe faz o chão tremer.',
    damage: 110, range: 2.3, swingTime: 1.05, moveSpeed: 0.92,
  }),

  // ───────── Arremessáveis ─────────
  throwable({
    id: 'frag', name: 'Granada de Fragmentação', tier: 2, effect: 'frag',
    description: 'Quica no chão e explode após 3 segundos.',
    fuse: 3, radius: 7, damage: 120, moveSpeed: 1,
  }),
  throwable({
    id: 'flash', name: 'Granada de Atordoamento', tier: 2, effect: 'flash',
    description: 'Clarão que cega quem estiver olhando.',
    fuse: 1.8, radius: 18, damage: 0, moveSpeed: 1,
  }),
  throwable({
    id: 'molotov', name: 'Coquetel Molotov', tier: 3, effect: 'fire',
    description: 'Quebra no impacto e espalha fogo por alguns segundos.',
    fuse: null, radius: 3, damage: 15, moveSpeed: 1,
  }),
];

const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

export function findWeapon(id: string | null | undefined): WeaponDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}
