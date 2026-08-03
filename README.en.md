# Voxel Link

[简体中文](README.md) | **English** | [日本語](README.ja.md)

**In-browser voxel sandbox · Real-time Web multiplayer · Extreme quadtree LOD · Zero build, instant play**

A Web-based voxel platform built for **AI-generated game previews** and **world showcase**: no installation, no build step — copy the static files to any server and it runs. The procedural generator produces vast landscapes with 8+ landmark types; full-detail blocks up close and quadtree macro-voxels in the distance blend seamlessly on screen, and multiplayer runs over WebSocket.

---

## Highlights

| Area | Capability |
| --- | --- |
| Rendering | Three.js driven: full-detail `16×256×16` block meshes up close + quadtree macro-voxel LOD in the distance (view distance up to 2048 chunks) |
| Visuals | Procedural pixel textures, world-space water, custom sky shaders, 6 built-in lighting presets, layered fog |
| Terrain | FBM continents + eroded ridgelines + 8+ landmark types (volcano / mesa / spire / floating island / alp / canyon / basin / shield) + natural / forest / underwater terrain |
| Performance | Web Worker mesh building, quantized buffer transfer, rate-limited GPU uploads, 20-second initialization grace, automatic view-distance reduction with cooldown under sustained load |
| Single-player | 3 localStorage save slots storing seed, position, time, inventory and every block you edit |
| Multiplayer | WebSocket, 10 Hz movement sync, acknowledged block edits with rollback, player list / chat / modes, automatic reconnection |
| Stability | WebGL context-loss recovery, safe-mode rendering fallback, multiple CDN fallbacks, engine localization |

## Quick Start

### Local

```powershell
# Option 1: requires Node.js 20+
Double-click start-client.bat

# Option 2: any static file server
py -m http.server 8080
```

Open `http://127.0.0.1:8080/`. **Do not double-click `index.html` directly** — ES modules and Web Workers require an `http://` origin.

### Play Online

Deployed to GitHub Pages: [namiyau.github.io/voxel-link-client](https://namiyau.github.io/voxel-link-client/)

## Multiplayer

The client only serves the web page and single-player. Multiplayer requires a **separately deployed server**: download the server package from [Releases](../../releases) and follow [docs/DEPLOY.en.md](docs/DEPLOY.en.md).

Once the server is running and reachable publicly, enter the address in the menu (use your own host and `wss`):

```text
wss://your-public-address/ws
```

- The server exposes `/status` (HTTP health/status) and `/ws` (WebSocket).
- The local static server on port 8080 has neither route, so it can never be mistaken for a game server.
- Public deployment: VPS + reverse proxy (Caddy/nginx + TLS) → `wss`; during development, FRP or SakuraFrp tunnels work well.
- Auto-reconnect with exponential backoff (up to 5 attempts), local rollback notice, automatic recovery once connected.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look (sensitivity adjustable in settings) |
| Space | Jump / double-press in Creative to toggle flying |
| Ctrl **or** double-press W | Sprint |
| Shift | Sneak / prevent falling off edges |
| Left / Right click | Break / place blocks |
| Wheel / 1–8 | Select hotbar block |
| E | Inventory / Creative item panel / time control |
| Enter | Chat (Tab shows player list) |
| C | Toggle Survival / Creative |
| F3 | Debug overlay |
| F4 | Cycle lighting presets |
| Esc | Release mouse / pause menu |

## Architecture

```
index.html
├─ src/three-loader.js   Three.js local-first, multiple CDN fallbacks
├─ src/main.js           app assembly, multiplayer messages, resource guard, UI events
├─ src/world.js          full block world + quadtree LOD scheduling, budget, streaming
├─ src/mesh-worker.js    mesh building Worker (1–4 threads by hardware)
├─ shared/               pure functions shared with the Worker
│  ├─ constants.js       block IDs, world parameters
│  ├─ worldgen.js        procedural terrain generation
│  ├─ lod.js             quadtree LOD levels and bandwidth cutting
│  └─ mesh-builders.js   voxel / macro-voxel mesh building
├─ src/visuals.js        lighting presets, sky, dynamic resolution
├─ src/materials.js      procedural pixel textures, continuous water, LOD near-view mask shader
├─ src/settings.js       local settings persistence
└─ vendor/               three.module.min.js (local dependency)
```

The core idea: `shared/` modules run in both the main thread and the Worker; the Worker returns TypedArray meshes (transferable) that the main thread installs at a rate limit. **The old mesh stays visible until the new one is ready, then swaps atomically** — no cracks or flicker while streaming.

## Lighting Presets

| Preset | Description | Load |
| --- | --- | --- |
| Original Pixel | no shadows, no tone mapping, performance first | low |
| Soft Lighting | ACES tone mapping + shadows, recommended default | medium |
| Cinematic High Contrast | maximum contrast and shadows | high |
| Aurora Dream / Sunset Glow / Clear Morning | stylized palettes | medium |

## Saves & Settings

- Single-player saves: 3 slots storing seed, position, time, health, inventory and every edited block (deterministic generator rebuilds untouched areas identically at any time).
- Settings: view distance, lighting, name, game mode, sensitivity and more persist to browser `localStorage` automatically and apply on next launch.

## Versions

| Version | Highlights |
| --- | --- |
| v0.6.4 | Three.js localization (CDN fallbacks), automatic reconnection, explicit handshake errors, loader rename, settings persistence |
| v0.6.3 | staged LOD loading, rate-limited GPU uploads, 20-second init grace, automatic view distance + cooldown |
| v0.6.0 | fixed LOD concentric dark rings, unified water, world-scale textures, irregular complementary LOD edges |

Recommended starting config: near 16 / far 1024 / Soft Lighting. 64 + 2048 is an experimental extreme.

## Roadmap

Other improvements (terrain cache, DDA raycasting, deep links, curated demo seeds, cinematic camera, WebAudio SFX, CI release pipeline…) live in **[PLAN.md](PLAN.md)**.

## License

MIT License. Three.js is an independent open-source component retaining its own license.
