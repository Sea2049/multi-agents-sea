# 任务计划

## 目标
按 `skill_plugin_architecture_c944c60b.plan.md` 一次执行 Phase 1-Phase 4，将当前硬编码的 Skill / Tool / Provider / Pipeline 架构演进为可扩展、可快照、可渐进启用的插件化体系。

## 阶段追踪
| 阶段 | 状态 | 备注 |
|------|------|------|
| 0-规划 | ✅ | 已确认 v2 可执行计划 |
| 1-分析 | 🔄 | 并行子代理侦察中 |
| 2-组建 | 🔄 | 三路并行：Skill/Tool、Provider、Pipeline |
| 3-执行 | ⏳ | |
| 4-质检 | ⏳ | |
| 5-交付 | ⏳ | |

## 范围界定
- Must-have:
  - Phase 1: prompt-only Skills + gating + watcher + snapshot + UI/API
  - Phase 2: ToolRegistry + builtin tools migration + executable skill MVP
  - Phase 3: provider schema 驱动设置页 + ProviderRegistry + plugin loader
  - Phase 4: pipeline definitions + engine + UI + 复用 task/SSE/memory 链路
- Add-later:
  - loop steps
  - 远程 skill registry / clawhub 类生态
  - 自动下载 CLI / installer flows
  - 不受限的第三方 TypeScript 插件执行

## 团队蓝图
| # | 角色 | 职责 | Cursor Task 配置 | Skill/Type |
|---|---|---|---|---|
| 1 | SkillTool Scout | 侦察 Skill/Tool/快照落点与兼容风险 | `explore`, `readonly: true` | `general-purpose` |
| 2 | Provider Scout | 侦察 settings/provider/schema/secrets 改造面 | `explore`, `readonly: true` | `general-purpose` |
| 3 | Pipeline Scout | 侦察 pipeline 与 tasks/SSE/memory 收敛点 | `explore`, `readonly: true` | `general-purpose` |
| 4 | Main Implementer | 主会话统一落地、整合与验证 | 主代理 | `agent-teams-playbook` |

## Errors Encountered
| 时间 | 阶段 | 错误 | 处理 |
|------|------|------|------|
# 任务计划：agent-sea 桌面可视化程序

## 目标
将 GitHub `agency-agents` 上游项目中的 144+ AI 专家角色制作成 `agent-sea` 可视化桌面应用程序，支持浏览、搜索、组建团队。

## 阶段追踪
| 阶段 | 状态 | 备注 |
|------|------|------|
| 0-规划 | ✅ | 创建计划文件 |
| 1-分析 | ✅ | 分析 agent 数据结构 |
| 2-组建 | ✅ | 使用并行 Agent 拆分数据、UI、Electron、审查任务 |
| 3-执行 | ✅ | 完成桌面 UI、搜索、详情侧栏、Team Builder、Electron 集成 |
| 4-质检 | ✅ | 完成构建验证、Electron 打包、代码复核与安全收口 |
| 5-交付 | ✅ | 生成最终 Windows zip 与 NSIS 安装器分发包 |

## 范围界定
- Must-have:
  - 解析所有 agent markdown 文件
  - 按部门分类展示所有 agents
  - Agent 详情查看
  - 搜索和筛选功能
  - 团队组建器（拖放 agent 组建团队）
  - 桌面应用（Electron）
  - 现代化深色主题 UI
- Add-later:
  - Agent 导出/导入
  - 自定义 agent 创建
  - 团队工作流模拟
  - 多语言支持

## 技术栈
- Vite + React 18 + TypeScript
- Tailwind CSS 4
- Framer Motion 动画
- Electron 桌面包装
- gray-matter 解析 YAML frontmatter

## Errors Encountered
| 时间 | 阶段 | 错误 | 处理 |
|------|------|------|------|
| 2026-03-18 | 3-执行 | `DivisionView.tsx` 仍引用旧的 `onTeamToggle` props | 同步为 `onToggleTeam`，恢复类型检查通过 |
| 2026-03-18 | 4-质检 | Electron 开发态曾提示 5173 端口占用 | 确认为旧开发进程残留，重新启动验证 |
| 2026-03-18 | 4-质检 | 审查发现 Team Builder 统计与安全边界不足 | 增加详情面板、拖放、主导部门排序、CSP 与外链协议白名单 |
| 2026-03-18 | 4-质检 | `react-markdown` 的 `code` 渲染参数类型不匹配 | 调整为兼容写法后重新构建通过 |
| 2026-03-18 | 4-质检 | 品牌资源与 markdown 生成脚本在 Windows 上路径解析失败 | 改为 `fileURLToPath` 标准路径解析 |
| 2026-03-18 | 5-交付 | NSIS 安装器构建时下载 `nsis-3.0.4.1.7z` 超时 | 新增本地 NSIS 缓存启动脚本，使用 `ELECTRON_BUILDER_NSIS_DIR` 成功生成安装器 |

## 2026-03-18 vNext 收敛实施

### 目标
- 补齐 Tool Calling 与 Memory Retrieval 的真实生产接线
- 新增 Docker 沙箱版 `code_exec`
- 交付基于本地 embedding + `sqlite-vec` 的语义记忆检索
- 将任务完成报告自动写入记忆库

### 范围界定
- Must-have:
  - `runWithTools()` 接入 `agent-runner` / `scheduler`
  - `retrieveRelevantMemories()` 进入真实 prompt 构造
  - `code_exec` 工具可安全降级
  - 任务完成后自动写入 `task_report` memory
  - 本地 embedding 两阶段索引 + hybrid retrieval
- Add-later:
  - 远程 MiniMax/OpenAI embedding
  - 更细粒度的 chat streaming with tools
  - `code_exec` 多语言扩展
