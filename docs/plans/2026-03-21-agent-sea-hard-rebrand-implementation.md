# agent-sea Hard Rebrand Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `agent-sea` 的内部应用身份、默认数据库文件名和上游导入内容中的品牌词统一切换到新品牌。

**Architecture:** 直接切换安装身份与默认数据库文件名，不保留兼容路径；对上游导入内容采用“脚本归一化、产物重建”的方式，避免手改生成文件或污染上游镜像仓库。所有验证以全局搜索与一次完整构建为准。

**Tech Stack:** Electron, Node.js, TypeScript, Vite, npm scripts

---

### Task 1: 切换应用内部身份

**Files:**
- Modify: `package.json`
- Modify: `electron/main.js`

**Step 1:** 将 `package.json` 中的 `build.appId` 改为 `com.agentsea.desktop`。

**Step 2:** 将 `electron/main.js` 中的 `app.setAppUserModelId()` 改为 `com.agentsea.desktop`。

**Step 3:** 全局搜索 `com.agencyagents.desktop`，确认旧值已清空。

**Step 4:** 用 `node -e` 解析 `package.json`，确认 JSON 仍合法。

### Task 2: 切换默认数据库文件名

**Files:**
- Modify: `electron/main.js`
- Modify: `server/src/index.ts`
- Modify: `server/src/tests/dashscope-provider-settings.test.ts`
- Modify: `server/src/tests/dashscope-fallback-chat.test.ts`
- Modify: `server/src/tests/browser-task-ui-minimax.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Step 1:** 将默认数据库文件名从 `agency-agents.db` 改为 `agent-sea.db`。

**Step 2:** 同步更新测试中的临时数据库文件名，避免默认路径断裂。

**Step 3:** 更新示例文档与配置说明，确保文档与代码一致。

**Step 4:** 全局搜索 `agency-agents.db`，确认只保留允许存在的历史说明，或完全清空。

### Task 3: 在生成脚本中归一化上游品牌词

**Files:**
- Create: `scripts/normalize-imported-branding.mjs`
- Modify: `scripts/generate-agent-content.mjs`
- Modify: `scripts/build-agent-runtime-profiles.mjs`

**Step 1:** 新建共享归一化模块，集中维护高置信度品牌替换规则。

**Step 2:** 在 `generate-agent-content.mjs` 中，对去 frontmatter 后的 markdown 正文做归一化，再提取 headings 与正文。

**Step 3:** 在 `build-agent-runtime-profiles.mjs` 中，对原始正文做同样归一化，再进入 profile 提取流程。

**Step 4:** 避免做裸词 `Agency` 的全局替换，只覆盖明确品牌短语。

### Task 4: 重建生成产物并验证

**Files:**
- Modify: `src/data/agentMarkdown.ts`
- Modify: `shared/agents/runtime-profiles.ts`

**Step 1:** 运行 `npm run generate:agent-content`，重建 `src/data/agentMarkdown.ts`。

**Step 2:** 运行 `npm run build:profiles`，重建 `shared/agents/runtime-profiles.ts`。

**Step 3:** 全局搜索 `Agency Agents Desktop`、`Agency Desktop`、`The Agency`、`Agency Agents`，确认只剩允许保留的上游仓库引用，或被新规则替换干净。

**Step 4:** 运行 `npm run build`，确认前端和生成链路全部通过。

**Step 5:** 用 `ReadLints` 检查最近修改文件，确认没有新诊断。
