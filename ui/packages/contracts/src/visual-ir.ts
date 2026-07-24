import { z } from 'zod'

const finiteNonnegative = z.number().finite().nonnegative()
const finitePositive = z.number().finite().positive()

export const BoundsSchema = z.object({
  x: finiteNonnegative,
  y: finiteNonnegative,
  width: finitePositive,
  height: finitePositive,
}).strict()

export const RegionNodeSchema = z.object({
  regionId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  displayName: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  parentId: z.string().nullable(),
  bounds: BoundsSchema,
  source: z.enum(['tool', 'model', 'human']),
  confidence: z.number().finite().min(0).max(1),
  componentPath: z.string().optional(),
  selector: z.string().optional(),
  lockedByHuman: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.lockedByHuman && value.source !== 'human') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lockedByHuman requires source to be human',
      path: ['lockedByHuman'],
    })
  }
})

const StateSchema = z.object({
  id: z.string().min(1),
  screenshot: z.string().min(1),
}).strict()

const VisualIRBaseSchema = z.object({
  version: z.literal('1.0.0'),
  projectId: z.string().min(1),
  pageId: z.string().min(1),
  coordinateSpace: z.literal('logical-px'),
  tokens: z.object({
    colors: z.record(z.string(), z.string()),
    typography: z.record(z.string(), z.unknown()),
    spacing: z.record(z.string(), finiteNonnegative),
    radii: z.record(z.string(), finiteNonnegative),
  }).strict(),
  states: z.array(StateSchema).min(1),
  regions: z.array(RegionNodeSchema).min(1),
  assets: z.array(z.unknown()),
  interactions: z.array(z.unknown()),
}).strict()

export const VisualIRSchema = VisualIRBaseSchema.superRefine((value, context) => {
  const regionIds = new Set<string>()
  let hasDuplicate = false
  for (const [index, region] of value.regions.entries()) {
    if (regionIds.has(region.regionId)) {
      hasDuplicate = true
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

  if (hasDuplicate) return

  const parents = new Map(value.regions.map(region => [region.regionId, region.parentId]))
  const state = new Map<string, 'visiting' | 'visited'>()
  const visit = (regionId: string): boolean => {
    const currentState = state.get(regionId)
    if (currentState === 'visiting') return true
    if (currentState === 'visited') return false
    state.set(regionId, 'visiting')
    const parentId = parents.get(regionId)
    const cyclic = parentId !== null && parentId !== undefined && visit(parentId)
    state.set(regionId, 'visited')
    return cyclic
  }

  for (const [index, region] of value.regions.entries()) {
    if (visit(region.regionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cycle detected in region hierarchy at ${region.regionId}`,
        path: ['regions', index, 'parentId'],
      })
      break
    }
  }
})

export type Bounds = z.output<typeof BoundsSchema>
export type RegionNodeInput = z.input<typeof RegionNodeSchema>
export type RegionNode = z.output<typeof RegionNodeSchema>
export type VisualIRInput = z.input<typeof VisualIRSchema>
export type VisualIR = z.output<typeof VisualIRSchema>

export function applyRegionSuggestion(current: RegionNode, incoming: RegionNodeInput): RegionNode {
  const suggestion = RegionNodeSchema.parse(incoming)
  if (!current.lockedByHuman) return suggestion

  return {
    ...suggestion,
    displayName: current.displayName,
    aliases: current.aliases,
    source: 'human',
    lockedByHuman: true,
  }
}
