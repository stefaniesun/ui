# 双图对照与自动 AI 分析实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将四节点分析流水线改为单个双图对照工作区，上传后自动执行 AI 分析，并在模型未配置或分析失败时用阻断式错误对话框提示。

**Architecture:** 保留 `PipelineCanvas` 的无限画布、统一 transform、工作区拖动和 fit 能力，但把四个可独立拖动的节点收敛为一个 `RegionsNode` 对照工作区。`RegionsNode` 编排模型前置检查、上传、自动分析、失败重试和左右图片/列表状态；`RegionCanvas` 只负责已分析结果的覆盖层与拆分坐标交互。通过 `doc.analyzedAt`/`needsAnalysis` 判断 AI 结果是否就绪，不修改 store 公开接口，也不把上传阶段的候选线初始区域暴露为可编辑结果。

**Tech Stack:** Vue 3 Composition API、TypeScript、Vite、Vitest、Vue Test Utils、现有 CSS 主题；不新增第三方依赖。

---

### Task 1: 为模型前置检查与自动分析建立可测试编排

**Files:**
- Modify: `apps/region-split-ui/src/test-helpers.ts`
- Create: `apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`

- [ ] **Step 1: 扩展 fake API 以覆盖配置缺失和分析失败**

在 `test-helpers.ts` 保持 `makeFakeApi()` 现有默认行为，增加可选 overrides（或等价的轻量配置参数），允许测试分别替换 `upload`、`analyze`、`getModelConfig`。不要改动 `StoreApi` 或生产 API。

- [ ] **Step 2: 编写模型未配置时上传被阻止的失败测试**

在 `RegionsNode.test.ts` 挂载真实 `RegionsNode` 和 store，断言：

- 空态存在选择文件/拖放入口。
- `modelConfig` 缺少 `baseUrl`、`model` 或 `hasApiKey` 时，选择文件不会调用 `api.upload` 和 `api.analyze`。
- 组件发出结构化错误事件，包含“必须配置 AI 模型”和 `configPath`。
- 点击“刷新配置”只调用 `loadModelConfig()`，不自动选择或上传文件。

- [ ] **Step 3: 运行节点测试并确认红灯**

Run: `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test -- src/canvas/nodes/RegionsNode.test.ts`

Expected: FAIL，因为 `RegionsNode` 当前没有上传入口、模型检查和错误事件。

- [ ] **Step 4: 实现统一上传入口与模型前置检查**

在 `RegionsNode.vue`：

- 把 `SourceNode.vue` 的文件 input、点击上传和拖放读取逻辑迁入空态。
- 定义 `configured = Boolean(config?.baseUrl && config.model && config.hasApiKey)`。
- 定义错误事件，例如 `error: [{ title, message, configPath?, retryable? }]`，供 `App` 打开对话框。
- 未配置时不调用 `store.uploadImage()`，立即发出模型错误。
- 配置有效时才进入上传。
- 通过 `@pointerdown.stop`、`@click.stop`、`@wheel.stop` 隔离工作区内部操作，避免误拖动画布。

- [ ] **Step 5: 编写上传后自动分析和重复触发保护的失败测试**

断言：

- 上传成功后严格按 `upload → analyze` 顺序各调用一次。
- 上传完成时发出 `uploaded`，供 `App` 同步 hash。
- busy 时文件选择和 drop 都不会启动第二条流程。
- 新文件在空闲时替换项目并重新自动分析。
- `analyze` 成功后呈现已分析工作区。

- [ ] **Step 6: 实现 `uploadAndAnalyze(file)` 编排**

实现顺序：

1. 校验文件、`store.busy` 和模型配置。
2. `await store.uploadImage(file)`。
3. 仅当 `store.projectId` 和 `store.doc.image` 存在且 `store.error` 为空时发出 `uploaded`。
4. `await store.analyze()`。
5. 通过 `doc.analyzedAt` 确认最终结果就绪；失败时发出可重试错误。

