import { categoryInfo } from './categories';
import { findWeapon } from './catalog';
import type { LoadoutSlot, WeaponDef } from './types';

export const MAX_GRENADES = 5;

export interface Loadout {
  primary: string | null;
  secondary: string | null;
  melee: string | null;
  grenade: { type: string | null; count: number };
}

export const DEFAULT_LOADOUT: Loadout = {
  primary: 'm4a1',
  secondary: 'g17',
  melee: 'knife',
  grenade: { type: 'frag', count: 3 },
};

export interface LoadoutValidation {
  valid: boolean;
  errors: string[];
  /** Loadout corrigido (itens inválidos removidos, contagem limitada). */
  loadout: Loadout;
}

function checkSlot(
  id: string | null,
  slot: LoadoutSlot,
  errors: string[],
  lookup: (id: string) => WeaponDef | undefined,
): string | null {
  if (id === null) return null;
  const def = lookup(id);
  if (!def) {
    errors.push(`Arma desconhecida: ${id}`);
    return null;
  }
  if (categoryInfo(def.category).slot !== slot) {
    errors.push(`${def.name} não pode ir no slot ${slot}`);
    return null;
  }
  return id;
}

/** Regras: 1 principal, 1 secundária, 1 branca e até 5 granadas de um único tipo. */
export function validateLoadout(
  input: Partial<Loadout>,
  lookup: (id: string) => WeaponDef | undefined = findWeapon,
): LoadoutValidation {
  const errors: string[] = [];
  const grenadeIn = input.grenade ?? { type: null, count: 0 };
  let count = Math.floor(Number(grenadeIn.count) || 0);
  if (count < 0 || count > MAX_GRENADES) {
    errors.push(`Quantidade de granadas deve ser entre 0 e ${MAX_GRENADES}`);
    count = Math.min(MAX_GRENADES, Math.max(0, count));
  }
  const type = checkSlot(grenadeIn.type ?? null, 'grenade', errors, lookup);

  const loadout: Loadout = {
    primary: checkSlot(input.primary ?? null, 'primary', errors, lookup),
    secondary: checkSlot(input.secondary ?? null, 'secondary', errors, lookup),
    melee: checkSlot(input.melee ?? null, 'melee', errors, lookup),
    grenade: { type, count: type ? count : 0 },
  };
  return { valid: errors.length === 0, errors, loadout };
}
