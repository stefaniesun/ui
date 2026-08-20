import { z } from "zod";
import { refactorCandidateSchema } from "./element-refactor-types.js";
import {
  ElementRefactorModelOutputError,
  type ElementRefactorModel,
} from "./element-refactor-model.js";
import { type IconDecision } from "./element-types.js";
import { type RawSegment } from "./types.js";

export interface RegionNaming {
  displayName: string; id: string; scrollX: boolean; scrollY: boolean;
}

export interface SegmentInput {
  imageBase64: string;
  width: number;    // 分析图宽
  height: number;   // 分析图高
  candidateYs: number[];
  /** 检测到的卡片/面板，分析图坐标。模块边界不得横穿它们。 */
  panels: { top: number; bottom: number }[];
}

/** 模型对一个容器里各子元素的判断。顺序即阅读顺序，与传入的子节点一一对应。 */
export interface ChildClassification {
  kind: "text" | "icon" | "image";
  displayName: string;
  text?: string;
  iconKeywords?: string[];
}

/**
 * `whole` 非空表示模型认为这些子元素其实是**同一个元素被误切开**了，
 * 调用方应当把这一层拍平。只在几何已经标出可疑时才允许模型这么答。
 */
export interface ClassifyResult {
  whole: ChildClassification | null;
  children: ChildClassification[];
}

export interface SegmentModel {
  segment(input: SegmentInput): Promise<RawSegment[]>;
  nameRegion(input: { cropBase64: string }): Promise<RegionNaming>;
  decideIcon(input: {
    cropBase64: string;
    candidates: { id: string; name: string; svg: string }[];
  }): Promise<IconDecision>;
  classifyChildren(input: {
    cropBase64: string;
    count: number;
    direction: "row" | "column";
    /** 几何判定这一组可能是被误切开的；允许模型答"其实是一个整体" */
    mayBeWhole?: boolean;
  }): Promise<ClassifyResult>;
}

export interface AiModel extends SegmentModel, ElementRefactorModel {}

const segmentsSchema = z.object({
  regions: z.array(z.object({
    displayName: z.string().min(1),
    id: z.string().min(1),
    yStart: z.number(),
    yEnd: z.number(),
    confidence: z.number().min(0).max(1),
    scrollX: z.boolean().default(false),
    scrollY: z.boolean().default(false),
  })).min(1),
});

const namingSchema = z.object({
  displayName: z.string().min(1),
  id: z.string().min(1),
  scrollX: z.boolean().default(false),
  scrollY: z.boolean().default(false),
});

const classificationSchema = z.object({
  kind: z.enum(["text", "icon", "image"]),
  displayName: z.string().min(1),
  text: z.string().optional(),
  iconKeywords: z.array(z.string().min(1)).min(2).max(4).optional(),
});
const childrenSchema = z.object({
  whole: classificationSchema.nullish(),
  children: z.array(classificationSchema),
});
const iconModelDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("library"), iconId: z.string().min(1), query: z.string().min(1) }),
  z.object({ kind: z.literal("crop"), reason: z.string().min(1) }),
  z.object({ kind: z.literal("ambiguous"), query: z.string().min(1) }),
]);

const ICON_PROMPT = [
  "你在比对一个 UI 图标裁片与若干本地 SVG 候选。",
  "只有形状明确一致时才选择 library；没有可靠匹配时选择 crop；多个候选难以区分时选择 ambiguous。",
  "只输出 JSON：library 为 {kind,iconId,query}，crop 为 {kind,reason}，ambiguous 为 {kind,query}。",
  "library 的 iconId 必须严格来自候选列表。",
].join("\n");

const SCROLL_RULES = [
  "另外判断每个模块整体是否可滚动，输出 scrollX 和 scrollY 两个布尔值：",
  "scrollX（横向滚动）：内容在模块左右边缘被切断时为 true——典型证据是最右侧的卡片/图标只露出一半、",
  "  一行等宽卡片明显放不下、或带有分页圆点的轮播。没有这类证据就是 false。",
  "scrollY（纵向滚动）：**页面自身能上下滚动不算**，那是整页的属性不是模块的属性，绝大多数模块都应该是 false。",
  "  只有当模块是固定高度的内嵌滚动面板时才为 true——证据是模块内出现独立滚动条，",
  "  或内容明确在模块下边缘被裁断而模块本身有边框/背景界定出固定高度。拿不准就填 false。",
].join("\n");

