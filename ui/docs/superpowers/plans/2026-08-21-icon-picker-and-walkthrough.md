# 图标挑选器修正 + 走查 Implementation Plan

**Goal:** 修掉图标匹配链路上的三处问题,再做那条一直欠着的走查——**换成库图标之后和原图差多少**。

**Tech Stack:** TypeScript、Vue 3、Vitest。

## 承接

`2026-08-19-fix-todo-count-and-walk-through.md` 的 Task 1(待办判据)与 Task 2(忽略构建残留)**已完成**,不必重做。**只剩那份的走查没做**,并入本文最后一个任务。

## 现状(动手前已核实)

图标链路是这样的,**比"关键词搜不到就用图"多一步**:

```
模型给 iconKeywords → 本地 mdi 检索出候选 → 把切图 + 候选 SVG 一起发回模型 → 模型定 kind
```

`kind` 三态:`library`(挑中某个库图标)/ `crop`(都不像,用切图)/ `ambiguous`(定不了)。

基准项目 4 个图标的实际结果:

```
设置      keywords=["settings","gear","configuration"]  → library: mdi:gear-outline
消息      keywords=["chat","message","bubble"]          → crop
应用菜单  keywords=["apps","grid","menu"]                → crop
用户头像  keywords=["用户头像"]                          → crop
```

**候选是有的**——实测 `chat` 能搜出 8 个含 `chat-bubble`、`chat-bubble-outline`。
所以 3/4 走切图是**模型看过之后的判断**,不是链路失灵。这与早先的实测一致:
原图那个「消息」是**实心气泡**,mdi 里多是**描边**款;20 个图标里 18 个是彩色/实心插画。

**要修的是另外三处。**

## Global Constraints

- **不允许放宽任何断言**;每处改动先跑一次确认由红转绿。
- 命令用 `D:/nodejs/corepack.cmd pnpm`,测试要 `cd` 进包目录再跑。
  **根目录跑 `pnpm test` 会多出 4 个 fixture 路径相关的失败**,那是既有问题。
- **改了 `packages/region-split` 必须重启 API**(tsx 不热重载)。**Task 4 走查前务必重启。**
- 收尾两个包都要干净:
  ```bash
  cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
  ```
  ```bash
  cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
  ```

---

### Task 1: 关键词兜底不许用中文

**Files:**
- Modify: `packages/region-split/src/analyze-elements.ts`
- Modify: `packages/region-split/src/analyze-elements.test.ts`

**问题:** 模型没给 `iconKeywords` 时,代码回落到用元素名去搜:

```ts
const keywords = node.iconKeywords?.length ? node.iconKeywords : [node.text?.trim() || node.displayName.trim()];
```

而元素名是**中文**(「用户头像」)。拿中文去匹配 mdi 的英文图标名**必然零命中**,候选是空的,
模型只能选 `crop`。

**更糟的是看不出来**:结果和"搜过了、没有合适的"长得一模一样。人看到「保留原图裁片」,
以为是判断结果,实际上根本没搜过。

**修法:没有可用的英文关键词时,直接标 `ambiguous`,别假装搜过。**

判据:关键词里**至少有一个含 ASCII 字母**才算可用。不要试图翻译中文——那是另一个问题,
而且模型本来就该给英文(prompt 里写了)。

- [ ] **Step 1: 写失败的测试**

追加到 `packages/region-split/src/analyze-elements.test.ts`(沿用该文件已有的构造 helper 与模型桩):

