# 项目交接说明

面向接手继续微调功能的开发者（含 AI）。写的是**为什么这么做**和**改的时候会踩什么**，
不重复代码本身能说清的东西——每个模块顶部的注释里都写了它自己的依据。

最后更新：2026-08-15。

---

## 1. 这个项目在解决什么

把手机 UI 截图还原成高保真 HTML。直接让视觉模型看图写代码，还原度大约到 50% 就上不去了：
模型能看懂"这是个卡片"，但说不准它宽多少、离上面多远、圆角几像素。

所以拆成两层：

- **外层**：把整页切成若干**粗粒度区域**（导航、资产卡、服务宫格、商品流……）。已完成。
- **内层**：解析每个区域**内部的元素与父子层级**。本轮做的就是这层。

先有层级再谈还原：没有父子关系，生成的 HTML 结构必然是错的——这是当初调整开发顺序的原因
（原计划先做元素识别再做层级，被推翻了）。

### 贯穿全局的分工原则

> **代码负责量，模型负责判断。**
>
> - 代码回答：在哪、多大、离多远、重复几次、能不能滑。
> - 模型回答：这是什么、叫什么、这一组是不是切错了。

推论 —— **发给模型的 prompt 里一个坐标都不给**。给了坐标模型就会去"算"，而它算不准。
阅读顺序由树本身承载（节点已按 reading order 排好），模型只需按顺序回答等长的一串。
`model.ts` 里对返回长度做严格校验，长度不等直接重试再降级。

---

## 2. 跑起来

两个进程，都从 `D:\workspace\ui` 起：

```bash
pnpm --filter @region-split/core dev
```

```bash
pnpm --filter region-split-ui dev
```

- API `http://127.0.0.1:4800`，UI `http://localhost:5180`（UI 代理 `/api` 到 API）。
- 端口可用 `UIR_UI_PORT` / `UIR_API_URL` 覆盖，方便另起一份验证而不打断已有实例。
- 数据目录 `D:\workspace\ui\data`，模型配置 `D:\workspace\ui\region-split.config.json`
  （示例见 `region-split.config.example.json`，含 API Key，别提交）。
- 测试 `pnpm -r test`（当前 478 个全过），类型 `pnpm -r typecheck`。

> **改了 `packages/region-split` 必须重启 API。** tsx 不热重载。这个坑已经吃过两次：
> 一次圆角恒为 0，一次 PUT 时 zod 把 fontSize 静默剥掉，都是因为服务端跑的还是旧代码。

---

## 3. 仓库结构

```
packages/region-split/src/     核心包（Node，Fastify + sharp + zod）
  main.ts / server.ts          HTTP 入口与路由
  store.ts                     项目文件读写（regions.json / elements.json / 图片）
  preprocess.ts                抹掉手机系统外壳，产出 image.clean.png（不改分辨率）
  candidate-lines.ts           一维行分析，产出候选切分线
  panels.ts                    卡片检测，补上候选线看不见的二维结构
  reconcile.ts                 候选线 → 区域列表
  analyze.ts                   外层编排：建项目、预处理、分析、区域改名
  operations.ts                区域的增删改合并（纯函数，拿不到像素）

  element-types.ts             ★ 元素 schema、不变量校验、regionKey
  element-pixels.ts            纯像素原语（背景色、uniformity、圆角、墨色、连通块）
  element-runs.ts              游程与自适应间隙合并、漏合并修复
  element-cut.ts               ★ 递归 X-Y cut、交叉轴收紧、布局量测量
  element-grid.ts              重复（网格）与滚动判定
  element-detect.ts            ★ 内层编排：连通块 → 递归切分 → 成树
  element-layout.ts            人工改框的传播规则、布局量重算（浏览器安全）
  analyze-elements.ts          模型分类的分组、并发调用与降级
  model.ts / model-config.ts   模型调用与配置
  browser.ts                   给前端复用的浏览器安全子集（不含 sharp）

apps/region-split-ui/src/      前端（Vue 3 + 自建 store，无 Pinia）
  canvas/PipelineCanvas.vue    画布：节点 + 连线
  canvas/nodes/RegionsNode.vue 外层结果节点
  canvas/nodes/DetailNode.vue  ★ 区域详情节点（上下布局），吸管与字体测量在这里
  components/ElementTree.vue        结构树
  components/ElementProperties.vue  ★ 属性面板（所有人工编辑入口）
  components/ElementOverlay.vue     元素框叠加层
  state.ts                     外层 store（区域）
  element-state.ts             ★ 内层 store（元素），**从不碰 state.ts**
  font-metrics.ts              字号/字重的渲染比对（逻辑与 canvas 解耦，可单测）
  coords.ts                    原图坐标 ↔ 屏幕坐标

docs/superpowers/specs/        设计文档
docs/superpowers/plans/        分阶段开发计划
```

