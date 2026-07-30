import { z } from 'zod'
import type {
  ModelCapabilityProfile,
  ModelImage,
  ModelTransport,
  StructuredOutputMode,
  TransportResponse,
} from './types.js'
import { parseStructuredOutput, StructuredOutputError } from './structured-output.js'

const MODES: readonly StructuredOutputMode[] = ['json-schema', 'tools', 'json-mode', 'prompt-json']
const ColorSchema = z.object({ color: z.enum(['red', 'blue']) }).strict()
const COLOR_SCHEMA = {
  type: 'object', properties: { color: { enum: ['red', 'blue'] } },
  required: ['color'], additionalProperties: false,
}
const COLOR_IMAGES = {
  red: {
    mediaType: 'image/png',
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACvElEQVR4nO3TMQEAIAzAsIF/zyBjRxMFfXreQNfdDoBNBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gzAlH1ZHwL/ugAMcQAAAABJRU5ErkJggg==',
    width: 256, height: 256,
  },
  blue: {
    mediaType: 'image/png',
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACvUlEQVR4nO3TMQEAIAzAsIF/zyBjRxMFfXpm3kDV3Q6ATQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMwJR9VyEC/zrgCsUAAAAASUVORK5CYII=',
    width: 256, height: 256,
  },
} as const satisfies Record<'red' | 'blue', ModelImage>

const VISION_PROBE_PROMPT = `Inspect the attached image itself. Identify its dominant visible color.
Return exactly one JSON object matching {"color":"red"|"blue"}.
Do not return Markdown, prose, explanations, or extra fields.
Do not infer the answer from this instruction; determine it only from the attached image.`

function transportError(response: Extract<TransportResponse, { ok: false }>, mode: StructuredOutputMode) {
  return new StructuredOutputError(response.message, {
    mode, status: response.status, kind: response.kind,
  })
}

function modeUnsupported(response: Extract<TransportResponse, { ok: false }>): boolean {
  return response.kind === 'http' && (response.status === 400 || response.status === 422)
}

export interface ProbeOptions {
  challengeColor?: 'red' | 'blue'
}

export async function probeCapabilities(
  transport: ModelTransport,
  referenceImage: ModelImage,
  signal?: AbortSignal,
  options: ProbeOptions = {},
): Promise<ModelCapabilityProfile> {
  const expectedColor = options.challengeColor ?? (Math.random() < 0.5 ? 'red' : 'blue')
  let selected: StructuredOutputMode | null = null
  let referenceDimensionsVerified = false
  const diagnostics: string[] = []
  for (const structuredOutput of MODES) {
    const response = await transport.send({
      structuredOutput,
      prompt: VISION_PROBE_PROMPT,
      images: [COLOR_IMAGES[expectedColor]], schemaName: 'vision_probe',
      jsonSchema: COLOR_SCHEMA, signal,
    })
    if (!response.ok) {
      if (modeUnsupported(response)) {
        diagnostics.push(`${structuredOutput}: HTTP ${response.status} ${response.message}`)
        continue
      }
      throw transportError(response, structuredOutput)
    }
    try {
      const result = parseStructuredOutput(response.output, ColorSchema)
      if (result.color === expectedColor) {
        selected = structuredOutput
        break
      }
      diagnostics.push(`${structuredOutput}: ${JSON.stringify(result)}`)
    } catch (error) {
      diagnostics.push(`${structuredOutput}: ${error instanceof Error ? error.message : String(error)}; output=${response.output.slice(0, 300)}`)
    }
  }
  if (selected === null && diagnostics.length === MODES.length
    && diagnostics.every(item => /HTTP (400|422)/.test(item))) {
    const fallbackSchema = {
      type: 'object',
      properties: {
        width: { type: 'integer', minimum: 1 },
        height: { type: 'integer', minimum: 1 },
      },
      required: ['width', 'height'], additionalProperties: false,
    }
    const FallbackDimensionsSchema = z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).strict()
    for (const structuredOutput of MODES) {
      const response = await transport.send({
        structuredOutput,
        prompt: 'Inspect the attached image itself and return exactly one JSON object containing its original pixel width and height. Return no Markdown, prose, or extra fields.',
        images: [referenceImage], schemaName: 'image_size_probe',
        jsonSchema: fallbackSchema, signal,
      })
      if (!response.ok) {
        if (modeUnsupported(response)) continue
        throw transportError(response, structuredOutput)
      }
      try {
        const dimensions = parseStructuredOutput(response.output, FallbackDimensionsSchema)
        if (dimensions.width === referenceImage.width && dimensions.height === referenceImage.height) {
          selected = structuredOutput
          referenceDimensionsVerified = true
          break
        }
      } catch { /* try next mode */ }
    }
  }
  if (selected === null) throw new Error(`Model lacks image-grounded structured output capability. ${diagnostics.join('; ')}`)

  const DimensionsSchema = z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict()
  if (!referenceDimensionsVerified) {
    const sizeResponse = await transport.send({
      structuredOutput: selected,
      prompt: 'Inspect the image and return its original pixel width and height.',
      images: [referenceImage], schemaName: 'image_size_probe',
      jsonSchema: {
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 1 },
          height: { type: 'integer', minimum: 1 },
        },
        required: ['width', 'height'], additionalProperties: false,
      },
      signal,
    })
    if (!sizeResponse.ok) {
      if (modeUnsupported(sizeResponse)
        || (sizeResponse.kind === 'http' && sizeResponse.status === 413)) {
        throw new Error(
          `Model rejected ${referenceImage.width}x${referenceImage.height}; use tiling or lower fidelity.`,
        )
      }
      throw transportError(sizeResponse, selected)
    }
    const dimensions = parseStructuredOutput(sizeResponse.output, DimensionsSchema)
    if (dimensions.width !== referenceImage.width || dimensions.height !== referenceImage.height) {
      throw new Error(
        `Model did not verify ${referenceImage.width}x${referenceImage.height}; use tiling or lower fidelity.`,
      )
    }
  }
  return {
    vision: true,
    structuredOutput: selected,
    maxVerifiedImage: { width: referenceImage.width, height: referenceImage.height },
  }
}
