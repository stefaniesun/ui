# 待办计数与真实浏览器走查报告

日期：2026-08-20
项目：`20260813-o11j2v`

## Task 1：未测字号计数

### 修改

`analysisStats()` 的 `textWithoutSize` 现在与 `DetailNode.measureAllFonts()` 使用相同判据：只统计 `kind === "text"`、`textBox.ok === true` 且尚无 `fontSize` 的节点。`textBox.ok === false` 和未检查的历史节点不再形成永远无法由批量测量清除的字号待办。

### 红灯证据

新增五条边界测试后、修改实现前，定向测试结果为 6 条中 3 条失败：

- `ignores text whose box failed the check`：实际 1，期望 0。
- `ignores text that was never checked`：实际 1，期望 0。
- `drops the todo when nothing measurable is left`：字号待办仍存在，`allPassed` 为假。

### 绿灯证据

修改后：

- 核心包：31 个测试文件、419 条测试全部通过。
- 核心包 TypeScript 检查通过。
- 真实项目统计：`textWithoutSize = 0`，页面待办中没有“字号”条目。
- 单元测试证明只剩不合格框时 `allPassed` 可以为真。

这里的“可测”特指批量自动测量路径，与计划和 `measureAllFonts()` 一致；框存疑仍由元素属性中的框校验状态暴露。

## Task 2：构建残留

### Dry-run 输出

执行 `git clean -nd -- apps/region-split-ui` 后确认仅包含：

```text
Would remove apps/region-split-ui/dist-ai-panel-check/
Would remove apps/region-split-ui/dist-analysis-materialization-check/
Would remove apps/region-split-ui/dist-analysis-materialization-final-check/
Would remove apps/region-split-ui/dist-analysis-materialization-final/
Would remove apps/region-split-ui/dist-page-code-regression/
Would remove apps/region-split-ui/dist-page-only-codegen-check/
Would remove apps/region-split-ui/vite.config.ts.timestamp-1787135279628-6477ce8123dec8.mjs
Would remove apps/region-split-ui/vitest.config.ts.timestamp-1787190191562-da02e2be8f91b.mjs
Would remove apps/region-split-ui/vitest.config.ts.timestamp-1787191305666-9922880119113.mjs
Would remove apps/region-split-ui/vitest.config.ts.timestamp-1787193053182-8fc5cc787b98b.mjs
Would remove apps/region-split-ui/vitest.config.ts.timestamp-1787198326853-03499171475bb.mjs
```

核心包另有 4 个已确认的 `vitest.config.ts.timestamp-*.mjs`。上述残留均已删除。

`.gitignore` 新增：

```text
dist-*/
*.timestamp-*.mjs
```

清理后搜索不到前端 `dist-*` 和两包 timestamp 文件；`git check-ignore` 验证未来同类文件会被忽略。

## Task 3：六条真实浏览器结果

### 1. 字体栈选择与刷新持久化

通过本机 Edge CDP 在 `http://127.0.0.1:5180/#project=20260813-o11j2v` 真实操作：

- 选择 Android 后，后端文档写入 `Roboto, "Noto Sans CJK SC", "Source Han Sans SC", sans-serif`。
- 刷新页面后，目标字体仍显示 Android 且 option 保持 selected。
- Windows、Android、iOS 三个选项均存在。

结果：通过。

### 2. 待办数字与字号条目

- 打开项目时：区域 7/9，图标 25，SVG 0，待确认 25，待测字号 0，总待办 27。
- 人工选择“消息”图标后：SVG 1，待确认 24，总待办 26。
- 字号条目已经归零并消失，证明 Task 1 的实机路径有效。
- 整个项目的总待办没有归零：仍有 2 个区域未解析、24 个图标未确认。没有为了把数字做成零而批量盲选错误图标。

结果：字号幽灵待办通过；项目全量待办归零未完成，原因是实际分析工作尚未全部完成，而不是计数错误。

### 3. 图标属性面板原图切片

打开“账户顶部”详情，选择“消息”图标：

- 属性区出现“图标 / 待确认”。
- 左侧显示原图 PNG 切片，尺寸 56×56，颜色测量为 `#111111`。
- 搜索输入框和“换一个”入口可用。

结果：通过。

### 4. 候选选择与画布更新

搜索 `message` 后显示 `mdi:message`、`mdi:message-add`、`mdi:message-alert`、`mdi:message-alert-outline` 等 SVG 候选。真实点击首个 `mdi:message` 后：

- 元素树“消息”条目从待确认状态变为普通图标状态。
- 后端节点持久化 `iconDecision.kind = library`、`iconId = mdi:message`。
- 元素素材从 PNG 变为稳定 SVG 引用。
- 页面完成度立即由 SVG 0 / 待确认 25 更新为 SVG 1 / 待确认 24。

结果：通过。

### 5. 整页代码的 SVG 与 PNG

选择“消息”后调用真实 `page-code`：

