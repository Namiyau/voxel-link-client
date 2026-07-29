import THREE from './three.js';
import { DEFAULT_SERVER, CLIENT_DEFAULTS } from '../config.js';
import { BLOCK, BLOCK_NAMES, PLACEABLE_BLOCKS, WORLD_HEIGHT } from '../shared/constants.js';
import { GENERATOR_VERSION, terrainInfo } from '../shared/worldgen.js';
import { createMaterials } from './materials.js';
import { InventoryState } from './inventory.js';
import { NetworkClient, normalizeWsUrl } from './network.js';
import { LocalPlayer, RemotePlayers } from './player.js';
import { GameUI } from './ui.js';
import { VisualSystem, VISUAL_PRESETS } from './visuals.js';
import { VoxelWorld } from './world.js';
import { deleteSaveSlot, loadSaveSlot, saveSaveSlot } from './save-slots.js';

const canvas = document.getElementById('game-canvas');
const ui = new GameUI();
const safeModeActive = sessionStorage.getItem('voxel-link-safe-mode') === '1';
let rendererLost = false;
ui.setLoading(safeModeActive ? '正在以安全模式创建 WebGL 渲染器……' : '正在创建高性能 WebGL 渲染器……', 0.1);

function createRenderer() {
  const attempts = safeModeActive
    ? [
        { antialias: false, powerPreference: 'default', logarithmicDepthBuffer: false, precision: 'mediump' },
      ]
    : [
        { antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true, precision: 'highp' },
        { antialias: false, powerPreference: 'default', logarithmicDepthBuffer: false, precision: 'mediump' },
      ];
  const failures = [];
  for (const options of attempts) {
    try {
      return new THREE.WebGLRenderer({ canvas, ...options });
    } catch (error) {
      failures.push(error?.message || String(error));
    }
  }
  throw new Error(`无法创建 WebGL 渲染器：${failures.join('；')}`);
}

const renderer = createRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, safeModeActive ? 1 : 1.6));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 24000);
scene.fog = new THREE.Fog(0x9cc8e8, 90, 1200);

const hemi = new THREE.HemisphereLight(0xaed8ff, 0x3a3229, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0c2, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 460;
sun.shadow.camera.left = -140;
sun.shadow.camera.right = 140;
sun.shadow.camera.top = 140;
sun.shadow.camera.bottom = -140;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);
const moon = new THREE.DirectionalLight(0xc9ddff, 0.35);
moon.castShadow = false;
scene.add(moon, moon.target);

ui.setLoading('正在生成程序化像素纹理与天空着色器……', 0.25);
const materials = createMaterials(renderer);
const network = new NetworkClient();
const world = new VoxelWorld(scene, materials, network);
const player = new LocalPlayer(camera, world, canvas);
const remotes = new RemotePlayers(scene);
const visuals = new VisualSystem({ renderer, scene, camera, sun, moon, hemi, materials, world });
const inventory = new InventoryState();

const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006));
const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: true });
const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
outline.visible = false;
scene.add(outline);

let gameActive = false;
let multiplayer = false;
let worldTime = 0.28;
let ownName = 'Player_1';
let ownId = null;
let gameMode = 'survival';
let visualPreset = CLIENT_DEFAULTS.visualPreset;
let lastFrame = performance.now();
let fps = 0;
let fpsCounter = 0;
let fpsTimer = performance.now();
let lastResolutionAdjust = performance.now();
let lastMoveSend = 0;
let lastPingSend = 0;
let lastTarget = null;
let localHealth = 20;
let lastDamageAt = -Infinity;
let lastHealAt = 0;
let currentServerUrl = '';
let remoteSnapshot = [];
let singleSaveSlot = 0;
let singleWorldName = '';
let singleSaveCreatedAt = '';
let saveTimer = null;
let lastResourceGuard = performance.now();
let lowFpsSince = 0;
let resourcePressureSince = 0;
let lastAutomaticReduction = -Infinity;
let worldStartedAt = performance.now();
let automaticLoadReductions = 0;
const pendingBreaks = new Map();
const pendingPlacements = new Map();
let timeSendTimer = null;

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  rendererLost = true;
  gameActive = false;
  player?.setEnabled?.(false);
  try { if (!multiplayer) saveSingleWorld(); } catch {}
  sessionStorage.setItem('voxel-link-safe-mode', '1');
  globalThis.__voxelLinkShowFailure?.(
    '显卡渲染上下文已丢失。',
    '游戏已切换为安全模式标记。请点击“安全模式重载”；新版会降低初始视距、关闭高负载阴影并恢复运行。',
  );
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  location.reload();
}, false);