`store` 动作会自行设置 busy 和 error；组件不要维护第二份业务 busy 状态。

- [ ] **Step 7: 编写分析失败和重试测试**

模拟 `api.analyze` reject，断言：

- 原图仍显示。
- 初始 regions 不渲染为覆盖层，区域列表不开放编辑。
- 组件发出“AI 区域分析失败”错误，`retryable: true`。
- 调用组件暴露的 `retryAnalysis()`（或触发对应重试事件入口）会再次调用 `store.analyze()`。
- 重试成功并返回带 `analyzedAt` 的文档后，区域覆盖层和列表恢复。

注意：更新 fake analyzed doc，使成功分析结果包含 `analyzedAt`；上传结果保持无 `analyzedAt`，才能真实覆盖 `needsAnalysis` 状态。

- [ ] **Step 8: 实现失败占位与重试入口**

- 使用 `analyzed = Boolean(store.doc.value?.analyzedAt)` 作为结果就绪条件。
- 分析中显示右图同尺寸加载层；失败时显示同尺寸失败占位。
- 未分析时不把 `store.regions` 传给可交互视图，或者直接不挂载 `RegionCanvas`/`RegionList`。
- 暴露单一 `retryAnalysis()`，其内部重新检查模型、调用 `store.analyze()` 并复用相同成功/失败判定。

- [ ] **Step 9: 运行节点测试与类型检查**

Run:

- `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test -- src/canvas/nodes/RegionsNode.test.ts`
- `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui typecheck`

Expected: PASS。

- [ ] **Step 10: 提交编排功能**

```bash
git add apps/region-split-ui/src/test-helpers.ts apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/canvas/nodes/RegionsNode.test.ts
git commit -m "feat: auto analyze uploaded region images"
```

