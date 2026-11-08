import {
  type GameSettings,
  GRAPHICS_PRESETS,
  type GraphicsPreset,
  LIMITS,
  type SettingsStore,
} from '../../settings/Settings';
import './settings.css';

type Path = 'sensitivity' | 'adsSensitivity' | 'fov' | 'renderScale';

const SLIDERS: Record<Path, { label: string; hint: string; fmt: (v: number) => string }> = {
  renderScale: { label: 'Resolução', hint: 'Menor = mais desempenho', fmt: (v) => `${Math.round(v * 100)}%` },
  fov: { label: 'Campo de visão (FOV)', hint: 'Ângulo vertical da câmera', fmt: (v) => `${Math.round(v)}°` },
  sensitivity: { label: 'Sensibilidade', hint: 'Velocidade da câmera com o mouse', fmt: (v) => v.toFixed(2) },
  adsSensitivity: { label: 'Sensibilidade mirando', hint: 'Multiplicador ao mirar', fmt: (v) => `${Math.round(v * 100)}%` },
};

const CHOICES = {
  preset: [
    ['baixo', 'Baixo'],
    ['medio', 'Médio'],
    ['alto', 'Alto'],
    ['ultra', 'Ultra'],
  ],
  shadows: [
    ['desligado', 'Desligadas'],
    ['baixa', 'Baixa'],
    ['media', 'Média'],
    ['alta', 'Alta'],
  ],
  dynamicResolution: [
    ['on', 'Ligada'],
    ['off', 'Desligada'],
  ],
  aimMode: [
    ['segurar', 'Segurar'],
    ['alternar', 'Clicar (alternar)'],
  ],
  leanMode: [
    ['segurar', 'Segurar'],
    ['alternar', 'Clicar (alternar)'],
    ['desativado', 'Desativado'],
  ],
} as const;
type ChoiceKey = keyof typeof CHOICES;

const read = (s: GameSettings, p: Path): number => (p === 'renderScale' ? s.graphics.renderScale : s[p]);

/** Menu de configurações (gráficos, câmera e controles). */
export class SettingsMenu {
  onClose: () => void = () => {};
  private readonly root: HTMLElement;
  private openState = false;

  constructor(
    container: HTMLElement,
    private readonly store: SettingsStore,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'settings-menu';
    this.root.innerHTML = this.template();
    container.appendChild(this.root);

    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    store.subscribe((s) => this.sync(s));
  }

  get isOpen(): boolean {
    return this.openState;
  }

  setOpen(open: boolean): void {
    this.openState = open;
    this.root.classList.toggle('open', open);
  }

  private template(): string {
    const slider = (p: Path) => {
      const l = LIMITS[p];
      const m = SLIDERS[p];
      return `<label class="st-row">
        <span class="st-label">${m.label}<small>${m.hint}</small></span>
        <input type="range" data-slider="${p}" min="${l.min}" max="${l.max}" step="${l.step}" />
        <output data-out="${p}"></output>
      </label>`;
    };
    const choice = (k: ChoiceKey, label: string, hint: string) => `<div class="st-row">
        <span class="st-label">${label}<small>${hint}</small></span>
        <div class="st-seg" role="radiogroup">${CHOICES[k]
          .map(([v, t]) => `<button type="button" data-choice="${k}" data-value="${v}">${t}</button>`)
          .join('')}</div>
      </div>`;
    return `<div class="st-panel" role="dialog" aria-label="Configurações">
      <header class="st-head"><h2>CONFIGURAÇÕES</h2><kbd>Esc</kbd></header>
      <div class="st-body">
        <section><h3>Gráficos</h3>
          ${choice('preset', 'Qualidade', 'Predefinição geral')}
          ${slider('renderScale')}
          ${choice('shadows', 'Sombras', 'Resolução do mapa de sombras')}
          ${choice('dynamicResolution', 'Resolução dinâmica', 'Reduz a resolução sozinho quando o FPS cai')}
        </section>
        <section><h3>Câmera</h3>
          ${slider('fov')}
        </section>
        <section><h3>Controles</h3>
          ${slider('sensitivity')}
          ${slider('adsSensitivity')}
          ${choice('aimMode', 'Mira (botão direito)', 'Segurar para mirar ou clicar para alternar')}
          ${choice('leanMode', 'Inclinar (Q / E)', 'Segurar, clicar para alternar ou desligar')}
        </section>
      </div>
      <footer class="st-foot">
        <button type="button" class="st-btn ghost" data-action="reset">Restaurar padrões</button>
        <button type="button" class="st-btn" data-action="close">Voltar</button>
      </footer>
    </div>`;
  }

  /** Reflete o estado atual nos controles (sem recriar, para não perder o arraste). */
  private sync(s: GameSettings): void {
    this.root.querySelectorAll<HTMLInputElement>('[data-slider]').forEach((el) => {
      const p = el.dataset.slider as Path;
      if (document.activeElement !== el) el.value = String(read(s, p));
      const out = this.root.querySelector<HTMLOutputElement>(`[data-out="${p}"]`);
      if (out) out.textContent = SLIDERS[p].fmt(read(s, p));
    });
    const current: Record<ChoiceKey, string> = {
      preset: s.graphics.preset,
      shadows: s.graphics.shadows,
      dynamicResolution: s.graphics.dynamicResolution ? 'on' : 'off',
      aimMode: s.aimMode,
      leanMode: s.leanMode,
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => {
      const on = current[b.dataset.choice as ChoiceKey] === b.dataset.value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  private readonly onInput = (e: Event): void => {
    const el = e.target as HTMLInputElement;
    const p = el.dataset.slider as Path | undefined;
    if (!p) return;
    const v = Number(el.value);
    this.store.update((d) => {
      if (p === 'renderScale') {
        d.graphics.renderScale = v;
        d.graphics.preset = matchPreset(d.graphics);
      } else d[p] = v;
    });
  };

  private readonly onClick = (e: MouseEvent): void => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-choice],[data-action]');
    if (!t) return;
    if (t.dataset.action === 'close') return this.onClose();
    if (t.dataset.action === 'reset') return this.store.reset();
    const key = t.dataset.choice as ChoiceKey;
    const value = t.dataset.value!;
    this.store.update((d) => {
      if (key === 'preset')
        d.graphics = {
          ...GRAPHICS_PRESETS[value as Exclude<GraphicsPreset, 'personalizado'>],
          dynamicResolution: d.graphics.dynamicResolution,
        };
      else if (key === 'dynamicResolution') d.graphics.dynamicResolution = value === 'on';
      else if (key === 'shadows') {
        d.graphics.shadows = value as GameSettings['graphics']['shadows'];
        d.graphics.preset = matchPreset(d.graphics);
      } else if (key === 'aimMode') d.aimMode = value as GameSettings['aimMode'];
      else d.leanMode = value as GameSettings['leanMode'];
    });
  };
}

/** Qual predefinição bate com os valores atuais (ou "personalizado"). */
function matchPreset(g: GameSettings['graphics']): GraphicsPreset {
  const hit = Object.values(GRAPHICS_PRESETS).find((p) => p.renderScale === g.renderScale && p.shadows === g.shadows);
  return hit ? hit.preset : 'personalizado';
}
