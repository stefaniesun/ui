import { vi } from "vitest";
import type {
  CandidateLine, ElementNode, ElementTree, Rect, Region, RegionSplitDoc,
} from "@region-split/core/browser";
import type { StoreApi } from "./api.js";

export function makeRegion(
  id: string, y: number, h: number, scroll: { x?: boolean; y?: boolean } = {},
): Region {
  return {
    id, displayName: `名-${id}`, type: "card", bounds: { x: 0, y, w: 375, h }, confidence: 0.87,
    scrollX: scroll.x ?? false, scrollY: scroll.y ?? false,
  };
}

export function makeDoc(
  regions: Region[], candidateLines: CandidateLine[] = [], analyzed = false,
): RegionSplitDoc {
  return {
    schemaVersion: "1",
    image: { fileName: "s.png", width: 375, height: 600, analyzedScale: 1, removedChrome: [] },
    regions, candidateLines, panels: [], updatedAt: "2026-08-11T00:00:00.000Z",
    ...(analyzed ? { analyzedAt: "2026-08-11T00:00:00.000Z" } : {}),
  };
}

type FakeApiOverrides = Partial<StoreApi>;

export function makeFakeApi(
  initial: () => Region[], candidateLines: CandidateLine[] = [], overrides: FakeApiOverrides = {},
): StoreApi {
  return {
    putRegions: vi.fn(async (_id: string, regions: Region[]) => ({ doc: makeDoc(regions, candidateLines) })),
    upload: vi.fn(async () => ({ projectId: "p1", doc: makeDoc(initial(), candidateLines) })),
    getProject: vi.fn(async () => ({ projectId: "p1", doc: makeDoc(initial(), candidateLines) })),
    analyze: vi.fn(async () => ({ doc: makeDoc(initial(), candidateLines, true) })),
    renameAi: vi.fn(async () => ({ doc: makeDoc(initial(), candidateLines) })),
    getModelConfig: vi.fn(async () => ({
      baseUrl: "http://local/v1", model: "test-model", hasApiKey: true,
      configPath: "/workspace/ui/region-split.config.json",
    })),
    // 区域相关的用例不碰元素接口；给出惰性桩只是为了满足 StoreApi，
    // 需要断言元素行为的用例请用 overrides 覆盖。
    getElements: vi.fn(async () => ({ tree: null })),
    detectElements: vi.fn(async () => ({ tree: makeElementTree() })),
    putElements: vi.fn(async (_id: string, _region: Rect, tree: ElementTree) => ({ tree })),
    ...overrides,
  };
}

export function makeElementTree(nodes: ElementNode[] = []): ElementTree {
  return { regionKey: "0-600", detectedAt: "2026-08-11T00:00:00.000Z", nodes };
}
