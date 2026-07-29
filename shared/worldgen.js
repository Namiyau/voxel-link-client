import {
  BLOCK,
  CHUNK_SIZE,
  SEA_LEVEL,
  WORLD_HEIGHT,
  floorDiv,
  mod,
} from './constants.js';

export const GENERATOR_VERSION = 2;

function mix32(value) {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hash2(seed, x, z) {
  return mix32((seed | 0) ^ Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495));
}

export function hash3(seed, x, y, z) {
  return mix32(hash2(seed ^ Math.imul(y | 0, 0x6c8e9cf5), x, z));
}

function smoothstep(t) { return t * t * (3 - 2 * t); }
function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function bell(value, center, width) {
  const n = (value - center) / width;
  return Math.exp(-(n * n));
}

function lattice(seed, x, z) { return hash2(seed, x, z) / 0xffffffff; }

export function valueNoise2D(seed, x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smootherstep(x - x0);
  const tz = smootherstep(z - z0);
  const a = lattice(seed, x0, z0);
  const b = lattice(seed, x0 + 1, z0);
  const c = lattice(seed, x0, z0 + 1);
  const d = lattice(seed, x0 + 1, z0 + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

export function fbm2D(seed, x, z, octaves = 5) {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2D(seed + i * 1013, x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

function ridged2D(seed, x, z, octaves = 5) {
  let amplitude = 0.55;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(valueNoise2D(seed + i * 733, x * frequency, z * frequency) * 2 - 1);
    sum += n * n * amplitude;
    norm += amplitude;
    amplitude *= 0.52;
    frequency *= 2.08;
  }
  return sum / norm;
}

function landmarkDescriptor(seed, x, z) {
  const cellSize = 896;
  const cellX = floorDiv(x, cellSize);
  const cellZ = floorDiv(z, cellSize);
  let best = null;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = cellX + dx;
      const cz = cellZ + dz;
      const h = hash2(seed + 5107, cx, cz);
      const centerX = cx * cellSize + 128 + (h & 0x1ff);
      const centerZ = cz * cellSize + 128 + ((h >>> 9) & 0x1ff);
      const distance = Math.hypot(x - centerX, z - centerZ);
      if (!best || distance < best.distance) {
        const roll = (h >>> 18) & 15;
        const type = roll < 2 ? 'volcano'
          : roll < 4 ? 'mesa'
            : roll < 6 ? 'spires'
              : roll < 8 ? 'skylands'
                : roll < 10 ? 'alpine'
                  : roll < 12 ? 'canyon'
                    : roll < 14 ? 'basin'
                      : 'shield';
        best = { type, centerX, centerZ, distance, hash: h };
      }
    }
  }
  return best;
}

function landmarkHeight(seed, x, z, landmark) {
  const d = landmark.distance;
  const dx = x - landmark.centerX;
  const dz = z - landmark.centerZ;
  switch (landmark.type) {
    case 'volcano': {
      const rim = bell(d, 205, 72) * 112;
      const cone = Math.max(0, 1 - d / 330) * 42;
      const crater = d < 92 ? (1 - d / 92) * 76 : 0;
      return rim + cone - crater;
    }
    case 'mesa': {
      const edge = clamp((310 - d) / 74, 0, 1);
      const terraces = Math.floor((80 + fbm2D(seed + 5209, x / 70, z / 70, 3) * 46) / 8) * 8;
      return edge * terraces;
    }
    case 'spires': {
      if (d > 330) return 0;
      let tallest = 0;
      for (let i = 0; i < 7; i += 1) {
        const angle = ((landmark.hash >>> (i % 4) * 6) & 63) / 63 * Math.PI * 2 + i * 0.91;
        const radius = 45 + ((landmark.hash >>> (i % 3) * 7) & 127);
        const sx = landmark.centerX + Math.cos(angle) * radius;
        const sz = landmark.centerZ + Math.sin(angle) * radius;
        const sd = Math.hypot(x - sx, z - sz);
        const width = 18 + ((landmark.hash >>> (i + 3)) & 15);
        tallest = Math.max(tallest, Math.max(0, 1 - sd / width) ** 1.7 * (76 + i * 8));
      }
      return tallest + Math.max(0, 1 - d / 300) * 24;
    }
    case 'alpine': {
      if (d > 430) return 0;
      const ridge = ridged2D(seed + 5303, x / 170, z / 170, 5);
      return Math.max(0, 1 - d / 430) ** 1.3 * (45 + ridge * 125);
    }
    case 'canyon': {
      if (d > 420) return 0;
      const axis = Math.atan2(dz, dx);
      const ribbon = Math.abs(Math.sin(axis * 1.5 + fbm2D(seed + 5601, x / 180, z / 180, 3) * 3.1));
      const rim = Math.max(0, 1 - d / 420) * (28 + ridged2D(seed + 5609, x / 120, z / 120, 4) * 42);
      const trench = ribbon < 0.22 ? (1 - ribbon / 0.22) ** 1.6 * 54 : 0;
      return rim - trench;
    }
    case 'basin': {
      if (d > 390) return 0;
      const ring = bell(d, 210, 62) * 68;
      const floor = d < 155 ? (1 - d / 155) * 26 : 0;
      return ring - floor;
    }
    case 'shield': {
      if (d > 500) return 0;
      const broad = Math.max(0, 1 - d / 500) ** 1.15 * 62;
      const waves = ridged2D(seed + 5647, x / 210, z / 210, 4) * 34;
      return broad + waves;
    }
    default:
      return 0;
  }
}

export function floatingSpan(seed, x, z) {
  const landmark = landmarkDescriptor(seed, x, z);
  if (landmark.type !== 'skylands' || landmark.distance > 290) return null;
  const dx = x - landmark.centerX;
  const dz = z - landmark.centerZ;
  const warp = fbm2D(seed + 5471, x / 58, z / 58, 4);
  const radial = Math.hypot(dx * 0.86, dz * 1.05);
  const mask = 1 - radial / (235 + warp * 60);
  if (mask <= 0.03) return null;
  const top = 154 + Math.floor(ridged2D(seed + 5501, x / 105, z / 105, 4) * 44 + mask * 26);
  const thickness = 8 + Math.floor(mask * 34 + warp * 8);
  const bottom = Math.max(96, top - thickness);
  return { bottom, top, mask };
}

export function terrainInfo(seed, x, z) {
  const warpX = (fbm2D(seed + 7, x / 780, z / 780, 3) - 0.5) * 120;
  const warpZ = (fbm2D(seed + 11, x / 780, z / 780, 3) - 0.5) * 120;
  const wx = x + warpX;
  const wz = z + warpZ;
  const continental = fbm2D(seed + 17, wx / 620, wz / 620, 5);
  const erosion = fbm2D(seed + 73, wx / 210, wz / 210, 4);
  const hills = fbm2D(seed + 191, wx / 92, wz / 92, 4);
  const ridge = ridged2D(seed + 811, wx / 285, wz / 285, 5);
  const mountainMask = clamp((continental - 0.50) * 2.35, 0, 1);
  const mountain = mountainMask ** 1.8 * (24 + ridge * 86);
  const rolling = (hills - 0.5) * (16 + erosion * 18);
  const continentLift = (continental - 0.49) * 42;

  // Long winding ravines cut through otherwise high terrain.
  const ravineField = Math.abs(fbm2D(seed + 2909, wx / 520, wz / 520, 4) - 0.5);
  const ravine = ravineField < 0.032 ? (1 - ravineField / 0.032) ** 2 * (18 + ridge * 24) : 0;

  const landmark = landmarkDescriptor(seed, x, z);
  const spectacle = landmarkHeight(seed, x, z, landmark);
  const rawHeight = SEA_LEVEL + continentLift + rolling + mountain + spectacle - ravine;
  const height = clamp(Math.floor(rawHeight), 8, WORLD_HEIGHT - 9);
  const temperature = fbm2D(seed + 331, x / 480, z / 480, 3);
  const moisture = fbm2D(seed + 443, x / 360, z / 360, 3);
  const rocky = height > 132 || spectacle > 42 || (height > 100 && erosion < 0.36);
  const beach = height <= SEA_LEVEL + 2;
  return {
    height,
    temperature,
    moisture,
    rocky,
    beach,
    mountainMask,
    landmark: landmark.type,
    spectacle,
  };
}

export function surfaceBlock(seed, x, z) {
  const info = terrainInfo(seed, x, z);
  if (info.beach || info.landmark === 'mesa' && info.spectacle > 8) return BLOCK.SAND;
  if (info.rocky) return BLOCK.STONE;
  return BLOCK.GRASS;
}

export function isTreeOrigin(seed, x, z) {
  const info = terrainInfo(seed, x, z);
  if (info.height <= SEA_LEVEL + 2 || info.rocky || info.moisture < 0.38 || info.landmark === 'mesa') return false;
  const spacingCellX = floorDiv(x, 5);
  const spacingCellZ = floorDiv(z, 5);
  const h = hash2(seed + 991, spacingCellX, spacingCellZ);
  const ox = (h & 3) + 1;
  const oz = ((h >>> 3) & 3) + 1;
  if (mod(x, 5) !== ox || mod(z, 5) !== oz) return false;
  return ((h >>> 8) & 0xff) < 82;
}

function treeBlockAt(seed, x, y, z) {
  for (let tx = x - 2; tx <= x + 2; tx += 1) {
    for (let tz = z - 2; tz <= z + 2; tz += 1) {
      if (!isTreeOrigin(seed, tx, tz)) continue;
      const ground = terrainInfo(seed, tx, tz).height;
      const trunkHeight = 4 + (hash2(seed + 1999, tx, tz) & 1);
      if (x === tx && z === tz && y >= ground + 1 && y <= ground + trunkHeight) return BLOCK.WOOD;
      const crownY = ground + trunkHeight;
      const dx = Math.abs(x - tx);
      const dz = Math.abs(z - tz);
      const dy = y - crownY;
      if (dy >= -2 && dy <= 1) {
        const radius = dy === 1 ? 1 : 2;
        if (dx <= radius && dz <= radius && dx + dz <= radius + 1) {
          if (!(x === tx && z === tz && y <= crownY)) return BLOCK.LEAVES;
        }
      }
    }
  }
  return BLOCK.AIR;
}

function floatingBlock(seed, x, y, z) {
  const span = floatingSpan(seed, x, z);
  if (!span || y < span.bottom || y > span.top) return BLOCK.AIR;
  if (y === span.top) return span.mask > 0.16 ? BLOCK.GRASS : BLOCK.STONE;
  if (y >= span.top - 2) return BLOCK.DIRT;
  return BLOCK.STONE;
}

export function getGeneratedBlock(seed, x, y, z) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return BLOCK.AIR;
  if (y < 0) return BLOCK.STONE;
  if (y >= WORLD_HEIGHT) return BLOCK.AIR;

  const info = terrainInfo(seed, x, z);
  if (y > info.height) {
    const floating = floatingBlock(seed, x, y, z);
    if (floating !== BLOCK.AIR) return floating;
    const tree = treeBlockAt(seed, x, y, z);
    if (tree !== BLOCK.AIR) return tree;
    return y <= SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR;
  }

  if (y === 0) return BLOCK.STONE;
  if (y === info.height) return surfaceBlock(seed, x, z);
  if (y >= info.height - 3) return info.beach || info.landmark === 'mesa' ? BLOCK.SAND : BLOCK.DIRT;
  return BLOCK.STONE;
}

