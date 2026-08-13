# Region Element Component Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有纵向区域拆分工作区中增加自动二维元素识别、父子树、完整框编辑、区域边界联动、局部重试和并发安全持久化。

**Architecture:** 保留现有区域分析作为第一阶段，区域分析成功后最多并发 3 个区域裁图元素识别任务，并将模型相对坐标标准化为原图绝对坐标。核心包提供元素纯操作与不变量，服务端通过项目级写协调器、`revision` 和原子替换保证一致性；前端使用完整编辑快照统一撤销区域与元素操作，并把右侧分析图和区域列表扩展为元素框编辑器与树。

**Tech Stack:** TypeScript 5.9、Zod 3、Sharp 0.33、Fastify 5、Vue 3 Composition API、Pointer Events、Vitest 2、Vue Test Utils、pnpm workspace。

**Design:** `docs/superpowers/specs/2026-08-13-region-element-component-splitting-design.md`

**Environment:** 所有命令在 `D:/workspace/ui` 执行；使用项目内 pnpm store。Windows 下通过 `D:\nodejs\corepack.cmd pnpm` 调用 pnpm，不依赖用户目录缓存。

---

## 文件结构

### 核心包

- Modify: `packages/region-split/src/types.ts` — 元素 schema、文档版本、revision 与分析状态。
- Modify: `packages/region-split/src/types.test.ts` — 迁移和元素不变量测试。
- Create: `packages/region-split/src/elements.ts` — 元素树纯操作、约束和区域重归属。
- Create: `packages/region-split/src/elements.test.ts` — 元素操作测试。
- Modify: `packages/region-split/src/operations.ts` — 区域稳定 ID 与元素协调入口。
- Modify: `packages/region-split/src/operations.test.ts` — AI 命名不改 ID、拆分合并身份测试。
- Modify: `packages/region-split/src/model.ts` — 元素模型请求、提示词和严格响应解析。
- Modify: `packages/region-split/src/model.test.ts` — 元素模型响应测试。
- Create: `packages/region-split/src/element-analysis.ts` — 坐标标准化、裁图分析、并发池和 fingerprint。
- Create: `packages/region-split/src/element-analysis.test.ts` — 标准化、并发和失败隔离测试。
- Modify: `packages/region-split/src/analyze.ts` — 两阶段整图分析和单区域重试。
- Modify: `packages/region-split/src/analyze.test.ts` — 整体替换、局部失败和重试测试。
- Create: `packages/region-split/src/write-coordinator.ts` — 按项目串行写队列。
- Create: `packages/region-split/src/write-coordinator.test.ts` — 串行执行测试。
- Modify: `packages/region-split/src/store.ts` — revision 校验、统一编辑和原子落盘。
- Modify: `packages/region-split/src/store.test.ts` — revision、迁移和失败不破坏旧文档测试。
- Modify: `packages/region-split/src/server.ts` — 统一编辑与区域元素重试路由。
- Modify: `packages/region-split/src/server.test.ts` — HTTP 状态和并发冲突测试。
- Modify: `packages/region-split/src/index.ts` — 服务端导出。
- Modify: `packages/region-split/src/browser.ts` — 浏览器安全纯逻辑导出。

### 前端

- Modify: `apps/region-split-ui/src/api.ts` — 统一编辑、重试和结构化 HTTP 错误。
- Create: `apps/region-split-ui/src/api.test.ts` — 请求体与 `409` 测试。
- Modify: `apps/region-split-ui/src/state.ts` — 完整快照、元素动作、手势和冲突处理。
- Modify: `apps/region-split-ui/src/state.test.ts` — 元素编辑、撤销、保存和边界联动测试。
- Create: `apps/region-split-ui/src/components/ElementOverlay.vue` — 元素框渲染、选择、移动、缩放和创建。
- Create: `apps/region-split-ui/src/components/ElementOverlay.test.ts` — Pointer Events 与约束测试。
- Create: `apps/region-split-ui/src/components/ElementTree.vue` — 递归元素树与属性编辑。
- Create: `apps/region-split-ui/src/components/ElementTree.test.ts` — 树操作测试。
- Modify: `apps/region-split-ui/src/components/ImageCanvas.vue` — 在分析图装配元素覆盖层并协调模式。
- Modify: `apps/region-split-ui/src/components/ImageCanvas.test.ts` — 双图门禁和坐标测试。
- Modify: `apps/region-split-ui/src/components/RegionList.vue` — 区域行下装配元素树、状态与重试。
- Modify: `apps/region-split-ui/src/components/RegionList.test.ts` — 树、失败、冲突和重试测试。
- Modify: `apps/region-split-ui/src/components/Toolbar.vue` — 选择/添加元素模式入口。
- Modify: `apps/region-split-ui/src/components/Toolbar.test.ts` — 模式互斥与禁用测试。
- Modify: `apps/region-split-ui/src/App.vue` — 全部元素分析失败和 `409` 对话框。
- Modify: `apps/region-split-ui/src/App.test.ts` — 错误和快捷键测试。
- Modify: `apps/region-split-ui/src/test-helpers.ts` — 带元素与 revision 的测试文档工厂。

---

### Task 1: 扩展文档 schema 与兼容迁移

**Files:**
- Modify: `packages/region-split/src/types.ts`
- Modify: `packages/region-split/src/types.test.ts`
- Modify: `packages/region-split/src/index.ts`
- Modify: `packages/region-split/src/browser.ts`

- [ ] **Step 1: 写旧文档迁移和元素 schema 的失败测试**

在 `types.test.ts` 增加以下用例，使用文件现有的最小合法区域工厂：

```ts
it("loads a v1 document with empty element defaults", () => {
  const parsed = regionSplitDocSchema.parse(v1Doc);
  expect(parsed.revision).toBe(0);
  expect(parsed.elements).toEqual([]);
  expect(parsed.elementAnalysis).toEqual({});
});

it("rejects duplicate element ids and cyclic parents", () => {
  const doc = makeDoc({ elements: [
    makeElement({ id: "a", parentId: "b" }),
    makeElement({ id: "b", parentId: "a" }),
  ] });
  expect(checkDocumentInvariants(doc)).not.toEqual([]);
});

it("normalizes persisted analyzing state to failed", () => {
  const parsed = normalizeRegionSplitDoc(regionSplitDocSchema.parse(makeDoc({
    elementAnalysis: { header: { status: "analyzing" } },
  })));
  expect(parsed.elementAnalysis.header?.status).toBe("failed");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- types.test.ts`

