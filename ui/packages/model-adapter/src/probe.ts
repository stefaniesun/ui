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
const ColorSchema = z.object({ color: z.literal('red') }).strict()
const COLOR_SCHEMA = {
  type: 'object', properties: { color: { const: 'red' } },
  required: ['color'], additionalProperties: false,
}
// A known 1×1 red PNG makes the probe depend on actual image inspection.
const RED_PIXEL: ModelImage = {
  mediaType: 'image/png',
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zx8sAAAAASUVORK5CYII=',
  width: 1,
  height: 1,
}

function transportError(response: Extract<TransportResponse, { ok: false }>, mode: StructuredOutputMode) {
  return new StructuredOutputError(response.message, {
    mode, status: response.status, kind: response.kind,
  })
}

export async function probeCapabilities(
  transport: ModelTransport,
  referenceImage: ModelImage,
  signal?: AbortSignal,
): Promise<ModelCapabilityProfile> {
  let selected: StructuredOutputMode | null = null
  for (const structuredOutput of MODES) {
    const response = await transport.send({
      structuredOutput,
      prompt: 'Inspect the image pixel and return its color.',
      images: [RED_PIXEL], schemaName: 'vision_probe', jsonSchema: COLOR_SCHEMA, signal,
    })
    if (!response.ok) {
      if (['cancelled', 'timeout', 'network'].includes(response.kind)) {
        throw transportError(response, structuredOutput)
      }
      if (response.kind === 'http' && response.status !== null && response.status < 500) continue
      throw transportError(response, structuredOutput)
    }
    try {
      parseStructuredOutput(response.output, ColorSchema)
      selected = structuredOutput
      break
    } catch {
      continue
    }
  }
  if (selected === null) throw new Error('Model lacks image-grounded structured output capability')

  const sizeResponse = await transport.send({
    structuredOutput: selected,
    prompt: 'Confirm that this reference image is readable by returning {"readable":true}.',
    images: [referenceImage], schemaName: 'image_size_probe',
    jsonSchema: {
      type: 'object', properties: { readable: { const: true } },
      required: ['readable'], additionalProperties: false,
    },
    signal,
  })
  if (!sizeResponse.ok) throw transportError(sizeResponse, selected)
  const readable = z.object({ readable: z.literal(true) }).strict()
  try {
    parseStructuredOutput(sizeResponse.output, readable)
  } catch {
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
