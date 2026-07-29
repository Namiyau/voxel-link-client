import { CHUNK_SIZE } from './constants.js';

export const MIN_NEAR_DISTANCE = 8;
export const MAX_NEAR_DISTANCE = 64;
export const MAX_FAR_DISTANCE = 2048;

export function fullDetailChunkRadius(nearDistance) {
  const value = Math.max(MIN_NEAR_DISTANCE, Math.min(MAX_NEAR_DISTANCE, Number(nearDistance) || 16));
  if (value <= 8) return 8;
  if (value <= 12) return 10;
  if (value <= 24) return 12;
  if (value <= 48) return 14;
  return 16;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function targetSchedule(nearBlocks) {
  return [
    { step: 2, target: Math.max(nearBlocks * 0.42, 448), detail: 3 },
    { step: 4, target: Math.max(nearBlocks * 0.78, 896), detail: 2 },
    { step: 8, target: Math.max(nearBlocks * 1.18, 1792), detail: 2 },
    { step: 16, target: 3584, detail: 1 },
    { step: 32, target: 6656, detail: 1 },
    { step: 64, target: 11264, detail: 1 },
    { step: 128, target: 17408, detail: 1 },
    { step: 256, target: 25600, detail: 1 },
    { step: 512, target: 32768, detail: 1 },
  ];
}

// Levels describe resolution only. They are no longer radial fragment bands.
// A quadtree chooses whole tiles, and a parent stays visible until all four
// children can cover it. This removes player-centred rings and streaming holes.
export function makeLodLevels(nearDistance, farDistance) {
  const nearChunks = clamp(Number(nearDistance) || 16, MIN_NEAR_DISTANCE, MAX_NEAR_DISTANCE);
  const farChunks = clamp(Number(farDistance) || 1024, nearChunks + 8, MAX_FAR_DISTANCE);
  const farBlocks = farChunks * CHUNK_SIZE;
  const fullBlocks = fullDetailChunkRadius(nearChunks) * CHUNK_SIZE;
  const nearBlocks = nearChunks * CHUNK_SIZE;
  const levels = [];
  let previousTarget = Math.max(fullBlocks, CHUNK_SIZE * 8);

  for (const base of targetSchedule(nearBlocks)) {
    if (levels.length && previousTarget >= farBlocks) break;
    const target = Math.min(farBlocks, Math.max(previousTarget + base.step * 24, base.target));
    levels.push({
      level: levels.length,
      step: base.step,
      tileSize: base.step * 48,
      cells: 48,
      quantum: 1,
      detail: base.detail,
      splitDistance: target,
      min: levels.length ? previousTarget : 0,
      max: target,
      renderMin: 0,
      renderMax: farBlocks,
    });
    previousTarget = target;
  }
  return levels;
}

export function cellDistanceRange(x0, z0, size, playerX, playerZ) {
  const x1 = x0 + size;
  const z1 = z0 + size;
  const nearestX = Math.max(x0, Math.min(playerX, x1));
  const nearestZ = Math.max(z0, Math.min(playerZ, z1));
  const nearest = Math.hypot(nearestX - playerX, nearestZ - playerZ);
  const farthest = Math.max(
    Math.hypot(x0 - playerX, z0 - playerZ),
    Math.hypot(x1 - playerX, z0 - playerZ),
    Math.hypot(x0 - playerX, z1 - playerZ),
    Math.hypot(x1 - playerX, z1 - playerZ),
  );
  return { nearest, farthest };
}

export function cellInLodBand(x0, z0, size, playerX, playerZ, min, max) {
  const { nearest, farthest } = cellDistanceRange(x0, z0, size, playerX, playerZ);
  return farthest >= min && nearest < max;
}

export function lodTileKey(level, tx, tz) { return `${level}:${tx},${tz}`; }

export function lodChildCoordinates(tx, tz) {
  return [
    [tx * 2, tz * 2],
    [tx * 2 + 1, tz * 2],
    [tx * 2, tz * 2 + 1],
    [tx * 2 + 1, tz * 2 + 1],
  ];
}

export function tileIntersectsBand(tx, tz, spec, playerX, playerZ) {
  const x0 = tx * spec.tileSize;
  const z0 = tz * spec.tileSize;
  const { nearest } = cellDistanceRange(x0, z0, spec.tileSize, playerX, playerZ);
  return nearest <= (spec.renderMax ?? Infinity);
}

export function makeLodTree(nearDistance, farDistance, playerX = 0, playerZ = 0) {
  const levels = makeLodLevels(nearDistance, farDistance);
  const nodes = new Map();
  const children = new Map();
  const roots = [];
  if (!levels.length) return { levels, nodes, children, roots, leaves: new Set() };

  const farBlocks = clamp(Number(farDistance) || 1024, MIN_NEAR_DISTANCE + 8, MAX_FAR_DISTANCE) * CHUNK_SIZE;
  const rootLevel = levels.length - 1;
  const rootSpec = levels[rootLevel];
  const minTx = Math.floor((playerX - farBlocks) / rootSpec.tileSize);
  const maxTx = Math.floor((playerX + farBlocks) / rootSpec.tileSize);
  const minTz = Math.floor((playerZ - farBlocks) / rootSpec.tileSize);
  const maxTz = Math.floor((playerZ + farBlocks) / rootSpec.tileSize);
  const leaves = new Set();

  function visit(level, tx, tz, parentKey = null) {
    const base = levels[level];
    const key = lodTileKey(level, tx, tz);
    const x0 = tx * base.tileSize;
    const z0 = tz * base.tileSize;
    const range = cellDistanceRange(x0, z0, base.tileSize, playerX, playerZ);
    const spec = {
      ...base,
      key,
      tx,
      tz,
      parentKey,
      distance: range.nearest,
      session: 0,
    };
    nodes.set(key, spec);

    if (level > 0) {
      const finer = levels[level - 1];
      // Expand the split threshold by one finer tile. This prefetches all four
      // children before the parent is retired and prevents mountain-sized gaps.
      const shouldSplit = range.nearest < finer.splitDistance + finer.tileSize * 0.25;
      if (shouldSplit) {
        const childKeys = [];
        for (const [childTx, childTz] of lodChildCoordinates(tx, tz)) {
          const childKey = lodTileKey(level - 1, childTx, childTz);
          childKeys.push(childKey);
          visit(level - 1, childTx, childTz, key);
        }
        children.set(key, childKeys);
        return;
      }
    }
    leaves.add(key);
  }

  for (let tz = minTz; tz <= maxTz; tz += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      const key = lodTileKey(rootLevel, tx, tz);
      roots.push(key);
      visit(rootLevel, tx, tz, null);
    }
  }

  return { levels, nodes, children, roots, leaves };
}

export function estimateLodTileCount(nearDistance, farDistance, playerX = 0, playerZ = 0) {
  return makeLodTree(nearDistance, farDistance, playerX, playerZ).nodes.size;
}

// Backward-compatible helpers retained for diagnostics. There are no radial
// fragment owners anymore; tile leaves own coverage through the quadtree.
export function lodOwnershipCount(levels, distance) {
  const value = Number(distance) || 0;
  return levels.filter((level, index) => value >= (index ? levels[index - 1].splitDistance : 0) && value < level.splitDistance).length;
}

export function lodOwnershipIsExclusive(levels, start, end, sampleStep = 8) {
  for (let distance = start; distance < end; distance += sampleStep) {
    if (lodOwnershipCount(levels, distance) !== 1) return false;
  }
  return true;
}

export function lodBandsHaveCoverage(levels, start, end, sampleStep = 8) {
  return lodOwnershipIsExclusive(levels, start, end, sampleStep);
}
