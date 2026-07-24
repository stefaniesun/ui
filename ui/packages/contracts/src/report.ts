import { z } from 'zod'

const score = z.number().finite().min(0).max(1)

export const RegionMetricSchema = z.object({
  regionId: z.string().min(1),
  total: score,
  geometryErrorPx: z.number().finite().nonnegative(),
  ocrMatch: score.nullable(),
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
