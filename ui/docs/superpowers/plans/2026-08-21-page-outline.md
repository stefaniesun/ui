# Whole-Page Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上传页面后自动完成全部技术区域解析，并用一张整页轮廓图和一棵整页树提供可疑项优先的分类、文字和矩形校准。

**Architecture:** 核心包新增可测试的整页清单聚合与可疑判据，并由 Fastify 提供可断点续跑的批量解析、清单读取和单元素校准接口。前端用独立的整页状态与 `PageOutline.vue` 消费同一份清单，图片框和树共享选中状态并双向滚动；最终用该工作区替换逐区域详情节点，但保留后台区域切分、检测、资产缓存和既有 emitter。

**Tech Stack:** TypeScript、Zod、Fastify、Sharp、Vue 3、Vitest、Vue Test Utils、Playwright/浏览器走查

---

## 文件结构

- 新建 `packages/region-split/src/page-outline.ts`：整页 DTO/schema、稳定全局 ID、可疑判据、区域树合并和校准映射。
- 修改 `packages/region-split/src/server.ts`：批量解析、整页清单和校准路由。
- 修改 `packages/region-split/src/browser.ts`、`index.ts`：安全导出整页类型和纯函数。
- 新建 `packages/region-split/src/page-outline.test.ts`，修改 `server.test.ts`：核心和接口 TDD。
- 修改 `apps/region-split-ui/src/api.ts`：批量解析、清单和校准 API。
- 新建 `apps/region-split-ui/src/page-outline-state.ts`：进度轮询、整页清单状态与校准动作。
- 新建 `apps/region-split-ui/src/components/PageOutline.vue`：整页图片、框、树、进度、失败区域及三类校准 UI。
- 新建相应测试 `page-outline-state.test.ts`、`components/PageOutline.test.ts`。
- 修改 `apps/region-split-ui/src/App.vue`：上传/载入后进入整页工作区并停用详情节点入口。
- 修改/删除旧工作流的引用测试，封存而不删除 emitter。

### Task 1: 一次跑完与断点续跑

- [ ] 在 `server.test.ts` 增加批量解析接口测试：按纵向顺序解析未落盘 `regionKey`，跳过已有树，单区失败继续，返回 `{ total, completed, skipped, failed }` 和失败键。
- [ ] 运行定向测试确认接口不存在而失败。
- [ ] 在 `server.ts` 抽取单区检测/资产物化函数，新增 `POST /api/projects/:projectId/elements/detect-all`，每个成功区域立即由现有持久化链路落盘，失败只记状态。
- [ ] 在 `api.ts` 和 `page-outline-state.ts` 增加批量执行状态；上传和载入有项目后自动执行，状态文案显示完成数/总数，允许仅重跑失败/缺失区域。
- [ ] 增加状态测试并运行核心、UI 定向测试。

### Task 2: 整页清单接口

- [ ] 在 `page-outline.test.ts` 先定义失败用例：区域内重复节点 ID 被 `regionKey:id` 稳定前缀化；`parentHint` 同步映射；矩形、分类、文字、资产、颜色、字号完整；旧树可解析；未解析区域列出。
- [ ] 新建 `page-outline.ts`，所有新增 schema 字段均保持可选兼容，提供 `buildPageOutline(doc, trees)` 和 `isSuspiciousElement()` 纯函数。
- [ ] 在 `server.test.ts` 增加 `GET /api/projects/:projectId/page-outline` 用例，确认返回 `image`、`designWidth`、扁平元素、区域状态；素材节点先物化再返回引用。
- [ ] 在 `server.ts` 实现接口并通过 `browser.ts`/`index.ts` 导出。
- [ ] 运行两个包 typecheck 和核心定向测试。

### Task 3: 只读整页轮廓图

- [ ] 为 `PageOutline.vue` 编写失败组件测试：使用整页图 URL；所有框按整页尺寸百分比定位；正常框淡化、`textBox.ok === false`、`ambiguous`、`classification === uncertain` 高亮；树与框共享选中；双方选择后调用 `scrollIntoView`。
- [ ] 实现 `page-outline-state.ts` 的加载、扁平树、选中和悬停状态。
- [ ] 实现 `PageOutline.vue` 的双栏布局、整页图片和框、整页编号树、可疑计数、失败区域提示和单区重跑按钮。
- [ ] 在 `App.vue` 接入整页工作区；上传后先完成区域分析，再批量解析并加载清单。
- [ ] 运行 UI 定向测试、typecheck，并在真浏览器确认长图滚动、双向定位和高亮层级。

### Task 4: 三样校准操作

- [ ] 在核心测试中增加整页 ID 反解和校准测试；在组件测试增加选中后修改分类、文字、矩形立即更新的用例。
- [ ] 新增 `PATCH /api/projects/:projectId/page-outline/:elementId`，仅接受 `kind`、`text`、`box`；复用 `applyBox` 和 `writeElementTree`，人工分类写 `classification: human`，改框清除过期 `textBox`。
- [ ] 在 `page-outline-state.ts` 实现乐观更新和失败回滚/报错。
- [ ] 在 `PageOutline.vue` 为选中项提供紧凑校准条：分类下拉、文字输入、x/y/w/h 数字框；不加入圆角、槽位、间距、吸管或图标库。
- [ ] 运行核心、UI 定向测试，并在真浏览器完成三项校准走查。

### Task 5: 停用旧操作工作流

- [ ] 修改 `App.vue` 和主画布，使用户不再打开 `DetailNode`，区域列表只保留后台进度/失败导航；移除图标挑选与复杂属性面板的可达入口。
- [ ] 更新 `App.test.ts`：断言整页轮廓图是唯一元素校准入口，旧详情 slot/按钮不可达。
- [ ] 保留 `emit-html`、`emit-page`、整页导出及其测试，不删除生成器。
- [ ] 搜索运行时代码确认 `openDetail`、`DetailNode`、`ElementProperties`、`IconPickerModal` 不再由 `App.vue` 主流程引用。
- [ ] 运行 UI 全量测试和生产构建。

### Task 6: 完整验证与浏览器验收

- [ ] 在包目录分别运行核心和 UI 全量测试，避免仓库根目录已知相对路径失败。
- [ ] 运行两个包 typecheck、UI 构建、lint 和 `git diff --check`。
- [ ] 重启 API 后用真实项目验证：自动续跑、失败隔离、整页清单、可疑高亮、树图双向滚动、三类校准和刷新持久化。
- [ ] 复核规格明确不做项均未引入，对照实验不在本轮实现。
- [ ] 分阶段提交并推送到当前功能分支；若推送失败，保留提交并报告原因。
