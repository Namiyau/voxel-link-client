const PREFIX = 'voxel-link-save-slot:v3:';
export const MAX_SAVE_SLOTS = 3;

function slotNumber(slot) {
  const value = Number(slot);
  if (!Number.isInteger(value) || value < 1 || value > MAX_SAVE_SLOTS) throw new RangeError('存档槽必须为 1～3');
  return value;
}

export function slotKey(slot) {
  return `${PREFIX}${slotNumber(slot)}`;
}

export function loadSaveSlot(slot) {
  try {
    const parsed = JSON.parse(localStorage.getItem(slotKey(slot)) || 'null');
    if (!parsed || !Number.isInteger(parsed.seed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSaveSlot(slot, data) {
  const value = {
    version: 3,
    slot: slotNumber(slot),
    generatorVersion: Number(data.generatorVersion) || 2,
    name: String(data.name || `世界 ${slot}`).slice(0, 24),
    seed: data.seed | 0,
    time: Number.isFinite(data.time) ? data.time : 0.28,
    position: data.position ?? null,
    yaw: Number(data.yaw) || 0,
    pitch: Number(data.pitch) || 0,
    gameMode: data.gameMode === 'creative' ? 'creative' : 'survival',
    health: Math.max(0, Math.min(20, Number(data.health) || 20)),
    inventory: data.inventory && typeof data.inventory === 'object' ? data.inventory : {},
    chunks: data.chunks && typeof data.chunks === 'object' ? data.chunks : {},
    createdAt: data.createdAt || new Date().toISOString(),
    lastPlayedAt: new Date().toISOString(),
  };
  localStorage.setItem(slotKey(slot), JSON.stringify(value));
  return value;
}

export function deleteSaveSlot(slot) {
  localStorage.removeItem(slotKey(slot));
}

export function listSaveSlots() {
  return Array.from({ length: MAX_SAVE_SLOTS }, (_, index) => ({
    slot: index + 1,
    data: loadSaveSlot(index + 1),
  }));
}
