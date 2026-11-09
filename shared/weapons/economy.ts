import { ATTACHMENTS, type AttachmentId, attachmentOptions } from './attachments';
import { findWeapon } from './catalog';
import type { FirearmDef, WeaponCategory, WeaponDef } from './types';

/**
 * Economia do modo zumbis: todo mundo começa com $0 e só a faca. Matar zumbis dá
 * dinheiro, que compra armas, munição, granadas e acessórios na loja (B).
 * Usado pelo cliente (solo e loja) e pelo servidor (saldo autoritativo no online).
 */

export const START_MONEY = 0;
/** O que o jogador tem ao começar. */
export const START_WEAPONS: readonly string[] = ['knife'];

/** Recompensa por abate, por tipo (0 comum, 1 corredor, 2 forte) + bônus na cabeça. */
export const KILL_REWARD: readonly number[] = [60, 80, 200];
export const HEADSHOT_BONUS = 40;
export const killReward = (kind: number, head: boolean): number => (KILL_REWARD[kind] ?? KILL_REWARD[0]) + (head ? HEADSHOT_BONUS : 0);

/** Munição: a arma vem com 2 pentes de reserva; cada pacote dá +3 pentes (até 8). */
export const AMMO = { startMags: 2, packMags: 3, maxMags: 8 } as const;
/** Granadas: máximo carregado. */
export const MAX_SHOP_GRENADES = 4;

const CATEGORY_PRICE: Record<WeaponCategory, { base: number; tier: number }> = {
  pistol: { base: 200, tier: 150 },
  smg: { base: 700, tier: 250 },
  rifle: { base: 1100, tier: 350 },
  shotgun: { base: 900, tier: 300 },
  sniper: { base: 1000, tier: 350 },
  heavy: { base: 2500, tier: 600 },
  melee: { base: 0, tier: 300 },
  throwable: { base: 150, tier: 60 },
};

/** Preço da arma (faca é de graça). Granadas: preço por unidade. */
export function weaponPrice(def: WeaponDef): number {
  if (START_WEAPONS.includes(def.id)) return 0;
  const p = CATEGORY_PRICE[def.category];
  return Math.round((p.base + p.tier * def.tier) / 10) * 10;
}

/** Pacote de munição (+`AMMO.packMags` pentes). */
export function ammoPrice(def: FirearmDef): number {
  return Math.max(50, Math.round((weaponPrice(def) * 0.18) / 10) * 10);
}

export const ATTACHMENT_PRICE: Record<AttachmentId, number> = {
  holo: 300,
  cog: 600,
  x2: 450,
  suppressor: 500,
  extmag: 600,
  flashlight: 150,
  laser: 250,
  vgrip: 350,
  agrip: 350,
};

/**
 * Itens da loja (texto, para a rede):
 * `w:<arma>` arma · `m:<arma>` munição · `g:<granada>` uma granada · `a:<arma>:<acessório>`.
 */
export function itemPrice(item: string): number | null {
  const [kind, id, extra] = item.split(':');
  const def = findWeapon(id ?? '');
  if (!def) return null;
  if (kind === 'w' && def.kind !== 'throwable') return weaponPrice(def);
  if (kind === 'm' && def.kind === 'firearm') return ammoPrice(def);
  if (kind === 'g' && def.kind === 'throwable') return weaponPrice(def);
  if (kind === 'a' && extra && extra in ATTACHMENTS) {
    const opts = attachmentOptions(def);
    const att = extra as AttachmentId;
    return opts[ATTACHMENTS[att].slot]?.includes(att) ? ATTACHMENT_PRICE[att] : null;
  }
  return null;
}

/** Reserva inicial e máxima de uma arma no modo zumbis. */
export const startReserve = (def: FirearmDef): number => def.magazineSize * AMMO.startMags;
export const maxReserve = (def: FirearmDef): number => def.magazineSize * AMMO.maxMags;

/** Formata dinheiro: $1.250 */
export const money = (n: number): string => `$${Math.round(n).toLocaleString('pt-BR')}`;

/** PvP: armas pesadas e granadas ficam de fora. */
export const pvpAllowed = (def: WeaponDef | undefined): boolean => !!def && def.category !== 'heavy' && def.category !== 'throwable';
