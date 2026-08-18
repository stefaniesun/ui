import { describe, expect, it } from "vitest";
import { emitPage } from "./emit-page.js";
import type { ElementTree } from "./element-types.js";

function tree(name: string): ElementTree {
  return {
    regionKey: name,
    detectedAt: "2026-08-18T00:00:00.000Z",
    nodes: [{
      id: "n1", parentId: null, box: { x: 0, y: 0, w: 100, h: 40 },
      kind: "text", displayName: name, text: name, style: {}, uniformity: 1,
      source: "manual", classification: "human", scrollX: false, scrollY: false,
      positioning: "flow",
    }],
  };
}

describe("emitPage", () => {
  it("names duplicate node ids uniquely across regions", () => {
    const output = emitPage({
      designWidth: 375,
      regions: [
        { region: { x: 0, y: 0, w: 375, h: 100 }, tree: tree("顶部") },
        { region: { x: 0, y: 100, w: 375, h: 100 }, tree: tree("底部") },
      ],
    });
    expect(output.html).toContain('class="e-r0-n1"');
    expect(output.html).toContain('class="e-r1-n1"');
    expect(output.css).toContain(".e-r0-n1");
    expect(output.css).toContain(".e-r1-n1");
  });

  it("sorts regions and positions them by their actual page coordinates", () => {
    const output = emitPage({
      designWidth: 400,
      regions: [
        { region: { x: 20, y: 240, w: 360, h: 100 }, tree: tree("后") },
        { region: { x: 0, y: 40, w: 400, h: 100 }, tree: tree("前") },
      ],
    });
    expect(output.html.indexOf("前")).toBeLessThan(output.html.indexOf("后"));
    expect(output.css).toContain(".page-region-r0 { position: absolute; left: 0vw; top: 10vw; }");
    expect(output.css).toContain(".page-region-r1 { position: absolute; left: 5vw; top: 60vw; }");
    expect(output.css).toContain("height: 85vw");
  });

  it("emits a browser-openable document with separated stylesheet", () => {
    const output = emitPage({ designWidth: 375, regions: [] });
    expect(output.html).toContain("<!doctype html>");
    expect(output.html).toContain('<link rel="stylesheet" href="style.css">');
    expect(output.html).not.toContain("<style>");
  });
});
