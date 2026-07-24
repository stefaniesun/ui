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
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAC0lEQVR42mP8/x8AAusB9Wl2F/0AAAAASUVORK5CYII=',
    width: 1, height: 1,
  },
  blue: {
    mediaType: 'image/png',
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAC0lEQVR42mNk+M8AAAICAQB7CY2QAAAAAElFTkSuQmCC',
    width: 1, height: 1,
  },
} as const satisfies Record<'red' | 'blue', ModelImage>

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
  for (const structuredOutput of MODES) {
    const response = await transport.send({
      structuredOutput,
      prompt: 'Inspect the single image pixel and return its dominant color as red or blue.',
      images: [COLOR_IMAGES[expectedColor]], schemaName: 'vision_probe',
      jsonSchema: COLOR_SCHEMA, signal,
    })
    if (!response.ok) {
      if (modeUnsupported(response)) continue
      throw transportError(response, structuredOutput)
    }
    try {
      const result = parseStructuredOutput(response.output, ColorSchema)
      if (result.color === expectedColor) {
        selected = structuredOutput
        break
      }
    } catch {
      // Invalid content means this structured mode is unsupported.
    }
  }
  if (selected === null) throw new Error('Model lacks image-grounded structured output capability')

  const DimensionsSchema = z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).strict()
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
    if (modeUnsupported(sizeResponse)) {
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
  return {
    vision: true,
    structuredOutput: selected,
    maxVerifiedImage: { width: referenceImage.width, height: referenceImage.height },
  }
}
