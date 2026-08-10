import { describe, expect, it } from "vitest";
import { applyGuardedChangeSet, guardChangeSet, type ChangeSet } from "./annotation.js";
import { emptyMeasurementDoc } from "./measurement.js";

function fixturePayload() {
  const payload = emptyMeasurementDoc().payload;
  payload.textItems.push(
    { id: "t0", text: "y128", bounds: { x: 10, y: 10, w: 40, h: 16 }, ocrConfidence: 0.7, source: "tool", confidence: 0.7, reviewed: false },
    { id: "t1", text: "已修", bounds: { x: 10, y: 40, w: 40, h: 16 }, ocrConfidence: 0.7, source: "human", confidence: 1, reviewed: true },
    { id: "t2", text: "远处", bounds: { x: 300, y: 500, w: 40, h: 16 }, ocrConfidence: 0.9, source: "tool", confidence: 0.9, reviewed: false },
  );
  return payload;
}

const annotationBounds = { x: 0, y: 0, w: 100, h: 100 };
const changeSet = (operations: ChangeSet["operations"]): ChangeSet => ({
  id: "cs1",
  annotationId: "a1",
  operations,
  status: "proposed",
});

describe("guardChangeSet", () => {
  it("allows operations on tool items inside annotation bounds", () => {
    const result = guardChangeSet(changeSet([{ op: "replace", path: "/textItems/0/text", value: "¥128", explanation: "fix" }]), fixturePayload(), annotationBounds);
    expect(result.allowed).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("applies only guarded operations to a cloned payload", () => {
    const original = fixturePayload();
    const result = applyGuardedChangeSet(original, changeSet([
      { op: "replace", path: "/textItems/0/text", value: "¥128", explanation: "fix" },
      { op: "replace", path: "/textItems/1/text", value: "blocked", explanation: "unsafe" },
    ]), annotationBounds);
    expect(result.payload.textItems[0]?.text).toBe("¥128");
    expect(result.payload.textItems[1]?.text).toBe("已修");
    expect(original.textItems[0]?.text).toBe("y128");
  });

  it.each([
    ["/textItems/1/text", "human-protected"],
    ["/textItems/2", "out-of-bounds"],
    ["/status", "invalid-path"],
  ])("rejects protected, out-of-range, or invalid operation %s", (path, reason) => {
    const result = guardChangeSet(changeSet([{ op: "replace", path, value: "x", explanation: "" }]), fixturePayload(), annotationBounds);
    expect(result.rejected[0]?.reason).toBe(reason);
  });
});