### Task 2: 实现零间距、等比例双图工作区

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/RegionsNode.vue`
- Modify: `apps/region-split-ui/src/components/RegionCanvas.vue`
- Create: `apps/region-split-ui/src/components/RegionCanvas.test.ts`
- Modify: `apps/region-split-ui/src/components/ActionBar.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.test.ts`

- [ ] **Step 1: 编写双图结构和结果门禁的失败测试**

在 `RegionsNode.test.ts` 断言：

- 已上传图片后存在 `[data-test=original-image]` 和 `[data-test=analysis-image]`。
- 两图位于同一 `.comparison-images` grid，列宽一致且 `gap: 0`。
- 工作区右侧始终是固定区域列表列。
- 未分析、分析中和分析失败时不挂载可交互 region overlay。
- 分析成功后才显示 `RegionCanvas`、`ActionBar` 和 `RegionList` 的正常内容。

样式测试优先断言 class/内联 CSS 变量和结构，不依赖 jsdom 实际布局尺寸。

- [ ] **Step 2: 编写共享图片尺寸计算的失败测试**

实现前先测试一个可导出的纯函数或组件计算属性：给定原图 `width/height` 与设计宽度上限，返回单侧图片的统一 `{ width, height }`。覆盖竖图和横图，要求：

- 比例始终等于原图比例。
- 左右图消费同一组 CSS 变量/尺寸。
- 不使用 `object-fit: cover`，不裁切。
- 图片与 stage 均为 `display: block; width: 100%; height: auto`，容器无 padding。

若纯函数放入 `canvas-state.ts`，同时更新 `canvas-state.test.ts`；若保留在 `RegionsNode.vue`，通过 DOM 样式断言。

- [ ] **Step 3: 运行相关组件测试并确认红灯**

Run: `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test -- src/canvas/nodes/RegionsNode.test.ts src/components/RegionCanvas.test.ts src/components/RegionList.test.ts`

Expected: FAIL，因为现有工作区只有单分析图，且未分析结果仍可见。

- [ ] **Step 4: 重构 `RegionsNode` 为三栏布局**

结构固定为：

```text
图片区工具标题
原始图 | 区域分析图 | 区域列表
```

具体要求：

- 原图和分析图外层为连续 grid，`gap: 0`。
- 两图共享一个尺寸来源，不分别测量和缩放。
- 去掉图片区 body padding；相邻边框只保留一条。
- 原图使用 `imageUrl(store.projectId.value)`；右图仍复用同一原始图片作为覆盖层底图。
- 分析图上方挂载 `ActionBar`；区域列表固定宽度约 `245px`，高度与图片区主体对齐。
- 保留 image 文件名、尺寸、状态等紧凑信息，但不得在图片四周制造留白。

- [ ] **Step 5: 让 `RegionCanvas` 只渲染分析图并保持缩放坐标准确**

- 保留 `toImageY`、`snapToCandidates`、`canSplitAt` 和 `store.mode` 单状态来源。
- 保留基于 stage `getBoundingClientRect().height / image.height` 的屏幕比例，确保外层画布 zoom 后指针坐标准确。
- overlay 绘制继续基于图片布局比例。
- `clientWidth/clientHeight === 0` 时回退比例 `1`。
- 增加 `interactive`（默认 `true`）或由父级仅在 analyzed 时挂载；不修改 store 公共接口。
- 在新 `RegionCanvas.test.ts` 迁移/保留 overlay、选中、hover、吸附、非法拆分、有效提交和画布 zoom 坐标用例。

- [ ] **Step 6: 锁定未分析状态下的编辑组件**

- `ActionBar.vue` 统一计算 `locked = store.busy.value || store.needsAnalysis.value`，并用于所有变更按钮。
- `RegionList.vue` 在 `busy`、`needsAnalysis` 或 split mode 下禁止选中和内联编辑。
- 将原“初始划分、重新分析”提示替换为非成功状态提示，正常双图流程不会把初始区域列表展示出来。
- 更新 `RegionList.test.ts`，保留 hover、自动滚动、命名中和拆分锁定回归，并新增 `needsAnalysis` 锁定断言。

- [ ] **Step 7: 运行组件测试、坐标测试和类型检查**

Run:

- `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test -- src/canvas/nodes/RegionsNode.test.ts src/components/RegionCanvas.test.ts src/components/RegionList.test.ts src/coords.test.ts`
- `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui typecheck`

Expected: PASS。

- [ ] **Step 8: 提交双图工作区**

```bash
git add apps/region-split-ui/src/canvas/nodes/RegionsNode.vue apps/region-split-ui/src/components/RegionCanvas.vue apps/region-split-ui/src/components/RegionCanvas.test.ts apps/region-split-ui/src/components/ActionBar.vue apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/components/RegionList.test.ts apps/region-split-ui/src/canvas/canvas-state.ts apps/region-split-ui/src/canvas/canvas-state.test.ts
git commit -m "feat: add side-by-side region comparison workspace"
```

只 add 实际修改或创建的文件；若未采用 `canvas-state.ts` 纯函数方案，不要把它加入提交。

### Task 3: 收敛四节点画布为单工作区

**Files:**
- Modify: `apps/region-split-ui/src/canvas/canvas-state.ts`
- Modify: `apps/region-split-ui/src/canvas/canvas-state.test.ts`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`
- Modify: `apps/region-split-ui/src/App.test.ts`
- Delete: `apps/region-split-ui/src/canvas/PipelineEdges.vue`
- Delete: `apps/region-split-ui/src/canvas/nodes/SourceNode.vue`
- Delete: `apps/region-split-ui/src/canvas/nodes/SurfaceNode.vue`
- Delete: `apps/region-split-ui/src/canvas/nodes/AnalyzeNode.vue`

- [ ] **Step 1: 把 App 拓扑测试改为单工作区失败测试**

修改 `App.test.ts`：

- 断言仅存在 `data-node-id="regions"`（名称可在实现时改为 `workspace`，测试与实现保持一致）。
- 断言不存在 `source`、`surface`、`analyze` 和 `.edges path`。
- 保留输入编辑时忽略全局快捷键、卸载时移除 listener 的测试。
- 新增 hash 项目载入和上传完成后 hash 更新回归测试。

