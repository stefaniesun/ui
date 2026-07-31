import { z } from 'zod'
import { isSafeProjectRelativePath } from './path.js'

const finiteNonnegative = z.number().finite().nonnegative()
const finitePositive = z.number().finite().positive()

export const BoundsSchema = z.object({
  x: finiteNonnegative,
  y: finiteNonnegative,
  width: finitePositive,
  height: finitePositive,
}).strict()

const nodeId = z.string().regex(/^[a-z][a-z0-9-]*$/)

const TextContentSchema = z.object({
  kind: z.literal('text'),
  nodeId,
  text: z.string().min(1),
  role: z.enum(['title', 'body', 'label', 'price', 'caption']),
  bounds: BoundsSchema,
  typographyToken: z.string().min(1).optional(),
  colorToken: z.string().min(1).optional(),
}).strict()

const AssetContentSchema = z.object({
  kind: z.literal('asset'),
  nodeId,
  assetId: nodeId,
  alt: z.string(),
  bounds: BoundsSchema,
  fit: z.enum(['contain', 'cover', 'fill']),
}).strict()

const ControlContentSchema = z.object({
  kind: z.literal('control'),
  nodeId,
  control: z.literal('button'),
  label: z.string().trim().min(1),
  bounds: BoundsSchema,
  actionId: nodeId.optional(),
}).strict()

const DecorationContentSchema = z.object({
  kind: z.literal('decoration'),
  nodeId,
  decoration: z.enum(['surface', 'divider', 'shape']),
  bounds: BoundsSchema,
  colorToken: z.string().min(1).optional(),
  radiusToken: z.string().min(1).optional(),
}).strict()

export const ContentNodeSchema = z.discriminatedUnion('kind', [
  TextContentSchema,
  AssetContentSchema,
  ControlContentSchema,
  DecorationContentSchema,
])

export const VisualAssetSchema = z.object({
  assetId: nodeId,
  regionId: nodeId,
  role: z.enum(['image', 'icon', 'avatar', 'background']),
  source: z.string().min(1),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
}).strict()

