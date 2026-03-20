# Findings

## 架构发现
- 当前 `tools` 由 [server/src/tools/index.ts](server/src/tools/index.ts) 的静态 `TOOL_REGISTRY` 提供。
- 当前 `providers` 由 [server/src/providers/index.ts](server/src/providers/index.ts) 的静态 `switch` 提供。
- 当前 provider 设置页与后端 settings 路由都写死了四家 provider。
- 当前聊天链路与任务链路都直接拉取当前工具集，说明热重载必须引入 snapshot 语义。
- 当前 Pipeline 尚不存在，最稳妥方案是复用 `tasks` / `task_steps` / `tool_calls` / SSE / 记忆写回链路。

## v2 决策
- Phase 1 先做 prompt-only Skills，不提前注册新工具。
- executable skill 只支持 `.js/.mjs`，默认不信任 workspace/user 来源。
- Provider 改造先做 schema 驱动 settings，再做 registry/loader。
- Pipeline MVP 只做 `tool` / `llm` / `gate` / `condition`。
# 研究发现

## Agent 数据结构
- 12 个部门目录：engineering, design, marketing, product, project-management, sales, testing, support, spatial-computing, specialized, game-development, academic
- 每个 agent 是一个 .md 文件
- YAML frontmatter 包含: name, description, color, emoji, vibe
- 正文包含: Identity, Core Mission, Critical Rules, Deliverables, Workflow, Success Metrics

## 部门统计
- Engineering: 23 agents
- Design: 8 agents
- Marketing: 27 agents
- Product: ~5 agents
- Project Management: ~6 agents
- Sales: ~8 agents
- Testing: ~8 agents
- Support: ~6 agents
- Spatial Computing: ~6 agents
- Specialized: ~25 agents
- Game Development: ~20 agents (含子目录)
- Academic: ~5 agents
- **总计: ~147 agents**

## vNext 实施发现
- 当前 `tool-executor.ts` 与 `tools/index.ts` 先前已完成模块化实现，但生产链路没有真正调用；需要把 `runWithTools()` 接到 `agent-runner.ts` 和 `scheduler.ts`
- `retrieveRelevantMemories()` 原先只在测试中发挥作用，真实任务与真实 chat 需要在 prompt 构造前显式注入
- `@xenova/transformers` 在当前 Windows 环境因 `sharp` 下载超时失败，不适合作为本机默认 embedding 实现
- `fastembed` 在当前环境可成功安装，更适合做本地 CPU embedding MVP
- `sqlite-vec` 在本项目里采用 `BLOB + vec_distance_cosine()` 的稳定方案即可，不必强依赖 `vec0` 虚表
- 语义检索若在“尚无任何 indexed memory”时仍尝试初始化 embedding provider，会拖慢编排回归测试；需要先做 indexed memory 短路