- [ ] **Step 2: 更新画布位置和 fit 测试**

在 `canvas-state.test.ts`：

- 将 `DEFAULT_NODE_POSITIONS` 收敛为单个工作区位置。
- 保留 zoom clamp、光标中心缩放和 malformed storage 回退。
- 新增只保存/读取工作区位置的测试。
- 用对照工作区实际宽高边界更新 `fitBounds` 期望，确保整个三栏工作区可见。

- [ ] **Step 3: 运行 App 与画布测试并确认红灯**

Run: `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test -- src/App.test.ts src/canvas/canvas-state.test.ts`

Expected: FAIL，因为当前仍装配四节点和三条边。

- [ ] **Step 4: 简化 `PipelineCanvas.vue`**

- 删除 `SurfaceNode`、`AnalyzeNode`、`SourceNode` 和 `PipelineEdges` imports/模板。
- 保留单个 `PipelineNode` 外壳，以一个标题栏拖动整个对照工作区；设置 `input=false`、`output=false`，不显示端口。
- `RegionsNode` 直接接收 store 并发出 `uploaded` 与 `error`。
- 位置持久化只保存工作区位置。
- `fit()` 使用工作区 DOM 的真实 `offsetWidth/offsetHeight` 或一个集中定义的尺寸边界，图片加载导致尺寸变化后重新 fit 一次；避免继续使用旧四节点硬编码边界。
- 保留空白画布平移、滚轮缩放、缩放控件和 `0.2×–3×` 限制。

- [ ] **Step 5: 删除不再装配的流程组件**

删除：

- `PipelineEdges.vue`
- `SourceNode.vue`
- `SurfaceNode.vue`
- `AnalyzeNode.vue`

删除前用引用搜索确认没有测试或其他入口仍 import。不要删除 `PipelineNode.vue`，它继续提供统一工作区外壳和拖动标题栏。

- [ ] **Step 6: 运行 App、画布与节点测试**

