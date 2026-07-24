import { z } from 'zod'

export const RegionMetricSchema = z.object({
  regionId: z.string().min(1),
  total: z.number().min(0).max(1),
  geometryErrorPx: z.number().nonnegative(),
  ocrMatch: z.number().min(0).max(1).nullable(),
  severeDefects: z.array(z.string()),
})

export const ReviewReportSchema = z.object({
  version: z.literal('1.0.0'),
  runId: z.string().min(1),
  pageId: z.string().min(1),
  stateId: z.string().min(1),
  total: z.number().min(0).max(1),
  regions: z.array(RegionMetricSchema),
  bestRound: z.number().int().nonnegative(),
})

export type RegionMetric = z.infer<typeof RegionMetricSchema>
export type ReviewReport = z.infer<typeof ReviewReportSchema>
