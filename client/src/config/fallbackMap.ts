import { buildHospital } from '@shared/map/hospital';
import { buildVoxelYard } from '@shared/map/voxelYard';
import type { MapData } from '../shared/types';

/** Usado quando o servidor Nest não está disponível (mesmo mapa do servidor). */
export const FALLBACK_MAP: MapData = { ...buildVoxelYard(), name: 'Pátio Voxel (offline)' };

export const FALLBACK_HOSPITAL: MapData = { ...buildHospital(), name: 'Hospital (offline)' };
