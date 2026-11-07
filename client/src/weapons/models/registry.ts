import { buildM249, buildM32, buildMinigun, buildRPG7 } from './heavy';
import { buildHatchet, buildKnife, buildSledge } from './melee';
import { buildG17, buildG17Inox, buildG19, buildG34, buildRevolver } from './pistols';
import { buildAK47, buildHK416, buildM16A4, buildM4A1, buildSR25 } from './rifles';
import { buildAA12, buildM590, buildR870 } from './shotguns';
import { buildMAC10, buildMP5K, buildMP7, buildP90, buildTMP, buildUMP } from './smgs';
import { buildAWM, buildHunting } from './snipers';
import { buildFlash, buildFrag, buildMolotov } from './throwables';
import type { WeaponModel } from './types';

const BUILDERS: Record<string, () => WeaponModel> = {
  g17: buildG17,
  g17_inox: buildG17Inox,
  g34: buildG34,
  g19_fde: buildG19,
  revolver: buildRevolver,
  mp7: buildMP7,
  mp5k: buildMP5K,
  tmp: buildTMP,
  mac10: buildMAC10,
  ump45: buildUMP,
  p90: buildP90,
  m4a1: buildM4A1,
  ak47: buildAK47,
  m16a4: buildM16A4,
  hk416: buildHK416,
  r870: buildR870,
  m590s: buildM590,
  aa12: buildAA12,
  hunting: buildHunting,
  awm: buildAWM,
  sr25: buildSR25,
  m249: buildM249,
  minigun: buildMinigun,
  rpg7: buildRPG7,
  m32: buildM32,
  knife: buildKnife,
  hatchet: buildHatchet,
  sledge: buildSledge,
  frag: buildFrag,
  flash: buildFlash,
  molotov: buildMolotov,
};

export function hasModel(id: string): boolean {
  return id in BUILDERS;
}

/** Cria uma nova instância do modelo da arma. */
export function buildWeaponModel(id: string): WeaponModel {
  const builder = BUILDERS[id];
  if (!builder) throw new Error(`Sem modelo para a arma "${id}"`);
  return builder();
}
