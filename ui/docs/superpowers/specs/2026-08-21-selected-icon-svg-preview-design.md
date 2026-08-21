# 已匹配图标 SVG 预览设计

## 目标

在区域详情的元素属性面板中，当图标元素已经匹配到图标库资源时，直接展示该节点当前实际使用的 SVG 图形，使用户无需仅凭 `mdi:*` 图标 ID 判断匹配结果。

## 界面行为

- 仅当元素类型为图标、`iconDecision.kind` 为 `library`，且节点存在 `asset.ref` 时显示 SVG 预览。
- 预览使用当前项目资产接口加载 `asset.ref`，保证展示内容与节点最终使用及导出的 SVG 资源一致，不重新搜索图标库。
- 预览尺寸为 `40 × 40px`，保持 SVG 原始比例，并使用浅色预览背景以确保深色图标清晰可见。
- 图标 ID 文本继续显示在预览旁边，保留可识别性。
- “挑选图标”按钮及现有重新选择流程保持不变。
- 原图裁片和待确认状态继续沿用当前展示逻辑，不受本功能影响。
- SVG 加载失败时由浏览器显示不可用状态，但不阻断“挑选图标”操作。

## 实现范围

修改 `apps/region-split-ui/src/components/ElementProperties.vue`：

1. 生成当前库图标资产 URL。
2. 将库图标状态的纯文本行改为包含 SVG 图片预览和图标 ID 的预览行。
3. 增加局部布局及图片尺寸样式。

修改 `apps/region-split-ui/src/components/ElementProperties.test.ts`：

1. 验证库图标会使用当前 `projectId` 和经过 URL 编码的 `asset.ref` 渲染预览。
2. 验证预览的替代文本包含图标 ID。
3. 保留并验证原图裁片状态的既有行为。

## 数据流

`ElementNode.iconDecision.iconId` 提供图标标识，`ElementNode.asset.ref` 提供已物化 SVG 的项目内资源引用。组件通过 `/api/projects/{projectId}/assets/{encodedAssetRef}` 加载资源。该功能不增加接口、不修改持久化结构，也不改变图标选择状态。

## 验证标准

- 选择已匹配图标元素后，属性面板能看到该 SVG 的具体图形。
- SVG 预览与当前节点实际资产一致。
- 图标 ID 和“挑选图标”按钮仍然可见、可用。
- 原图裁片与待确认图标状态没有回归。
- 组件测试、类型检查和相关构建通过。