Run: `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test -- src/App.test.ts src/canvas/canvas-state.test.ts src/canvas/nodes/RegionsNode.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交画布收敛**

```bash
git add apps/region-split-ui/src/App.test.ts apps/region-split-ui/src/canvas/canvas-state.ts apps/region-split-ui/src/canvas/canvas-state.test.ts apps/region-split-ui/src/canvas/PipelineCanvas.vue apps/region-split-ui/src/canvas/PipelineEdges.vue apps/region-split-ui/src/canvas/nodes/SourceNode.vue apps/region-split-ui/src/canvas/nodes/SurfaceNode.vue apps/region-split-ui/src/canvas/nodes/AnalyzeNode.vue
git commit -m "refactor: simplify canvas to one comparison workspace"
```

### Task 4: 增加阻断式错误对话框与键盘优先级

**Files:**
- Create: `apps/region-split-ui/src/components/ErrorDialog.vue`
- Create: `apps/region-split-ui/src/components/ErrorDialog.test.ts`
- Modify: `apps/region-split-ui/src/App.vue`
- Modify: `apps/region-split-ui/src/App.test.ts`
- Modify: `apps/region-split-ui/src/canvas/PipelineCanvas.vue`

- [ ] **Step 1: 编写错误对话框组件失败测试**

断言：

- 展示标题、错误详情和可选 `configPath`。
- 点击关闭发出 `close`。
- `retryable=true` 时显示“重新分析”并发出 `retry`；否则不显示。
- dialog 具备 `role="dialog"`、`aria-modal="true"` 和可访问标题关联。
- backdrop 的 pointer 事件不会穿透到画布。

- [ ] **Step 2: 编写 App 错误状态与 Esc 优先级失败测试**

在 `App.test.ts` 通过 stub 或真实 `RegionsNode` 事件驱动：

- 收到模型配置错误后打开对话框并显示路径。
- 收到分析失败后打开可重试对话框。
- 对话框打开时按 `Esc` 只关闭对话框，不执行 `cancelSplit()` 或 `clearSelection()`。
- 点击重试调用工作区的 `retryAnalysis()`，或者通过 `PipelineCanvas` 向下转发明确的 retry signal；不得直接从对话框修改 store 文档。

- [ ] **Step 3: 运行对话框与 App 测试并确认红灯**

Run: `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test -- src/components/ErrorDialog.test.ts src/App.test.ts`

Expected: FAIL，因为组件和 App 错误状态尚不存在。

- [ ] **Step 4: 实现 `ErrorDialog.vue`**

- 使用深色模态 backdrop 和 panel。
- props 只包含展示数据：`title`、`message`、`configPath?`、`retryable?`。
- emits 只包含 `close`、`retry`。
- 不直接访问 store。
- 重试点击先发 `retry`；由 App 决定是否关闭，失败时可用新错误内容保持对话框打开。

- [ ] **Step 5: 在 `App.vue` 管理错误对话框**

- 增加单一 `dialogError` ref。
- 接收 `PipelineCanvas`/`RegionsNode` 的错误事件并打开对话框。
- 将重试指令转发给工作区的 `retryAnalysis()`；避免绕过组件模型检查。
- 全局 `keydown` 的 `Escape` 顺序改为：关闭对话框 → 忽略输入控件 → 取消 split → 清空选择。
- 保留 Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 和上下方向键逻辑。

- [ ] **Step 6: 调整 busy 遮罩范围**

现有 `App.vue` 在任意 busy 时用 `BusyOverlay` 覆盖整个画布，这会遮住分析期间的原图。改为：

- 上传/载入项目阶段可继续使用全局 `BusyOverlay`。
- AI 分析阶段不显示全局遮罩，由 `RegionsNode` 只在右侧图片区显示“AI 正在解析区域”。
- 判断优先使用 `busyLabel` 的现有明确值（当前分析为“AI 正在分析图片”），或在 `PipelineCanvas` 内根据 `needsAnalysis + busy` 控制局部状态；不新增 store 字段。
- 所有编辑控件仍因 `store.busy` 被锁定。

更新 `BusyOverlay.test.ts` 或 App 测试，证明分析时左图仍在 DOM 中且没有全局遮罩，上传/载入时仍覆盖画布。

- [ ] **Step 7: 运行错误、busy 和键盘测试**

Run: `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test -- src/components/ErrorDialog.test.ts src/components/BusyOverlay.test.ts src/App.test.ts src/canvas/nodes/RegionsNode.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交错误处理**

```bash
git add apps/region-split-ui/src/components/ErrorDialog.vue apps/region-split-ui/src/components/ErrorDialog.test.ts apps/region-split-ui/src/App.vue apps/region-split-ui/src/App.test.ts apps/region-split-ui/src/canvas/PipelineCanvas.vue apps/region-split-ui/src/components/BusyOverlay.test.ts
git commit -m "feat: block region analysis on AI configuration errors"
```

### Task 5: 清理旧界面、完成全量回归

**Files:**
- Delete: `apps/region-split-ui/src/components/ImageCanvas.vue`
- Delete: `apps/region-split-ui/src/components/ImageCanvas.test.ts`
- Delete: `apps/region-split-ui/src/components/Toolbar.vue`
- Delete: `apps/region-split-ui/src/components/Toolbar.test.ts`
- Modify only if verification exposes defects in files from Tasks 1–4.

- [ ] **Step 1: 搜索旧组件和四节点文案引用**

确认生产代码与测试不再引用：

- `ImageCanvas`
- `Toolbar`
- `SourceNode`
- `SurfaceNode`
- `AnalyzeNode`
- `PipelineEdges`
- “表面分析”
- “AI 分段”