initializeDefaults();
wireUI();
wireNetwork();
wirePlayer();
wireInput();
inventory.addEventListener('change', () => ui.updateInventory(inventory.mode, inventory.serialize()));
ui.updateInventory(inventory.mode, inventory.serialize());

ui.setLoading('初始化完成。', 1);
setTimeout(() => ui.hideLoading(), 250);
requestAnimationFrame(loop);

function initializeDefaults() {
  const params = new URLSearchParams(location.search);
  const queryServer = params.get('server');
  const queryName = params.get('name');
  const sameOriginCapable = /^https?:$/.test(location.protocol)
    && !/\.github\.io$/i.test(location.hostname)
    && (location.port === '3000' || params.get('sameOriginServer') === '1');
  const sameOriginServer = sameOriginCapable
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    : '';
  ui.setServerAddress(queryServer || DEFAULT_SERVER || sameOriginServer);
  if (queryName) document.getElementById('player-name').value = queryName.slice(0, 16);
  const defaults = safeModeActive
    ? { ...CLIENT_DEFAULTS, nearDistance: 8, farDistance: 256, visualPreset: 'classic' }
    : CLIENT_DEFAULTS;
  ui.setDefaults(defaults);
  applyVisualPreset(defaults.visualPreset, false);
  ui.updateGameMode(defaults.gameMode, false);
  refreshSaveSummary();
  if (safeModeActive) ui.setMenuStatus('安全模式已启用：近景 8、远景 256、原版像素光影。稳定后可手动调高。');
}

function wireUI() {
  ui.addEventListener('singleplayer', startSingleplayer);
  ui.addEventListener('saveslotchange', refreshSaveSummary);
  ui.addEventListener('deletesave', deleteSelectedSave);
  ui.addEventListener('join', joinServer);
  ui.addEventListener('status', checkServerStatus);
  ui.addEventListener('resume', requestPointerLock);
  ui.addEventListener('leave', leaveGame);
  ui.addEventListener('invite', copyInviteLink);
  ui.addEventListener('modecycle', () => {
    if (!gameActive) return;
    setGameMode(gameMode === 'creative' ? 'survival' : 'creative', { send: true, announce: true });
  });
  ui.addEventListener('visualcycle', () => {
    if (!gameActive) return;
    const preset = visuals.cycle();
    visualPreset = preset.id;
    ui.updateVisual(preset.name);
    ui.toast(`光影：${preset.name}`);
  });
  ui.addEventListener('chat', (event) => {
    if (multiplayer) network.chat(event.detail);
    else ui.addChat(`<${ownName}> ${event.detail}`);
  });
  ui.addEventListener('chatopen', () => {
    player.setEnabled(false);
    document.exitPointerLock?.();
  });
  ui.addEventListener('inventorytoggle', toggleInventory);
  ui.addEventListener('timechange', (event) => setRequestedTime(event.detail));
}

function wirePlayer() {
  player.addEventListener('damage', (event) => {
    if (!gameActive) return;
    const { amount, reason } = event.detail;
    if (gameMode === 'creative' && reason !== 'void') return;
    lastDamageAt = performance.now();
    if (multiplayer) network.damage(amount, reason);
    else applyLocalDamage(amount, reason);
  });
  player.addEventListener('flightchange', (event) => {
    ui.updateGameMode(gameMode, event.detail.flying);
    ui.toast(event.detail.flying ? '创造飞行已开启。' : '创造飞行已关闭。');
  });
}

