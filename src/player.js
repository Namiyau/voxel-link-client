import THREE from './three-loader.js';
import { horizontalVelocity } from '../shared/movement.js';
import { loadSettings } from './settings.js';

const STANDING_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.5;
const PLAYER_RADIUS = 0.3;
const STANDING_EYE_HEIGHT = 1.62;
const CROUCH_EYE_HEIGHT = 1.27;

export class LocalPlayer extends EventTarget {
  constructor(camera, world, canvas) {
    super();
    this.camera = camera;
    this.world = world;
    this.canvas = canvas;
    this.position = new THREE.Vector3(0.5, 80, 0.5);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.keys = new Set();
    this.enabled = false;
    this.health = 20;
    this.lastDamageAt = 0;
    this.lastHealAt = 0;
    this.fallStartY = null;
    this.lastWTapAt = -Infinity;
    this.lastSpaceTapAt = -Infinity;
    this.doubleTapSprintUntil = 0;
    this.sneaking = false;
    this.bodyHeight = STANDING_HEIGHT;
    this.eyeHeight = STANDING_EYE_HEIGHT;
    this.crouchBlend = 0;
    this.gameMode = 'survival';
    this.flying = false;
    const savedSensitivity = Number(loadSettings().sensitivity) || 1;
    this.sensitivity = Math.max(0.25, Math.min(4, savedSensitivity));
    this._bind();
  }

  setSensitivity(value) {
    this.sensitivity = Math.max(0.25, Math.min(4, Number(value) || 1));
  }

