import THREE from './three-loader.js';
import {
  BLOCK,
  CHUNK_SIZE,
  SOLID_BLOCKS,
  SEA_LEVEL,
  WORLD_HEIGHT,
  chunkKey,
  floorDiv,
  mod,
} from '../shared/constants.js';
import { getGeneratedBlock } from '../shared/worldgen.js';
import {
  MAX_FAR_DISTANCE,
  MAX_NEAR_DISTANCE,
  MIN_NEAR_DISTANCE,
  fullDetailChunkRadius,
  makeLodLevels,
  makeLodTree,
} from '../shared/lod.js';
import { buildChunkMeshData, buildLodMeshData } from '../shared/mesh-builders.js';
import { MeshWorkerPool } from './mesh-worker-pool.js';

function geometryFromBuffers(data) {
  if (!data?.indices?.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3, true));
  if (data.uvs?.length) geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2, true));
  if (data.colors?.length) geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3, true));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function mapToObject(map) { return map?.size ? Object.fromEntries(map) : {}; }

function meshResultByteLength(value) {
  if (!value) return 0;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value !== 'object') return 0;
  let total = 0;
  for (const child of Object.values(value)) total += meshResultByteLength(child);
  return total;
}

function continuousWaterGeometry(halfSize) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -halfSize, 0, -halfSize,
     halfSize, 0, -halfSize,
     halfSize, 0,  halfSize,
    -halfSize, 0,  halfSize,
  ]), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([
    0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0,
  ]), 3, true));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array([
    0, 0, 65535, 0, 65535, 65535, 0, 65535,
  ]), 2, true));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 2, 1, 0, 3, 2]), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export class VoxelWorld extends EventTarget {
  constructor(scene, materials, network = null) {
    super();
    this.scene = scene;
    this.materials = materials;
    this.network = network;
    this.seed = 1;
    this.nearDistance = 16;
    this.farDistance = 1024;
    this.chunks = new Map();
    this.chunkMods = new Map();
    this.requestedChunks = new Set();
    this.chunkQueue = [];
    this.queuedChunkKeys = new Set();
    this.pendingChunkKeys = new Set();
    this.readyChunkResults = [];
    this.chunkRevisions = new Map();
    this.chunkDirtyAfterBuild = new Set();
    this.neededNearChunks = new Set();
    this.lodTiles = new Map();
    this.lodQueue = [];
    this.queuedLodKeys = new Set();
    this.pendingLodKeys = new Set();
    this.readyLodResults = [];
    this.lodRevisions = new Map();
    this.lodDirtyAfterBuild = new Set();
    this.neededLodKeys = new Set();
    this.lodTreeRoots = [];
    this.lodChildren = new Map();
    this.lodSpecs = new Map();
    this.lodRootLevel = 0;
    this.lodRefineLevel = null;
    this.lodStageReadyAt = 0;
    this.lodStageDelayMs = 650;
    this.minLodRefineLevel = 0;
    this.lastCenter = { cx: Infinity, cz: Infinity };
    this.lastLodCenter = { cx: Infinity, cz: Infinity };
    this.group = new THREE.Group();
    this.lodGroup = new THREE.Group();
    this.waterSurface = new THREE.Mesh(continuousWaterGeometry(1), this.materials.water);
    this.waterSurface.name = 'continuous-water-surface';
    this.waterSurface.renderOrder = 1;
    this.waterSurface.receiveShadow = false;
    this.waterSurface.castShadow = false;
    this.waterSurface.matrixAutoUpdate = true;
    this.scene.add(this.lodGroup, this.group, this.waterSurface);
    this.singleplayer = true;
    this.localDirty = new Set();
    this.shadowsEnabled = true;
    this.shadowDistance = 3;
    this.sessionId = 0;
    this.lastPlayerPosition = { x: 0, z: 0 };
    this.workerPool = new MeshWorkerPool();
    this.queueBudgetMs = 5.5;
    this.maxWorkerDispatchPerFrame = 2;
    this.maxMeshInstallsPerFrame = 2;
    this.maxMeshInstallBytesPerFrame = 12 * 1024 * 1024;
    const deviceMemory = Number(globalThis.navigator?.deviceMemory) || 8;
    this.maxChunkMeshes = deviceMemory <= 4 ? 360 : deviceMemory <= 8 ? 520 : 680;
    this.maxLodMeshes = deviceMemory <= 4 ? 760 : deviceMemory <= 8 ? 900 : 1100;
    this.minLodRefineLevel = deviceMemory <= 4 ? 1 : 0;
    this.maxReadyMeshResults = deviceMemory <= 4 ? 4 : deviceMemory <= 8 ? 6 : 8;
    this.retireDelayMs = 420;
    this.dispatchFlip = false;
    this.installFlip = false;
    this.streamStartedAt = performance.now();
  }

  reset({ seed, nearDistance, farDistance, singleplayer, network }) {
    this.sessionId += 1;
    this.disposeAll();
    this.seed = seed | 0;
    this.nearDistance = Math.max(MIN_NEAR_DISTANCE, Math.min(MAX_NEAR_DISTANCE, Number(nearDistance) || 16));
    this.farDistance = Math.max(this.nearDistance + 8, Math.min(MAX_FAR_DISTANCE, Number(farDistance) || 1024));
    this.singleplayer = singleplayer;
    this.network = network ?? null;
    this.lastCenter = { cx: Infinity, cz: Infinity };
    this.lastLodCenter = { cx: Infinity, cz: Infinity };
    this.lodRefineLevel = null;
    this.lodStageReadyAt = 0;
    this.streamStartedAt = performance.now();
    this.rebuildWaterSurface();
    this.updateWaterSurface(0, 0);
    this.updateLodNearMask();
  }

  get fullDetailRadius() { return fullDetailChunkRadius(this.nearDistance); }
  get workerStats() {
    const totalStages = this.lodRootLevel + 1;
    const completedStages = this.lodRefineLevel === null ? 0 : Math.max(0, this.lodRootLevel - this.lodRefineLevel);
    const lodStageCount = Math.max(1, this.lodRootLevel - this.minLodRefineLevel + 1);
    const lodStagePass = this.lodRefineLevel === null ? 0 : Math.min(lodStageCount, this.lodRootLevel - this.lodRefineLevel + 1);
    return {
      enabled: this.workerPool.enabled,
      active: this.workerPool.active,
      queued: this.chunkQueue.length + this.lodQueue.length,
      ready: this.readyChunkResults.length + this.readyLodResults.length,
      chunkBudget: this.maxChunkMeshes,
      lodBudget: this.maxLodMeshes,
      lodStage: this.lodRefineLevel,
      totalStages,
      completedStages,
      lodStageCount,
      lodStagePass,
      streamAgeMs: performance.now() - this.streamStartedAt,
      streaming: this.chunkQueue.length > 0 || this.lodQueue.length > 0 || this.pendingChunkKeys.size > 0 || this.pendingLodKeys.size > 0 || this.readyChunkResults.length > 0 || this.readyLodResults.length > 0 || this.lodRefineLevel > this.minLodRefineLevel,
    };
  }

  setPerformanceHint(fps, triangles = 0) {
    if (!Number.isFinite(fps) || fps <= 0) return;
    if (fps < 22 || triangles > 5_500_000) {
      this.queueBudgetMs = 1.5;
      this.maxWorkerDispatchPerFrame = 1;
      this.maxMeshInstallsPerFrame = 1;
      this.maxMeshInstallBytesPerFrame = 5 * 1024 * 1024;
    } else if (fps < 35 || triangles > 3_500_000) {
      this.queueBudgetMs = 2.5;
      this.maxWorkerDispatchPerFrame = 1;
      this.maxMeshInstallsPerFrame = 1;
      this.maxMeshInstallBytesPerFrame = 8 * 1024 * 1024;
    } else if (fps > 52 && triangles < 1_800_000) {
      this.queueBudgetMs = 7.0;
      this.maxWorkerDispatchPerFrame = 2;
      this.maxMeshInstallsPerFrame = 2;
      this.maxMeshInstallBytesPerFrame = 14 * 1024 * 1024;
    } else {
      this.queueBudgetMs = 4.5;
      this.maxWorkerDispatchPerFrame = 2;
      this.maxMeshInstallsPerFrame = 2;
      this.maxMeshInstallBytesPerFrame = 10 * 1024 * 1024;
    }
  }

  setShadowPolicy(enabled, distance = 3) {
    this.shadowsEnabled = Boolean(enabled);
    this.shadowDistance = Math.max(0, Math.floor(distance));
    for (const entry of this.chunks.values()) this.updateChunkShadows(entry, this.lastCenter.cx, this.lastCenter.cz);
  }

  disposeAll() {
    for (const entry of this.chunks.values()) this.disposeChunk(entry);
    for (const mesh of this.lodTiles.values()) this.disposeLodMesh(mesh);
    this.chunks.clear();
    this.chunkMods.clear();
    this.requestedChunks.clear();
    this.chunkQueue.length = 0;
    this.queuedChunkKeys.clear();
    this.pendingChunkKeys.clear();
    this.readyChunkResults.length = 0;
    this.chunkRevisions.clear();
    this.chunkDirtyAfterBuild.clear();
    this.neededNearChunks.clear();
    this.lodTiles.clear();
    this.lodQueue.length = 0;
    this.queuedLodKeys.clear();
    this.pendingLodKeys.clear();
    this.readyLodResults.length = 0;
    this.lodRevisions.clear();
    this.lodDirtyAfterBuild.clear();
    this.neededLodKeys.clear();
    this.lodTreeRoots.length = 0;
    this.lodChildren.clear();
    this.lodSpecs.clear();
    this.lodRefineLevel = null;
    this.lodStageReadyAt = 0;
    this.localDirty.clear();
  }

  disposeChunk(entry) {
    if (!entry?.group) return;
    entry.group.traverse((object) => object.geometry?.dispose?.());
    this.group.remove(entry.group);
  }

  disposeLodMesh(mesh) {
    mesh?.geometry?.dispose?.();
    if (mesh) this.lodGroup.remove(mesh);
  }

  rebuildWaterSurface() {
    const farBlocks = this.farDistance * CHUNK_SIZE;
    const halfSize = Math.max(2048, farBlocks * 1.12);
    const old = this.waterSurface.geometry;
    this.waterSurface.geometry = continuousWaterGeometry(halfSize);
    old?.dispose?.();
    this.waterSurface.userData.halfSize = halfSize;
  }

  updateWaterSurface(x, z) {
    const snap = CHUNK_SIZE * 16;
    const px = Math.floor((Number(x) || 0) / snap) * snap;
    const pz = Math.floor((Number(z) || 0) / snap) * snap;
    this.waterSurface.position?.set?.(px, SEA_LEVEL + 0.92, pz);
    if (this.waterSurface.position && !this.waterSurface.position.set) {
      this.waterSurface.position.x = px;
      this.waterSurface.position.y = SEA_LEVEL + 0.92;
      this.waterSurface.position.z = pz;
    }
  }

  getChunkRevision(key) { return this.chunkRevisions.get(key) ?? 0; }

  bumpChunkRevision(key) {
    const revision = this.getChunkRevision(key) + 1;
    this.chunkRevisions.set(key, revision);
    return revision;
  }

  getLodRevision(key) { return this.lodRevisions.get(key) ?? 0; }

  bumpLodRevision(key) {
    const revision = this.getLodRevision(key) + 1;
    this.lodRevisions.set(key, revision);
    return revision;
  }

  updateLodNearMask() {
    const size = Number(this.materials.lodNearMaskSize) || 64;
    const half = Math.floor(size / 2);
    const centerCx = Number.isFinite(this.lastCenter.cx) ? this.lastCenter.cx : 0;
    const centerCz = Number.isFinite(this.lastCenter.cz) ? this.lastCenter.cz : 0;
    const originCx = centerCx - half;
    const originCz = centerCz - half;
    const loaded = [];
    for (const entry of this.chunks.values()) loaded.push([entry.cx, entry.cz]);
    this.materials.updateLodNearMask?.(originCx, originCz, loaded);
  }

  queueChunkBuild(cx, cz, { rebuild = true, front = true } = {}) {
    const key = chunkKey(cx, cz);
    const revision = this.getChunkRevision(key);
    const queued = this.chunkQueue.find((item) => item.key === key);
    if (queued) {
      queued.revision = revision;
      queued.rebuild = queued.rebuild || rebuild;
      return;
    }
    if (this.pendingChunkKeys.has(key)) {
      this.chunkDirtyAfterBuild.add(key);
      return;
    }
    if (!this.chunks.has(key) && !this.neededNearChunks.has(key)) return;
    const item = { key, cx, cz, rebuild: rebuild && this.chunks.has(key), revision, session: this.sessionId };
    if (front) this.chunkQueue.unshift(item); else this.chunkQueue.push(item);
    this.queuedChunkKeys.add(key);
  }

  queueLodBuild(spec, { front = true } = {}) {
    if (!spec || !this.neededLodKeys.has(spec.key)) return;
    const revision = this.getLodRevision(spec.key);
    const queued = this.lodQueue.find((item) => item.key === spec.key);
    if (queued) {
      queued.revision = revision;
      return;
    }
    if (this.pendingLodKeys.has(spec.key)) {
      this.lodDirtyAfterBuild.add(spec.key);
      return;
    }
    const item = { ...spec, revision, session: this.sessionId };
    if (front) this.lodQueue.unshift(item); else this.lodQueue.push(item);
    this.queuedLodKeys.add(item.key);
  }

  getBlock(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return BLOCK.STONE;
    if (y >= WORLD_HEIGHT) return BLOCK.AIR;
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const mods = this.chunkMods.get(chunkKey(cx, cz));
    const localKey = `${mod(x, CHUNK_SIZE)},${y},${mod(z, CHUNK_SIZE)}`;
    if (mods?.has(localKey)) return mods.get(localKey);
    return getGeneratedBlock(this.seed, x, y, z);
  }

  isSolid(x, y, z) { return SOLID_BLOCKS.has(this.getBlock(x, y, z)); }

  applyChunkMods(cx, cz, blocksObject, { invalidate = true } = {}) {
    const key = chunkKey(cx, cz);
    const map = new Map(Object.entries(blocksObject ?? {}).map(([k, v]) => [k, Number(v)]));
    this.chunkMods.set(key, map);
    this.requestedChunks.add(key);
    if (this.chunks.has(key) || this.neededNearChunks.has(key) || this.queuedChunkKeys.has(key) || this.pendingChunkKeys.has(key)) this.rebuildChunk(cx, cz);
    if (invalidate) this.invalidateLodAt(cx * CHUNK_SIZE + CHUNK_SIZE / 2, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
  }

  applyBlockUpdate(x, y, z, block) {
    const cx = floorDiv(x, CHUNK_SIZE);
    const cz = floorDiv(z, CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    const localKey = `${mod(x, CHUNK_SIZE)},${y},${mod(z, CHUNK_SIZE)}`;
    let map = this.chunkMods.get(key);
    if (!map) {
      map = new Map();
      this.chunkMods.set(key, map);
    }
    const generated = getGeneratedBlock(this.seed, x, y, z);
    if (block === generated) map.delete(localKey); else map.set(localKey, block);
    this.rebuildChunk(cx, cz);
    if (mod(x, CHUNK_SIZE) === 0) this.rebuildChunk(cx - 1, cz);
    if (mod(x, CHUNK_SIZE) === CHUNK_SIZE - 1) this.rebuildChunk(cx + 1, cz);
    if (mod(z, CHUNK_SIZE) === 0) this.rebuildChunk(cx, cz - 1);
    if (mod(z, CHUNK_SIZE) === CHUNK_SIZE - 1) this.rebuildChunk(cx, cz + 1);
    this.invalidateLodAt(x, z);
  }

  invalidateLodAt(x, z) {
    const affected = [];
    for (const spec of this.lodSpecs.values()) {
      const x0 = spec.tx * spec.tileSize;
      const z0 = spec.tz * spec.tileSize;
      if (x >= x0 && x < x0 + spec.tileSize && z >= z0 && z < z0 + spec.tileSize) affected.push(spec);
    }
    for (const spec of affected) {
      this.bumpLodRevision(spec.key);
      // Do not jump ahead of the progressive refinement frontier. Existing
      // visible tiles are rebuilt atomically; finer unopened levels only keep
      // the new revision and will use it when their stage is reached.
      if (this.lodTiles.has(spec.key) || spec.level >= (this.lodRefineLevel ?? this.lodRootLevel)) {
        this.queueLodBuild(spec, { front: false });
      }
    }
    // The previous LOD mesh remains installed until the revised mesh is ready.
    // Loaded near chunks mask LOD fragments, so edits cannot reveal a collisionless
    // coarse copy while the background rebuild is running.
  }

  setLocalBlock(x, y, z, block) {
    this.applyBlockUpdate(x, y, z, block);
    this.localDirty.add(`${x},${y},${z}`);
  }

  update(playerPosition) {
    this.lastPlayerPosition = { x: playerPosition.x, z: playerPosition.z };
    this.updateWaterSurface(playerPosition.x, playerPosition.z);
    const cx = floorDiv(playerPosition.x, CHUNK_SIZE);
    const cz = floorDiv(playerPosition.z, CHUNK_SIZE);
    if (cx !== this.lastCenter.cx || cz !== this.lastCenter.cz) {
      this.lastCenter = { cx, cz };
      this.refreshNearChunks(cx, cz);
    }
    // The quadtree is rebuilt every two chunks. Whole-tile parent/child swaps
    // replace the former per-frame radial shader clipping.
    const lodCx = floorDiv(playerPosition.x, CHUNK_SIZE * 2);
    const lodCz = floorDiv(playerPosition.z, CHUNK_SIZE * 2);
    if (lodCx !== this.lastLodCenter.cx || lodCz !== this.lastLodCenter.cz) {
      this.lastLodCenter = { cx: lodCx, cz: lodCz };
      this.refreshLod(playerPosition.x, playerPosition.z);
    }
    const now = performance.now();
    this.processReadyMeshResults();
    this.advanceLodRefinement(now);
    this.processQueues(this.queueBudgetMs);
    this.cleanupRetiredLod(now);
  }

  setViewDistances(nearDistance, farDistance, playerPosition = this.lastPlayerPosition) {
    const nextNear = Math.max(MIN_NEAR_DISTANCE, Math.min(MAX_NEAR_DISTANCE, Number(nearDistance) || this.nearDistance));
    const nextFar = Math.max(nextNear + 8, Math.min(MAX_FAR_DISTANCE, Number(farDistance) || this.farDistance));
    if (nextNear === this.nearDistance && nextFar === this.farDistance) return false;
    this.nearDistance = nextNear;
    this.farDistance = nextFar;
    // Reuse any compatible existing tiles. The new tree is streamed in from its
    // coarse roots instead of destroying every GPU buffer in one frame.
    this.neededLodKeys.clear();
    this.lodTreeRoots.length = 0;
    this.lodChildren.clear();
    this.lodSpecs.clear();
    this.lodRefineLevel = null;
    this.lodStageReadyAt = 0;
    this.streamStartedAt = performance.now();
    this.rebuildWaterSurface();
    this.lastCenter = { cx: Infinity, cz: Infinity };
    this.lastLodCenter = { cx: Infinity, cz: Infinity };
    this.chunkQueue.length = 0;
    this.queuedChunkKeys.clear();
    this.lodQueue.length = 0;
    this.queuedLodKeys.clear();
    if (Number.isFinite(playerPosition?.x) && Number.isFinite(playerPosition?.z)) this.update(playerPosition);
    return true;
  }

  refreshNearChunks(centerX, centerZ) {
    const radius = fullDetailChunkRadius(this.nearDistance);
    const needed = new Set();
    const request = [];
    const coords = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dz * dz > (radius + 0.55) ** 2) continue;
        coords.push([centerX + dx, centerZ + dz, dx * dx + dz * dz]);
      }
    }
    coords.sort((a, b) => a[2] - b[2]);
    if (coords.length > this.maxChunkMeshes) coords.length = this.maxChunkMeshes;
    for (const [cx, cz] of coords) {
      const key = chunkKey(cx, cz);
      needed.add(key);
      if (!this.chunks.has(key) && !this.queuedChunkKeys.has(key) && !this.pendingChunkKeys.has(key)) {
        this.chunkQueue.push({ key, cx, cz, rebuild: false, revision: this.getChunkRevision(key), session: this.sessionId });
        this.queuedChunkKeys.add(key);
      }
      if (!this.singleplayer && !this.requestedChunks.has(key)) {
        this.requestedChunks.add(key);
        request.push([cx, cz]);
      }
      const entry = this.chunks.get(key);
      if (entry) this.updateChunkShadows(entry, centerX, centerZ);
    }
    this.neededNearChunks = needed;
    this.chunkQueue = this.chunkQueue.filter((item) => {
      const keep = item.session === this.sessionId && needed.has(item.key);
      if (!keep) this.queuedChunkKeys.delete(item.key);
      return keep;
    });
    for (const [key, entry] of this.chunks) {
      if (!needed.has(key)) {
        this.disposeChunk(entry);
        this.chunks.delete(key);
      }
    }
    this.updateLodNearMask();
    if (request.length) for (let i = 0; i < request.length; i += 24) this.network?.requestChunks(request.slice(i, i + 24));
  }

  processQueues(budgetMs) {
    if (this.workerPool.enabled) {
      const readyCount = this.readyChunkResults.length + this.readyLodResults.length;
      if (readyCount >= this.maxReadyMeshResults) return;
      let slots = Math.min(this.workerPool.available, this.maxWorkerDispatchPerFrame, this.maxReadyMeshResults - readyCount);
      while (slots > 0 && (this.chunkQueue.length || this.lodQueue.length)) {
        const needSpawnCore = this.chunks.size + this.pendingChunkKeys.size < 12;
        const chooseChunk = this.chunkQueue.length && (needSpawnCore || !this.lodQueue.length || this.dispatchFlip);
        this.dispatchFlip = !this.dispatchFlip;
        if (chooseChunk) {
          const item = this.chunkQueue.shift();
          this.queuedChunkKeys.delete(item.key);
          if (item.session === this.sessionId && this.neededNearChunks.has(item.key)) {
            this.dispatchChunkBuild(item);
            slots -= 1;
          }
        } else if (this.lodQueue.length) {
          const item = this.lodQueue.shift();
          this.queuedLodKeys.delete(item.key);
          if (item.session === this.sessionId && this.neededLodKeys.has(item.key)) {
            this.dispatchLodBuild(item);
            slots -= 1;
          }
        }
      }
      return;
    }

    const start = performance.now();
    let built = 0;
    while ((this.chunkQueue.length || this.lodQueue.length)
      && built < this.maxMeshInstallsPerFrame
      && performance.now() - start < budgetMs) {
      const chooseChunk = this.chunkQueue.length && (!this.lodQueue.length || this.dispatchFlip);
      this.dispatchFlip = !this.dispatchFlip;
      if (chooseChunk) {
        const item = this.chunkQueue.shift();
        this.queuedChunkKeys.delete(item.key);
        if (item.session === this.sessionId && this.neededNearChunks.has(item.key)) {
          this.buildChunk(item.cx, item.cz, item.rebuild);
          built += 1;
        }
      } else if (this.lodQueue.length) {
        const item = this.lodQueue.shift();
        this.queuedLodKeys.delete(item.key);
        if (item.session === this.sessionId && this.neededLodKeys.has(item.key)) {
          this.buildLodTile(item);
          built += 1;
        }
      }
    }
  }

  collectModLookup(cx, cz) {
    const result = {};
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const key = chunkKey(cx + dx, cz + dz);
        const map = this.chunkMods.get(key);
        if (map?.size) result[key] = mapToObject(map);
      }
    }
    return result;
  }

  collectLodMods(spec) {
    const mods = [];
    const ox = spec.tx * spec.tileSize;
    const oz = spec.tz * spec.tileSize;
    const x1 = ox + spec.tileSize;
    const z1 = oz + spec.tileSize;
    // Sparse iteration is essential for 2048-chunk views: an outer tile can
    // cover hundreds of thousands of base chunks, while only modified chunks
    // actually exist in memory or on disk.
    for (const [key, map] of this.chunkMods) {
      if (!map?.size) continue;
      const [cx, cz] = key.split(',').map(Number);
      const chunkX0 = cx * CHUNK_SIZE;
      const chunkZ0 = cz * CHUNK_SIZE;
      if (chunkX0 >= x1 || chunkZ0 >= z1 || chunkX0 + CHUNK_SIZE <= ox || chunkZ0 + CHUNK_SIZE <= oz) continue;
      for (const [localKey, block] of map) {
        const [lx, y, lz] = localKey.split(',').map(Number);
        mods.push({ x: chunkX0 + lx, y, z: chunkZ0 + lz, block });
      }
    }
    return mods;
  }

  dispatchChunkBuild(item) {
    this.pendingChunkKeys.add(item.key);
    const payload = { seed: this.seed, cx: item.cx, cz: item.cz, modLookup: this.collectModLookup(item.cx, item.cz) };
    this.workerPool.submit('chunk', payload).then((result) => {
      // An old session must never delete a pending marker belonging to a new
      // world that happens to use the same chunk coordinate.
      if (item.session !== this.sessionId) return;
      if (!this.neededNearChunks.has(item.key)) {
        this.pendingChunkKeys.delete(item.key);
        return;
      }
      this.readyChunkResults.push({ item, result, bytes: meshResultByteLength(result) });
    }).catch((error) => {
      if (item.session !== this.sessionId) return;
      this.pendingChunkKeys.delete(item.key);
      console.warn('Chunk worker failed; retrying on main thread.', error);
      if (this.neededNearChunks.has(item.key)) {
        this.buildChunk(item.cx, item.cz, this.chunks.has(item.key), this.getChunkRevision(item.key));
      }
    });
  }

  dispatchLodBuild(item) {
    this.pendingLodKeys.add(item.key);
    const payload = { seed: this.seed, spec: item, mods: this.collectLodMods(item) };
    this.workerPool.submit('lod', payload).then((result) => {
      if (item.session !== this.sessionId) return;
      if (!this.neededLodKeys.has(item.key)) {
        this.pendingLodKeys.delete(item.key);
        return;
      }
      this.readyLodResults.push({ item, result, bytes: meshResultByteLength(result) });
    }).catch((error) => {
      if (item.session !== this.sessionId) return;
      this.pendingLodKeys.delete(item.key);
      console.warn('LOD worker failed; retrying on main thread.', error);
      if (this.neededLodKeys.has(item.key)) {
        const current = this.lodSpecs.get(item.key);
        if (current) this.buildLodTile({ ...current, revision: this.getLodRevision(item.key), session: this.sessionId });
      }
    });
  }

  processReadyMeshResults() {
    let installed = 0;
    let bytes = 0;
    while (installed < this.maxMeshInstallsPerFrame) {
      const needSpawnCore = this.chunks.size < 12;
      const chooseChunk = this.readyChunkResults.length
        && (needSpawnCore || !this.readyLodResults.length || this.installFlip);
      this.installFlip = !this.installFlip;
      const source = chooseChunk ? this.readyChunkResults : this.readyLodResults;
      if (!source.length) break;
      const ready = source[0];
      if (installed > 0 && bytes + ready.bytes > this.maxMeshInstallBytesPerFrame) break;
      source.shift();
      bytes += ready.bytes;
      installed += 1;
      if (source === this.readyChunkResults) this.finishReadyChunk(ready);
      else this.finishReadyLod(ready);
    }
  }

  finishReadyChunk({ item, result }) {
    this.pendingChunkKeys.delete(item.key);
    const stale = item.revision !== this.getChunkRevision(item.key);
    const dirty = this.chunkDirtyAfterBuild.delete(item.key);
    if (item.session !== this.sessionId || !this.neededNearChunks.has(item.key)) return;
    if (stale || dirty) {
      this.queueChunkBuild(item.cx, item.cz, { rebuild: true, front: true });
      return;
    }
    this.installChunkMesh(item.cx, item.cz, result, item.rebuild, item.revision);
  }

  finishReadyLod({ item, result }) {
    this.pendingLodKeys.delete(item.key);
    const stale = item.revision !== this.getLodRevision(item.key);
    const dirty = this.lodDirtyAfterBuild.delete(item.key);
    if (item.session !== this.sessionId || !this.neededLodKeys.has(item.key)) return;
    if (stale || dirty) {
      this.queueLodBuild(this.lodSpecs.get(item.key), { front: false });
      return;
    }
    this.installLodMesh(item, result, item.revision);
  }

  buildChunk(cx, cz, replacing = false, revision = this.getChunkRevision(chunkKey(cx, cz))) {
    const result = buildChunkMeshData({ seed: this.seed, cx, cz, modLookup: this.collectModLookup(cx, cz) });
    this.installChunkMesh(cx, cz, result, replacing, revision);
  }

  installChunkMesh(cx, cz, result, replacing = false, revision = this.getChunkRevision(chunkKey(cx, cz))) {
    const key = chunkKey(cx, cz);
    if (revision !== this.getChunkRevision(key)) return false;
    const old = this.chunks.get(key) ?? null;
    const group = new THREE.Group();
    group.name = `chunk:${cx},${cz}`;
    const opaqueGeometry = geometryFromBuffers(result.opaque);
    if (opaqueGeometry) group.add(new THREE.Mesh(opaqueGeometry, this.materials.opaque));
    const glassGeometry = geometryFromBuffers(result.glass);
    if (glassGeometry) {
      const mesh = new THREE.Mesh(glassGeometry, this.materials.glass);
      mesh.renderOrder = 2;
      group.add(mesh);
    }
    // Water is rendered once by the continuous world-space surface.
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    const entry = { cx, cz, group, revision };
    // Atomic replacement: old detail remains visible until all new buffers are ready.
    this.group.add(entry.group);
    this.chunks.set(key, entry);
    this.updateChunkShadows(entry, this.lastCenter.cx, this.lastCenter.cz);
    if (old) this.disposeChunk(old);
    this.updateLodNearMask();
    this.dispatchEvent(new CustomEvent('chunkbuilt', { detail: { cx, cz, replacing } }));
    return true;
  }

  rebuildChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    this.bumpChunkRevision(key);
    this.queueChunkBuild(cx, cz, { rebuild: true, front: true });
  }

  updateChunkShadows(entry, centerX, centerZ) {
    const closeEnough = Number.isFinite(centerX)
      && Math.max(Math.abs(entry.cx - centerX), Math.abs(entry.cz - centerZ)) <= this.shadowDistance;
    entry.group?.traverse((object) => {
      if (!object.isMesh) return;
      object.receiveShadow = this.shadowsEnabled;
      object.castShadow = this.shadowsEnabled && closeEnough && object.material === this.materials.opaque;
    });
  }

  refreshLod(playerX, playerZ) {
    const now = performance.now();
    const tree = makeLodTree(this.nearDistance, this.farDistance, playerX, playerZ);
    const needed = new Set(tree.nodes.keys());
    this.lodTreeRoots = tree.roots;
    this.lodChildren = tree.children;
    this.lodSpecs = tree.nodes;
    this.neededLodKeys = needed;
    this.lodRootLevel = tree.levels.length ? tree.levels.length - 1 : 0;
    if (this.lodRefineLevel === null) this.lodRefineLevel = this.lodRootLevel;
    this.lodRefineLevel = Math.max(0, Math.min(this.lodRootLevel, this.lodRefineLevel));

    for (const [key, rawSpec] of tree.nodes) {
      const spec = { ...rawSpec, revision: this.getLodRevision(key), session: this.sessionId };
      this.lodSpecs.set(key, spec);
      const existing = this.lodTiles.get(key);
      if (existing) existing.userData.retireAt = 0;
    }

    this.lodQueue = this.lodQueue.filter((item) => {
      const keep = item.session === this.sessionId && needed.has(item.key);
      if (!keep) this.queuedLodKeys.delete(item.key);
      return keep;
    });
    for (const [key, mesh] of this.lodTiles) {
      if (!needed.has(key) && !mesh.userData.retireAt) mesh.userData.retireAt = now + this.retireDelayMs;
    }
    this.queueEligibleLodNodes();
    this.updateLodVisibility();
  }

  lodResultWaiting(key) {
    return this.readyLodResults.some((ready) => ready.item.key === key);
  }

  lodSpecNeedsBuild(spec) {
    const existing = this.lodTiles.get(spec.key);
    if (existing) return existing.userData.revision !== this.getLodRevision(spec.key);
    return !this.lodNodeHasCoverage(spec.key);
  }

  queueEligibleLodNodes() {
    if (!this.lodSpecs.size || this.lodRefineLevel === null) return;
    const byLevel = new Map();
    for (const spec of this.lodSpecs.values()) {
      if (spec.level < this.lodRefineLevel) continue;
      let list = byLevel.get(spec.level);
      if (!list) { list = []; byLevel.set(spec.level, list); }
      list.push(spec);
    }
    for (let level = this.lodRootLevel; level >= this.lodRefineLevel; level -= 1) {
      const specs = byLevel.get(level) ?? [];
      specs.sort((a, b) => a.distance - b.distance);
      for (const spec of specs) {
        if (!this.lodSpecNeedsBuild(spec)) continue;
        if (this.queuedLodKeys.has(spec.key) || this.pendingLodKeys.has(spec.key) || this.lodResultWaiting(spec.key)) continue;
        if (spec.parentKey && !this.lodNodeHasCoverage(spec.parentKey)) continue;
        this.queueLodBuild(spec, { front: false });
      }
    }
    // Within the currently unlocked frontier, coarse tasks always go first.
    this.lodQueue.sort((a, b) => b.level - a.level || a.distance - b.distance);
  }

  advanceLodRefinement(now) {
    this.queueEligibleLodNodes();
    if (this.lodRefineLevel === null || this.lodRefineLevel <= this.minLodRefineLevel) return;
    const stageSpecs = [...this.lodSpecs.values()].filter((spec) => spec.level === this.lodRefineLevel);
    if (!stageSpecs.length) {
      this.lodRefineLevel -= 1;
      this.lodStageReadyAt = 0;
      this.queueEligibleLodNodes();
      return;
    }
    const complete = stageSpecs.every((spec) => this.lodNodeHasCoverage(spec.key));
    const busy = this.lodQueue.some((item) => item.level === this.lodRefineLevel)
      || [...this.pendingLodKeys].some((key) => this.lodSpecs.get(key)?.level === this.lodRefineLevel)
      || this.readyLodResults.some((ready) => ready.item.level === this.lodRefineLevel);
    if (!complete || busy) {
      this.lodStageReadyAt = 0;
      return;
    }
    if (!this.lodStageReadyAt) {
      this.lodStageReadyAt = now;
      return;
    }
    if (now - this.lodStageReadyAt < this.lodStageDelayMs) return;
    this.lodRefineLevel -= 1;
    this.lodStageReadyAt = 0;
    this.queueEligibleLodNodes();
  }

  hideLodSubtree(key) {
    const mesh = this.lodTiles.get(key);
    if (mesh) mesh.visible = false;
    for (const childKey of this.lodChildren.get(key) ?? []) this.hideLodSubtree(childKey);
  }

  lodNodeHasCoverage(key) {
    if (this.lodTiles.has(key)) return true;
    const childKeys = this.lodChildren.get(key);
    return Boolean(childKeys?.length) && childKeys.every((childKey) => this.lodNodeHasCoverage(childKey));
  }

  showLodCoverage(key) {
    const mesh = this.lodTiles.get(key);
    const childKeys = this.lodChildren.get(key) ?? [];
    const childrenReady = childKeys.length === 4 && childKeys.every((childKey) => this.lodNodeHasCoverage(childKey));
    if (childrenReady) {
      if (mesh) {
        mesh.visible = false;
        if (!mesh.userData.coveredAt) mesh.userData.coveredAt = performance.now();
      }
      for (const childKey of childKeys) this.showLodCoverage(childKey);
      return true;
    }
    if (mesh) {
      mesh.visible = true;
      mesh.userData.coveredAt = 0;
      for (const childKey of childKeys) this.hideLodSubtree(childKey);
      return true;
    }
    let complete = childKeys.length > 0;
    for (const childKey of childKeys) complete = this.showLodCoverage(childKey) && complete;
    return complete;
  }

  updateLodVisibility() {
    for (const mesh of this.lodTiles.values()) mesh.visible = false;
    for (const rootKey of this.lodTreeRoots) this.showLodCoverage(rootKey);
    // Tiles from the previous tree remain a short-lived fallback only when no
    // current node covers their area; they are never alpha blended.
    for (const [key, mesh] of this.lodTiles) {
      if (!this.neededLodKeys.has(key) && mesh.userData.retireAt) mesh.visible = false;
    }
  }

  cleanupRetiredLod(now) {
    const overLimit = Math.max(0, this.lodTiles.size - this.maxLodMeshes);
    let removed = 0;
    const retired = [...this.lodTiles.entries()]
      .filter(([, mesh]) => mesh.userData.retireAt)
      .sort((a, b) => a[1].userData.retireAt - b[1].userData.retireAt);
    for (const [key, mesh] of retired) {
      if (removed < overLimit || mesh.userData.retireAt <= now) {
        this.disposeLodMesh(mesh);
        this.lodTiles.delete(key);
        removed += 1;
      }
    }
    if (removed) this.updateLodVisibility();
  }

  buildLodTile(spec) {
    if (spec.session !== this.sessionId) return;
    const revision = spec.revision ?? this.getLodRevision(spec.key);
    const result = buildLodMeshData({ seed: this.seed, spec, mods: this.collectLodMods(spec) });
    this.installLodMesh(spec, result, revision);
  }

  installLodMesh(spec, result, revision = this.getLodRevision(spec.key)) {
    const { key, level } = spec;
    const geometry = geometryFromBuffers(result);
    if (!geometry || spec.session !== this.sessionId || !this.neededLodKeys.has(key) || revision !== this.getLodRevision(key)) {
      geometry?.dispose?.();
      return;
    }
    const material = this.materials.lod;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.renderOrder = -20;
    mesh.matrixAutoUpdate = false;
    mesh.userData.lodNode = {
      level,
      parentKey: spec.parentKey,
      tx: spec.tx,
      tz: spec.tz,
      tileSize: spec.tileSize,
      step: spec.step,
    };
    mesh.userData.retireAt = 0;
    mesh.userData.coveredAt = 0;
    mesh.userData.revision = revision;
    mesh.updateMatrix();
    const old = this.lodTiles.get(key);
    this.lodTiles.set(key, mesh);
    this.lodGroup.add(mesh);
    if (old) this.disposeLodMesh(old);
    this.updateLodVisibility();
  }

  raycast(origin, direction, maxDistance = 6) {
    const step = 0.04;
    let previous = null;
    for (let t = 0; t <= maxDistance; t += step) {
      const x = Math.floor(origin.x + direction.x * t);
      const y = Math.floor(origin.y + direction.y * t);
      const z = Math.floor(origin.z + direction.z * t);
      if (!previous || previous.x !== x || previous.y !== y || previous.z !== z) {
        const block = this.getBlock(x, y, z);
        if (block !== BLOCK.AIR && block !== BLOCK.WATER) return { hit: { x, y, z }, adjacent: previous, block, distance: t };
        previous = { x, y, z };
      }
    }
    return null;
  }
}
