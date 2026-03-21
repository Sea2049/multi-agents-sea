# Agency Agents Desktop

> 一个用于浏览、搜索和编排 Agency Agents（144+ AI 专家角色）的桌面可视化应用程序

**当前版本**: 1.0.3 · **文档更新**: 2026-03-21 · **[变更日志](CHANGELOG.md)**

## 📚 框架与文档索引

- **[docs/FRAMEWORK.md](docs/FRAMEWORK.md)**：框架文件、配置、脚本与日志说明的一站式索引（推荐新成员先看）
- **[CHANGELOG.md](CHANGELOG.md)**：版本与变更记录
- **[buildResources/README.md](buildResources/README.md)**：品牌化资源与 `npm run brand:assets` 说明
- **环境变量示例**：[.env.example](.env.example)（复制为 `.env` 使用，勿提交密钥）

## 📋 项目简介

Agency Agents Desktop 是一个基于 Electron 的桌面应用程序，提供了一个直观的可视化界面来管理和使用 Agency Agents 生态系统中的 144+ 个 AI 专家角色。这些角色分布在 12 个专业部门中，涵盖工程、设计、营销、产品、项目管理、测试、支持、空间计算、专业领域、游戏开发、学术等多个领域。

## 🏗️ 项目架构

### 技术栈

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **UI 库**: Framer Motion + Lucide React
- **桌面框架**: Electron 30
- **后端框架**: Fastify 4
- **数据库**: SQLite (better-sqlite3)
- **向量搜索**: sqlite-vec + fastembed
- **样式**: Tailwind CSS

### 项目结构

```
multi-agents-sea/
├── src/                    # 前端源代码
│   ├── lib/               # 工具库和 API 客户端
│   └── ...
├── server/                 # 后端服务器
│   ├── src/
│   │   ├── app.ts         # Fastify 应用配置
│   │   ├── index.ts       # 服务器入口
│   │   ├── storage/        # 数据库存储层
│   │   ├── providers/     # AI 提供商集成
│   │   ├── tools/         # 工具注册表
│   │   └── skills/        # 技能系统
│   └── package.json
├── shared/                 # 共享模块
│   └── agents/            # Agent 目录和分类
├── electron/               # Electron 主进程
│   ├── main.js            # 主进程入口
│   └── server-host.js     # 本地服务器管理
├── buildResources/        # 构建资源（图标、安装器等）
├── dist/                  # 构建输出目录
├── release/               # 打包输出目录
└── package.json           # 根项目配置
```

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

### 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装服务器依赖
npm install --prefix server

# shared/ 当前无 npm 依赖，一般无需执行 npm install --prefix shared
```

### 开发模式

```bash
# 启动开发服务器（前端 + Electron）
npm run electron:dev

# 或者分别启动
npm run dev              # 仅启动前端开发服务器
npm run --prefix server dev  # 仅启动后端服务器
```

### 构建

```bash
# 构建前端
npm run build

# 构建服务器
npm run server:build

# 构建 Electron 应用（ZIP 包）
npm run electron:build

# 构建安装器（NSIS）
npm run electron:build:installer
```

## 📦 功能特性

### 核心功能

- **Agent 浏览**: 按部门浏览 144+ 个 AI 专家角色
- **智能搜索**: 基于向量搜索的语义检索
- **团队组建**: 选择和组合多个 Agent 形成协作团队
- **会话管理**: 与 Agent 进行对话和任务协作
- **任务追踪**: 跟踪和管理多步骤任务执行
- **技能系统**: 支持 prompt-only 和可执行技能
- **提供商管理**: 支持多个 AI 提供商（OpenAI, Anthropic, Ollama, Minimax 等）

### 数据存储

- **SQLite 数据库**: 本地存储会话、消息、任务等数据
- **向量搜索**: 使用 sqlite-vec 实现 Agent 语义搜索
- **安全存储**: 使用 Electron safeStorage 加密存储 API 密钥

## 🔧 配置

### 环境变量

完整示例见 [.env.example](.env.example)。常用项：

- `APP_PORT`: 服务器端口（默认: 3701）
- `APP_DB_PATH`: 数据库文件路径（默认: 当前工作目录下 `agency-agents.db`）
- `VITE_DEV_SERVER_URL` / `ELECTRON_DISABLE_DEVTOOLS`: Electron 开发行为（见 `.env.example`）

### 日志

- 开发/运行时日志主要输出到**启动应用的终端**（如 `[server]`、`[server-host]`）。
- 项目未强制写入磁盘日志；若自行重定向，建议使用 `logs/` 目录（已在 `.gitignore` 中忽略）。

### Provider 配置

应用支持通过 UI 界面配置以下 AI 提供商：

- **OpenAI**: GPT-4, GPT-3.5 等
- **Anthropic**: Claude 系列模型
- **Ollama**: 本地模型服务
- **Minimax**: 自定义 API 端点

所有 API 密钥通过 Electron safeStorage 安全存储。

## 📝 开发指南

### 代码规范

- 使用 TypeScript 严格模式
- 遵循 ESLint 规则（如果配置）
- 组件使用函数式组件和 Hooks
- API 客户端统一使用 `src/lib/api-client.ts`

### 测试

```bash
# 运行服务器测试
npm run server:test

# 运行测试并生成覆盖率报告
npm run server:test:coverage
```

### 项目脚本

| 脚本 | 说明 |
|------|------|
| `dev` | 启动前端开发服务器 |
| `prebuild` | 构建前自动生成 Agent 内容与 runtime profiles |
| `generate:agent-content` | 生成前端 Agent 内容 |
| `build:profiles` | 构建 Agent runtime profiles |
| `build` | 构建前端生产版本（含 prebuild） |
| `electron:dev` | 启动 Electron 开发模式 |
| `electron:build` | 构建 Electron 应用（ZIP） |
| `electron:build:installer` | 构建 Windows 安装器 |
| `server:build` | 构建后端服务器 |
| `server:test` | 运行服务器测试 |
| `server:test:coverage` | 服务器测试 + 覆盖率（输出到 `server/coverage/`，已 gitignore） |
| `brand:assets` | 生成品牌资源（图标等） |
| `preview` | 预览 Vite 生产构建 |

## 📄 许可证

MIT License

Copyright © 2026 BOB

## 👤 作者

BOB

## 🔗 相关资源

- [Agency Agents 项目](https://github.com/agency-agents) - 原始 Agent 定义仓库
- [Electron 文档](https://www.electronjs.org/docs)
- [Fastify 文档](https://www.fastify.io/docs/latest/)

---

**注意**: 这是一个活跃开发中的项目，API 和功能可能会发生变化。
