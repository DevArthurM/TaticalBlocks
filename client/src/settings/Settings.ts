/** Configurações do jogador (salvas no navegador). */

export type GraphicsPreset = 'baixo' | 'medio' | 'alto' | 'ultra' | 'personalizado';
export type ShadowQuality = 'desligado' | 'baixa' | 'media' | 'alta';
export type AimMode = 'segurar' | 'alternar';
export type LeanMode = 'segurar' | 'alternar' | 'desativado';

export interface GameSettings {
  graphics: {
    preset: GraphicsPreset;
    /** Escala de resolução (0.5 = metade dos pixels por lado). */
    renderScale: number;
    shadows: ShadowQuality;
    /** Reduz a resolução sozinho quando o FPS cai. */
    dynamicResolution: boolean;
  };
  /** Multiplicador da sensibilidade do mouse. */
  sensitivity: number;
  /** Multiplicador extra ao mirar. */
  adsSensitivity: number;
  aimMode: AimMode;
  leanMode: LeanMode;
  /** Campo de visão vertical (graus). */
  fov: number;
}

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, 'personalizado'>, GameSettings['graphics']> = {
  baixo: { preset: 'baixo', renderScale: 0.6, shadows: 'desligado', dynamicResolution: true },
  medio: { preset: 'medio', renderScale: 0.8, shadows: 'baixa', dynamicResolution: true },
  alto: { preset: 'alto', renderScale: 1, shadows: 'media', dynamicResolution: true },
  ultra: { preset: 'ultra', renderScale: 1, shadows: 'alta', dynamicResolution: true },
};

/** Tamanho do mapa de sombra por qualidade. */
export const SHADOW_MAP_SIZE: Record<ShadowQuality, number> = {
  desligado: 0,
  baixa: 1024,
  media: 2048,
  alta: 4096,
};

export const DEFAULT_SETTINGS: GameSettings = {
  graphics: { ...GRAPHICS_PRESETS.ultra },
  sensitivity: 1,
  adsSensitivity: 0.6,
  aimMode: 'segurar',
  leanMode: 'segurar',
  fov: 75,
};

export const LIMITS = {
  sensitivity: { min: 0.1, max: 3, step: 0.05 },
  adsSensitivity: { min: 0.2, max: 1.5, step: 0.05 },
  fov: { min: 60, max: 110, step: 1 },
  renderScale: { min: 0.5, max: 1, step: 0.05 },
} as const;

/**
 * FOV exibido no controle (60–110) → FOV real da câmera.
 * Até 75° (padrão) é igual; acima disso é comprimido para que o máximo exibido (110)
 * corresponda a 85% do antigo máximo (110 × 0,85 = 93,5°).
 */
export const FOV_MAX_EFFECTIVE = LIMITS.fov.max * 0.85;
const FOV_KNEE = 75;

export function effectiveFov(displayed: number): number {
  if (displayed <= FOV_KNEE) return displayed;
  const t = (displayed - FOV_KNEE) / (LIMITS.fov.max - FOV_KNEE);
  return FOV_KNEE + t * (FOV_MAX_EFFECTIVE - FOV_KNEE);
}

const KEY = 'fps.settings';

/** Guarda as configurações, valida o que vem do armazenamento e avisa quem estiver ouvindo. */
export class SettingsStore {
  private value: GameSettings;
  private readonly listeners = new Set<(s: GameSettings) => void>();

  constructor() {
    this.value = SettingsStore.load();
  }

  get(): GameSettings {
    return this.value;
  }

  subscribe(fn: (s: GameSettings) => void): () => void {
    this.listeners.add(fn);
    fn(this.value);
    return () => this.listeners.delete(fn);
  }

  update(patch: (draft: GameSettings) => void): void {
    const next = structuredClone(this.value);
    patch(next);
    this.value = SettingsStore.sanitize(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* armazenamento indisponível: vale só nesta sessão */
    }
    this.listeners.forEach((fn) => fn(this.value));
  }

  reset(): void {
    this.update((d) => Object.assign(d, structuredClone(DEFAULT_SETTINGS)));
  }

  private static load(): GameSettings {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return SettingsStore.sanitize({ ...structuredClone(DEFAULT_SETTINGS), ...(JSON.parse(raw) as Partial<GameSettings>) });
    } catch {
      /* ignora dados inválidos */
    }
    return structuredClone(DEFAULT_SETTINGS);
  }

  private static sanitize(s: GameSettings): GameSettings {
    const clamp = (v: unknown, l: { min: number; max: number }, d: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(l.max, Math.max(l.min, v)) : d;
    const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
    const g = s.graphics ?? DEFAULT_SETTINGS.graphics;
    return {
      graphics: {
        preset: oneOf(g.preset, ['baixo', 'medio', 'alto', 'ultra', 'personalizado'], 'ultra'),
        renderScale: clamp(g.renderScale, LIMITS.renderScale, 1),
        shadows: oneOf(g.shadows, ['desligado', 'baixa', 'media', 'alta'], 'alta'),
        dynamicResolution: typeof g.dynamicResolution === 'boolean' ? g.dynamicResolution : true,
      },
      sensitivity: clamp(s.sensitivity, LIMITS.sensitivity, 1),
      adsSensitivity: clamp(s.adsSensitivity, LIMITS.adsSensitivity, 0.6),
      aimMode: oneOf(s.aimMode, ['segurar', 'alternar'], 'segurar'),
      leanMode: oneOf(s.leanMode, ['segurar', 'alternar', 'desativado'], 'segurar'),
      fov: clamp(s.fov, LIMITS.fov, 75),
    };
  }
}
