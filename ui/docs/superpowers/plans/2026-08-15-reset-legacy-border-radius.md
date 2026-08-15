# 旧圆角默认关闭实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 载入任意已有元素树时清除全部旧圆角，使所有元素默认直角，同时保留 `image`、`component` 的人工圆角编辑能力。

**Architecture:** 在前端 Store 的载入边界统一规范化服务端元素树，克隆带旧 `borderRadius` 的节点样式并删除该字段；不在载入时自动发起保存。属性面板和预览继续只消费 Store 中的规范化节点，因此旧允许类型也默认关闭，而用户载入后人工写入的正值仍立即显示并在下一次编辑请求中持久化。

**Tech Stack:** TypeScript、Vue 3、Vitest、Vue Test Utils、pnpm

---

## 文件结构

- `apps/region-split-ui/src/element-state.ts`：在元素树进入 Store 时执行旧圆角清理，并保证正常保存会持久化清理结果。
- `apps/region-split-ui/src/element-state.test.ts`：覆盖所有类型的载入清理、无自动保存、后续保存和人工开启行为。
- `apps/region-split-ui/src/components/ElementProperties.test.ts`：保留属性面板对规范化状态和人工圆角的交互回归覆盖。
- `apps/region-split-ui/src/components/ElementOverlay.test.ts`：保留预览对清理后直角和人工圆角的回归覆盖。

### Task 1: 在 Store 载入边界清除全部旧圆角

**Files:**
- Modify: `apps/region-split-ui/src/element-state.test.ts:265-337`
- Modify: `apps/region-split-ui/src/element-state.ts:47-79`

- [ ] **Step 1: 编写载入清理失败测试**

将“允许类型切换时保留旧圆角”的测试替换为载入迁移测试，并覆盖允许与不允许类型：

```ts
it("clears every legacy radius while loading without saving automatically", async () => {
  const api = loaded([
    node({ id: "n1", kind: "component", style: { background: "#fff", borderRadius: 12 } }),
    node({ id: "n2", kind: "image", style: { borderRadius: 8 } }),
    node({ id: "n3", kind: "text", style: { color: "#111111", borderRadius: 6 } }),
  ]);
  const store = createElementStore(api);

  await store.load("p1", REGION);

  expect(store.tree.value!.nodes.map(item => item.style)).toEqual([
    { background: "#fff" },
    {},
    { color: "#111111" },
  ]);
  expect(api.putElements).not.toHaveBeenCalled();
});
```

增加后续正常保存会携带清理结果的测试：

```ts
it("persists cleared legacy radii on the next normal save", async () => {
  const api = loaded([
    node({ id: "n1", kind: "component", style: { borderRadius: 12 } }),
  ]);
  const store = createElementStore(api);
  await store.load("p1", REGION);

  await store.rename("p1", REGION, "n1", "卡片");

  expect(api.putElements).toHaveBeenCalledWith("p1", REGION, expect.objectContaining({
    nodes: [expect.objectContaining({ displayName: "卡片", style: {} })],
  }));
});
```

- [ ] **Step 2: 运行定向测试并确认失败**

Run:

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui test -- src/element-state.test.ts
```

Expected: FAIL，载入后的 `component` 和 `image` 仍含 `borderRadius`。

- [ ] **Step 3: 实现纯函数清理和载入规范化**

在 `supportsBorderRadius()` 后增加不修改 API 返回对象的纯函数：

```ts
function clearBorderRadii(nodes: ElementNode[]): ElementNode[] {
  return nodes.map(node => {
    if (node.style.borderRadius === undefined) return node;
    const style = { ...node.style };
    delete style.borderRadius;
    return { ...node, style };
  });
}

function clearTreeBorderRadii(next: ElementTree | null): ElementTree | null {
  return next ? { ...next, nodes: clearBorderRadii(next.nodes) } : null;
}
```

将 `load()` 的赋值改为：

```ts
const loaded = (await api.getElements(projectId, region.y, region.h)).tree;
tree.value = clearTreeBorderRadii(loaded);
```

同时简化 `commit()`：载入边界已清除旧数据，后续人工设置必须保留，因此不再按类型二次清除所有节点：

```ts
const edited: ElementTree = { ...current, nodes: next };
```

`setKind()` 仍保留切换到不支持类型时删除圆角的防线。

- [ ] **Step 4: 运行定向测试并确认通过**

Run:

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui test -- src/element-state.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 Store 迁移**

```powershell
git add apps/region-split-ui/src/element-state.ts apps/region-split-ui/src/element-state.test.ts
git commit -m "fix: clear legacy border radius on load"
```

### Task 2: 校准属性面板和预览回归测试

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementProperties.test.ts:209-266`
- Modify: `apps/region-split-ui/src/components/ElementOverlay.test.ts:48-68`