Expected: FAIL，提示 `elements`、`revision`、`normalizeRegionSplitDoc` 或元素类型不存在。

- [ ] **Step 3: 实现 schema、默认值和文档级不变量**

在 `types.ts` 增加并导出：

```ts
export const elementTypes = [
  "container", "text", "image", "icon", "button", "input", "textarea",
  "select", "checkbox", "radio", "link", "list", "list-item", "divider", "other",
] as const;
export type ElementType = typeof elementTypes[number];
export type ElementSource = "ai" | "manual";
export type ElementAnalysisStatus = "pending" | "analyzing" | "ready" | "stale" | "failed";

export const elementNodeSchema = z.object({
  id: z.string().min(1),
  regionId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  displayName: z.string().min(1),
  type: z.enum(elementTypes),
  bounds: rectSchema,
  confidence: z.number().min(0).max(1),
  conflict: z.boolean().default(false),
  source: z.enum(["ai", "manual"]),
});
export type ElementNode = z.infer<typeof elementNodeSchema>;

export const regionElementAnalysisSchema = z.object({
  status: z.enum(["pending", "analyzing", "ready", "stale", "failed"]),
  error: z.string().optional(),
  analyzedAt: z.string().optional(),
  inputFingerprint: z.string().optional(),
});
export type RegionElementAnalysis = z.infer<typeof regionElementAnalysisSchema>;
```

将 `regionSplitDocSchema` 扩展为 `schemaVersion: z.enum(["1", "2"])`、`revision: z.number().int().nonnegative().default(0)`、`elements: z.array(elementNodeSchema).default([])`、`elementAnalysis: z.record(regionElementAnalysisSchema).default({})`。测试必须直接解析真实旧格式 `{ schemaVersion: "1" }`。增加 `normalizeRegionSplitDoc`，把 schema 版本统一写为字符串 `"2"`，并把残留 `analyzing` 转为 `{ status: "failed", error: "analysis interrupted" }`。

保留现有 `checkInvariants(regions, image): InvariantViolation[]` 兼容调用，新增 `checkDocumentInvariants(doc): InvariantViolation[]`：先调用区域不变量，再检查元素 ID 唯一、`regionId` 存在、`parentId` 存在、无环、图片边界、最小 `4px`、父包含子；`conflict === false` 的顶级元素必须完整位于所属区域。store 的统一提交只调用 `checkDocumentInvariants`。

- [ ] **Step 4: 导出并运行核心测试**

在 `index.ts` 和 `browser.ts` 继续从 `types.ts` 导出上述纯类型和函数。

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- types.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/region-split/src/types.ts packages/region-split/src/types.test.ts packages/region-split/src/index.ts packages/region-split/src/browser.ts
git commit -m "feat: add region element document schema"
```

---

### Task 2: 实现元素树纯操作和区域重归属

**Files:**
- Create: `packages/region-split/src/elements.ts`
- Create: `packages/region-split/src/elements.test.ts`
- Modify: `packages/region-split/src/index.ts`
- Modify: `packages/region-split/src/browser.ts`

- [ ] **Step 1: 写元素操作失败测试**

覆盖以下明确行为：

```ts
it("moves a parent and every descendant by the same delta", () => {
  const result = moveElementTree(doc, "card", 5, 7);
  expect(byId(result, "card").bounds).toMatchObject({ x: 15, y: 27 });
  expect(byId(result, "title").bounds).toMatchObject({ x: 25, y: 37 });
});

it("rejects shrinking a parent across a child", () => {
  expect(() => resizeElement(doc, "card", { x: 10, y: 20, w: 20, h: 20 }))
    .toThrow("children must remain inside parent");
});

it("deletes the complete subtree", () => {
  expect(deleteElementTree(doc, "card").elements.map(item => item.id)).not.toContain("title");
});

it("rejects a reparenting cycle", () => {
  expect(() => reparentElement(doc, "card", "title")).toThrow("element parent cycle");
});

it("reassigns contained top-level elements and marks boundary crossings", () => {
  const result = reconcileElementsWithRegions(elements, changedRegions);
  expect(byId(result, "contained").regionId).toBe("second");
  expect(byId(result, "crossing").conflict).toBe(true);
});
```

同时测试 `addElement`、`renameElement`、`changeElementType`、最小尺寸、图片范围、新父级必须包含目标元素，以及顶级元素归属变化会递归同步子树 `regionId`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- elements.test.ts`

Expected: FAIL，模块 `./elements.js` 不存在。

- [ ] **Step 3: 实现纯操作 API**

`elements.ts` 导出固定签名：

```ts
export function addElement(doc: RegionSplitDoc, element: ElementNode): RegionSplitDoc;
export function moveElementTree(doc: RegionSplitDoc, elementId: string, dx: number, dy: number): RegionSplitDoc;
export function resizeElement(doc: RegionSplitDoc, elementId: string, bounds: Rect): RegionSplitDoc;
export function deleteElementTree(doc: RegionSplitDoc, elementId: string): RegionSplitDoc;
export function renameElement(doc: RegionSplitDoc, elementId: string, displayName: string): RegionSplitDoc;
export function changeElementType(doc: RegionSplitDoc, elementId: string, type: ElementType): RegionSplitDoc;
export function reparentElement(doc: RegionSplitDoc, elementId: string, parentId: string | null): RegionSplitDoc;
export function reconcileElementsWithRegions(
  elements: ElementNode[], regions: Region[], image: { width: number; height: number },
): ElementNode[];
```

所有函数返回新对象，不修改输入。操作完成后调用统一断言；父级移动先收集子树 ID，再对所有矩形应用同一位移。重归属只判断顶级元素：完整落入一个区域时更新整个子树 `regionId` 并清除顶级元素冲突；跨界时保持 `regionId`，只设置顶级元素 `conflict: true`，子元素不重复计入冲突。`moveElementTree` 和 `resizeElement` 成功后必须找到顶级祖先并再次执行同一归属协调，使跨界框移动回区域时自动清除冲突；为该恢复路径增加核心与 store 测试。所有 `ElementNode.bounds` 和前端矩形统一使用现有 `Rect` 的 `{ x, y, w, h }`；仅模型原始响应与 Sharp 参数使用 `width/height`。

