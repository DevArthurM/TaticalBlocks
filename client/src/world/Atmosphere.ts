import * as THREE from 'three';

const linear = (hex: number): THREE.Color => new THREE.Color(hex);

/**
 * Clima do mapa: uma tarde de sol baixo. Fonte única das cores de céu, sol e névoa —
 * usada pelas luzes, pela cúpula do céu e pela névoa do pós-processamento.
 */
export const ATMOSPHERE = {
  /** Direção que aponta PARA o sol (≈ 36° acima do horizonte). */
  sunDir: new THREE.Vector3(45, 38, 26).normalize(),
  sunLight: 0xffedd2,
  sunIntensity: 3.2,
  /** Luz do céu (de cima) e a rebatida do chão (de baixo). */
  skyLight: 0xbcd3ff,
  groundLight: 0x8f8372,
  ambient: 1.15,

  sky: {
    zenith: linear(0x2f6fd0),
    horizon: linear(0xa6c6ea),
    ground: linear(0x98adc2),
    sun: new THREE.Color(1.0, 0.86, 0.62),
    cloudLit: new THREE.Color(1.25, 1.2, 1.12),
    cloudShadow: linear(0x8497b4),
  },

  /** Névoa do pós-processamento: cor (a do horizonte), densidade no chão e queda com a altura. */
  fogColor: linear(0xa6c6ea),
  fogDensity: 0.003,
  fogFalloff: 0.085,
  /** Cor do sol espalhado no ar (névoa na direção do sol e raios). */
  scatter: new THREE.Color(1.0, 0.82, 0.56),
  /** Névoa simples (sem pós-processamento): cor e distâncias. */
  legacyFog: { color: 0xbcd4ee, near: 45, far: 150 },
} as const;