- [ ] **Step 1: 明确属性面板只反映 Store 规范化后的状态**

将测试名称调整为人工正值语义，并保留正值开启断言：

```ts
it("shows a radius after the user has enabled it", () => {
  const manuallyRounded = { ...node, style: { background: "#ffffff", borderRadius: 8 } };
  const wrapper = mount(ElementProperties, { props: { node: manuallyRounded } });
  expect((wrapper.find('[data-test="border-radius-toggle"]').element as HTMLInputElement).checked)
    .toBe(true);
  expect((wrapper.find('[data-test="property-radius"]').element as HTMLInputElement).value)
    .toBe("8");
});
```

保留并确认无圆角节点首次开启提交 `8`、关闭提交 `0`、仅 `image` 和 `component` 显示入口。

- [ ] **Step 2: 明确预览只渲染人工写入的正值**

将正圆角预览测试命名调整为人工圆角，并保持现有类型防线：

```ts
it("renders a user-set positive radius only for images and components", () => {
  for (const kind of ["image", "component"] as const) {
    const wrapper = mountOverlay({
      nodes: [node({ id: "n1", kind, style: { borderRadius: 8 } })],
    });
    expect(wrapper.find('[data-test="element-box"]').attributes("style"))
      .toContain("border-radius");
  }
  const unsupported = mountOverlay({
    nodes: [node({ id: "n1", kind: "text", style: { borderRadius: 8 } })],
  });
  expect(unsupported.find('[data-test="element-box"]').attributes("style"))
    .not.toContain("border-radius");
});
```

- [ ] **Step 3: 运行组件测试**

Run:

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui test -- src/components/ElementProperties.test.ts src/components/ElementOverlay.test.ts
```

Expected: PASS；若失败，只修正与最新规格冲突的断言，不改变已确认的交互实现。

- [ ] **Step 4: 提交测试语义更新**

```powershell
git add apps/region-split-ui/src/components/ElementProperties.test.ts apps/region-split-ui/src/components/ElementOverlay.test.ts
git commit -m "test: clarify manual border radius behavior"
```

### Task 3: 完整验证和交付

**Files:**
- Modify only if verification exposes a defect: `apps/region-split-ui/src/element-state.ts`
- Modify only if verification exposes a defect: `apps/region-split-ui/src/element-state.test.ts`
- Modify only if verification exposes a defect: `apps/region-split-ui/src/components/ElementProperties.vue`
- Modify only if verification exposes a defect: `apps/region-split-ui/src/components/ElementProperties.test.ts`
- Modify only if verification exposes a defect: `apps/region-split-ui/src/components/ElementOverlay.vue`
- Modify only if verification exposes a defect: `apps/region-split-ui/src/components/ElementOverlay.test.ts`

- [ ] **Step 1: 运行 UI 全量测试、类型检查和构建**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui test
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui typecheck
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/ui build
```

Expected: 三条命令退出码均为 `0`。

- [ ] **Step 2: 运行核心包回归验证**

```powershell
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core test
node D:/workspace/ui/.corepack/v1/pnpm/10.13.1/bin/pnpm.cjs --filter @region-split/core typecheck
```

Expected: 两条命令退出码均为 `0`，自动检测仍不产生圆角。

- [ ] **Step 3: 检查改动边界**

```powershell
git diff --check
git status --short
git --no-pager diff origin/feature/region-split...HEAD --stat
```

Expected: 无空白错误；`.npmrc` 仍保持用户原有未提交状态且不进入任何提交；没有无关文件进入差异。

- [ ] **Step 4: 代码审查并修正缺陷**

检查以下不变量：

1. `load()` 清理所有类型的旧 `borderRadius`，但不调用 `putElements()`。
2. 清理时保留样式中的 `background`、`color`、字体等其他字段。
3. 用户载入后通过 `setRadius(..., 8)` 设置的圆角不会被 `commit()` 删除。
4. 切换到不支持类型仍删除当前人工圆角。
5. 属性面板和叠加预览仅允许 `image`、`component`。

若修正代码，重新执行 Step 1 和 Step 2，并提交修复：

```powershell
git add apps/region-split-ui/src
git commit -m "fix: preserve manual radius after legacy cleanup"
```

- [ ] **Step 5: 推送当前分支**

```powershell
git push origin feature/region-split
```

Expected: `origin/feature/region-split` 更新到本地 `HEAD`，且 `.npmrc` 未被提交。
