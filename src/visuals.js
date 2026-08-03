import THREE from './three-loader.js';

export const VISUAL_PRESETS = Object.freeze({
  classic: {
    id: 'classic', name: '原版像素', shadows: false, shadowMapSize: 512,
    toneMapping: THREE.NoToneMapping, exposure: 1,
    pixelRatioMax: 1.25, sunColor: 0xfff1c8, sunStrength: 2.1, moonColor: 0xbfd7ff, moonStrength: 0.31,
    hemiSky: 0xaed8ff, hemiGround: 0x514735, hemiStrength: 1.05,
    horizon: 0x9bcbe9, zenith: 0x5b98c6, night: 0x06101f,
    dusk: 0xc77a58, sunDisk: 0xfff0b8, fogFactor: 1.02,
    blockTint: 0xffffff, waterColor: 0x3f82b8, waterOpacity: 0.56,
  },
  soft: {
    id: 'soft', name: '柔和光影', shadows: true, shadowMapSize: 1536,
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.08,
    pixelRatioMax: 1.45, sunColor: 0xffe7b0, sunStrength: 3.1, moonColor: 0xc9ddff, moonStrength: 0.39,
    hemiSky: 0xbfe5ff, hemiGround: 0x5a4938, hemiStrength: 1.0,
    horizon: 0xb9ddf0, zenith: 0x5f9fd1, night: 0x07152b,
    dusk: 0xd78662, sunDisk: 0xfff4cb, fogFactor: 0.98,
    blockTint: 0xfffdf8, waterColor: 0x3b8bc5, waterOpacity: 0.52,
  },
  cinematic: {
    id: 'cinematic', name: '电影高对比', shadows: true, shadowMapSize: 2048,
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.94,
    pixelRatioMax: 1.4, sunColor: 0xffd191, sunStrength: 4.0, moonColor: 0xaec8ff, moonStrength: 0.26,
    hemiSky: 0x86bde3, hemiGround: 0x251f1b, hemiStrength: 0.58,
    horizon: 0xe2a070, zenith: 0x356f9e, night: 0x020610,
    dusk: 0xe25f3c, sunDisk: 0xffd486, fogFactor: 0.92,
    blockTint: 0xfff6e8, waterColor: 0x205f93, waterOpacity: 0.6,
  },
  dream: {
    id: 'dream', name: '极光梦境', shadows: true, shadowMapSize: 1024,
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.18,
    pixelRatioMax: 1.35, sunColor: 0xffd8ee, sunStrength: 2.8, moonColor: 0xb8e8ff, moonStrength: 0.46,
    hemiSky: 0x88e8dc, hemiGround: 0x34264b, hemiStrength: 1.1,
    horizon: 0x72d8d0, zenith: 0x6b65c7, night: 0x09051c,
    dusk: 0xec75a8, sunDisk: 0xffdcf2, fogFactor: 0.88,
    blockTint: 0xf8f4ff, waterColor: 0x5c6fd0, waterOpacity: 0.55,
  },
  sunset: {
    id: 'sunset', name: '落日暖辉', shadows: true, shadowMapSize: 1536,
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.02,
    pixelRatioMax: 1.4, sunColor: 0xffc27d, sunStrength: 3.5, moonColor: 0x9fc4ff, moonStrength: 0.24,
    hemiSky: 0xf2c7a0, hemiGround: 0x4a3426, hemiStrength: 0.82,
    horizon: 0xf0a36d, zenith: 0x5e79b8, night: 0x06101c,
    dusk: 0xff7a4f, sunDisk: 0xffddaa, fogFactor: 0.9,
    blockTint: 0xfff6ea, waterColor: 0x2f78ad, waterOpacity: 0.58,
  },
  crisp: {
    id: 'crisp', name: '清晨通透', shadows: true, shadowMapSize: 2048,
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.1,
    pixelRatioMax: 1.5, sunColor: 0xfff2cf, sunStrength: 3.35, moonColor: 0xb9d8ff, moonStrength: 0.32,
    hemiSky: 0xd0ecff, hemiGround: 0x4f473c, hemiStrength: 1.08,
    horizon: 0xcde7fb, zenith: 0x6ca8da, night: 0x071424,
    dusk: 0xe39b6a, sunDisk: 0xfff1c4, fogFactor: 1.06,
    blockTint: 0xffffff, waterColor: 0x4a97cb, waterOpacity: 0.5,
  },
});

