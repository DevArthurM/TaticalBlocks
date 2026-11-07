import { Injectable, NotFoundException } from '@nestjs/common';
import { CATEGORIES, type CategoryInfo, TIERS, WEAPONS, type WeaponDef, findWeapon } from '../../../shared/weapons';

@Injectable()
export class WeaponsService {
  findAll(category?: string): readonly WeaponDef[] {
    return category ? WEAPONS.filter((w) => w.category === category) : WEAPONS;
  }

  findOne(id: string): WeaponDef {
    const weapon = findWeapon(id);
    if (!weapon) throw new NotFoundException(`Arma "${id}" não encontrada`);
    return weapon;
  }

  categories(): { categories: readonly CategoryInfo[]; tiers: typeof TIERS } {
    return { categories: CATEGORIES, tiers: TIERS };
  }
}
