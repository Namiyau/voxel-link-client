import {
  BLOCK,
  CHUNK_SIZE,
  SEA_LEVEL,
  WORLD_HEIGHT,
  chunkKey,
  floorDiv,
  mod,
} from './constants.js';
import {
  floatingSpan,
  generateChunkVoxelData,
  getGeneratedBlock,
  isTreeOrigin,
  surfaceBlock,
  terrainInfo,
  voxelIndex,
} from './worldgen.js';

const FACES = [
  { name: 'right', dir: [1, 0, 0], normal: [1, 0, 0], corners: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },
  { name: 'left', dir: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
  { name: 'top', dir: [0, 1, 0], normal: [0, 1, 0], corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] },
  { name: 'bottom', dir: [0, -1, 0], normal: [0, -1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] },
  { name: 'front', dir: [0, 0, 1], normal: [0, 0, 1], corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  { name: 'back', dir: [0, 0, -1], normal: [0, 0, -1], corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },
];

const GRID = 4;

function target({ colors = false } = {}) {
  return { positions: [], normals: [], uvs: [], colors: colors ? [] : null, indices: [] };
}

function tileUV(tile) {
  const x = tile % GRID;
  const y = Math.floor(tile / GRID);
  const e = 0.0015;
  return {
    u0: x / GRID + e,
    u1: (x + 1) / GRID - e,
    v1: 1 - y / GRID - e,
    v0: 1 - (y + 1) / GRID + e,
  };
}

function tileForFace(block, faceName) {
  switch (block) {
    case BLOCK.GRASS: return faceName === 'top' ? 0 : faceName === 'bottom' ? 2 : 1;
    case BLOCK.DIRT: return 2;
    case BLOCK.STONE: return 3;
    case BLOCK.SAND: return 4;
    case BLOCK.WOOD: return faceName === 'top' || faceName === 'bottom' ? 6 : 5;
    case BLOCK.LEAVES: return 7;
    case BLOCK.PLANKS: return 8;
    case BLOCK.GLASS: return 9;
    case BLOCK.WATER: return 10;
    default: return 3;
  }
}

function pushQuad(out, x, y, z, face, tile, color = null, scale = [1, 1, 1]) {
  const base = out.positions.length / 3;
  const uv = tileUV(tile);
  const uvs = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
  for (let i = 0; i < 4; i += 1) {
    const c = face.corners[i];
    out.positions.push(x + c[0] * scale[0], y + c[1] * scale[1], z + c[2] * scale[2]);
    out.normals.push(...face.normal);
    out.uvs.push(...uvs[i]);
    if (out.colors) out.colors.push(...(color ?? [1, 1, 1]));
  }
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function pushRawQuad(out, corners, normal, tile, color) {
  const base = out.positions.length / 3;
  const uv = tileUV(tile);
  const uvs = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
  for (let i = 0; i < 4; i += 1) {
    out.positions.push(...corners[i]);
    out.normals.push(...normal);
    out.uvs.push(...uvs[i]);
    if (out.colors) out.colors.push(...color);
  }
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function pushBox(out, x, y, z, sx, sy, sz, block, color) {
  for (const face of FACES) pushQuad(out, x, y, z, face, tileForFace(block, face.name), color, [sx, sy, sz]);
}

function finalize(out) {
  const vertexCount = out.positions.length / 3;
  const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
  return {
    positions: new Float32Array(out.positions),
    // Normalized integer attributes cut mesh transfer and GPU memory sharply.
    normals: Int8Array.from(out.normals, (value) => Math.round(Math.max(-1, Math.min(1, value)) * 127)),
    uvs: Uint16Array.from(out.uvs, (value) => Math.round(Math.max(0, Math.min(1, value)) * 65535)),
    colors: out.colors ? Uint8Array.from(out.colors, (value) => Math.round(Math.max(0, Math.min(1, value)) * 255)) : null,
    indices: new IndexArray(out.indices),
  };
}

function emptyBuffers() {
  return {
    positions: new Float32Array(),
    normals: new Int8Array(),
    uvs: new Uint16Array(),
    colors: null,
    indices: new Uint16Array(),
  };
}

function lookupModifiedBlock(modLookup, x, y, z) {
  const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
  const chunk = modLookup?.[key];
  if (!chunk) return undefined;
  const local = `${mod(x, CHUNK_SIZE)},${y},${mod(z, CHUNK_SIZE)}`;
  return Object.prototype.hasOwnProperty.call(chunk, local) ? Number(chunk[local]) : undefined;
}

function blockAt(seed, modLookup, x, y, z) {
  if (y < 0) return BLOCK.STONE;
  if (y >= WORLD_HEIGHT) return BLOCK.AIR;
  const modified = lookupModifiedBlock(modLookup, x, y, z);
  return modified === undefined ? getGeneratedBlock(seed, x, y, z) : modified;
}

export function buildChunkMeshData({ seed, cx, cz, modLookup = {} }) {
  const opaque = target();
  const glass = target();
  const water = target();
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const currentKey = chunkKey(cx, cz);
  const data = generateChunkVoxelData(seed, cx, cz);
  const currentMods = modLookup[currentKey] ?? {};
  const modifiedColumnTop = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
  modifiedColumnTop.fill(-1);
  for (const [localKey, block] of Object.entries(currentMods)) {
    const [lx, y, lz] = localKey.split(',').map(Number);
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) continue;
    data.blocks[voxelIndex(lx, y, lz)] = Number(block);
    modifiedColumnTop[lz * CHUNK_SIZE + lx] = Math.max(modifiedColumnTop[lz * CHUNK_SIZE + lx], y);
  }

  const localBlock = (gx, y, gz) => {
    if (y < 0) return BLOCK.STONE;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;
    const lx = gx - ox;
    const lz = gz - oz;
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) return data.blocks[voxelIndex(lx, y, lz)];
    return blockAt(seed, modLookup, gx, y, gz);
  };

  for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      const gx = ox + lx;
      const gz = oz + lz;
      const ground = data.heights[lz * CHUNK_SIZE + lx];
      const island = floatingSpan(seed, gx, gz);
      const maxY = Math.min(
        WORLD_HEIGHT - 1,
        Math.max(SEA_LEVEL + 1, ground + 7, island?.top ?? 0, modifiedColumnTop[lz * CHUNK_SIZE + lx]),
      );
      for (let y = 0; y <= maxY; y += 1) {
        const block = data.blocks[voxelIndex(lx, y, lz)];
        if (block === BLOCK.AIR) continue;
        if (block === BLOCK.WATER) continue;
        for (const face of FACES) {
          const neighbor = localBlock(gx + face.dir[0], y + face.dir[1], gz + face.dir[2]);
          const visible = neighbor === BLOCK.AIR || neighbor === BLOCK.WATER || (block === BLOCK.GLASS && neighbor !== BLOCK.GLASS);
          if (!visible) continue;
          pushQuad(block === BLOCK.GLASS ? glass : opaque, gx, y, gz, face, tileForFace(block, face.name));
        }
      }
    }
  }

  return {
    opaque: opaque.indices.length ? finalize(opaque) : emptyBuffers(),
    glass: glass.indices.length ? finalize(glass) : emptyBuffers(),
    water: water.indices.length ? finalize(water) : emptyBuffers(),
  };
}

