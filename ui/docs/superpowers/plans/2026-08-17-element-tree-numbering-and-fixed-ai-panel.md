# 元素树层级编号与固定 AI 对话框实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在左侧元素树显示动态点分层级编号，并让 AI 对话框固定显示在详情检查器底部，同时将编号作为明确的 AI 节点引用上下文。

**Architecture:** 在 UI 层把当前扁平 `ElementNode[]` 深度优先展开为带 `number` 的行模型，编号只存在于视图和请求上下文，不写回节点。详情区域始终挂载 AI 面板；面板区分空状态和已有会话，现有会话状态机、候选校验和应用流程保持不变。

**Tech Stack:** Vue 3、TypeScript、Vitest、@region-split/core。

---

### Task 1: 增加纯编号函数和元素树编号显示

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementTree.vue`
- Modify: `apps/region-split-ui/src/components/ElementTree.test.ts`

- [ ] **Step 1: 写失败测试**

在 `ElementTree.test.ts` 增加多层树节点，断言树文本包含 `1`、`1.1`、`2`、`2.1`、`2.1.1`，并断言编号节点使用单独的 `data-test="element-number"`。

- [ ] **Step 2: 运行测试确认失败**

运行：`node .corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/components/ElementTree.test.ts`
预期：失败，因为当前树没有编号元素。

- [ ] **Step 3: 实现最小编号行模型**

在 `ElementTree.vue` 的 `rows` 计算中保留现有深度优先顺序，给每一行增加 `number: string`。遍历函数接收父编号，使用同级循环下标生成 `${parentNumber}.${index + 1}`，根节点使用 `${index + 1}`。模板在 `.kind` 前增加：

```vue
<span data-test="element-number" class="element-number">{{ number }}</span>
```

不要修改 `ElementNode`、节点 `id` 或持久化数据。为编号增加弱强调样式，避免挤压名称和现有操作按钮。

- [ ] **Step 4: 运行测试确认通过**

运行同一 Vitest 命令，预期全部通过。

- [ ] **Step 5: 运行 UI 类型检查**

运行：`node .corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui typecheck`
预期：通过。

### Task 2: 固定挂载 AI 面板并补充空状态

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementRefactorPanel.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`

- [ ] **Step 1: 写失败测试**

在 `DetailNode.test.ts` 增加断言：单区域已有元素树且未打开会话时存在 `[data-test="ai-refactor-panel"]`，并显示“请选择元素后开始 AI 重构”。选中节点后，面板显示节点编号和名称。

- [ ] **Step 2: 运行测试确认失败**

运行：`node .corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/canvas/nodes/DetailNode.test.ts`
预期：失败，因为当前 `ElementRefactorPanel` 仅在 `rootId` 非空时挂载。

- [ ] **Step 3: 扩展面板输入并实现空状态**

给 `ElementRefactorPanel` 增加可选 `selectedReference: { number: string; nodeId: string; displayName: string } | null` 和 `active: boolean` props。未 `active` 且无会话时显示固定面板头部、当前选择提示、输入框；发送事件由 DetailNode 以当前选择的节点调用 `startRefactor` 后再提交，避免直接绕过会话初始化。已有会话保留当前控件。

在 `DetailNode.vue` 删除 `v-if="refactorStore.rootId.value"` 的条件挂载，始终在单区域解析树的 inspector 底部挂载；通过计算属性为当前 selected node 生成编号，或复用 ElementTree 的同一编号纯函数，确保显示一致。无节点时面板显示空状态并禁用发送。

- [ ] **Step 4: 调整布局为底部固定区域**

保持 inspector 的树/属性两列结构，在底部增加跨两列的 AI 面板行：使用 `grid-template-rows: minmax(0, 1fr) auto`、`grid-column: 1 / -1`，让面板固定在检查器底部；面板内部消息/差异区域设置最大高度和滚动，不让详情页被无限撑高。

- [ ] **Step 5: 运行测试确认通过**

运行 DetailNode 测试，预期全部通过。

### Task 3: 将编号加入 AI 请求上下文

**Files:**
- Inspect/modify: `apps/region-split-ui/src/element-refactor-api.ts`
- Modify: `apps/region-split-ui/src/element-refactor-state.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/element-refactor-api.test.ts`
- Modify: `apps/region-split-ui/src/element-refactor-state.test.ts`

- [ ] **Step 1: 写失败测试**

扩展 API mock 断言首次创建会话的请求包含节点引用数组，至少验证 `{ number: "2.1", id: "child", displayName: "消息气泡", kind: "icon", parentId: "root", box: ... }`；断言编号仅出现在请求上下文，不会出现在 `tree.nodes`。

- [ ] **Step 2: 运行测试确认失败**

运行：`node .corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/element-refactor-api.test.ts src/element-refactor-state.test.ts`
预期：失败，因为当前 API 请求没有编号上下文字段。

- [ ] **Step 3: 实现上下文传递**

定义 UI 内部 `ElementReference` 类型及统一 `buildElementReferences(nodes)` 函数，使用与元素树相同的 DFS 编号规则，输出编号、ID、父 ID、名称、类型和边界。将引用数组作为会话创建和后续消息的可选 `context` 字段传给 API；服务端 schema 仅在已存在契约允许扩展时增加字段，否则由服务端从 tree 统一计算，避免破坏核心协议。

- [ ] **Step 4: 运行测试确认通过**

运行上述两个测试文件，预期通过。

### Task 4: 全量验证并更新文档

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-element-tree-numbering-and-fixed-ai-panel-design.md`（仅在实现发现契约差异时更新）

- [ ] **Step 1: 运行相关测试**

运行：`node .corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui test`
预期：全部 UI 测试通过。

- [ ] **Step 2: 运行类型检查和构建**

运行：`node .corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui typecheck` 及 `node .corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui build`
预期：均通过。

- [ ] **Step 3: 检查变更范围**

运行：`git diff --check` 和 `git status --short`，确认只包含本功能文件及用户原有 `.npmrc`，不修改 `.codebuddy` 项目数据。
