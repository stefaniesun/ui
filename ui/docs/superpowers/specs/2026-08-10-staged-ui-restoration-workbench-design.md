# 分阶段 UI 还原工作台设计（Staged UI Restoration Workbench）

## 1. 背景与目标

UI 效果图（移动端为主）直接交给多模态 AI 一次性生成代码，保真度只有约 50%，字体、颜色、间距、组件语义、图标、交互全部需要人工大量二次精调。根因是多模态模型是"语义理解器"而不是"测量仪器"，且一次性生成没有反馈闭环，所有错误堆积到最终代码里才暴露，修复成本最高。

本设计放弃"全自动收敛"路线，改为**分阶段工作流 + 每阶段人工在专属界面上微调确认**：

- 流水线拆成六个阶段，每阶段 AI 先产出结构化草稿，人工用为该阶段定制的交互微调后**确认冻结**，下游阶段只消费冻结产物。
- 每一阶段的错误在它最便宜的时候被修掉：布局框错了在阶段②拖一下边界即可，漏到阶段⑤就变成"生成的代码结构不对"，修复成本翻十倍。
- 全流程提供统一的**标注驱动微调**能力：在截图上框选区域 + 文字描述，AI 返回结构化补丁，人工确认后生效。

首期只实现**阶段①（测量与预处理）作为交互试点**，验证"AI 草稿 → 画布微调 → 确认冻结"的交互范式；后续阶段沿用同一范式扩展。

### 与 2026-07-24 版设计的关系

前版设计（`2026-07-24-ai-ui-reconstruction-pipeline-design.md`）的以下资产直接沿用：

- Visual IR 的事实/推断分离原则、`source/confidence/evidence/override` 四元标记。
- 测量与推断分离：确定性工具（OCR、取色、几何）承担测量，多模态模型只做语义。
- 参考图测量一次冻结、资产槽位、区域语义树等概念。

以下内容被替换：

- **8 轮 AI 自主迭代状态机 → 六阶段人工门禁工作流**。自动闭环仅保留在阶段⑤内部作为可选的小规模收敛（≤2 轮），且每轮补丁需人工接受。
- **CLI/IDE Agent 为主的形态 → CLI + 本地 Web 工作台为主**。人工微调是一等公民，必须有可视化界面。

## 2. 总体架构

```
ui-restore CLI
  ├─ init / open <page>        创建页面工作区、启动工作台
  └─ workbench 本地服务 (Node)
       ├─ 静态服务: workbench-ui (Vue3 + Vite 构建产物)
       ├─ REST API: 阶段文档读写、补丁应用、历史/撤销
       ├─ 测量引擎调用: OCR / 颜色 / 几何（本地确定性工具）
       ├─ 模型适配器: OpenAI 兼容接口（标注微调、语义分析）
       └─ 渲染器: Playwright（阶段⑤使用）
```

Monorepo 包结构（pnpm workspace）：

| 包 | 职责 |
|----|------|
| `packages/contracts` | 所有阶段文档、补丁、标注的 TypeScript 类型 + JSON Schema + 校验 |
| `packages/measure` | OCR、颜色聚类、图像归一化等确定性测量（试点仅 OCR + 归一化 + 颜色） |
| `packages/model-adapter` | OpenAI 兼容调用、结构化输出、Schema 校验、重试降级 |
| `packages/workbench-server` | 本地 HTTP 服务、页面工作区文件存储、阶段状态机、补丁/历史 |
| `apps/workbench-ui` | 浏览器端工作台（Vue 3 + TypeScript + Vite） |
| `packages/cli` | `ui-restore init/open/doctor` 入口 |

### 2.1 页面工作区目录

每个待还原页面一个独立目录，所有阶段产物落盘为文件（可 diff、可回退、可入版本库）：

```text
pages/<page-id>/
  manifest.yaml            # 设备宽高、DPR、状态栏策略、截图清单
  reference/
    default.png            # 参考截图（可多状态）
  stages/
    01-measurement.json    # 阶段①产物（含 status: draft|confirmed）
    02-layout.json
    03-tokens.json
    04-content-assets.json
    05-page.gen/           # 生成代码 + 渲染截图 + 评分
    06-interactions.json
  assets/                  # 人工替换的正式图标/图片
  history/
    01-measurement/        # 每次变更一条 patch 记录（JSON Patch + 元信息）
```

## 3. 通用机制（贯穿所有阶段）

### 3.1 阶段文档模型

