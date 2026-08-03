import THREE from './three-loader.js';
import { BLOCK } from '../shared/constants.js';

const TILE = 16;
const GRID = 4;

function random(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0xffffffff;
  };
}

function fillNoise(ctx, tx, ty, base, fleck, density, seed) {
  ctx.fillStyle = base;
  ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
  const rnd = random(seed);
  ctx.fillStyle = fleck;
  for (let i = 0; i < density; i += 1) {
    const x = tx * TILE + Math.floor(rnd() * TILE);
    const y = ty * TILE + Math.floor(rnd() * TILE);
    const size = rnd() > 0.8 ? 2 : 1;
    ctx.fillRect(x, y, size, size);
  }
}

export function createMaterials(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * GRID;
  canvas.height = TILE * GRID;
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = false;

  fillNoise(ctx, 0, 0, '#5ea342', '#79bd55', 50, 1);
  fillNoise(ctx, 1, 0, '#7a5838', '#9b734d', 40, 2);
  ctx.fillStyle = '#589c3d'; ctx.fillRect(TILE, 0, TILE, 5);
  fillNoise(ctx, 2, 0, '#79573a', '#9a714d', 45, 3);
  fillNoise(ctx, 3, 0, '#777b7e', '#989c9f', 48, 4);
  fillNoise(ctx, 0, 1, '#d8c27a', '#ecdb9a', 38, 5);
  fillNoise(ctx, 1, 1, '#76502c', '#986d3b', 32, 6);
  fillNoise(ctx, 2, 1, '#a97b43', '#6f4926', 28, 7);
  fillNoise(ctx, 3, 1, '#3e8c3e', '#62aa4e', 50, 8);
  ctx.clearRect(3 * TILE + 2, TILE + 2, 3, 3);
  ctx.clearRect(3 * TILE + 11, TILE + 7, 3, 3);
  fillNoise(ctx, 0, 2, '#aa7947', '#d09a5c', 34, 9);
  ctx.fillStyle = '#6f4c2f'; for (let y = 2 * TILE; y < 3 * TILE; y += 5) ctx.fillRect(0, y, TILE, 1);
  ctx.clearRect(TILE, 2 * TILE, TILE, TILE);
  ctx.fillStyle = 'rgba(185,225,235,.33)'; ctx.fillRect(TILE, 2 * TILE, TILE, TILE);
  ctx.strokeStyle = 'rgba(220,250,255,.8)'; ctx.strokeRect(TILE + .5, 2 * TILE + .5, TILE - 1, TILE - 1);
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(TILE + 3, 2 * TILE + 3, 5, 1);
  fillNoise(ctx, 2, 2, '#347db2', '#65a8ce', 32, 10);
  ctx.fillStyle = 'rgba(210,245,255,.34)'; for (let y = 2 * TILE + 2; y < 3 * TILE; y += 5) ctx.fillRect(2 * TILE, y, TILE, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const opaque = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.45, dithering: true });
  const glass = new THREE.MeshPhongMaterial({
    map: texture,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    shininess: 80,
    dithering: true,
  });
  const water = new THREE.MeshPhongMaterial({
    color: 0x3f82b8,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    depthTest: true,
    shininess: 92,
    side: THREE.DoubleSide,
    dithering: true,
  });
  // One material and one continuous plane are used at every distance. The
  // world-space modulation is deliberately subtle and cannot reveal LOD rings.
  water.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWaterWorldPosition;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWaterWorldPosition;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float waterRipple = sin(vWaterWorldPosition.x * 0.035 + vWaterWorldPosition.z * 0.021)
          * sin(vWaterWorldPosition.z * 0.041 - vWaterWorldPosition.x * 0.017);
        diffuseColor.rgb *= 0.975 + waterRipple * 0.025;`,
      );
  };
  water.customProgramCacheKey = () => 'voxel-link-continuous-water-v1';

  const lodNearMaskSize = 64;
  const lodNearMaskData = new Uint8Array(lodNearMaskSize * lodNearMaskSize * 4);
  const lodNearMaskTexture = new THREE.DataTexture(
    lodNearMaskData,
    lodNearMaskSize,
    lodNearMaskSize,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  lodNearMaskTexture.magFilter = THREE.NearestFilter;
  lodNearMaskTexture.minFilter = THREE.NearestFilter;
  lodNearMaskTexture.generateMipmaps = false;
  lodNearMaskTexture.needsUpdate = true;
  const lodMaskOrigin = new THREE.Vector2(0, 0);
  const lodMaskUniforms = {
    uNearChunkMask: { value: lodNearMaskTexture },
    uNearMaskOrigin: { value: lodMaskOrigin },
    uNearMaskSize: { value: lodNearMaskSize },
  };

  const lod = new THREE.MeshLambertMaterial({
    map: texture,
    vertexColors: true,
    flatShading: true,
    dithering: true,
    depthWrite: true,
    polygonOffset: false,
  });
  // All quadtree levels share this exact shader. Resolution changes geometry,
  // not colour, fog, clipping, transparency or light response.
  lod.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lodMaskUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLodWorldPosition;\nvarying vec3 vLodWorldNormal;\nuniform sampler2D uNearChunkMask;\nuniform vec2 uNearMaskOrigin;\nuniform float uNearMaskSize;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLodWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLodWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vLodWorldPosition;\nvarying vec3 vLodWorldNormal;\nuniform sampler2D uNearChunkMask;\nuniform vec2 uNearMaskOrigin;\nuniform float uNearMaskSize;',
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec2 nearChunkCoord = floor(vLodWorldPosition.xz / 16.0);
        vec2 nearMaskCell = nearChunkCoord - uNearMaskOrigin;
        if (all(greaterThanEqual(nearMaskCell, vec2(0.0)))
          && all(lessThan(nearMaskCell, vec2(uNearMaskSize)))) {
          vec2 nearMaskUv = (nearMaskCell + 0.5) / uNearMaskSize;
          if (texture2D(uNearChunkMask, nearMaskUv).r > 0.5) discard;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 lodAbsNormal = abs(normalize(vLodWorldNormal));
        vec2 lodPlane = lodAbsNormal.y > max(lodAbsNormal.x, lodAbsNormal.z)
          ? vLodWorldPosition.xz
          : (lodAbsNormal.x > lodAbsNormal.z ? vLodWorldPosition.zy : vLodWorldPosition.xy);
        #ifdef USE_MAP
          vec2 lodAtlasCell = floor(vMapUv * 4.0);
          vec2 lodLocalUv = fract(lodPlane);
          vec2 lodAtlasUv = (lodAtlasCell + mix(vec2(0.006), vec2(0.994), lodLocalUv)) / 4.0;
          vec4 sampledDiffuseColor = texture2D(map, lodAtlasUv);
          #ifdef DECODE_VIDEO_TEXTURE
            sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
          #endif
          diffuseColor *= sampledDiffuseColor;
        #endif
`,
      );
  };
  lod.customProgramCacheKey = () => 'voxel-link-quadtree-terrain-v2-near-mask';

  function getLodMaterial() { return lod; }

  function updateLodNearMask(originCx, originCz, loadedChunks = []) {
    lodNearMaskData.fill(0);
    lodMaskOrigin.set(Number(originCx) || 0, Number(originCz) || 0);
    for (const item of loadedChunks) {
      const cx = Number(item?.[0]);
      const cz = Number(item?.[1]);
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
      const mx = cx - lodMaskOrigin.x;
      const mz = cz - lodMaskOrigin.y;
      if (mx < 0 || mz < 0 || mx >= lodNearMaskSize || mz >= lodNearMaskSize) continue;
      const offset = (mz * lodNearMaskSize + mx) * 4;
      lodNearMaskData[offset] = 255;
      lodNearMaskData[offset + 1] = 255;
      lodNearMaskData[offset + 2] = 255;
      lodNearMaskData[offset + 3] = 255;
    }
    lodNearMaskTexture.needsUpdate = true;
  }

  function updateLodClip() {}
  function disposeLodMaterials() { lodNearMaskTexture.dispose?.(); }

  function applyVisualPreset(preset) {
    opaque.color.set(preset.blockTint ?? 0xffffff);
    glass.color.set(preset.glassTint ?? 0xffffff);
    glass.opacity = preset.glassOpacity ?? 0.58;
    glass.shininess = preset.glassShininess ?? 80;
    water.color.set(preset.waterColor ?? 0x3f82b8);
    water.opacity = preset.waterOpacity ?? 0.58;
    water.shininess = preset.waterShininess ?? 100;
    lod.color.set(preset.lodTint ?? 0xffffff);
    for (const material of [opaque, glass, water, lod]) material.needsUpdate = true;
  }

  return {
    texture,
    opaque,
    glass,
    water,
    lod,
    getLodMaterial,
    updateLodClip,
    updateLodNearMask,
    lodNearMaskSize,
    lodNearMaskTexture,
    disposeLodMaterials,
    tileSize: TILE,
    grid: GRID,
    applyVisualPreset,
  };
}

export function tileForFace(block, faceName) {
  switch (block) {
    case BLOCK.GRASS: return faceName === 'top' ? 0 : faceName === 'bottom' ? 2 : 1;
    case BLOCK.DIRT: return 2;
    case BLOCK.STONE: return 3;
    case BLOCK.SAND: return 4;
    case BLOCK.WOOD: return faceName === 'top' || faceName === 'bottom' ? 6 : 5;
    case BLOCK.LEAVES: return 7;
    case BLOCK.PLANKS: return 8;
    case BLOCK.GLASS: return 9;
    default: return 3;
  }
}

export function tileUV(tile, grid = GRID) {
  const x = tile % grid;
  const y = Math.floor(tile / grid);
  const e = 0.0015;
  const u0 = x / grid + e;
  const u1 = (x + 1) / grid - e;
  const v1 = 1 - y / grid - e;
  const v0 = 1 - (y + 1) / grid + e;
  return { u0, u1, v0, v1 };
}
