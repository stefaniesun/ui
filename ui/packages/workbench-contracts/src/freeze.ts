import type { MeasurementDoc } from "./measurement.js";

export interface FreezeIssue {
  code: "normalization-missing" | "unreviewed-low-confidence" | "unreviewed-human-item";
  itemId?: string;
  message: string;
}

export interface FreezeResult {
  ready: boolean;
  issues: FreezeIssue[];
}

export function validateMeasurementFreeze(doc: MeasurementDoc, confidenceThreshold = 0.8): FreezeResult {
  const issues: FreezeIssue[] = [];
  if (!doc.payload.normalization) {
    issues.push({ code: "normalization-missing", message: "Reference normalization is required." });
  }
  const items = [...doc.payload.textItems, ...doc.payload.colorSamples, ...doc.payload.ignoreMasks];
  for (const item of items) {
    if (item.source === "human" && !item.reviewed) {
      issues.push({ code: "unreviewed-human-item", itemId: item.id, message: `${item.id} is human-authored but not reviewed.` });
    } else if (item.confidence < confidenceThreshold && !item.reviewed) {
      issues.push({ code: "unreviewed-low-confidence", itemId: item.id, message: `${item.id} is below the confidence threshold.` });
    }
  }
  return { ready: issues.length === 0, issues };
}

export function freezeMeasurement(doc: MeasurementDoc, confirmedBy: string, now = new Date()): MeasurementDoc {
  const validation = validateMeasurementFreeze(doc);
  if (!validation.ready) {
    throw new Error(`Measurement cannot be frozen: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }
  return {
    ...doc,
    status: "confirmed",
    confirmedAt: now.toISOString(),
    confirmedBy,
  };
}
