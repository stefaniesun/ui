# AI 局部元素重构前端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在元素详情界面提供“选择单根 → AI 对话重构 → 原始/候选差异预览 → 确认应用 → 一次撤销”的完整交互。

**Architecture:** 复用 `ElementTree`、`ElementOverlay` 和 `ElementProperties`，新增独立的 API client、会话状态机、聊天面板和差异列表。AI 会话冻结原始整树，普通元素 Store 在应用成功前不变；候选视图由冻结整树与候选子树纯函数组合，应用失败保留会话，应用成功才更新元素树并记录一个撤销快照。

**Tech Stack:** Vue 3 Composition API、TypeScript、Vite、Vitest、Vue Test Utils、`@region-split/core/browser`

**Prerequisite:** 先完成 `docs/superpowers/plans/2026-08-16-ai-local-element-refactor-backend.md`，后端 GET elements 返回 `treeVersion`，并提供三个 `/api/.../refactor-sessions` 端点。

---

## 文件结构

- Create `apps/region-split-ui/src/element-refactor-api.ts`：三个会话 API 的 HTTP 适配器。
- Create `apps/region-split-ui/src/element-refactor-state.ts`：会话状态机、候选视图、应用和撤销。
- Create `apps/region-split-ui/src/components/ElementRefactorPanel.vue`：对话、版本、作用范围和操作按钮。
- Create `apps/region-split-ui/src/components/ElementDiffList.vue`：分组差异及定位事件。
- Modify `apps/region-split-ui/src/api.ts`、`test-helpers.ts`：元素树版本及测试 fake。
- Modify `apps/region-split-ui/src/element-state.ts`：仅增加服务端应用结果替换入口，不把会话逻辑塞入普通编辑 Store。
- Modify `apps/region-split-ui/src/components/ElementTree.vue`：AI 重构入口、作用范围锁定和差异标记。
- Modify `apps/region-split-ui/src/components/ElementOverlay.vue`：只读候选预览与差异边框。
- Modify `apps/region-split-ui/src/components/ElementProperties.vue`：候选模式只读。
- Modify `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`：页签和各模块编排。
- Modify `apps/region-split-ui/src/theme.css`：面板、差异和预览状态样式。
- 为新模块创建同名 `.test.ts`，扩展现有组件和集成测试。

### Task 1: 接入重构 API 和元素树版本

**Files:**
- Create: `apps/region-split-ui/src/element-refactor-api.ts`
- Create: `apps/region-split-ui/src/element-refactor-api.test.ts`
- Modify: `apps/region-split-ui/src/api.ts`
- Modify: `apps/region-split-ui/src/test-helpers.ts`
- Modify: `apps/region-split-ui/src/element-state.ts`
- Modify: `apps/region-split-ui/src/element-state.test.ts`

- [ ] **Step 1: 编写 API URL、方法和 payload 失败测试**

注入 fake fetch，分别调用：

```ts
api.createSession("p1", input);
api.sendMessage("p1", "s1", { candidateVersion: 1, instruction: "继续" });
api.apply("p1", "s1", { candidateVersion: 2, treeVersion: "v1" });
```

断言 URL 为 `/api/projects/p1/elements/refactor-sessions`、`.../s1/messages`、`.../s1/apply`，均为 POST 且 JSON body 精确；非 2xx 将 `{ code, error }` 转为带 `code/status` 的 `ElementRefactorApiError`。

- [ ] **Step 2: 运行测试确认红灯**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/element-refactor-api.test.ts
```

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现聚焦的 API client**

```ts
export interface ElementRefactorApi {
  createSession(projectId: string, input: CreateRefactorSessionRequest): Promise<RefactorSessionResponse>;
  sendMessage(projectId: string, sessionId: string, input: ContinueRefactorRequest): Promise<RefactorSessionResponse>;
  apply(projectId: string, sessionId: string, input: ApplyRefactorRequest): Promise<ApplyRefactorResponse>;
}

