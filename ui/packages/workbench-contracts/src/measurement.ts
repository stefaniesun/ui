import { z } from "zod";
import { sources } from "./provenance.js";
import type { StageDoc } from "./stage-doc.js";
import { stageDocSchema } from "./stage-doc.js";

export const rectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive().finite(),
  h: z.number().positive().finite(),
});

export const sizeSchema = z.object({
  w: z.number().positive().finite(),
  h: z.number().positive().finite(),
});

const metaShape = {
  source: z.enum(sources),
  confidence: z.number().min(0).max(1),
  reviewed: z.boolean(),
};

export const textItemSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  bounds: rectSchema,
  lineHeightPx: z.number().positive().optional(),
  fontSizePx: z.number().positive().optional(),
  ocrConfidence: z.number().min(0).max(1),
  ...metaShape,
});
export type TextItem = z.infer<typeof textItemSchema>;

export const colorRoles = ["background", "surface", "text-primary", "text-secondary", "accent", "unknown"] as const;
export const colorSampleSchema = z.object({
  id: z.string().min(1),
  role: z.enum(colorRoles),
  hex: z.string().regex(/^#[0-9a-f]{6}$/i),
  lab: z.tuple([z.number(), z.number(), z.number()]),
  sampleRegion: rectSchema,
  ...metaShape,
});
export type ColorSample = z.infer<typeof colorSampleSchema>;

export const ignoreMaskSchema = z.object({
  id: z.string().min(1),
  bounds: rectSchema,
  reason: z.string(),
  ...metaShape,
});
export type IgnoreMask = z.infer<typeof ignoreMaskSchema>;

export const normalizationSchema = z.object({
  referenceImage: z.string().min(1),
  physicalSize: sizeSchema,
  scale: z.number().positive(),
  logicalSize: sizeSchema,
  statusBarCrop: rectSchema.optional(),
  ...metaShape,
});
export type NormalizationInfo = z.infer<typeof normalizationSchema>;

export const measurementPayloadSchema = z.object({
  normalization: normalizationSchema.nullable(),
  textItems: z.array(textItemSchema),
  colorSamples: z.array(colorSampleSchema),
  ignoreMasks: z.array(ignoreMaskSchema),
});
export type MeasurementPayload = z.infer<typeof measurementPayloadSchema>;
export type MeasurementDoc = StageDoc<MeasurementPayload>;

export const measurementDocSchema = stageDocSchema("measurement", measurementPayloadSchema);

export function parseMeasurementDoc(data: unknown): MeasurementDoc {
  return measurementDocSchema.parse(data) as MeasurementDoc;
}

export function emptyMeasurementDoc(): MeasurementDoc {
  return {
    stage: "measurement",
    schemaVersion: "1",
    status: "empty",
    upstreamFingerprint: "",
    payload: {
      normalization: null,
      textItems: [],
      colorSamples: [],
      ignoreMasks: [],
    },
  };
}
