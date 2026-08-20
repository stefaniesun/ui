import { icons as mdi } from "@iconify-json/mdi";

type IconData = { body: string; width?: number; height?: number; parent?: string };

export interface IconCandidate {
  id: string;
  name: string;
}

export interface ResolvedIcon {
  id: string;
  width: number;
  height: number;
  body: string;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/^mdi:/, "");
}

function allNames(): string[] {
  return [...Object.keys(mdi.icons), ...Object.keys(mdi.aliases ?? {})];
}

export function searchIcons(query: string, limit = 8): IconCandidate[] {
  const needle = normalizeQuery(query);
  if (!needle || limit <= 0) return [];
  return allNames()
    .filter(name => name.includes(needle))
    .sort((a, b) => {
      const rank = (name: string) => name === needle ? 0 : name.startsWith(needle) ? 1 : 2;
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .slice(0, limit)
    .map(name => ({ id: `mdi:${name}`, name }));
}

function resolveIcon(name: string): IconData | null {
  const direct = mdi.icons[name];
  if (direct) return direct;
  const alias = mdi.aliases?.[name];
  if (!alias) return null;
  const parent = resolveIcon(alias.parent);
  if (!parent) return null;
  return { ...parent, ...alias, body: parent.body };
}

export function iconById(id: string): ResolvedIcon | null {
  const match = /^mdi:(.+)$/.exec(id);
  if (!match?.[1]) return null;
  const icon = resolveIcon(match[1]);
  if (!icon) return null;
  return {
    id,
    width: icon.width ?? mdi.width ?? 24,
    height: icon.height ?? mdi.height ?? 24,
    body: icon.body,
  };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function iconToSvg(icon: ResolvedIcon, color = "currentColor"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}" fill="${escapeAttribute(color)}">${icon.body}</svg>`;
}