- [ ] **Step 4: 导出并运行测试**

在 `index.ts`、`browser.ts` 增加 `export * from "./elements.js";`。

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- elements.test.ts types.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/region-split/src/elements.ts packages/region-split/src/elements.test.ts packages/region-split/src/index.ts packages/region-split/src/browser.ts
git commit -m "feat: add element tree editing operations"
```

---

### Task 3: 保证区域 ID 稳定并联动元素状态

**Files:**
- Modify: `packages/region-split/src/operations.ts`
- Modify: `packages/region-split/src/operations.test.ts`

- [ ] **Step 1: 写稳定 ID 和状态联动失败测试**

```ts
it("keeps the persistent id when applying AI naming", () => {
  const result = applyNaming(regions, "region-a", {
    id: "model-suggested-id", displayName: "顶部导航", type: "header",
    scrollX: false, scrollY: false,
  });
  expect(result[0]?.id).toBe("region-a");
});

it("marks changed region analysis stale after boundary adjustment", () => {
  const result = applyRegionEdit(doc, regions => adjustBoundary(regions, 0, 4));
  expect(result.elementAnalysis["region-a"]?.status).toBe("stale");
  expect(result.elements.some(item => item.conflict)).toBe(true);
});
```

另测拆分产生一个新 ID且两个区域状态为 `pending`；合并保留首区域 ID、删除第二区域状态键、合并结果为 `pending`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- operations.test.ts`

Expected: FAIL，`applyNaming` 改写 ID 或 `applyRegionEdit` 不存在。

- [ ] **Step 3: 实现文档级区域编辑包装器**

修改 `applyNaming`，忽略模型的 `id`，只更新 `displayName/type/scrollX/scrollY`。增加：

```ts
export type RegionEditKind = "boundary" | "split" | "merge" | "metadata";

export function applyRegionEdit(
  doc: RegionSplitDoc,
  edit: (regions: Region[]) => Region[],
  kind: RegionEditKind = "boundary",
): RegionSplitDoc;
```

该函数比较编辑前后区域 ID 和 `bounds/displayName/type`，并按 `kind` 明确分支：`split` 将保留 ID 的上半区和新 ID 下半区都设为 `pending`；`merge` 删除被合并区域状态键并将保留首 ID 的合并区设为 `pending`；`boundary` 与 `metadata` 只把受影响区域设为 `stale`。随后调用 `reconcileElementsWithRegions` 并返回完整新文档。区域底层纯函数不再保存撤销信息，撤销只由前端 store 管理。

- [ ] **Step 4: 运行操作测试**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- operations.test.ts elements.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add packages/region-split/src/operations.ts packages/region-split/src/operations.test.ts
git commit -m "fix: preserve region identity across edits"
```

---

### Task 4: 增加 revision、原子落盘和项目写协调器

**Files:**
- Create: `packages/region-split/src/write-coordinator.ts`
- Create: `packages/region-split/src/write-coordinator.test.ts`
- Modify: `packages/region-split/src/store.ts`
- Modify: `packages/region-split/src/store.test.ts`
- Modify: `packages/region-split/src/index.ts`

- [ ] **Step 1: 写串行、revision 和原子失败测试**

```ts
it("serializes writes for the same project but not different projects", async () => {
  const events: string[] = [];
  await Promise.all([
    coordinator.run("a", async () => { events.push("a1-start"); await gate; events.push("a1-end"); }),
    coordinator.run("a", async () => events.push("a2")),
  ]);
  expect(events).toEqual(["a1-start", "a1-end", "a2"]);
});

it("rejects stale revision without changing disk", () => {
  const before = store.readDoc(projectId);
  expect(() => store.writeEditable(projectId, {
    expectedRevision: before.revision - 1,
    regions: before.regions,
    elements: before.elements,
    elementAnalysis: before.elementAnalysis,
  })).toThrow(RevisionConflictError);
  expect(store.readDoc(projectId)).toEqual(before);
});

it("increments revision after one atomic edit", () => {
  const before = store.readDoc(projectId);
  const after = store.writeEditable(projectId, editablePayload(before));
  expect(after.revision).toBe(before.revision + 1);
});
```

注入一个使临时文件替换失败的文件操作桩，断言旧 `regions.json` 保持字节不变，临时文件被清理。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- write-coordinator.test.ts store.test.ts`

Expected: FAIL，协调器、`writeEditable` 和 `RevisionConflictError` 不存在。

- [ ] **Step 3: 实现写协调器**

`write-coordinator.ts`：

```ts
export class ProjectWriteCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(projectId: string, work: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(projectId, tail);
    await previous;
    try { return await work(); }
    finally {
      release();
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId);
    }
  }

  get pendingProjectCount(): number { return this.tails.size; }
}
```

串行测试结束后还要断言 `coordinator.pendingProjectCount === 0`，证明队列不会泄漏。

- [ ] **Step 4: 实现 store 统一编辑和原子替换**

增加：

```ts
export class RevisionConflictError extends Error {
  constructor(public readonly latest: RegionSplitDoc) { super("document revision conflict"); }
}

export interface EditableDocumentInput {
  expectedRevision: number;
  regions: Region[];
  elements: ElementNode[];
  elementAnalysis: Record<string, RegionElementAnalysis>;
}
```

`readDoc` 使用 `normalizeRegionSplitDoc(regionSplitDocSchema.parse(raw))`。新增唯一版本化提交原语：

```ts
commitDocument(
  projectId: string,
  expectedRevision: number,
  buildNext: (current: RegionSplitDoc) => RegionSplitDoc,
): RegionSplitDoc;
```

它构造 `revision + 1` 的候选文档，运行 `checkDocumentInvariants`，再写同目录唯一临时文件并 `renameSync` 原子替换；失败时清理临时文件且旧文件字节不变。除首次创建项目以 revision `0` 写入外，统一编辑、整图分析、AI 重命名和局部重试都必须经 `commitDocument`，每次成功只递增一次。`writeEditable` 与兼容的 `writeRegions` 都委托该原语。