function wireNetwork() {
  network.addEventListener('chunk_mods', (event) => {
    const { cx, cz, blocks } = event.detail;
    world.applyChunkMods(cx, cz, blocks);
  });
  network.addEventListener('block_update', (event) => {
    const { x, y, z, block } = event.detail;
    const key = `${x},${y},${z}`;
    const previous = world.getBlock(x, y, z);
    world.applyBlockUpdate(x, y, z, block);
    const pendingBreak = pendingBreaks.get(key);
    if (pendingBreak && block === BLOCK.AIR) {
      clearTimeout(pendingBreak.timeout);
      pendingBreaks.delete(key);
      if (gameMode === 'survival') inventory.add(pendingBreak.block, 1);
    }
    const pendingPlace = pendingPlacements.get(key);
    if (pendingPlace) {
      clearTimeout(pendingPlace.timeout);
      pendingPlacements.delete(key);
      if (block !== pendingPlace.block && gameMode === 'survival') inventory.add(pendingPlace.block, 1);
    }
    if (previous !== block && !multiplayer) scheduleSingleSave();
  });
  network.addEventListener('snapshot', (event) => {
    worldTime = event.detail.time;
    if (ui.inventoryOpen) ui.updateTime(worldTime);
    remoteSnapshot = event.detail.players;
    remotes.updateSnapshot(remoteSnapshot, ownId);
    const me = remoteSnapshot.find((p) => p.id === ownId);
    if (me) {
      if (me.gameMode && me.gameMode !== gameMode) setGameMode(me.gameMode, { send: false, announce: false });
      if (gameMode === 'survival' && me.health !== localHealth) setHealth(me.health);
    }
    ui.updatePlayerList(remoteSnapshot);
  });
  network.addEventListener('player_join', (event) => {
    remotes.add(event.detail.player);
  });
  network.addEventListener('player_leave', (event) => remotes.remove(event.detail.id));
  network.addEventListener('player_mode', (event) => {
    const item = remoteSnapshot.find((p) => p.id === event.detail.id);
    if (item) item.gameMode = event.detail.gameMode;
    ui.updatePlayerList(remoteSnapshot);
  });
  network.addEventListener('game_mode', (event) => {
    setGameMode(event.detail.gameMode, { send: false, announce: false });
    if (Number.isFinite(event.detail.health)) setHealth(event.detail.health);
  });
  network.addEventListener('chat', (event) => ui.addChat(`<${event.detail.name}> ${event.detail.text}`));
  network.addEventListener('system_chat', (event) => ui.addChat(event.detail.text, true));
  network.addEventListener('health', (event) => {
    if (gameMode === 'survival') setHealth(event.detail.health);
  });
  network.addEventListener('respawn', (event) => {
    setHealth(event.detail.health);
    player.spawn(event.detail.position);
    player.setGameMode(gameMode);
    ui.updateGameMode(gameMode, false);
    ui.toast('你已在出生点重生。');
  });
  network.addEventListener('position_correction', (event) => {
    player.position.set(event.detail.position.x, event.detail.position.y, event.detail.position.z);
    player.velocity.set(0, 0, 0);
    ui.toast('服务器修正了异常移动。');
  });
  network.addEventListener('time_set', (event) => {
    worldTime = ((Number(event.detail.time) || 0) % 1 + 1) % 1;
    ui.updateTime(worldTime);
    ui.toast('世界时间已调整。');
  });
  network.addEventListener('server_closing', () => ui.toast('服务器正在关闭并保存世界。'));
  network.addEventListener('disconnect', (event) => {
    if (gameActive && multiplayer && event.detail.wasReady) {
      ui.toast('与服务器的连接已断开。', 5000);
      leaveGame();
    }
  });
}

function wireInput() {
  canvas.addEventListener('click', () => {
    if (gameActive && !ui.chatOpen && !ui.inventoryOpen && document.pointerLockElement !== canvas) requestPointerLock();
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('mousedown', (event) => {
    if (!gameActive || document.pointerLockElement !== canvas || ui.chatOpen || ui.inventoryOpen) return;
    if (event.button === 0) breakTargetBlock();
    if (event.button === 2) placeSelectedBlock();
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    player.setEnabled(gameActive && locked && !ui.chatOpen && !ui.inventoryOpen);
    if (gameActive && !locked && !ui.chatOpen && !ui.inventoryOpen) ui.showPause();
    else if (locked) ui.hidePause();
  });
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });
}

