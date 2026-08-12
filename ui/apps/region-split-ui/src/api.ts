import type { ModelConfigView, Region, RegionSplitDoc } from "@region-split/core/browser";

export interface StoreApi {
  upload(file: File): Promise<{ projectId: string; doc: RegionSplitDoc }>;
  getProject(projectId: string): Promise<{ projectId: string; doc: RegionSplitDoc }>;
  putRegions(projectId: string, regions: Region[]): Promise<{ doc: RegionSplitDoc }>;
  analyze(projectId: string): Promise<{ doc: RegionSplitDoc }>;
  renameAi(projectId: string, regionId: string): Promise<{ doc: RegionSplitDoc }>;
  getModelConfig(): Promise<ModelConfigView>;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `request failed: ${res.status}`);
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
