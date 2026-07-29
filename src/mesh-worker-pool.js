export class MeshWorkerPool {
  constructor() {
    this.workers = [];
    this.pending = new Map();
    this.sequence = 0;
    this.enabled = typeof Worker === 'function';
    if (!this.enabled) return;
    const cores = Math.max(2, Number(navigator.hardwareConcurrency) || 4);
    const memory = Number(navigator.deviceMemory) || 8;
    const memoryCap = memory <= 4 ? 2 : memory <= 8 ? 3 : 4;
    const count = Math.max(1, Math.min(4, memoryCap, cores - 1));
    try {
      for (let i = 0; i < count; i += 1) {
        const worker = new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module', name: `voxel-mesher-${i + 1}` });
        const entry = { worker, busy: 0 };
        worker.addEventListener('message', (event) => this._resolve(entry, event.data));
        worker.addEventListener('error', (event) => this._failWorker(entry, event));
        this.workers.push(entry);
      }
    } catch (error) {
      console.warn('Mesh worker initialization failed; using main-thread fallback.', error);
      this.dispose();
      this.enabled = false;
    }
  }

  get capacity() { return this.enabled ? this.workers.length : 0; }
  get active() { return this.pending.size; }
  get available() { return Math.max(0, this.capacity - this.active); }

  submit(type, payload) {
    if (!this.enabled || !this.workers.length) return Promise.reject(new Error('worker pool unavailable'));
    const id = `mesh-${++this.sequence}`;
    const entry = [...this.workers].sort((a, b) => a.busy - b.busy)[0];
    entry.busy += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, entry });
      entry.worker.postMessage({ id, type, payload });
    });
  }

  _resolve(entry, message) {
    const task = this.pending.get(message?.id);
    if (!task) return;
    this.pending.delete(message.id);
    entry.busy = Math.max(0, entry.busy - 1);
    if (message.ok) task.resolve(message.result);
    else task.reject(new Error(message.error || 'mesh worker failed'));
  }

  _failWorker(entry, event) {
    const affected = [...this.pending.entries()].filter(([, task]) => task.entry === entry);
    for (const [id, task] of affected) {
      this.pending.delete(id);
      task.reject(new Error(event?.message || 'mesh worker crashed'));
    }
    entry.busy = 0;
  }

  dispose() {
    for (const { worker } of this.workers) worker.terminate();
    for (const task of this.pending.values()) task.reject(new Error('mesh worker pool disposed'));
    this.pending.clear();
    this.workers.length = 0;
  }
}