const SEGMENT_PROMPT = [
  "你在分析一张移动端 UI 效果图，需要把整页按视觉/功能单元从上到下切成若干模块。",
  "只输出一个 JSON 对象，格式为 {\"regions\":[{\"displayName\":string,\"id\":string,\"yStart\":number,\"yEnd\":number,\"confidence\":number,\"scrollX\":boolean,\"scrollY\":boolean}]}。",
  "要求：模块数量 5 到 10 个；必须从 y=0 开始、到图片底部结束；每段 yEnd 等于下一段 yStart；",
  "displayName 用简短中文，id 用 kebab-case 英文，confidence 取 0 到 1。",
  "参考给出的候选切分线：它们是图像分析得到的真实分割位置，优先在这些位置附近切分。",
  "同时给出了图像分析检测到的卡片/面板区间。**切分位置不得落在任何一个面板内部**——",
  "一张卡片是一个整体，从中间切开会把它拆成两半。可以在面板的上下边缘处切，",
  "也可以把连续几个面板合成一个模块。",
  "**纯粹用来分隔的空白带不要单独成块**：两个模块之间那条纯色的灰带/白带本身没有内容，",
  "把它并进相邻的任一模块即可。每个模块都必须包含实际的界面元素（文字、图标、图片、控件），",
  "只有背景色的模块是无意义的。",
  SCROLL_RULES,
].join("\n");

const NAMING_PROMPT = [
  "这是一张移动端 UI 页面中某一个模块的裁图。给它命名。",
  "只输出一个 JSON 对象，格式为 {\"displayName\":string,\"id\":string,\"scrollX\":boolean,\"scrollY\":boolean}。",
  "displayName 用简短中文，id 用 kebab-case 英文。",
  SCROLL_RULES,
].join("\n");

/**
 * 叶子分类是这一步唯一需要模型的地方：实测 icon 高度 21–74 对文字 3–34、
 * 填充率 0.38 对 0.47，两组特征区间重叠，任何阈值都切不干净。
 *
 * 提问时**绝不给坐标**——模型的空间定位不可靠，那是整个项目一直在绕开的短板。
 * 位置全部由工具测得，这里只要模型按阅读顺序输出一个等长列表，顺序由树提供。
 */
const CLASSIFY_PROMPT = [
  "这是一张移动端 UI 中某个盒子的裁图，盒子里的子元素已经由图像分析切分好了。",
  "只输出一个 JSON 对象，格式为 {\"children\":[{\"kind\":string,\"displayName\":string,\"text\":string?,\"iconKeywords\":string[]?}]}。",
  "kind 只能取 text（文字）、icon（可矢量化的图形）、image（必须切图的位图）之一。",
  "displayName 用简短中文描述元素语义；kind 为 text 时，text 必须尽量逐字抄录截图中的真实文字，无法辨认时省略 text。kind 为 icon 时必须给 iconKeywords，包含 2–4 个描述图标语义的英文关键词。",
  "数组长度必须与告知你的子元素个数完全一致，多一个少一个都不行。",
].join("\n");

/**
 * 只在几何已经标出"这一组间隙小得反常"时才追加这段。
 * 让模型自由拍平任何容器是危险的——它会把 [图标, 文字] 这种真实结构也并掉。
 */
const REFACTOR_PROMPT = [
  "You refactor one selected UI element fragment into a complete candidate element subtree.",
  "Return JSON only: {\"subtree\":{\"rootId\":string,\"nodes\":ElementNode[]},\"explanation\":string}.",
  "Each ElementNode requires id, parentId, box{x,y,w,h}, kind, displayName, style, uniformity, source, classification, scrollX, scrollY, positioning; layout is optional.",
  "kind: component|grid|text|icon|image|decoration. source: auto|manual. classification: tool|model|human|uncertain. positioning: flow|absolute.",
  "layout, when present: direction row|column, nonnegative integer gap, padding{top,right,bottom,left}. repeat is an optional top-level node field with integer count>=2, non-empty templateId and positive pitch.",
  "The subtree must have exactly one single root. Its parentId must equal the supplied original root parentId.",
  "Every other node must reference a parent inside the candidate subtree. Never reference elements outside the scope.",
  "All boxes use the existing absolute coordinate system and must stay inside the supplied bounds.",
  "Reuse an original node id only when the semantic element remains the same; otherwise create a unique id.",
  "Context semantics: original is the immutable baseline; current is the latest candidate to refine; history is chronological; instruction is the newest user request.",
  "If validationFeedback exists, those entries are errors you must fix in the returned candidate.",
].join("\n");

const WHOLE_RULE = [
  "另外：这些子元素有可能是**同一个元素被误切开**的（比如一个图标被从中间切成两半）。",
  "如果确实如此，在 whole 字段里给出这个整体的类型和名字；否则 whole 必须为 null。",
  "格式变为 {\"whole\":null 或 {\"kind\":string,\"displayName\":string},\"children\":[...]}。",
  "无论 whole 是否为空，children 都要照常按顺序给全。",
].join("\n");

function extractJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const starts = [...raw.matchAll(/\{/g)].map(match => match.index);
    for (const start of starts) {
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let index = start; index < raw.length; index++) {
        const char = raw[index]!;
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === "\"") quoted = false;
        } else if (char === "\"") quoted = true;
        else if (char === "{") depth++;
        else if (char === "}" && --depth === 0) {
          try { return JSON.parse(raw.slice(start, index + 1)); } catch { break; }
        }
      }
    }
    throw new Error("model returned unparsable content");
  }
}

