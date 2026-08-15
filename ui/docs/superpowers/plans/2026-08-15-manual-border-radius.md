# 手动圆角实现计划

> **执行要求：** 使用 `executing-plans` 技能按任务逐项实施并在每个检查点验证。

**目标：** 新检测元素默认不带圆角，只允许用户在右侧属性面板为 `image` 和 `component` 手动开启圆角；首次开启默认 `8px`，并兼容两类元素的已有圆角。

**架构：** 继续以可选的 `style.borderRadius` 同时表示开关和值，不新增状态字段。核心检测管线停止写入圆角；前端抽取统一的圆角适用规则，由属性面板、状态更新和叠加预览共同使用，确保不允许的元素类型既不可编辑、也不渲染，并在下一次保存时清理旧值。

**技术栈：** TypeScript、Vue 3、Vitest、Vue Test Utils、Sharp、Zod

---

## 任务 1：停止自动检测圆角

**文件：**
- 修改：`packages/region-split/src/element-detect.test.ts`
- 修改：`packages/region-split/src/element-detect.ts`

### 步骤 1：编写失败测试

更新构造 leaf 节点的测试，断言检测生成的节点 `style` 不包含 `borderRadius`；覆盖普通 leaf 和未覆盖回退节点，防止其他分支继续写入自动圆角。

### 步骤 2：运行测试并确认失败

运行：

```powershell
pnpm --filter @region-split/core test -- src/element-detect.test.ts
```

预期：测试因当前 `makeLeaf()`、`makeFallbackNode()` 仍调用 `measureBorderRadius()` 而失败。

### 步骤 3：最小实现

在 `element-detect.ts` 中：

- 从导入中移除 `measureBorderRadius`。
- 删除 `makeLeaf()` 中的圆角测量和 `borderRadius` 写入。
- 删除 `makeFallbackNode()` 中的圆角测量和 `borderRadius` 写入。
- 保留 `measureBorderRadius` 原语和独立像素测试，不扩大本次清理范围。

### 步骤 4：运行测试并确认通过

运行：

```powershell
pnpm --filter @region-split/core test -- src/element-detect.test.ts
```

预期：通过。

### 步骤 5：提交

```powershell
git add packages/region-split/src/element-detect.ts packages/region-split/src/element-detect.test.ts
git commit -m "fix: disable automatic element corner detection"
```

## 任务 2：添加圆角适用规则并清理非法旧值

**文件：**
- 修改：`apps/region-split-ui/src/element-state.test.ts`
- 修改：`apps/region-split-ui/src/element-state.ts`

### 步骤 1：编写失败测试

为状态层补充测试：

- `image`、`component` 被判定为支持手动圆角。
- `grid`、`text`、`icon`、`decoration` 不支持。
- 允许类型的 `setKind()` 保存时保留已有正圆角。
- 不允许类型的 `setKind()` 保存时删除遗留 `borderRadius`。
- 从允许类型切换为不允许类型时同步清理圆角。

### 步骤 2：运行测试并确认失败

运行：

```powershell
pnpm --filter @region-split/ui test -- src/element-state.test.ts
```

预期：测试因缺少统一规则且 `setKind()` 不清理圆角而失败。

### 步骤 3：最小实现

在 `element-state.ts` 中：

- 导出 `supportsBorderRadius(kind)`，仅允许 `image`、`component`。
- 新增内部样式规范化函数；不支持圆角时删除 `borderRadius`。
- `setKind()` 更新类型时使用规范化样式。
- 保持允许类型的既有正值不变。

### 步骤 4：运行测试并确认通过

运行：

```powershell
pnpm --filter @region-split/ui test -- src/element-state.test.ts
```

预期：通过。

### 步骤 5：提交

```powershell
git add apps/region-split-ui/src/element-state.ts apps/region-split-ui/src/element-state.test.ts
git commit -m "feat: restrict manual border radius by element kind"
```

## 任务 3：实现属性面板圆角开关

**文件：**
- 修改：`apps/region-split-ui/src/components/ElementProperties.test.ts`
- 修改：`apps/region-split-ui/src/components/ElementProperties.vue`

### 步骤 1：编写失败测试

增加属性面板测试：

