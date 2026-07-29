import { buildChunkMeshData, buildLodMeshData, transferableBuffers } from '../shared/mesh-builders.js';

self.addEventListener('message', (event) => {
  const { id, type, payload } = event.data ?? {};
  if (!id || !type) return;
  try {
    const result = type === 'chunk' ? buildChunkMeshData(payload) : buildLodMeshData(payload);
    self.postMessage({ id, ok: true, result }, transferableBuffers(result));
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.stack || error?.message || String(error) });
  }
});