function shade(color, factor) { return color.map((value) => value * factor); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }

export function sampleLodSurface(seed, gx, gz) {
  const info = terrainInfo(seed, gx, gz);
  const water = info.height < SEA_LEVEL;
  // Water is rendered by one continuous world-space surface. Every terrain LOD
  // therefore represents only the actual seafloor/land height and material.
  const height = info.height + 0.96;
  const block = surfaceBlock(seed, Math.floor(gx), Math.floor(gz));
  return {
    height,
    block,
    water,
    info,
    // White vertex colour keeps the exact same atlas brightness as near chunks.
    // Lighting and face normals provide shading consistently at every level.
    color: [1, 1, 1],
    floating: floatingSpan(seed, Math.floor(gx), Math.floor(gz)),
  };
}

function addSimplifiedTree(out, seed, x0, z0, cellSize, surface) {
  if (cellSize > 2 || surface.block !== BLOCK.GRASS) return;
  const tx = Math.floor(x0 + cellSize * 0.5);
  const tz = Math.floor(z0 + cellSize * 0.5);
  if (!isTreeOrigin(seed, tx, tz)) return;
  const h = surface.height;
  const trunk = Math.max(3, cellSize * 2.2);
  const crown = Math.max(2.2, cellSize * 2.2);
  pushBox(out, tx + 0.34, h, tz + 0.34, 0.32, trunk, 0.32, BLOCK.WOOD, [1, 1, 1]);
  pushBox(out, tx - crown * 0.5 + 0.5, h + trunk - crown * 0.58, tz - crown * 0.5 + 0.5, crown, crown, crown, BLOCK.LEAVES, [1, 1, 1]);
}

