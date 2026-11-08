import { ModelBuilder } from './ModelBuilder';
import type { MatKey } from './palette';
import { view } from './presets';
import type { WeaponModel } from './types';

/** Tipos de cartucho (um GIF para cada). */
export type AmmoType = 'pistol' | 'magnum' | 'pdw' | 'rifle' | 'ak' | 'sniper' | 'shell' | 'grenade40' | 'rocket';

/** Munição usada por cada arma de fogo. */
export const WEAPON_AMMO: Record<string, AmmoType> = {
  g17: 'pistol',
  g17_inox: 'pistol',
  g34: 'pistol',
  g19_fde: 'pistol',
  mp5k: 'pistol',
  tmp: 'pistol',
  mac10: 'pistol',
  ump45: 'pistol',
  revolver: 'magnum',
  mp7: 'pdw',
  p90: 'pdw',
  m4a1: 'rifle',
  m16a4: 'rifle',
  hk416: 'rifle',
  m249: 'rifle',
  minigun: 'rifle',
  ak47: 'ak',
  hunting: 'sniper',
  awm: 'sniper',
  sr25: 'sniper',
  r870: 'shell',
  m590s: 'shell',
  aa12: 'shell',
  m32: 'grenade40',
  rpg7: 'rocket',
};

export const AMMO_LABEL: Record<AmmoType, string> = {
  pistol: '9 mm',
  magnum: '.357 Magnum',
  pdw: '4,6 mm',
  rifle: '5,56 mm',
  ak: '7,62 mm',
  sniper: '.338 Lapua',
  shell: 'Calibre 12',
  grenade40: '40 mm',
  rocket: 'PG-7',
};

/** Id do GIF (em /weapons/gifs/) do cartucho. */
export const ammoGifId = (t: AmmoType) => `ammo_${t}`;

/** Cartucho voxel: estojo + projétil, deitado ao longo de Z (ponta para −Z). */
function cartridge(id: string, o: { caseLen: number; caseW: number; neck?: number; tipLen: number; tipW: number; caseMat?: MatKey; tipMat?: MatKey; rim?: boolean }): WeaponModel {
  const b = new ModelBuilder(id);
  const caseMat = o.caseMat ?? 'brass';
  const z0 = o.caseLen / 2;
  b.rod(caseMat, o.caseW, o.caseLen, [0, 0, 0]);
  if (o.rim) b.rod(caseMat, o.caseW * 1.15, o.caseLen * 0.08, [0, 0, z0 - o.caseLen * 0.04]);
  b.box('dark', [o.caseW * 0.45, o.caseW * 0.45, 0.002], [0, 0, z0 + 0.001]); // espoleta
  let front = -z0;
  if (o.neck) {
    b.rod(caseMat, o.caseW * 0.62, o.neck, [0, 0, front - o.neck / 2]);
    front -= o.neck;
  }
  b.rod(o.tipMat ?? 'copper', o.tipW, o.tipLen * 0.6, [0, 0, front - o.tipLen * 0.3]);
  b.rod(o.tipMat ?? 'copper', o.tipW * 0.6, o.tipLen * 0.4, [0, 0, front - o.tipLen * 0.8]);
  b.anchor('grip', [0, 0, 0]);
  return b.build(view('throwable'));
}

export function buildAmmoModel(type: AmmoType): WeaponModel {
  switch (type) {
    case 'pistol':
      return cartridge('ammo_pistol', { caseLen: 0.019, caseW: 0.0098, tipLen: 0.01, tipW: 0.009 });
    case 'magnum':
      return cartridge('ammo_magnum', { caseLen: 0.033, caseW: 0.0096, tipLen: 0.011, tipW: 0.009, tipMat: 'lead', rim: true });
    case 'pdw':
      return cartridge('ammo_pdw', { caseLen: 0.022, caseW: 0.008, neck: 0.004, tipLen: 0.014, tipW: 0.0055 });
    case 'rifle':
      return cartridge('ammo_rifle', { caseLen: 0.036, caseW: 0.0095, neck: 0.007, tipLen: 0.022, tipW: 0.0057 });
    case 'ak':
      return cartridge('ammo_ak', { caseLen: 0.032, caseW: 0.0112, neck: 0.006, tipLen: 0.024, tipW: 0.0078, caseMat: 'steelCase' });
    case 'sniper':
      return cartridge('ammo_sniper', { caseLen: 0.056, caseW: 0.0145, neck: 0.009, tipLen: 0.032, tipW: 0.0086 });
    case 'shell': {
      const b = new ModelBuilder('ammo_shell');
      b.rod('shellRed', 0.02, 0.06, [0, 0, -0.006]);
      b.rod('brass', 0.0215, 0.016, [0, 0, 0.03]);
      b.rod('brass', 0.024, 0.003, [0, 0, 0.0385]);
      b.box('dark', [0.006, 0.006, 0.002], [0, 0, 0.0405]);
      for (let i = 0; i < 3; i++) b.box('dark', [0.021, 0.021, 0.0015], [0, 0, -0.03 + i * 0.012], b.root, [0, 0, Math.PI / 4]);
      b.anchor('grip', [0, 0, 0]);
      return b.build(view('throwable'));
    }
    case 'grenade40': {
      const b = new ModelBuilder('ammo_grenade40');
      b.rod('brass', 0.04, 0.045, [0, 0, 0.02]);
      b.rod('olive', 0.038, 0.035, [0, 0, -0.02]);
      b.rod('olive', 0.024, 0.016, [0, 0, -0.044]);
      b.rod('yellow', 0.0385, 0.004, [0, 0, -0.008]);
      b.anchor('grip', [0, 0, 0]);
      return b.build(view('throwable'));
    }
    case 'rocket': {
      const b = new ModelBuilder('ammo_rocket');
      b.rod('rpg', 0.04, 0.14, [0, 0, 0.06]);
      b.rod('rpg', 0.06, 0.06, [0, 0, -0.03]);
      b.rod('rpg', 0.09, 0.07, [0, 0, -0.09]);
      b.rod('rpg', 0.06, 0.06, [0, 0, -0.16]);
      b.rod('rpg', 0.03, 0.05, [0, 0, -0.21]);
      b.box('dark', [0.012, 0.012, 0.02], [0, 0, -0.245]);
      for (let i = 0; i < 4; i++) b.box('dark', [0.004, 0.05, 0.03], [0, 0, 0.12], b.root, [0, 0, (i * Math.PI) / 4]);
      b.anchor('grip', [0, 0, 0]);
      return b.build(view('throwable'));
    }
  }
}

export const AMMO_TYPES = Object.keys(AMMO_LABEL) as AmmoType[];
