# 修待办计数 + 补走查 Implementation Plan

**Goal:** 两件事——(1) 把永远清不掉的待办数字修对;(2) 补上一直欠着的真浏览器走查,尤其是"换成库图标之后和原图差多少"这个观察。顺带清理堆积的构建残留。

**Tech Stack:** TypeScript、Vitest、Vue 3。

## Global Constraints

- **不允许放宽任何断言**;改动先跑一次确认由红转绿。
- 命令用 `D:/nodejs/corepack.cmd pnpm`,测试要 `cd` 进包目录再跑。
  **根目录跑 `pnpm test` 会多出 4 个 fixture 路径相关的失败**,那是既有问题。
- **改了 `packages/region-split` 必须重启 API**(tsx 不热重载)。**Task 3 走查前务必重启**——
  上一轮验收就因为没重启,新路由报 404,差点被误判成"功能没做"。
- 收尾两个包都要干净:
  ```bash
  cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
  ```
  ```bash
  cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
  ```

---

### Task 1: 待办里的"未测字号"要和实际能测的对齐

**Files:**
- Modify: `packages/region-split/src/analysis-stats.ts`
- Modify: `packages/region-split/src/analysis-stats.test.ts`

**现在的写法:**

```ts
const textWithoutSize = trees.flatMap(tree => tree.nodes)
  .filter(node => node.kind === "text" && node.style.fontSize === undefined).length;
```

**问题:没有按 `textBox.ok` 过滤,而字号测量是按它过滤的。** `DetailNode.vue` 的 `measureAllFonts` 里:

```ts
if (node.kind !== "text" || node.textBox?.ok !== true || node.style.fontSize !== undefined) continue;
```

**框校验不通过的文字节点,按设计永远不会有 `fontSize`。** 于是"测量 N 个文字节点字号"这条待办
**永远减不到零**——基准图上有 6 个这样的框,就是 6 个清不掉的幽灵待办,`allPassed` 也就永远为假。

两条进入路径都会中招:

- `textBox.ok === false` —— 框圈错了(多包空白、混进非文字)
- `textBox === undefined` —— 没检查过(比如没配模型)

