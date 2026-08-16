# AI 局部元素重构后端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供安全、会话式的 AI 局部元素子树重构 API，支持候选生成、连续调整、差异计算、版本冲突检测和原子应用。

**Architecture:** 将确定性子树操作、候选校验、模型适配、内存会话和 HTTP 路由分层。模型只生成局部完整候选，服务层裁剪局部图片并校验，应用阶段根据冻结的整树摘要原子替换目标片段；实际路由遵循项目现有 `/api` 前缀。

**Tech Stack:** TypeScript 5.9、Fastify 5、Zod 3、Sharp、Vitest、OpenAI-compatible Chat Completions

---

## 文件结构

- Create `packages/region-split/src/element-refactor-types.ts`：候选、差异、请求响应 Schema 与共享类型。
- Create `packages/region-split/src/element-subtree.ts`：提取、替换、摘要和确定性差异纯函数。
- Create `packages/region-split/src/element-refactor-validate.ts`：局部候选的范围、ID、父子关系和整树校验。
- Create `packages/region-split/src/element-refactor-model.ts`：模型输入契约和结构化候选生成接口。
- Modify `packages/region-split/src/model.ts`：在现有 OpenAI-compatible 适配器中实现局部元素重构。
- Create `packages/region-split/src/element-refactor-session-store.ts`：带 TTL 和候选版本的内存会话。
- Create `packages/region-split/src/element-refactor-service.ts`：首轮生成、继续调整、修复一次和应用编排。
- Create `packages/region-split/src/element-refactor-routes.ts`：三个 Fastify API。
- Modify `packages/region-split/src/store.ts`：提供原子 JSON 写入和带摘要冲突检测的子树替换。
- Modify `packages/region-split/src/server.ts`、`main.ts`、`index.ts`、`browser.ts`：依赖组装和安全导出。
- 为每个新模块创建同名 `.test.ts`，并扩展现有 `model.test.ts`、`store.test.ts`、`server.test.ts`。

### Task 1: 建立共享契约、子树操作和稳定摘要

**Files:**
- Create: `packages/region-split/src/element-refactor-types.ts`
- Create: `packages/region-split/src/element-subtree.ts`
- Create: `packages/region-split/src/element-subtree.test.ts`
- Modify: `packages/region-split/src/browser.ts`

- [ ] **Step 1: 编写子树提取、替换和摘要失败测试**

测试构造 `root -> child -> grandchild` 以及一个范围外兄弟，断言：

```ts
const subtree = extractElementSubtree(tree, "root");
expect(subtree).toEqual({ rootId: "root", nodes: [root, child, grandchild] });

const replaced = replaceElementSubtree(tree, "root", {
  rootId: "new-root",
  nodes: [newRoot, newChild],
});
expect(replaced.nodes.map(node => node.id)).toEqual([
  "before-sibling", "new-root", "new-child", "after-sibling",
]);
expect(replaced.nodes.filter(node => node.id === "outside")).toEqual([outside]);
expect(hashElementTree(structuredClone(tree))).toBe(hashElementTree(tree));
```

同时断言不存在的根、候选缺根会抛出明确错误。

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/element-subtree.test.ts
```

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 定义共享类型和 Schema**

在 `element-refactor-types.ts` 定义并导出：

```ts
export const elementSubtreeSchema = z.object({
  rootId: z.string().min(1),
  nodes: z.array(elementNodeSchema).min(1),
});
export type ElementSubtree = z.infer<typeof elementSubtreeSchema>;

export const refactorCandidateSchema = z.object({
  subtree: elementSubtreeSchema,
  explanation: z.string().default(""),
});
export type RefactorCandidate = z.infer<typeof refactorCandidateSchema>;

export type RefactorDiffKind =
  | "root-replaced" | "added" | "removed" | "moved"
  | "kind-changed" | "name-changed" | "box-changed"
  | "layout-changed" | "style-changed";

export interface RefactorDiffItem {
  nodeId: string;
  kind: RefactorDiffKind;
  before?: ElementNode;
  after?: ElementNode;
}

