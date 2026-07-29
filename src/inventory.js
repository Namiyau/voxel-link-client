import { PLACEABLE_BLOCKS } from '../shared/constants.js';

const STARTER_COUNTS = Object.freeze({
  1: 24,
  2: 32,
  3: 32,
  4: 20,
  5: 16,
  6: 16,
  7: 24,
  8: 12,
});

function normalizedCount(value) {
  return Math.max(0, Math.min(9999, Math.floor(Number(value) || 0)));
}

export class InventoryState extends EventTarget {
  constructor() {
    super();
    this.mode = 'survival';
    this.counts = new Map();
    this.reset('survival');
  }

  reset(mode = 'survival', saved = null) {
    this.mode = mode === 'creative' ? 'creative' : 'survival';
    this.counts.clear();
    const source = saved && typeof saved === 'object' ? saved : STARTER_COUNTS;
    for (const block of PLACEABLE_BLOCKS) this.counts.set(block, normalizedCount(source[block]));
    this._emit();
  }

  setMode(mode) {
    this.mode = mode === 'creative' ? 'creative' : 'survival';
    this._emit();
  }

  count(block) {
    return this.mode === 'creative' ? Infinity : (this.counts.get(Number(block)) || 0);
  }

  canPlace(block, amount = 1) {
    return this.mode === 'creative' || this.count(block) >= amount;
  }

  add(block, amount = 1) {
    block = Number(block);
    if (!PLACEABLE_BLOCKS.includes(block) || this.mode === 'creative') return false;
    this.counts.set(block, normalizedCount(this.count(block) + amount));
    this._emit();
    return true;
  }

  consume(block, amount = 1) {
    block = Number(block);
    if (this.mode === 'creative') return true;
    const current = this.count(block);
    if (!PLACEABLE_BLOCKS.includes(block) || current < amount) return false;
    this.counts.set(block, current - amount);
    this._emit();
    return true;
  }

  serialize() {
    return Object.fromEntries(PLACEABLE_BLOCKS.map((block) => [block, this.counts.get(block) || 0]));
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('change', { detail: { mode: this.mode, counts: this.serialize() } }));
  }
}
