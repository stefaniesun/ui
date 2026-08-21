export interface RegionDetailLayout {
  width: number;
  height: number;
  tree: number;
  ai: number;
  inspectorHeight: number;
}

export const REGION_DETAIL_LAYOUT_STORAGE_KEY = "region-split:detail-layout";
export const DEFAULT_REGION_DETAIL_LAYOUT: RegionDetailLayout = {
  width: 1280,
  height: 600,
  tree: 40,
  ai: 20,
  inspectorHeight: 240,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rounded = (value: number) => Math.round(value * 10) / 10;
const finiteOr = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizeRegionDetailLayout(value: Partial<RegionDetailLayout>): RegionDetailLayout {
  const ai = rounded(clamp(finiteOr(value.ai, DEFAULT_REGION_DETAIL_LAYOUT.ai), 15, 30));
  const tree = rounded(clamp(finiteOr(value.tree, DEFAULT_REGION_DETAIL_LAYOUT.tree), 15, 100 - ai - 15));
  return {
    width: rounded(clamp(finiteOr(value.width, DEFAULT_REGION_DETAIL_LAYOUT.width), 760, 2400)),
    height: rounded(clamp(finiteOr(value.height, DEFAULT_REGION_DETAIL_LAYOUT.height), 480, 1600)),
    tree,
    ai,
    inspectorHeight: rounded(clamp(finiteOr(value.inspectorHeight, DEFAULT_REGION_DETAIL_LAYOUT.inspectorHeight), 160, 720)),
  };
}

export function loadRegionDetailLayout(storage: Storage | undefined = globalThis.localStorage): RegionDetailLayout {
  try {
    const raw = storage?.getItem(REGION_DETAIL_LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_REGION_DETAIL_LAYOUT };
    return normalizeRegionDetailLayout(JSON.parse(raw) as Partial<RegionDetailLayout>);
  } catch {
    return { ...DEFAULT_REGION_DETAIL_LAYOUT };
  }
}

export function createRegionDetailLayout(storage: Storage | undefined = globalThis.localStorage): RegionDetailLayout {
  return { ...loadRegionDetailLayout(storage) };
}

export function saveRegionDetailLayout(
  storage: Storage | undefined,
  value: Partial<RegionDetailLayout>,
): RegionDetailLayout {
  const saved = normalizeRegionDetailLayout(value);
  try {
    storage?.setItem(REGION_DETAIL_LAYOUT_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // 当前实例仍保留草稿；存储不可用不应破坏布局调整。
  }
  return saved;
}
