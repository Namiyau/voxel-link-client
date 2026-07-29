const SOURCES = [
  'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js',
  'https://unpkg.com/three@0.185.1/build/three.module.js?module',
  'https://esm.sh/three@0.185.1',
];

const loadingText = document.getElementById('loading-text');
const loadingDetails = document.getElementById('loading-details');

function updateStatus(text, details = '') {
  if (loadingText) loadingText.textContent = text;
  if (loadingDetails && details) {
    loadingDetails.textContent = details;
    loadingDetails.classList.remove('hidden');
  }
}

function importWithTimeout(url, timeoutMs = 6000) {
  let timeout;
  return Promise.race([
    import(url),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`加载超时：${url}`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

let namespace = null;
const failures = [];
for (let index = 0; index < SOURCES.length; index += 1) {
  const url = SOURCES[index];
  updateStatus(`正在加载 Three.js 引擎（线路 ${index + 1}/${SOURCES.length}）……`);
  try {
    namespace = await importWithTimeout(url);
    globalThis.__VOXEL_LINK_THREE_SOURCE__ = url;
    break;
  } catch (error) {
    failures.push(`${url}: ${error?.message || error}`);
  }
}

if (!namespace) {
  const details = failures.join('\n');
  updateStatus('Three.js 引擎加载失败。', `${details}\n请检查网络、代理或浏览器扩展，然后点击“重新加载”。`);
  throw new Error(`Three.js 加载失败：\n${details}`);
}

export default namespace;