export interface RefactorSessionResponse {
  sessionId: string;
  candidateVersion: number;
  treeVersion: string;
  candidate: ElementSubtree;
  diff: RefactorDiffItem[];
  explanation: string;
}
```

并定义 `CreateRefactorSessionRequest`、`ContinueRefactorRequest`、`ApplyRefactorRequest`、`ApplyRefactorResponse` 的 Zod Schema。创建请求包含 `region`、`rootId`、`treeVersion`、`instruction`；继续请求包含 `candidateVersion`、`instruction`；应用请求包含 `candidateVersion`、`treeVersion`。

- [ ] **Step 4: 实现确定性子树纯函数**

在 `element-subtree.ts` 导出：

```ts
export function extractElementSubtree(tree: ElementTree, rootId: string): ElementSubtree;
export function replaceElementSubtree(
  tree: ElementTree,
  rootId: string,
  candidate: ElementSubtree,
): ElementTree;
export function hashElementTree(tree: ElementTree): string;
export function diffElementSubtrees(
  original: ElementSubtree,
  candidate: ElementSubtree,
): RefactorDiffItem[];
```

`extractElementSubtree` 按原 `nodes` 顺序收集根和全部后代；`replaceElementSubtree` 在原根索引处插入候选节点并删除原片段，不修改输入对象。`hashElementTree` 使用 `node:crypto` 的 SHA-256 对 `JSON.stringify(elementTreeSchema.parse(tree))` 求摘要；该函数只从服务端入口导出，浏览器入口只导出类型、Schema 和差异纯函数。

- [ ] **Step 5: 增加九类差异测试并实现**

为根替换、新增、删除、移动、类型、名称、box、layout、style 各建独立断言。一个节点可产生多个差异项；结果按候选/原始节点顺序及固定类型顺序稳定输出。

- [ ] **Step 6: 运行测试和类型检查**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/element-subtree.test.ts
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core typecheck
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add packages/region-split/src/element-refactor-types.ts packages/region-split/src/element-subtree.ts packages/region-split/src/element-subtree.test.ts packages/region-split/src/browser.ts
git commit -m "feat: add element subtree refactor primitives"
```

### Task 2: 实现候选子树安全校验

**Files:**
- Create: `packages/region-split/src/element-refactor-validate.ts`
- Create: `packages/region-split/src/element-refactor-validate.test.ts`

- [ ] **Step 1: 编写候选校验失败测试**

逐例覆盖：候选多根、根 `parentId` 改变、重复 ID、孤儿、循环、父级引用片段外节点、复用范围外 ID、新 ID 与范围外冲突、节点 box 越过原根允许边界；并覆盖合法候选通过且原树未被修改。

```ts
expect(validateRefactorCandidate({ tree, region, original, candidate })).toEqual({
  valid: false,
  violations: expect.arrayContaining([
    expect.objectContaining({ code: "refactor.external-id" }),
  ]),
});
```

- [ ] **Step 2: 运行测试确认红灯**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/element-refactor-validate.test.ts
```

Expected: FAIL，校验器尚不存在。

- [ ] **Step 3: 实现局部和合并后整树校验**

导出：

```ts
export interface RefactorValidationInput {
  tree: ElementTree;
  region: Rect;
  original: ElementSubtree;
  candidate: ElementSubtree;
}

export interface RefactorValidationResult {
  valid: boolean;
  violations: InvariantViolation[];
}

export function validateRefactorCandidate(
  input: RefactorValidationInput,
): RefactorValidationResult;
```

先执行局部约束，再调用 `replaceElementSubtree()` 合并候选并复用 `checkElementTreeInvariants(merged, region)`。允许边界固定为原根 `box`；根本身可替换，但候选全部节点必须被该 box 包含。

- [ ] **Step 4: 运行测试和 Core 全量回归**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/element-refactor-validate.test.ts
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core test
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/region-split/src/element-refactor-validate.ts packages/region-split/src/element-refactor-validate.test.ts
git commit -m "feat: validate AI element refactor candidates"
```

### Task 3: 扩展模型适配器生成结构化候选

**Files:**
- Create: `packages/region-split/src/element-refactor-model.ts`
- Modify: `packages/region-split/src/model.ts`
- Modify: `packages/region-split/src/model.test.ts`

- [ ] **Step 1: 编写模型请求和解析失败测试**

沿用 `model.test.ts` 的 `fakeFetch()`，断言 `refactorElements()`：

- 请求只包含裁剪图 `data:image/png;base64,...`，不包含完整图路径。
- 提示词包含原始子树、当前候选、指令、边界和单根约束。
- 去除 Markdown fence 后按 `refactorCandidateSchema` 解析。
- 非法 JSON/Schema 时抛出包含可读 Zod issue 的 `ElementRefactorModelOutputError`。

- [ ] **Step 2: 运行测试确认红灯**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/model.test.ts
```

Expected: FAIL，模型没有 `refactorElements()`。

- [ ] **Step 3: 定义模型接口并实现 OpenAI-compatible 调用**

```ts
export interface ElementRefactorModelInput {
  cropBase64: string;
  original: ElementSubtree;
  current: ElementSubtree;
  instruction: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  bounds: Rect;
  validationFeedback?: InvariantViolation[];
}

export interface ElementRefactorModel {
  refactorElements(input: ElementRefactorModelInput): Promise<RefactorCandidate>;
}

