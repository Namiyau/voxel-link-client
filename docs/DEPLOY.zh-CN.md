# 服务端部署指南

> 适用于 Voxel Link 服务端安装包（`voxel-link-server-*.zip`，见仓库 Releases）。

## 简介

服务端是独立的 Node.js 进程，提供：

- **`/ws`** —— WebSocket 联机端点（游戏主通道）
- **`/status`** —— HTTP 状态检查，返回 JSON（在线 / 人数 / 世界 / 版本）
- **世界持久化** —— 玩家修改的方块自动保存到 `saves/` 目录

客户端与服务器是解耦的：网页客户端可以托管在 GitHub Pages 或任意静态服务器；服务端只需对外暴露 `/ws`（及可选的 `/status`）。

## 前置要求

- Node.js 20 或更高版本：<https://nodejs.org>

## 安装

1. 从仓库 **Releases** 下载 `voxel-link-server-v0.6.3.zip` 并解压（例如到 `D:\voxel-link-server`）。
2. 首次启动会自动执行 `npm install`（需联网）；也可以手动执行：

   ```powershell
   cd 解压目录
   npm install
   ```

## 配置（可选）

服务端读取同目录的 `server-config.json`；文件不存在时使用内置默认值。可复制示例后修改：

```powershell
copy server-config.example.json server-config.json
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `port` | `3000` | HTTP / WebSocket 监听端口 |
| `host` | `0.0.0.0` | 监听地址（默认全部网卡） |
| `maxPlayers` | `4` | 最大同时在线人数 |
| `password` | `""` | 加入密码（留空则不要求） |
| `activeWorldSlot` | `1` | 当前使用哪个世界槽（1–3） |
| `worldSlots` | 3 个世界的名称 | 三个世界槽目录名 |
| `dayLengthSeconds` | `1200` | 一天的秒数（游戏时间） |
| `allowedOrigins` | `[]` | 浏览器 Origin 白名单（空数组 = 允许全部） |
| `motd` | `Voxelog Link` | 显示在 `/status` 与欢迎语中的服务名 |
| `autosaveSeconds` | `20` | 自动保存间隔（秒） |

## 启动

双击 `start-server.bat`（Windows），或在该目录命令行执行：

```powershell
node server.mjs
```

启动后控制台会打印本地地址与 WebSocket 地址。切换世界槽：

```powershell
node tools/select-world.mjs 1
```

或双击 `select-world.bat`。

## 验证

- 本机浏览器访问 `http://127.0.0.1:3000/status`，应返回 JSON。
- 客户端菜单填写 `ws://127.0.0.1:3000/ws` 可本机联机测试。

## 公网部署

### 方式 A：VPS + 反向代理（推荐）

1. 在 VPS 上运行服务端（默认监听 `3000`）。
2. 用 Caddy 或 nginx 提供 TLS，把 `/ws` 升级为 `wss://`。

**Caddy 示例**（自动申请并续期 HTTPS）：

```
your-domain.com {
    reverse_proxy 127.0.0.1:3000
}
```

客户端填写：`wss://your-domain.com/ws`。

**nginx 示例**（关键：需要 `Upgrade` 头）：

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

### 方式 B：内网穿透（开发 / 朋友联机）

用 SakuraFrp / FRP 把 `127.0.0.1:3000` 暴露到公网，公网入口由节点提供 HTTPS/WSS。详细步骤见服务端包内 **`SAKURAFRP.md`**。

## 常见问题

- **网页是 HTTPS 但联机连不上**：HTTPS 页面只能连 `wss://`，不能连 `ws://`。
- **`/status` 能访问但 WebSocket 失败**：反向代理需支持 WebSocket 升级（见上方 nginx 配置）。
- **连接后立刻断开**：检查密码、重名、人数上限，以及 `allowedOrigins`。
- **外网完全打不开**：先在宿主机访问 `http://127.0.0.1:3000/status`，再排查防火墙是否放行 Node.js 的端口。
- **端口被占用**：修改 `server-config.json` 的 `port`。