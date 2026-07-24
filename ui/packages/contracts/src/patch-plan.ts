import { z } from 'zod'
import { isSafeProjectRelativePath } from './path.js'

const safeProjectFile = z.string().min(1).refine(isSafeProjectRelativePath, {
  message: 'allowed file must be a project-relative path without traversal',
})

export const PatchPlanSchema = z.object({
  targetRegionIds: z.array(z.string().min(1)).min(1),
  rootCause: z.string().min(1),
  allowedFiles: z.array(safeProjectFile).min(1),
  allowedComponents: z.array(z.string().min(1)),
  allowedTokens: z.array(z.string().min(1)),
  expectedMetricChanges: z.record(z.string(), z.number().finite()),
  affectedStateIds: z.array(z.string().min(1)),
  affectedTargets: z.array(z.enum(['h5', 'wechat', 'android', 'ios'])),
  rollbackConditions: z.array(z.string().min(1)).min(1),
}).strict()

export type PatchPlanInput = z.input<typeof PatchPlanSchema>
export type PatchPlan = z.output<typeof PatchPlanSchema>
