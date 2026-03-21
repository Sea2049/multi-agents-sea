# agent-sea Hard Rebrand Design

**Status:** Approved

**Goal:** 将项目从旧品牌彻底切换到 `agent-sea`，覆盖应用内部身份、默认数据库文件名，以及由上游内容生成出的展示文本。

## Scope

- 更新 Windows / Electron 应用身份：
  - `build.appId`
  - `app.setAppUserModelId()`
- 更新默认数据库文件名：
  - Electron 本地数据库路径
  - Server 默认数据库路径
  - 相关测试与文档示例
- 更新生成链路中的旧品牌词：
  - `scripts/generate-agent-content.mjs`
  - `scripts/build-agent-runtime-profiles.mjs`
  - 重新生成 `src/data/agentMarkdown.ts`
  - 重新生成 `shared/agents/runtime-profiles.ts`

## Non-Goals

- 不做旧数据库到新数据库文件名的自动迁移
- 不保留旧 `appId` 的兼容路径
- 不修改 `temp-agency-agents/` 上游镜像仓库内容
- 不对单词级 `Agency` 做全局替换，避免误伤正常语义

## Chosen Approach

### 1. 应用身份直接切换

将安装身份统一切到 `com.agentsea.desktop`。这会让 Windows 将 `agent-sea` 视作新应用，而不是旧安装的延续。由于本次选择的是彻底换新策略，这种行为是符合预期的。

### 2. 默认数据库文件名直接切换

默认数据库文件名从 `agency-agents.db` 切换到 `agent-sea.db`。所有默认路径、示例文档与测试用例统一使用新文件名，不保留 fallback。

### 3. 在生成脚本层做品牌词归一化

上游导入内容中的旧词不直接修改生成产物，也不修改上游源仓库，而是在生成脚本中加入统一的品牌词归一化函数。脚本在读取 markdown 正文后，先做一次明确短语替换，再生成前端与运行时产物。

建议替换仅覆盖高置信度短语：

- `Agency Agents Desktop` -> `agent-sea`
- `Agency Desktop` -> `agent-sea`
- `Agency Agents` -> `agent-sea agents`
- `The Agency repo` -> `agent-sea repo`
- `The Agency` -> `agent-sea`

不做裸 `Agency` 的全局替换，以免污染正常文义。

## Data Flow

1. `temp-agency-agents/` 中的 markdown 被生成脚本读取。
2. 正文在进入 headings / profile 提取前，先经过 `normalizeImportedBranding()`。
3. 归一化后的文本分别写入：
   - `src/data/agentMarkdown.ts`
   - `shared/agents/runtime-profiles.ts`
4. 前端详情页与后端 runtime prompt 消费的均是归一化后的产物。

## Risks

- 修改 `appId` 后，Windows 会把它识别为一个新应用，旧快捷方式和旧通知身份不会沿用。
- 修改默认数据库文件名后，未显式配置 `APP_DB_PATH` 的旧本地数据不会自动出现在新版本中。
- 上游文本中的某些品牌词如果具有特定语义，归一化后可能会略微改变原文表达。

## Validation

- 全局搜索确认旧 `appId` 与默认数据库名不再残留在业务代码和文档中
- 重新生成 `agentMarkdown.ts` 与 `runtime-profiles.ts`
- 运行 `npm run build`
- 必要时检查最近修改文件的 IDE diagnostics
