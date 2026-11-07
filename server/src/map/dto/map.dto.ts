export interface Vec3Dto {
  x: number;
  y: number;
  z: number;
}

/** Caixa alinhada aos eixos. `position.y` é a base da caixa; x/z são o centro. */
export interface BoxDto {
  id: string;
  position: Vec3Dto;
  size: Vec3Dto;
}

export interface MapDto {
  name: string;
  seed: number;
  size: number;
  wallHeight: number;
  spawn: Vec3Dto;
  boxes: BoxDto[];
}
