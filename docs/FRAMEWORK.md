# 项目框架与文档索引

> **发布版本**: V2.2.3 · **文档日期**: 2026-03-21  
> 与仓库当前结构同步，便于快速定位「骨架配置」与说明文档。版本变更见根目录 [CHANGELOG.md](../CHANGELOG.md)。

## 1. 根目录（桌面 + 前端）

| 文件 | 作用 |
|------|------|
| [package.json](../package.json) | 根包名、脚本、Electron Builder 配置 |
| [tsconfig.json](../tsconfig.json) | 前端 TypeScript（React/Vite，`@/*` → `src/*`） |
| [vite.config.ts](../vite.config.ts) | Vite 开发与构建（5173 / 4173） |
| [tailwind.config.js](../tailwind.config.js) | Tailwind 样式 |
| [postcss.config.js](../postcss.config.js) | PostCSS（Tailwind） |
| [index.html](../index.html) | 前端入口 HTML |
| [.gitignore](../.gitignore) | 忽略构建产物、依赖、日志、环境文件等 |
| [.env.example](../.env.example) | 环境变量示例（勿提交真实密钥） |

## 2. Electron 主进程

| 文件 | 作用 |
|------|------|
| [electron/main.js](../electron/main.js) | 窗口、导航、安全存储与 Provider 密钥映射 |
| [electron/server-host.js](../electron/server-host.js) | 内嵌/本地 Fastify 服务生命周期 |

## 3. 后端服务（`server/`）

| 文件 | 作用 |
|------|------|
| [server/package.json](../server/package.json) | 服务端依赖与脚本（build / dev / test） |
| [server/tsconfig.json](../server/tsconfig.json) | Node ESM 编译输出到 `server/dist`，含 `../shared` |
| [server/src/index.ts](../server/src/index.ts) | 服务入口（`APP_PORT` / `APP_DB_PATH`） |
| [server/src/app.ts](../server/src/app.ts) | Fastify 应用组装 |
| [server/src/storage/schema.sql](../server/src/storage/schema.sql) | SQLite 表结构（打包时随 extraResources 复制） |

## 4. 共享与 Agent 资源

| 路径 | 作用 |
|------|------|
| [shared/package.json](../shared/package.json) | 共享包元数据（当前无 npm 依赖，无需单独 `npm install`） |
| [shared/agents/](../shared/agents/) | Agent 目录与运行时 profile 等源数据 |

## 5. 构建与脚本

| 路径 | 作用 |
|------|------|
| [buildResources/](../buildResources/) | 图标、安装器素材；说明见 [buildResources/README.md](../buildResources/README.md) |
| [scripts/generate-brand-assets.mjs](../scripts/generate-brand-assets.mjs) | 生成 `icon.ico`、安装器侧图等 |
| [scripts/generate-agent-content.mjs](../scripts/generate-agent-content.mjs) | 生成前端 Agent 内容 |
| [scripts/build-agent-runtime-profiles.mjs](../scripts/build-agent-runtime-profiles.mjs) | 构建 runtime profiles |

## 6. 日志与输出

| 类型 | 说明 |
|------|------|
| 运行时控制台 | 服务端 `console.log`（如 `[server]`、`[server-host]`）输出到启动终端 |
| 持久化日志文件 | 当前工程**未**统一写入项目内 `.log` 文件；若自行重定向，建议目录 `logs/`（已在 [.gitignore](../.gitignore) 忽略） |
| 测试覆盖率 | `npm run server:test:coverage` 生成 `server/coverage/`（已忽略） |

## 7. 用户文档入口

| 文档 | 说明 |
|------|------|
| [README.md](../README.md) | 项目总览、安装、开发、构建 |
| [docs/FRAMEWORK.md](./FRAMEWORK.md) | 本文：框架文件索引 |
