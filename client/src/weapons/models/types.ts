import type * as THREE from 'three';

/** Partes móveis que as animações conseguem manipular. */
export type PartName =
  | 'mag'
  | 'slide'
  | 'bolt'
  | 'boltHandle'
  | 'charging'
  | 'pump'
  | 'cylinder'
  | 'speedloader'
  | 'cover'
  | 'belt'
  | 'barrels'
  | 'rocket'
  | 'shell'
  | 'pin'
  | 'item'
  | 'flame';

/** Pontos de referência (mãos, mira, cano...). */
export type AnchorName =
  | 'grip'
  | 'support'
  | 'sight'
  | 'muzzle'
  | 'eject'
  | 'mag'
  | 'slide'
  | 'bolt'
  | 'charging'
  | 'pump'
  | 'cylinder'
  | 'speedloader'
  | 'cover'
  | 'rocket'
  | 'shell'
  | 'pin'
  | 'laser'
  | 'light';

export type V3 = readonly [number, number, number];

export interface ViewSetup {
  /** Posição/rotação do modelo (origem = mão direita) no espaço da câmera, no quadril. */
  hipPos: V3;
  hipRot: V3;
  /** Distância da mira até a câmera ao mirar. */
  adsDistance: number;
  /** Escala do modelo inteiro. */
  scale: number;
  flashScale: number;
  /** Deslocamento do ferrolho/slide ao atirar (no espaço da peça `slide`). */
  slideTravel?: number;
  /** Ombro esquerdo (espaço da câmera) — mais alto = braço mais erguido. */
  shoulderL?: V3;
  /** Direção para onde o cotovelo esquerdo aponta (espaço da câmera). */
  elbowL?: V3;
  /**
   * Mãos presas à arma: a arma fica rigidamente presa à mão direita e a mão
   * esquerda a um ponto fixo da arma (só a recarga solta a mão esquerda).
   */
  rigidHands?: boolean;
}

export interface WeaponModel {
  id: string;
  root: THREE.Group;
  parts: Map<PartName, THREE.Object3D>;
  anchors: Map<AnchorName, THREE.Object3D>;
  rest: Map<THREE.Object3D, { pos: THREE.Vector3; rot: THREE.Euler }>;
  view: ViewSetup;
}
