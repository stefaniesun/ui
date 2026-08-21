# Region Detail Saved Resizable Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让区域详情外框和内部四区可独立调整，并只在点击“保存布局”后将当前实例作为后续新详情的初始化模板。

**Architecture:** 将当前模块级共享响应式比例改为纯布局模板 API，由 `PipelineCanvas` 为每个详情创建独立草稿并通过 scoped slot 传递。`DetailNode` 修改草稿与显式保存，`PipelineNode` 提供外框缩放手柄，画布统一按 zoom 换算尺寸变化并刷新边界和连线。

**Tech Stack:** Vue 3、TypeScript、CSS Grid、Pointer Events、Vitest、Vue Test Utils、localStorage。

---

### Task 1: 独立布局草稿和显式保存

**Files:**
- Modify: `apps/region-split-ui/src/region-detail-layout.ts`
- Modify: `apps/region-split-ui/src/region-detail-layout.test.ts`

- [ ] **Step 1: Write failing state tests**

覆盖默认 `{ width:1280, height:600, tree:40, ai:20, inspectorHeight:240 }`、旧数据迁移、约束、独立草稿和 `saveRegionDetailLayout(storage, draft)` 显式保存；证明修改草稿不会自动写存储。

- [ ] **Step 2: Run state tests and verify failure**

Run: `pnpm --filter @region-split/ui exec vitest run src/region-detail-layout.test.ts`
Expected: FAIL，旧 API 仍自动持久化且无实例草稿。

- [ ] **Step 3: Implement pure template API**

导出 `RegionDetailLayout`、`DEFAULT_REGION_DETAIL_LAYOUT`、`normalizeRegionDetailLayout`、`loadRegionDetailLayout`、`createRegionDetailLayout`、`saveRegionDetailLayout`；宽高、三列和下方高度统一约束并迁移旧字段。

- [ ] **Step 4: Run state tests**

Expected: PASS。

### Task 2: 外框缩放手柄

**Files:**
- Modify: `apps/region-split-ui/src/canvas/PipelineNode.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineNode.test.ts`

- [ ] **Step 1: Write failing component tests**

可调整节点应使用明确 `height`，渲染右边、底边、右下三类手柄；pointerdown 发出 `resizeStart(event,nodeId,direction)`，且不触发拖动。

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm --filter @region-split/ui exec vitest run src/canvas/PipelineNode.test.ts`
Expected: FAIL。

- [ ] **Step 3: Add resizable props and handles**

新增 `height`、`resizable` props 和 `resizeStart` emit；添加三类绝对定位热区、方向光标、焦点反馈和事件阻止。

- [ ] **Step 4: Run component tests**

Expected: PASS。

### Task 3: 画布管理独立实例和外框尺寸

**Files:**
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.test.ts`
- Modify: `apps/region-split-ui/src/App.vue`

- [ ] **Step 1: Write failing canvas tests**

打开两个详情时应各自获得独立布局；调整一个不影响另一个。关闭后新开详情读取最新已保存模板。外框缩放按 `viewport.zoom` 换算，节点 style、边界、连接线和 `fitAll` 使用实例尺寸。

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @region-split/ui exec vitest run src/canvas/PipelineCanvas.test.ts`
Expected: FAIL。

- [ ] **Step 3: Implement per-detail layout records**

增加 `detailLayouts`，`openDetail` 调用 `createRegionDetailLayout(storageTarget())`，`closeDetail` 删除草稿。slot 提供 `layout`、`updateLayout`、`saveLayout`；`PipelineNode` 使用草稿宽高并启用 resize。

- [ ] **Step 4: Implement frame resize orchestration**

记录 resize 起点、原始尺寸和方向；pointermove 除以 zoom 后更新当前实例，并刷新连接线。`detailBounds`、占位与聚焦使用草稿尺寸。

- [ ] **Step 5: Bridge slot in App and run tests**

`App.vue` 将布局及回调传给 `DetailNode`。Expected: PASS。

### Task 4: 四区调整、删除文案与保存反馈

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`

- [ ] **Step 1: Write failing detail tests**

断言无“元素解析图”和比例文案；按钮为“保存布局”；存在树/属性、属性/AI、下方高度、图片区联动四类控件；调整调用实例更新而非全局存储；保存调用回调并短暂显示“已保存”。

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @region-split/ui exec vitest run src/canvas/nodes/DetailNode.test.ts`
Expected: FAIL。

- [ ] **Step 3: Replace shared module state with props/callbacks**

新增 `layout`、`updateLayout`、`saveLayout` props；所有 pointer 和 keyboard 调整只更新当前草稿。CSS 变量从 props 派生。

- [ ] **Step 4: Implement ratio-locked four-region layout**

移除图片标题栏；图片宽度为非 AI 区，`aspect-ratio` 锁定；下方高度来自草稿；新增水平调整热区和图片右下联动点；所有区域维持最小尺寸。

- [ ] **Step 5: Implement explicit save feedback and run tests**

点击保存回调成功后显示“已保存”，随后恢复。Expected: PASS。

### Task 5: 回归验证和交付

**Files:**
- Verify all files above

- [ ] **Step 1: Run focused and full tests**

Run: `pnpm --filter @region-split/ui test -- --run --reporter=default`
Expected: 全部 PASS。

- [ ] **Step 2: Run typecheck and build**

Run: `pnpm --filter @region-split/ui typecheck`
Run: `pnpm --filter @region-split/ui exec vite build --emptyOutDir false --clearScreen false`
Expected: 退出码均为 0。

- [ ] **Step 3: Verify live behavior**

验证多详情互不影响、保存后新详情继承、旧详情不跳变、图片无空隙且锁定比例、外框缩放后连线与聚焦正确。

- [ ] **Step 4: Commit and push**

排除 `.npmrc` 与预览临时文件，提交并推送 `feature/region-split`。