export interface AiModel extends SegmentModel, ElementRefactorModel {}
```

将 `createOpenAiModel()` 返回类型改为 `AiModel`。复用现有 URL、认证、timeout 和响应提取逻辑；不要在模型层进行业务范围校验，也不要在这里无限重试。

- [ ] **Step 4: 运行模型测试和类型检查**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/model.test.ts
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/region-split/src/element-refactor-model.ts packages/region-split/src/model.ts packages/region-split/src/model.test.ts
git commit -m "feat: generate AI element refactor candidates"
```

### Task 4: 实现有版本和 TTL 的内存会话

**Files:**
- Create: `packages/region-split/src/element-refactor-session-store.ts`
- Create: `packages/region-split/src/element-refactor-session-store.test.ts`

- [ ] **Step 1: 编写会话生命周期失败测试**

使用注入的 `now()` 测试创建、读取、更新、删除和过期清理；更新错误 session ID、已过期 session 时返回 `null` 或抛出统一 `RefactorSessionNotFoundError`。

- [ ] **Step 2: 实现会话 Store**

```ts
export interface RefactorSession {
  id: string;
  projectId: string;
  region: Rect;
  rootId: string;
  treeVersion: string;
  candidateVersion: number;
  original: ElementSubtree;
  candidate: RefactorCandidate;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  expiresAt: number;
}

export class RefactorSessionStore {
  constructor(options?: { ttlMs?: number; now?: () => number });
  create(input: Omit<RefactorSession, "id" | "expiresAt">): RefactorSession;
  get(id: string): RefactorSession | null;
  update(id: string, updater: (current: RefactorSession) => RefactorSession): RefactorSession;
  delete(id: string): void;
  pruneExpired(): number;
}
```

默认 TTL 为 30 分钟，ID 使用 `randomUUID()`；读取和更新均刷新过期时间，并返回克隆，防止调用者绕过版本管理原地修改。

- [ ] **Step 3: 运行测试并提交**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/element-refactor-session-store.test.ts
git add packages/region-split/src/element-refactor-session-store.ts packages/region-split/src/element-refactor-session-store.test.ts
git commit -m "feat: add element refactor sessions"
```

### Task 5: 编排局部截图、首轮生成和连续调整

**Files:**
- Create: `packages/region-split/src/element-refactor-service.ts`
- Create: `packages/region-split/src/element-refactor-service.test.ts`
- Modify: `packages/region-split/src/store.ts`

- [ ] **Step 1: 编写服务失败测试**

使用真实临时 `ProjectStore`、10×10 固色 PNG 和 mock `ElementRefactorModel`，覆盖：

- 请求摘要与当前树不一致时报 `TREE_VERSION_CONFLICT`。
- 首轮模型收到原根 box 对应裁剪图、原始子树和相同的当前候选。
- 第二轮模型收到上一版候选和历史，版本从 1 增至 2。
- 客户端候选版本不一致时报 `CANDIDATE_VERSION_CONFLICT`。
- 第一次候选 Schema/业务校验失败时，携带 violations 再调用模型一次。
- 第二次仍失败时保留上一候选且返回 `INVALID_CANDIDATE`。

- [ ] **Step 2: 为 Store 增加读取图像 Buffer 的小接口**

```ts
readElementSourceImage(projectId: string): Buffer
```

优先读取 `image.clean.png`，不存在时回退 `image.png`。路径不暴露给模型。

- [ ] **Step 3: 实现服务创建和继续接口**

```ts
export async function createRefactorSession(
  deps: ElementRefactorDeps,
  projectId: string,
  request: CreateRefactorSessionRequest,
): Promise<RefactorSessionResponse>;

export async function continueRefactorSession(
  deps: ElementRefactorDeps,
  projectId: string,
  sessionId: string,
  request: ContinueRefactorRequest,
): Promise<RefactorSessionResponse>;
```

使用 Sharp 根据原根绝对 box 和区域原点裁剪；裁剪范围与像素边界相交后必须仍完整覆盖原根，否则返回 `INVALID_SCOPE`。候选校验通过后才覆盖 session candidate。修复最多一次。

- [ ] **Step 4: 运行服务测试和回归**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/element-refactor-service.test.ts src/store.test.ts
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core test
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/region-split/src/element-refactor-service.ts packages/region-split/src/element-refactor-service.test.ts packages/region-split/src/store.ts packages/region-split/src/store.test.ts
git commit -m "feat: orchestrate AI element refactor sessions"
```

### Task 6: 原子应用候选并检测整树冲突

**Files:**
- Modify: `packages/region-split/src/store.ts`
- Modify: `packages/region-split/src/store.test.ts`
- Modify: `packages/region-split/src/element-refactor-service.ts`
- Modify: `packages/region-split/src/element-refactor-service.test.ts`

- [ ] **Step 1: 编写原子保存和应用失败测试**

覆盖：

