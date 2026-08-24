import { elementKinds } from "@region-split/core/browser";
import { describe, expect, it } from "vitest";
import { KIND_COLOR, KIND_LABEL } from "./element-kind-display.js";

describe("元素类型的显示", () => {
  it("names every kind in chinese", () => {
    for (const kind of elementKinds) {
      expect(KIND_LABEL[kind]).toBeTruthy();
      expect(KIND_LABEL[kind]).not.toBe(kind);
    }
  });

  it("gives every kind its own colour", () => {
    const colors = elementKinds.map(kind => KIND_COLOR[kind]);
    expect(new Set(colors).size).toBe(elementKinds.length);
  });

  it("uses colours the css can take as-is", () => {
    for (const kind of elementKinds) expect(KIND_COLOR[kind]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