- [ ] **Step 5: 运行测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- write-coordinator.test.ts store.test.ts`

Expected: PASS。

```powershell
git add packages/region-split/src/write-coordinator.ts packages/region-split/src/write-coordinator.test.ts packages/region-split/src/store.ts packages/region-split/src/store.test.ts packages/region-split/src/index.ts
git commit -m "feat: add revision-safe atomic project writes"
```

---

### Task 5: 扩展模型元素识别协议

**Files:**
- Modify: `packages/region-split/src/model.ts`
- Modify: `packages/region-split/src/model.test.ts`

- [ ] **Step 1: 写模型响应解析失败测试**

```ts
it("parses a flat element tree from the model", async () => {
  const model = createOpenAiModel(mockConfig(reply({ elements: [{
    id: "hero", parentId: null, displayName: "首屏", type: "container",
    x: 0, y: 0, width: 320, height: 180, confidence: 0.9,
  }] })));
  await expect(model.analyzeElements(elementInput)).resolves.toEqual([
    expect.objectContaining({ id: "hero", type: "container", parentId: null }),
  ]);
});

it("rejects unknown element types and malformed parents", async () => {
  const model = createOpenAiModel(mockConfig(reply({ elements: [{ type: "video-player" }] })));
  await expect(model.analyzeElements(elementInput)).rejects.toThrow("model returned invalid shape");
});
```

验证请求提示中包含裁图宽高、区域名称、区域类型和固定元素类型列表。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- model.test.ts`

Expected: FAIL，`SegmentModel.analyzeElements` 不存在。

- [ ] **Step 3: 实现模型输入输出和提示词**

新增：

```ts
export interface ElementAnalysisInput {
  cropBase64: string;
  width: number;
  height: number;
  regionName: string;
  regionType: RegionType;
}

export interface RawElement {
  id: string;
  parentId: string | null;
  displayName: string;
  type: ElementType;
  x: number; y: number; width: number; height: number;
  confidence: number;
}

export interface SegmentModel {
  segment(input: SegmentInput): Promise<RawSegment[]>;
  nameRegion(input: { cropBase64: string }): Promise<RegionNaming>;
  analyzeElements(input: ElementAnalysisInput): Promise<RawElement[]>;
}
```

`ELEMENT_PROMPT` 明确要求只输出 `{ "elements": [...] }`，使用裁图相对整数像素、扁平父子关系、固定类型、父框包含子框且不输出装饰性背景噪点。通过现有 `askParsed` 和严格 Zod schema 解析。

- [ ] **Step 4: 运行模型测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- model.test.ts`

Expected: PASS。

```powershell
git add packages/region-split/src/model.ts packages/region-split/src/model.test.ts
git commit -m "feat: add AI element analysis protocol"
```

---

### Task 6: 实现元素标准化、fingerprint 和并发分析池

**Files:**
- Create: `packages/region-split/src/element-analysis.ts`
- Create: `packages/region-split/src/element-analysis.test.ts`
- Modify: `packages/region-split/src/index.ts`

- [ ] **Step 1: 写标准化与并发失败测试**

```ts
it("converts crop coordinates to original image coordinates", () => {
  const [element] = normalizeElementResponse(region, rawElements);
  expect(element?.bounds).toEqual({ x: region.bounds.x + 8, y: region.bounds.y + 12, w: 40, h: 20 });
});

it("drops elements smaller than four pixels after clipping", () => {
  expect(normalizeElementResponse(region, [raw({ x: -5, width: 7 })])).toEqual([]);
});

it("rejects cycles and children outside their parent", () => {
  expect(() => normalizeElementResponse(region, cyclicRaw)).toThrow("element parent cycle");
});

it("never runs more than three region requests concurrently", async () => {
  let active = 0; let maximum = 0;
  await analyzeRegionElements(regions, async region => {
    active++; maximum = Math.max(maximum, active); await delay(10); active--; return success(region);
  }, 3);
  expect(maximum).toBe(3);
});
```

另测稳定 ID 前缀不依赖模型 ID、同一输入 fingerprint 稳定、边界/名称/类型任一变化 fingerprint 改变、单任务失败不会拒绝整个并发池。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- element-analysis.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现独立分析模块**

导出：

```ts
export function elementInputFingerprint(region: Region, imageVersion: string): string;
export function normalizeElementResponse(region: Region, raw: RawElement[]): ElementNode[];
export async function analyzeRegionElements<T>(
  regions: Region[], worker: (region: Region) => Promise<T>, concurrency?: number,
): Promise<Map<string, { ok: true; value: T } | { ok: false; error: string }>>;
export async function analyzeOneRegionElements(
  store: ProjectStore, projectId: string, region: Region, model: SegmentModel,
): Promise<ElementNode[]>;
```

使用 Sharp 从 `store.cleanImagePath(projectId)` 返回的原分辨率清理图按区域提取 PNG，不硬编码文件名；模型临时 ID 只用于本响应父子映射，最终 ID 使用 `element-${crypto.randomUUID()}`。错误文本只保留 `Error.message` 并移除绝对路径样式。

- [ ] **Step 4: 运行测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- element-analysis.test.ts model.test.ts`

Expected: PASS。

```powershell
git add packages/region-split/src/element-analysis.ts packages/region-split/src/element-analysis.test.ts packages/region-split/src/index.ts
git commit -m "feat: normalize and schedule region element analysis"
```

---

### Task 7: 接入两阶段整图分析和局部重试

**Files:**
- Modify: `packages/region-split/src/analyze.ts`
- Modify: `packages/region-split/src/analyze.test.ts`

- [ ] **Step 1: 写两阶段分析失败测试**

新增以下行为测试：

```ts
it("analyzes elements after region analysis with a concurrency cap", async () => {
  const doc = await analyzeProject(store, coordinator, projectId, model, oldDoc.revision);
  expect(model.analyzeElements).toHaveBeenCalledTimes(doc.regions.length);
  expect(doc.elements.length).toBeGreaterThan(0);
  expect(Object.values(doc.elementAnalysis).every(item => item.status === "ready")).toBe(true);
});

it("returns regions and partial element failures without rejecting", async () => {
  model.analyzeElements.mockRejectedValueOnce(new Error("provider unavailable"));
  const doc = await analyzeProject(store, coordinator, projectId, model, oldDoc.revision);
  expect(doc.regions).not.toEqual(oldDoc.regions);
  expect(Object.values(doc.elementAnalysis).some(item => item.status === "failed")).toBe(true);
});

it("keeps old region elements until retry validation succeeds", async () => {
  await expect(retryRegionElementAnalysis(store, projectId, regionId, model, revision, fingerprint))
    .rejects.toThrow();
  expect(store.readDoc(projectId).elements).toEqual(before.elements);
});
```