★ = 改功能时最可能要动的文件。

---

## 4. 数据契约

### 元素类型是两层，不是并列六类

```ts
elementKinds = ["component", "grid", "text", "icon", "image", "decoration"]
leafKinds    =                        ["text", "icon", "image", "decoration"]
```

容器类（component / grid）有子节点，对应 `<div>`；叶子类没有。这个二分决定了界面上每个
节点能做什么操作，也决定了下游怎么生成标签。**给叶子挂子节点会直接撞 `leaf-with-children`
不变量。**

### regionKey 用几何做键

```ts
regionKey(bounds) => `${bounds.y}-${bounds.y + bounds.h}`
```

只取纵向跨度。区域 id 会因为改名、拆分、合并而变，几何不会——已解析的元素树不该因为
区域改了个名字就丢失。GET `/api/.../elements?y=&h=` 传 `x/w=0` 是刻意的。

### 不变量（`checkElementTreeInvariants`）

`duplicate-id` / `root-outside-region` / `missing-parent` / `child-outside-parent` /
`cycle` / `sibling-overlap`（只对 `positioning: "flow"` 生效）/ `leaf-with-children`。

写入前必过。`positioning: "absolute"` 的节点允许压层（角标压在图标上那种形态）。

### 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/projects` | 上传建项目 |
| GET | `/api/projects/:id` | 项目详情 |
| POST | `/api/projects/:id/analyze` | 外层区域分析 |
| PUT | `/api/projects/:id/regions` | 覆盖区域列表 |
| POST | `/api/projects/:id/regions/:rid/rename-ai` | 模型给区域命名 |
| GET | `/api/projects/:id/elements?y=&h=` | 读元素树，**没解析过返回 `null` 而不是 404** |
| POST | `/api/projects/:id/elements/detect` | 检测元素树 |
| PUT | `/api/projects/:id/elements` | 覆盖元素树（走 zod + 不变量） |
| GET | `/api/projects/:id/image?rect=&original=` | 取图，默认给清理后的 |

---

## 5. 外层管线（已完成，一般不用动）

```
上传 → preprocess（抹系统外壳，不改分辨率）
     → candidate-lines（一维行分析找候选切分线）
     → panels（卡片检测，区分"卡片内部行距"与"卡片之间留白"）
     → reconcile（候选线 → 区域）
     → 人工在画布上调整 / 模型命名
```

`analyze.ts:MAX_ANALYZED_HEIGHT = 2000` 是分析用的缩放上限；`regions.json` 里记了
`analyzedScale`，坐标始终以**原图像素**为准。

---

## 6. 内层管线（本轮主体）

```
detectElementTree(raw, regionRect, now)
  1. regionBackground        区域左右各 6px 边距的中位色
  2. connectedBoxes          与底色不同的四连通块 → 顶层容器候选
  3. mergePartialOverlaps    合并部分重叠的块
  4. uniformity 过滤          落在位图内部的块丢掉（image 是叶子，不能有子节点）
  5. 兜底：uncoveredContentRatio > 0.25 时，改为直接切区域本身
  6. expand()                对每个容器递归切分，最深 MAX_DEPTH = 4
```

### 递归切分（`cutChildren`）

```
occupancy(逐行/逐列是否有内容)
  → runsFromOccupancy(游程)
  → mergeByGap(自适应间隙合并：阈值 = 最大间隙 × 0.5)
  → repairMissedMerge(漏合并修复)
  → looksLikeTextRun(是文字行就不切)
  → tightenToContent(交叉轴收紧到真实内容)
```

**自适应阈值**的依据：真实 UI 里"字间距"和"元素间距"的分布是双峰的，取最大间隙的一半
天然落在两峰之间，不需要为每个区域调参。