- `image` 和 `component` 显示 `data-test="border-radius-toggle"`。
- 其他类型不显示开关，也不显示数值编辑器。
- 无正值时开关关闭，开启后提交 `{ borderRadius: 8 }`。
- 已有正值时开关开启，继续显示并保留原值。
- 关闭时提交删除圆角后的样式。
- 只有开启状态显示圆角数值输入和增减按钮。

### 步骤 2：运行测试并确认失败

运行：

```powershell
pnpm --filter @region-split/ui test -- src/components/ElementProperties.test.ts
```

预期：测试因当前所有类型均直接显示数值输入、且没有开关而失败。

### 步骤 3：最小实现

在 `ElementProperties.vue` 中：

- 使用 `supportsBorderRadius()` 判断当前类型。
- 新增 `borderRadiusEnabled` 计算状态，不增加持久化字段。
- 新增开关处理：开启时保留已有正值，否则写入 `8`；关闭时删除字段。
- 仅允许类型显示开关。
- 仅在开启时显示现有数值输入和 `±` 调整按钮。
- 提交样式前确保不允许类型不会携带遗留圆角。

### 步骤 4：运行测试并确认通过

运行：

```powershell
pnpm --filter @region-split/ui test -- src/components/ElementProperties.test.ts
```

预期：通过。

### 步骤 5：提交

```powershell
git add apps/region-split-ui/src/components/ElementProperties.vue apps/region-split-ui/src/components/ElementProperties.test.ts
git commit -m "feat: add manual border radius toggle"
```

## 任务 4：限制叠加预览的圆角渲染

**文件：**
- 修改：`apps/region-split-ui/src/components/ElementOverlay.test.ts`
- 修改：`apps/region-split-ui/src/components/ElementOverlay.vue`

### 步骤 1：编写失败测试

补充预览测试：

- `image`、`component` 的正圆角写入元素框样式。
- `text` 等不允许类型即使旧数据带有 `borderRadius`，样式仍不包含圆角。
- 缺少或为零的圆角不渲染。

### 步骤 2：运行测试并确认失败

运行：

```powershell
pnpm --filter @region-split/ui test -- src/components/ElementOverlay.test.ts
```

预期：不允许类型仍渲染旧圆角，因此失败。

### 步骤 3：最小实现

在 `ElementOverlay.vue` 中复用 `supportsBorderRadius()`，只有类型允许且值为正数时才返回 `borderRadius` 样式。

### 步骤 4：运行测试并确认通过

运行：

```powershell
pnpm --filter @region-split/ui test -- src/components/ElementOverlay.test.ts
```

预期：通过。

### 步骤 5：提交

```powershell
git add apps/region-split-ui/src/components/ElementOverlay.vue apps/region-split-ui/src/components/ElementOverlay.test.ts
git commit -m "fix: render corners only for supported elements"
```

## 任务 5：完整验证、真实界面检查与交付

**文件：**
- 按验证结果修正前述文件

### 步骤 1：运行项目级验证

```powershell
pnpm --filter @region-split/core test
pnpm --filter @region-split/core typecheck
pnpm --filter @region-split/ui test
pnpm --filter @region-split/ui typecheck
pnpm --filter @region-split/ui build
```

预期：全部退出码为 `0`。

### 步骤 2：检查修改范围

```powershell
git status --short
git diff --check
git diff --stat HEAD~4..HEAD
```

确认未提交用户现有的 `.npmrc` 修改，也未引入无关文件。

### 步骤 3：真实浏览器验证

分别启动核心 API 和 UI；在真实项目中验证：

1. 重新检测一个区域后所有元素默认直角。
2. `image`、`component` 右侧显示圆角开关。
3. 首次开启立即得到 `8px` 圆角并可调节。
4. 关闭后预览恢复直角。
5. 其他类型没有圆角入口，旧圆角不再渲染。

### 步骤 4：最终复核

使用代码审查与完成前验证流程复核需求、测试证据和工作区状态，修正发现的问题。

### 步骤 5：提交验证修复并推送

若验证产生修复，提交对应文件；随后推送当前分支：

```powershell
git push origin feature/region-split
```

不得将 `.npmrc` 或其他用户已有改动纳入提交。
