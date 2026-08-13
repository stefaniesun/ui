import { vi } from "vitest";
import type { CandidateLine, Region, RegionSplitDoc } from "@region-split/core/browser";
import type { StoreApi } from "./api.js";

export function makeRegion(
  id: string, y: number, h: number, scroll: { x?: boolean; y?: boolean } = {},
): Region {
  return {
    id, displayName: `名-${id}`, type: "card", bounds: { x: 0, y, w: 375, h }, confidence: 0.87,
    scrollX: scroll.x ?? false, scrollY: scroll.y ?? false,
  };
}

export function makeDoc(regions: Region[], candidateLines: CandidateLine[] = []): RegionSplitDoc {
  return {
    schemaVersion: "2", revision: 0,
    image: { fileName: "s.png", width: 375, height: 600, analyzedScale: 1, removedChrome: [] },
    regions, elements: [], elementAnalysis: {}, candidateLines, panels: [], updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

export function makeFakeApi(initial: () => Region[], candidateLines: CandidateLine[] = []): StoreApi {
  return {
    putRegions: vi.fn(async (_id: string, regions: Region[]) => ({ doc: makeDoc(regions, candidateLines) })),
    putDocument: vi.fn(async (_id, payload) => ({ doc: { ...makeDoc(payload.regions, candidateLines), revision: payload.expectedRevision + 1, elements: payload.elements, elementAnalysis: payload.elementAnalysis } })),
    retryElementAnalysis: vi.fn(async () => ({ doc: makeDoc(initial(), candidateLines) })),
    upload: vi.fn(async () => ({ projectId: "p1", doc: makeDoc(initial(), candidateLines) })),
    getProject: vi.fn(async () => ({ projectId: "p1", doc: makeDoc(initial(), candidateLines) })),
    analyze: vi.fn(async () => ({ doc: makeDoc(initial(), candidateLines) })),
    renameAi: vi.fn(async () => ({ doc: makeDoc(initial(), candidateLines) })),
    getModelConfig: vi.fn(async () => ({
      baseUrl: "http://local/v1", model: "test-model", hasApiKey: true,
      configPath: "/workspace/ui/region-split.config.json",
    })),
  };
}
