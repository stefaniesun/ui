import { describe, expect, it } from "vitest";
import { emitHtml, FLEX_TOLERANCE, flexDeviation, toVw } from "./emit-html.js";
import type { LayoutInfo } from "./element-cut.js";
import type { ElementNode, ElementTree } from "./element-types.js";

const REGION = { x: 0, y: 100, w: 1170, h: 300 };
function node(over: Partial<ElementNode> & Pick<ElementNode, "id">): ElementNode {
  return {
    parentId: null, box: { x: 0, y: 100, w: 100, h: 50 }, kind: "component",
    displayName: "节点", style: {}, uniformity: 1, source: "auto",
    classification: "tool", scrollX: false, scrollY: false, positioning: "flow", ...over,
  };
}
const tree = (nodes: ElementNode[]): ElementTree =>
  ({ regionKey: "100-400", detectedAt: "2026-08-17T00:00:00.000Z", nodes });
const emit = (nodes: ElementNode[]) => emitHtml({ designWidth: 1170, region: REGION, tree: tree(nodes) });

describe("toVw", () => {
  it("turns pixels into a share of the design width", () => expect(toVw(117, 1170)).toBe("10vw"));
  it("keeps four decimals", () => expect(toVw(1, 1170)).toBe("0.0855vw"));
  it("emits a bare zero", () => expect(toVw(0, 1170)).toBe("0"));
});

describe("emitHtml", () => {
  it("gives every node a class keyed by its id", () => expect(emit([node({ id: "n1" })]).html).toContain('class="e-n1"'));
  it("sizes a node relative to the region", () => {
    const { css } = emit([node({ id: "n1", box: { x: 117, y: 200, w: 234, h: 50 } })]);
    expect(css).toContain("width: 20vw"); expect(css).toContain("height: 4.2735vw");
    expect(css).toContain("left: 10vw"); expect(css).toContain("top: 8.547vw");
  });
  it("renders text as an escaped span carrying its name", () => {
    const { html } = emit([node({ id: "n1", kind: "text", displayName: "<b>&x</b>" })]);
    expect(html).toContain("<span"); expect(html).toContain("&lt;b&gt;&amp;x&lt;/b&gt;"); expect(html).toContain('data-todo="text"');
  });
  it("renders an icon as an asset placeholder", () => {
    const { html } = emit([node({ id: "n1", kind: "icon" })]);
    expect(html).toContain('data-todo="asset"'); expect(html).not.toContain("<img");
  });
  it("writes measured colours and radius", () => {
    const { css } = emit([node({ id: "n1", kind: "image", style: { background: "#ffffff", color: "#191919", borderRadius: 34 } })]);
    expect(css).toContain("background: #ffffff"); expect(css).toContain("color: #191919"); expect(css).toContain("border-radius: 2.906vw");
  });
  it("uses only the cross-platform safe tags", () => {
    const html = emit([node({ id: "n1" }), node({ id: "n2", parentId: "n1", kind: "text" })]).html;
    const tags = [...html.matchAll(/<([a-z]+)/g)].map((match) => match[1]);
    expect([...new Set(tags)].sort()).toEqual(["div", "section", "span"]);
  });
  it("carries the region background onto the section", () => {
    const result = emitHtml({ designWidth: 1170, region: REGION, tree: { ...tree([]), background: "#fff" } });
    expect(result.css).toContain(".region {"); expect(result.css).toContain("background: #fff");
  });
});

describe("flexDeviation", () => {
  const layout = (over: Partial<LayoutInfo> = {}): LayoutInfo => ({
    direction: "row", gap: 20, padding: { top: 0, right: 10, bottom: 0, left: 10 }, ...over,
  });
  it("is zero when flex reproduces measured positions", () => expect(flexDeviation(
    { x: 0, y: 0, w: 200, h: 50 }, [{ x: 10, y: 0, w: 50, h: 50 }, { x: 80, y: 0, w: 50, h: 50 }], layout(),
  )).toBe(0));
  it("reports accumulated drift", () => expect(flexDeviation(
    { x: 0, y: 0, w: 400, h: 50 }, [{ x: 10, y: 0, w: 50, h: 50 }, { x: 80, y: 0, w: 30, h: 50 }, { x: 140, y: 0, w: 50, h: 50 }], layout(),
  )).toBe(10));
  it("measures columns vertically", () => expect(flexDeviation(
    { x: 0, y: 0, w: 50, h: 200 }, [{ x: 0, y: 10, w: 50, h: 40 }, { x: 0, y: 70, w: 50, h: 40 }],
    layout({ direction: "column", padding: { top: 10, right: 0, bottom: 0, left: 0 } }),
  )).toBe(0));
});

describe("layout selection", () => {
  const parent = node({ id: "p", box: { x: 0, y: 100, w: 200, h: 50 }, layout: { direction: "row", gap: 20, padding: { top: 0, right: 10, bottom: 0, left: 10 } } });
  it("uses flex when it reproduces positions", () => {
    const { css } = emit([parent, node({ id: "a", parentId: "p", box: { x: 10, y: 100, w: 50, h: 50 } }), node({ id: "b", parentId: "p", box: { x: 80, y: 100, w: 50, h: 50 } })]);
    expect(css).toContain("display: flex"); expect(css).toContain("flex-direction: row"); expect(css).not.toMatch(/\.e-a \{[^}]*position: absolute/s);
  });
  it("falls back to absolute and records deviation", () => {
    const { css } = emit([node({ ...parent, id: "p", box: { x: 0, y: 100, w: 400, h: 50 } }), node({ id: "a", parentId: "p", box: { x: 10, y: 100, w: 50, h: 50 } }), node({ id: "b", parentId: "p", box: { x: 80, y: 100, w: 30, h: 50 } }), node({ id: "c", parentId: "p", box: { x: 140, y: 100, w: 50, h: 50 } })]);
    expect(css).toContain("flex 复现不了"); expect(css).toContain("10px"); expect(css).toMatch(/\.e-a \{[^}]*position: absolute/s);
  });
  it("keeps absolute children absolute", () => {
    const { css } = emit([parent, node({ id: "a", parentId: "p", box: { x: 10, y: 100, w: 50, h: 50 } }), node({ id: "b", parentId: "p", box: { x: 80, y: 100, w: 50, h: 50 } }), node({ id: "badge", parentId: "p", positioning: "absolute" })]);
    expect(css).toMatch(/\.e-badge \{[^}]*position: absolute/s);
  });
  it("uses repeat pitch as equal centred cells without gap", () => {
    const repeated = node({ id: "p", box: { x: 0, y: 100, w: 400, h: 50 }, repeat: { count: 4, templateId: "a", pitch: 90, slotBy: "tool" }, layout: { direction: "row", gap: 10, padding: { top: 0, right: 10, bottom: 0, left: 10 } } });
    const { css } = emit([repeated, node({ id: "a", parentId: "p", box: { x: 10, y: 100, w: 80, h: 50 } })]);
    expect(css).toContain("4 项重复");
    expect(css).toMatch(/\.e-p > \* \{[^}]*width: 7.6923vw !important[^}]*justify-content: center/s);
    expect(css).not.toMatch(/\.e-a \{[^}]*position: absolute/s);
    const container = /\.e-p \{([^}]*)\}/.exec(css)![1]!;
    expect(container).not.toContain("gap:");
  });
  it("uses a two pixel tolerance", () => expect(FLEX_TOLERANCE).toBe(2));
});