**交叉轴收紧**是必需的，不是优化：横切出来的子块在交叉轴上继承父块的完整高度，原本指望
下一层纵切去收紧，但**叶子没有下一层**——不收紧的话所有叶子的 Y 轴数据全是假的。

**`repairMissedMerge` 从真实空白里量边界，不从 pitch 反推。** 早期版本按 pitch 猜边界，
实测误差 18px，已重写。

方向不严格交替：先试上一层的反方向，切不出两块以上就试另一个方向。严格交替会丢结构。

### 布局量是切分的副产品

不是二次分析：**切的方向就是 `flex-direction`，子块间隙就是 `gap`，内容到父边的距离就是
`padding`**。光有树生成不了 HTML——不知道孩子横排还是竖排、间距多少。

### 网格与滚动

- **重复**：pitch 一致性（容差 ±4）。
- **滚动**：必须**同时**满足两条——最后一个子块明显小于中位数（< 0.75），且它贴着内容边缘
  （容差 10）。只看其中一条会把渐变遮罩误判成裁切。
  > 早期把优惠券行当作滚动的证据是错的（量到的是渐变淡出，不是硬裁切），已在设计文档里更正。
  > 真正的证据是胶囊行——间隙恒为 24。

### 模型参与的那一步（`analyze-elements.ts`）

- 按 reading order 分组，并发调用，结果收齐后一次性写入；任何一组失败 → 该组标
  `classification: "uncertain"`，不阻塞其余。
- **可疑过切**：只有当"有父节点 && 间隙比 < 0.25 && 子节点全是叶子"时，才额外追加
  `WHOLE_RULE`，问模型"这一组是不是本该是一个元素"。
  依据：扫码图标 2/25 = 0.08 可疑；常用服务格子 29/54 = 0.54 正常。
- 结构审核会让延迟大约翻倍。

---

## 7. 关键常量与它们的实测依据

**改这些数字之前先去量，不要凭感觉调。** 每个常量在代码里都带着它的证据注释，
测试里也写死了实测数据（不是宽松断言）。基准图：`test-fixtures/maicai.png`。

| 常量 | 值 | 依据 |
|---|---|---|
| `CONTENT_THRESHOLD` | 8 | 能把白卡片从浅灰页面底色上分出来 |
| `CUT_THRESHOLD` | 10 | 切分用，比上面松一点 |
| `CUT_INSET` | 6 | **只加在垂直于被测轴的方向上**，见第 9 节 |
| `IMAGE_UNIFORMITY_MAX` | 0.1 | 采购横幅实测 0.02 |
| `FLAT_UNIFORMITY_MIN` | 0.8 | 白卡片实测下限 0.83（上限 0.96） |
| `INK_PERCENTILE` | 0.25 | 纯色文字上 10% 与 25% 一致，但描边图标墨像素少，10% 会被最深的几个像素带偏 |
| `TEXT_RUN_GAP_RATIO` | 0.25 | 文字侧：胶囊字 0.06、企业采购 0.173；元素侧：关注领券 0.41、常用服务 0.70 |
| `looksLikeTextRun` 的 `runs < 3` 豁免 | — | 账户顶部 0.208、关注领券 0.406 都是左右布局，误判会让整区一个节点都出不来 |
| `REGION_FALLBACK_RATIO` | 0.25 | 账户顶部 53.5%、底部导航 52.8%，其余 ≤ 6.1% |
| `SUSPECT_GAP_RATIO` | 0.25 | 扫码图标 0.08 可疑，常用服务格子 0.54 正常 |
| `PITCH_TOLERANCE` | 4 | 网格 pitch 一致性 |
| `CLIPPED_SIZE_RATIO` / `FLUSH_TOLERANCE` | 0.75 / 10 | 滚动的两个条件 |
| `MAX_DEPTH` / `MIN_CHILD_SIZE` / `MIN_BOX_SIZE` | 4 / 16 / 4 | |

---

## 8. 前端：人工编辑的规则

### 布局

`DetailNode.vue` 是**上下结构**：工具条（含区域背景色）/ 区域原图 / 元素解析图 / 树 + 属性。
两张图上下对照是刻意的，方便肉眼比对调整前后。