function addTileSkirts(out, at, cells, sampleStep) {
  const depth = Math.max(6.0, Math.min(18.0, sampleStep * 1.35));
  const overlap = Math.min(0.45, 0.08 + sampleStep * 0.06);
  const topLift = 0.08;
  const add = (current, direction) => {
    const x0 = current.x0;
    const x1 = x0 + sampleStep;
    const z0 = current.z0;
    const z1 = z0 + sampleStep;
    const h = current.height + topLift;
    const low = h - depth;
    const tile = tileForFace(current.block, 'front');
    const color = current.color;
    if (direction === 'west') pushRawQuad(out, [[x0 - overlap,low,z0 - overlap],[x0 - overlap,low,z1 + overlap],[x0 - overlap,h,z1 + overlap],[x0 - overlap,h,z0 - overlap]], [-1,0,0], tile, color);
    if (direction === 'east') pushRawQuad(out, [[x1 + overlap,low,z1 + overlap],[x1 + overlap,low,z0 - overlap],[x1 + overlap,h,z0 - overlap],[x1 + overlap,h,z1 + overlap]], [1,0,0], tile, color);
    if (direction === 'north') pushRawQuad(out, [[x1 + overlap,low,z0 - overlap],[x0 - overlap,low,z0 - overlap],[x0 - overlap,h,z0 - overlap],[x1 + overlap,h,z0 - overlap]], [0,0,-1], tile, color);
    if (direction === 'south') pushRawQuad(out, [[x0 - overlap,low,z1 + overlap],[x1 + overlap,low,z1 + overlap],[x1 + overlap,h,z1 + overlap],[x0 - overlap,h,z1 + overlap]], [0,0,1], tile, color);
  };
  for (let i = 0; i < cells; i += 1) {
    add(at(0, i), 'west');
    add(at(cells - 1, i), 'east');
    add(at(i, 0), 'north');
    add(at(i, cells - 1), 'south');
  }
}

