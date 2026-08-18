export const REGION_COLORS = [
  "#4d8dff",
  "#ff5d7d",
  "#2dcf9f",
  "#f7b84b",
  "#a978ff",
  "#32c5ff",
  "#ff7a45",
  "#77c66e",
  "#e66bd4",
  "#49a6a6",
  "#d8ca52",
  "#7f8cff",
] as const;

function hashRegionId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function regionColor(id: string): string {
  if (!id) return "var(--accent)";
  return REGION_COLORS[hashRegionId(id) % REGION_COLORS.length]!;
}

export function regionSoftColor(id: string): string {
  const color = regionColor(id);
  return color.startsWith("#") ? `${color}26` : "rgb(75 140 255 / 15%)";
}
