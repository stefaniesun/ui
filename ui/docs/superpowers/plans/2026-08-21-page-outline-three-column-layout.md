# 整页轮廓三栏布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将整页轮廓工作区改为左侧原图、中间可折叠结构树、右侧独立属性编辑区，并保持现有双向选择和校准接口。

**Architecture:** 仅在 `PageOutline.vue` 内增加会话级折叠状态和由 `parentHint` 推导的树索引，不修改后端 DTO 或状态层。左图、中树、右属性继续共享 `selectedId`；图片选中时展开祖先，中栏支持节点折叠和整栏收起。

**Tech Stack:** Vue 3 Composition API、TypeScript、Vue Test Utils、Vitest、CSS Grid

---

## 文件结构

- 修改 `apps/region-split-ui/src/components/PageOutline.vue`：三栏模板、树折叠状态、双向定位、响应式样式。
- 修改 `apps/region-split-ui/src/components/PageOutline.test.ts`：覆盖层级折叠、整栏收起、空状态、属性提交和既有联动。

不创建新的生产文件，不修改核心包、API 或 DTO。

### Task 1: 建立层级测试夹具和三栏结构

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`

- [ ] **Step 1: 写三栏和空属性状态的失败测试**

在测试夹具中把 `bad` 改为 `ok` 的子节点：

```ts
{
  id: "0-1000::bad",
  localId: "bad",
  regionKey: "0-1000",
  regionName: "页面",
  parentHint: "0-1000::ok",
  outlineNumber: "1.1.1",
  depth: 1,
  suspicious: true,
  box: { x: 20, y: 300, w: 40, h: 40 },
  kind: "icon",
  displayName: "可疑图标",
  style: {},
  uniformity: 1,
  source: "auto",
  classification: "uncertain",
  scrollX: false,
  scrollY: false,
  positioning: "flow",
}
```

增加测试：

```ts
it("renders image, collapsible tree, and independent property columns", () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
  expect(wrapper.get('[data-test="image-panel"]')).toBeTruthy();
  expect(wrapper.get('[data-test="tree-panel"]')).toBeTruthy();
  expect(wrapper.get('[data-test="property-panel"]')).toBeTruthy();
  expect(wrapper.get('[data-test="property-empty"]').text()).toContain("选择元素");
  expect(wrapper.find('[data-test="calibration"]').exists()).toBe(false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm --dir D:/workspace/ui/apps/region-split-ui test -- PageOutline.test.ts
```

Expected: FAIL，找不到 `image-panel`、`tree-panel` 或 `property-panel`。

- [ ] **Step 3: 实现最小三栏模板**

将工作区改为三个同级区域：

```vue
<section class="outline-workspace" :class="{ 'tree-panel-collapsed': treePanelCollapsed }">
  <div class="page-scroll" data-test="image-panel">
    <!-- 现有 page-stage -->
  </div>

  <aside class="tree-panel" data-test="tree-panel">
    <header class="panel-header">
      <strong>结构树</strong>
      <button type="button" data-test="collapse-tree-panel" @click="treePanelCollapsed = true">收起</button>
    </header>
    <div class="outline-tree" data-test="outline-tree"><!-- 树行 --></div>
  </aside>

  <button
    v-if="treePanelCollapsed"
    type="button"
    class="tree-panel-restore"
    data-test="restore-tree-panel"
    @click="treePanelCollapsed = false"
  >展开结构</button>

  <aside class="property-panel" data-test="property-panel">
    <form v-if="selected" class="calibration" data-test="calibration" @submit.prevent="save">
      <!-- 现有字段 -->
    </form>
    <div v-else class="property-empty" data-test="property-empty">选择元素后编辑属性</div>
  </aside>
</section>
```

脚本增加：

```ts
const treePanelCollapsed = ref(false);
```

桌面布局使用：

```css
.outline-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px 300px;
}
.outline-workspace.tree-panel-collapsed {
  grid-template-columns: minmax(0, 1fr) 34px 300px;
}
.page-scroll, .tree-panel, .property-panel { min-height: 0; }
.tree-panel, .property-panel { border-left: 1px solid #2a3342; background: #151a23; }
.tree-panel { display: flex; flex-direction: column; }
.property-panel { overflow: auto; }
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
pnpm --dir D:/workspace/ui/apps/region-split-ui test -- PageOutline.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交三栏骨架**

```powershell
git add apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git commit -m "feat: split page outline into three columns"
```

### Task 2: 实现节点折叠与图片选择自动展开祖先

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`

- [ ] **Step 1: 写节点折叠的失败测试**

```ts
it("collapses descendants without selecting the parent", async () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
  expect(wrapper.findAll(".tree-item")).toHaveLength(2);

  await wrapper.get('[data-test="tree-toggle-0-1000::ok"]').trigger("click");

  expect(wrapper.findAll(".tree-item")).toHaveLength(1);
  expect(wrapper.emitted("select")).toBeUndefined();

  await wrapper.get('[data-test="tree-toggle-0-1000::ok"]').trigger("click");
  expect(wrapper.findAll(".tree-item")).toHaveLength(2);
});
```

增加图片选择展开祖先测试：

```ts
it("expands ancestors when an image box selects a hidden descendant", async () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: null } });
  await wrapper.get('[data-test="tree-toggle-0-1000::ok"]').trigger("click");
  expect(wrapper.findAll(".tree-item")).toHaveLength(1);

  await wrapper.findAll(".element-box")[1]!.trigger("click");
  expect(wrapper.emitted("select")?.at(-1)).toEqual(["0-1000::bad"]);
  expect(wrapper.findAll(".tree-item")).toHaveLength(2);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm --dir D:/workspace/ui/apps/region-split-ui test -- PageOutline.test.ts