export function createElementRefactorApi(fetchImpl: typeof fetch = fetch): ElementRefactorApi;
```

请求响应类型从 `@region-split/core/browser` 导入，不在前端复制。

- [ ] **Step 4: 扩展普通元素加载返回版本**

`StoreApi.getElements()` 返回 `{ tree, treeVersion }`。`createElementStore()` 增加只读 `treeVersion`，`load()` 同步设置；普通 `putElements()` 成功后若响应含新摘要则更新，否则将摘要置空，防止以陈旧摘要创建 AI 会话。AI 入口仅在摘要非空时启用；必要时重新 `load()`。

增加测试：加载保存版本；切换区域清空旧版本；普通保存后按 API 响应更新版本。

- [ ] **Step 5: 扩展测试 helper 并运行测试**

在 `test-helpers.ts` 增加 `makeElementNode()`、`makeRefactorResponse()`、`makeFakeElementRefactorApi()`；已有 fake API 默认返回稳定 `treeVersion`。

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/element-refactor-api.test.ts src/element-state.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add apps/region-split-ui/src/element-refactor-api.ts apps/region-split-ui/src/element-refactor-api.test.ts apps/region-split-ui/src/api.ts apps/region-split-ui/src/test-helpers.ts apps/region-split-ui/src/element-state.ts apps/region-split-ui/src/element-state.test.ts
git commit -m "feat: connect element refactor API"
```

### Task 2: 实现冻结原树的 AI 会话状态机

**Files:**
- Create: `apps/region-split-ui/src/element-refactor-state.ts`
- Create: `apps/region-split-ui/src/element-refactor-state.test.ts`
- Modify: `apps/region-split-ui/src/element-state.ts`

- [ ] **Step 1: 编写状态机失败测试**

覆盖：

- `open(rootId)` 冻结原始整树、提取子树和 scope IDs，不调用 API。
- 首轮 `generate()` 调用 create；后续 `continueWith()` 携带当前版本调用 messages。
- API 失败保留上一候选和消息，设置可重试错误。
- `setView("original" | "candidate")` 生成正确预览整树。
- `resetCandidate()` 本地恢复原始候选；下一次生成创建新的服务端 session，避免服务端仍基于旧候选。
- `discard()` 不保存并清空会话。
- 元素树/区域重新加载时失效当前会话。
- 生成和应用期间拒绝重复操作。

- [ ] **Step 2: 定义状态和接口**

```ts
export type RefactorPhase = "closed" | "draft" | "generating" | "preview" | "applying" | "error";
export interface RefactorMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export function createElementRefactorStore(deps: {
  api: ElementRefactorApi;
  getTree: () => ElementTree | null;
  getTreeVersion: () => string | null;
  replaceAppliedTree: (tree: ElementTree, treeVersion: string) => void;
}) {
  return { session, previewTree, open, generate, continueWith, setView,
    focusDiff, resetCandidate, discard, apply, undoAppliedRefactor };
}
```

`session` 保存冻结整树、原始子树、候选、候选版本、消息、diff、视图、focused ID、error 和 project/region 上下文。

- [ ] **Step 3: 实现候选视图和对话迭代**

复用 Core browser 导出的 `extractElementSubtree`、`replaceElementSubtree`、`diffElementSubtrees`。首次成功响应设置 `preview`；后续请求以服务端响应替换候选。`resetCandidate()` 将候选恢复为原始子树并清空 `sessionId`/candidateVersion，下一次指令走 create，同时保留 UI 消息并加入“候选已重置”系统消息。

- [ ] **Step 4: 实现应用成功后替换入口**

普通 `elementStore` 增加：

```ts
replaceFromRefactor(tree: ElementTree, treeVersion: string): void;
```

它只更新本地树、版本和选中节点，不调用 PUT；服务器已在 apply 端点完成保存。

- [ ] **Step 5: 运行测试并提交**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/element-refactor-state.test.ts src/element-state.test.ts
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui typecheck
git add apps/region-split-ui/src/element-refactor-state.ts apps/region-split-ui/src/element-refactor-state.test.ts apps/region-split-ui/src/element-state.ts apps/region-split-ui/src/element-state.test.ts
git commit -m "feat: manage AI element refactor sessions"
```

### Task 3: 增加左侧 AI 重构入口和范围锁定

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementTree.vue`
- Modify: `apps/region-split-ui/src/components/ElementTree.test.ts`
- Modify: `apps/region-split-ui/src/theme.css`

- [ ] **Step 1: 编写交互失败测试**

测试：仅当前选中行显示 `data-test="start-ai-refactor"`；点击 emit `start-refactor(id)`；活动会话时 scope 内节点有 `is-refactor-scope`，范围外有 `is-refactor-locked`；范围外行不 emit `select/remove/rename`；diff mark 渲染 `+`、`−`、`M`、`=`；点击 mark emit `focus-diff(id)`。

- [ ] **Step 2: 扩展组件契约**

```ts
refactorRootId?: string | null;
refactorScopeIds?: ReadonlySet<string>;
diffMarks?: ReadonlyMap<string, "added" | "removed" | "modified" | "unchanged">;
locked?: boolean;
```

