import { z } from 'zod'

const score = z.number().finite().min(0).max(1)

export const TextMatchMetricSchema = z.object({
  reference: z.string(),
  actual: z.string(),
  cost: score,
  critical: z.boolean(),
}).strict()

export const TextExtractionMetricSchema = z.object({
  provider: z.enum(['model', 'command']),
  model: z.string().min(1),
  cacheHit: z.boolean(),
}).strict()

export const RegionTextMetricSchema = z.object({
  score,
  content: score,
  position: score,
  fontSize: score.nullable(),
  color: score.nullable(),
  missing: z.array(z.string()),
  added: z.array(z.string()),
  lowConfidence: z.array(z.string()),
  matches: z.array(TextMatchMetricSchema),
  extraction: TextExtractionMetricSchema,
}).strict()

export const RegionMetricSchema = z.object({
  regionId: z.string().min(1),
  total: score,
  geometryErrorPx: z.number().finite().nonnegative(),
  text: RegionTextMetricSchema,
  severeDefects: z.array(z.string()),
}).strict()

export const ReviewReportSchema = z.object({
  version: z.literal('1.0.0'),
  runId: z.string().min(1),
  pageId: z.string().min(1),
  stateId: z.string().min(1),
  total: score,
  regions: z.array(RegionMetricSchema),
  bestRound: z.number().finite().int().nonnegative(),
}).strict()

export type RegionMetricInput = z.input<typeof RegionMetricSchema>
export type RegionMetric = z.output<typeof RegionMetricSchema>
export type ReviewReportInput = z.input<typeof ReviewReportSchema>
export type ReviewReport = z.output<typeof ReviewReportSchema>
