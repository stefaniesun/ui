import { PatchPlanSchema, VisualIRSchema } from '@ui-rebuild/contracts'
import type { PatchPlan, VisualIR } from '@ui-rebuild/contracts'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requestStructuredOutput } from './openai-compatible.js'
import { probeCapabilities } from './probe.js'
import { StructuredOutputError } from './structured-output.js'
import type {
  AnalyzeScreensInput, DiagnoseDiffInput, ModelAdapter, ModelCapabilityProfile,
  ModelImage, ModelReview, ModelTransport, ReviewResultInput, TransportResponse,
} from './types.js'

const ModelReviewSchema = z.object({ summary: z.string(), unresolved: z.array(z.string()) }).strict()

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
  private probePromise: Promise<ModelCapabilityProfile> | null = null

  constructor(private readonly transport: ModelTransport) {}

  async probe(referenceImage: ModelImage, signal?: AbortSignal): Promise<ModelCapabilityProfile> {
    if (this.capability
      && referenceImage.width <= this.capability.maxVerifiedImage.width
      && referenceImage.height <= this.capability.maxVerifiedImage.height) return this.capability
    this.probePromise ??= probeCapabilities(this.transport, referenceImage, signal)
      .then(profile => (this.capability = profile))
      .finally(() => { this.probePromise = null })
    return this.probePromise
  }

  async analyzeScreens(input: AnalyzeScreensInput): Promise<VisualIR> {
    return this.request('visual_ir', input.prompt, input.screenshots, VisualIRSchema, input.signal)
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
    const largest = images.reduce((result, image) => (
      image.width * image.height > result.width * result.height ? image : result
    ))
    const capability = await this.probe(largest, signal)
    const schemaDocument = jsonSchema(schema, schemaName)
    const send = async (requestPrompt: string) => {
      const response = await this.transport.send({
        structuredOutput: capability.structuredOutput,
        prompt: requestPrompt, images, schemaName, jsonSchema: schemaDocument, signal,
      })
      if (!response.ok) throw transportFailure(response, capability.structuredOutput)
      return response.output
    }

    return requestStructuredOutput(() => send(prompt), schema, {
      businessRetries: 2,
      mode: capability.structuredOutput,
      repair: async (invalidOutput, error) => send(
        `Repair this invalid output into the required schema. Return only the repaired result.\n`
        + `Invalid paths: ${error.schemaPaths.join(', ') || '<json>'}\n`
        + `Invalid output:\n${invalidOutput}`,
      ),
    })
  }
}