async function startSingleplayer() {
  const values = ui.values();
  if (!validName(values.name)) return ui.setMenuStatus('名称需为 2～16 个中文、英文、数字或下划线字符。', true);
  ownName = values.name;
  multiplayer = false;
  ownId = 'local';
  currentServerUrl = '';
  singleSaveSlot = values.saveSlot;
  const saved = loadSaveSlot(singleSaveSlot);
  const seed = saved?.seed ?? (values.seed ? numberSeed(values.seed) : Math.floor(Math.random() * 0x7fffffff));
  const defaultSpawn = { x: 0.5, y: terrainInfo(seed, 0, 0).height + 3, z: 0.5 };
  const spawn = saved?.position && Number.isFinite(saved.position.x) && Number.isFinite(saved.position.y) && Number.isFinite(saved.position.z)
    ? saved.position : defaultSpawn;
  singleWorldName = saved?.name || values.worldName || `世界 ${singleSaveSlot}`;
  singleSaveCreatedAt = saved?.createdAt || new Date().toISOString();
  inventory.reset(saved?.gameMode ?? values.gameMode, saved?.inventory);

  beginWorld({
    seed,
    time: saved?.time ?? 0.28,
    spawn,
    nearDistance: values.nearDistance,
    farDistance: values.farDistance,
    modeText: `单机 · 存档 ${singleSaveSlot}`,
    initialGameMode: saved?.gameMode ?? values.gameMode,
    initialVisualPreset: values.visualPreset,
  });
  if (saved?.chunks && typeof saved.chunks === 'object') {
    for (const [key, blocks] of Object.entries(saved.chunks)) {
      const [cx, cz] = key.split(',').map(Number);
      if (Number.isInteger(cx) && Number.isInteger(cz)) world.applyChunkMods(cx, cz, blocks, { invalidate: false });
    }
    world.refreshLod(player.position.x, player.position.z);
  }
  if (saved) {
    player.yaw = Number(saved.yaw) || 0;
    player.pitch = Number(saved.pitch) || 0;
    setHealth(saved.gameMode === 'creative' ? 20 : saved.health ?? 20);
    ui.addChat(`已读取存档 ${singleSaveSlot}：${singleWorldName}`, true);
  } else {
    saveSingleWorld();
    ui.addChat(`已创建存档 ${singleSaveSlot}：${singleWorldName}`, true);
  }
  ui.addChat(`世界种子：${seed} · 生成器 v${GENERATOR_VERSION}`, true);
}

async function joinServer() {
  const values = ui.values();
  if (!validName(values.name)) return ui.setMenuStatus('名称需为 2～16 个中文、英文、数字或下划线字符。', true);
  let url;
  try { url = normalizeWsUrl(values.server); }
  catch (error) { return ui.setMenuStatus(error.message, true); }
  ui.setMenuStatus('正在连接服务器……');
  try {
    const welcome = await network.connect(url, values.name, values.password, values.gameMode);
    ownName = values.name;
    ownId = welcome.id;
    currentServerUrl = url;
    multiplayer = true;
    remoteSnapshot = [
      {
        id: ownId,
        name: ownName,
        position: welcome.spawn,
        yaw: 0,
        pitch: 0,
        health: 20,
        gameMode: welcome.gameMode,
        flying: false,
      },
      ...welcome.players,
    ];
    remotes.clear();
    inventory.reset(welcome.gameMode);
    remotes.updateSnapshot(remoteSnapshot, ownId);
    beginWorld({
      seed: welcome.seed,
      time: welcome.time,
      spawn: welcome.spawn,
      nearDistance: values.nearDistance,
      farDistance: values.farDistance,
      modeText: `联机 ${welcome.players.length + 1}/${welcome.maxPlayers}`,
      initialGameMode: welcome.gameMode,
      initialVisualPreset: values.visualPreset,
    });
    ui.addChat(welcome.motd || '已加入服务器。', true);
    ui.setMenuStatus('');
  } catch (error) {
    network.disconnect();
    ui.setMenuStatus(error.message, true);
  }
}

function beginWorld({ seed, time, spawn, nearDistance, farDistance, modeText, initialGameMode, initialVisualPreset }) {
  world.reset({ seed, nearDistance, farDistance, singleplayer: !multiplayer, network });
  worldTime = time;
  setHealth(20);
  lastDamageAt = -Infinity;
  lastHealAt = performance.now();
  player.spawn(spawn);
  player.yaw = 0;
  gameActive = true;
  worldStartedAt = performance.now();
  lastResourceGuard = worldStartedAt;
  lowFpsSince = 0;
  resourcePressureSince = 0;
  lastAutomaticReduction = -Infinity;
  automaticLoadReductions = 0;
  camera.far = Math.max(4800, Math.min(46000, farDistance * 16 * 1.24));
  camera.updateProjectionMatrix();
  applyVisualPreset(initialVisualPreset, false);
  setGameMode(initialGameMode, { send: false, announce: false });
  ui.startGame(modeText);
  ui.updatePlayerList(multiplayer ? remoteSnapshot : [{ id: ownId, name: ownName, health: localHealth, gameMode, flying: false }]);
  world.update(player.position);
  requestPointerLock();
}