仅当零引用时删除旧 `ImageCanvas`、`Toolbar` 及其测试。若旧测试仍覆盖新组件未迁移的重要行为，先把用例迁移到 `ActionBar.test.ts`、`RegionCanvas.test.ts` 或 `RegionsNode.test.ts`。

- [ ] **Step 2: 运行 UI 全量测试**

Run: `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui test`

Expected: PASS，且没有未处理 Vue promise rejection 或 jsdom 调度器污染。

- [ ] **Step 3: 运行工作区核心回归和类型检查**

Run:

- `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui test`
- `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui typecheck`

Expected: PASS；`packages/region-split/**` 核心区域不变量、分析与 reconcile 测试保持通过。

- [ ] **Step 4: 运行生产构建**

Run: `pnpm --store-dir D:/workspace/.worktrees/region-split-canvas-ui/ui/.pnpm-store --dir D:/workspace/.worktrees/region-split-canvas-ui/ui --filter @region-split/ui build`

Expected: Vite production build 成功，无 TypeScript 或模块解析错误。

- [ ] **Step 5: 检查变更范围和工作区卫生**

Run:

- `git diff --check`
- `git status --short`
- `git diff -- packages/region-split`

Expected: 无空白错误；无临时脚本、日志或构建产物被纳入；`packages/region-split/**` 无意外修改。

- [ ] **Step 6: 提交清理与回归修正**

```bash
git add apps/region-split-ui/src
git commit -m "test: cover side-by-side analysis workflow"
```

若没有任何待提交修改，跳过此提交，不创建空提交。

### Task 6: 浏览器视觉与交互验收

**Files:**
- Modify only if browser verification exposes defects in files from Tasks 1–5.

- [ ] **Step 1: 使用项目内依赖启动后端和前端**

遵守项目依赖约束，所有 pnpm store 和第三方包保留在工作树内。启动现有后端 `4800` 与画布 UI 前端 `5190`，确认两端 HTTP 可访问。

- [ ] **Step 2: 验证模型强制前置条件**

使用未配置/不完整配置：

- 点击或拖入图片立即显示应用内错误对话框。
- 对话框包含配置路径。
- 网络面板/服务端日志中没有 upload 和 analyze 请求。
- `Esc` 只关闭对话框。

- [ ] **Step 3: 验证自动分析与失败重试**

使用有效模型：

- 上传后左图立即保留，右图显示局部分析加载态。
- 不出现手动“开始 AI 分段”步骤。
- 分析失败时右图和列表不可编辑，原图保留。
- 点击“重新分析”后可恢复成功结果。

- [ ] **Step 4: 验证两种宽高比的双图布局**

至少使用一张竖图和一张横图：

- 左右图紧贴，`gap=0`。
- 两图宽、高、缩放一致。
- 图片完整显示、不裁切，四周无图片容器留白。
- 区域列表固定在最右侧。
- 工作区适应窗口后完整可见。

- [ ] **Step 5: 验证画布与区域编辑回归**

在适应窗口、`0.2×`、`1×`、`3×` 下验证：

- 空白画布平移、光标中心缩放、工作区整体拖动。
- 区域选择、Ctrl/Cmd 多选和 hover 联动。
- 边界微调、拆分吸附/非法位置、合并、重命名。
- 撤销、重做和输入框快捷键隔离。
- 拆分坐标与视觉指针位置一致。

- [ ] **Step 6: 复跑最终验证并提交缺陷修正**

重新运行 Task 5 的 UI 测试、工作区测试、类型检查、构建与 `git diff --check`。若浏览器验收产生修正，只暂存实际修复的 `apps/region-split-ui/src/**` 文件，然后提交：

```bash
git status --short
git commit -m "fix: polish side-by-side analysis workflow"
```

- [ ] **Step 7: 推送当前分支**

Run: `git push`

Expected: `feature/region-split-canvas-ui` 推送成功。若仓库仍未配置 push destination，保留本地提交并明确报告远端缺失，不修改 git config。
