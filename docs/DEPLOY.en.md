# Server Deployment Guide

> For the Voxel Link server package (`voxel-link-server-*.zip`, available in this repository's Releases).

## Overview

The server is a standalone Node.js process that provides:

- **`/ws`** — the WebSocket multiplayer endpoint (the main game channel)
- **`/status`** — HTTP health/status check returning JSON (online / players / world / version)
- **World persistence** — edited blocks are auto-saved to the `saves/` directory

The client and server are decoupled: the web client can be hosted on GitHub Pages or any static server; the server only needs to expose `/ws` (and optionally `/status`).

## Prerequisites

- Node.js 20 or later: <https://nodejs.org>

## Install

1. Download `voxel-link-server-v0.6.3.zip` from the repository **Releases** and extract it (e.g. to `D:\voxel-link-server`).
2. On first start `npm install` runs automatically (requires network). You can also run it manually:

   ```powershell
   cd extracted-directory
   npm install
   ```

## Configuration (optional)

The server reads `server-config.json` from its own directory; if the file is missing, built-in defaults are used. Copy the example and edit:

```powershell
copy server-config.example.json server-config.json
```

| Field | Default | Description |
| --- | --- | --- |
| `port` | `3000` | HTTP / WebSocket listening port |
| `host` | `0.0.0.0` | Bind address (default: all interfaces) |
| `maxPlayers` | `4` | Maximum concurrent players |
| `password` | `""` | Join password (leave empty to disable) |
| `activeWorldSlot` | `1` | Which world slot is active (1–3) |
| `worldSlots` | 3 world names | Directory names for the three world slots |
| `dayLengthSeconds` | `1200` | Length of one in-game day (seconds) |
| `allowedOrigins` | `[]` | Browser Origin whitelist (empty array = allow all) |
| `motd` | `Voxel Link` | Server name shown in `/status` and greetings |
| `autosaveSeconds` | `20` | Autosave interval (seconds) |

## Start

Double-click `start-server.bat` (Windows), or run from the package directory:

```powershell
node server.mjs
```

The console prints the local address and WebSocket address on startup. To switch world slots:

```powershell
node tools/select-world.mjs 1
```

or double-click `select-world.bat`.

## Verify

- Visit `http://127.0.0.1:3000/status` in a browser — it should return JSON.
- Enter `ws://127.0.0.1:3000/ws` in the client menu for a local test.

## Public Deployment

### Option A: VPS + reverse proxy (recommended)

1. Run the server on a VPS (listening on port `3000` by default).
2. Put Caddy or nginx in front of it to provide TLS and upgrade `/ws` to `wss://`.

**Caddy example** (automatic HTTPS certificate issuance and renewal):

```
your-domain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Client address: `wss://your-domain.com/ws`.

**nginx example** (requires the `Upgrade` headers):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ""      close;
}
server {
    server_name your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

### Option B: NAT tunneling (development / playing with friends)

Expose `127.0.0.1:3000` with SakuraFrp / FRP; the tunnel node provides the public HTTPS/WSS entry. See **`SAKURAFRP.md`** inside the server package for details.

## Troubleshooting

- **Page is HTTPS but multiplayer won't connect**: HTTPS pages may only connect to `wss://`, never `ws://`.
- **`/status` works but WebSocket fails**: the reverse proxy must support the WebSocket upgrade (see the nginx config above).
- **Disconnected immediately after joining**: check the password, duplicate name, player limit, and `allowedOrigins`.
- **Not reachable from the internet at all**: first visit `http://127.0.0.1:3000/status` on the host machine, then check whether the firewall allows Node.js on that port.
- **Port already in use**: change `port` in `server-config.json`.