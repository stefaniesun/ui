# 结构化视觉内容节点设计

## 目标

修复 VisualIR 只能描述区域矩形、代码生成器只能产出空白 `<view>` 的问题。视觉模型必须从参考图提取真实可见文案、素材、控件和装饰信息；代码生成器必须将这些结构化事实安全地生成为 Vue/uni-app 内容。

本次先覆盖现有单状态、viewport、H5 MVP，不引入模型直接生成 Vue 模板、多页面路由或复杂业务状态。

## 设计决策

- 采用方案 A：在 VisualIR 中增加有序、强类型的结构化内容节点。
- 模型只输出结构化事实，不输出或执行任意 Vue/HTML/CSS 源码。
- `displayName` 继续作为区域语义标签，不得降级为页面可见文案。
- 素材由内容节点通过 `assetId` 引用顶层 `assets`，统一校验和生成。
- 非装饰性叶子区域没有内容时失败关闭，禁止静默生成空白组件。
- 重新分析或生成失败时不得覆盖当前可运行文件。

## 数据合同

### 内容节点

每个 `RegionNode` 增加有序 `content` 数组，使用 `kind` 判别联合：

```ts
type ContentNode =
  | {
      kind: 'text'
      nodeId: string
      text: string
      role: 'title' | 'body' | 'label' | 'price' | 'caption'
      bounds: Bounds
      typographyToken?: string
      colorToken?: string
    }
  | {
      kind: 'asset'
      nodeId: string
      assetId: string
      alt: string
      bounds: Bounds
      fit: 'contain' | 'cover' | 'fill'
    }
  | {
      kind: 'control'
      nodeId: string
      control: 'button'
      label: string
      bounds: Bounds
      actionId?: string
    }
  | {
      kind: 'decoration'
      nodeId: string
      decoration: 'surface' | 'divider' | 'shape'
      bounds: Bounds
      colorToken?: string
      radiusToken?: string
    }
```

`bounds` 使用页面逻辑像素坐标，与区域坐标保持同一坐标空间；代码生成时转换为相对宿主区域的位置。

### 素材

```ts
interface VisualAsset {
  assetId: string
  regionId: string
  role: 'image' | 'icon' | 'avatar' | 'background'
  source: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
}
```

`source` 必须是安全的项目相对路径，且位于允许的素材目录。`assetId` 全局唯一，`regionId` 必须存在，内容节点中的 `assetId` 必须解析到已有素材。

### 交互

现有 `interactions: unknown[]` 收紧为最小强类型合同：交互 ID、触发内容节点、动作类型和可选目标状态。引用的区域、内容节点和状态必须存在。

## 合同约束

Zod 校验必须保证：

- 区域 ID、内容节点 ID、素材 ID 和交互 ID 在各自作用域唯一；
- 文本和按钮标签非空，生成时执行模板文本与属性转义；
- 内容节点边界为有限正数，并位于页面画布内；
- 素材路径不绝对、不包含目录穿越且位于允许目录；
- `assetId`、`regionId`、`nodeId` 和状态引用完整；
- 非装饰性叶子区域至少包含一个 `text`、`asset` 或 `control` 节点；
- 纯容器区域可通过子区域提供内容，装饰区域允许没有可见文案。

## 模型分析

`analyzePage()` 的 Prompt 明确要求：

- OCR 提取参考图中的真实可见文案，保留货币符号、数字、日期与标点；
- 为头像、图标、背景图和产品图建立素材槽位；
- 提取主要按钮及其标签；
- 使用内容节点的精确页面逻辑坐标；
- 不得把英文区域名或 `displayName` 当作可见文案；
- 无法确定的事实应降低置信度，不得编造模板代码。

模型输出继续经过现有 JSON Schema、结构化输出修复重试和最终 Zod 校验。旧 VisualIR 不自动伪造占位内容；需要重新分析后才能进入严格生成链路。

## 代码生成

代码生成器按 `region.content` 顺序输出：

- `text` → `<text>`；
- `asset` → `<image>`，引用生成的类型安全素材注册表；
- `control` → 可访问的 `<button>`；
- `decoration` → 无语义 `<view aria-hidden="true">`。

每个节点生成稳定的 `data-content-id`，位置相对所属区域计算。Token 引用只允许指向 VisualIR 中存在的 Token；缺失的可选样式使用安全基础样式，不生成任意 CSS。

素材注册表由 `ir.assets` 直接生成，删除 `runPage()` 中的 `assets: []` 硬编码。报告从结构化素材和交互数据生成 `assetSlots`、`interactions`，不再写死空数组。

## 数据流

1. 读取 manifest、参考图和人工区域覆盖。
2. 视觉模型输出包含内容、素材和交互的 VisualIR。
3. CLI 归一化区域边界、绑定组件路径并执行完整合同校验。
4. 先写临时文件并校验，成功后原子替换 `visual-ir.json`。
5. codegen 校验 IR，生成页面、组件、Tokens 和素材注册表。
6. 构建 H5，由 Playwright 打开页面并采集截图、DOM 与语义区域。
7. OCR/视觉评分与参考图比较；候选未改善时沿用现有回退机制。
8. 更新 review 报告和本地 HTML 预览。

## 错误处理与安全

- 模型输出不合规：使用现有修复请求；最终仍不合规则终止。
- 素材缺失、引用悬空或路径越界：终止生成并报告 `assetId`/`regionId`。
- 非装饰叶子内容为空：终止生成并报告 `regionId`。
- 文本与属性：HTML 转义；禁止注入 `<script>`、事件属性或任意模板表达式。
- 分析或生成失败：保留旧 IR 和旧页面，不进行部分覆盖。
- 模型错误信息继续执行密钥和 Base64 图片脱敏。

## 测试与验收

### 合同测试

- 接受合法文本、素材、按钮和装饰节点；
- 拒绝重复 ID、悬空引用、不安全路径、非法类型和越界坐标；
- 拒绝非装饰空叶子区域。

### 代码生成测试

- 生成真实 `<text>`、`<image>`、`<button>` 与装饰节点；
- 保持内容顺序、稳定 ID、相对坐标和安全转义；
- 素材注册表来自 `ir.assets`；
- 空内容和不安全素材失败关闭。

### 迅雷集成验收

重新分析 `fixtures/xunlei-member/reference/default.png` 后：

- VisualIR 包含原图真实中文标题、会员价格、权益和支付按钮文案；
- 头像及主要图标具有有效素材引用；
- 生成组件不再只是空 `semantic-region`；
- reference-app 类型检查、lint 和 H5 构建通过；
- 浏览器中存在可见文字、图片和控件；
- 生成实际截图、热力图和 review 报告；
- 本地 `dist/index.html` 通过 HTTP 预览时不再是空白页面。
