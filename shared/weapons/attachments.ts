import type { FirearmDef, WeaponDef } from './types';

/**
 * Acessórios de arma: mira (COG, holográfica, 2x), silenciador, pente estendido,
 * lanterna, laser e empunhaduras (vertical e angulada). Toda arma começa sem nada.
 */

export type AttachmentSlot = 'optic' | 'muzzle' | 'magazine' | 'rail' | 'grip';
export type AttachmentId = 'holo' | 'cog' | 'x2' | 'suppressor' | 'extmag' | 'flashlight' | 'laser' | 'vgrip' | 'agrip';

export const SLOT_ORDER: readonly AttachmentSlot[] = ['optic', 'muzzle', 'magazine', 'rail', 'grip'];

export const SLOT_LABEL: Record<AttachmentSlot, string> = {
  optic: 'Mira',
  muzzle: 'Boca do cano',
  magazine: 'Pente',
  rail: 'Trilho lateral',
  grip: 'Empunhadura',
};

export const ATTACHMENTS: Record<AttachmentId, { slot: AttachmentSlot; name: string; desc: string }> = {
  holo: { slot: 'optic', name: 'Holográfica', desc: 'Retículo em anel, 1x. Mira rápida e campo de visão aberto.' },
  cog: { slot: 'optic', name: 'COG 3,5x', desc: 'Mira óptica de combate com chevron. Aproxima 3,5x.' },
  x2: { slot: 'optic', name: 'Luneta 2x', desc: 'Luneta compacta de aumento 2x com cruz.' },
  suppressor: { slot: 'muzzle', name: 'Silenciador', desc: 'Tiro abafado e sem clarão. Recuo um pouco menor.' },
  extmag: { slot: 'magazine', name: 'Pente estendido', desc: '+50% de munição no pente.' },
  flashlight: { slot: 'rail', name: 'Lanterna', desc: 'Ilumina para onde a arma aponta.' },
  laser: { slot: 'rail', name: 'Laser', desc: 'Traço vermelho curto preso à arma. Disparo do quadril mais preciso.' },
  vgrip: { slot: 'grip', name: 'Empunhadura vertical', desc: 'Menos recuo vertical. Mão de apoio mais baixa.' },
  agrip: { slot: 'grip', name: 'Empunhadura angulada', desc: 'Menos recuo lateral e mira mais rápida.' },
};

/** Acessórios escolhidos para uma arma (vazio = nenhum). */
export type WeaponAttachments = Partial<Record<AttachmentSlot, AttachmentId>>;

/** Armas que não aceitam silenciador. */
const NO_SUPPRESSOR = new Set(['ak47']);
/** Armas sem pente estendido (carregador próprio). */
const NO_EXTMAG = new Set(['m249', 'p90']);
/** Listas fechadas: a arma aceita só isto (vazio = nada). */
const ONLY: Record<string, Partial<Record<AttachmentSlot, AttachmentId[]>>> = {
  revolver: {},
  r870: { rail: ['flashlight'] },
  m590s: { optic: ['holo'] },
};

/** O que cada arma aceita em cada encaixe. */
export function attachmentOptions(def: WeaponDef | undefined): Partial<Record<AttachmentSlot, AttachmentId[]>> {
  if (!def || def.kind !== 'firearm' || def.projectile || def.id === 'minigun') return {};
  const only = ONLY[def.id];
  if (only) return only;
  const c = def.category;
  const out: Partial<Record<AttachmentSlot, AttachmentId[]>> = {};
  // miras só onde há mira de ferro (as que já vêm com red dot/luneta ficam como estão);
  // pistolas e submetralhadoras: só a holográfica
  if (def.sight === 'iron') out.optic = c === 'pistol' || c === 'smg' ? ['holo'] : ['holo', 'cog', 'x2'];
  if ((c === 'pistol' || c === 'smg' || c === 'rifle' || c === 'sniper') && !NO_SUPPRESSOR.has(def.id)) out.muzzle = ['suppressor'];
  if (def.reload.kind === 'magazine' && !NO_EXTMAG.has(def.id)) out.magazine = ['extmag'];
  out.rail = ['flashlight', 'laser'];
  if (c === 'rifle' || c === 'shotgun' || def.id === 'm249') out.grip = ['vgrip', 'agrip'];
  return out;
}

/** Remove o que a arma não aceita. */
export function sanitizeAttachments(def: WeaponDef | undefined, att: WeaponAttachments | undefined): WeaponAttachments {
  const opts = attachmentOptions(def);
  const out: WeaponAttachments = {};
  for (const slot of SLOT_ORDER) {
    const id = att?.[slot];
    if (id && opts[slot]?.includes(id)) out[slot] = id;
  }
  return out;
}

/** Aumento óptico de cada mira (1 = sem aumento). */
export const MAGNIFICATION: Partial<Record<AttachmentId, number>> = { holo: 1, x2: 2, cog: 3.5 };

/** FOV (graus) com o aumento `m` a partir do FOV padrão de 75°. */
const fovFor = (m: number): number => (2 * Math.atan(Math.tan((75 * Math.PI) / 360) / m) * 180) / Math.PI;

/** Atributos da arma com os acessórios aplicados. */
export function applyAttachmentStats(def: FirearmDef, att: WeaponAttachments): FirearmDef {
  const d: FirearmDef = { ...def, recoil: { ...def.recoil }, armSpring: { ...def.armSpring } };
  if (att.magazine === 'extmag') d.magazineSize = Math.round(def.magazineSize * 1.5);
  if (att.rail === 'laser') d.hipSpread = def.hipSpread * 0.65;
  if (att.grip === 'vgrip') {
    d.recoil.pitch *= 0.8;
    d.armSpring.force *= 0.85;
  }
  if (att.grip === 'agrip') {
    d.recoil.yaw *= 0.75;
    d.recoil.pitch *= 0.93;
  }
  if (att.muzzle === 'suppressor') d.recoil.pitch *= 0.92;
  const m = att.optic ? MAGNIFICATION[att.optic] : undefined;
  if (m) {
    d.adsFov = m > 1 ? Math.min(def.adsFov, fovFor(m)) : def.adsFov;
    d.adsSpread = def.adsSpread * 0.8;
  }
  return d;
}

/** Forma compacta para a rede: "holo,suppressor". */
export function encodeAttachments(att: WeaponAttachments): string {
  return SLOT_ORDER.map((s) => att[s])
    .filter(Boolean)
    .join(',');
}

export function decodeAttachments(s: string | null | undefined): WeaponAttachments {
  const out: WeaponAttachments = {};
  for (const id of (s ?? '').split(',')) {
    const a = ATTACHMENTS[id as AttachmentId];
    if (a) out[a.slot] = id as AttachmentId;
  }
  return out;
}
