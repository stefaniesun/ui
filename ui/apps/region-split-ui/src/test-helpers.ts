import { vi } from "vitest";
import type { CandidateLine, Region, RegionSplitDoc } from "@region-split/core";
import type { StoreApi } from "./api.js";

export function makeRegion(id: string, y: number, h: number): Region {
  return { id, displayName: `名-${id}`, type: "card", bounds: { x: 0, y, w: 375, h }, confidence: 0.87 };
}

export function makeDoc(regions: Region[], candidateLines: CandidateLine[] = []): RegionSplitDoc {
  return {
    schemaVersion: "1",
    image: { fileName: "s.png", width: 375, height: 600, analyzedScale: 1 },
    regions, candidateLines, updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

export function makeFakeApi(initial: () => Region[], candidateLines: CandidateLine[] = []): StoreApi {
  return {
    putRegions: vi.fn(async (_id: string, regions: Region[]) => ({ doc: makeDoc(regions, candidateLines) })),
    upload: async () => ({ projectId: "p1", doc: makeDoc(initial(), candidateLines) }),
    getProject: async () => ({ projectId: "p1", doc: makeDoc(initial(), candidateLines) }),
    analyze: async () => ({ doc: makeDoc(initial(), candidateLines) }),
    renameAi: async () => ({ doc: makeDoc(initial(), candidateLines) }),
    getModelConfig: async () => ({
      baseUrl: "http://local/v1", model: "test-model", hasApiKey: true, apiKeyMask: "sk-••••abcd",
    }),
    putModelConfig: async input => ({
      baseUrl: input.baseUrl, model: input.model, hasApiKey: true, apiKeyMask: "sk-••••abcd",
    }),
    testModelConfig: async () => ({ ok: true }),
  };
}
