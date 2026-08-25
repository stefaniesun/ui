import { z } from "zod";
import { applyBox } from "./element-layout.js";
import { elementKinds, iconDecisionSchema, supportsBorderRadius, type ElementKind, type ElementNode, type ElementTree } from "./element-types.js";
import type { Rect, RegionSplitDoc } from "./types.js";

export const pageElementIdSeparator = "::";

export interface PageOutlineElement extends Omit<ElementNode, "id" | "parentId"> {
  id: string;
  localId: string;
  regionKey: string;
  regionName: string;
  parentHint: string | null;
  outlineNumber: string;
  depth: number;
  suspicious: boolean;
}

export interface PageOutlineRegion {
  regionKey: string;
  displayName: string;
  bounds: Rect;
  status: "parsed" | "missing" | "failed";
  error?: string;
}

export interface PageOutline {
  image: { fileName: string; width: number; height: number };
  designWidth: number;
  elements: PageOutlineElement[];
  regions: PageOutlineRegion[];
  suspiciousCount: number;
}

export const pageElementPatchSchema = z.object({
  kind: z.enum(elementKinds).optional(),
  text: z.string().optional(),
  box: z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive() }).optional(),
  borderRadius: z.number().int().nonnegative().optional(),
  iconDecision: iconDecisionSchema.optional(),
}).refine(value => Object.values(value).some(field => field !== undefined), "empty patch");
export type PageElementPatch = z.infer<typeof pageElementPatchSchema>;

export function pageElementId(regionKey: string, localId: string): string {
  return `${regionKey}${pageElementIdSeparator}${localId}`;
}

export function parsePageElementId(id: string): { regionKey: string; localId: string } | null {
  const at = id.indexOf(pageElementIdSeparator);
  if (at <= 0 || at === id.length - pageElementIdSeparator.length) return null;
  return { regionKey: id.slice(0, at), localId: id.slice(at + pageElementIdSeparator.length) };
}

export function isSuspiciousElement(node: ElementNode): boolean {
  return node.classification === "uncertain"
    || node.textBox?.ok === false
    || node.iconDecision?.kind === "ambiguous";
}

export function buildPageOutline(
  doc: RegionSplitDoc,
  trees: readonly ElementTree[],
  failed: Readonly<Record<string, string>> = {},
): PageOutline {
  const byRegion = new Map(trees.map(tree => [tree.regionKey, tree]));
  const sortedRegions = [...doc.regions].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const elements: PageOutlineElement[] = [];
  const regions: PageOutlineRegion[] = [];
  for (const region of sortedRegions) {
    const key = `${region.bounds.y}-${region.bounds.y + region.bounds.h}`;
    const tree = byRegion.get(key);
    regions.push({
      regionKey: key,
      displayName: region.displayName,
      bounds: { ...region.bounds },
      status: tree ? "parsed" : failed[key] ? "failed" : "missing",
      ...(failed[key] ? { error: failed[key] } : {}),
    });
    if (!tree) continue;
    const children = new Map<string | null, ElementNode[]>();
    const knownIds = new Set(tree.nodes.map(node => node.id));
    for (const node of tree.nodes) {
      const parent = node.parentId !== null && knownIds.has(node.parentId) ? node.parentId : null;
      children.set(parent, [...(children.get(parent) ?? []), node]);
    }
    for (const siblings of children.values()) {
      siblings.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || a.id.localeCompare(b.id));
    }
    const visited = new Set<string>();
    const append = (node: ElementNode, outlineNumber: string, depth: number) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      elements.push({
        ...node,
        id: pageElementId(key, node.id),
        localId: node.id,
        regionKey: key,
        regionName: region.displayName,
        parentHint: node.parentId === null ? null : pageElementId(key, node.parentId),
        outlineNumber,
        depth,
        suspicious: isSuspiciousElement(node),
      });
      (children.get(node.id) ?? []).forEach((child, index) => append(child, `${outlineNumber}.${index + 1}`, depth + 1));
    };
    const regionNumber = String(regions.length);
    (children.get(null) ?? []).forEach((node, index) => append(node, `${regionNumber}.${index + 1}`, 0));
    tree.nodes.filter(node => !visited.has(node.id)).forEach((node, index) => append(node, `${regionNumber}.x${index + 1}`, 0));
  }
  return {
    image: { fileName: doc.image.fileName, width: doc.image.width, height: doc.image.height },
    designWidth: doc.image.width,
    elements,
    regions,
    suspiciousCount: elements.filter(element => element.suspicious).length,
  };
}

export function patchElementTree(
  tree: ElementTree,
  region: Rect,
  localId: string,
  patch: PageElementPatch,
): ElementTree {
  const current = tree.nodes.find(node => node.id === localId);
  if (!current) throw new Error("element not found");
  const resultingKind = patch.kind ?? current.kind;
  if (patch.borderRadius !== undefined && !supportsBorderRadius(resultingKind)) {
    throw new Error(`border radius is not supported for ${resultingKind}`);
  }
  let nodes = tree.nodes;
  if (patch.box) {
    const applied = applyBox(nodes, region, localId, patch.box);
    if (!applied.ok) throw new Error(applied.reason);
    nodes = applied.nodes;
  }
  nodes = nodes.map(node => {
    if (node.id !== localId) return node;
    const next: ElementNode = {
      ...node,
      ...(patch.kind !== undefined ? { kind: patch.kind as ElementKind, classification: "human" as const } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.iconDecision !== undefined ? { iconDecision: patch.iconDecision } : {}),
      ...(patch.borderRadius !== undefined
        ? { style: patch.borderRadius === 0
          ? Object.fromEntries(Object.entries(node.style).filter(([key]) => key !== "borderRadius"))
          : { ...node.style, borderRadius: patch.borderRadius } }
        : {}),
    };
    if (patch.box && next.textBox !== undefined) {
      const { textBox: _drop, ...withoutTextBox } = next;
      return withoutTextBox;
    }
    return next;
  });
  return { ...tree, nodes };
}