- HTML 包含内联 `<svg>`。
- 图标 SVG 使用 `currentColor`，节点 CSS 颜色为原元素测得的 `#111111`。
- 输出资产列表中没有外部 `.svg`。
- 未选择的“应用菜单”“设置”等仍保留 PNG 裁片，不是空白。
- 页面仍有 26 项待办时，真实点击“导出整页代码”成功触发下载，导出未被阻断。

结果：通过。

### 6. 删除缓存后重建一致

删除 `data/projects/20260813-o11j2v/assets/*` 前后两次调用真实 `page-code`，完整 HTTP 响应 SHA-256 均为：

```text
CE6EC0ABF90B16EA72A776046D802D98BA77705763EE848461DBDF7AED575AFA
```

重建后资产目录恢复 22 个文件。

结果：完全一致，缓存是派生物而不是真相。

## Task 4：具体图标落差观察

整页比对已真实生成，并显示叠加透明度 50%。由于该项目仍缺 2 个区域解析，且布局、文字与图片也存在明显还原误差，因此整页错位不能全部归因于单个图标。以下结论结合 50% 整页叠加、元素原图切片和真实 SVG 候选逐项观察。

### 消息（账户顶部，56×56，`#111111`）

- 原图是细线方形消息气泡，内部有三枚白点。
- `mdi:message` 是实心气泡，没有三点，轮廓外形大致对得上但内部语义细节丢失；一眼可以看出不是原图。
- `mdi:message-outline` 在轮廓粗细和空心结构上更接近，但当前 `message` 搜索前四项没有直接把它排在首位。
- 颜色正确：SVG 使用 `currentColor`，实际继承 `#111111`。
- 占位基本正确：原框接近正方形 56×56，不发生明显拉伸。
- 结论：可用作低保真替代，不适合像素级还原；默认自动选首项会选错风格。

### 应用菜单（账户顶部，52×52，`#101010`）

- 原图是 2×2 的四枚圆点/小方块应用九宫格语义。
- `menu` 候选是三条横线，`menu-close/down/left` 是导航菜单或箭头变体，语义和形状完全不同。
- `currentColor` 能保证墨色接近，但颜色正确无法弥补形状错误。
- 占位均为正方形，尺寸不会明显变形，但三横线在 52×52 中视觉重量和原四点布局差异很大。
- 结论：通用关键词检索明显不合适，应保留 PNG；不能默认库图标优先。

### 设置（账户顶部，54×58，`#111111`）

- 原图是常规细线齿轮。
- `mdi:settings` 也是齿轮，语义和整体轮廓基本一致；这是三个顶部图标中最适合替换的一个。
- MDI 齿轮通常更实、更粗，中心孔和齿数细节与原图仍有差异，但在页面正常缩放下差异较小。
- 颜色能通过 `currentColor` 正确继承 `#111111`。
- 原框 54×58 略非正方形，SVG `width/height: 100%` 会产生约 7% 的纵向拉伸；肉眼不强烈，但严格比对可见。
- 结论：基本可接受；若保持宽高比而不是铺满框会更稳。

### 用户头像（账户顶部，168×147，`#e0e0e0`）

- 原元素是大面积圆形头像占位，不是小型符号图标。
- 通用单色用户图标即使语义相同，也会丢失原有圆形背景、渐变/层次和非正方形占位。
- 结论：应保留 PNG 或改为组件，不应走库图标。

### 企业礼盒、品类码、买菜币等业务图标

- 原页面这些元素是品牌化、多色插画，含 3–8 种颜色和业务专用造型。
- MDI 是单色通用符号；`currentColor` 只能表达一种颜色，无法还原多色层次。
- “企业礼盒”最多只能找到通用 gift，“品类码”“买菜币”没有一一对应的通用库语义。
- 即使占位框尺寸相同，视觉内容、品牌识别和色彩都明显错误。
- 结论：一眼就是错的，应默认 PNG 切图优先。

### 策略结论

- 适合库图标优先：设置、电话、购物车、通用左右箭头等标准单色 UI 符号，但仍需关注线性/实心风格和宽高比。
- 需要人工确认：消息、首页、钱包、评价气泡等同语义但风格可能不一致的图标。
- 应默认 PNG 优先：用户头像、企业礼盒、品类码、买菜币、会员插画及其他多色业务图标。
- 因此不建议全局“库图标优先”。更合理的默认策略是：只有高置信标准单色 UI 图标使用 SVG；多色、品牌化、业务自定义或候选风格不匹配时保留 PNG。

## 最终自动验证

- 核心包：31 个测试文件、419 条测试通过。
- 前端：22 个测试文件、301 条测试通过。
- 两个 typecheck 通过。
- 前端生产构建通过。
- 编辑文件 lint 诊断为 0。

## 证据文件

- `docs/superpowers/reports/2026-08-20-todo-walk-through.png`：真实图标属性/候选与工作区截图。
- `docs/superpowers/reports/2026-08-20-overlay-50.png`：真实整页比对 50% 状态截图。
