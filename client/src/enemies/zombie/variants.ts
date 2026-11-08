/**
 * Variações procedurais do zumbi: 5 partes de cima × 5 de baixo × 5 calçados
 * = 125 combinações de roupa, sobre 5 tons de pele.
 */

/** Textura (material) de uma peça; a cor vem por instância. */
export type Fabric = 'cloth' | 'plaid' | 'denim' | 'leather' | 'footwear';

export interface TopDef {
  id: string;
  label: string;
  fabric: Fabric;
  color: number;
  /** none = regata (braço à mostra), short = manga curta, long = manga comprida. */
  sleeves: 'none' | 'short' | 'long';
  /** Avental hospitalar: cobre também o quadril. */
  gown?: boolean;
}

export interface BottomDef {
  id: string;
  label: string;
  fabric: Fabric;
  color: number;
  /** Bermuda: canela à mostra. */
  shorts?: boolean;
}

export interface ShoeDef {
  id: string;
  label: string;
  color: number;
  /** Bota: cano cobrindo o fim da canela. */
  boot?: boolean;
  /** Descalço: pé com a cor da pele. */
  barefoot?: boolean;
}

export interface SkinDef {
  id: string;
  label: string;
  tone: number;
  hair: number;
}

export const TOPS: readonly TopDef[] = [
  { id: 'camiseta', label: 'Camiseta branca', fabric: 'cloth', color: 0xe9e5db, sleeves: 'short' },
  { id: 'xadrez', label: 'Camisa xadrez', fabric: 'plaid', color: 0xb8352c, sleeves: 'long' },
  { id: 'regata', label: 'Regata cinza', fabric: 'cloth', color: 0x8b9097, sleeves: 'none' },
  { id: 'jaqueta', label: 'Jaqueta de couro', fabric: 'leather', color: 0x5c3b25, sleeves: 'long' },
  { id: 'avental', label: 'Avental hospitalar', fabric: 'cloth', color: 0x8db7cc, sleeves: 'short', gown: true },
];

export const BOTTOMS: readonly BottomDef[] = [
  { id: 'jeans', label: 'Calça jeans', fabric: 'denim', color: 0x4a6d9e },
  { id: 'caqui', label: 'Calça cáqui', fabric: 'cloth', color: 0xb39d73 },
  { id: 'social', label: 'Calça social preta', fabric: 'cloth', color: 0x2c2d33 },
  { id: 'bermuda', label: 'Bermuda jeans', fabric: 'denim', color: 0x7593ba, shorts: true },
  { id: 'moletom', label: 'Calça de moletom', fabric: 'cloth', color: 0x8d9198 },
];

export const SHOES: readonly ShoeDef[] = [
  { id: 'sapato', label: 'Sapato preto', color: 0x26262a },
  { id: 'tenis-branco', label: 'Tênis branco', color: 0xe4e4dc },
  { id: 'bota', label: 'Bota marrom', color: 0x6b4a2e, boot: true },
  { id: 'tenis-vermelho', label: 'Tênis vermelho', color: 0xb02c25 },
  { id: 'descalco', label: 'Descalço', color: 0xffffff, barefoot: true },
];

/** Tons de pele "mortos" a partir de tons humanos variados. */
export const SKINS: readonly SkinDef[] = [
  { id: 'verde', label: 'Pálido esverdeado', tone: 0x8c9a78, hair: 0x2b2019 },
  { id: 'cinza', label: 'Cinza azulado', tone: 0x949ca0, hair: 0x5a5550 },
  { id: 'oliva', label: 'Oliva amarelado', tone: 0xa49f6c, hair: 0x3a2a1a },
  { id: 'marrom', label: 'Marrom acinzentado', tone: 0x6f5c49, hair: 0x15110e },
  { id: 'escuro', label: 'Escuro esverdeado', tone: 0x4c4f3c, hair: 0x0e0d0b },
];

export interface ZombieVariant {
  top: TopDef;
  bottom: BottomDef;
  shoes: ShoeDef;
  skin: SkinDef;
  /** Índice da combinação de roupa (0–124). */
  outfit: number;
}

/** Número de combinações de roupa (5 × 5 × 5). */
export const OUTFIT_COUNT = TOPS.length * BOTTOMS.length * SHOES.length;

/** Monta a variação pelo índice da roupa (0–124) e o tom de pele (0–4). */
export function variantAt(outfit: number, skin: number): ZombieVariant {
  const o = ((outfit % OUTFIT_COUNT) + OUTFIT_COUNT) % OUTFIT_COUNT;
  return {
    top: TOPS[o % TOPS.length],
    bottom: BOTTOMS[Math.floor(o / TOPS.length) % BOTTOMS.length],
    shoes: SHOES[Math.floor(o / (TOPS.length * BOTTOMS.length))],
    skin: SKINS[((skin % SKINS.length) + SKINS.length) % SKINS.length],
    outfit: o,
  };
}

/** Variação aleatória (roupa e pele independentes). */
export function randomVariant(rnd: () => number = Math.random): ZombieVariant {
  return variantAt(Math.floor(rnd() * OUTFIT_COUNT), Math.floor(rnd() * SKINS.length));
}
