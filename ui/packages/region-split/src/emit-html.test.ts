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
  it("renders recognized text literally without a todo marker", () => {
    const { html } = emit([node({ id: "label", kind: "text", displayName: "按钮文字", text: "立即购买" })]);
    expect(html).toContain('<span class="e-label">立即购买</span>');
    expect(html).not.toContain('data-todo="text"');
  });
  it("renders image and icon assets as accessible images", () => {
    const result = emitHtml({
      designWidth: 1170,
      region: REGION,
      tree: tree([
        node({ id: "photo", kind: "image", displayName: "用户头像" }),
        node({ id: "settings", kind: "icon", displayName: "设置图标" }),
      ]),
      assetSources: {
        photo: "data:image/png;base64,photo",
        settings: "data:image/png;base64,settings",
      },
    });
    expect(result.html).toContain('<img class="e-photo"');
    expect(result.html).toContain('src="data:image/png;base64,photo"');
    expect(result.html).toContain('alt="用户头像"');
    expect(result.html).toContain('src="data:image/png;base64,settings"');
    expect(result.html).not.toContain('data-todo="asset"');
    expect(result.css).toContain("object-fit: contain");
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
  // 列表项的尺寸改由 `> *` 统一给出，项自己不再写宽高，也就不需要 !important 去压了。
  it("uses repeat pitch as equal centred cells without gap", () => {
    const repeated = node({ id: "p", box: { x: 0, y: 100, w: 400, h: 50 }, repeat: { count: 4, templateId: "a", pitch: 90, slotBy: "tool" }, layout: { direction: "row", gap: 10, padding: { top: 0, right: 10, bottom: 0, left: 10 } } });
    const { css } = emit([repeated, node({ id: "a", parentId: "p", box: { x: 10, y: 100, w: 80, h: 50 } })]);
    expect(css).toContain("4 项重复");
    expect(css).toMatch(/\.e-p > \* \{[^}]*width: 7.6923vw;[^}]*justify-content: center/s);
    expect(css).not.toMatch(/\.e-a \{[^}]*position: absolute/s);
    const item = /\.e-a \{([^}]*)\}/.exec(css)![1]!;
    expect(item).not.toContain("width:");
    expect(item).not.toContain("height:");
    const container = /\.e-p \{([^}]*)\}/.exec(css)![1]!;
    expect(container).not.toContain("gap:");
  });
  it("uses a two pixel tolerance", () => expect(FLEX_TOLERANCE).toBe(2));
});

