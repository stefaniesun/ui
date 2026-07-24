import {
  PatchPlanSchema,
  VisualIRSchema,
} from '@ui-rebuild/contracts'
import type { PatchPlan, VisualIR } from '@ui-rebuild/contracts'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requestStructuredOutput } from './openai-compatible.js'
import { probeCapabilities } from './probe.js'
import { StructuredOutputError } from './structured-output.js'
import type {
  AnalyzeScreensInput,
  DiagnoseDiffInput,
  ModelAdapter,
  ModelCapabilityProfile,
  ModelImage,
  ModelReview,
  ModelTransport,
  ReviewResultInput,
} from './types.js'

const ModelReviewSchema = z.object({
  summary: z.string(),
  unresolved: z.array(z.string()),
}).strict()

function jsonSchema(schema: z.ZodTypeAny, name: string): Record<string, unknown> {
  return zodToJsonSchema(schema, { name, $refStrategy: 'none' }) as Record<string, unknown>
}

export class OpenAICompatibleModelAdapter implements ModelAdapter {
  private capability: ModelCapabilityProfile | null = null

  constructor(private readonly transport: ModelTransport) {}

  async probe(referenceImage: ModelImage): Promise<ModelCapabilityProfile> {
    this.capability = await probeCapabilities(this.transport, referenceImage)
    return this.capability
  }

  async analyzeScreens(input: AnalyzeScreensInput): Promise<VisualIR> {
    return this.request<VisualIR>('visual_ir', input.prompt, input.screenshots, VisualIRSchema)
  }

  async diagnoseDiff(input: DiagnoseDiffInput): Promise<PatchPlan> {
    return this.request<PatchPlan>('patch_plan', input.prompt, input.images, PatchPlanSchema)
  }

  async reviewResult(input: ReviewResultInput): Promise<ModelReview> {
    return this.request('model_review', input.prompt, input.images, ModelReviewSchema)
  }

  private async request<T>(
    schemaName: string,
    prompt: string,
    images: ModelImage[],
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<T> {
    const capability = this.capability ?? await this.probe(images[0]!)
    for (const image of images) {
      if (image.width > capability.maxVerifiedImage.width
        || image.height > capability.maxVerifiedImage.height) {
        throw new Error(
          `Image ${image.width}x${image.height} exceeds verified model input `
          + `${capability.maxVerifiedImage.width}x${capability.maxVerifiedImage.height}; use tiling.`,
        )
      }
    }
    let repairInstruction = ''
    return requestStructuredOutput(async () => {
      const response = await this.transport.send({
        structuredOutput: capability.structuredOutput,
        prompt: `${prompt}${repairInstruction}`,
        images,
        schemaName,
        jsonSchema: jsonSchema(schema, schemaName),
      })
      if (!response.ok) {
        throw new StructuredOutputError(response.message, {
          mode: capability.structuredOutput,
          status: response.status,
        })
      }
      return response.output
    }, schema, {
      businessRetries: 2,
      mode: capability.structuredOutput,
      repair: async error => {
        repairInstruction = `\nRepair the previous output. Invalid schema paths: ${error.schemaPaths.join(', ') || '<json>'}.`
      },
    })
  }
}
