import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_WIDTHS,
  DEFAULT_WORKSPACE_HEIGHT,
  MIN_PANEL_WIDTHS,
  SPLITTER_SIZE,
  TREE_RESTORE_WIDTH,
  collapsedWorkspaceWidth,
  expandedWorkspaceWidth,
  resetPanelBoundary,
  resizePanelBoundary,
} from "./panel-layout.js";

describe("panel layout", () => {
  it("keeps expanded workspace width while resizing adjacent panels", () => {
    const before = expandedWorkspaceWidth(DEFAULT_PANEL_WIDTHS);
    const first = resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "image-tree", 80);
    expect(first).toEqual({ image: 671, tree: 220, property: 297 });
    expect(expandedWorkspaceWidth(first)).toBe(before);

    const second = resizePanelBoundary(first, "tree-property", 40);
    expect(second).toEqual({ image: 671, tree: 260, property: 257 });
    expect(expandedWorkspaceWidth(second)).toBe(before);
  });

  it("clamps every panel at its minimum width", () => {
    expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "image-tree", -999)).toEqual({
      image: MIN_PANEL_WIDTHS.image,
      tree: 571,
      property: 297,
    });
    expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "tree-property", -999)).toEqual({
      image: 594,
      tree: MIN_PANEL_WIDTHS.tree,
      property: 374,
    });
    expect(resizePanelBoundary(DEFAULT_PANEL_WIDTHS, "tree-property", 999)).toEqual({
      image: 594,
      tree: 374,
      property: MIN_PANEL_WIDTHS.property,
    });
  });

  it("ignores non-finite deltas and does not mutate the input", () => {
    const widths = { ...DEFAULT_PANEL_WIDTHS };
    expect(resizePanelBoundary(widths, "image-tree", Number.NaN)).toEqual(widths);
    expect(resizePanelBoundary(widths, "tree-property", Number.POSITIVE_INFINITY)).toEqual(widths);
    expect(widths).toEqual(DEFAULT_PANEL_WIDTHS);
  });

  it("falls back safely for invalid panel widths", () => {
    expect(resizePanelBoundary({ image: 1, tree: 1, property: 297 }, "image-tree", 0)).toEqual(DEFAULT_PANEL_WIDTHS);
    expect(resizePanelBoundary({ image: Number.MAX_VALUE, tree: Number.MAX_VALUE, property: 297 }, "image-tree", 0))
      .toEqual(DEFAULT_PANEL_WIDTHS);
    expect(resetPanelBoundary({ image: Number.NaN, tree: 297, property: 297 }, "image-tree"))
      .toEqual(DEFAULT_PANEL_WIDTHS);
  });

  it("resets only the selected pair using its default ratio", () => {
    expect(resetPanelBoundary({ image: 500, tree: 400, property: 350 }, "image-tree")).toEqual({
      image: 600,
      tree: 300,
      property: 350,
    });
    expect(resetPanelBoundary({ image: 650, tree: 250, property: 350 }, "tree-property")).toEqual({
      image: 650,
      tree: 300,
      property: 300,
    });
  });

  it("includes splitters only while expanded", () => {
    expect(expandedWorkspaceWidth(DEFAULT_PANEL_WIDTHS)).toBe(1200);
    expect(collapsedWorkspaceWidth(DEFAULT_PANEL_WIDTHS)).toBe(925);
    expect(SPLITTER_SIZE).toBe(6);
    expect(TREE_RESTORE_WIDTH).toBe(34);
    expect(DEFAULT_WORKSPACE_HEIGHT).toBe(760);
  });
});
