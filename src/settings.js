const SETTINGS_KEY = 'voxel-link-settings:v1';

export const SETTINGS_DEFAULTS = Object.freeze({
  name: 'Player_1',
  saveSlot: 1,
  nearDistance: 16,
  farDistance: 1024,
  gameMode: 'survival',
  visualPreset: 'soft',
  sensitivity: 1,
});

export function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return { ...SETTINGS_DEFAULTS };
    return { ...SETTINGS_DEFAULTS, ...parsed };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function saveSettings(patch) {
  try {
    const next = { ...loadSettings(), ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadSettings();
  }
}
