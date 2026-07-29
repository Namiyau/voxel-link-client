export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 256;
export const SEA_LEVEL = 62;
export const DAY_LENGTH_SECONDS = 1200;

export const BLOCK = Object.freeze({
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  PLANKS: 7,
  GLASS: 8,
  WATER: 9,
});

export const PLACEABLE_BLOCKS = Object.freeze([
  BLOCK.GRASS,
  BLOCK.DIRT,
  BLOCK.STONE,
  BLOCK.SAND,
  BLOCK.WOOD,
  BLOCK.LEAVES,
  BLOCK.PLANKS,
  BLOCK.GLASS,
]);

export const BLOCK_NAMES = Object.freeze({
  [BLOCK.AIR]: '空气',
  [BLOCK.GRASS]: '草方块',
  [BLOCK.DIRT]: '泥土',
  [BLOCK.STONE]: '石头',
  [BLOCK.SAND]: '沙子',
  [BLOCK.WOOD]: '木头',
  [BLOCK.LEAVES]: '树叶',
  [BLOCK.PLANKS]: '木板',
  [BLOCK.GLASS]: '玻璃',
  [BLOCK.WATER]: '水',
});

export const SOLID_BLOCKS = new Set([
  BLOCK.GRASS,
  BLOCK.DIRT,
  BLOCK.STONE,
  BLOCK.SAND,
  BLOCK.WOOD,
  BLOCK.LEAVES,
  BLOCK.PLANKS,
  BLOCK.GLASS,
]);

export function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

export function floorDiv(value, divisor) {
  return Math.floor(value / divisor);
}

export function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
