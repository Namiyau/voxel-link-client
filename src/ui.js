import { BLOCK_NAMES, PLACEABLE_BLOCKS } from '../shared/constants.js';

const BLOCK_COLORS = {
  1: '#68a94d', 2: '#815d3d', 3: '#85898c', 4: '#dcc780',
  5: '#80552f', 6: '#4a9547', 7: '#b4814d', 8: '#b9e0e8',
};

export class GameUI extends EventTarget {
  constructor() {
    super();
    this.loading = byId('loading');
    this.loadingText = byId('loading-text');
    this.loadingProgress = byId('loading-progress');
    this.menu = byId('menu');
    this.pause = byId('pause');
    this.inventory = byId('inventory');
    this.inventoryGrid = byId('inventory-grid');
    this.inventorySearch = byId('inventory-search');
    this.inventoryTitle = byId('inventory-title');
    this.inventoryDescription = byId('inventory-description');
    this.timeSlider = byId('time-slider');
    this.timeLabel = byId('time-label');
    this.hud = byId('hud');
    this.chat = byId('chat');
    this.chatLog = byId('chat-log');
    this.chatInput = byId('chat-input');
    this.hotbar = byId('hotbar');
    this.hearts = byId('hearts');
    this.debug = byId('debug');
    this.targetLabel = byId('target-label');
    this.connectionBadge = byId('connection-badge');
    this.modeBadge = byId('mode-badge');
    this.visualBadge = byId('visual-badge');
    this.streamBadge = byId('stream-badge');
    this.playerList = byId('player-list');
    this.playerListBody = byId('player-list-body');
    this.toastEl = byId('toast');
    this.saveSlot = byId('save-slot');
    this.saveSlotSummary = byId('save-slot-summary');
    this.selectedSlot = 0;
    this.chatOpen = false;
    this.inventoryOpen = false;
    this.debugVisible = false;
    this.toastTimer = null;
    this.inventoryMode = 'survival';
    this.inventoryCounts = {};
    this._buildHotbar();
    this._bind();
  }

  _buildHotbar() {
    this.hotbar.textContent = '';
    PLACEABLE_BLOCKS.forEach((block, index) => {
      const slot = document.createElement('div');
      slot.className = `hotbar-slot${index === this.selectedSlot ? ' selected' : ''}`;
      slot.dataset.index = String(index);
      slot.innerHTML = `<small>${index + 1}</small><span class="swatch" style="background:${BLOCK_COLORS[block]}"></span><span class="slot-count"></span>`;
      this.hotbar.append(slot);
    });
  }

