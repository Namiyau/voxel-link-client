import assert from 'node:assert/strict';
import { NetworkClient, MAX_RECONNECT_ATTEMPTS } from '../src/network.js';

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  fire(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ ...event });
  }
  send() {}
  serverOpen() { this.readyState = FakeWebSocket.OPEN; this.fire('open'); }
  serverMessage(obj) { this.fire('message', { data: JSON.stringify(obj) }); }
  serverClose(code = 1006, reason = '') { this.readyState = 3; this.fire('close', { code, reason }); }
  close() { if (this.readyState <= FakeWebSocket.OPEN) this.serverClose(1000, ''); }
}

globalThis.WebSocket = FakeWebSocket;
const welcomeMsg = { type: 'welcome', id: 'p1', seed: 42, spawn: { x: 1, y: 2, z: 3 }, players: [], gameMode: 'survival' };

function latest() { return FakeWebSocket.instances.at(-1); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function once(client, name) {
  return new Promise((resolve) => client.addEventListener(name, (e) => resolve(e.detail ?? {}), { once: true }));
}
async function driveNext(action) {
  const base = FakeWebSocket.instances.length;
  for (let i = 0; i < 200; i += 1) {
    if (FakeWebSocket.instances.length > base) {
      const ws = FakeWebSocket.instances.at(-1);
      action(ws);
      return ws;
    }
    await sleep(1);
  }
  throw new Error('没有出现新的 WebSocket 实例');
}
const openAndWelcome = (ws) => { ws.serverOpen(); ws.serverMessage(welcomeMsg); };
const openThenClose = (ws) => { ws.serverOpen(); ws.serverClose(1007); };
const fast = (client) => { client.reconnectDelay = () => 5; return client; };

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL  ${name}: ${error?.message}`);
  }
}

console.log('test-network:');
await check('welcome 成功：promise 解析并置 ready/id', async () => {
  const client = new NetworkClient();
  const p = client.connect('wss://example.com/ws', 'Alice', '', 'survival');
  const ws = latest();
  ws.serverOpen();
  ws.serverMessage(welcomeMsg);
  const got = await p;
  assert.equal(got.id, 'p1');
  assert.equal(client.ready, true);
  assert.equal(client.id, 'p1');
  client.disconnect();
  assert.equal(FakeWebSocket.instances.length, 1);
});

await check('握手前关闭：connect() 拒绝并说明原因', async () => {
  const client = new NetworkClient();
  const p = client.connect('wss://example.com/ws', 'Bob');
  latest().serverOpen();
  latest().serverClose(1006, 'upstream gone');
  await assert.rejects(p, /握手前连接已关闭：upstream gone/);
  assert.equal(client.ready, false);
  assert.equal(client.ws, null);
});

await check('拒绝消息：connect() 拒绝并显示服务器原因', async () => {
  const client = new NetworkClient();
  const p = client.connect('wss://example.com/ws', 'Bob');
  latest().serverOpen();
  latest().serverMessage({ type: 'reject', reason: '已满员' });
  await assert.rejects(p, /已满员/);
});

await check('断线自动重连：disconnect→reconnecting→reconnected', async () => {
  const client = fast(new NetworkClient());
  const order = [];
  for (const name of ['disconnect', 'reconnecting', 'reconnected', 'reconnect_failed']) {
    client.addEventListener(name, () => order.push(name));
  }
  const p = client.connect('wss://example.com/ws', 'Carol');
  latest().serverOpen();
  latest().serverMessage(welcomeMsg);
  await p;
  const reconnected = once(client, 'reconnected');
  latest().serverClose(1006);
  await once(client, 'reconnecting');
  await driveNext(openAndWelcome);
  await reconnected;
  assert.equal(client.ready, true);
  assert.equal(client.id, 'p1');
  assert.ok(order.includes('disconnect'));
  assert.ok(order.includes('reconnecting'));
  assert.ok(order.includes('reconnected'));
  assert.ok(!order.includes('reconnect_failed'));
  client.disconnect();
});

await check('手动断开：不触发自动重连', async () => {
  const client = new NetworkClient();
  const p = client.connect('wss://example.com/ws', 'D');
  latest().serverOpen();
  latest().serverMessage(welcomeMsg);
  await p;
  const socketsBefore = FakeWebSocket.instances.length;
  client.disconnect();
  await sleep(40);
  assert.equal(FakeWebSocket.instances.length, socketsBefore);
});

await check('首次连接握手前关闭：不会触发重连', async () => {
  const client = new NetworkClient();
  const p = client.connect('wss://example.com/ws', 'F');
  latest().serverOpen();
  latest().serverClose(1006);
  await assert.rejects(p);
  const socketsBefore = FakeWebSocket.instances.length;
  await sleep(40);
  assert.equal(FakeWebSocket.instances.length, socketsBefore);
});

await check(`全部重连失败：${MAX_RECONNECT_ATTEMPTS} 次后触发 reconnect_failed`, async () => {
  const client = fast(new NetworkClient());
  const failed = once(client, 'reconnect_failed');
  const order = [];
  client.addEventListener('reconnecting', (e) => {
    order.push(e.detail.attempt);
    driveNext(openThenClose);
  });
  const p = client.connect('wss://example.com/ws', 'G');
  latest().serverOpen();
  latest().serverMessage(welcomeMsg);
  await p;
  latest().serverClose(1006);
  await failed;
  assert.equal(order.length, MAX_RECONNECT_ATTEMPTS);
  assert.equal(client.ready, false);
  client.disconnect();
});

const failures = results.filter((r) => !r.ok);
if (failures.length) {
  console.error(`\n${failures.length} 项失败。`);
  process.exit(1);
}
console.log(`\n全部 ${results.length} 项通过。`);