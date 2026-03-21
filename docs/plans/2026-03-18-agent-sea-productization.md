# agent-sea Productization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前 `agent-sea` 桌面应用升级为更正式的未来高端桌面产品，补齐品牌化打包资源、原始 markdown 富文本详情链路，以及一轮完整的 UI/交互精修。

**Architecture:** 保留现有 `Vite + React + Electron` 主结构，新增一层可生成的 Agent 原文数据模块供详情页读取；品牌资源统一收敛到 `buildResources`，由 `electron-builder` 直接消费；界面层围绕“未来高端 + 多节点协同网络”风格统一重构，并保持桌面优先的信息密度与可读性。

**Tech Stack:** React, TypeScript, Electron, electron-builder, Tailwind CSS, Framer Motion, react-markdown, remark-gfm, to-ico

---

### Task 1: 设计文档与品牌资源骨架

**Files:**
- Create: `buildResources/`
- Create: `buildResources/README.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

**Step 1:** 创建 `buildResources` 目录，用于存放图标、安装器资源和应用元信息。

**Step 2:** 在 `buildResources/README.md` 说明资源用途、命名约定和生成方式。

**Step 3:** 更新 `task_plan.md` 与 `progress.md`，记录本轮“品牌化 + 富文本详情 + UI 精修”的范围。

**Step 4:** 校验目录结构清晰，避免图标和脚本散落在根目录。

### Task 2: 生成应用图标与安装器视觉资源

**Files:**
- Create: `buildResources/icon-source.png`
- Create: `buildResources/installer-hero.png`
- Create: `buildResources/icon.ico`
- Create: `buildResources/installer-sidebar.bmp`
- Create: `scripts/generate-brand-assets.mjs`

**Step 1:** 生成一张“未来高端 + 多节点网络 / Agent 集群”风格的方形应用图标原图。

**Step 2:** 生成一张同视觉语言的安装器主视觉图。

**Step 3:** 编写 `scripts/generate-brand-assets.mjs`，将 PNG 转换为 `icon.ico` 和 Windows 安装器可用的 `installer-sidebar.bmp`。

**Step 4:** 运行脚本，确认构建资源文件实际生成成功。

**Step 5:** 验证资源尺寸、透明背景和桌面缩略图可用性。

### Task 3: 完善 Electron 打包元信息与安装器配置

**Files:**
- Modify: `package.json`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`（如有必要）

**Step 1:** 在 `package.json` 中补齐版本信息、作者、版权和产品文案。

**Step 2:** 配置 `electron-builder` 的 `icon`、`win.icon`、`nsis.installerIcon`、`nsis.uninstallerIcon`、`nsis.installerHeaderIcon`、`nsis.installerSidebar` 等资源路径。

**Step 3:** 补充更正式的安装器名称与输出产物命名。

**Step 4:** 确认主窗口标题、背景色、最小尺寸与品牌主题一致。

**Step 5:** 运行 `npm run electron:build`，验证 zip 包仍能成功产出。

### Task 4: 生成原始 markdown 数据模块

**Files:**
- Create: `scripts/generate-agent-content.mjs`
- Create: `src/data/agentMarkdown.ts`
- Modify: `src/data/agents.ts`（如需补充 `sourcePath` 字段）

**Step 1:** 编写脚本扫描 `temp-agency-agents` 中的 Agent markdown 文件。

**Step 2:** 读取 frontmatter 之后的原始正文，写入 `src/data/agentMarkdown.ts`，导出 `agentMarkdownById`。

**Step 3:** 如有必要，为 `Agent` 增加 `sourcePath` 字段，方便详情页和后续维护定位原文来源。

**Step 4:** 运行脚本并检查生成结果覆盖全部 Agent。

### Task 5: 升级 Agent 详情为混合式富文本详情页

**Files:**
- Modify: `src/components/AgentDetailPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`
- Create: `src/components/MarkdownArticle.tsx`（如需要）

**Step 1:** 安装 `react-markdown` 与 `remark-gfm`，建立 markdown 渲染能力。

**Step 2:** 将当前详情侧栏升级为“顶部精修摘要 + 底部完整 markdown 原文”的混合布局。

**Step 3:** 顶部摘要至少包含：部门、子领域、定位、角色标签、来源文件、推荐搭配。

**Step 4:** 底部原文区域渲染标题、列表、强调、引用、代码块，并提供更好的排版。

**Step 5:** 校验至少几个不同 division 的 Agent 文档都能正确渲染。

### Task 6: 未来高端风格 UI 精修

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/SearchBar.tsx`
- Modify: `src/components/SearchResults.tsx`
- Modify: `src/components/DivisionDetail.tsx`
- Modify: `src/components/AgentCard.tsx`
- Modify: `src/components/TeamBuilder.tsx`
- Modify: `src/index.css`

**Step 1:** 统一视觉语言为“黑银基底 + 冷白/青蓝高光 + 精密仪器边框 + 克制辉光”。

**Step 2:** 优化左侧导航、顶部状态栏、统计卡与搜索区域，让它们更像旗舰桌面终端。

**Step 3:** 提升卡片细节，包括边框、阴影、层次、悬浮反馈、数值显示和分区间距。

**Step 4:** 精修 Team Builder 的拖放反馈、推荐区、摘要区与分析感。

**Step 5:** 让详情侧栏与主界面风格完全一致，不再像附加抽屉。

### Task 7: 验证与交付

**Files:**
- Modify: `task_plan.md`
- Modify: `progress.md`

**Step 1:** 运行 `npm run build`，确保前端类型检查与构建通过。

**Step 2:** 运行 `npm run electron:build`，确保桌面包可重新生成。

**Step 3:** 如可行，运行 `npm run electron:dev` 做一轮桌面态冒烟验证。

**Step 4:** 用 `ReadLints` 检查本轮改动文件是否引入新的 IDE 诊断。

**Step 5:** 更新 `task_plan.md` 与 `progress.md`，记录最终产物与剩余风险。
