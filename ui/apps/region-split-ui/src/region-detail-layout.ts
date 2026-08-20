import { ref } from "vue";

export interface RegionDetailLayout {
  image: number;
  tree: number;
  ai: number;
}

export const REGION_DETAIL_LAYOUT_STORAGE_KEY = "region-split:detail-layout";
export const DEFAULT_REGION_DETAIL_LAYOUT: RegionDetailLayout = { image: 65, tree: 36, ai: 28 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rounded = (value: number) => Math.round(value * 10) / 10;

function normalized(value: Partial<RegionDetailLayout>): RegionDetailLayout {
  const image = rounded(clamp(Number(value.image ?? DEFAULT_REGION_DETAIL_LAYOUT.image), 35, 80));
  const ai = rounded(clamp(Number(value.ai ?? DEFAULT_REGION_DETAIL_LAYOUT.ai), 18, 45));
  const tree = rounded(clamp(Number(value.tree ?? DEFAULT_REGION_DETAIL_LAYOUT.tree), 15, 100 - ai - 15));
  return { image, tree, ai };
}

function load(): RegionDetailLayout {
  if (typeof localStorage === "undefined") return { ...DEFAULT_REGION_DETAIL_LAYOUT };
  try {
    const parsed = JSON.parse(localStorage.getItem(REGION_DETAIL_LAYOUT_STORAGE_KEY) ?? "null");
    if (!parsed || ![parsed.image, parsed.tree, parsed.ai].every(Number.isFinite)) {
      return { ...DEFAULT_REGION_DETAIL_LAYOUT };
    }
    return normalized(parsed);
  } catch {
    return { ...DEFAULT_REGION_DETAIL_LAYOUT };
  }
}

export const regionDetailLayout = ref<RegionDetailLayout>(load());

export function setRegionDetailLayout(next: Partial<RegionDetailLayout>): void {
  regionDetailLayout.value = normalized({ ...regionDetailLayout.value, ...next });
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(REGION_DETAIL_LAYOUT_STORAGE_KEY, JSON.stringify(regionDetailLayout.value));
  }
}

export function resetRegionDetailLayout(): void {
  setRegionDetailLayout(DEFAULT_REGION_DETAIL_LAYOUT);
}