```ts
describe("图标关键词兜底", () => {
  // 中文搜不到任何 mdi 图标名。拿它去搜等于假装搜过，
  // 结果和"搜过了没合适的"长得一模一样，人分不出来
  it("marks an icon ambiguous when no usable keyword exists", async () => {
    const model = iconModelStub();
    const [node] = await decideIcons(model, sourceImage(), [
      iconNode({ displayName: "用户头像" }),   // 没有 iconKeywords
    ]);
    expect(node!.iconDecision?.kind).toBe("ambiguous");
    expect(model.decideIcon).not.toHaveBeenCalled();   // 根本不该问模型
  });

  it("still uses english keywords when the model gave them", async () => {
    const model = iconModelStub({ kind: "library", iconId: "mdi:gear", query: "gear", candidates: ["mdi:gear"] });
    const [node] = await decideIcons(model, sourceImage(), [
      iconNode({ displayName: "设置", iconKeywords: ["settings", "gear"] }),
    ]);
    expect(node!.iconDecision?.kind).toBe("library");
    expect(model.decideIcon).toHaveBeenCalled();
  });

  // 混着给的时候，只用能搜的那些
  it("keeps only the keywords that can match", async () => {
    const model = iconModelStub({ kind: "crop", assetRef: "", reason: "都不像" });
    await decideIcons(model, sourceImage(), [
      iconNode({ displayName: "消息", iconKeywords: ["消息", "chat"] }),
    ]);
    expect(model.decideIcon).toHaveBeenCalled();
  });
});
```

`decideIcons` / `iconModelStub` / `iconNode` / `sourceImage` 若在该文件里叫别的名字,
**用真实的名字**,不要新建一套夹具体系。若被测函数没有导出,导出它。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm exec vitest run src/analyze-elements.test.ts
```

- [ ] **Step 3: 实现**

```ts
    // mdi 的图标名全是英文，中文关键词一个都匹配不上。没有可用关键词时
    // 直接标 ambiguous 等人处理——拿中文去搜等于假装搜过，而"搜过了没合适的"
    // 和"根本没搜"在界面上长得一模一样，人分不出来。
    const usable = (node.iconKeywords ?? []).filter(keyword => /[a-z]/i.test(keyword));
    if (usable.length === 0) {
      return {
        ...node,
        iconDecision: {
          kind: "ambiguous" as const,
          query: node.displayName,
          candidates: [],
          keywords: node.iconKeywords ?? [],
          by: "model" as const,
        },
      };
    }
```

**注意** `ambiguous` 的 schema 要求 `candidates` 至少一项(`.min(1)`)。
**要么放宽成允许空数组**(并在 schema 注释里写明"没有可用关键词时没有候选"),
**要么换个表达方式**——自己读一遍 `iconDecisionSchema` 决定,并在报告里说明选了哪种、为什么。

后面的 `keywords` / `query` 用 `usable` 而不是原始 `keywords`。

- [ ] **Step 4: 跑测试并提交**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec tsc --noEmit -p tsconfig.json
```

