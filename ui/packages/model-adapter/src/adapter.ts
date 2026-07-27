import {
  PatchPlanSchema,
  TEXT_EXTRACTION_PROMPT_VERSION,
  TextItemListSchema,
  VisualIRSchema,
} from '@ui-rebuild/contracts'
import type { PatchPlan, TextItem, VisualIR } from '@ui-rebuild/contracts'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requestStructuredOutput } from './openai-compatible.js'
import { probeCapabilities } from './probe.js'
import { StructuredOutputError } from './structured-output.js'
import type {
  AnalyzeScreensInput, DiagnoseDiffInput, ExtractTextInput, ModelAdapter, ModelCapabilityProfile,
  ModelImage, ModelReview, ModelTransport, ReviewResultInput, TransportResponse,
} from './types.js'

const ModelReviewSchema = z.object({ summary: z.string(), unresolved: z.array(z.string()) }).strict()

function buildTextExtractionPrompt(regionId: string): string {
  return [
    `Text extraction prompt version: ${TEXT_EXTRACTION_PROMPT_VERSION}`,
    `Region ID: ${regionId}`,
    'Return only text that is visibly present in this region image.',
    'Do not infer, autocomplete, translate, or reconstruct hidden text.',
    'Return bounds normalized to this cropped image, with x, y, width, and height in [0, 1].',
    'Preserve punctuation, whitespace meaning, currency symbols, dates, percentages, and numeric formatting.',
    'Return fontSize and color as null when they cannot be determined reliably.',
    'Return confidence in [0, 1].',
  ].join('\n')
}

function jsonSchema(schema: z.ZodTypeAny, name: string): Record<string, unknown> {
  return zodToJsonSchema(schema, { name, $refStrategy: 'none' }) as Record<string, unknown>
}

function transportFailure(response: Extract<TransportResponse, { ok: false }>, mode: ModelCapabilityProfile['structuredOutput']) {
  return new StructuredOutputError(response.message, {
    mode, status: response.status, kind: response.kind,
  })
}

export class OpenAICompatibleModelAdapter implements ModelAdapter {
  private capability: ModelCapabilityProfile | null = null

  constructor(private readonly transport: ModelTransport) {}

  async probe(referenceImage: ModelImage, signal?: AbortSignal): Promise<ModelCapabilityProfile> {
    if (this.capability
      && referenceImage.width <= this.capability.maxVerifiedImage.width
      && referenceImage.height <= this.capability.maxVerifiedImage.height) return this.capability
    const profile = await probeCapabilities(this.transport, referenceImage, signal)
    this.capability = profile
    return profile
  }

  async analyzeScreens(input: AnalyzeScreensInput): Promise<VisualIR> {
    return this.request('visual_ir', input.prompt, input.screenshots, VisualIRSchema, input.signal)
  }

  async extractText(input: ExtractTextInput): Promise<TextItem[]> {
    const result = await this.request(
      'text_items',
      buildTextExtractionPrompt(input.regionId),
      [input.image],
      TextItemListSchema,
      input.signal,
    )
    return result.items
  }

  async diagnoseDiff(input: DiagnoseDiffInput): Promise<PatchPlan> {
    return this.request('patch_plan', input.prompt, input.images, PatchPlanSchema, input.signal)
  }

  async reviewResult(input: ReviewResultInput): Promise<ModelReview> {
    return this.request('model_review', input.prompt, input.images, ModelReviewSchema, input.signal)
  }

  private async request<T>(
    schemaName: string,
    prompt: string,
    images: ModelImage[],
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (images.length === 0) throw new Error(`${schemaName} requires at least one image`)
    let capability = this.capability
    for (const image of images) {
      if (!capability
        || image.width > capability.maxVerifiedImage.width
        || image.height > capability.maxVerifiedImage.height) {
        capability = await this.probe(image, signal)
      }
    }
    if (capability === null) throw new Error('Model capability probe did not complete')
    const verifiedCapability = capability
    const schemaDocument = jsonSchema(schema, schemaName)
    const send = async (requestPrompt: string) => {
      const response = await this.transport.send({
        structuredOutput: verifiedCapability.structuredOutput,
        prompt: requestPrompt, images, schemaName, jsonSchema: schemaDocument, signal,
      })
      if (!response.ok) throw transportFailure(response, verifiedCapability.structuredOutput)
      return { output: response.output, status: response.status }
    }

    return requestStructuredOutput(() => send(prompt), schema, {
      businessRetries: 2,
      mode: verifiedCapability.structuredOutput,
      repair: async (invalidOutput, error) => send(
        `Repair this invalid output into the required schema. Return only the repaired result.\n`
        + `Invalid paths: ${error.schemaPaths.join(', ') || '<json>'}\n`
        + `Invalid output:\n${invalidOutput}`,
      ),
    })
  }
}