另测全部元素失败仍返回新区域文档、区域分析失败不改旧文档、成功重试只替换指定区域元素、fingerprint 或 revision 过期不覆盖。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- analyze.test.ts`

Expected: FAIL，整图分析未调用元素模型且重试函数不存在。

- [ ] **Step 3: 实现两阶段提交语义**

明确修改整图分析签名并要求调用方提供基准版本：

```ts
export async function analyzeProject(
  store: ProjectStore,
  coordinator: ProjectWriteCoordinator,
  projectId: string,
  model: SegmentModel,
  expectedRevision: number,
): Promise<RegionSplitDoc>;
```

`analyzeProject` 先确认 `expectedRevision`，再在内存中生成新区域，为每区设置 `pending`，运行并发池，将成功元素与失败状态汇总成完整候选文档；随后在 `ProjectWriteCoordinator.run(projectId, ...)` 中通过 `commitDocument(projectId, expectedRevision, ...)` 再次校验并一次写入。分析期间任何其他写入都会使提交返回 `RevisionConflictError`，不得覆盖新编辑。失败区域元素为空，不继承旧区域 ID 空间的元素。

同时修改 `renameRegionWithModel`：签名接收 coordinator 与 `expectedRevision`，模型计算结束后在项目写队列内通过 `commitDocument` 校验并提交；只更新名称、类型和滚动属性，不改变区域 ID。

新增：

```ts
export async function retryRegionElementAnalysis(
  store: ProjectStore,
  coordinator: ProjectWriteCoordinator,
  projectId: string,
  regionId: string,
  model: SegmentModel,
  expectedRevision: number,
  expectedFingerprint: string,
): Promise<RegionSplitDoc>;
```

计算完成后重新进入项目写队列，比对 revision、区域存在性和 fingerprint；通过后原子替换该区域元素并标记 `ready`，否则抛 `RevisionConflictError` 或 `StaleAnalysisError`。

- [ ] **Step 4: 运行分析测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- analyze.test.ts element-analysis.test.ts`

Expected: PASS。

```powershell
git add packages/region-split/src/analyze.ts packages/region-split/src/analyze.test.ts
git commit -m "feat: run two-stage region element analysis"
```

---

### Task 8: 增加统一编辑和元素重试 HTTP API

**Files:**
- Modify: `packages/region-split/src/server.ts`
- Modify: `packages/region-split/src/server.test.ts`

- [ ] **Step 1: 写路由失败测试**

```ts
it("updates regions and elements with expectedRevision", async () => {
  const response = await app.inject({
    method: "PUT", url: `/api/projects/${projectId}/document`,
    payload: editablePayload(doc),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().doc.revision).toBe(doc.revision + 1);
});

it("returns 409 and the latest document for stale edits", async () => {
  const response = await app.inject({
    method: "PUT", url: `/api/projects/${projectId}/document`,
    payload: { ...editablePayload(doc), expectedRevision: doc.revision - 1 },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().doc.revision).toBe(doc.revision);
});

it("retries only one region element analysis", async () => {
  const response = await app.inject({
    method: "POST", url: `/api/projects/${projectId}/regions/${regionId}/analyze-elements`,
    payload: { expectedRevision: doc.revision, inputFingerprint: fingerprint },
  });
  expect(response.statusCode).toBe(200);
});
```

另测 `POST /analyze` 严格要求 `{ expectedRevision }` 并在过期时返回 `409`；`POST /rename-ai` 严格要求 `{ expectedRevision }`，模型计算期间版本变化时返回 `409`；以及 `422` schema/不变量错误、`404` 项目或区域不存在、`400` 模型未配置、过期 fingerprint 返回 `409`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- server.test.ts`

Expected: FAIL，新路由返回 404。

- [ ] **Step 3: 实现路由和错误映射**

创建单例 `ProjectWriteCoordinator` 供所有写入口使用。新增：

- `PUT /api/projects/:projectId/document`
- `POST /api/projects/:projectId/regions/:regionId/analyze-elements`

修改既有写路由：`POST /api/projects/:projectId/analyze` 和 `POST /api/projects/:projectId/regions/:regionId/rename-ai` 都严格接收 `{ expectedRevision }`，并把 coordinator 与版本传给分析函数；模型计算完成后的版本冲突统一返回带最新文档的 `409`。

统一编辑请求体必须严格解析：

```ts
const editableDocumentSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  regions: z.array(regionSchema),
  elements: z.array(elementNodeSchema),
  elementAnalysis: z.record(regionElementAnalysisSchema),
}).strict();
```

`RevisionConflictError` 和 `StaleAnalysisError` 映射为 `{ error, doc: latest }` 的 `409`；校验错误为 `422`；模型错误为 `502`。旧 `/regions` 路由暂时保留兼容，但同样进入协调器。

- [ ] **Step 4: 运行服务端测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test -- server.test.ts store.test.ts analyze.test.ts`

Expected: PASS。

```powershell
git add packages/region-split/src/server.ts packages/region-split/src/server.test.ts
git commit -m "feat: expose revision-safe element editing APIs"
```

---

### Task 9: 扩展前端 API 和完整编辑快照 store

**Files:**
- Modify: `apps/region-split-ui/src/api.ts`
- Create: `apps/region-split-ui/src/api.test.ts`
- Modify: `apps/region-split-ui/src/state.ts`
- Modify: `apps/region-split-ui/src/state.test.ts`
- Modify: `apps/region-split-ui/src/test-helpers.ts`

- [ ] **Step 1: 写 API、元素动作和撤销失败测试**

