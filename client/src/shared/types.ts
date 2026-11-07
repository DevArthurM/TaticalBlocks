export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Caixa alinhada aos eixos. `position.y` é a base; x/z são o centro. */
export interface BoxData {
  id: string;
  position: Vec3;
  size: Vec3;
}

export interface MapData {
  name: string;
  seed: number;
  size: number;
  wallHeight: number;
  spawn: Vec3;
  boxes: BoxData[];
}

export type DataSource = 'server' | 'local';
