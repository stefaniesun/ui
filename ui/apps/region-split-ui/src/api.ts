import type { ElementNode, ModelConfigView, Region, RegionElementAnalysis, RegionSplitDoc } from "@region-split/core/browser";

export interface EditablePayload {
  expectedRevision: number; regions: Region[]; elements: ElementNode[];
  elementAnalysis: Record<string, RegionElementAnalysis>;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly latestDoc?: RegionSplitDoc) { super(message); }
}

export interface StoreApi {
  upload(file: File): Promise<{ projectId: string; doc: RegionSplitDoc }>;
  getProject(projectId: string): Promise<{ projectId: string; doc: RegionSplitDoc }>;
  putRegions(projectId: string, regions: Region[]): Promise<{ doc: RegionSplitDoc }>;
  putDocument(projectId: string, payload: EditablePayload): Promise<{ doc: RegionSplitDoc }>;
  retryElementAnalysis(projectId: string, regionId: string, expectedRevision: number, inputFingerprint: string): Promise<{ doc: RegionSplitDoc }>;
  analyze(projectId: string): Promise<{ doc: RegionSplitDoc }>;
  renameAi(projectId: string, regionId: string): Promise<{ doc: RegionSplitDoc }>;
  getModelConfig(): Promise<ModelConfigView>;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const failure = body as { error?: string; doc?: RegionSplitDoc } | null;
    throw new ApiError(failure?.error ?? `request failed: ${res.status}`, res.status, failure?.doc);
  }
  return body as T;
}

export const httpApi: StoreApi = {
  async upload(file) {
    const form = new FormData();
    form.append("file", file);
    return json("/api/projects", { method: "POST", body: form });
  },
  getProject(projectId) {
    return json(`/api/projects/${projectId}`);
  },
  putRegions(projectId, regions) {
    return json(`/api/projects/${projectId}/regions`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regions }),
    });
  },
  putDocument(projectId, payload) {
    return json(`/api/projects/${projectId}/document`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  },
  retryElementAnalysis(projectId, regionId, expectedRevision, inputFingerprint) {
    return json(`/api/projects/${projectId}/regions/${regionId}/analyze-elements`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision, inputFingerprint }),
    });
  },
  analyze(projectId) {
    return json(`/api/projects/${projectId}/analyze`, { method: "POST" });
  },
  renameAi(projectId, regionId) {
    return json(`/api/projects/${projectId}/regions/${regionId}/rename-ai`, { method: "POST" });
  },
  getModelConfig() {
    return json("/api/model-config");
  },
};

export function imageUrl(projectId: string): string {
  return `/api/projects/${projectId}/image`;
}