```ts
it("sends editable document state and expected revision", async () => {
  await httpApi.putDocument("project", editablePayload(doc));
  expect(fetch).toHaveBeenCalledWith("/api/projects/project/document", expect.objectContaining({
    method: "PUT",
    body: JSON.stringify(editablePayload(doc)),
  }));
});

it("preserves the latest document on a structured 409 error", async () => {
  await expect(httpApi.putDocument("project", editablePayload(doc))).rejects.toMatchObject({
    status: 409, latestDoc,
  });
});

it("undoes one element drag as one complete snapshot", () => {
  store.beginElementGesture("card");
  store.moveElement("card", 2, 0);
  store.moveElement("card", 3, 0);
  store.endElementGesture();
  store.undo();
  expect(elementById(store, "card").bounds.x).toBe(originalX);
});

it("does not persist during a gesture and persists once after release", async () => {
  store.beginElementGesture("card");
  store.moveElement("card", 4, 0);
  await vi.advanceTimersByTimeAsync(500);
  expect(api.putDocument).not.toHaveBeenCalled();
  store.endElementGesture();
  await vi.advanceTimersByTimeAsync(400);
  expect(api.putDocument).toHaveBeenCalledTimes(1);
});
```

另测添加、缩放、删除子树、重命名、改类型、调整父级、区域边界变化联动元素；`409` 且无未提交修改采用服务端文档，有修改则设置 `saveConflict` 并暂停保存；局部重试状态。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- api.test.ts state.test.ts`

Expected: FAIL，新 API 和 store 动作不存在。

- [ ] **Step 3: 实现结构化 API 错误**

在 `api.ts` 增加：

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly latestDoc?: RegionSplitDoc,
  ) { super(message); }
}

export interface EditablePayload {
  expectedRevision: number;
  regions: Region[];
  elements: ElementNode[];
  elementAnalysis: Record<string, RegionElementAnalysis>;
}
```

`StoreApi` 使用 `putDocument` 替代新前端中的 `putRegions`，增加 `retryElementAnalysis(projectId, regionId, expectedRevision, inputFingerprint)`，并把现有 `analyze(projectId)`、`renameAi(projectId, regionId)` 改为显式接收 `expectedRevision` 并发送 JSON 请求体。`json` 在非 2xx 时保留 body 中的 `doc`。

- [ ] **Step 4: 实现完整快照和元素动作**

在 `state.ts` 定义：

```ts
interface EditSnapshot {
  regions: Region[];
  elements: ElementNode[];
  elementAnalysis: Record<string, RegionElementAnalysis>;
  selectedRegionId: string | null;
  selectedElementId: string | null;
}

type CanvasMode = "select" | "split-region" | "add-element";
```

所有区域和元素动作先建立完整快照；手势只在开始时入栈一次，过程中只更新本地文档，结束时安排一次保存。增加 `selectedElementId`、`hoveredElementId`、`canvasMode`、`saveConflict`、`beginElementGesture/endElementGesture/cancelElementGesture` 及核心元素动作包装。移动与缩放后重新协调顶级元素归属并测试冲突自动清除。`retryElementAnalysis(regionId)` 必须先取消防抖并 `await persistNow()`，仅保存成功后使用返回文档的新 revision/fingerprint 请求重试；保存失败或存在 `saveConflict` 时禁止发起模型请求，并测试调用顺序。

整图分析发出前压入一个完整 `EditSnapshot`；成功响应作为单个可撤销步骤替换文档且不重复入栈，失败则移除预备快照。增加一次 `undo()` 恢复旧 `regions/elements/elementAnalysis/selection` 的测试。移除 `autoRenameStructuralResult` 对模型新 ID 的追踪，因为 AI 命名不再改变 ID。

- [ ] **Step 5: 运行 store 测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- api.test.ts state.test.ts`

Expected: PASS。

```powershell
git add apps/region-split-ui/src/api.ts apps/region-split-ui/src/api.test.ts apps/region-split-ui/src/state.ts apps/region-split-ui/src/state.test.ts apps/region-split-ui/src/test-helpers.ts
git commit -m "feat: add frontend element editing state"
```

---

### Task 10: 实现分析图元素框编辑器

**Files:**
- Create: `apps/region-split-ui/src/components/ElementOverlay.vue`
- Create: `apps/region-split-ui/src/components/ElementOverlay.test.ts`
- Modify: `apps/region-split-ui/src/coords.ts`
- Modify: `apps/region-split-ui/src/coords.test.ts`

- [ ] **Step 1: 写渲染和 Pointer Events 失败测试**

```ts
it("renders element bounds in display coordinates and conflict styling", () => {
  const wrapper = mountOverlay({ elements: [conflictElement] });
  expect(wrapper.get('[data-element-id="card"]').classes()).toContain("is-conflict");
  expect(wrapper.get('[data-element-id="card"]').attributes("style")).toContain("left: 10px");
});

it("moves a selected element between pointer down and pointer up", async () => {
  const wrapper = mountOverlay();
  await wrapper.get('[data-element-id="card"]').trigger("pointerdown", pointer(1, 20, 30));
  window.dispatchEvent(new PointerEvent("pointermove", pointer(1, 28, 35)));
  window.dispatchEvent(new PointerEvent("pointerup", pointer(1, 28, 35)));
  expect(store.moveElement).toHaveBeenCalledWith("card", 8, 5);
  expect(store.endElementGesture).toHaveBeenCalledOnce();
});

it("creates a manual element by dragging empty space in add mode", async () => {
  const wrapper = mountOverlay({ mode: "add-element" });
  await drag(wrapper.get(".element-overlay"), [10, 20], [80, 60]);
  expect(store.addElement).toHaveBeenCalledWith(expect.objectContaining({
    source: "manual", bounds: { x: 10, y: 20, w: 70, h: 40 },
  }));
});
```

另测四角缩放、最小 `4px`、图片边界、子元素父框约束、父元素缩放约束、`pointercancel`、失去捕获、卸载清理、输入事件不穿透到区域拆分。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- ElementOverlay.test.ts coords.test.ts`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 增加矩形坐标换算**

`coords.ts` 增加纯函数：

```ts
export function imageRectToDisplay(rect: Rect, scaleX: number, scaleY: number): Rect;
export function displayRectToImage(rect: Rect, scaleX: number, scaleY: number): Rect;
export function normalizeDragRect(start: Point, end: Point): Rect;
```

转换到文档前四舍五入整数；显示坐标可保留小数。

- [ ] **Step 4: 实现 ElementOverlay**