```bash
git add packages/region-split/src
git commit -m "fix: stop pretending a chinese keyword searched the icon set

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 挑选器改成弹框

**Files:**
- Create: `apps/region-split-ui/src/components/IconPickerDialog.vue`
- Create: `apps/region-split-ui/src/components/IconPickerDialog.test.ts`
- Modify: `apps/region-split-ui/src/components/ElementProperties.vue`
- Modify: `apps/region-split-ui/src/components/ElementProperties.test.ts`

**问题:** 现在是属性面板里内嵌的一条搜索框 + 3 列小格子。面板窄,格子小,没法浏览;
而且**原图切片和候选不并排**,只能凭记忆比。

**要做成:**

```
┌─────────────────────────────────────────┐
│ 选择图标                           [×]  │
├──────────┬──────────────────────────────┤
│ 原图切片  │ [搜索框              ] [搜索] │
│  (常驻)  │ ┌────┬────┬────┬────┬────┐  │
│          │ │ 候 │ 选 │ 网 │ 格 │ …  │  │
│ 当前选中  │ └────┴────┴────┴────┴────┘  │
│  (预览)  │                              │
├──────────┴──────────────────────────────┤
│              [用原图切片]  [取消]  [确定] │
└─────────────────────────────────────────┘
```

**三条不能省的:**

1. **原图切片常驻左侧** —— 不并排就没法判断像不像,这是整个挑选动作的依据。
2. **打开时用模型给的英文关键词预填并自动搜一次** —— 一进来就有候选可看。
   没有可用关键词时(Task 1 的 `ambiguous`),搜索框留空并提示"模型没给关键词,请手动搜索"。
3. **「用原图切片」是一个明确的按钮** —— 挑不到合适的是常见结果(实测 3/4),
   它得是个正当选择,而不是"关掉弹框什么都不做"。

**Interfaces:**
- props:`{ open: boolean; cropSrc: string; initialQuery: string; currentIconId?: string; api: { searchIcons(query, limit): Promise<{ candidates: { id: string; name: string; svg: string }[] }> } }`
- emits:`{ confirm: [iconId: string, candidates: string[], query: string]; "use-crop": []; close: [] }`

- [ ] **Step 1: 写失败的测试**

创建 `apps/region-split-ui/src/components/IconPickerDialog.test.ts`:

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import IconPickerDialog from "./IconPickerDialog.vue";

const candidates = [
  { id: "mdi:chat", name: "chat", svg: "<svg><path d='M0 0'/></svg>" },
  { id: "mdi:chat-bubble", name: "chat-bubble", svg: "<svg><path d='M1 1'/></svg>" },
];
const stubApi = () => ({ searchIcons: vi.fn(async () => ({ candidates })) });
const mountDialog = (over = {}, api = stubApi()) => mount(IconPickerDialog, {
  props: { open: true, cropSrc: "data:image/png;base64,AAAA", initialQuery: "chat", api, ...over },
});

describe("IconPickerDialog", () => {
  // 不并排就没法判断像不像，这是整个挑选动作的依据
  it("keeps the crop visible beside the candidates", () => {
    expect(mountDialog().find('[data-test="picker-crop"]').attributes("src"))
      .toBe("data:image/png;base64,AAAA");
  });

  // 一进来就该有候选可看，不要让人先自己搜一次
  it("searches the initial query on open", async () => {
    const api = stubApi();
    mountDialog({}, api);
    await nextTick(); await nextTick();
    expect(api.searchIcons).toHaveBeenCalledWith("chat", expect.any(Number));
  });

  it("says so when there is no keyword to start from", async () => {
    const api = stubApi();
    const wrapper = mountDialog({ initialQuery: "" }, api);
    await nextTick();
    expect(api.searchIcons).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="picker-hint"]').text()).toContain("手动搜索");
  });

  it("confirms the picked icon with the candidate list", async () => {
    const wrapper = mountDialog();
    await nextTick(); await nextTick();
    await wrapper.findAll('[data-test="picker-candidate"]')[1]!.trigger("click");
    await wrapper.find('[data-test="picker-confirm"]').trigger("click");
    expect(wrapper.emitted("confirm")![0])
      .toEqual(["mdi:chat-bubble", ["mdi:chat", "mdi:chat-bubble"], "chat"]);
  });

  // 挑不到合适的是常见结果（实测 3/4），得是个正当选择
  it("offers using the crop as an explicit choice", async () => {
    const wrapper = mountDialog();
    await wrapper.find('[data-test="picker-use-crop"]').trigger("click");
    expect(wrapper.emitted("use-crop")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    expect(mountDialog({ open: false }).find('[data-test="picker-crop"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败,再实现**

`ElementProperties.vue` 那边:把内嵌的搜索框与 3 列格子**删掉**,换成一个「选择图标」按钮
打开弹框;`initialQuery` 用 `iconDecision.keywords` 里**第一个含 ASCII 字母的**,没有就传空串。
现有的 `choose-icon` emit 保持不变,由弹框的 `confirm` 触发。

**测试里断言旧内嵌控件的用例整条删除**,不要留空壳。

- [ ] **Step 3: 跑测试并提交**

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm test && D:/nodejs/corepack.cmd pnpm exec vue-tsc --noEmit -p tsconfig.json && D:/nodejs/corepack.cmd pnpm build
```

