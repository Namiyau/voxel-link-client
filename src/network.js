export class NetworkClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.ready = false;
    this.url = '';
    this.lastPing = 0;
    this.pingMs = null;
  }

  connect(url, name, password = '', gameMode = 'survival') {
    this.disconnect();
    this.url = normalizeWsUrl(url);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timeout = setTimeout(() => {
        reject(new Error('连接服务器超时。'));
        ws.close();
      }, 10000);
      ws.addEventListener('open', () => {
        this.connected = true;
        this.send({ type: 'hello', name, password, gameMode });
      });
      ws.addEventListener('message', (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'welcome') {
          clearTimeout(timeout);
          this.ready = true;
          this.id = message.id;
          resolve(message);
        } else if (message.type === 'reject') {
          clearTimeout(timeout);
          reject(new Error(message.reason || '服务器拒绝连接。'));
        } else if (message.type === 'pong') {
          this.pingMs = Math.max(0, performance.now() - this.lastPing);
        }
        this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
        this.dispatchEvent(new CustomEvent('message', { detail: message }));
      });
      ws.addEventListener('close', (event) => {
        clearTimeout(timeout);
        const wasReady = this.ready;
        this.connected = false;
        this.ready = false;
        this.dispatchEvent(new CustomEvent('disconnect', { detail: { code: event.code, reason: event.reason, wasReady } }));
      });
      ws.addEventListener('error', () => {
        if (!this.ready) reject(new Error('WebSocket 连接失败。请检查地址、WSS 和 FRP 状态。'));
      });
    });
  }

  send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  requestChunks(chunks) { if (chunks.length) this.send({ type: 'chunk_request', chunks }); }
  setBlock(x, y, z, block) { this.send({ type: 'block_set', x, y, z, block }); }
  sendMove(position, yaw, pitch, flying = false) { this.send({ type: 'move', position, yaw, pitch, flying }); }
  setGameMode(gameMode) { this.send({ type: 'game_mode', gameMode }); }
  setTime(time) { this.send({ type: 'set_time', time }); }
  chat(text) { this.send({ type: 'chat', text }); }
  damage(amount, reason) { this.send({ type: 'damage', amount, reason }); }
  heal() { this.send({ type: 'heal' }); }
  ping() { this.lastPing = performance.now(); this.send({ type: 'ping', at: Date.now() }); }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = null;
    this.connected = false;
    this.ready = false;
    this.id = null;
  }
}

export function normalizeWsUrl(value) {
  let url = String(value || '').trim();
  if (!url) throw new Error('请输入服务器地址。');
  if (/^https?:\/\//i.test(url)) url = url.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(url)) url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${url}`;
  const parsed = new URL(url);
  if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/ws';
  return parsed.toString();
}