每个阶段文档统一外壳：

```ts
interface StageDoc<TPayload> {
  stage: StageId;              // "measurement" | "layout" | ...
  schemaVersion: string;
  status: "empty" | "analyzing" | "draft" | "confirmed";
  payload: TPayload;           // 阶段专属数据
  upstreamFingerprint: string; // 上游冻结产物哈希，失配时提示重跑
  confirmedAt?: string;
  confirmedBy?: string;
}
```

规则：

1. `confirmed` 后文档只读；如需修改必须显式"解冻"，解冻会将所有下游阶段标记为 `stale` 并提示影响范围。
2. 下游阶段启动前校验 `upstreamFingerprint`，上游变了必须重跑或人工确认沿用。
3. 阶段内所有修改（人工直接编辑、AI 补丁被接受）都以 JSON Patch 追加进 `history/`，支持撤销/重做和"谁改的、为什么改"审计。

### 3.2 事实与推断标记

沿用前版原则，payload 中每个条目携带：

- `source`: `"tool" | "model" | "human"` —— 人工修改过的条目 `source` 变为 `human`，后续 AI 重跑**不得覆盖**（重跑结果与 human 条目冲突时进入冲突清单由人工裁决）。
- `confidence`: 0–1（tool 测量按引擎置信度，human 恒为 1）。
- `reviewed`: 人工是否已过目（用于审阅进度统计和确认门禁）。

### 3.3 标注驱动微调（核心交互，所有阶段共享）

用户在任何阶段的画布上框选一个矩形 + 输入文字描述，触发一次 AI 定向修改：

```ts
interface Annotation {
  id: string;
  stage: StageId;
  bounds: Rect;                // 参考图逻辑像素坐标
  instruction: string;         // 人工文字描述
  targetIds?: string[];        // 可选：显式关联的条目（框选自动命中 + 手工增删）
  createdAt: string;
}
```

处理流程：

1. 服务端裁剪 `bounds`（外扩 10% 上下文）得到局部图。
2. 组装请求：局部图 + 框内命中的当前阶段数据条目 + 指令文字 + 该阶段的补丁 Schema。
3. 模型返回 **`ChangeSet`（JSON Patch 操作数组 + 每条操作的说明）**，服务端 Schema 校验，非法则重试/降级，绝不落库自由文本。
4. 前端以"幽灵预览"渲染变更（新增框虚线、修改项黄色高亮、删除项红色划线），用户**逐条或全部**接受/拒绝。
5. 接受的操作应用到草稿并写入历史；标注本身也归档，作为后续同类问题的少样本参考。

约束：AI 只能修改 `bounds` 命中范围内、且 `source !== "human"` 的条目，越界操作服务端直接拒绝。

### 3.4 置信度驱动审阅

"人工少量修正"成立的前提是不让人工全量过目。每阶段界面提供：

- **审阅队列**：按置信度升序排列待审条目，键盘快捷键快速通过/修正（类似照片筛选流）。
- **置信度过滤器**：滑杆隐藏高置信度条目，只看机器没把握的。
- **确认门禁**：点"确认冻结"时检查——低于阈值（默认 0.85）的条目必须全部 `reviewed`，否则列出未审清单。

## 4. 六阶段职责与交互设计

### 阶段① 测量与预处理（试点，详见 §5）

- **AI/工具**：图像归一化（物理→逻辑像素、裁状态栏）、OCR 全部文字+边界框、页面颜色聚类采样。
- **人工**：修正 OCR 错字、调整/合并/拆分/补画文字框、删除误检、绘制动态内容忽略区、确认设备参数。
- **微调交互**：画布叠加 OCR 框（按置信度着色）+ 侧栏联动编辑 + 审阅队列 + 标注微调。
- **冻结产物**：测量事实层（文字条目、色样、归一化参数、忽略区）。

### 阶段② 布局结构

- **AI**：基于冻结测量事实 + 多模态语义，产出语义区域树（导航/卡片/列表/宫格…每节点含 `regionId`、显示名、bounds、父子关系）和布局骨架推断（每区域 flex/grid/流式、主轴、对齐、约束关系）。
- **人工**：拖动区域边界；框选多个区域合并、一个区域拆分；树上拖拽调整层级；改语义命名；修正布局类型（如"这不是 grid 是横向滚动"）。
- **微调交互**：
  - 左侧**区域树面板** ↔ 右侧**画布嵌套色块叠加**双向联动（点树高亮画布，点画布定位树）。
  - 边界拖拽带磁吸：自动吸附到 OCR 文字框边缘和检测到的分割线。
  - 布局类型下拉 + 每区域属性面板（方向、间距模式、对齐）。
  - 标注微调："这两张卡片是同一列表的重复项"→ AI 合并为列表区域。
