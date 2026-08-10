import type { MeasurementDoc, Rect } from "@ui-rebuild/workbench-contracts";

const stageUrl = (pageId: string) => `/api/pages/${encodeURIComponent(pageId)}/stages/measurement`;
async function json<T>(pending: Promise<Response>): Promise<T> {
  const response = await pending;
  const errorBody = (): Promise<{ error?: string }> => response.json().catch(() => ({}));
  if (!response.ok) throw new Error((await errorBody()).error ?? `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
export const api = {
  get: (pageId: string) => json<{ doc: MeasurementDoc; fingerprint: string }>(fetch(stageUrl(pageId))),
  patch: (pageId: string, ops: unknown[]) => json<{ doc: MeasurementDoc }>(fetch(stageUrl(pageId), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }) })),
  analyze: (pageId: string, scale: number, statusBarHeightPx?: number) => json<{ doc: MeasurementDoc }>(fetch(`${stageUrl(pageId)}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scale, statusBarHeightPx }) })),
  action: (pageId: string, action: "undo" | "redo" | "confirm" | "unfreeze") => json<{ doc: MeasurementDoc }>(fetch(`${stageUrl(pageId)}/${action}`, { method: "POST" })),
  annotate: (pageId: string, bounds: Rect, instruction: string) => json<{ changeSet: { id: string; allowed: Array<{ path: string; explanation: string; value?: unknown }>; rejected: unknown[] } }>(fetch(`${stageUrl(pageId)}/annotations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bounds, instruction }) })),
  accept: (pageId: string, id: string, opIndexes: number[]) => json<{ doc: MeasurementDoc }>(fetch(`${stageUrl(pageId)}/changesets/${id}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opIndexes }) })),
};
