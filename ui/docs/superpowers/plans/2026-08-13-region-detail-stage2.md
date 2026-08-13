# 区域详情面板 · 阶段二 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在阶段一的顶层容器之上，往容器内部递归切分出子元素，并测出布局方向、`gap`、`padding`、网格重复与滚动属性。

**Architecture:** 递归 X-Y 投影切分。横切一层就是 `flex-direction: row`，纵切就是 `column`——方向是切分算法的副产品而不是二次推断；子块间隙即 `gap`，内容到父边距离即 `padding`。全部确定性计算，**不调用模型**。

**配套设计文档:** `docs/superpowers/specs/2026-08-13-region-detail-design.md`

**前置:** 阶段一已完成并通过目视验收（合并提交 `215b1bd`）。

## Global Constraints

- 沿用阶段一的全部约束：中文注释解释「为什么」、原图坐标、`D:/nodejs/corepack.cmd pnpm`、不改 `state.ts` 既有成员、阈值必须命名并附实测依据。
- **不得放宽真实截图回归的既有断言。**
- 只在 `feature/region-split` 一个分支上开发，不再新建 worktree。
- 每个任务结束时提交。

## 实测常量（来自 `test-fixtures/maicai.png`，1170×2532）

| 常量 | 值 | 依据 |
|---|---|---|
| 切分内缩 | `6` | 避开容器边框与圆角 |
| 切分内容阈值 | `> 10` | 与本层底色的最大通道差；比顶层的 8 高，因容器内有阴影 |
| 列游程最短长度 | `4` | 滤掉单列噪声 |
| 间隙合并阈值 | 本层最大间隙 × `0.5` | 间隙双峰：单元内 `1`–`5`，单元间 `77`–`116` |
| 递归深度上限 | `4` | 宁浅勿深 |
| 子块最小尺寸 | `16` | 小于此不再切分 |
| 栅格间距容差 | `±4` | 实测列心间距 `218.5 / 220.0 / 218.0 / 220.0` |
| 滚动尺寸判据 | 末块 `<` 其余中位 × `0.75` | 胶囊 `138 < 216×0.75`；卡券 `105 > 122.5×0.75` |
| 滚动贴边容差 | `10` | 胶囊末块右端 `1134`，右余量 `36` == 左边距 `36` |

## 已验证的关键数据

必须在 TypeScript 里复现的实测结果：

- 常用服务卡片列游程间隙 `[2, 77, 3, 2, 98, 115, 98, 2, 2]` → 自适应合并出 **5** 段，宽 `[142, 141, 103, 103, 141]`。**（Task 1 已验证通过）**
- 分类胶囊行游程宽 `216 / 216 / 252 / 180 / 138`，**间隙恒为 24** → 合并后仍是 **5** 段。**（Task 1 已验证通过）**
- 常用服务列心间距 `218.5 / 220.0 / 218.0 / 220.0`；卡券资产 `220.0 / 220.0 / 219.5 / 219.5`——同一页面同一栅格。
- 关注领券卡片横切为 `[文案列 182, 图标 89]`，左列再纵切为 `[标题 40, 副标题 34]`，`gap` `55`，左 `padding` `38`。
- 胶囊末块右端 `1134`，右余量 `36` == 左边距 `36` → `scrollX`。

## 双峰判据的适用边界

`mergeByGap` 只在间隙**真有两个峰**时才合并。间隙全相等时一律不合并——这是刻意的：分类胶囊行间隙恒为 24，那是 5 个并列单元，并成一块就错了。

**代价（尚未实测，Task 4 必须验证）：** 一个只装着单行文字的容器，其列游程是逐字的、间隙均匀，因此不会被合并，可能切出逐字的子节点。真实影响有多大要在 Task 4 拿真实截图量了才知道，**不要提前按猜想去改阈值**。若确实碎裂：优先考虑「子块数量多且尺寸都远小于父块时判定为单一文本行、停止切分」，而不是调间隙阈值——后者会破坏已验证的两条断言。

## 已知失败面

- **订单状态卡片切出 4 列而非 5**，末列宽 `370` 是两项粘连，间距序列 `219.0 / 220.0 / 324.5`。`repairMissedCut` 的修复效果**尚未验证**。实现后必须实测；修不回来就退化为标 `uncertain` 交人工，**绝不允许引入新的错误切分**。
- 不要拿优惠券卡片行当截断证据：第三张卡的右边缘是渐变淡出（`x=1110` 处 `253` 渐变到 `x=1130` 处 `245`），不是硬截断。

