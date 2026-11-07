import { findWeapon } from '@shared/weapons/catalog';
import type { Loadout } from '@shared/weapons/loadout';
import type { FirearmDef, LoadoutSlot, MeleeDef, ThrowableDef, WeaponDef } from '@shared/weapons/types';
import { Firearm } from './Firearm';

export type EquipSlot = LoadoutSlot;
export const SLOT_ORDER: readonly EquipSlot[] = ['primary', 'secondary', 'melee', 'grenade'];

export type HeldItem =
  | { slot: EquipSlot; kind: 'firearm'; def: FirearmDef; gun: Firearm }
  | { slot: EquipSlot; kind: 'melee'; def: MeleeDef }
  | { slot: EquipSlot; kind: 'throwable'; def: ThrowableDef };

/** Itens que o jogador carrega + estado (munição de cada arma, granadas). */
export class Inventory {
  private items = new Map<EquipSlot, HeldItem>();
  grenades = 0;

  constructor(
    public loadout: Loadout,
    private readonly lookup: (id: string) => WeaponDef | undefined = findWeapon,
  ) {
    this.apply(loadout);
  }

  /** Aplica um novo loadout preservando munição das armas que continuam. */
  apply(loadout: Loadout): void {
    const prev = this.items;
    this.items = new Map();
    this.loadout = loadout;
    const ids: Record<EquipSlot, string | null> = {
      primary: loadout.primary,
      secondary: loadout.secondary,
      melee: loadout.melee,
      grenade: loadout.grenade.type,
    };
    for (const slot of SLOT_ORDER) {
      const def = this.lookup(ids[slot] ?? '');
      if (!def) continue;
      const old = prev.get(slot);
      if (old && old.def.id === def.id) {
        this.items.set(slot, old);
        continue;
      }
      if (def.kind === 'firearm') this.items.set(slot, { slot, kind: 'firearm', def, gun: new Firearm(def) });
      else if (def.kind === 'melee') this.items.set(slot, { slot, kind: 'melee', def });
      else this.items.set(slot, { slot, kind: 'throwable', def });
    }
    this.grenades = loadout.grenade.type ? loadout.grenade.count : 0;
  }

  get(slot: EquipSlot): HeldItem | undefined {
    if (slot === 'grenade' && this.grenades <= 0) return undefined;
    return this.items.get(slot);
  }

  has(slot: EquipSlot): boolean {
    return this.get(slot) !== undefined;
  }

  /** Primeiro slot disponível na ordem padrão. */
  firstAvailable(): EquipSlot | null {
    return SLOT_ORDER.find((s) => this.has(s)) ?? null;
  }

  /** Próximo slot disponível na direção indicada (roda do mouse). */
  cycle(from: EquipSlot | null, dir: 1 | -1): EquipSlot | null {
    const start = from ? SLOT_ORDER.indexOf(from) : -1;
    for (let i = 1; i <= SLOT_ORDER.length; i++) {
      const slot = SLOT_ORDER[(start + dir * i + SLOT_ORDER.length * 4) % SLOT_ORDER.length];
      if (this.has(slot)) return slot;
    }
    return null;
  }
}