Props 接收 store、图片原始宽高、显示宽高和 `disabled`。模板为每个元素生成绝对定位框、标签和仅选中时显示的四角 handle。Pointer 会话保存 `pointerId`、起始图像坐标、原始 bounds 和操作类型；用 `setPointerCapture`，在 move 中从原始值计算累计差，避免增量漂移。空白拖拽仅在 `add-element` 模式生效。所有监听器在结束、取消和 `onBeforeUnmount` 清理。

- [ ] **Step 5: 运行组件测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- ElementOverlay.test.ts coords.test.ts`

Expected: PASS。

```powershell
git add apps/region-split-ui/src/components/ElementOverlay.vue apps/region-split-ui/src/components/ElementOverlay.test.ts apps/region-split-ui/src/coords.ts apps/region-split-ui/src/coords.test.ts
git commit -m "feat: add interactive element overlay"
```

---

### Task 11: 实现元素树、属性编辑和局部重试

**Files:**
- Create: `apps/region-split-ui/src/components/ElementTree.vue`
- Create: `apps/region-split-ui/src/components/ElementTree.test.ts`
- Modify: `apps/region-split-ui/src/components/RegionList.vue`
- Modify: `apps/region-split-ui/src/components/RegionList.test.ts`

- [ ] **Step 1: 写树和区域状态失败测试**

```ts
it("renders nested elements and synchronizes selection", async () => {
  const wrapper = mountTree([container, child]);
  expect(wrapper.get('[data-element-id="child"]').attributes("aria-level")).toBe("2");
  await wrapper.get('[data-element-id="child"]').trigger("click");
  expect(store.selectElement).toHaveBeenCalledWith("child");
});

it("edits name, type and parent through store actions", async () => {
  const wrapper = mountSelectedElement();
  await wrapper.get('[aria-label="元素名称"]').setValue("主标题");
  await wrapper.get('[aria-label="元素类型"]').setValue("text");
  await wrapper.get('[aria-label="父元素"]').setValue("hero");
  expect(store.renameElement).toHaveBeenCalledWith("title", "主标题");
  expect(store.changeElementType).toHaveBeenCalledWith("title", "text");
  expect(store.reparentElement).toHaveBeenCalledWith("title", "hero");
});

it("keeps elements visible while retrying a failed region", async () => {
  const wrapper = mountRegionList({ status: "failed", elements: [oldElement] });
  await wrapper.get('[aria-label="重新分析当前区域元素"]').trigger("click");
  expect(wrapper.find('[data-element-id="old"]').exists()).toBe(true);
});
```

另测四个整数属性输入 `x/y/w/h` 调用 `resizeElement`，拒绝非整数、`w/h < 4`、越出图片或父元素的输入且不改变文档；删除父节点提示“将删除 N 个子元素”、只按顶级冲突元素计数、`pending/analyzing/ready/stale/failed` 文案、不可形成循环的父级选项、区域上下箭头仍可用。还要覆盖树和画布双向 `hoveredElementId`、双向选择，以及选择后另一侧对应 `[data-element-id]` 调用 `scrollIntoView({ block: "nearest" })`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- ElementTree.test.ts RegionList.test.ts`

Expected: FAIL，元素树不存在。

- [ ] **Step 3: 实现递归 ElementTree**

组件根据 `parentId` 建立 `Map<string | null, ElementNode[]>`，递归渲染；使用 `aria-level`、`aria-selected`、稳定 `data-element-id`。属性面板只在选中元素时显示；名称在 `change` 提交，类型和父级在选择后立即提交；`x/y/w/h` 使用整数输入并组合为现有 `{ x, y, w, h }` 矩形提交给 `resizeElement`。父级候选排除自身及后代，并只包含同区域且矩形包含当前元素的容器。树节点与画布框都通过 store 更新 `selectedElementId/hoveredElementId`；选择变化后各组件对本侧对应元素调用 `scrollIntoView({ block: "nearest" })`。

- [ ] **Step 4: 装配 RegionList 状态和重试**

每个区域行下装配过滤后的顶级元素树；显示元素数、冲突数和分析状态。`failed`、`stale` 提供重试按钮；`analyzing` 禁用编辑但不隐藏旧元素。保留现有区域边界按钮、长按行为和 8px 门禁。

- [ ] **Step 5: 运行列表测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- ElementTree.test.ts RegionList.test.ts`

Expected: PASS。

```powershell
git add apps/region-split-ui/src/components/ElementTree.vue apps/region-split-ui/src/components/ElementTree.test.ts apps/region-split-ui/src/components/RegionList.vue apps/region-split-ui/src/components/RegionList.test.ts
git commit -m "feat: add region element tree editor"
```

---

### Task 12: 将元素模式装配到双图工作区和工具栏

**Files:**
- Modify: `apps/region-split-ui/src/components/ImageCanvas.vue`
- Modify: `apps/region-split-ui/src/components/ImageCanvas.test.ts`
- Modify: `apps/region-split-ui/src/components/Toolbar.vue`
- Modify: `apps/region-split-ui/src/components/Toolbar.test.ts`

- [ ] **Step 1: 写工作区装配和模式互斥失败测试**

```ts
it("renders element overlays only on the analysis image", () => {
  const wrapper = mountCanvas(readyStore);
  expect(wrapper.find(".original-pane [data-element-id]").exists()).toBe(false);
  expect(wrapper.find(".analysis-pane [data-element-id]").exists()).toBe(true);
});

it("makes split and add-element modes mutually exclusive", async () => {
  const wrapper = mountToolbar();
  await wrapper.get('[aria-label="添加元素框"]').trigger("click");
  expect(store.setCanvasMode).toHaveBeenCalledWith("add-element");
  expect(wrapper.get('[aria-label="拆分区域"]').attributes("aria-pressed")).toBe("false");
});

it("disables element editing before analysis is ready", () => {
  const wrapper = mountCanvas(unreadyStore);
  expect(wrapper.getComponent(ElementOverlay).props("disabled")).toBe(true);
});
```

另测 busy、全局分析失败、对应区域 `analyzing`、图片未测量、滚动缩放后的显示比例、元素事件不触发区域拆分。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- ImageCanvas.test.ts Toolbar.test.ts`

Expected: FAIL，元素覆盖层和新模式入口未装配。

