import type {
  ElementTree, ModelConfigView, PageElementPatch, PageOutline, Rect, Region, RegionSplitDoc,
} from "@region-split/core/browser";

export type IconCandidate = { id: string; name: string; svg: string };
export interface AnalysisStats {
  totalRegions: number; parsedRegions: number; totalIcons: number;
  libraryIcons: number; cropIcons: number; unresolvedIcons: number;
  textWithoutSize: number; fontStackChosen: boolean;
  allPassed: boolean; todos: string[];
}

export interface PageCodeOutput {
  html: string;
  css: string;
  assets: Array<{ path: string; contentBase64: string }>;
}

export interface StoreApi {
  upload(file: File): Promise<{ projectId: string; doc: RegionSplitDoc }>;
  getProject(projectId: string): Promise<{ projectId: string; doc: RegionSplitDoc }>;
  putRegions(projectId: string, regions: Region[]): Promise<{ doc: RegionSplitDoc }>;
  analyze(projectId: string): Promise<{ doc: RegionSplitDoc }>;
  renameAi(projectId: string, regionId: string): Promise<{ doc: RegionSplitDoc }>;
  getModelConfig(): Promise<ModelConfigView>;
  getElements(projectId: string, y: number, h: number): Promise<{ tree: ElementTree | null; treeVersion: string | null }>;
  getParsedRegions(projectId: string): Promise<{ regionKeys: string[] }>;
  putFontStack(projectId: string, fontStack: string): Promise<{ doc: RegionSplitDoc }>;
  searchIcons(query: string, limit?: number): Promise<{ candidates: IconCandidate[] }>;
  getAnalysisStats(projectId: string): Promise<AnalysisStats>;
  getPageCode(projectId: string): Promise<PageCodeOutput>;
  getPageOutline(projectId: string): Promise<PageOutline>;
  detectAllElements(projectId: string, retry?: boolean): Promise<DetectAllResult>;
  patchPageElement(projectId: string, elementId: string, patch: PageElementPatch): Promise<PageOutline>;
  detectElements(projectId: string, region: Rect): Promise<{ tree: ElementTree; treeVersion?: string | null }>;
  putElements(projectId: string, region: Rect, tree: ElementTree): Promise<{ tree: ElementTree; treeVersion?: string | null }>;
}

export interface DetectAllResult {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  failedRegionKeys: string[];
}

export function assetUrl(projectId: string, fileName: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(fileName)}`;
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
  getElements(projectId, y, h) {
    return json(`/api/projects/${projectId}/elements?y=${y}&h=${h}`);
  },
  getParsedRegions(projectId) {
    return json(`/api/projects/${projectId}/parsed-regions`);
  },
  putFontStack(projectId, fontStack) {
    return json(`/api/projects/${projectId}/font-stack`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fontStack }),
    });
  },
  searchIcons(query, limit = 8) {
    return json(`/api/icons/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  },
  getAnalysisStats(projectId) {
    return json(`/api/projects/${projectId}/analysis-stats`);
  },
  getPageCode(projectId) {
    return json(`/api/projects/${projectId}/page-code`);
  },
  getPageOutline(projectId) {
    return json(`/api/projects/${projectId}/page-outline`);
  },
  detectAllElements(projectId, retry = false) {
    return json(`/api/projects/${projectId}/elements/detect-all`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retry }),
    });
  },
  patchPageElement(projectId, elementId, patch) {
    return json(`/api/projects/${projectId}/page-outline/${encodeURIComponent(elementId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  },
  detectElements(projectId, region) {
    return json(`/api/projects/${projectId}/elements/detect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region }),
    });
  },
  putElements(projectId, region, tree) {
    return json(`/api/projects/${projectId}/elements`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region, tree }),
    });
  },
};

export async function getPageArchive(projectId: string): Promise<Blob> {
  const response = await fetch(`/api/projects/${projectId}/page-code.zip`);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed: ${response.status}`);
  }
  return response.blob();
}

export function imageUrl(projectId: string): string {
  return `/api/projects/${projectId}/image`;
}

/** 区域裁图。服务端的 image 路由已支持 rect 查询参数。 */
export function regionImageUrl(projectId: string, region: Rect): string {
  return `/api/projects/${projectId}/image?rect=${region.x},${region.y},${region.w},${region.h}`;
}
