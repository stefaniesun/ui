# UI 效果图区域拆分工具

把一张移动端 UI 效果图拆成 5–10 个粗粒度模块并自动命名，人工可微调边界、拆分、合并、重命名。产物是一份稳定的区域划分 JSON，作为后续还原工作的输入。

设计文档：[docs/superpowers/specs/2026-08-11-region-split-design.md](docs/superpowers/specs/2026-08-11-region-split-design.md)

## 它为什么这么做

移动端页面绝大多数垂直堆叠，所以粗粒度模块边界本质上是**一组水平切分线**，而不是任意矩形。这带来三个好处：

- 不要求多模态模型输出 `(x, y, w, h)`，只要它说"在哪几个 Y 位置切开"——绕开了模型坐标精度不足的老问题；
- 区域天然首尾相接，不会重叠、不会有缝隙、不会漏掉页面的任何一块；
- 图像水平投影分析能找出**真实的**分割位置（留白带、色彩突变行），把模型给的粗略 Y 值吸附上去，精度从"大概"变成"贴合"。

工具负责给出精确的候选位置，模型负责判断哪些候选是真正的模块边界——两者互补。

## 启动

需要 Node ≥ 22 和 pnpm。两个终端：

```bash
pnpm -C ui install && pnpm -C ui/packages/region-split dev
```

```bash
pnpm -C ui/apps/region-split-ui dev
```

服务端默认 `127.0.0.1:4800`，前端默认 `127.0.0.1:5180`（已配 `/api` 代理）。打开 http://127.0.0.1:5180 。

## 配置模型

复制模板，填上自己的端点：

```bash
cp ui/region-split.config.example.json ui/region-split.config.json
```

```json
{
  "baseUrl": "http://127.0.0.1:11434/v1",
  "model": "qwen2.5vl:7b",
  "apiKey": ""
}
```

- **baseUrl**：OpenAI 兼容端点，例如本地 Ollama 的 `http://127.0.0.1:11434/v1`
- **model**：需要支持图片输入的多模态模型
- **apiKey**：本地模型留空即可
- **timeoutMs**（可选）：单次模型请求超时，缺省 120000。整页分段实测要十几到几十秒，端点慢就调大

配置每次请求都重读，**改完文件立即生效，不用重启服务**。服务启动时会打印它读的是哪个文件、当前配到了哪个模型。

确认连得通：

```bash
curl -X POST http://127.0.0.1:4800/api/model-config/check
```

返回 `{"ok":true}` 说明可用，失败会带上原因。

`region-split.config.json` 含 API Key，已在 `.gitignore` 里。也可以改用环境变量 `UIR_MODEL_BASE_URL` / `UIR_MODEL_API_KEY` / `UIR_MODEL_NAME`（配置文件优先），或用 `UIR_CONFIG_FILE` 指定别的配置文件路径。

界面上**没有**模型配置入口——API Key 不经过浏览器，也不存在能通过 HTTP 改写服务端配置的接口。工具栏只显示当前模型名，未配置时提示该去编辑哪个文件。

未配置模型时，「重新分析」和「AI 重命名」会禁用，其余功能（上传、手动拆分/合并/微调/重命名、撤销）全部照常可用——候选切分线是纯图像分析，不需要模型，所以手动拆分的吸附一样有效。

## 操作

| 操作 | 方式 |
|------|------|
| 选中区域 | 点图上色块或右侧列表；`Ctrl` / `Shift` 加选 |
| 微调下边界 | 选中后点 `▲` `▼`，或按 `↑` `↓` |
| 拆分 | 选中后点「拆分」→ 移动鼠标（会吸附到检测出的真实分割线）→ 点击确认 |
| 合并 | 选中多个**相邻**区域 → 点「合并」 |
| 重命名 | 点「重命名」或双击列表里的名字 |
| AI 重命名 | 选中后点「AI 重命名」 |
| 撤销 / 重做 | 工具栏按钮，或 `Ctrl+Z` / `Ctrl+Shift+Z` |
| 退出拆分模式 / 清空选中 | `Esc` |

拆分和合并后，新区域会自动交给模型重新命名（结构变了原名字就不准了）。所有改动实时落盘，URL 带 `#<projectId>`，刷新页面可恢复现场。

## 数据

```text
ui/
  region-split.config.json         模型配置（含 API Key，已 gitignore）
  region-split.config.example.json 模板
  data/                            运行期数据，已 gitignore
    projects/<projectId>/
      image.png                    上传的原图，永不改动
      image.clean.png              抹掉手机系统外壳后的图，与原图同分辨率
      image.analyzed.png           清理图的缩放版（长图会被等比缩到 2000px 高）
      regions.json                 区域划分结果
```

上传后会先做一层**预处理**：抹掉手机状态栏（时间、信号、电量）和底部 Home Indicator，用紧邻的干净行逐列外推把背景补回来。这是确定性计算不是生成模型，**不编造内容**；相邻区域是内容而非背景时会放弃清理，宁可留着也不硬填。**分辨率不变**——只重写像素，不缩放不裁剪。原图完整保留，`?original=1` 可取。

抹掉的带高记在 `image.removedChrome` 里，**它就是安全区 inset**：下游生成代码时相邻模块的背景要向那个方向铺满。这也是不直接裁掉状态栏的原因——裁了这个信息就没了。

文档里还有 `panels`——图像分析检测出的卡片区间。模块边界不得横穿卡片：一维行分析分不清"卡片内部的行间距"和"卡片之间的留白"（像素上完全一样），面板检测补上这个二维信息，落在卡片内部的候选线会在进入划分和模型之前被剔除。

每个区域除了名称、类型和边界，还带 `scrollX` / `scrollY` 两个布尔值，标记这块是否整体可横向/纵向滑动——直接对应 CSS 的 `overflow-x` / `overflow-y`，供后续还原时生成横滑容器。列表里可滚动的区域会显示 `↔` / `↕` 徽章。

`regions.json` 的坐标一律是**原图像素**。服务端在每次写入前校验不变量（升序、首尾相接、覆盖全图、每块 ≥ 8px、id 唯一），违反直接拒绝，不做静默修正。

## 开发

```bash
pnpm -C ui test         # 两个包的全部测试
pnpm -C ui -r typecheck # 类型检查
```

代码分两个单元：

- `packages/region-split`（`@region-split/core`）——图像分析、模型调用、融合修正、文件存储、HTTP 服务
- `apps/region-split-ui`（`@region-split/ui`）——Vue 3 界面

前端只能从 `@region-split/core/browser` 导入（只含纯逻辑和类型）。根入口 `@region-split/core` 会带进 `node:fs` / `sharp` / `fastify`，在浏览器里构建不了。

核心算法都是纯函数，测试主要压在这几处：`operations.ts`（编辑操作）、`reconcile.ts`（融合修正）、`candidate-lines.ts` 的 `candidatesFromRows`（切分线检测）。模型调用在测试里一律注入 fake，不打真实网络。