- [ ] **Step 3: 装配画布与工具栏**

在 `ImageCanvas.vue` 的分析图层中，将 `ElementOverlay` 放在区域覆盖层之上并复用当前图片显示尺寸测量。区域分割线继续显示；金色候选线继续隐藏。点击元素阻止区域点击；模式为 `split-region` 时元素框只可选择不可移动，为 `add-element` 时区域分割手势禁用。

`Toolbar.vue` 增加“选择”和“添加元素框”，使用 `aria-pressed`；只有 `doc.analyzedAt` 存在且非 busy 时启用。模式切换调用 `store.setCanvasMode`，切换时先取消活动手势。

- [ ] **Step 4: 运行工作区测试并提交**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- ImageCanvas.test.ts Toolbar.test.ts ElementOverlay.test.ts`

Expected: PASS。

```powershell
git add apps/region-split-ui/src/components/ImageCanvas.vue apps/region-split-ui/src/components/ImageCanvas.test.ts apps/region-split-ui/src/components/Toolbar.vue apps/region-split-ui/src/components/Toolbar.test.ts
git commit -m "feat: integrate element editing workspace"
```

---

### Task 13: 完成错误对话框、快捷键和端到端回归

**Files:**
- Modify: `apps/region-split-ui/src/App.vue`
- Modify: `apps/region-split-ui/src/App.test.ts`
- Modify: `apps/region-split-ui/src/state.test.ts`
- Modify: `packages/region-split/src/server.test.ts`

- [ ] **Step 1: 写错误与快捷键失败测试**

```ts
it("shows an application dialog when every region element analysis failed", async () => {
  api.analyze.mockResolvedValue({ doc: allElementAnalysisFailedDoc });
  const wrapper = mountApp();
  await flushPromises();
  expect(wrapper.get('[role="dialog"]').text()).toContain("所有区域的元素分析均失败");
});

it("shows a save conflict dialog without overwriting local edits", async () => {
  api.putDocument.mockRejectedValue(new ApiError("conflict", 409, latestDoc));
  store.renameElement("element-a", "本地名称");
  await vi.advanceTimersByTimeAsync(400);
  expect(store.elementById("element-a")?.displayName).toBe("本地名称");
  expect(wrapper.get('[role="dialog"]').text()).toContain("文档已在其他操作中更新");
});

it("does not delete an element while an input owns keyboard focus", async () => {
  await wrapper.get('[aria-label="元素名称"]').trigger("keydown", { key: "Delete" });
  expect(store.deleteSelectedElement).not.toHaveBeenCalled();
});
```

另测 `Delete` 删除选中元素、`Escape` 取消手势/添加模式、`Ctrl+Z` 和 `Ctrl+Shift+Z`、全量重新分析替换提示、局部失败不弹全局对话框。

- [ ] **Step 2: 运行测试并确认失败**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test -- App.test.ts state.test.ts`

Expected: FAIL，新对话框和快捷键行为不存在。

- [ ] **Step 3: 实现应用级错误和键盘门禁**

`App.vue` 在分析返回后统计区域状态；仅全部为 `failed` 时显示应用内错误对话框。`saveConflict` 显示冲突对话框，提供“载入服务端版本”和“保留本地并重试”两个动作；后者必须先基于最新 revision 重新提交完整本地快照，不自动合并。

键盘处理先判断目标是否为 `input/textarea/select` 或 `contenteditable`；只有非编辑目标才处理删除、撤销和 Escape。整图重新分析按钮在存在元素或人工区域编辑时先显示替换确认。

- [ ] **Step 4: 运行全量验证**

Run: `D:\nodejs\corepack.cmd pnpm -r test`

Expected: core 与 UI 各自使用本包 Vitest/Vite 配置，全部测试 PASS。

Run: `D:\nodejs\corepack.cmd pnpm typecheck`

Expected: core 和 UI TypeScript/Vue 类型检查 PASS。

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui build`

Expected: Vite 生产构建成功，`apps/region-split-ui/dist` 生成，无构建错误。

- [ ] **Step 5: 清理构建产物并提交**

若 `dist` 未被跟踪，删除本次验证生成的目录，不删除 `.codebuddy` 或用户文件。

```powershell
git add apps/region-split-ui/src/App.vue apps/region-split-ui/src/App.test.ts apps/region-split-ui/src/state.test.ts packages/region-split/src/server.test.ts
git commit -m "feat: complete region element splitting workflow"
```

---

### Task 14: 规格覆盖审查与最终验证

**Files:**
- Verify: `docs/superpowers/specs/2026-08-13-region-element-component-splitting-design.md`
- Verify: all files changed by Tasks 1–13

- [ ] **Step 1: 逐条核对设计不变量**

确认以下行为均有自动测试：元素最小尺寸和图片边界、父子包含和无环、稳定区域 ID、区域边界重归属与冲突、最多 3 并发、局部/全部失败、过期 fingerprint、revision `409`、原子落盘、完整快照撤销、手势单次保存、树画布同步、分析门禁和卸载清理。

- [ ] **Step 2: 运行核心包完整测试和类型检查**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core test`

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/core typecheck`

Expected: 两条命令均 PASS，无跳过或仅执行单文件的测试。

- [ ] **Step 3: 运行 UI 完整测试、类型检查和构建**

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui test`

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui typecheck`

Run: `D:\nodejs\corepack.cmd pnpm --filter @region-split/ui build`

Expected: 三条命令均 PASS，生产构建成功。

- [ ] **Step 4: 检查工作树只包含预期文件**

Run: `git --no-pager status --short`

Run: `git --no-pager diff --check`

Expected: `diff --check` 无输出；不包含 `.npmrc`、`.codebuddy`、用户未跟踪目录或临时日志的意外修改。

- [ ] **Step 5: 请求代码审查并修复阻断问题**

使用 `requesting-code-review` 对照设计规格审查。任何阻断或重要问题均先新增失败测试，再修复并重新执行 Steps 2–4。

- [ ] **Step 6: 提交审查修复并推送当前分支**

只有存在审查修复时创建提交：

```powershell
git add packages/region-split apps/region-split-ui
git commit -m "test: strengthen region element splitting contracts"
```

最后按项目约定直接推送当前分支：

```powershell
git push origin HEAD
```
