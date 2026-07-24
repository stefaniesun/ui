import { z } from 'zod'

export const PatchPlanSchema = z.object({
  targetRegionIds: z.array(z.string().min(1)).min(1),
  rootCause: z.string().min(1),
  allowedFiles: z.array(z.string().min(1)).min(1),
  expectedMetricChanges: z.record(z.string(), z.number()),
  affectedStateIds: z.array(z.string().min(1)).default([]),
  affectedTargets: z.array(z.enum(['h5', 'wechat', 'android', 'ios'])).default([]),
  rollbackConditions: z.array(z.string().min(1)).min(1),
})

export type PatchPlan = z.infer<typeof PatchPlanSchema>