export function voxelIndex(lx, y, lz) {
  return y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
}

export function generateChunkVoxelData(seed, cx, cz) {
  const blocks = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
  const heights = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      const x = originX + lx;
      const z = originZ + lz;
      const info = terrainInfo(seed, x, z);
      heights[lz * CHUNK_SIZE + lx] = info.height;
      for (let y = 0; y <= Math.max(info.height, SEA_LEVEL); y += 1) {
        let type = BLOCK.AIR;
        if (y <= info.height) {
          if (y === 0) type = BLOCK.STONE;
          else if (y === info.height) type = surfaceBlock(seed, x, z);
          else if (y >= info.height - 3) type = info.beach || info.landmark === 'mesa' ? BLOCK.SAND : BLOCK.DIRT;
          else type = BLOCK.STONE;
        } else if (y <= SEA_LEVEL) type = BLOCK.WATER;
        blocks[voxelIndex(lx, y, lz)] = type;
      }
      const span = floatingSpan(seed, x, z);
      if (span) {
        for (let y = span.bottom; y <= span.top; y += 1) {
          blocks[voxelIndex(lx, y, lz)] = y === span.top ? (span.mask > 0.16 ? BLOCK.GRASS : BLOCK.STONE)
            : y >= span.top - 2 ? BLOCK.DIRT : BLOCK.STONE;
        }
      }
    }
  }

  // Trees are generated after terrain so their leaves can cross chunk boundaries.
  for (let tz = originZ - 2; tz < originZ + CHUNK_SIZE + 2; tz += 1) {
    for (let tx = originX - 2; tx < originX + CHUNK_SIZE + 2; tx += 1) {
      if (!isTreeOrigin(seed, tx, tz)) continue;
      const ground = terrainInfo(seed, tx, tz).height;
      const trunkHeight = 4 + (hash2(seed + 1999, tx, tz) & 1);
      for (let y = ground + 1; y <= ground + trunkHeight; y += 1) setIfInside(blocks, cx, cz, tx, y, tz, BLOCK.WOOD);
      const crownY = ground + trunkHeight;
      for (let dy = -2; dy <= 1; dy += 1) {
        const radius = dy === 1 ? 1 : 2;
        for (let dz = -radius; dz <= radius; dz += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
            if (dx === 0 && dz === 0 && dy <= 0) continue;
            setIfInside(blocks, cx, cz, tx + dx, crownY + dy, tz + dz, BLOCK.LEAVES, true);
          }
        }
      }
    }
  }

  return { blocks, heights };
}