- **冻结产物**：区域树 + 布局骨架。

### 阶段③ 样式令牌

- **AI**：把测量事实聚类成项目级 Design Token——字体阶梯（字号/字重/行高档位）、色板（背景/主文/次文/强调/状态色）、间距刻度、圆角、阴影；并为每个使用点建立"测量值 → Token"绑定。
- **人工**：合并近似档位（15px/16px 归为一档）；改 Token 值和命名；绑定真实字体文件；对个别使用点覆盖绑定。
- **微调交互**：
  - **Token 表**（值、用例数、置信度）↔ 画布：点 Token 高亮页面上所有使用位置；点画布元素反查其 Token。
  - 拖拽合并：把一个字号档拖到另一个档上合并，画布实时预览影响范围。
  - 取色镜：在原图上重新吸色替换 Token 值。
  - 标注微调："这几个标题其实是同一字号"→ AI 归档。
- **冻结产物**：Design Token 表 + 使用点绑定。

### 阶段④ 内容与资产

- **AI**：文字内容从阶段①注入；检测图标/图片/头像/徽标并裁切进资产槽位（语义键如 `icon.notice`）；对线性图标匹配开源图标集候选（按形状相似度给 3–5 个候选）。
- **人工**：上传替换正式资产；从候选中挑选图标；修改文案（占位数据 → 真实数据结构说明）。
- **微调交互**：
  - **资产格子墙**：每格左边参考图裁切、右边当前资产，未替换的标黄；点击上传或从候选选择。
  - 替换后就地预览尺寸/视觉中心/描边粗细是否协调。
  - 文案表格批量编辑（与画布联动定位）。
  - 标注微调："这个不是图标是用户头像"→ AI 改资产类型和槽位策略。
- **冻结产物**：内容清单 + 资产映射表。

### 阶段⑤ 代码生成与对比验收

- **AI**：按①–④冻结产物生成页面代码（Token 化样式、区域树对应组件结构、资产槽位引用）；Playwright 固定环境渲染截图；按区域计算评分（文字位置偏差、颜色 ΔE、几何偏差、区域 SSIM）+ 差异热力图；对人工标注生成**限定区域内文件**的定向补丁。
- **人工**：三种模式看差异；对不满意区域框选下指令；逐个接受/拒绝补丁；最终验收。
- **微调交互**：
  - 对比三模式：**并排**（同步滚动/缩放）、**叠加**（透明度滑杆）、**闪烁**（快速切换找差异）。
  - **区域评分榜**：按得分升序列出所有区域，点击同时在两侧图放大定位。
  - 标注微调在此阶段作用于渲染图："这块行间距大了约 4px"→ AI 产出补丁 → 自动重渲染 → 展示前后对比 → 人工接受/回退。补丁只允许触碰该区域绑定的组件文件与相关 Token。
  - 可选自动收敛：一键让 AI 对评分最低的 N 个区域各试一轮补丁（上限 2 轮），全部以待接受状态排队，不自动落库。
- **冻结产物**：页面代码 + 验收报告。

### 阶段⑥ 交互标注（可选）

- **AI**：按平台惯例默认实现高置信度交互（按压态、返回、tab 切换、输入聚焦）；列出中低置信度交互假设清单（元素、猜测行为、置信度、证据）。
- **人工**：勾选/否决假设；用文字或补充截图（其他状态图）描述页面特有交互；在实时预览中点按验证。
- **微调交互**：假设清单卡片（接受/否决/改描述）+ iframe 实时预览可直接操作 + 上传状态截图关联到某假设。
- **冻结产物**：交互实现 + 说明。

## 5. 阶段①试点详细设计

### 5.1 数据结构（contracts）

