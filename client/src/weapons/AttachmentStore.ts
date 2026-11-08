import { sanitizeAttachments, type WeaponAttachments } from '@shared/weapons/attachments';
import { findWeapon } from '@shared/weapons/catalog';

const KEY = 'fps.attachments';

/** Acessórios escolhidos para cada arma (salvos no navegador). Padrão: nenhum. */
export class AttachmentStore {
  private data: Record<string, WeaponAttachments> = {};

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = JSON.parse(raw) as Record<string, WeaponAttachments>;
    } catch {
      this.data = {};
    }
  }

  get(id: string): WeaponAttachments {
    return sanitizeAttachments(findWeapon(id), this.data[id]);
  }

  set(id: string, att: WeaponAttachments): WeaponAttachments {
    const clean = sanitizeAttachments(findWeapon(id), att);
    this.data[id] = clean;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
    return clean;
  }
}