function setIfInside(blocks, cx, cz, x, y, z, type, onlyIfAir = false) {
  if (y < 0 || y >= WORLD_HEIGHT) return;
  const lx = x - cx * CHUNK_SIZE;
  const lz = z - cz * CHUNK_SIZE;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
  const index = voxelIndex(lx, y, lz);
  if (!onlyIfAir || blocks[index] === BLOCK.AIR) blocks[index] = type;
}

export function blockColor(seed, x, z, height = terrainInfo(seed, x, z).height) {
  const info = terrainInfo(seed, x, z);
  if (height <= SEA_LEVEL) return [0.73, 0.66, 0.40];
  if (info.landmark === 'mesa' && info.spectacle > 8) {
    const band = (Math.floor(height / 7) + (hash2(seed + 79, floorDiv(x, 16), floorDiv(z, 16)) & 1)) % 3;
    return band === 0 ? [0.62, 0.34, 0.18] : band === 1 ? [0.76, 0.48, 0.24] : [0.50, 0.28, 0.18];
  }
  if (height > 190) return [0.82, 0.85, 0.86];
  if (info.rocky) {
    const tone = 0.43 + Math.min(0.22, (height - 90) / 430);
    return [tone, tone * 0.98, tone * 0.94];
  }
  const variation = (hash2(seed + 77, floorDiv(x, 8), floorDiv(z, 8)) & 255) / 255;
  return [0.22 + variation * 0.06, 0.50 + variation * 0.09, 0.19 + variation * 0.05];
}
