import { WEAPONS } from '@shared/weapons/catalog';
import { DEFAULT_LOADOUT, type Loadout, validateLoadout } from '@shared/weapons/loadout';
import type { WeaponDef } from '@shared/weapons/types';
import { FALLBACK_MAP } from '../config/fallbackMap';
import type { DataSource, MapData } from '../shared/types';

export interface Loaded<T> {
  data: T;
  source: DataSource;
}

const LOADOUT_KEY = 'fps.loadout';

/** Cliente HTTP do servidor Nest (via proxy `/api` do Vite) com fallback local. */
export class ApiClient {
  constructor(
    private readonly baseUrl = '/api',
    private readonly timeoutMs = 1500,
  ) {}

  loadMap(seed?: number): Promise<Loaded<MapData>> {
    const query = seed !== undefined ? `?seed=${seed}` : '';
    return this.withFallback(`/map${query}`, FALLBACK_MAP);
  }

  loadCatalog(): Promise<Loaded<readonly WeaponDef[]>> {
    return this.withFallback('/weapons', WEAPONS);
  }

  /** Servidor → localStorage → padrão. */
  async loadLoadout(): Promise<Loaded<Loadout>> {
    try {
      return { data: validateLoadout(await this.request<Loadout>('/loadout')).loadout, source: 'server' };
    } catch {
      return { data: this.readLocalLoadout(), source: 'local' };
    }
  }

  /** Salva localmente e no servidor (validação dos dois lados). */
  async saveLoadout(loadout: Loadout): Promise<Loaded<Loadout>> {
    const valid = validateLoadout(loadout).loadout;
    try {
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(valid));
    } catch {
      /* armazenamento indisponível */
    }
    try {
      const saved = await this.request<Loadout>('/loadout', { method: 'PUT', body: JSON.stringify(valid) });
      return { data: saved, source: 'server' };
    } catch {
      return { data: valid, source: 'local' };
    }
  }

  private readLocalLoadout(): Loadout {
    try {
      const raw = localStorage.getItem(LOADOUT_KEY);
      if (raw) return validateLoadout(JSON.parse(raw) as Loadout).loadout;
    } catch {
      /* ignora */
    }
    return structuredClone(DEFAULT_LOADOUT);
  }

  private async withFallback<T>(path: string, fallback: T): Promise<Loaded<T>> {
    try {
      return { data: await this.request<T>(path), source: 'server' };
    } catch (err) {
      console.warn(`[api] ${path} indisponível, usando dados locais`, err);
      return { data: fallback, source: 'local' };
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...init.headers },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