// 超时是为了兜住"连得上但永远不回包"的挂起，不是用来约束响应速度的。
// 实测一次整页分段（2000px 高的图 + 十来段结构化输出）在中转站端点上要 15 秒上下，
// 设成 15 秒会时好时坏地误杀正常请求，所以留足余量；慢端点可在配置文件里调大。
const DEFAULT_TIMEOUT_MS = 120000;

export function createOpenAiModel(cfg: {
  baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}): AiModel {
  const doFetch = cfg.fetchImpl ?? fetch;
  const endpoint = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function ask(systemPrompt: string, userText: string, imageBase64: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Awaited<ReturnType<typeof doFetch>>;
    try {
      res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
            ] },
          ],
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`model request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`model http ${res.status}`);
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  }

  async function askParsed<T>(
    systemPrompt: string, userText: string, imageBase64: string, schema: z.ZodType<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await ask(systemPrompt, userText, imageBase64);
      try {
        return schema.parse(extractJson(raw));
      } catch (err) {
        if (attempt === 1) {
          throw err instanceof z.ZodError
            ? new Error(`model returned invalid shape: ${err.message}`)
            : new Error("model returned unparsable content");
        }
      }
    }
    throw new Error("model returned unparsable content");
  }

  return {
    async refactorElements(input) {
      const userText = JSON.stringify({
        instruction: input.instruction,
        bounds: input.bounds,
        original: input.original,
        current: input.current,
        references: input.references,
        history: input.history,
        ...(input.validationFeedback ? { validationFeedback: input.validationFeedback } : {}),
      });
      const raw = await ask(REFACTOR_PROMPT, userText, input.cropBase64);
      try {
        return refactorCandidateSchema.parse(extractJson(raw));
      } catch (error) {
        const detail = error instanceof z.ZodError
          ? `invalid shape: ${error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
          : "unparsable content";
        throw new ElementRefactorModelOutputError(`model returned ${detail}`, { cause: error });
      }
    },

    async segment(input) {
      const userText = [
        `图片尺寸：宽 ${input.width}，高 ${input.height}（像素）。`,
        input.candidateYs.length > 0
          ? `候选切分线 y 值：${input.candidateYs.join(", ")}`
          : "本次没有候选切分线，请自行判断切分位置。",
        input.panels.length > 0
          ? `卡片/面板区间（不可从内部切开）：${
              input.panels.map(panel => `${panel.top}-${panel.bottom}`).join(", ")}`
          : "本次没有检测到卡片。",
      ].join("\n");
      const parsed = await askParsed(SEGMENT_PROMPT, userText, input.imageBase64, segmentsSchema);
      return parsed.regions as RawSegment[];
    },
    async decideIcon(input) {
      const candidateIds = input.candidates.map(candidate => candidate.id);
      const userText = JSON.stringify({ candidates: input.candidates });
      const parsed = await askParsed(
        ICON_PROMPT, userText, input.cropBase64, iconModelDecisionSchema,
      );
      if (parsed.kind === "library") {
        if (!candidateIds.includes(parsed.iconId)) {
          throw new Error(`model selected icon outside candidate list: ${parsed.iconId}`);
        }
        return { ...parsed, candidates: candidateIds };
      }
      if (parsed.kind === "ambiguous") {
        return { ...parsed, candidates: candidateIds };
      }
      return { ...parsed, assetRef: "" };
    },

    async classifyChildren(input) {
      const order = input.direction === "row" ? "从左到右" : "从上到下";
      const userText = [
        `这个盒子里有 ${input.count} 个并列子元素，排列方向为${
          input.direction === "row" ? "横排" : "竖排"}。`,
        `请按${order}的顺序，依次说明每个子元素的类型并各给一个名字。`,
      ].join("\n");
      // 长度不符就是错配，重试一次仍不符则抛错，由调用方降级为存疑。
      // 宁可留空让人工填，也不能把名字和类型对错位置。
      const prompt = input.mayBeWhole
        ? `${CLASSIFY_PROMPT}
${WHOLE_RULE}`
        : CLASSIFY_PROMPT;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await ask(prompt, userText, input.cropBase64);
        try {
          const parsed = childrenSchema.parse(extractJson(raw));
          if (parsed.children.length === input.count) {
            // 没允许拍平时忽略模型自作主张给的 whole
            return {
              whole: input.mayBeWhole ? parsed.whole ?? null : null,
              children: parsed.children,
            };
          }
        } catch {
          // 解析失败与长度不符走同一条重试路径
        }
      }
      throw new Error(`model returned a child list that does not match count ${input.count}`);
    },

    async nameRegion(input) {
      // 断言到 RegionNaming：zod 的 .default() 让推断出的类型把这两个字段标成可选，
      // 但解析后它们必定有值。
      return await askParsed(
        NAMING_PROMPT, "请命名这个模块。", input.cropBase64, namingSchema,
      ) as RegionNaming;
    },
  };
}
