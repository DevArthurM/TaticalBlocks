import type { FireMode, WeaponDef } from '@shared/weapons/types';

export interface StatBar {
  label: string;
  value: number;
}

const c01 = (v: number) => Math.max(0.04, Math.min(1, v));

export const FIRE_MODE_LABEL: Record<FireMode, string> = {
  semi: 'SEMI',
  auto: 'AUTO',
  burst: 'RAJADA',
  pump: 'PUMP',
  bolt: 'FERROLHO',
};

/** Barras normalizadas (0..1) para o menu de arsenal. */
export function statBars(def: WeaponDef): StatBar[] {
  switch (def.kind) {
    case 'firearm': {
      const precision = 0.5 * (1 - def.hipSpread / 0.07) + 0.5 * (1 - def.adsSpread / 0.05);
      return [
        { label: 'Dano', value: c01((def.damage * def.pellets) / 150) },
        { label: 'Cadência', value: c01(def.rpm / 1200) },
        { label: 'Alcance', value: c01(def.range / 500) },
        { label: 'Precisão', value: c01(precision) },
        { label: 'Mobilidade', value: c01((def.moveSpeed - 0.6) / 0.5) },
      ];
    }
    case 'melee':
      return [
        { label: 'Dano', value: c01(def.damage / 120) },
        { label: 'Velocidade', value: c01(0.4 / def.swingTime) },
        { label: 'Alcance', value: c01(def.range / 2.5) },
        { label: 'Mobilidade', value: c01((def.moveSpeed - 0.6) / 0.5) },
      ];
    case 'throwable':
      return [
        { label: 'Dano', value: c01(def.damage / 120) },
        { label: 'Raio', value: c01(def.radius / 18) },
      ];
  }
}

export function weaponTags(def: WeaponDef): string[] {
  switch (def.kind) {
    case 'firearm': {
      const reload = def.reload.kind === 'shell' ? 'cartucho a cartucho' : `${def.reload.time.toFixed(1)}s`;
      const tags = [FIRE_MODE_LABEL[def.fireMode], `${def.magazineSize} tiros`, `recarga ${reload}`];
      if (def.pellets > 1) tags.push(`${def.pellets} chumbos`);
      if (def.sight === 'scope') tags.push('luneta');
      if (def.sight === 'reddot') tags.push('red-dot');
      if (def.projectile) tags.push('explosivo');
      return tags;
    }
    case 'melee':
      return [{ stab: 'estocada', chop: 'golpe diagonal', smash: 'golpe pesado' }[def.style]];
    case 'throwable':
      return [def.fuse === null ? 'explode no impacto' : `espoleta ${def.fuse}s`];
  }
}
