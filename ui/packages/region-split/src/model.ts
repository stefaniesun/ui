import { z } from "zod";
import { regionTypes, type RawSegment, type RegionType } from "./types.js";

export interface RegionNaming {
  displayName: string; id: string; type: RegionType; scrollX: boolean; scrollY: boolean;
}

export interface SegmentInput {
  imageBase64: string;
  width: number;    // 分析图宽
  height: number;   // 分析图高
  candidateYs: number[];
  /** 检测到的卡片/面板，分析图坐标。模块边界不得横穿它们。 */
  panels: { top: number; bottom: number }[];
}

export interface SegmentModel {
  segment(input: SegmentInput): Promise<RawSegment[]>;
  nameRegion(input: { cropBase64: string }): Promise<RegionNaming>;
}

const segmentsSchema = z.object({
  regions: z.array(z.object({
    displayName: z.string().min(1),
    id: z.string().min(1),
    type: z.enum(regionTypes),
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
  type: z.enum(regionTypes),
  scrollX: z.boolean().default(false),
  scrollY: z.boolean().default(false),
});

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
  "只输出一个 JSON 对象，格式为 {\"regions\":[{\"displayName\":string,\"id\":string,\"type\":string,\"yStart\":number,\"yEnd\":number,\"confidence\":number,\"scrollX\":boolean,\"scrollY\":boolean}]}。",
  "要求：模块数量 5 到 10 个；必须从 y=0 开始、到图片底部结束；每段 yEnd 等于下一段 yStart；",
  "displayName 用简短中文，id 用 kebab-case 英文，confidence 取 0 到 1。",
  `type 只能取以下之一：${regionTypes.join("、")}。`,
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
  "这是一张移动端 UI 页面中某一个模块的裁图。给它命名并判断类型。",
  "只输出一个 JSON 对象，格式为 {\"displayName\":string,\"id\":string,\"type\":string,\"scrollX\":boolean,\"scrollY\":boolean}。",
  "displayName 用简短中文，id 用 kebab-case 英文。",
  `type 只能取以下之一：${regionTypes.join("、")}。`,
  SCROLL_RULES,
].join("\n");

function extractJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) throw new Error("model returned unparsable content");
    return JSON.parse(match[0]);
  }
}

// 超时是为了兜住"连得上但永远不回包"的挂起，不是用来约束响应速度的。
// 实测一次整页分段（2000px 高的图 + 十来段结构化输出）在中转站端点上要 15 秒上下，
// 设成 15 秒会时好时坏地误杀正常请求，所以留足余量；慢端点可在配置文件里调大。
const DEFAULT_TIMEOUT_MS = 120000;

export function createOpenAiModel(cfg: {
  baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}): SegmentModel {
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
    async nameRegion(input) {
      // 断言到 RegionNaming：zod 的 .default() 让推断出的类型把这两个字段标成可选，
      // 但解析后它们必定有值。
      return await askParsed(
        NAMING_PROMPT, "请命名这个模块。", input.cropBase64, namingSchema,
      ) as RegionNaming;
    },
  };
}