export const VisualInteractionSchema = z.object({
  interactionId: nodeId,
  regionId: nodeId,
  triggerNodeId: nodeId,
  action: z.enum(['tap', 'navigate', 'toggle', 'submit']),
  resultingStateId: z.string().min(1).optional(),
  confidence: z.number().finite().min(0).max(1),
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
  content: z.array(ContentNodeSchema).default([]),
  decorationOnly: z.boolean().default(false),
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

const TypographyTokenSchema = z.object({
  fontFamily: z.string().min(1).optional(),
  fontSize: finitePositive,
  fontWeight: z.number().finite().min(1).max(1000),
  lineHeight: finitePositive,
}).strict()

const VisualIRBaseSchema = z.object({
  version: z.literal('1.0.0'),
  projectId: z.string().min(1),
  pageId: z.string().min(1),
  coordinateSpace: z.literal('logical-px'),
  tokens: z.object({
    colors: z.record(z.string(), z.string()),
    typography: z.record(z.string(), TypographyTokenSchema),
    spacing: z.record(z.string(), finiteNonnegative),
    radii: z.record(z.string(), finiteNonnegative),
  }).strict(),
  states: z.array(StateSchema).min(1),
  regions: z.array(RegionNodeSchema).min(1),
  assets: z.array(VisualAssetSchema),
  interactions: z.array(VisualInteractionSchema),
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

  const stateIds = new Set(value.states.map(state => state.id))
  const childCounts = new Map(value.regions.map(region => [region.regionId, 0]))
  for (const region of value.regions) {
    if (region.parentId !== null && childCounts.has(region.parentId)) {
      childCounts.set(region.parentId, childCounts.get(region.parentId)! + 1)
    }
  }

  const canvasWidth = Math.max(...value.regions.map(region => region.bounds.x + region.bounds.width))
  const canvasHeight = Math.max(...value.regions.map(region => region.bounds.y + region.bounds.height))
  const contentNodesByRegion = new Map<string, Set<string>>()

  for (const [regionIndex, region] of value.regions.entries()) {
    const contentNodeIds = new Set<string>()
    contentNodesByRegion.set(region.regionId, contentNodeIds)
    let hasVisibleContent = false
    for (const [contentIndex, node] of region.content.entries()) {
      if (contentNodeIds.has(node.nodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate content nodeId: ${node.nodeId}`,
          path: ['regions', regionIndex, 'content', contentIndex, 'nodeId'],
        })
      }
      contentNodeIds.add(node.nodeId)
      if (node.kind !== 'decoration') hasVisibleContent = true
      if (node.bounds.x + node.bounds.width > canvasWidth
        || node.bounds.y + node.bounds.height > canvasHeight) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `content node is outside the inferred page canvas: ${node.nodeId}`,
          path: ['regions', regionIndex, 'content', contentIndex, 'bounds'],
        })
      }
    }
    if (childCounts.get(region.regionId) === 0 && !region.decorationOnly && !hasVisibleContent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `non-decorative leaf region requires visible content: ${region.regionId}`,
        path: ['regions', regionIndex, 'content'],
      })
    }
  }

  const assetIds = new Set<string>()
  for (const [assetIndex, asset] of value.assets.entries()) {
    if (assetIds.has(asset.assetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate assetId: ${asset.assetId}`,
        path: ['assets', assetIndex, 'assetId'],
      })
    }
    assetIds.add(asset.assetId)
    if (!regionIds.has(asset.regionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `asset regionId does not reference a region: ${asset.regionId}`,
        path: ['assets', assetIndex, 'regionId'],
      })
    }
    const normalizedSource = asset.source.replaceAll('\\', '/')
    const sourceSegments = normalizedSource.split('/')
    if (!isSafeProjectRelativePath(normalizedSource)
      || !normalizedSource.startsWith('src/assets/')
      || sourceSegments.some(segment => segment === '.' || segment === '..' || segment === '')
      || !/^[a-zA-Z0-9_./-]+$/u.test(normalizedSource)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `asset source must be a safe project-relative path under src/assets: ${asset.source}`,
        path: ['assets', assetIndex, 'source'],
      })
    }
  }

  for (const [regionIndex, region] of value.regions.entries()) {
    for (const [contentIndex, node] of region.content.entries()) {
      if (node.kind === 'asset' && !assetIds.has(node.assetId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `assetId does not reference an asset: ${node.assetId}`,
          path: ['regions', regionIndex, 'content', contentIndex, 'assetId'],
        })
      }
    }
  }

  const interactionIds = new Set<string>()
  for (const [interactionIndex, interaction] of value.interactions.entries()) {
    if (interactionIds.has(interaction.interactionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate interactionId: ${interaction.interactionId}`,
        path: ['interactions', interactionIndex, 'interactionId'],
      })
    }
    interactionIds.add(interaction.interactionId)
    if (!regionIds.has(interaction.regionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `interaction regionId does not reference a region: ${interaction.regionId}`,
        path: ['interactions', interactionIndex, 'regionId'],
      })
    }
    if (!contentNodesByRegion.get(interaction.regionId)?.has(interaction.triggerNodeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `triggerNodeId does not reference content in its region: ${interaction.triggerNodeId}`,
        path: ['interactions', interactionIndex, 'triggerNodeId'],
      })
    }
    if (interaction.resultingStateId !== undefined && !stateIds.has(interaction.resultingStateId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `resultingStateId does not reference a state: ${interaction.resultingStateId}`,
        path: ['interactions', interactionIndex, 'resultingStateId'],
      })
    }
  }
})

export type Bounds = z.output<typeof BoundsSchema>
export type ContentNode = z.output<typeof ContentNodeSchema>
export type VisualAsset = z.output<typeof VisualAssetSchema>
export type VisualInteraction = z.output<typeof VisualInteractionSchema>
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