```bash
git add apps/region-split-ui/src
git commit -m "feat: pick an icon in a dialog beside its crop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 界面上区分"没搜过"和"搜过没合适的"

**Files:**
- Modify: `apps/region-split-ui/src/components/ElementProperties.vue`
- Modify: `apps/region-split-ui/src/components/ElementProperties.test.ts`

现在 `crop` 和 `ambiguous` 在面板上都显示成「保留原图裁片」,**看不出区别**。

- `crop` —— 模型看过候选、判断都不像。**这是个结论。**
- `ambiguous` —— 定不了,或压根没有可用关键词。**这是个待办。**

改成分别显示,例如:

```
crop       →  保留原图裁片 · 模型判断无合适图标
ambiguous  →  待确认图标（附「选择图标」按钮，且这一条计入待办统计）
```

`analysis-stats.ts` 已经把 `ambiguous` 算进 `unresolvedIcons`,所以数字这一侧不用改,
只改界面显示。

- [ ] 先写失败测试(两种 `kind` 各断言各自的文案),跑,实现,再跑,提交。

```bash
git commit -m "feat: tell an undecided icon apart from a decided crop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 走查——本计划的产出

前三个任务是把工具修好。**这一步才是欠了三轮的东西。**

- [ ] **Step 1: 起服务(先重启 API,Task 1 改了核心包)**

```bash
cd packages/region-split && D:/nodejs/corepack.cmd pnpm dev
```

```bash
cd apps/region-split-ui && D:/nodejs/corepack.cmd pnpm dev
```

- [ ] **Step 2: 打开项目**

```
http://localhost:5180/#project=<data/projects 下任一个>
```

hash 能直接打开已有项目,不必重新上传。

**把字体栈选成 Windows。** 这台机器上苹方、思源、Noto **一个都没装**,选 iOS/Android 栈
会静默回退到系统默认字体,**文字的错位里就混进了"字体不对"这个变量**,归因会乱。
Windows 栈里的雅黑是唯一真生效的。

- [ ] **Step 3: 逐条确认**

1. 没有英文关键词的图标(如「用户头像」)显示成**待确认**,不是「保留原图裁片」;
2. 点「选择图标」出**弹框**,左边是原图切片,右边一进来就有候选;
3. 挑一个确认后,**元素解析图上跟着变**;
4. 点「用原图切片」能明确回到 crop;
5. 生成整页:挑过的是**内联 `<svg>`** 带 `currentColor`,没挑的是 **PNG 切图**,不是空白;
6. 待办数字能减到零(Task 1 的判据修复已在上一轮完成,这里顺带复验)。

- [ ] **Step 4: 量出落差——核心观察**

在**整页比对**里把透明度拖到 50%,逐个看换成库图标的元素:

- **形状差多少**?轮廓对得上,还是完全另一个东西?
- **描边 vs 实心**?——已知「设置」命中了 `mdi:gear-outline`,而**原图是实心齿轮**。
  这一类差异要专门看:命中了不等于像。
- **颜色对不对**?`currentColor` 有没有真的用上量到的墨色?
- **大小对不对**?库图标是正方形,原图标框不一定,有没有变形或缩得太小?
- **点名具体元素**:哪几个换过去基本看不出差别,哪几个一眼就是错的。

> 已知背景:20 个图标里 **18 个是彩色/实心插画**,mdi 里多是单色描边款。
> **预期是落差明显。** 这一步要回答的是"**明显到什么程度、值不值得用库图标**",
> 不是证明它好用。

**不要写"基本没问题"。** 结论要能支撑一个决定:默认策略该不该从"库图标优先"
翻成"切图优先"、要不要再装 tabler / ri 几套、还是干脆自建本地图标集。

- [ ] **Step 5: 写报告**

写进 `D:\workspace\.superpowers\sdd\icon-picker-walkthrough-report.md`:
每个任务改了什么、红→绿证据、测试与 typecheck 与 build 结果、
`ambiguous` 的 `candidates` 空数组那个 schema 问题怎么解的、
**Step 3 六条逐条结果**、**Step 4 点名到具体元素的落差描述**。

做不到的项**如实写明卡在哪**,不要声称看到了实际没看到的东西。

---

## 完成标准

- 两个包测试全绿,两个 typecheck 无输出,前端 build 成功。
- 没有可用英文关键词的图标标成 `ambiguous`,**且不调用模型**。
- 挑选是弹框,原图切片常驻,打开即有候选,「用原图切片」是显式按钮。
- 面板上 `crop` 与 `ambiguous` 文案不同。
- 报告里 **Step 4 点名到具体图标**,并给出"库图标优先还是切图优先"的倾向性结论。