- 当前摘要与冻结摘要不同则不写文件。
- 候选版本不符则不写文件。
- 合法应用只替换目标片段，父级、兄弟顺序和范围外节点完全不变。
- 写临时文件失败时正式 `elements.json` 字节不变。
- 应用成功删除 session 并返回新树、新摘要。

- [ ] **Step 2: 实现原子 JSON 写入**

在 `ProjectStore` 内增加私有 `writeJsonAtomic(path, value)`：临时文件必须位于目标目录，名称包含 PID 和 UUID；写入完成后在 Windows 使用“旧文件改备份 → 临时文件改正式 → 删除备份”的可恢复流程，任一步失败都恢复原文件并清理临时文件。保留失败注入点供测试，不增加生产环境开关。

- [ ] **Step 3: 实现带摘要的子树替换**

```ts
replaceElementSubtree(
  projectId: string,
  region: Rect,
  expectedTreeVersion: string,
  rootId: string,
  candidate: ElementSubtree,
): { tree: ElementTree; treeVersion: string };
```

在同一次同步临界区内重新读取树、比对摘要、合并、执行整树不变量检查并原子写入。不要先修改内存或删除 session。

- [ ] **Step 4: 实现应用服务**

```ts
export function applyRefactorSession(
  deps: Pick<ElementRefactorDeps, "store" | "sessions">,
  projectId: string,
  sessionId: string,
  request: ApplyRefactorRequest,
): ApplyRefactorResponse;
```

重新校验 session/project/version/candidate，调用 Store 替换；成功后删除 session，失败保留 session。

- [ ] **Step 5: 运行测试并提交**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core exec vitest run src/store.test.ts src/element-refactor-service.test.ts
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core typecheck
git add packages/region-split/src/store.ts packages/region-split/src/store.test.ts packages/region-split/src/element-refactor-service.ts packages/region-split/src/element-refactor-service.test.ts
git commit -m "feat: atomically apply element refactors"
```

### Task 7: 注册 HTTP API、组装依赖并完成后端验证

**Files:**
- Create: `packages/region-split/src/element-refactor-routes.ts`
- Create: `packages/region-split/src/element-refactor-routes.test.ts`
- Modify: `packages/region-split/src/server.ts`
- Modify: `packages/region-split/src/main.ts`
- Modify: `packages/region-split/src/index.ts`
- Modify: `packages/region-split/src/browser.ts`
- Modify: `packages/region-split/src/server.test.ts`

- [ ] **Step 1: 编写三条路由失败测试**

沿用临时目录和 `app.inject()`，测试：

```text
POST /api/projects/:projectId/elements/refactor-sessions
POST /api/projects/:projectId/elements/refactor-sessions/:sessionId/messages
POST /api/projects/:projectId/elements/refactor-sessions/:sessionId/apply
```

覆盖成功响应、400 请求 Schema、404 项目/树/根/会话、409 树或候选版本冲突、422 非法候选、502 模型错误。创建和消息端点未配置模型时返回现有风格的 400；应用合法既有 session 不再调用模型。

- [ ] **Step 2: 实现独立路由注册器**

```ts
export interface ElementRefactorRouteDeps {
  store: ProjectStore;
  configStore: ModelConfigStore;
  createModel: (config: ModelConfig) => AiModel;
  sessions: RefactorSessionStore;
}

export function registerElementRefactorRoutes(
  app: FastifyInstance,
  deps: ElementRefactorRouteDeps,
): void;
```

将领域错误集中映射为稳定状态码和 `{ error, code, candidateVersion?, treeVersion? }`，日志不得包含截图、候选 JSON 或完整对话。

- [ ] **Step 3: 组装单例会话 Store 和公共导出**

`buildServer()` 接收可选 `refactorSessions` 以便测试注入，默认创建一个实例；`main.ts` 仍使用同一 `createOpenAiModel`。`index.ts` 导出服务端函数，`browser.ts` 只导出浏览器可用类型、Schema 和纯差异类型，不导出 `node:crypto`、Sharp、Store 或会话实现。

- [ ] **Step 4: 返回元素树版本摘要**

扩展现有 `GET /api/projects/:projectId/elements` 响应为：

```ts
{ tree: ElementTree | null, treeVersion: string | null }
```

同步更新 `server.test.ts` 断言。摘要由服务端生成，前端不重复实现 SHA-256。

- [ ] **Step 5: 运行完整后端验证**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core test
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core typecheck
```

Expected: 全部通过。

- [ ] **Step 6: 审查和提交**

检查：局部图像而非整图进入模型；日志无敏感上下文；应用失败不删 session、不改正式文件；`browser.ts` 无 Node-only 依赖。

```powershell
git add packages/region-split/src
git commit -m "feat: expose AI element refactor API"
```

## 后端交付门槛

```powershell
git diff --check
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core test
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core typecheck
```

必须全部退出码为 `0`，并确保 `.npmrc` 未进入提交。后端计划完成后再执行前端计划。
