# 迅雷会员页顶部布局校正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使迅雷会员页顶部标题、账户信息、页签和三张套餐卡在 390px 画布内与裁剪后的参考图稳定对齐，无白块遮盖、截断或文字重影。

**Architecture:** 保留页面画布同级绝对定位，只修正错误的视觉数据与区域绘制职责。语义区域默认透明，所有可见背景由结构化装饰节点输出；套餐卡使用 CSS 装饰而非含文字截图素材。

**Tech Stack:** TypeScript、Vue 3、uni-app、Zod、Vitest、Playwright、Sharp

---

### Task 1: 修正语义区域背景职责

**Files:**
- Modify: `packages/codegen/src/generate-page.ts`
- Modify: `packages/codegen/src/generate-page.test.ts`

- [ ] **Step 1: 写失败测试**

在 `generate-page.test.ts` 增加断言：生成组件中的 `.semantic-region` 不得包含 `background:var(--ui-color-surface)`，区域背景必须透明。

```ts
expect(files['src/components/member/MemberHero.vue']).toContain('.semantic-region{position:absolute;overflow:hidden;background:transparent}')
expect(files['src/components/member/MemberHero.vue']).not.toContain('background:var(--ui-color-surface)')
```

- [ ] **Step 2: 运行失败测试**

Run: `corepack pnpm --filter @ui-rebuild/codegen exec vitest run src/generate-page.test.ts`
Expected: FAIL，现有组件仍输出白色 surface 背景。

- [ ] **Step 3: 最小实现**

将区域基础样式改为：

```ts
'.semantic-region{position:absolute;overflow:hidden;background:transparent}'
```

根页面背景继续由 `.page` 或明确的 `decoration` 节点负责。

- [ ] **Step 4: 运行测试**

Run: `corepack pnpm --filter @ui-rebuild/codegen test`
Expected: PASS。

### Task 2: 确定性校正顶部 VisualIR

**Files:**
- Modify: `fixtures/xunlei-member/visual-ir.json`
- Delete: `apps/reference-app/src/assets/background-plan-gold.png`

- [ ] **Step 1: 添加页面集成断言**

在 `packages/codegen/src/generate-page.test.ts` 增加一个 390px 顶部夹具，断言三张卡片右边界均不超过 390，账户名称为单一连续节点，选中套餐不存在背景 asset 节点。

```ts
expect(topRegions.flatMap(region => region.content).filter(node => node.nodeId === 'account-name')).toHaveLength(1)
expect(planRegions.every(region => region.bounds.x + region.bounds.width <= 390)).toBe(true)
expect(topRegions.flatMap(region => region.content).some(node => node.kind === 'asset' && node.assetId === 'background-plan-gold')).toBe(false)
```

- [ ] **Step 2: 运行失败测试**

Run: `corepack pnpm --filter @ui-rebuild/codegen exec vitest run src/generate-page.test.ts`
Expected: FAIL，旧 VisualIR 存在超出画布的 12 月卡和整卡背景素材。

- [ ] **Step 3: 校正账户与标题数据**

按裁剪参考图调整 `page-header`、`account-summary`：

- 返回图标、标题和头像边界使用参考图测量值。
- 删除拆开的 `login-status` 文本，把可见名称合并到 `account-name`。
- 账户名称、会员状态保持单行，边界不得重叠。

- [ ] **Step 4: 校正页签与套餐卡数据**

按参考图测量并更新：

- 三张卡使用统一宽度与间距，最右边界不超过 390。
- 每张卡的期限、现价和原价按卡片局部中心线排列。
- 选中卡添加 `decoration` 节点表达金色背景、边框和圆角。
- 删除 `background-plan-gold` asset 定义和内容引用。

- [ ] **Step 5: 验证 VisualIR 合同**

Run: `corepack pnpm --filter @ui-rebuild/contracts test`
Expected: PASS，所有节点在画布内且素材引用完整。

### Task 3: 重新生成并验证顶部页面

**Files:**
- Modify: `apps/reference-app/src/components/xunlei-member/*.vue`
- Modify: `apps/reference-app/src/assets/registry.ts`
- Modify: `apps/reference-app/src/styles/tokens.scss`
- Modify: `apps/reference-app/src/pages/xunlei-member/index.vue`

- [ ] **Step 1: 从校正后的 VisualIR 重新生成**

Run: 使用 `@ui-rebuild/codegen` 的 `generatePage(ir, { logicalWidth: 390 })` 写入 `apps/reference-app`。
Expected: 生成组件不再引用 `background-plan-gold.png`，语义区域透明。

- [ ] **Step 2: 构建 H5**

Run: `corepack pnpm --filter @ui-rebuild/reference-app build:h5`
Expected: PASS，无素材缺失或 CSS 语法错误。

- [ ] **Step 3: 浏览器布局断言**

在 390×781 Playwright 页面中断言：

```ts
expect(shellCount).toBe(0)
expect(horizontalOverflow).toBe(false)
expect(planCards).toHaveLength(3)
expect(planCards.every(card => card.right <= 390)).toBe(true)
expect(overlappingTextPairs).toEqual([])
```

保存 `fixtures/xunlei-member/.ui-rebuild/review/actual-top-corrected.png`。

- [ ] **Step 4: 分区像素对比**

用 Sharp 将原图裁剪为逻辑 390px 宽，分别统计 `header`、`account`、`tabs`、`cards` 区域 MAE；与修复前基线比较，要求账户区和卡片区均下降。

### Task 4: 全量回归与提交

**Files:**
- Verify all modified files

- [ ] **Step 1: 运行全量检查**

Run:

```powershell
corepack pnpm --filter @ui-rebuild/contracts test
corepack pnpm --filter @ui-rebuild/codegen test
corepack pnpm --filter @ui-rebuild/cli test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm --filter @ui-rebuild/reference-app build:h5
git diff --check
```

Expected: 全部 PASS。

- [ ] **Step 2: 提交**

```powershell
git add packages/codegen fixtures/xunlei-member apps/reference-app docs/superpowers
 git commit -m "fix: align xunlei member top layout"
```

若当前仓库存在 Git Remote，则推送当前分支；否则明确报告无法推送。
