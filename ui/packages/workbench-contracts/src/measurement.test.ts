import { describe, expect, it } from "vitest";
import { emptyMeasurementDoc, parseMeasurementDoc } from "./measurement.js";

const meta = { source: "tool", confidence: 0.9, reviewed: false } as const;

describe("measurement document", () => {
  it("round-trips a valid document", () => {
    const doc = emptyMeasurementDoc();
    doc.status = "draft";
    doc.payload.textItems.push({
      id: "t1",
      text: "会员",
      bounds: { x: 10, y: 20, w: 40, h: 16 },
      fontSizePx: 14,
      ocrConfidence: 0.98,
      ...meta,
    });
    expect(parseMeasurementDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it("rejects invalid status and confidence", () => {
    expect(() => parseMeasurementDoc({ ...emptyMeasurementDoc(), status: "weird" })).toThrow();
    const doc = emptyMeasurementDoc();
    doc.payload.colorSamples.push({
      id: "c1",
      role: "background",
      hex: "#ffffff",
      lab: [100, 0, 0],
      sampleRegion: { x: 0, y: 0, w: 8, h: 8 },
      ...meta,
      confidence: 1.5,
    });
    expect(() => parseMeasurementDoc(doc)).toThrow();
  });
});