> 历史教训：上一版开发文档 3898 行，产出的界面"完全是混乱的"。事后归因：计划太大、UI 任务
> 排在最后、UI 代码从没真正渲染过、`repeat(2, minmax(0,320px)) 245px` = 885px 塞进 900px 的
> 节点里。所以现在**每个阶段都必须以"在真浏览器里看一眼"收尾**。

### 改框的传播规则（`element-layout.ts:applyBox`）

尺寸变化沿两个方向对称传播：**向上取并集，向下取交集**。

- **放大**顶到父边界后继续放大 → 父节点扩成并集，一路向上递归。
  （否则想让元素更大时被父框卡住、只能先去改父框，顺序是反的。）
- **缩小**到装不下子节点 → 子节点收成交集，一路向下递归。
  （只拒绝不动会和放大方向自相矛盾；取交集只裁掉伸出去的部分。）
- **移动**（宽高不变）不参与传播，直接收进父节点——挪出界基本都是手滑。

三条底线：区域是硬顶；裁到小于 `MIN_BOX_SIZE` 整体拒绝；改动过的每一层都不能压到自己的兄弟
（`absolute` 除外）。

**拒绝时必须给出理由并显示在界面上**，否则看起来像失灵。现有四条文案：
`找不到这个元素` / `再缩下去里面的子元素就看不见了` / `已经顶到区域边界，再大就超出这个区域了` /
`会压到旁边的同级元素上；要压层请先把类型改成绝对定位`。

### 属性面板

名称 / 类型 / 位置 XY / 移动（← ↑ ↓ →）/ 尺寸 WH / 缩放（宽 ± 高 ±）/ 圆角 / 颜色 + 吸管 /
字号 + 字重 + 测量 / 背景色 / 主色占比 / 布局 / 内边距 / 重复 / 滚动 / 来源。

内部用**局部 `draft` + `watch` + emit 后 `nextTick` 重新同步**。原因：改动被拒绝时，输入框里
会残留 `-9999` 这种非法值，必须回滚到 store 的真值。

### 滚动的人工覆盖

`element-state.ts` 里有 `scrollOverrides: Set<string>`。`recomputeLayout` 会按几何重算
scrollX/scrollY，但**列在这个集合里的节点保留人工值**——否则人一改就被下一次重算冲掉。

### 颜色

- 墨色取"离背景最远的 25% 像素"的均值，**绝不用平均值**：抗锯齿会把背景混进来，实测本该同色的
  五个标签用平均算出五个不同的灰，用本方法全部是 `#191919`。
- 吸管在**区域原图**上取像素点。
- 区域背景色存在树上（`ElementTree.background`），不在 `regions.json` 里——区域的拆分合并是
  纯函数拿不到像素，而检测时本来就在读图。

### 字号与字重（`font-metrics.ts`）

**渲染比对，不用任何绝对经验系数：**

1. 量出目标的墨迹高度与覆盖率；
2. 对每个候选字重 400/500/700，用**这串文字自己的比例**反推字号
   （`字号 = 墨高 × 100 / 该串在 100px 下的墨高`）；
3. 按该字号渲染，比覆盖率，取误差最小的。

为什么不能用固定系数：同一字体下实测比例 `联系客服` 0.940、`¥18` 0.770、`gjpqy` 1.030，
差 34%。为什么覆盖率不能单独当字重判据：实测标签 0.429 与标题 0.431 几乎相同（字号越小
笔画相对越粗），必须渲染同一串文字后再比，差距才拉得开（实测最优与次优差 4–10 倍）。

`FontMatch.margin`（最优与次优的差距）是可信度信号，太接近时界面应当提示存疑。

---

## 9. 最近修掉的一个 bug（会影响你对历史数据的判断）

`occupancy()` 原先对**两根轴都**内缩 `CUT_INSET = 6`，`tightenToContent()` 在它正在测量的
那根轴上重复了同样的错。效果等于宣告"贴着父边 6px 以内没有内容"。

内缩真正该防的是**垂直方向的边框**：一条左边框会让每一行都有内容、把 `rows` 填满，竖切就
再也切不开了。所以算 `rows` 要排除左右各 6 列，算 `cols` 要排除上下各 6 行，**但都不能截断
自己那根轴**。

