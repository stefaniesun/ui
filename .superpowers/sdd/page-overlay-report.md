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

已打开：`http://localhost:5180`。

当前服务进程仍在运行，但本次环境未提供可直接操作上传文件和截图标注的浏览器交互结果，因此以下项目没有伪造为已观察：

- `maicai.png` 上传后的每个区域逐一解析；
- 0%/50%/100% 滑块的真实画面效果；
- 图片是否破图；
- 顶部、中部、底部区域的实际像素错位方向与估算像素；
- 故意缺少一个区域后的真实 409 UI 提示。

代码级与组件级验证已覆盖：整页节点单例、画布连线、入口事件、资产内联、未知资源保留、远程资源阻断、未解析错误映射。

## 偏离与风险

1. `PageCompareNode` 使用原图宽高作为叠加容器比例；服务端生成页面高度由区域最大 `y + h` 决定。如果区域没有覆盖原图底部，真实页面可能出现纵向比例差异。当前未修改 `packages/region-split`，保留该风险供真实图片走查确认。
2. 标准构建的 `dist` 清理被环境 safe-delete 超时阻断，使用独立输出目录构建成功。
3. 按计划要求，`packages/region-split` 本次未修改。
4. 画布端口和连线是视觉数据流表达，PageCompareNode 仍通过 `getPageCode(projectId)` 主动请求整页数据。
