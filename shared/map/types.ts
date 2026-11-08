export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Material de um bloco. `bedrock` = indestrutível (borda do mapa);
 * `hospital` = parede/teto de azulejo indestrutível.
 */
export type MaterialId = 'concrete' | 'wood' | 'metal' | 'plastic' | 'bedrock' | 'hospital';

/** Abertura com tábuas que os zumbis arrancam e o jogador reconstrói. */
export interface BarricadeData {
  id: string;
  kind: 'window' | 'door';
  /** Centro da abertura (x, z) e altura da base (y). */
  position: Vec3;
  /** Largura e altura da abertura. */
  width: number;
  height: number;
  /** Direção (horizontal) que aponta para FORA do prédio. */
  outward: { x: number; z: number };
}

export type Environment = 'outdoor' | 'hospital';

/** Caixa alinhada aos eixos. `position.y` é a base; x/z são o centro. */
export interface BoxData {
  id: string;
  position: Vec3;
  size: Vec3;
  /** Padrão: concreto. */
  material?: MaterialId;
  /** Cor base opcional (ex.: contêineres e plástico coloridos). */
  color?: number;
}

export interface MapData {
  name: string;
  seed: number;
  size: number;
  wallHeight: number;
  spawn: Vec3;
  boxes: BoxData[];
  /** Ambientação (luz, céu, piso). Padrão: ao ar livre. */
  environment?: Environment;
  barricades?: BarricadeData[];
  /** Caixas com física em posições fixas (sem isso, são espalhadas ao acaso). */
  crates?: { x: number; z: number; size: number; stack?: number }[];
  /** Luzes de teto (fluorescentes); `flicker` = falhando. */
  lights?: { position: Vec3; flicker?: boolean }[];
}
