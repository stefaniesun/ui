import { z } from 'zod'

export const TEXT_EXTRACTION_SCHEMA_VERSION = '1.0.0' as const
export const TEXT_EXTRACTION_PROMPT_VERSION = '1.0.0' as const
export const TEXT_CONFIDENCE_THRESHOLD = 0.6

const unit = z.number().finite().min(0).max(1)

export const NormalizedTextBoundsSchema = z.object({
  x: unit,
  y: unit,
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).strict().refine(
  value => value.x + value.width <= 1 && value.y + value.height <= 1,
  { message: 'normalized bounds must remain inside the region image' },
)

export const TextItemSchema = z.object({
  text: z.string().trim().min(1),
  bounds: NormalizedTextBoundsSchema,
  fontSize: z.number().finite().positive().nullable(),
  color: z.string().trim().min(1).nullable(),
  confidence: unit,
}).strict()

export const TextItemListSchema = z.object({
  items: z.array(TextItemSchema),
}).strict()

export const RegionTextBaselineSchema = z.object({
  regionId: z.string().min(1),
  imageHash: z.string().regex(/^[a-f0-9]{64}$/u),
  model: z.string().min(1),
  schemaVersion: z.literal(TEXT_EXTRACTION_SCHEMA_VERSION),
  promptVersion: z.literal(TEXT_EXTRACTION_PROMPT_VERSION),
  items: z.array(TextItemSchema),
  extractedAt: z.string().datetime(),
}).strict()

export const TextExtractionFailureSchema = z.object({
  code: z.literal('text-extraction-failed'),
  reason: z.enum([
    'timeout',
    'network',
    'http',
    'protocol',
    'schema-invalid',
    'crop-failed',
    'region-missing',
    'baseline-incompatible',
    'command-failed',
  ]),
  regionId: z.string().min(1),
  stage: z.enum(['reference', 'actual']),
  message: z.string().min(1),
}).strict()

export type NormalizedTextBounds = z.output<typeof NormalizedTextBoundsSchema>
export type TextItem = z.output<typeof TextItemSchema>
export type TextItemList = z.output<typeof TextItemListSchema>
export type RegionTextBaseline = z.output<typeof RegionTextBaselineSchema>
export type TextExtractionFailure = z.output<typeof TextExtractionFailureSchema>