```ts
type Source = "tool" | "model" | "human";   // 见 §3.2
interface Rect { x: number; y: number; w: number; h: number }  // 逻辑像素
interface Size { w: number; h: number }

interface MeasurementPayload {
  normalization: {
    referenceImage: string;      // 相对路径
    physicalSize: Size;          // 原图像素
    scale: number;               // DPR，如 3
    logicalSize: Size;           // 归一化后逻辑像素
    statusBarCrop?: Rect;        // 被裁剪/遮罩的系统栏区域
    source: Source; confidence: number; reviewed: boolean;
  };
  textItems: TextItem[];
  colorSamples: ColorSample[];
  ignoreMasks: IgnoreMask[];     // 动态内容/不计分区域，人工绘制为主
}

interface TextItem {
  id: string;
  text: string;
  bounds: Rect;                  // 逻辑像素
  lineHeightPx?: number;         // 由行结构估算
  fontSizePx?: number;           // 由字高估算
  ocrConfidence: number;
  source: Source; confidence: number; reviewed: boolean;
}

interface ColorSample {
  id: string;
  role: "background" | "surface" | "text-primary" | "text-secondary" | "accent" | "unknown";
  hex: string; lab: [number, number, number];
  sampleRegion: Rect;            // 采样来源区域（避开抗锯齿边缘）
  source: Source; confidence: number; reviewed: boolean;
}

interface IgnoreMask {
  id: string; bounds: Rect; reason: string;
  source: Source; confidence: number; reviewed: boolean;
}
```

### 5.2 测量引擎选型

- **OCR：RapidOCR（PaddleOCR 模型 + ONNX Runtime）**。选它而非原生 PaddleOCR 的原因：Windows 下免装 Paddle 框架、纯 pip 依赖轻、结果确定；精度与 PaddleOCR 同源。以 Python 子进程方式调用（`measure` 包封装 spawn + JSON stdio 协议），`ui-restore doctor` 负责检测 Python 环境并提示安装。
- **颜色**：Node 侧实现——对图像做保边降噪后按网格采样，转 Lab 空间 K-means 聚类，聚类中心回查采样区域（取纯色块内部，避开文字与边缘 8px）。
- **归一化**：`sharp` 做缩放与裁剪；DPR 从 manifest 读取（默认按宽度 750/1125/1170 等常见值猜测并让人工确认）。

### 5.3 服务端 API（workbench-server）

```
POST /api/pages/:pageId/stages/measurement/analyze     # 触发/重跑测量（保留 human 条目）
GET  /api/pages/:pageId/stages/measurement             # 读取阶段文档
PATCH /api/pages/:pageId/stages/measurement            # 应用一组 JSON Patch（人工直接编辑）
POST /api/pages/:pageId/stages/measurement/annotations # 提交标注 → 返回 ChangeSet 提案
POST /api/pages/:pageId/stages/measurement/changesets/:id/accept  # 接受提案（可指定子集）
POST /api/pages/:pageId/stages/measurement/confirm     # 确认冻结（校验审阅门禁）
POST /api/pages/:pageId/stages/measurement/unfreeze
GET  /api/pages/:pageId/stages/measurement/history     # 历史；POST …/undo | /redo
GET  /api/pages/:pageId/reference/:name                # 原图与裁剪服务（?rect= 支持标注裁剪）
```

所有写操作服务端过 Schema 校验 + human 条目保护 + bounds 越界检查。

### 5.4 工作台 UI（阶段①界面）

布局：左**审阅队列** / 中**画布** / 右**属性面板**，顶部工具栏 + 底部状态条。

画布（核心组件，基于 SVG 叠加层实现，缩放平移用 CSS transform）：

- 参考截图为底，叠加所有 `TextItem` 边界框：绿色 ≥0.95、黄色 0.85–0.95、红色 <0.85；`reviewed` 的降低透明度。
- **选择**：点击选中（侧栏联动展示可编辑属性）、框选多选、`Tab` 跳到下一个未审条目。
- **编辑框**：拖动边/角改 bounds（吸附到像素）、双击进入文字内联编辑、`Delete` 删除误检。
- **合并/拆分**：多选 → `M` 合并为一条（文字拼接、bounds 取并集）；选中一条 → `S` 按空格位置拆分。
- **补画**：`N` 进入画框模式，画出漏检文字的框，输入文字（此时可触发局部 OCR 重识别辅助填入）。
- **忽略区**：`I` 进入遮罩模式绘制，填写原因。
- **标注微调**：`A` 进入标注模式，框选 + 输入指令 → 右侧出现 ChangeSet 提案卡片，画布幽灵预览，逐条接受/拒绝。
- 撤销/重做：`Ctrl+Z / Ctrl+Shift+Z`，全部走服务端历史。

审阅队列（左栏）：

