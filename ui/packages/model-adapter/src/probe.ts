import { z } from 'zod'
import type {
  ModelCapabilityProfile,
  ModelImage,
  ModelTransport,
  StructuredOutputMode,
} from './types.js'
import { parseStructuredOutput } from './structured-output.js'

const MODES: readonly StructuredOutputMode[] = [
  'json-schema',
  'tools',
  'json-mode',
  'prompt-json',
]
const ProbeSchema = z.object({ ok: z.literal(true) }).strict()
const PROBE_JSON_SCHEMA = {
  type: 'object',
  properties: { ok: { const: true } },
  required: ['ok'],
  additionalProperties: false,
}

export async function probeCapabilities(
  transport: ModelTransport,
  referenceImage: ModelImage,
): Promise<ModelCapabilityProfile> {
  for (const structuredOutput of MODES) {
    const response = await transport.send({
      structuredOutput,
      prompt: 'Inspect this image and return exactly {"ok":true}.',
      images: [referenceImage],
      schemaName: 'capability_probe',
      jsonSchema: PROBE_JSON_SCHEMA,
    })
    if (!response.ok) continue
    try {
      parseStructuredOutput(response.output, ProbeSchema)
      return {
        vision: true,
        structuredOutput,
        maxVerifiedImage: { width: referenceImage.width, height: referenceImage.height },
      }
    } catch {
      // A successful HTTP response without the expected image-grounded contract is unsupported.
    }
  }
  throw new Error(
    `Model lacks vision/structured output for ${referenceImage.width}x${referenceImage.height}; `
    + 'use tiling or lower the expected fidelity.',
  )
}
