# Selected Icon SVG Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在元素属性面板中展示当前已匹配并物化的 SVG 图标，使用户能直接查看图标外观。

**Architecture:** 保持现有图标决策和持久化链路不变，在 `ElementProperties.vue` 内根据 `projectId` 与库图标节点的 `asset.ref` 派生项目资产 URL。库图标预览使用普通 `<img>` 加载实际 SVG 资产；原图裁片和图标挑选弹框继续使用原有逻辑。

**Tech Stack:** Vue 3、TypeScript、Vue Test Utils、Vitest、CSS

---

## 文件结构

- 修改 `apps/region-split-ui/src/components/ElementProperties.vue`：派生库图标资产 URL并渲染 SVG 预览。
- 修改 `apps/region-split-ui/src/components/ElementProperties.test.ts`：覆盖 SVG URL、替代文本和原图状态隔离。

### Task 1: 已匹配 SVG 图标预览

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementProperties.vue:53-70,270-293,534-536`
- Test: `apps/region-split-ui/src/components/ElementProperties.test.ts:15-68`

- [ ] **Step 1: 编写失败测试**

在 `ElementProperties.test.ts` 的图标相关测试中增加：

```ts
it("shows the materialized SVG for a selected library icon", () => {
  const icon: ElementNode = {
    ...node,
    kind: "icon",
    displayName: "消息",
    asset: { ref: "assets/icons/mdi chat.svg", mime: "image/svg+xml" },
    iconDecision: {
      kind: "library",
      iconId: "mdi:chat-processing-outline",
      query: "chat",
      candidates: ["mdi:chat-processing-outline"],
    },
  };
  const wrapper = mount(ElementProperties, {
    props: { node: icon, projectId: "project one" },
    global: { stubs: { Teleport: true } },
  });

  const preview = wrapper.get('[data-test="selected-icon-preview"]');
  expect(preview.attributes("src")).toBe(
    "/api/projects/project%20one/assets/assets%2Ficons%2Fmdi%20chat.svg",
  );
  expect(preview.attributes("alt")).toBe("mdi:chat-processing-outline 图标预览");
  expect(wrapper.text()).toContain("mdi:chat-processing-outline");
});

it("does not show a library SVG preview for a crop decision", () => {
  const icon: ElementNode = {
    ...node,
    kind: "icon",
    displayName: "消息",
    asset: { ref: "assets/message.png", mime: "image/png" },
    iconDecision: {
      kind: "crop",
      assetRef: "assets/message.png",
      reason: "用户保留原图",
    },
  };
  const wrapper = mount(ElementProperties, {
    props: { node: icon, projectId: "p1" },
    global: { stubs: { Teleport: true } },
  });

  expect(wrapper.find('[data-test="selected-icon-preview"]').exists()).toBe(false);
  expect(wrapper.get(".icon-crop-preview").attributes("src"))
    .toBe("/api/projects/p1/assets/assets%2Fmessage.png");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @region-split/ui test -- ElementProperties.test.ts`

Expected: FAIL，因为 `[data-test="selected-icon-preview"]` 尚不存在。

- [ ] **Step 3: 实现最小功能**

在 `ElementProperties.vue` 增加库图标 URL：

```ts
const selectedIconSrc = computed(() => {
  if (props.node?.iconDecision?.kind !== "library") return "";
  const assetRef = props.node.asset?.ref;
  if (!props.projectId || !assetRef) return "";
  return `/api/projects/${encodeURIComponent(props.projectId)}/assets/${encodeURIComponent(assetRef)}`;
});
```

将库图标文本替换为预览行：

```vue
<div v-if="props.node.iconDecision?.kind === 'library'" class="selected-icon">
  <img
    v-if="selectedIconSrc"
    data-test="selected-icon-preview"
    class="selected-icon-preview"
    :src="selectedIconSrc"
    :alt="`${props.node.iconDecision.iconId} 图标预览`"
  />
  <p>已选择 {{ props.node.iconDecision.iconId }}</p>
</div>
```

增加样式：

```css
.selected-icon { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
.selected-icon p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.selected-icon-preview { flex: none; width: 40px; height: 40px; object-fit: contain; background: #fff; }
```

- [ ] **Step 4: 运行组件测试并确认通过**

Run: `pnpm --filter @region-split/ui test -- ElementProperties.test.ts`

Expected: `ElementProperties.test.ts` 全部 PASS。

- [ ] **Step 5: 执行 UI 包验证**

Run: `pnpm --filter @region-split/ui typecheck && pnpm --filter @region-split/ui test && pnpm --filter @region-split/ui build`

Expected: 类型检查、UI 全量测试和生产构建均成功。

- [ ] **Step 6: 提交并推送**

```bash
git add apps/region-split-ui/src/components/ElementProperties.vue apps/region-split-ui/src/components/ElementProperties.test.ts docs/superpowers/plans/2026-08-21-selected-icon-svg-preview.md
git commit -m "feat: preview selected svg icon"
git push
```

Expected: 提交创建成功并推送到当前 `feature/region-split` 分支；若网络仍异常，保留本地提交并报告具体原因。