export function buildLodMeshData({ seed, spec, mods = [] }) {
  const { tileSize, step, tx, tz, level, quantum, detail = 1 } = spec;
  const sampleDiv = detail >= 3 && step <= 2 ? 2 : 1;
  const sampleStep = step / sampleDiv;
  const cells = Math.floor(tileSize / sampleStep);
  const stride = cells + 2;
  const out = target({ colors: true });
  const ox = tx * tileSize;
  const oz = tz * tileSize;
  const samples = new Array(stride * stride);
  const index = (x, z) => (z + 1) * stride + x + 1;

  for (let z = -1; z <= cells; z += 1) {
    for (let x = -1; x <= cells; x += 1) {
      const x0 = ox + x * sampleStep;
      const z0 = oz + z * sampleStep;
      const gx = x0 + sampleStep * 0.5;
      const gz = z0 + sampleStep * 0.5;
      samples[index(x, z)] = {
        ...sampleLodSurface(seed, gx, gz),
        x0,
        z0,
      };
    }
  }

  for (const item of mods) {
    const { x, y, z, block } = item;
    if (block === BLOCK.AIR || x < ox || z < oz || x >= ox + tileSize || z >= oz + tileSize) continue;
    const cellX = Math.floor((x - ox) / sampleStep);
    const cellZ = Math.floor((z - oz) / sampleStep);
    if (cellX < 0 || cellZ < 0 || cellX >= cells || cellZ >= cells) continue;
    const sample = samples[index(cellX, cellZ)];
    const modifiedTop = y + 0.96;
    if (modifiedTop >= sample.height) {
      sample.height = modifiedTop;
      sample.block = block;
      sample.color = [1, 1, 1];
    }
  }

  const at = (x, z) => samples[index(x, z)];
  for (let z = 0; z < cells; z += 1) {
    for (let x = 0; x < cells; x += 1) {
      const current = at(x, z);
      const east = at(x + 1, z);
      const west = at(x - 1, z);
      const south = at(x, z + 1);
      const north = at(x, z - 1);
      const x0 = current.x0;
      const x1 = x0 + sampleStep;
      const z0 = current.z0;
      const z1 = z0 + sampleStep;
      const h = current.height;
      const topTile = tileForFace(current.block, 'top');
      pushRawQuad(out, [[x0,h,z1],[x1,h,z1],[x1,h,z0],[x0,h,z0]], [0,1,0], topTile, current.color);

      const side = (other, direction) => {
        if (h <= other.height + 0.01) return;
        const low = other.height;
        const tile = tileForFace(current.block, 'front');
        if (direction === 'east') pushRawQuad(out, [[x1,low,z1],[x1,low,z0],[x1,h,z0],[x1,h,z1]], [1,0,0], tile, current.color);
        if (direction === 'west') pushRawQuad(out, [[x0,low,z0],[x0,low,z1],[x0,h,z1],[x0,h,z0]], [-1,0,0], tile, current.color);
        if (direction === 'south') pushRawQuad(out, [[x0,low,z1],[x1,low,z1],[x1,h,z1],[x0,h,z1]], [0,0,1], tile, current.color);
        if (direction === 'north') pushRawQuad(out, [[x1,low,z0],[x0,low,z0],[x0,h,z0],[x1,h,z0]], [0,0,-1], tile, current.color);
      };
      side(east, 'east'); side(west, 'west'); side(south, 'south'); side(north, 'north');

      if (current.floating) {
        const top = current.floating.top + 0.96;
        const bottom = current.floating.bottom;
        const color = [1, 1, 1];
        pushRawQuad(out, [[x0,top,z1],[x1,top,z1],[x1,top,z0],[x0,top,z0]], [0,1,0], current.floating.mask > 0.16 ? 0 : 3, color);
        const has = (sample) => Boolean(sample?.floating);
        if (!has(east)) pushRawQuad(out, [[x1,bottom,z1],[x1,bottom,z0],[x1,top,z0],[x1,top,z1]], [1,0,0], 3, color);
        if (!has(west)) pushRawQuad(out, [[x0,bottom,z0],[x0,bottom,z1],[x0,top,z1],[x0,top,z0]], [-1,0,0], 3, color);
        if (!has(south)) pushRawQuad(out, [[x0,bottom,z1],[x1,bottom,z1],[x1,top,z1],[x0,top,z1]], [0,0,1], 3, color);
        if (!has(north)) pushRawQuad(out, [[x1,bottom,z0],[x0,bottom,z0],[x0,top,z0],[x1,top,z0]], [0,0,-1], 3, color);
        pushRawQuad(out, [[x0,bottom,z0],[x1,bottom,z0],[x1,bottom,z1],[x0,bottom,z1]], [0,-1,0], 3, color);
      }

      if (detail >= 3) addSimplifiedTree(out, seed, x0, z0, sampleStep, current);
    }
  }

  // A shallow perimeter skirt hides T-junctions where a fine quadtree tile
  // meets a coarser neighbour. It is not distance-based and cannot form rings.
  addTileSkirts(out, at, cells, sampleStep);
  return finalize(out);
}

export function transferableBuffers(result) {
  const buffers = [];
  const add = (part) => {
    if (!part) return;
    for (const value of Object.values(part)) if (ArrayBuffer.isView(value) && value.buffer.byteLength) buffers.push(value.buffer);
  };
  if (result.opaque) {
    add(result.opaque); add(result.glass); add(result.water);
  } else add(result);
  return buffers;
}
