# Changelog

本仓库遵循 [语义化版本](https://semver.org/lang/zh-CN/)（SemVer）。未发布项写在 **Unreleased**。

## [2.2.3] - 2026-03-21

### 文档更新与版本固化

- 将发布版本固化为 **V2.2.3**（包管理版本为 `2.2.3`）
- 更新 [README.md](README.md)、[docs/FRAMEWORK.md](docs/FRAMEWORK.md)、[buildResources/README.md](buildResources/README.md) 的版本标识
- 同步根包、`server/`、`shared/` 的 `package.json` 与根 / `server/` 的 `package-lock.json` 顶部版本到 `2.2.3`

## [2.2.2] - 2026-03-21

### 文档更新与版本固化

- 将发布版本固化为 **V2.2.2**（包管理版本为 `2.2.2`）
- 更新 [README.md](README.md) 顶部版本标识为 `V2.2.2`
- 更新 [docs/FRAMEWORK.md](docs/FRAMEWORK.md) 发布版本标识为 `V2.2.2`
- 更新 [buildResources/README.md](buildResources/README.md) 的同步版本标识为 `V2.2.2`
- 同步根包、`server/`、`shared/` 的 `package.json` 版本到 `2.2.2`
- 同步根与 `server/` 的 `package-lock.json` 顶部版本到 `2.2.2`

## [1.0.3] - 2026-03-21

### 发布提醒

- Windows 会将 `agent-sea` 识别为一个新应用，因为 `appId` / `AppUserModelId` 已切换为 `com.agentsea.desktop`
- 默认本地数据库文件已切换为 `agent-sea.db`，旧的 `agency-agents.db` 不会自动迁移

### 文档一致性固化

- 全量校对并刷新文档中的版本标识，统一到 **1.0.3**
- 更新 [README.md](README.md) 顶部版本与文档状态
- 更新 [docs/FRAMEWORK.md](docs/FRAMEWORK.md) 发布版本标识
- 更新 [buildResources/README.md](buildResources/README.md) 同步版本标识
- 同步根包与 `server/`、`shared/` 版本到 **1.0.3**

## [1.0.2] - 2026-03-21

### 发布

- 根包、`server/`、`shared/` 版本统一为 **1.0.2**
- 生产构建产物：Windows x64 便携 ZIP（`npm run electron:build` → `release/`）

## [1.0.1] - 2026-03-21

### 文档与工程卫生

- 新增 [docs/FRAMEWORK.md](docs/FRAMEWORK.md)：框架文件、配置与脚本索引
- 新增 [.env.example](.env.example)：环境变量示例
- 更新 [README.md](README.md)：框架索引、日志说明、完整 npm scripts、`shared` 安装说明
- 更新 [buildResources/README.md](buildResources/README.md)：与主文档交叉引用
- 更新 [.gitignore](.gitignore)：`logs/`、`server/coverage/`、本地 SQLite 与常见编辑器目录

### 版本

- 根包、`server/`、`shared/` 的 `package.json` 版本统一为 **1.0.1**

## [1.0.0] - 2026-03-21

### 初始基线

- agent-sea 桌面应用（Electron + React/Vite + Fastify 后端）可构建与开发流程确立；此前未维护独立变更日志，本条目作为文档化起点。

---

<!-- 若仓库已挂远程，可在此添加版本对比链接（例如 GitHub compare / release） -->