function leaveGame() {
  gameActive = false;
  player.setEnabled(false);
  document.exitPointerLock?.();
  network.disconnect();
  remotes.clear();
  if (!multiplayer) saveSingleWorld();
  world.disposeAll();
  for (const item of pendingBreaks.values()) clearTimeout(item.timeout);
  for (const item of pendingPlacements.values()) clearTimeout(item.timeout);
  pendingBreaks.clear();
  pendingPlacements.clear();
  ui.closeInventory();
  outline.visible = false;
  multiplayer = false;
  ownId = null;
  singleSaveSlot = 0;
  singleWorldName = '';
  singleSaveCreatedAt = '';
  player.setGameMode('survival');
  ui.showMenu();
  refreshSaveSummary();
}

function requestPointerLock() {
  if (!gameActive || ui.chatOpen || ui.inventoryOpen) return;
  canvas.requestPointerLock?.();
}

function toggleInventory() {
  if (!gameActive || ui.chatOpen) return;
  if (ui.inventoryOpen) {
    ui.closeInventory();
    requestPointerLock();
    return;
  }
  player.setEnabled(false);
  document.exitPointerLock?.();
  ui.openInventory(gameMode, inventory.serialize(), worldTime);
}

function setRequestedTime(value) {
  if (!gameActive) return;
  const next = ((Number(value) || 0) % 1 + 1) % 1;
  if (multiplayer) {
    if (gameMode !== 'creative') {
      ui.toast('联机调整时间需要创造模式。');
      ui.updateTime(worldTime);
      return;
    }
    clearTimeout(timeSendTimer);
    timeSendTimer = setTimeout(() => network.setTime(next), 120);
    return;
  }
  worldTime = next;
  ui.updateTime(worldTime);
  scheduleSingleSave();
}

