import type { PlayerState, Vec3Tuple } from '../../../shared/net/protocol';
import { ARENA_HALF } from '../../../shared/net/spawns';

/** Validação do que chega dos clientes (nada é confiável). */

export const isNum = (v: unknown, limit = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;

export function vec(v: unknown, limit = 1e4): Vec3Tuple | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => isNum(x, limit))) return null;
  return [v[0], v[1], v[2]];
}

export function unitVec(v: unknown): Vec3Tuple | null {
  const d = vec(v, 2);
  if (!d) return null;
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 0.5 || len > 1.5) return null;
  return [d[0] / len, d[1] / len, d[2] / len];
}

export const shortString = (v: unknown, max = 32): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export function playerState(raw: unknown): PlayerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const p = vec(s.p);
  const v = vec(s.v, 100);
  if (!p || !v || !isNum(s.yaw, 1e4) || !isNum(s.pitch, 4) || !isNum(s.lean, 1.01) || !isNum(s.crouch, 1.01) || !isNum(s.flags, 255)) return null;
  if (s.weapon !== null && !shortString(s.weapon, 24)) return null;
  if (s.att !== undefined && (typeof s.att !== 'string' || s.att.length > 80 || !/^[a-z0-9,]*$/.test(s.att))) return null;
  // dentro da arena
  p[0] = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, p[0]));
  p[2] = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, p[2]));
  p[1] = Math.max(-1, Math.min(12, p[1]));
  return {
    p,
    v,
    yaw: s.yaw as number,
    pitch: Math.max(-1.6, Math.min(1.6, s.pitch as number)),
    lean: s.lean as number,
    crouch: Math.max(0, s.crouch as number),
    flags: (s.flags as number) | 0,
    weapon: (s.weapon as string | null) ?? null,
    att: (s.att as string | undefined) ?? '',
  };
}

export const dist = (a: Vec3Tuple, b: Vec3Tuple): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
