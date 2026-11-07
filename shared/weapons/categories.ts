import type { LoadoutSlot, Tier, WeaponCategory } from './types';

export interface CategoryInfo {
  id: WeaponCategory;
  label: string;
  slot: LoadoutSlot;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { id: 'smg', label: 'Submetralhadoras', slot: 'primary' },
  { id: 'rifle', label: 'Fuzis de Assalto', slot: 'primary' },
  { id: 'shotgun', label: 'Escopetas', slot: 'primary' },
  { id: 'sniper', label: 'Precisão', slot: 'primary' },
  { id: 'heavy', label: 'Pesadas', slot: 'primary' },
  { id: 'pistol', label: 'Pistolas', slot: 'secondary' },
  { id: 'melee', label: 'Armas Brancas', slot: 'melee' },
  { id: 'throwable', label: 'Arremessáveis', slot: 'grenade' },
];

export const SLOT_LABELS: Record<LoadoutSlot, string> = {
  primary: 'Principal',
  secondary: 'Secundária',
  melee: 'Arma Branca',
  grenade: 'Granadas',
};

export const TIERS: Record<Tier, { label: string; short: string }> = {
  1: { label: 'Comum', short: 'C' },
  2: { label: 'Incomum', short: 'B' },
  3: { label: 'Rara', short: 'A' },
  4: { label: 'Épica', short: 'S' },
  5: { label: 'Lendária', short: 'S+' },
};

export function categoryInfo(id: WeaponCategory): CategoryInfo {
  const info = CATEGORIES.find((c) => c.id === id);
  if (!info) throw new Error(`Categoria desconhecida: ${id}`);
  return info;
}