describe("列表槽位", () => {
  /** 实测「快捷功能菜单」：pitch 219.75，槽位中位数 141×134 */
  const grid = () => [
    node({
      id: "g", kind: "grid", box: { x: 36, y: 100, w: 1098, h: 255 },
      layout: { direction: "row", gap: 98, padding: { top: 59, right: 42, bottom: 18, left: 38 } },
      repeat: { count: 5, templateId: "c1", pitch: 219.75, slot: { w: 141, h: 134 }, slotBy: "tool" },
    }),
    node({ id: "c1", parentId: "g", box: { x: 74, y: 192, w: 142, h: 132 } }),
    node({ id: "c2", parentId: "g", box: { x: 293, y: 190, w: 141, h: 134 } }),
    node({ id: "c3", parentId: "g", box: { x: 512, y: 196, w: 103, h: 172 } }),
  ];

  // 主轴用 pitch（那才是让项等距排开的量），交叉轴用槽位
  it("sizes the cells from the pitch and the slot", () => {
    const rule = /\.e-g > \* \{([^}]*)\}/.exec(emit(grid()).css)![1]!;
    expect(rule).toContain("width: 18.7821vw");   // 219.75 / 1170
    expect(rule).toContain("height: 11.453vw");   // 134 / 1170
  });

  // 尺寸由 > * 一条规则给，项自己不再写——这才是 ul > li 该有的样子
  it("does not repeat the size on every item", () => {
    const item = /\.e-c1 \{([^}]*)\}/.exec(emit(grid()).css)![1]!;
    expect(item).not.toContain("width:");
    expect(item).not.toContain("height:");
  });

  // 项自己不写宽高之后，就不需要用 !important 去压它了
  it("needs no important flag", () => {
    expect(emit(grid()).css).not.toContain("!important");
  });

  // 角标压在图标上那种形态。它不参与等距排布，尺寸必须是自己的实测值，
  // 不能被 `> *` 套上槽位——审查实测过 20×20 被撑成 141×134。
  it("keeps an absolute badge at its own size inside a list", () => {
    const { css } = emit([
      ...grid(),
      node({ id: "badge", parentId: "g", box: { x: 180, y: 192, w: 20, h: 20 }, positioning: "absolute" }),
    ]);
    const badge = /\.e-badge \{([^}]*)\}/.exec(css)![1]!;
    expect(badge).toContain("width: 1.7094vw");   // 20 / 1170
    expect(badge).toContain("height: 1.7094vw");
    expect(badge).toContain("position: absolute");
  });

  // 靠"后写的赢"来压过 `> *`，所以顺序必须是这样
  it("emits the shared rule before the item rules", () => {
    const { css } = emit([
      ...grid(),
      node({ id: "badge", parentId: "g", box: { x: 180, y: 192, w: 20, h: 20 }, positioning: "absolute" }),
    ]);
    expect(css.indexOf(".e-g > *")).toBeLessThan(css.indexOf(".e-badge {"));
  });

  // 输入数组顺序不可信：AI 重构会原样插入模型给的数组，不保证父先子后。
  // 而 `> *` 与列表项规则权重相同，靠输出顺序决胜。
  it("orders parents before children whatever the input order", () => {
    const badge = node({ id: "badge", parentId: "g", box: { x: 180, y: 192, w: 20, h: 20 }, positioning: "absolute" });
    const [g, ...items] = grid();
    const { css } = emit([badge, ...items, g!]);
    expect(css.indexOf(".e-g > *")).toBeLessThan(css.indexOf(".e-badge {"));
    const rule = /\.e-badge \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain("width: 1.7094vw");
    expect(rule).toContain("height: 1.7094vw");
  });

  it("swaps the axes for a column list", () => {
    const rule = /\.e-g > \* \{([^}]*)\}/.exec(emit([
      node({
        id: "g", kind: "grid", box: { x: 0, y: 100, w: 200, h: 600 },
        layout: { direction: "column", gap: 20, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        repeat: { count: 3, templateId: "c1", pitch: 200, slot: { w: 180, h: 180 }, slotBy: "tool" },
      }),
      node({ id: "c1", parentId: "g", box: { x: 10, y: 110, w: 180, h: 180 } }),
      node({ id: "c2", parentId: "g", box: { x: 10, y: 310, w: 180, h: 180 } }),
      node({ id: "c3", parentId: "g", box: { x: 10, y: 510, w: 180, h: 180 } }),
    ]).css)![1]!;
    expect(rule).toContain("height: 17.094vw");   // pitch 200
    expect(rule).toContain("width: 15.3846vw");   // slot.w 180
  });

  // AI 重构能产出有 repeat 但没有 layout 的容器。这时容器不在 flexParents 里，
  // 子项走的是各自的 absolute left/top，尺寸也必须是自己的实测值——不能被
  // `> *` 套上槽位尺寸（审查实测：142×132 被套成 219.75×134，left/top 也错了）。
  it("keeps item sizes when repeat exists but the parent has no layout to drive flex", () => {
    const { css } = emit([
      node({
        id: "g", kind: "grid", box: { x: 36, y: 100, w: 1098, h: 255 },
        repeat: { count: 3, templateId: "c1", pitch: 219.75, slot: { w: 141, h: 134 }, slotBy: "tool" },
      }),
      node({ id: "c1", parentId: "g", box: { x: 74, y: 192, w: 142, h: 132 } }),
      node({ id: "c2", parentId: "g", box: { x: 293, y: 190, w: 141, h: 134 } }),
      node({ id: "c3", parentId: "g", box: { x: 512, y: 196, w: 103, h: 172 } }),
    ]);
    const item = /\.e-c1 \{([^}]*)\}/.exec(css)![1]!;
    expect(item).toContain("width: 12.1368vw");   // 142 / 1170，自己的实测宽
    expect(item).toContain("height: 11.2821vw");  // 132 / 1170，自己的实测高
    expect(item).toContain("position: absolute");
  });

  // 老数据的 repeat 没有槽位：退回只给主轴，别崩
  it("falls back to the pitch alone when there is no slot", () => {
    const rule = /\.e-g > \* \{([^}]*)\}/.exec(emit([
      node({
        id: "g", kind: "grid", box: { x: 0, y: 100, w: 300, h: 100 },
        layout: { direction: "row", gap: 10, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
        repeat: { count: 3, templateId: "c1", pitch: 100, slotBy: "tool" },
      }),
      node({ id: "c1", parentId: "g", box: { x: 0, y: 100, w: 90, h: 100 } }),
      node({ id: "c2", parentId: "g", box: { x: 100, y: 100, w: 90, h: 100 } }),
      node({ id: "c3", parentId: "g", box: { x: 200, y: 100, w: 90, h: 100 } }),
    ]).css)![1]!;
    expect(rule).toContain("width: 8.547vw");
    expect(rule).not.toContain("height:");
  });
});
