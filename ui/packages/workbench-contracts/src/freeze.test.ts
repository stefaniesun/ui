import { describe, expect, it } from "vitest";
import { emptyMeasurementDoc } from "./measurement.js";
import { freezeMeasurement, validateMeasurementFreeze } from "./freeze.js";

function normalizedDoc() {
  const doc = emptyMeasurementDoc();
  doc.status = "draft";
  doc.payload.normalization = {
    referenceImage: "reference.normalized.png",
    physicalSize: { w: 750, h: 1624 },
    scale: 2,
    logicalSize: { w: 375, h: 812 },
    source: "tool",
    confidence: 1,
    reviewed: true,
  };
  return doc;
}

describe("measurement freeze gate", () => {
  it("requires normalization", () => {
    expect(validateMeasurementFreeze(emptyMeasurementDoc()).issues[0]?.code).toBe("normalization-missing");
  });

  it("blocks unreviewed low-confidence facts", () => {
    const doc = normalizedDoc();
    doc.payload.textItems.push({ id: "t1", text: "?", bounds: { x: 0, y: 0, w: 10, h: 10 }, ocrConfidence: 0.4, source: "tool", confidence: 0.4, reviewed: false });
    expect(validateMeasurementFreeze(doc).ready).toBe(false);
    expect(() => freezeMeasurement(doc, "reviewer")).toThrow("cannot be frozen");
  });

  it("confirms fully reviewed measurements", () => {
    const doc = normalizedDoc();
    const frozen = freezeMeasurement(doc, "reviewer", new Date("2026-08-10T00:00:00.000Z"));
    expect(frozen).toMatchObject({ status: "confirmed", confirmedBy: "reviewer", confirmedAt: "2026-08-10T00:00:00.000Z" });
  });
});
