# 开发计划（未实施项）

> 状态说明：已完成项见 README 版本历史；本文只登记**尚未实施**的改进，可作为后续迭代的路线图。
> 状态标记：`[ ] 待办` / `[x] 已完成`

## 一、性能优化

- [ ] **地形信息缓存（改动最小、收益最大）**
  `world.getBlock()` → `getGeneratedBlock()` → `terrainInfo()`（每次 3~5 次 FBM）是碰撞检测 `player.js:241` 与射线 `world.js:910` 的每帧热路径。因为世界生成是确定性的，可在主线程按 `(seed, cx, cz)` 做高度表 LRU 缓存（上限约 256 项），把这两处成本降一个数量级。
- [ ] **DDA 体素射线** 替换 `world.js:910` 的等步长采样（0.04 步、创造模式 12 格 = 300 次采块）。改用 Amanatides & Woo 算法：精确、防穿透、每步只查穿过的方块。
- [ ] **方块编辑的 LOD 失效索引** `world.js:375 invalidateLodAt()` 当前线性遍历全部 `lodSpecs`；2048 视距下节点数千。编辑不频繁可接受，但建议加粗粒度空间索引。
- [ ] **删除死代码** `shared/mesh-builders.js` 中 `buildChunkMeshData` 的 `water` 目标数组永远为空（水面由整个世界空间平面渲染，见 `world.js:20`）。可删除 `water` 相关分支。
- [ ] **`queueChunkBuild` 线性查找** `world.js:213` 用 `chunkQueue.find()` 判重，规模大时可用 `queuedChunkKeys` Set 直接判重。

## 2、工程化与发布

- [ ] **Node 测试集成** 建立 `package.json`：
  - `"test"`: 组合 `tools/test-network.mjs` + shared 模块断言（lod/worldgen/movement/constants）
  - `"serve": "node tools/serve-client.mjs . 8080"`
  - engines 声明 `node >= 20`
- [ ] **GitHub Actions 发布流水线** push tag 时自动：跑测试 → 打包 zip → 创建 Release → 部署 GitHub Pages。替换手动上传（当前 Pages 部署依赖手动把包拆到仓库根目录）。
- [ ] **Lint 与格式化** 配置 ESLint（或不依赖配置的 `biome check`），纳入 CI。
- [ ] **HTTP 安全响应头** `tools/serve-client.mjs` 增加 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。

## 3、展示与演示（面向"AI 游戏预览 + 地图展示"定位）

- [ ] **深链直达** 支持 `?seed=&time=&preset=&near=&far=`，打开 URL 直接进入世界，方便分享/演示。
- [ ] **精选演示种子** 在菜单加入"演示种子"快捷列表，一键展示火山、浮岛、峡谷等地标。
- [ ] **漫游相机** 可循环的航拍路径（绕地标飞行），免手操演示。
- [ ] **截图导出** `renderer.domElement.toBlob` 导出 PNG，按钮 + F 快捷键。

## 4、功能与体验

- [ ] **WebAudio 音效** 合成挖掘/放置/跳跃音（无资源文件、零依赖）。
- [ ] **灵敏度/其他设置 UI** 设置页持久化已就绪（`src/settings.js`），补充 UI 控件调节灵敏度、FOV 等。
- [ ] **移动端触控** PointerLock 在 iOS 不可用，视定位决定是否投入；至少保证暂停菜单可触屏操作。
- [ ] **心跳保活** 联机已有 5s ping；可加 WebSocket 层 keepalive 检测半开连接。

## 附：已完成的架构修复（时间线）

| 版本 | 要点 |
| --- | --- |
| 0.6.0 | 消除 LOD 层垂直/深度差、同心暗环；统一水面；固定世界尺度纹理；不规则互补 LOD 边缘 |
| 0.6.3 | LOD 分阶段加载、GPU 上传限速、初始化 20s 免降级、自动视距冷却、失焦清键 |
| 0.6.4 | Three.js 本地化（CDN 兜底）；断线自动重连（退避+事件）；握手前关闭明确报错；重命名加载器；设置持久化；文档修正 |