- 按置信度升序列出未审条目，显示缩略裁剪图 + 识别文字；`Enter` 通过（标记 reviewed）、直接改字后 `Enter` 修正并通过。
- 顶部进度条：已审/总数、低置信度剩余数。

属性面板（右栏）：

- 选中条目的全部字段编辑；归一化参数卡片（设备宽度、DPR、状态栏裁剪，带"确认无误"勾选）。
- 颜色采样列表：色卡 + 角色下拉 + 采样区域高亮；支持取色镜重新吸色。

确认冻结：

- 按钮常驻右上；点击时运行门禁（低置信度未审清单、归一化未确认、忽略区无原因等），通过后二次确认 → status 变 `confirmed`，界面转只读。

### 5.5 阶段①的 AI 调用点

试点阶段模型调用**只有一个**：标注驱动微调（§3.3）。OCR/颜色/归一化全部是确定性工具，不依赖模型。这保证试点即使模型质量一般也能跑通，且把"AI 提案 → 人工接受"协议先打磨好。

### 5.6 试点验收标准

以 `fixtures/xunlei-member`（仓库已有）+ 1 个新页面为验收素材：

1. 跑通 `init → analyze → 人工微调 → confirm` 全流程，产物文件可 diff。
2. OCR 审阅效率：500 字以内的页面，人工完成全部修正 ≤ 10 分钟。
3. 标注微调：对"批量修正同类 OCR 错误"类指令，AI 提案接受率 ≥ 70%（人工主观判定可用）。
4. 历史完整：任意时刻撤销可回到任意前序状态；`confirmed` 文档哈希稳定。
5. human 条目保护：重跑 analyze 后人工修改零丢失。

### 5.7 试点明确不做

- 阶段②–⑥的任何实现（但 contracts 中预留 StageId 枚举与 StageDoc 外壳）。
- 多页面批量、团队协作、账号权限。
- 多状态截图（数据结构预留 `reference/` 多图，界面只处理 default）。
- 几何/网格测量（放到阶段②前置步骤）。

## 6. 技术选型汇总

| 项 | 选择 | 理由 |
|----|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia | 与既有仓库栈一致 |
| 画布 | 原生 SVG 叠加层（不引入 Konva/Fabric） | 框、手柄、高亮均为矩形，SVG + 指针事件足够，省依赖 |
| 服务端 | Node + Fastify | 轻量、TS 友好、Schema 校验生态好 |
| 图像处理 | sharp | 归一化、裁剪、采样 |
| OCR | RapidOCR（ONNX，Python 子进程） | Windows 部署轻、确定性、中文精度好 |
| 模型接入 | OpenAI 兼容适配器（沿用前版 model-adapter 设计） | 不绑厂商，本地/中转站皆可 |
| 补丁协议 | JSON Patch (RFC 6902) + Ajv 校验 | 历史、撤销、AI 提案统一表达 |
| 渲染（阶段⑤） | Playwright，固定视口/DPR/内置中文字体 | 前版结论沿用 |
| 目标产物栈 | 阶段⑤可插拔；首个后端 H5（Vue3），uni-app 后置 | 试点不涉及；H5 迭代最快 |
| 测试 | Vitest（contracts/server 单测为主）+ Playwright（UI 冒烟） | — |

## 7. 里程碑

1. **M1 试点（本期）**：contracts + measure(OCR/颜色/归一化) + workbench-server + 阶段①完整界面 + 标注微调协议。
2. **M2 布局**：几何/分割线检测、区域树编辑器（树 ↔ 画布联动是主要新交互）。
3. **M3 令牌 + 资产**：聚类算法、Token 表交互、资产格子墙。
4. **M4 生成与对比**：codegen（可复用既有 `packages/codegen` 思路）、渲染评分、对比三模式、区域定向补丁。
5. **M5 交互标注**：假设清单 + 实时预览。

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| OCR 对艺术字/图内文字漏检 | 补画框 + 局部重识别；漏检率高的页面靠审阅队列兜底 |
| AI 补丁提案质量不稳 | 提案永不自动落库；Schema 强校验；越界拒绝；标注历史做少样本 |
| 画布交互开发量超预期 | 试点只做矩形一种几何；快捷键先于按钮；砍掉多选拖拽组等高级操作 |
| Python 依赖劝退 | doctor 一键检测 + 给出确切安装命令；后续评估 OCR 的纯 Node 方案 |
| 阶段冻结后返工频繁 | 解冻机制 + 下游 stale 提示把返工成本显性化；观察试点数据再调整阶段边界 |