  _bind() {
    document.addEventListener('mousemove', (event) => {
      if (!this.enabled || document.pointerLockElement !== this.canvas) return;
      this.yaw -= event.movementX * 0.0022 * this.sensitivity;
      this.pitch -= event.movementY * 0.0022 * this.sensitivity;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });
    document.addEventListener('keydown', (event) => {
      if (this.enabled && document.pointerLockElement === this.canvas && ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','ControlLeft','ControlRight'].includes(event.code)) event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'KeyW') {
        const now = performance.now();
        if (now - this.lastWTapAt < 300) this.doubleTapSprintUntil = now + 1200;
        this.lastWTapAt = now;
      }
      if (event.code === 'Space' && this.enabled && this.gameMode === 'creative') {
        const now = performance.now();
        if (now - this.lastSpaceTapAt < 300) {
          event.preventDefault();
          this.setFlying(!this.flying);
          this.lastSpaceTapAt = -Infinity;
        } else {
          this.lastSpaceTapAt = now;
        }
      }
      this.keys.add(event.code);
    });
    document.addEventListener('keyup', (event) => this.keys.delete(event.code));
    const clearInputState = () => {
      this.keys.clear();
      this.lastSpaceTapAt = -Infinity;
      this.doubleTapSprintUntil = 0;
    };
    globalThis.addEventListener?.('blur', clearInputState);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearInputState();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas) clearInputState();
    });
  }

  spawn(position) {
    this.position.set(position.x, position.y, position.z);
    this.velocity.set(0, 0, 0);
    this.health = 20;
    this.fallStartY = null;
    this.flying = false;
    this.sneaking = false;
    this.crouchBlend = 0;
    this.bodyHeight = STANDING_HEIGHT;
    this.eyeHeight = STANDING_EYE_HEIGHT;
    this.syncCamera();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.keys.clear();
  }

  setGameMode(mode) {
    this.gameMode = mode === 'creative' ? 'creative' : 'survival';
    if (this.gameMode !== 'creative') this.setFlying(false);
    this.fallStartY = null;
  }

  setFlying(value) {
    const next = this.gameMode === 'creative' && Boolean(value);
    if (next === this.flying) return;
    this.flying = next;
    this.velocity.y = 0;
    this.fallStartY = null;
    this.dispatchEvent(new CustomEvent('flightchange', { detail: { flying: next } }));
  }

  syncCamera() {
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  update(dt) {
    if (!this.enabled) {
      this.syncCamera();
      return;
    }
    dt = Math.min(dt, 0.05);
    const forwardInput = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const sideInput = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const sprintKey = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    if (this.gameMode === 'creative' && this.flying) {
      this.sneaking = false;
      const sprinting = sprintKey || performance.now() < this.doubleTapSprintUntil;
      const speed = sprinting ? 22 : 10;
      const horizontal = horizontalVelocity(this.yaw, forwardInput, sideInput, speed);
      const targetX = horizontal.x;
      const targetZ = horizontal.z;
      const verticalInput = (this.keys.has('Space') ? 1 : 0)
        - ((this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? 1 : 0);
      const targetY = verticalInput * (sprinting ? 18 : 9);
      const factor = Math.min(1, 12 * dt);
      this.velocity.x += (targetX - this.velocity.x) * factor;
      this.velocity.y += (targetY - this.velocity.y) * factor;
      this.velocity.z += (targetZ - this.velocity.z) * factor;
      this.onGround = false;
      this.tryAxis('x', this.velocity.x * dt);
      this.tryAxis('z', this.velocity.z * dt);
      this.tryAxis('y', this.velocity.y * dt);
      this.syncCamera();
      if (this.position.y < -64) this.dispatchEvent(new CustomEvent('damage', { detail: { amount: 20, reason: 'void' } }));
      return;
    }

    const wantsSneak = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.sneaking = wantsSneak || (!this.canStand() && this.bodyHeight < STANDING_HEIGHT - 0.01);
    const targetBlend = this.sneaking ? 1 : 0;
    this.crouchBlend += (targetBlend - this.crouchBlend) * Math.min(1, 14 * dt);
    this.bodyHeight = STANDING_HEIGHT + (CROUCH_HEIGHT - STANDING_HEIGHT) * this.crouchBlend;
    this.eyeHeight = STANDING_EYE_HEIGHT + (CROUCH_EYE_HEIGHT - STANDING_EYE_HEIGHT) * this.crouchBlend;
    const sprinting = !this.sneaking && forwardInput > 0 && (sprintKey || performance.now() < this.doubleTapSprintUntil);
    const speed = this.sneaking ? 1.35 : sprinting ? 6.2 : 4.35;
    const horizontal = horizontalVelocity(this.yaw, forwardInput, sideInput, speed);
    const targetX = horizontal.x;
    const targetZ = horizontal.z;
    const acceleration = this.onGround ? 18 : 7;
    this.velocity.x += (targetX - this.velocity.x) * Math.min(1, acceleration * dt);
    this.velocity.z += (targetZ - this.velocity.z) * Math.min(1, acceleration * dt);

    if (this.onGround && this.keys.has('Space')) {
      this.velocity.y = 8.6;
      this.onGround = false;
      this.fallStartY = this.position.y;
    }
    this.velocity.y -= 27 * dt;
    this.moveWithCollisions(dt);
    this.syncCamera();

    if (this.position.y < -24) this.dispatchEvent(new CustomEvent('damage', { detail: { amount: 20, reason: 'void' } }));
  }

  moveWithCollisions(dt) {
    const wasGrounded = this.onGround;
    this.onGround = false;
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;
    const dy = this.velocity.y * dt;
    const oldY = this.position.y;

    const movedX = this.tryAxis('x', dx);
    const movedZ = this.tryAxis('z', dz);
    if ((!movedX || !movedZ) && wasGrounded && !this.sneaking) {
      const original = this.position.clone();
      if (!this.collidesAt(this.position.x, this.position.y + 0.61, this.position.z)) {
        this.position.y += 0.61;
        const retryX = movedX || this.tryAxis('x', dx);
        const retryZ = movedZ || this.tryAxis('z', dz);
        if (!retryX || !retryZ) this.position.copy(original);
      }
    }

    if (!this.tryAxis('y', dy)) {
      if (dy < 0) {
        this.onGround = true;
        if (this.gameMode === 'survival' && this.fallStartY !== null) {
          const fallDistance = this.fallStartY - this.position.y;
          if (fallDistance > 3.4) {
            const amount = Math.max(1, Math.floor(fallDistance - 3));
            this.dispatchEvent(new CustomEvent('damage', { detail: { amount, reason: 'fall' } }));
          }
        }
        this.fallStartY = null;
      }
      this.velocity.y = 0;
    } else if (!wasGrounded && this.velocity.y < 0 && this.fallStartY === null) {
      this.fallStartY = oldY;
    }

    if (this.sneaking && wasGrounded && !this.hasSupportBelow()) {
      this.position.x -= dx;
      this.position.z -= dz;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  tryAxis(axis, delta) {
    if (Math.abs(delta) < 1e-7) return true;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.25));
    const part = delta / steps;
    for (let i = 0; i < steps; i += 1) {
      const candidate = this.position.clone();
      candidate[axis] += part;
      if (this.collidesAt(candidate.x, candidate.y, candidate.z)) {
        this.velocity[axis] = 0;
        return false;
      }
      this.position.copy(candidate);
    }
    return true;
  }

  collidesAt(x, y, z) {
    const minX = Math.floor(x - PLAYER_RADIUS);
    const maxX = Math.floor(x + PLAYER_RADIUS);
    const minY = Math.floor(y);
    const maxY = Math.floor(y + this.bodyHeight - 0.001);
    const minZ = Math.floor(z - PLAYER_RADIUS);
    const maxZ = Math.floor(z + PLAYER_RADIUS);
    for (let by = minY; by <= maxY; by += 1) {
      for (let bz = minZ; bz <= maxZ; bz += 1) {
        for (let bx = minX; bx <= maxX; bx += 1) {
          if (this.world.isSolid(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }


  canStand() {
    const originalHeight = this.bodyHeight;
    this.bodyHeight = STANDING_HEIGHT;
    const blocked = this.collidesAt(this.position.x, this.position.y, this.position.z);
    this.bodyHeight = originalHeight;
    return !blocked;
  }

  hasSupportBelow() {
    const y = this.position.y - 0.08;
    const samples = [
      [this.position.x - 0.25, y, this.position.z - 0.25],
      [this.position.x + 0.25, y, this.position.z - 0.25],
      [this.position.x - 0.25, y, this.position.z + 0.25],
      [this.position.x + 0.25, y, this.position.z + 0.25],
    ];
    return samples.some(([x, sy, z]) => this.world.isSolid(Math.floor(x), Math.floor(sy), Math.floor(z)));
  }

  applyHealth(value) {
    const previous = this.health;
    this.health = Math.max(0, Math.min(20, value));
    if (this.health < previous) this.lastDamageAt = performance.now();
  }

  eyePosition(target = new THREE.Vector3()) {
    return target.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  forward(target = new THREE.Vector3()) {
    return this.camera.getWorldDirection(target);
  }
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map();
  }

  clear() {
    for (const item of this.players.values()) this.scene.remove(item.group);
    this.players.clear();
  }

  add(player) {
    if (this.players.has(player.id)) return;
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: colorFromId(player.id) });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xd7a47c });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.3), bodyMat);
    body.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52), skinMat);
    head.position.y = 1.68;
    const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.25);
    const leg1 = new THREE.Mesh(legGeo, bodyMat); leg1.position.set(-0.15, 0.35, 0);
    const leg2 = new THREE.Mesh(legGeo, bodyMat); leg2.position.set(0.15, 0.35, 0);
    group.add(body, head, leg1, leg2);
    const label = makeNameSprite(player.name);
    label.position.y = 2.25;
    group.add(label);
    group.position.set(player.position.x, player.position.y, player.position.z);
    this.scene.add(group);
    this.players.set(player.id, {
      ...player,
      group,
      targetPosition: group.position.clone(),
      targetYaw: player.yaw ?? 0,
    });
  }

  remove(id) {
    const item = this.players.get(id);
    if (!item) return;
    this.scene.remove(item.group);
    this.players.delete(id);
  }

  updateSnapshot(players, ownId) {
    const seen = new Set();
    for (const p of players) {
      if (p.id === ownId) continue;
      seen.add(p.id);
      if (!this.players.has(p.id)) this.add(p);
      const item = this.players.get(p.id);
      item.name = p.name;
      item.health = p.health;
      item.gameMode = p.gameMode;
      item.flying = p.flying;
      item.targetPosition.set(p.position.x, p.position.y, p.position.z);
      item.targetYaw = p.yaw ?? 0;
    }
    for (const id of this.players.keys()) if (!seen.has(id)) this.remove(id);
  }

  update(dt) {
    const factor = 1 - Math.exp(-12 * dt);
    for (const item of this.players.values()) {
      item.group.position.lerp(item.targetPosition, factor);
      item.group.rotation.y = lerpAngle(item.group.rotation.y, item.targetYaw, factor);
    }
  }

  list() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, health: p.health, gameMode: p.gameMode }));
  }
}

function colorFromId(id) {
  let hash = 0;
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return new THREE.Color().setHSL(((hash >>> 0) % 360) / 360, 0.55, 0.5);
}

function makeNameSprite(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 6, 256, 52);
  ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'white'; ctx.fillText(name, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

function lerpAngle(a, b, t) {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
}
