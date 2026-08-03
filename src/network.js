export const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 800;
const RECONNECT_MAX_DELAY = 8000;
const RECONNECT_JITTER = 400;

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
    this.manualClose = true;
    this._config = null;
    this._reconnectCount = 0;
    this._reconnectTimer = null;
    this.reconnectDelay = (attempt) => Math.min(
      RECONNECT_MAX_DELAY,
      RECONNECT_BASE_DELAY * 2 ** (attempt - 1) + Math.round(Math.random() * RECONNECT_JITTER),
    );
  }

  connect(url, name, password = '', gameMode = 'survival') {
    this.disconnect();
    this._config = { name, password, gameMode };
    this.url = normalizeWsUrl(url);
    this.manualClose = false;
    this._reconnectCount = 0;
    return this._openSession();
  }

  _openSession() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timeout = setTimeout(() => {
        reject(new Error('连接服务器超时。'));
        ws.close();
      }, 10000);

      ws.addEventListener('open', () => {
        this.connected = true;
        this.send({ type: 'hello', name: this._config.name, password: this._config.password, gameMode: this._config.gameMode });
      });
      ws.addEventListener('message', (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'welcome') {
          clearTimeout(timeout);
          this.ready = true;
          this.id = message.id;
          this._reconnectCount = 0;
          resolve(message);
        } else if (message.type === 'reject') {
          clearTimeout(timeout);
          reject(new Error(message.reason || '服务器拒绝连接。'));
          ws.close();
        }
        this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
        this.dispatchEvent(new CustomEvent('message', { detail: message }));
      });
      ws.addEventListener('error', () => {
        if (!this.ready) {
          clearTimeout(timeout);
          reject(new Error('WebSocket 连接失败。请检查地址、WSS 和 FRP 状态。'));
        }
      });
      ws.addEventListener('close', (event) => {
        clearTimeout(timeout);
        if (!this.ready) {
          this.connected = false;
          this.ws = null;
          reject(new Error(`与服务器握手前连接已关闭${event.reason ? `：${event.reason}` : '。'}`));
          return;
        }
        const wasReady = this.ready;
        this.connected = false;
        this.ready = false;
        this.id = null;
        this.ws = null;
        this.dispatchEvent(new CustomEvent('disconnect', { detail: { code: event.code, reason: event.reason, wasReady } }));
        if (wasReady && !this.manualClose) this._scheduleReconnect();
      });
    });
  }

  _scheduleReconnect() {
    if (this.manualClose) return;
    if (this._reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
      this.dispatchEvent(new CustomEvent('reconnect_failed', { detail: { attempts: this._reconnectCount } }));
      return;
    }
    const attempt = this._reconnectCount + 1;
    const delay = Math.max(50, this.reconnectDelay(attempt));
    this.dispatchEvent(new CustomEvent('reconnecting', { detail: { attempt, maxAttempts: MAX_RECONNECT_ATTEMPTS, delay } }));
    this._reconnectTimer = setTimeout(() => this._attemptReconnect(), delay);
  }

  async _attemptReconnect() {
    if (this.manualClose) return;
    this._reconnectCount += 1;
    try {
      const welcome = await this._openSession();
      this.dispatchEvent(new CustomEvent('reconnected', { detail: welcome }));
    } catch {
      if (this.manualClose) return;
      this._scheduleReconnect();
    }
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
    this.manualClose = true;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
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
