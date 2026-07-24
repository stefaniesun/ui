import { z } from 'zod'

export const BoundsSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
})

export const RegionNodeSchema = z.object({
  regionId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  displayName: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  parentId: z.string().nullable(),
  bounds: BoundsSchema,
  source: z.enum(['tool', 'model', 'human']),
  confidence: z.number().min(0).max(1),
  componentPath: z.string().optional(),
  selector: z.string().optional(),
  lockedByHuman: z.boolean().default(false),
})

const VisualIRBaseSchema = z.object({
  version: z.literal('1.0.0'),
  projectId: z.string().min(1),
  pageId: z.string().min(1),
  tokens: z.object({
    colors: z.record(z.string(), z.string()),
    typography: z.record(z.string(), z.unknown()),
    spacing: z.record(z.string(), z.number()),
    radii: z.record(z.string(), z.number()),
  }),
  states: z.array(z.object({
    id: z.string().min(1),
    screenshot: z.string().min(1),
  })).min(1),
  regions: z.array(RegionNodeSchema).min(1),
  assets: z.array(z.unknown()),
  interactions: z.array(z.unknown()),
})

export const VisualIRSchema = VisualIRBaseSchema.superRefine((value, context) => {
  const regionIds = new Set<string>()
  for (const [index, region] of value.regions.entries()) {
    if (regionIds.has(region.regionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate regionId: ${region.regionId}`,
        path: ['regions', index, 'regionId'],
      })
    }
    regionIds.add(region.regionId)
  }

  for (const [index, region] of value.regions.entries()) {
    if (region.parentId !== null && !regionIds.has(region.parentId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `parentId does not reference a region: ${region.parentId}`,
        path: ['regions', index, 'parentId'],
      })
    }
  }

  const parents = new Map(value.regions.map(region => [region.regionId, region.parentId]))
  for (const [index, region] of value.regions.entries()) {
    const visited = new Set<string>()
    let current: string | null | undefined = region.regionId
    while (current !== null && current !== undefined) {
      if (visited.has(current)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `cycle detected in region hierarchy at ${current}`,
          path: ['regions', index, 'parentId'],
        })
        break
      }
      visited.add(current)
      current = parents.get(current)
    }
  }
})

export type Bounds = z.infer<typeof BoundsSchema>
export type VisualIR = z.infer<typeof VisualIRSchema>
export type RegionNode = z.infer<typeof RegionNodeSchema>