```

Expected: FAIL，折叠按钮不存在。

- [ ] **Step 3: 实现安全树索引和可见节点**

增加会话状态：

```ts
const collapsedIds = ref(new Set<string>());
```

增加索引计算，非法父级按顶层处理：

```ts
const elementById = computed(() => new Map(props.outline.elements.map(node => [node.id, node])));
const childrenById = computed(() => {
  const children = new Map<string, string[]>();
  for (const node of props.outline.elements) {
    const parentId = node.parentHint;
    if (!parentId || parentId === node.id || !elementById.value.has(parentId)) continue;
    const siblings = children.get(parentId) ?? [];
    siblings.push(node.id);
    children.set(parentId, siblings);
  }
  return children;
});
function ancestorsOf(id: string) {
  const ancestors: string[] = [];
  const visited = new Set([id]);
  let current = elementById.value.get(id);
  while (current?.parentHint && elementById.value.has(current.parentHint) && !visited.has(current.parentHint)) {
    visited.add(current.parentHint);
    ancestors.push(current.parentHint);
    current = elementById.value.get(current.parentHint);
  }
  return ancestors;
}
const visibleNodes = computed(() => props.outline.elements.filter(node =>
  !ancestorsOf(node.id).some(parentId => collapsedIds.value.has(parentId)),
));
```

增加折叠方法：

```ts
function toggleNode(id: string) {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
}
function expandAncestors(id: string) {
  const ancestors = new Set(ancestorsOf(id));
  if (!ancestors.size) return;
  collapsedIds.value = new Set([...collapsedIds.value].filter(nodeId => !ancestors.has(nodeId)));
}
```

树改为遍历 `visibleNodes`，树行内部增加独立箭头：

```vue
<button
  v-if="childrenById.has(node.id)"
  type="button"
  class="tree-toggle"
  :data-test="`tree-toggle-${node.id}`"
  :aria-expanded="!collapsedIds.has(node.id)"
  @click.stop="toggleNode(node.id)"
>{{ collapsedIds.has(node.id) ? "›" : "⌄" }}</button>
<span v-else class="tree-toggle-spacer" />
<button type="button" class="tree-item-content" @click="select(node.id, 'tree')">
  <span>{{ node.outlineNumber }}</span><strong>{{ node.displayName }}</strong><small>{{ node.kind }}</small>