  _bind() {
    byId('singleplayer-button').addEventListener('click', () => this.dispatchEvent(new Event('singleplayer')));
    byId('delete-save-button').addEventListener('click', () => this.dispatchEvent(new Event('deletesave')));
    this.saveSlot.addEventListener('change', () => this.dispatchEvent(new CustomEvent('saveslotchange', { detail: Number(this.saveSlot.value) })));
    byId('join-button').addEventListener('click', () => this.dispatchEvent(new Event('join')));
    byId('status-button').addEventListener('click', () => this.dispatchEvent(new Event('status')));
    byId('resume-button').addEventListener('click', () => this.dispatchEvent(new Event('resume')));
    byId('leave-button').addEventListener('click', () => this.dispatchEvent(new Event('leave')));
    byId('invite-button').addEventListener('click', () => this.dispatchEvent(new Event('invite')));
    byId('mode-button').addEventListener('click', () => this.dispatchEvent(new Event('modecycle')));
    byId('visual-button').addEventListener('click', () => this.dispatchEvent(new Event('visualcycle')));
    byId('inventory-close').addEventListener('click', () => this.dispatchEvent(new Event('inventorytoggle')));
    this.inventorySearch.addEventListener('input', () => this._renderInventory());
    this.timeSlider.addEventListener('input', () => {
      const value = Number(this.timeSlider.value);
      this.updateTime(value);
      this.dispatchEvent(new CustomEvent('timechange', { detail: value }));
    });
    for (const button of document.querySelectorAll('[data-time]')) {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.time);
        this.updateTime(value);
        this.dispatchEvent(new CustomEvent('timechange', { detail: value }));
      });
    }
    this.chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const text = this.chatInput.value.trim();
        this.chatInput.value = '';
        this.closeChat();
        if (text) this.dispatchEvent(new CustomEvent('chat', { detail: text }));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closeChat();
        this.dispatchEvent(new Event('resume'));
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.code === 'KeyE' && !this.hud.classList.contains('hidden') && event.target !== this.chatInput) {
        event.preventDefault();
        this.dispatchEvent(new Event('inventorytoggle'));
        return;
      }
      if (event.target === this.chatInput || /INPUT|SELECT/.test(event.target?.tagName)) return;
      if (/^Digit[1-8]$/.test(event.code)) this.selectSlot(Number(event.code.slice(-1)) - 1);
      if (event.code === 'KeyF' && event.altKey) return;
      if (event.code === 'F3') { event.preventDefault(); this.debugVisible = !this.debugVisible; }
      if (event.code === 'F4') { event.preventDefault(); this.dispatchEvent(new Event('visualcycle')); }
      if (event.code === 'KeyC' && !this.hud.classList.contains('hidden')) {
        event.preventDefault();
        this.dispatchEvent(new Event('modecycle'));
      }
      if (event.code === 'Tab' && !this.inventoryOpen) { event.preventDefault(); this.playerList.classList.remove('hidden'); }
      if (event.code === 'Enter' && !this.menu.classList.contains('hidden')) return;
      if (event.code === 'Enter' && !this.chatOpen && !this.inventoryOpen && !this.hud.classList.contains('hidden')) {
        event.preventDefault();
        this.openChat();
        this.dispatchEvent(new Event('chatopen'));
      }
    });
    document.addEventListener('keyup', (event) => {
      if (event.code === 'Tab') this.playerList.classList.add('hidden');
    });
    window.addEventListener('wheel', (event) => {
      if (this.hud.classList.contains('hidden') || this.inventoryOpen) return;
      this.selectSlot((this.selectedSlot + (event.deltaY > 0 ? 1 : -1) + 8) % 8);
    }, { passive: true });
  }

  values() {
    return {
      name: byId('player-name').value.trim(),
      saveSlot: Number(byId('save-slot').value),
      worldName: byId('world-name').value.trim(),
      seed: byId('seed-input').value.trim(),
      server: byId('server-address').value.trim(),
      password: byId('server-password').value,
      nearDistance: Number(byId('near-distance').value),
      farDistance: Number(byId('far-distance').value),
      gameMode: byId('game-mode').value,
      visualPreset: byId('visual-preset').value,
    };
  }

  setDefaults({ nearDistance, farDistance, gameMode, visualPreset, singleplayerSlot = 1 }) {
    byId('near-distance').value = String(nearDistance);
    byId('far-distance').value = String(farDistance);
    byId('game-mode').value = gameMode;
    byId('visual-preset').value = visualPreset;
    byId('save-slot').value = String(singleplayerSlot);
  }

  updateSaveSlotSummary(slot, data) {
    if (!data) {
      this.saveSlotSummary.classList.add('empty');
      this.saveSlotSummary.innerHTML = `<strong>存档 ${slot} · 空</strong><br>输入世界名称和可选种子后即可创建。`;
      return;
    }
    this.saveSlotSummary.classList.remove('empty');
    const date = data.lastPlayedAt ? new Date(data.lastPlayedAt).toLocaleString('zh-CN') : '未知';
    this.saveSlotSummary.innerHTML = `<strong>${escapeHtml(data.name || `世界 ${slot}`)}</strong><br>种子 ${data.seed} · ${data.gameMode === 'creative' ? '创造' : '生存'} · 最后游玩 ${escapeHtml(date)}`;
    byId('world-name').value = data.name || `世界 ${slot}`;
  }

  get selectedSaveSlot() { return Number(this.saveSlot.value); }
  setServerAddress(value) { byId('server-address').value = value; }
  get serverAddress() { return byId('server-address').value.trim(); }
  setLoading(text, progress = null) {
    this.loadingText.textContent = text;
    if (progress !== null) this.loadingProgress.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }
  hideLoading() { this.loading.classList.add('hidden'); this.menu.classList.remove('hidden'); }
  showMenu() {
    this.menu.classList.remove('hidden'); this.pause.classList.add('hidden'); this.hud.classList.add('hidden');
    this.inventory.classList.add('hidden'); this.inventoryOpen = false;
    this.chat.classList.add('hidden'); this.playerList.classList.add('hidden');
  }
  startGame(modeText) {
    this.menu.classList.add('hidden'); this.pause.classList.add('hidden'); this.hud.classList.remove('hidden');
    this.inventory.classList.add('hidden'); this.inventoryOpen = false;
    this.connectionBadge.textContent = modeText;
  }
  showPause() { if (!this.inventoryOpen) this.pause.classList.remove('hidden'); }
  hidePause() { this.pause.classList.add('hidden'); }
  setMenuStatus(text, error = false) { const el = byId('menu-status'); el.textContent = text; el.style.color = error ? '#ff8c8c' : ''; }
  setPauseStatus(text) { byId('pause-status').textContent = text; }

  selectSlot(index) {
    this.selectedSlot = ((index % 8) + 8) % 8;
    [...this.hotbar.children].forEach((slot, i) => slot.classList.toggle('selected', i === this.selectedSlot));
    this.targetLabel.textContent = BLOCK_NAMES[this.selectedBlock];
    this._renderInventory();
  }
  get selectedBlock() { return PLACEABLE_BLOCKS[this.selectedSlot]; }

  updateInventory(mode, counts) {
    this.inventoryMode = mode === 'creative' ? 'creative' : 'survival';
    this.inventoryCounts = counts || {};
    [...this.hotbar.children].forEach((slot, index) => {
      const block = PLACEABLE_BLOCKS[index];
      const count = slot.querySelector('.slot-count');
      count.textContent = this.inventoryMode === 'creative' ? '∞' : String(this.inventoryCounts[block] || 0);
      slot.classList.toggle('empty', this.inventoryMode !== 'creative' && !(this.inventoryCounts[block] > 0));
    });
    this._renderInventory();
  }

  _renderInventory() {
    if (!this.inventoryGrid) return;
    const query = this.inventorySearch.value.trim().toLowerCase();
    this.inventoryTitle.textContent = this.inventoryMode === 'creative' ? '创造物品' : '生存背包';
    this.inventoryDescription.textContent = this.inventoryMode === 'creative'
      ? '全部方块无限使用；点击物品即可选中对应快捷栏。'
      : '挖掘方块会收入背包，放置方块会消耗库存。';
    this.inventoryGrid.textContent = '';
    PLACEABLE_BLOCKS.forEach((block, index) => {
      const name = BLOCK_NAMES[block];
      if (query && !name.toLowerCase().includes(query)) return;
      const count = this.inventoryMode === 'creative' ? Infinity : (this.inventoryCounts[block] || 0);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `inventory-item${index === this.selectedSlot ? ' selected' : ''}${count <= 0 ? ' empty' : ''}`;
      button.innerHTML = `<span class="item-swatch" style="background:${BLOCK_COLORS[block]}"></span><span class="item-name">${escapeHtml(name)}</span><span class="item-count">${count === Infinity ? '∞' : count}</span>`;
      button.addEventListener('click', () => {
        this.selectSlot(index);
        this.dispatchEvent(new CustomEvent('inventoryselect', { detail: { index, block } }));
      });
      this.inventoryGrid.append(button);
    });
  }

  openInventory(mode, counts, time) {
    this.inventoryOpen = true;
    this.pause.classList.add('hidden');
    this.inventory.classList.remove('hidden');
    this.updateInventory(mode, counts);
    this.updateTime(time);
    this.inventorySearch.value = '';
    this._renderInventory();
  }
  closeInventory() { this.inventoryOpen = false; this.inventory.classList.add('hidden'); }

  updateTime(value) {
    const wrapped = ((Number(value) || 0) % 1 + 1) % 1;
    this.timeSlider.value = String(wrapped);
    const totalMinutes = Math.floor(wrapped * 24 * 60);
    const hour = Math.floor(totalMinutes / 60) % 24;
    const minute = totalMinutes % 60;
    this.timeLabel.textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  setSneaking(value) { this.hud.classList.toggle('sneaking', Boolean(value)); }

  updateHealth(health) {
    this.hearts.textContent = '';
    for (let i = 0; i < 10; i += 1) {
      const heart = document.createElement('span');
      heart.className = 'heart';
      heart.textContent = '♥';
      if (health >= i * 2 + 2) heart.classList.add('full');
      else if (health === i * 2 + 1) heart.classList.add('half');
      this.hearts.append(heart);
    }
  }

  updateGameMode(mode, flying = false) {
    const creative = mode === 'creative';
    this.hud.classList.toggle('creative', creative);
    this.modeBadge.textContent = creative ? `创造${flying ? ' · 飞行' : ''}` : '生存';
  }

  updateVisual(name) { this.visualBadge.textContent = name; }
  updateStreaming(stats) {
    if (!stats?.streaming) {
      this.streamBadge.classList.add('hidden');
      return;
    }
    const pass = Math.max(1, Number(stats.lodStagePass) || 1);
    const passes = Math.max(pass, Number(stats.lodStageCount) || pass);
    const remaining = Math.max(0, (Number(stats.queued) || 0) + (Number(stats.ready) || 0) + (Number(stats.active) || 0));
    this.streamBadge.textContent = `远景细化 ${pass}/${passes} · 网格 ${remaining}`;
    this.streamBadge.classList.remove('hidden');
  }
  openChat() { this.chatOpen = true; this.chat.classList.remove('hidden'); this.chatInput.focus(); }
  closeChat() { this.chatOpen = false; this.chatInput.blur(); this.chat.classList.add('hidden'); }
  addChat(text, system = false) {
    this.chat.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = `chat-line${system ? ' chat-system' : ''}`;
    line.textContent = text;
    this.chatLog.append(line);
    while (this.chatLog.children.length > 12) this.chatLog.firstElementChild.remove();
    setTimeout(() => { if (!this.chatOpen) this.chat.classList.add('hidden'); }, 7000);
  }

  updatePlayerList(players) {
    this.playerListBody.textContent = '';
    for (const player of players) {
      const row = document.createElement('div');
      row.className = 'player-row';
      const mode = player.gameMode === 'creative' ? '创造' : '生存';
      const status = player.gameMode === 'creative' ? `${mode}${player.flying ? ' · 飞行' : ''}` : `${Math.ceil((player.health ?? 20) / 2)} ♥ · ${mode}`;
      row.innerHTML = `<span>${escapeHtml(player.name)}</span><span>${status}</span>`;
      this.playerListBody.append(row);
    }
  }

  updateDebug(text) { this.debug.textContent = this.debugVisible ? text : ''; }
  updateTarget(text) { this.targetLabel.textContent = text || BLOCK_NAMES[this.selectedBlock]; }
  toast(text, duration = 2800) {
    clearTimeout(this.toastTimer);
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), duration);
  }
}

function byId(id) { return document.getElementById(id); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]); }
