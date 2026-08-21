# Unified AI Processing Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有及后续 AI 解析等待态提供统一的扫描线、聚焦框和跳动状态点动画。

**Architecture:** 新建单一展示组件 `AiProcessingIndicator.vue`，通过 `label` 和 `mode` 适配图片区覆盖、面板内嵌及全局覆盖。业务组件只负责依据自身 busy 状态挂载或移除组件，动画、无障碍语义和减少动态效果兼容全部收口到该组件。

**Tech Stack:** Vue 3、TypeScript、CSS keyframes、Vitest、Vue Test Utils。

---

### Task 1: 可复用 AI 解析动画组件

**Files:**
- Create: `apps/region-split-ui/src/components/AiProcessingIndicator.vue`
- Create: `apps/region-split-ui/src/components/AiProcessingIndicator.test.ts`

- [ ] **Step 1: Write the failing test**

测试组件包含 `role="status"`、可配置文案、扫描线、聚焦框及三个状态点，并支持 `overlay` 与 `inline` 模式类名。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @region-split/ui exec vitest run src/components/AiProcessingIndicator.test.ts`
Expected: FAIL，因为组件尚不存在。

- [ ] **Step 3: Write minimal implementation**

组件提供 `label?: string`、`mode?: "overlay" | "inline"`；默认文案为 `AI 正在解析`。CSS 实现扫描线往返、聚焦框脉冲和三个错峰跳动状态点，并在 `prefers-reduced-motion: reduce` 下禁用全部动画。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @region-split/ui exec vitest run src/components/AiProcessingIndicator.test.ts`
Expected: PASS。

### Task 2: 接入现有 AI 解析场景

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`
- Modify: `apps/region-split-ui/src/components/ElementRefactorPanel.vue`
- Create: `apps/region-split-ui/src/components/ElementRefactorPanel.test.ts`
- Modify: `apps/region-split-ui/src/components/BusyOverlay.vue`
- Modify: `apps/region-split-ui/src/components/BusyOverlay.test.ts`

- [ ] **Step 1: Write failing integration tests**

覆盖：区域分析 busy 时显示统一动画；元素解析 busy 时在元素解析图上显示并结束后移除；AI 结构校准 busy 时在会话区显示；全局 busy 文案以 `AI` 开头时使用统一动画，普通上传等操作继续使用原 spinner。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @region-split/ui exec vitest run src/canvas/nodes/RegionsNode.test.ts src/canvas/nodes/DetailNode.test.ts src/components/ElementRefactorPanel.test.ts src/components/BusyOverlay.test.ts`
Expected: 新增断言 FAIL。

- [ ] **Step 3: Integrate the shared component**

各业务组件仅通过 busy 条件渲染 `AiProcessingIndicator`。统一使用明确文案：`AI 正在解析区域`、`AI 正在解析元素`、`AI 正在校准结构`；失败或成功后 busy 变为 false，组件随即卸载。

- [ ] **Step 4: Run focused tests**

Run: 同 Step 2。
Expected: PASS。

### Task 3: 回归验证与交付

**Files:**
- Verify all modified files above

- [ ] **Step 1: Run all UI tests**

Run: `pnpm --filter @region-split/ui test -- --run --reporter=default`
Expected: 全部 PASS。

- [ ] **Step 2: Run typecheck and production build**

Run: `pnpm --filter @region-split/ui typecheck`
Run: `pnpm --filter @region-split/ui exec vite build --emptyOutDir false --clearScreen false`
Expected: 退出码均为 0。

- [ ] **Step 3: Verify the live page**

在 `http://127.0.0.1:5173` 触发区域分析、元素解析和 AI 结构校准，确认动画范围、文案、停止时机和窄 AI 栏显示正确。

- [ ] **Step 4: Commit and push**

仅提交组件、接入代码、测试和本计划，排除 `.npmrc` 及动画预览临时文件；推送 `feature/region-split`。