新增 emits：

```ts
"start-refactor": [id: string];
"focus-diff": [id: string];
```

会话期间仍允许点击 scope 内候选节点查看，但所有普通结构编辑和换根入口禁用。

- [ ] **Step 3: 实现样式并运行测试**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/components/ElementTree.test.ts
```

Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add apps/region-split-ui/src/components/ElementTree.vue apps/region-split-ui/src/components/ElementTree.test.ts apps/region-split-ui/src/theme.css
git commit -m "feat: select AI element refactor scope"
```

### Task 4: 构建对话面板和确定性差异列表

**Files:**
- Create: `apps/region-split-ui/src/components/ElementDiffList.vue`
- Create: `apps/region-split-ui/src/components/ElementDiffList.test.ts`
- Create: `apps/region-split-ui/src/components/ElementRefactorPanel.vue`
- Create: `apps/region-split-ui/src/components/ElementRefactorPanel.test.ts`
- Modify: `apps/region-split-ui/src/theme.css`

- [ ] **Step 1: 编写差异列表失败测试**

传入九类差异，断言按“根替换、新增、删除、层级、类型、名称、位置尺寸、布局、样式”分组，只渲染非空组；点击条目 emit `focus(nodeId)`。

- [ ] **Step 2: 实现 `ElementDiffList`**

Props 为 `diffs`、`focusedNodeId`，emit `focus`。文案由确定性类型映射生成，不展示未经校验的 AI 自述作为事实。

- [ ] **Step 3: 编写聊天面板失败测试**

覆盖作用范围名称/节点数、截图缩略图 URL、消息列表、候选版本、输入提交、生成中禁用、应用/重置/放弃、原始/候选切换、错误重试、差异定位。空指令不提交。

- [ ] **Step 4: 实现 `ElementRefactorPanel`**

组件只通过 props/emits 驱动，不直接调用 API：

```ts
props: { session, scopeName, scopeCount, cropUrl, busy };
emits: {
  generate: [instruction: string];
  continue: [instruction: string];
  apply: [];
  reset: [];
  discard: [];
  "set-view": [view: "original" | "candidate"];
  "focus-diff": [id: string];
  retry: [];
};
```

- [ ] **Step 5: 运行测试并提交**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/components/ElementDiffList.test.ts src/components/ElementRefactorPanel.test.ts
git add apps/region-split-ui/src/components/ElementDiffList.vue apps/region-split-ui/src/components/ElementDiffList.test.ts apps/region-split-ui/src/components/ElementRefactorPanel.vue apps/region-split-ui/src/components/ElementRefactorPanel.test.ts apps/region-split-ui/src/theme.css
git commit -m "feat: preview AI element refactor differences"
```

### Task 5: 增加画布差异预览和候选属性只读模式

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementOverlay.vue`
- Modify: `apps/region-split-ui/src/components/ElementOverlay.test.ts`
- Modify: `apps/region-split-ui/src/components/ElementProperties.vue`
- Modify: `apps/region-split-ui/src/components/ElementProperties.test.ts`
- Modify: `apps/region-split-ui/src/theme.css`

- [ ] **Step 1: 编写 Overlay 失败测试**

扩展 props：

```ts
previewMode?: "normal" | "original" | "candidate";
diffMarks?: ReadonlyMap<string, "added" | "removed" | "modified" | "unchanged">;
readonly?: boolean;
focusedDiffId?: string | null;
```

断言原结构灰色虚线、新增绿色、修改黄色、删除红色虚线、focused 额外高亮；`readonly` 时不 emit `add-container`，节点点击只 emit select/focus，不触发编辑。

- [ ] **Step 2: 实现 Overlay 样式映射**

颜色和线型通过 class 而非内联分支散落；普通模式保持现有显示不变。

- [ ] **Step 3: 编写 Properties 只读失败测试**

`readonly=true` 时名称、类型、位置、尺寸、颜色、圆角、字体、微调和取色控件均禁用，不 emit 修改事件；仍显示候选节点值。

- [ ] **Step 4: 实现 Properties 只读模式并运行测试**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/components/ElementOverlay.test.ts src/components/ElementProperties.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add apps/region-split-ui/src/components/ElementOverlay.vue apps/region-split-ui/src/components/ElementOverlay.test.ts apps/region-split-ui/src/components/ElementProperties.vue apps/region-split-ui/src/components/ElementProperties.test.ts apps/region-split-ui/src/theme.css
git commit -m "feat: render element refactor previews"
```

### Task 6: 在详情页编排页签、会话锁定和应用

**Files:**
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`
- Modify: `apps/region-split-ui/src/App.vue`
- Modify: `apps/region-split-ui/src/App.test.ts`