</button>
```

在图片来源选择前调用：

```ts
function select(id: string, source: "tree" | "box") {
  if (source === "box") expandAncestors(id);
  emit("select", id);
  nextTick(() => {
    const target = source === "tree" ? boxRefs.get(id) : treeRefs.get(id);
    if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
  });
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
pnpm --dir D:/workspace/ui/apps/region-split-ui test -- PageOutline.test.ts
```

Expected: PASS，箭头点击没有 `select` 事件，图片点击恢复隐藏后代。

- [ ] **Step 5: 提交节点折叠**

```powershell
git add apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git commit -m "feat: add collapsible page outline tree"
```

### Task 3: 完成整栏收起、属性上下文和响应式布局

**Files:**
- Modify: `apps/region-split-ui/src/components/PageOutline.test.ts`
- Modify: `apps/region-split-ui/src/components/PageOutline.vue`

- [ ] **Step 1: 写整栏收起和属性上下文的失败测试**

```ts
it("collapses and restores the tree panel without hiding properties or selection", async () => {
  const wrapper = mount(PageOutline, { props: { projectId: "p1", outline, selectedId: "0-1000::bad" } });
  expect(wrapper.get('[data-test="property-panel"]').text()).toContain("可疑图标");
  expect(wrapper.get('[data-test="property-panel"]').text()).toContain("1.1.1");
  expect(wrapper.get('[data-test="property-panel"]').text()).toContain("页面");

  await wrapper.get('[data-test="collapse-tree-panel"]').trigger("click");
  expect(wrapper.get(".outline-workspace").classes()).toContain("tree-panel-collapsed");
  expect(wrapper.find('[data-test="outline-tree"]').exists()).toBe(false);
  expect(wrapper.get('[data-test="property-panel"]')).toBeTruthy();

  await wrapper.get('[data-test="restore-tree-panel"]').trigger("click");
  expect(wrapper.get('[data-test="outline-tree"]')).toBeTruthy();
  expect(wrapper.get(".tree-item.selected").text()).toContain("可疑图标");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm --dir D:/workspace/ui/apps/region-split-ui test -- PageOutline.test.ts
```

Expected: FAIL，属性上下文或收起后的树隐藏行为不完整。

- [ ] **Step 3: 完成属性头部和收起恢复控制**

属性表单顶部增加只读上下文：

```vue
<header class="property-heading">
  <div>
    <small>{{ selected.outlineNumber }} · {{ selected.regionName }}</small>
    <strong>{{ selected.displayName }}</strong>
  </div>
  <span v-if="selected.suspicious" class="suspicious-badge">可疑</span>
</header>
```

中栏根据状态条件渲染：

```vue
<aside v-if="!treePanelCollapsed" class="tree-panel" data-test="tree-panel">
  <!-- header + tree -->
</aside>
<button v-else type="button" class="tree-panel-restore" data-test="restore-tree-panel" @click="treePanelCollapsed = false">
  <span>›</span><span>结构</span>
</button>
```

完成样式：

```css
.panel-header, .property-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid #2a3342;
}
.outline-tree { flex: 1; min-height: 0; overflow: auto; padding: 8px; }
.property-empty { display: grid; min-height: 180px; place-items: center; padding: 24px; color: #8192aa; text-align: center; }
.tree-panel-restore { min-width: 0; border: 0; border-left: 1px solid #2a3342; color: #93a4bb; background: #151a23; cursor: pointer; writing-mode: vertical-rl; }
.suspicious-badge { border: 1px solid #b66d13; border-radius: 999px; padding: 2px 7px; color: #ffd38a; background: #4a2e0d; font-size: 11px; }
```

响应式规则：

```css
@media (max-width: 900px) {
  .outline-workspace,
  .outline-workspace.tree-panel-collapsed {
    grid-template-columns: minmax(0, 1fr) minmax(260px, 38vw);
    grid-template-rows: minmax(55vh, 1fr) 320px;
  }
  .page-scroll { grid-column: 1 / -1; }
  .tree-panel, .tree-panel-restore { border-top: 1px solid #2a3342; border-left: 0; }
  .property-panel { border-top: 1px solid #2a3342; }
}
@media (max-width: 640px) {
  .outline-workspace,
  .outline-workspace.tree-panel-collapsed {
    display: flex;
    flex-direction: column;
    overflow: auto;
  }
  .page-scroll { min-height: 55vh; }
  .tree-panel, .property-panel { min-height: 280px; }
  .tree-panel-restore { min-height: 34px; writing-mode: horizontal-tb; }
}
```

- [ ] **Step 4: 运行组件测试、类型检查和构建**

Run:

```powershell
pnpm --dir D:/workspace/ui/apps/region-split-ui test -- PageOutline.test.ts
pnpm --dir D:/workspace/ui/apps/region-split-ui typecheck
pnpm --dir D:/workspace/ui/apps/region-split-ui build
```

Expected: 全部退出码为 0。

- [ ] **Step 5: 提交完整交互和样式**

```powershell
git add apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
git commit -m "feat: complete responsive outline workspace"
```

### Task 4: 回归验证与真实浏览器验收

**Files:**
- Verify: `apps/region-split-ui/src/components/PageOutline.vue`
- Verify: `apps/region-split-ui/src/components/PageOutline.test.ts`

- [ ] **Step 1: 运行前端完整测试**

Run:

```powershell
pnpm --dir D:/workspace/ui/apps/region-split-ui test
```

Expected: 全部测试通过。

- [ ] **Step 2: 运行工作区类型检查和格式检查**

Run:

```powershell
pnpm --dir D:/workspace/ui typecheck
git diff --check
```

Expected: 两条命令退出码为 0；已知基准图相对路径问题不影响本次前端包测试。

- [ ] **Step 3: 启动当前分支前端和 API**

使用项目已有开发命令启动 API 与 UI，确认 API 使用当前 `dev` 代码而非占用端口的旧进程。前端应能访问一个已有整页轮廓项目。

- [ ] **Step 4: 在真实浏览器逐项验收**

验证：

1. 默认显示原图、结构树、属性三栏。
2. 树节点箭头可隐藏和恢复后代，且不会误选父节点。
3. 点击树行能定位原图框。
4. 折叠父节点后点击其后代图片框，会自动展开祖先并定位树行。
5. 收起结构栏后原图空间扩大，右栏仍可编辑；恢复后选择不丢失。
6. 右栏显示名称、编号、所属区域和可疑标记。
7. 分类、文字和元素框保存仍生效。
8. 在窄视口下不出现覆盖原图的抽屉，所有区域仍可滚动访问。

- [ ] **Step 5: 检查最终差异并提交必要修正**

Run:

```powershell
git status --short
git diff --check
git --no-pager diff HEAD~3 -- apps/region-split-ui/src/components/PageOutline.vue apps/region-split-ui/src/components/PageOutline.test.ts
```

Expected: 无未提交的本次功能文件；差异只涉及计划内的两个前端文件。