const PRESET_ORDER = Object.keys(VISUAL_PRESETS);

export class VisualSystem {
  constructor({ renderer, scene, camera, sun, moon, hemi, materials, world }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this.moon = moon;
    this.hemi = hemi;
    this.materials = materials;
    this.world = world;
    this.basePixelRatio = Math.min(devicePixelRatio || 1, 1.6);
    this.dynamicPixelRatio = this.basePixelRatio;
    this.preset = VISUAL_PRESETS.soft;
    this.sky = createSkyDome();
    scene.add(this.sky.mesh);
    this.apply('soft');
  }

  apply(id) {
    const preset = VISUAL_PRESETS[id] ?? VISUAL_PRESETS.soft;
    this.preset = preset;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = preset.toneMapping;
    this.renderer.toneMappingExposure = preset.exposure;
    this.sun.castShadow = preset.shadows;
    this.moon.castShadow = false;
    if (this.sun.shadow.mapSize.x !== preset.shadowMapSize) {
      this.sun.shadow.map?.dispose?.();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    }
    this.sun.color.set(preset.sunColor);
    this.moon.color.set(preset.moonColor);
    this.hemi.color.set(preset.hemiSky);
    this.hemi.groundColor.set(preset.hemiGround);
    this.materials.applyVisualPreset(preset);
    this.world.setShadowPolicy(preset.shadows, preset.id === 'cinematic' ? 4 : 3);
    this.dynamicPixelRatio = Math.min(this.dynamicPixelRatio, preset.pixelRatioMax, this.basePixelRatio);
    this.renderer.setPixelRatio(this.dynamicPixelRatio);
    this.sky.uniforms.uHorizon.value.set(preset.horizon);
    this.sky.uniforms.uZenith.value.set(preset.zenith);
    this.sky.uniforms.uNight.value.set(preset.night);
    this.sky.uniforms.uDusk.value.set(preset.dusk);
    this.sky.uniforms.uSunColor.value.set(preset.sunDisk);
    this.sky.uniforms.uMoonColor.value.set(preset.moonColor);
    return preset;
  }

  cycle() {
    const index = PRESET_ORDER.indexOf(this.preset.id);
    return this.apply(PRESET_ORDER[(index + 1) % PRESET_ORDER.length]);
  }

  adjustResolution(fps) {
    const cap = Math.min(this.basePixelRatio, this.preset.pixelRatioMax);
    let next = this.dynamicPixelRatio;
    if (fps < 30) next = Math.max(0.7, next - 0.1);
    else if (fps > 54) next = Math.min(cap, next + 0.05);
    if (Math.abs(next - this.dynamicPixelRatio) >= 0.045) {
      this.dynamicPixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(innerWidth, innerHeight, false);
    }
  }

