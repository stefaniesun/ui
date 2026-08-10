import { changeSetSchema, type Annotation, type ChangeSet, type MeasurementPayload } from "@ui-rebuild/workbench-contracts";

export interface AnnotationModel {
  proposeChangeSet(input: { annotation: Annotation; cropPngBase64: string; itemsInBounds: unknown[]; payload: MeasurementPayload }): Promise<ChangeSet>;
}
const SYSTEM_PROMPT = "你是 UI 截图测量修正助手。只能输出 ChangeSet JSON；path 必须相对 payload，例如 /textItems/0/text；只修改指令直接相关条目。";
export function createOpenAiAnnotationModel(config: { baseUrl: string; apiKey: string; model: string }): AnnotationModel {
  return { async proposeChangeSet(input) {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, temperature: 0, messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: [
          { type: "text", text: `指令：${input.annotation.instruction}\nannotationId：${input.annotation.id}\n框内条目：${JSON.stringify(input.itemsInBounds)}` },
          { type: "image_url", image_url: { url: `data:image/png;base64,${input.cropPngBase64}` } },
        ] },
      ] }),
    });
    if (!response.ok) throw new Error(`model http ${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = body.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch {
      const match = /\{[\s\S]*\}/.exec(raw);
      if (!match) throw new Error("model returned non-json content");
      parsed = JSON.parse(match[0]);
    }
    return changeSetSchema.parse(parsed);
  } };
}
