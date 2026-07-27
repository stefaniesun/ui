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
  affectedStateIds: z.array(z.string().min(1)).min(1),
  affectedTargets: z.array(z.enum(['h5', 'wechat', 'android', 'ios'])).min(1),
  rollbackConditions: z.array(z.string().min(1)).min(1),
  replacementFiles: z.record(safeProjectFile, z.string()).refine(value => Object.keys(value).length > 0, {
    message: 'replacementFiles must not be empty',
  }),
}).strict().superRefine((plan, context) => {
  for (const file of Object.keys(plan.replacementFiles)) {
    if (!plan.allowedFiles.includes(file)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replacementFiles', file],
        message: `replacement file must be listed in allowedFiles: ${file}`,
      })
    }
  }
})

export type PatchPlanInput = z.input<typeof PatchPlanSchema>
export type PatchPlan = z.output<typeof PatchPlanSchema>