---

### Task 1: 游程与自适应间隙合并 ✅ 已完成

**Files:** `packages/region-split/src/element-runs.ts` + `.test.ts`

**Produces:** `Run { start, end }`、`runsFromOccupancy(occupied, minLength?)`、`mergeByGap(runs)`、`medianOf(values)`

---

### Task 2: 递归切分与布局量

**Files:** Create `packages/region-split/src/element-cut.ts` + `.test.ts`

**Produces:** `Direction`、`MAX_DEPTH`、`MIN_CHILD_SIZE`、`CUT_INSET`、`occupancy(raw, rect, fill, inset?)`、`cutChildren(raw, rect, direction)`、`measureLayout(rect, children, direction)`、`LayoutInfo`

子块在**交叉轴上继承父块的完整范围**——横切出来的列高度等于父高。这是 X-Y cut 的固有形态，交叉轴边界由下一层反方向切分收紧；好处是兄弟天然不重叠，不会重蹈阶段一 `sibling-overlap` 的覆辙。

布局量是切分的副产品，不是二次分析。光有树生成不出 HTML——不知道孩子横排还是竖排、间距多少。

**必测:** 三个等距黑块的行被横切成 3 列；两行块被纵切成 2 行；单块返回空；`gap` 取中位数；`padding` 四方向正确；单个子节点时 `gap` 为 0。

---

### Task 3: 网格识别、漏切修复与滚动判定

**Files:** Create `packages/region-split/src/element-grid.ts` + `.test.ts`

**Produces:** `PITCH_TOLERANCE`、`centersOf`、`pitchesOf`、`RepeatInfo`、`detectRepeat`、`repairMissedCut`、`detectScroll`

滚动判据**两条必须同时成立**：末块尺寸 `<` 其余中位 × `0.75`，**且**其末端与父末端的余量与首端内边距之差在 `±10` 内。只看尺寸会误判卡券资产（末列只是文字短），只看贴边会误判任何正常网格。

**必测:** 用三组真实宽度分别断言 `scrollX` 为 true / false / false；等距行标为 `grid` 并给出 `pitch` 与模板；间距不齐不标；`repairMissedCut` 对单个过宽子块的还原。

---

### Task 4: 编排与界面

**Files:** Modify `element-detect.ts`、`element-detect.test.ts`、`ElementProperties.vue` + `.test.ts`、`ElementTree.vue` + `.test.ts`

顶层容器检测之后，对每个 `component` 节点递归切分。顶层一律先横切——移动端页面的顶层容器几乎总是竖直堆叠的卡片，卡片内部才是横排。`image` 节点不再往下切。

装饰吸收：满幅纯色子块并进父节点的 `style.background`，不生成节点。不做这个吸收，每张卡片都会变成「一个组件 + 一个和它等大的装饰块」，树凭空虚胖一倍。

界面：属性面板增加「布局」（方向 + gap + padding）、「重复」（次数 + 间距）、「滚动」（可人工切换）三组；结构树的容器行显示方向箭头与 gap，`grid` 行显示 `×N`。

**必测（真实截图，数值不得放宽）:**

- 常用服务卡片切出 5 个子节点，列心间距全部落在 `220 ± 2`，标为 `grid`。
- 卡券资产卡片切出 5 个子节点。
- 关注领券卡片横切 2 列（`row`）、左列纵切 2 行（`column`），`gap` 55、左 `padding` 38。
- 分类胶囊行 `scrollX` 为 true；常用服务与卡券资产为 false。
- 采购横幅仍为 `image` 且无子节点。
- 生成的树满足全部不变量（尤其兄弟不重叠）。
- 订单状态卡片：修复生效则断言 5 列；否则断言标记为 `uncertain`，**二选一必须落地**。
- **文字碎裂实测**：挑一个只含单行文字的容器，记录它切出多少子节点，把结果写进测试。碎裂严重时按上文「双峰判据的适用边界」处理。

**目视验收（不可跳过）:** 起服务逐个区域点开，确认树出现层级缩进、属性面板显示布局量、图上子节点框不越界不重叠、控制台无报错。
