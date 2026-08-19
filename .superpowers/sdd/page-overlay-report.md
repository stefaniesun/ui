# 整页叠加比对验收报告

日期：2026-08-19
计划：`docs/superpowers/plans/2026-08-19-page-overlay-compare.md`

## 实现内容

### Task 1：整页预览文档

- 新增 `apps/region-split-ui/src/page-preview.ts`。
- 将 `html`、`css` 和 `/api/projects/:projectId/page-code` 返回的素材转换为 sandbox iframe 可用的 `srcdoc`。
- 图片资源仅在 `src`/`poster` 属性中替换为对应 Data URL；未知相对路径保留。
- 移除预览中无法加载的 `style.css` 外链。
- 阻断预览中的远程资源请求，并转义 CSS 中的 `</style`。

### Task 2：整页比对节点

- 新增 `PageCompareNode.vue` 及测试。
- 使用原图作为底层，生成页面 iframe 作为透明叠加层。
- 支持 0%—100% 透明度滑块、生成中状态、未解析区域错误提示和重复生成。
- 使用 `sandbox=""` 隔离生成文档。

### Task 3：画布接入

- 增加固定单例节点 `page`，旧 localStorage 缺少该键时回退默认位置。
- 工作区增加 `data-port="output"`，整页节点增加 `data-port="input"`。
- 增加工作区到整页节点的中性色连线。
- `fitAll`、节点边界收集和项目切换逻辑纳入整页节点。
- `RegionsNode` 增加「整页比对」入口，`App.vue` 接入 `PipelineCanvas.openPageCompare()`。

## 验证结果

### 测试

```text
23 test files passed
306 tests passed
```

命令：

```text
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui test -- --run
```

### 类型检查

通过，无输出：

```text
D:/nodejs/corepack.cmd pnpm --filter @region-split/ui typecheck
```

### 构建

首次标准 `pnpm build` 已完成模块转换，但清理既有 `dist` 时受到 CodeBuddy safe-delete shim 超时影响；代码本身未报编译错误。随后使用独立输出目录验证成功：

```text
D:/nodejs/corepack.cmd pnpm exec vite build --outDir dist-page-overlay-check
```

构建产物：

```text
dist-page-overlay-check/index.html
dist-page-overlay-check/assets/index-*.css
dist-page-overlay-check/assets/index-*.js
```

### 浏览器走查

实际打开：`http://localhost:5180`，上传 `packages/region-split/test-fixtures/maicai.png`，项目 `20260819-897t6s` 创建成功，页面列出 9 个区域：账户入口、资产概览、订单状态、优惠活动、常用服务、采购横幅、推荐分类、商品推荐、底部导航。

已完成的真实观察：

- 上传后先显示“AI 正在解析区域”，约等待 12 秒后出现 9 个区域列表，自动分析链路完成。
- 第 1 区“账户入口”点击“解析元素”成功；区域详情显示 `1170×338`，元素树包含用户头像组件、图标、文字和 3 项网格图标。
- 第 2 区“资产概览”点击“解析元素”成功；区域详情显示 `1170×308`，元素树包含 5 项列表网格及优惠券码、省钱卡、买菜币等文字项，并出现“框存疑”提示。
- 区域切换后已观察到第 3 区及后续区域需要滚动画布/页面才能操作，当前浏览器自动化引用在节点移出视口后超时；因此未把未完成区域伪造为已解析。
- 当前页面没有横向滚动条异常证据；浏览器控制台唯一错误是开发环境缺少 `favicon.ico` 的 404，与比对功能无关。

尚未能据实确认：

- 全部 9 个区域逐一解析完成后的整页代码生成；
- 整页比对节点真实生成及 0%/50%/100% 滑块画面；
- 生成页面中的图片/图标实际加载结果；
- 顶部、中部、底部逐区域像素错位方向和累计偏移量；
- 缺少区域时整页节点的真实 409 中文提示。

因此本报告仅记录上述真实结果，不声称 Task 4 已完整验收。组件级验证仍覆盖：整页节点单例、画布连线、入口事件、资产内联、未知资源保留、远程资源阻断、未解析错误映射。

## 偏离与风险

1. `PageCompareNode` 使用原图宽高作为叠加容器比例；服务端生成页面高度由区域最大 `y + h` 决定。如果区域没有覆盖原图底部，真实页面可能出现纵向比例差异。当前未修改 `packages/region-split`，保留该风险供真实图片走查确认。
2. 标准构建的 `dist` 清理被环境 safe-delete 超时阻断，使用独立输出目录构建成功。
3. 按计划要求，`packages/region-split` 本次未修改。
4. 画布端口和连线是视觉数据流表达，PageCompareNode 仍通过 `getPageCode(projectId)` 主动请求整页数据。