async function checkServerStatus() {
  let wsUrl;
  try { wsUrl = new URL(normalizeWsUrl(ui.serverAddress)); }
  catch (error) { return ui.setMenuStatus(error.message, true); }
  wsUrl.protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
  wsUrl.pathname = '/status';
  wsUrl.search = '';
  ui.setMenuStatus('正在检查服务器……');
  try {
    const response = await fetch(wsUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();
    ui.setMenuStatus(`${status.motd}：在线，玩家 ${status.players}/${status.maxPlayers}，版本 ${status.version}。`);
  } catch (error) {
    ui.setMenuStatus(`服务器不可达：${error.message}`, true);
  }
}

async function copyInviteLink() {
  if (!multiplayer || !currentServerUrl) return ui.setPauseStatus('单机模式没有服务器邀请链接。');
  const invite = new URL(location.href);
  invite.search = '';
  invite.searchParams.set('server', currentServerUrl);
  invite.searchParams.set('name', ownName);
  try {
    await navigator.clipboard.writeText(invite.toString());
    ui.setPauseStatus('邀请链接已复制。');
  } catch {
    window.prompt('复制此邀请链接：', invite.toString());
  }
}

function setGameMode(mode, { send = true, announce = true } = {}) {
  const next = mode === 'creative' ? 'creative' : 'survival';
  const changed = next !== gameMode;
  gameMode = next;
  player.setGameMode(next);
  inventory.setMode(next);
  if (next === 'creative') setHealth(20);
  ui.updateGameMode(next, player.flying);
  const own = remoteSnapshot.find((p) => p.id === ownId);
  if (own) {
    own.gameMode = next;
    own.flying = player.flying;
    own.health = localHealth;
  }
  ui.updatePlayerList(multiplayer ? remoteSnapshot : [{ id: ownId, name: ownName, health: localHealth, gameMode: next, flying: player.flying }]);
  if (send && multiplayer && network.ready) network.setGameMode(next);
  if (changed && announce) ui.toast(`已切换到${next === 'creative' ? '创造' : '生存'}模式。`);
}

function applyVisualPreset(id, announce = true) {
  const preset = visuals.apply(VISUAL_PRESETS[id] ? id : 'soft');
  visualPreset = preset.id;
  ui.updateVisual(preset.name);
  if (announce) ui.toast(`光影：${preset.name}`);
}

function breakTargetBlock() {
  const target = getTarget();
  if (!target) return;
  const key = `${target.hit.x},${target.hit.y},${target.hit.z}`;
  if (multiplayer) {
    if (pendingBreaks.has(key)) return;
    const timeout = setTimeout(() => pendingBreaks.delete(key), 1800);
    pendingBreaks.set(key, { block: target.block, timeout });
    network.setBlock(target.hit.x, target.hit.y, target.hit.z, BLOCK.AIR);
  } else {
    world.setLocalBlock(target.hit.x, target.hit.y, target.hit.z, BLOCK.AIR);
    if (gameMode === 'survival' && PLACEABLE_BLOCKS.includes(target.block)) inventory.add(target.block, 1);
    scheduleSingleSave();
  }
}

function placeSelectedBlock() {
  const target = getTarget();
  if (!target?.adjacent || target.adjacent.y < 1 || target.adjacent.y >= WORLD_HEIGHT) return;
  const { x, y, z } = target.adjacent;
  const block = ui.selectedBlock;
  if (blockIntersectsLocalPlayer(x, y, z)) return ui.toast('不能把方块放进玩家身体里。');
  if (!inventory.consume(block, 1)) return ui.toast(`背包中没有${BLOCK_NAMES[block]}。按 E 查看背包。`);
  const key = `${x},${y},${z}`;
  if (multiplayer) {
    const timeout = setTimeout(() => {
      const pending = pendingPlacements.get(key);
      if (!pending) return;
      pendingPlacements.delete(key);
      if (gameMode === 'survival') inventory.add(block, 1);
      ui.toast('放置请求未确认，物品已退回背包。');
    }, 1800);
    pendingPlacements.set(key, { block, timeout });
    network.setBlock(x, y, z, block);
  } else {
    world.setLocalBlock(x, y, z, block);
    scheduleSingleSave();
  }
}

function getTarget() {
  const reach = gameMode === 'creative' ? 12 : 6;
  return world.raycast(player.eyePosition(new THREE.Vector3()), player.forward(new THREE.Vector3()), reach);
}

function blockIntersectsLocalPlayer(x, y, z) {
  return x + 1 > player.position.x - 0.3 && x < player.position.x + 0.3
    && y + 1 > player.position.y && y < player.position.y + player.bodyHeight
    && z + 1 > player.position.z - 0.3 && z < player.position.z + 0.3;
}

function applyLocalDamage(amount, reason) {
  if (gameMode === 'creative' && reason === 'void') {
    const height = terrainInfo(world.seed, 0, 0).height + 3;
    player.spawn({ x: 0.5, y: height, z: 0.5 });
    player.setGameMode(gameMode);
    ui.updateGameMode(gameMode, false);
    ui.toast('已从虚空返回出生点。');
    return;
  }
  setHealth(Math.max(0, localHealth - amount));
  ui.toast(reason === 'fall' ? `坠落伤害：${amount / 2} 颗心` : '你掉出了世界。');
  if (localHealth <= 0) {
    const height = terrainInfo(world.seed, 0, 0).height + 3;
    player.spawn({ x: 0.5, y: height, z: 0.5 });
    player.setGameMode(gameMode);
    setHealth(20);
    ui.addChat(`${ownName} 重生了。`, true);
  }
}

function setHealth(value) {
  localHealth = gameMode === 'creative' ? 20 : Math.max(0, Math.min(20, Math.round(value)));
  player.health = localHealth;
  ui.updateHealth(localHealth);
}

function loop(now) {
  requestAnimationFrame(loop);
  if (rendererLost) return;
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;
  fpsCounter += 1;
  if (now - fpsTimer >= 500) {
    fps = Math.round((fpsCounter * 1000) / (now - fpsTimer));
    fpsCounter = 0;
    fpsTimer = now;
  }
  if (now - lastResolutionAdjust >= 2200) {
    visuals.adjustResolution(fps);
    lastResolutionAdjust = now;
  }

  if (gameActive) {
    player.update(dt);
    ui.setSneaking(player.sneaking);
    world.update(player.position);
    ui.updateStreaming(world.workerStats);
    remotes.update(dt);
    if (!multiplayer) worldTime = (worldTime + dt / 1200) % 1;
    if (ui.inventoryOpen) ui.updateTime(worldTime);
    visuals.update(worldTime, player.position, world.farDistance * 16);
    updateTarget();
    updateNetworking(now);
    updateRegeneration(now);
    updateDebug();
  } else {
    ui.updateStreaming(null);
    visuals.update(worldTime, player.position, Math.max(1024, world.farDistance * 16));
  }
  try {
    renderer.render(scene, camera);
  } catch (error) {
    rendererLost = true;
    sessionStorage.setItem('voxel-link-safe-mode', '1');
    globalThis.__voxelLinkShowFailure?.('渲染失败。', error);
    return;
  }
  updateResourceGuard(now);
}

function updateResourceGuard(now) {
  if (!gameActive || now - lastResourceGuard < 1500 || automaticLoadReductions >= 4) return;
  lastResourceGuard = now;
  const triangles = renderer.info.render.triangles || 0;
  world.setPerformanceHint(fps, triangles);
  const geometries = renderer.info.memory.geometries || 0;
  const stats = world.workerStats;
  const lowFps = fps > 0 && fps < 18;
  if (lowFps) {
    if (!lowFpsSince) lowFpsSince = now;
  } else {
    lowFpsSince = 0;
  }

  // Queue depth is expected during progressive streaming and is not itself GPU
  // pressure. Only installed resources and sustained frame loss can downgrade.
  const severePressure = triangles > 7_500_000 || geometries > 1900
    || world.chunks.size > stats.chunkBudget * 1.18 || world.lodTiles.size > stats.lodBudget * 1.18;
  const ordinaryPressure = triangles > 5_200_000 || geometries > 1450
    || world.chunks.size > stats.chunkBudget || world.lodTiles.size > stats.lodBudget;
  if (ordinaryPressure) {
    if (!resourcePressureSince) resourcePressureSince = now;
  } else {
    resourcePressureSince = 0;
  }

  const startupGrace = now - worldStartedAt < 20_000;
  const sustainedLowFps = lowFpsSince && now - lowFpsSince > 8_000;
  const sustainedResourcePressure = resourcePressureSince && now - resourcePressureSince > 7_000;
  const reductionCooldown = now - lastAutomaticReduction >= 20_000;
  if ((startupGrace && !severePressure) || !reductionCooldown) return;
  if (!severePressure && !sustainedLowFps && !sustainedResourcePressure) return;

  const nearSteps = [8, 12, 16, 24, 32, 48, 64];
  const farSteps = [256, 512, 1024, 1536, 2048];
  const nearIndex = nearSteps.indexOf(world.nearDistance);
  const farIndex = farSteps.indexOf(world.farDistance);
  const nextNear = nearSteps[Math.max(0, (nearIndex < 0 ? 2 : nearIndex) - 1)];
  const nextFar = farSteps[Math.max(0, (farIndex < 0 ? 2 : farIndex) - 1)];
  if (!world.setViewDistances(nextNear, nextFar, player.position)) return;
  automaticLoadReductions += 1;
  lastAutomaticReduction = now;
  lowFpsSince = 0;
  resourcePressureSince = 0;
  document.getElementById('near-distance').value = String(nextNear);
  document.getElementById('far-distance').value = String(nextFar);
  camera.far = Math.max(4800, Math.min(46000, nextFar * 16 * 1.24));
  camera.updateProjectionMatrix();
  ui.toast(`检测到持续渲染压力，已渐进调整至近景 ${nextNear} / 远景 ${nextFar}。`, 6000);
}

function updateNetworking(now) {
  if (!multiplayer || !network.ready) return;
  if (now - lastMoveSend >= 100) {
    lastMoveSend = now;
    network.sendMove(
      { x: player.position.x, y: player.position.y, z: player.position.z },
      player.yaw,
      player.pitch,
      player.flying,
    );
  }
  if (now - lastPingSend >= 5000) {
    lastPingSend = now;
    network.ping();
  }
}

function updateRegeneration(now) {
  if (gameMode !== 'survival' || localHealth >= 20 || now - lastDamageAt < 10000 || now - lastHealAt < 2000) return;
  lastHealAt = now;
  if (multiplayer) network.heal();
  else setHealth(localHealth + 1);
}

function updateTarget() {
  lastTarget = getTarget();
  if (lastTarget) {
    outline.visible = true;
    outline.position.set(lastTarget.hit.x + 0.5, lastTarget.hit.y + 0.5, lastTarget.hit.z + 0.5);
    ui.updateTarget(`${BLOCK_NAMES[lastTarget.block]} · ${lastTarget.hit.x}, ${lastTarget.hit.y}, ${lastTarget.hit.z}`);
  } else {
    outline.visible = false;
    ui.updateTarget('');
  }
}

function updateDebug() {
  const cx = Math.floor(player.position.x / 16);
  const cz = Math.floor(player.position.z / 16);
  ui.updateDebug(
    `FPS ${fps} · DPR ${visuals.dynamicPixelRatio.toFixed(2)} · 三角形 ${renderer.info.render.triangles.toLocaleString()}\n`
    + `XYZ ${player.position.x.toFixed(2)} / ${player.position.y.toFixed(2)} / ${player.position.z.toFixed(2)}\n`
    + `区块 ${cx}, ${cz} · 完整体素 ${world.chunks.size} · 体素 LOD ${world.lodTiles.size}\n`
    + `视距 ${world.nearDistance}/${world.farDistance} 区块 · 完整核心 ${world.fullDetailRadius} · 高度 0–255\n`
    + `网格 Worker ${world.workerStats.enabled ? world.workerStats.active : '关闭'} · 排队 ${world.workerStats.queued} · 待上传 ${world.workerStats.ready}\n`
    + `LOD 渐进阶段 ${world.workerStats.lodStage ?? '-'} / ${Math.max(0, world.workerStats.totalStages - 1)} · 预算 ${world.workerStats.chunkBudget}/${world.workerStats.lodBudget}\n`
    + `${gameMode === 'creative' ? `创造${player.flying ? '飞行' : ''}` : '生存'} · ${VISUAL_PRESETS[visualPreset]?.name ?? visualPreset}\n`
    + `${multiplayer ? `Ping ${network.pingMs?.toFixed(0) ?? '?'} ms · 玩家 ${remoteSnapshot.length}` : `单机 · 种子 ${world.seed}`}`,
  );
}

function refreshSaveSummary() {
  const slot = ui.selectedSaveSlot || CLIENT_DEFAULTS.singleplayerSlot || 1;
  ui.updateSaveSlotSummary(slot, loadSaveSlot(slot));
}

function deleteSelectedSave() {
  const slot = ui.selectedSaveSlot;
  const saved = loadSaveSlot(slot);
  if (!saved) return ui.setMenuStatus(`存档 ${slot} 为空。`);
  if (!window.confirm(`确定删除“${saved.name || `世界 ${slot}`}”吗？此操作无法撤销。`)) return;
  deleteSaveSlot(slot);
  refreshSaveSummary();
  ui.setMenuStatus(`已删除存档 ${slot}。`);
}

function scheduleSingleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSingleWorld, 500);
}

function saveSingleWorld() {
  if (!singleSaveSlot || multiplayer) return;
  try {
    const chunks = {};
    for (const [key, map] of world.chunkMods) if (map.size) chunks[key] = Object.fromEntries(map);
    saveSaveSlot(singleSaveSlot, {
      generatorVersion: GENERATOR_VERSION,
      name: singleWorldName || `世界 ${singleSaveSlot}`,
      seed: world.seed,
      time: worldTime,
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
      yaw: player.yaw,
      pitch: player.pitch,
      gameMode,
      health: localHealth,
      inventory: inventory.serialize(),
      chunks,
      createdAt: singleSaveCreatedAt,
    });
  } catch (error) {
    console.warn('单机存档写入失败：', error);
    ui.toast('单机存档写入失败，浏览器存储空间可能不足。');
  }
}

function validName(value) {
  return /^[\p{L}\p{N}_]{2,16}$/u.test(value);
}

function numberSeed(value) {
  if (/^-?\d+$/.test(value)) return Number(value) | 0;
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash | 0;
}