  update(time, playerPosition, farBlocks) {
    const preset = this.preset;
    const angle = time * Math.PI * 2 - Math.PI / 2;
    const elevation = Math.sin(angle);
    const daylight = THREE.MathUtils.smoothstep(elevation, -0.18, 0.32);
    const radius = 190;
    this.sun.position.set(
      playerPosition.x + Math.cos(angle) * radius,
      playerPosition.y + Math.max(-0.3, elevation) * radius,
      playerPosition.z + Math.sin(angle * 0.73) * radius * 0.55,
    );
    this.sun.target.position.copy(playerPosition);
    this.moon.position.set(
      playerPosition.x - Math.cos(angle) * radius,
      playerPosition.y + Math.max(-0.15, -elevation) * radius,
      playerPosition.z - Math.sin(angle * 0.73) * radius * 0.55,
    );
    this.moon.target.position.copy(playerPosition);
    const moonlight = 1.0 - THREE.MathUtils.smoothstep(elevation, -0.28, 0.06);
    this.sun.intensity = 0.03 + daylight * preset.sunStrength;
    this.moon.intensity = moonlight * preset.moonStrength;
    this.hemi.intensity = 0.20 + daylight * Math.max(0, preset.hemiStrength - 0.20);

    const sunDir = this.sky.uniforms.uSunDir.value;
    sunDir.set(Math.cos(angle), elevation, Math.sin(angle * 0.73) * 0.55).normalize();
    const moonDir = this.sky.uniforms.uMoonDir.value;
    moonDir.copy(sunDir).multiplyScalar(-1);
    this.sky.uniforms.uDaylight.value = daylight;
    this.sky.uniforms.uMoonlight.value = moonlight;
    this.sky.uniforms.uTime.value = time;
    this.sky.mesh.position.copy(this.camera.position);
    const skyRadius = Math.max(1800, Math.min(52000, this.camera.far * 0.92));
    this.sky.mesh.scale.setScalar(skyRadius);

    const night = new THREE.Color(preset.night).lerp(new THREE.Color(preset.moonColor), 0.06);
    const dusk = new THREE.Color(preset.dusk);
    const day = new THREE.Color(preset.horizon);
    const fogColor = daylight < 0.28
      ? night.clone().lerp(dusk, daylight / 0.28)
      : dusk.clone().lerp(day, (daylight - 0.28) / 0.72);
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.near = Math.max(64, Math.min(900, farBlocks * 0.18));
    this.scene.fog.far = Math.max(700, farBlocks * preset.fogFactor);
  }
}

function createSkyDome() {
  const uniforms = {
    uHorizon: { value: new THREE.Color(0x9bcbe9) },
    uZenith: { value: new THREE.Color(0x5b98c6) },
    uNight: { value: new THREE.Color(0x06101f) },
    uDusk: { value: new THREE.Color(0xc77a58) },
    uSunColor: { value: new THREE.Color(0xfff0b8) },
    uMoonColor: { value: new THREE.Color(0xc9ddff) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uDaylight: { value: 1 },
    uMoonlight: { value: 0 },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vDirection;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uNight;
      uniform vec3 uDusk;
      uniform vec3 uSunColor;
      uniform vec3 uMoonColor;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform float uDaylight;
      uniform float uMoonlight;
      uniform float uTime;
      float hash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      void main() {
        vec3 dir = normalize(vDirection);
        float horizonMix = smoothstep(-0.18, 0.58, dir.y);
        vec3 daySky = mix(uHorizon, uZenith, horizonMix);
        float duskBand = exp(-abs(dir.y) * 4.5) * (1.0 - smoothstep(0.15, 0.7, uDaylight));
        daySky = mix(daySky, uDusk, duskBand * 0.72);
        vec3 color = mix(uNight, daySky, uDaylight);
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float sun = pow(sunDot, 700.0) + pow(sunDot, 45.0) * 0.22;
        color += uSunColor * sun * (0.25 + uDaylight * 1.15);
        float moonDot = max(dot(dir, normalize(uMoonDir)), 0.0);
        float moonDisc = smoothstep(0.99935, 0.99982, moonDot);
        float moonHalo = pow(moonDot, 90.0) * 0.09;
        float crater = 0.88 + hash(floor(dir * 180.0)) * 0.12;
        color += uMoonColor * (moonDisc * crater * 0.675 + moonHalo) * uMoonlight;
        float stars = step(0.9974, hash(floor(dir * 520.0 + uTime * 0.001)));
        stars *= smoothstep(0.03, 0.55, dir.y) * (1.0 - uDaylight) * 1.35;
        color += vec3(stars * 0.9);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, uniforms };
}