**修法:判据与 `measureAllFonts` 同源**——只数 `textBox?.ok === true` 的。
框不合格是另一类问题(得先把框改对),它自己会通过「框存疑」标记暴露出来,不该混进字号待办。

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/analysis-stats.test.ts`(沿用该文件已有的构造 helper;
若没有现成的造节点 helper,照文件里已有的写法造,**不要新建一套夹具体系**):

```ts
describe("未测字号的计数", () => {
  const textNode = (id: string, over: Record<string, unknown>) => ({
    id, parentId: null, box: { x: 0, y: 0, w: 40, h: 20 }, kind: "text" as const,
    displayName: "文字", style: {}, uniformity: 1, source: "auto" as const,
    classification: "model" as const, scrollX: false, scrollY: false,
    positioning: "flow" as const, ...over,
  });

  // 框校验不通过的节点，按设计永远不会被测字号——把它算进待办，
  // 这个数字就永远减不到零
  it("ignores text whose box failed the check", () => {
    const stats = statsWith([
      textNode("a", { textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" } }),
    ]);
    expect(stats.textWithoutSize).toBe(0);
  });

  // 没检查过的也测不了，同理不该算
  it("ignores text that was never checked", () => {
    expect(statsWith([textNode("a", {})]).textWithoutSize).toBe(0);
  });

  it("counts text that passed the check but has no size yet", () => {
    const stats = statsWith([
      textNode("a", { textBox: { ok: true, bands: 1, glyphAspect: 0.94 } }),
    ]);
    expect(stats.textWithoutSize).toBe(1);
  });

  it("stops counting once the size is measured", () => {
    const stats = statsWith([
      textNode("a", { textBox: { ok: true, bands: 1, glyphAspect: 0.94 }, style: { fontSize: 34 } }),
    ]);
    expect(stats.textWithoutSize).toBe(0);
  });

  // 只剩不合格的框时，这条待办应当消失，allPassed 才可能为真
  it("drops the todo when nothing measurable is left", () => {
    const stats = statsWith([
      textNode("a", { textBox: { ok: false, bands: 2, glyphAspect: 0.9, reason: "multi-band" } }),
    ]);
    expect(stats.todos.some(todo => todo.includes("字号"))).toBe(false);
  });
});
```

`statsWith(nodes)` 是个小 helper,把节点包成一棵树、配一个已解析的区域再调 `analysisStats`。
若该文件里已有等价的 helper,**用现成的**;没有就照文件风格加一个。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/analysis-stats.test.ts
```

Expected: 前两条 FAIL(得到 1,期望 0),第五条 FAIL。

- [ ] **Step 3: 改实现**

```ts
  // 判据必须和 DetailNode 的 measureAllFonts 同源：那边只测 textBox.ok === true 的，
  // 这边就只能数同一批。框不合格是另一类问题（得先把框改对），它自己会通过
  // 「框存疑」标记暴露出来；混进字号待办只会让这个数字永远清不掉。
  const textWithoutSize = trees.flatMap(tree => tree.nodes)
    .filter(node => node.kind === "text"
      && node.textBox?.ok === true
      && node.style.fontSize === undefined).length;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

Expected: 全绿,typecheck 无输出。

- [ ] **Step 5: 提交**

```bash
git add packages/region-split/src/analysis-stats.ts packages/region-split/src/analysis-stats.test.ts
git commit -m "fix: count only the text sizes that can actually be measured

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 忽略构建残留

**Files:**
- Modify: `.gitignore`(仓库 `ui/` 下那个)

工作区现在有 **13 个未跟踪的构建残留**:`dist-ai-panel-check/`、
`dist-analysis-materialization-final/`、`vite.config.ts.timestamp-*.mjs` 等,还在继续积累。
`.gitignore` 里只有 `dist/`,匹配不到 `dist-*`。

- [ ] **Step 1: 补规则**

在 `.gitignore` 里加:

```
dist-*/
*.timestamp-*.mjs
```

- [ ] **Step 2: 删掉已有的残留**

```bash
git clean -nd -- apps/region-split-ui
```

**先看 `-n` 的输出**,确认列出来的**全是** `dist-*` 目录和 `timestamp` 文件、没有别的东西,
再执行真删:

```bash
git clean -fd -- apps/region-split-ui
```

> **务必先看再删。** `git clean -fd` 不可撤销;列表里若出现任何不认识的路径,停下来问,不要执行。

- [ ] **Step 3: 提交**

```bash
git add .gitignore
git commit -m "chore: ignore the throwaway build output directories

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 真浏览器走查(这一步是本计划的产出)

前面两个任务是清场。**这一步才是欠着的东西**:图标库那条路到底能还原到什么程度,现在还是未知数。

- [ ] **Step 1: 起服务**

**Task 1 改了核心包,必须重启 API。**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm dev
```

另开终端:

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm dev
```

- [ ] **Step 2: 打开已有项目**

```
http://localhost:5180/#project=20260813-o11j2v
```

hash 能直接打开已有项目,**不必重新上传**。若该项目不存在,`ls data/projects/` 换一个,
或上传 `packages/region-split/test-fixtures/maicai.png` 重跑一遍。

- [ ] **Step 3: 逐条确认并记录**

1. 工作区能选字体栈;**刷新页面后仍是选中的那个**。
2. 待办提示里的数字**能减到零**——挑掉最后一个图标、测完字号后,"字号"那条应当消失
   (这是 Task 1 的实机验证)。
3. 解析一个区域,某个 icon 元素的属性面板出现图标行,**左边钉着原图切片**。
4. 点「换一个」出候选,选一个之后**元素解析图上的显示跟着变**。
5. 生成整页代码:挑过的图标是**内联 `<svg>`**、带 `currentColor`;没挑的是 **PNG 切图**,
   **不是空白**。
6. `assets/` 目录整个删掉后重新生成整页,**产物完全一致**(缓存是派生物,不是真相)。

- [ ] **Step 4: 量出图标的落差——这是核心观察**

在**整页比对**里,把叠加透明度拖到 50%,逐个看换成库图标的那些元素:

- **形状差多少**?(轮廓大致对得上,还是完全另一个东西)
- **颜色对不对**?(`currentColor` 有没有真的用上我们量到的墨色)
- **占位大小对不对**?(库图标是正方形,原图标框不一定,有没有变形或缩得太小)
- **哪几个图标换过去之后基本看不出差别,哪几个一眼就是错的**——**点名具体元素**

> 背景:实测 **20 个图标里 18 个是彩色插画**(3–8 种颜色),
> 「企业礼盒」「品类码」「买菜币」这类业务自定义图标,通用库里根本没有对应物。
> 所以**预期是落差明显**。这一步要回答的是"明显到什么程度、值不值得用库图标",
> 而不是证明它好用。

**不要写"基本没问题"这种话。** 这一步的价值全在具体:哪个图标差多少,才知道该不该
把默认策略从"库图标优先"改成"切图优先"。

- [ ] **Step 5: 写报告**

写进 `D:\workspace\.superpowers\sdd\todo-count-and-walkthrough-report.md`:

- Task 1 改了什么、红→绿的证据
- Task 2 删掉了哪些文件(把 `git clean -nd` 的输出贴上)
- **Step 3 的六条逐条结果**
- **Step 4 的图标落差观察,点名具体元素**
- 做不到的项**如实写明卡在哪**,不要声称看到了实际没看到的东西

---

## 完成标准

- 两个包测试全绿,两个 typecheck 无输出,前端 build 成功。
- 待办里的"未测字号"在只剩不合格框时为 **0**,`allPassed` 能变成真。
- 工作区没有 `dist-*` 残留,且以后不再产生。
- 报告里有 **Step 4 点名到具体图标的落差描述**。
