import { regionKey, type ElementTree } from "./element-types.js";
import type { Region } from "./types.js";

export interface AnalysisStats {
  totalRegions: number;
  parsedRegions: number;
  totalIcons: number;
  libraryIcons: number;
  cropIcons: number;
  unresolvedIcons: number;
  textWithoutSize: number;
  fontStackChosen: boolean;
  allPassed: boolean;
  todos: string[];
}

export function analysisStats(regions: readonly Region[], trees: readonly ElementTree[], fontStack?: string): AnalysisStats {
  const treeByRegion = new Map(trees.map(tree => [tree.regionKey, tree]));
  const parsedRegions = regions.filter(region => treeByRegion.has(regionKey(region.bounds))).length;
  const icons = trees.flatMap(tree => tree.nodes).filter(node => node.kind === "icon");
  const libraryIcons = icons.filter(node => node.iconDecision?.kind === "library").length;
  const cropIcons = icons.filter(node => node.iconDecision?.kind === "crop").length;
  const unresolved = icons.filter(node => !node.iconDecision || node.iconDecision.kind === "ambiguous");
  const textWithoutSize = trees.flatMap(tree => tree.nodes)
    .filter(node => node.kind === "text" && node.style.fontSize === undefined).length;
  const fontStackChosen = Boolean(fontStack?.trim());
  const todos = [
    ...regions.filter(region => !treeByRegion.has(regionKey(region.bounds))).map(region => `解析区域 ${region.displayName}`),
    ...unresolved.map(node => `确认图标 ${node.displayName}`),
    ...(fontStackChosen ? [] : ["选择目标平台字体"]),
    ...(textWithoutSize ? [`测量 ${textWithoutSize} 个文字节点字号`] : []),
  ];
  return {
    totalRegions: regions.length, parsedRegions,
    totalIcons: icons.length, libraryIcons, cropIcons,
    unresolvedIcons: unresolved.length,
    textWithoutSize,
    fontStackChosen,
    allPassed: parsedRegions === regions.length && unresolved.length === 0 && fontStackChosen && textWithoutSize === 0,
    todos,
  };
}