- [ ] **Step 1: 编写详情页集成失败测试**

挂载 `DetailNode` 并注入 fake stores，覆盖：

- 选中元素后点击 AI 重构，右栏自动切到“AI 结构校准”。
- 会话顶部显示根名称和节点数。
- 生成候选前普通树不变。
- 原始/候选切换分别传入冻结树和 `previewTree`。
- 候选期间 ElementTree 锁定，Properties 只读。
- 点击差异项同步设置树和 Overlay 高亮。
- 放弃不调用 `putElements` 或 apply。
- 切换区域/项目前自动 discard 当前会话。

- [ ] **Step 2: 在 `DetailNode` 组装独立会话 Store**

使用 `createElementRefactorApi()` 和 `createElementRefactorStore()`；右侧只在普通状态显示可编辑 Properties，会话状态显示 AI 面板并辅以只读候选属性。截图缩略图使用现有 `/api/projects/:id/image?kind=clean` 加裁剪 CSS，后端模型仍使用真实裁剪 Buffer。

- [ ] **Step 3: 应用成功后更新普通 Store**

`refactorStore.apply()` 成功后调用 `elementStore.replaceFromRefactor(response.tree, response.treeVersion)`；选择候选根；关闭会话。失败时普通树、选中项、候选和聊天全部保留。

- [ ] **Step 4: 运行集成测试并提交**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui exec vitest run src/canvas/nodes/DetailNode.test.ts src/App.test.ts
git add apps/region-split-ui/src/canvas/nodes/DetailNode.vue apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts apps/region-split-ui/src/App.vue apps/region-split-ui/src/App.test.ts
git commit -m "feat: integrate AI element refactor workflow"
```

### Task 7: 增加单次 AI 应用撤销和固定场景回归

**Files:**
- Modify: `apps/region-split-ui/src/element-refactor-state.ts`
- Modify: `apps/region-split-ui/src/element-refactor-state.test.ts`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.vue`
- Modify: `apps/region-split-ui/src/canvas/nodes/DetailNode.test.ts`
- Modify: `apps/region-split-ui/src/test-helpers.ts`

- [ ] **Step 1: 编写撤销失败测试**

应用前保存 `{ tree, treeVersion }` 快照。应用成功后 `canUndoAppliedRefactor=true`；调用撤销时通过现有 `putElements(projectId, region, oldTree)` 保存完整旧树，只有保存成功才更新本地并清除快照。保存失败时维持当前已应用树并保留撤销能力。

新一轮成功 AI 应用覆盖上一个撤销快照；普通元素编辑或区域重新加载清除该快照，避免跨版本恢复。

- [ ] **Step 2: 实现撤销按钮和冲突提示**

详情页在 AI 应用成功后显示“撤销 AI 重构”。`TREE_VERSION_CONFLICT` 时展示“元素结构已变化，请重新发起 AI 重构”，并保留用户最后输入供复制/重试，不直接覆盖当前树。

- [ ] **Step 3: 增加固定截图结构回归**

用数据 fixture 表达：原列表根下 5 个文字；候选为单一新列表根、5 个入口组件、每项包含原文字。断言：

- 预览前普通树未变。
- diff 包含根替换、5 个新增组件和 5 个文字移动。
- 应用结果中范围外节点深度相等。
- 重新 `load()` 后层级保持。
- 一次撤销恢复原列表和 5 个文字叶子。

不调用真实外部模型，fake API 返回已校验候选。

- [ ] **Step 4: 运行 UI 全量验证**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui test
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui typecheck
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui build
```

Expected: 全部通过。

- [ ] **Step 5: 提交**

```powershell
git add apps/region-split-ui/src
git commit -m "feat: undo applied AI element refactors"
```

## 最终联调与交付

- [ ] **Step 1: 运行全仓验证**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs test
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs typecheck
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui build
git diff --check
```

- [ ] **Step 2: 人工联调固定用例**

启动后端和 UI，载入固定项目：选择包含 5 个文字的列表根，输入“为每个文字补一个入口组件，并组织成横向列表”；确认候选为单根、范围外节点不变、继续调整基于当前候选、放弃不保存、应用后重载保持、撤销恢复。

- [ ] **Step 3: 最终审查和推送**

检查无截图/对话泄露日志、无普通编辑回归、`.npmrc` 未暂存。提交必要修复后推送当前 `feature/region-split`。