实测：「常用服务」五个标签墨迹都是 `y 1290..1323`，其中四个的父容器底边正好 1324 → 框停在
1318，矮 6px，字号从 37 拟合成 30；只有父容器底边 1368 的那个逃过，所以它看起来像"离群点"，
**其实只有它是对的**。修复后五个框全是 `h=34`，全图节点 84 → 88，五个字号的离散度从 0.079
降到 0.008。

提交 `b33c371`。

> **已经存下来的 `elements.json` 还是旧框**，要重新检测才会用上修复。

---

## 10. 已知局限（都是刻意接受的，不是待修 bug）

- **单个 `borderRadius` 表达不了上圆下方**：商品图实测四角 21/21/0/0，取中位数得到 11 这种
  两头不讨好的数。人工可在属性面板里改。
- **头像占位块仍会过切**，Delete 可以拍平。
- **结构审核让延迟大约翻倍**（多一轮模型调用）。
- **字体族无法用像素判别**，见下一节。
- RapidOCR 已安装但**尚未接入**。

---

## 11. 字体族：为什么不做

做过实验：对一组同款式文字，若字体猜对，`字号 = 墨高ᵢ / 比例ᵢ` 应当处处相同，用离散度当打分。

结论是**这个判据测的是框，不是字体**。修正上节的 bug 后，离散度从 0.079 掉到 0.008，
但字体之间只差 0.0003（雅黑 0.0077 / 回退 0.0080 / 宋体 0.0081），完全在噪声里。
原因是结构性的：**汉字几乎撑满 em 框**，各家字体的墨高比例都在 0.92–0.99 的窄带内，
这个量根本不携带字体信息；区分字体的信息在笔画形状。

而且候选集里没有正确答案——本机探测：PingFang SC、Noto Sans SC、Source Han Sans SC
全部未装、走回退。截图是 iOS 的，真实字体是苹方。

**建议：字体族做成项目级的一个下拉，默认 iOS 系统字体栈**
（`-apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif`）。原页面本来就用系统字体，
指定某个具体字体反而更不像。

---

## 12. 改动纪律

这套代码是按下面几条建起来的，接着改请沿用：

1. **每个阈值都要有实测依据**，写在常量旁边的注释里，注明是在哪张图哪个元素上量的。
2. **测试里写死实测数据**，不要为了让测试过而放宽断言。改行为时更新数据并说明为什么。
3. **改完在真浏览器里看一眼**再说完成。
4. **改了核心包就重启 API。**
5. 前端两个 store 严格分离：`element-state.ts` 从不碰 `state.ts`。
6. `browser.ts` 是给前端复用的浏览器安全子集，**不能引入 sharp**（`element-pixels.ts` 用
   type-only import 就是为了这个）。

### 已知的环境坑

- `img.decode()` 在标签页隐藏时会挂死，冻结整个吸管流程——**不要用**，代码里有注释。
- canvas 跨会话缓存导致取样全白，所以每次开启吸管都重画。
- `.npmrc` 有一处机器绝对路径（`store-dir=D:/workspace/ui/.pnpm-store`）尚未提交，
  换机器要改。

---

## 13. 可以接着做的事

按性价比排：

1. **兄弟一致性校验**（推荐，便宜且纯几何）：同款式的一组文字，拟合字号本该一致；不一致说明
   有个框量错了。第 9 节那个 bug 本可以被自动报出来，不用手工去数像素。
2. **接入 OCR**：RapidOCR 已装。定位是"给模型一份粗略的文字位置与内容"，让它自动过滤图片里的
   文字；只标注"是否含文字"，模型初筛 + 人工二次纠正。**OCR 框有 padding，坐标不可直接用，
   要重新量像素。**
3. 字体族下拉（第 11 节）。
4. 从元素树生成 HTML —— 这是整个项目的终点，目前还没开始。

---

## 附：git 状态

- 分支 `feature/region-split`，只保留这一个分支（之前的 worktree 与
  `feature/region-split-canvas-ui` 本地分支已删除）。
- `origin/feature/region-split-canvas-ui` **在远端仍然存在**，本地没动过远端。
- 最近相关提交：`b33c371` 内缩修复、`7994807` 字号字重渲染比对。
