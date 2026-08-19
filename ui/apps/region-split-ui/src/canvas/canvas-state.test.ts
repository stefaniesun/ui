import { describe, expect, it } from "vitest";
import {
  DEFAULT_NODE_POSITIONS,
  bezierPath,
  clampZoom,
  fitBounds,
  loadNodePositions,
  portAnchors,
  saveNodePositions,
  zoomAtPoint,
  canStartPan,
} from "./canvas-state.js";

describe("canvas state", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampZoom(0.01)).toBe(0.2);
    expect(clampZoom(4)).toBe(3);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it("keeps the flow point under the cursor while zooming", () => {
    expect(zoomAtPoint({ x: 100, y: 50, zoom: 1 }, 2, { x: 300, y: 250 }))
      .toEqual({ x: -100, y: -150, zoom: 2 });
  });

  it("fits bounds into the available viewport", () => {
    expect(fitBounds({ x: 100, y: 50, width: 1000, height: 500 }, { width: 800, height: 600 }, 50))
      .toEqual({ x: -20, y: 90, zoom: 0.7 });
  });

  it("loads persisted positions and safely falls back on malformed storage", () => {
    const good = { getItem: () => JSON.stringify({ workspace: { x: 10, y: 20 } }) };
    expect(loadNodePositions(good, "nodes", DEFAULT_NODE_POSITIONS).workspace).toEqual({ x: 10, y: 20 });
    const bad = { getItem: () => "{" };
    expect(loadNodePositions(bad, "nodes", DEFAULT_NODE_POSITIONS)).toEqual(DEFAULT_NODE_POSITIONS);
  });

  it("ignores storage write failures", () => {
    expect(() => saveNodePositions({ setItem: () => { throw new Error("quota"); } }, "nodes", DEFAULT_NODE_POSITIONS))
      .not.toThrow();
  });
});

describe("端口与连线", () => {
  it("anchors ports on the node edges at the header line", () => {
    const [first] = portAnchors(
      { workspace: { x: 0, y: 0 }, detail: { x: 500, y: 40 }, page: { x: 500, y: 600 } },
      { workspace: 400, detail: 300, page: 300 },
    );
    expect(first).toEqual({ from: { x: 400, y: 21 }, to: { x: 500, y: 61 } });
  });
  it("links workspace to detail", () => {
    expect(portAnchors(
      { workspace: { x: 0, y: 0 }, detail: { x: 500, y: 0 }, page: { x: 500, y: 600 } },
      { workspace: 400, detail: 300, page: 300 },
    )).toHaveLength(2);
  });
  it("draws cubic curves with horizontal handles", () => {
    expect(bezierPath({ x: 0, y: 0 }, { x: 200, y: 100 })).toBe("M 0 0 C 100 0, 100 100, 200 100");
    expect(bezierPath({ x: 0, y: 0 }, { x: 20, y: 0 })).toBe("M 0 0 C 60 0, -40 0, 20 0");
  });
});

describe("fixed node positions", () => {
  it("places the detail and page nodes to the right of the workspace", () => {
    expect(DEFAULT_NODE_POSITIONS.detail.x)
      .toBeGreaterThan(DEFAULT_NODE_POSITIONS.workspace.x);
    expect(DEFAULT_NODE_POSITIONS.page.x)
      .toBeGreaterThan(DEFAULT_NODE_POSITIONS.workspace.x);
  });

  // 旧的 v2 存档里可能还带着已经废弃的 code 键（老版本的固定代码节点），必须能正常
  // 载入并忽略它，不需要提升 storage key 的版本号——升了反而会丢掉用户摆好的位置
  it("falls back for a node missing from an older payload, and ignores stale extra keys", () => {
    const storage = { getItem: () => JSON.stringify({ workspace: { x: 5, y: 6 }, code: { x: 9, y: 9 } }) };
    const loaded = loadNodePositions(storage, "nodes", DEFAULT_NODE_POSITIONS);
    expect(loaded.workspace).toEqual({ x: 5, y: 6 });
    expect(loaded.detail).toEqual(DEFAULT_NODE_POSITIONS.detail);
    expect(loaded.page).toEqual(DEFAULT_NODE_POSITIONS.page);
    expect(loaded).not.toHaveProperty("code");
  });

  it("round trips all node positions", () => {
    const written: Record<string, string> = {};
    const positions = { workspace: { x: 1, y: 2 }, detail: { x: 3, y: 4 }, page: { x: 5, y: 6 } };
    saveNodePositions({ setItem: (k, v) => { written[k] = v; } }, "nodes", positions);
    const loaded = loadNodePositions(
      { getItem: (k: string) => written[k] ?? null }, "nodes", DEFAULT_NODE_POSITIONS);
    expect(loaded).toEqual(positions);
  });
});

describe("canStartPan", () => {
  const canvas = document.createElement("section");
  const make = (className: string, parent: Element = canvas) => {
    const el = document.createElement("div");
    el.className = className;
    parent.appendChild(el);
    return el;
  };

  it("pans from the canvas itself", () => {
    expect(canStartPan(canvas, canvas)).toBe(true);
  });

  // `.world` 铺满 10000x6000 且接收指针事件，点画布空白命中的是它而不是画布本身。
  // 不认它就等于整块画布都拖不动——实测右侧空白处 canStartPan 直接返回 false。
  it("pans from the world layer", () => {
    expect(canStartPan(make("world"), canvas)).toBe(true);
  });

  it("pans from the grid layer", () => {
    expect(canStartPan(make("grid"), canvas)).toBe(true);
  });

  // 只认 world 自己：认 closest 的话节点内部的空白也会拖动整个画布
  it("does not pan from a node sitting inside the world layer", () => {
    const world = make("world");
    expect(canStartPan(make("node-body", world), canvas)).toBe(false);
  });

  it("pans from an area marked for it", () => {
    const marked = make("panel");
    marked.setAttribute("data-canvas-pan", "");
    expect(canStartPan(make("blank", marked), canvas)).toBe(true);
  });

  it("never pans from a control or a node header", () => {
    for (const tag of ["button", "input", "select", "textarea", "a"]) {
      const el = document.createElement(tag);
      canvas.appendChild(el);
      expect(canStartPan(el, canvas)).toBe(false);
    }
    const header = make("header");
    header.setAttribute("data-node-header", "");
    expect(canStartPan(header, canvas)).toBe(false);
  });

  // 标了 no-pan 的区域优先级最高，哪怕它就在 world 上
  it("respects an explicit opt out", () => {
    const world = make("world");
    world.setAttribute("data-no-canvas-pan", "");
    expect(canStartPan(world, canvas)).toBe(false);
  });
});
