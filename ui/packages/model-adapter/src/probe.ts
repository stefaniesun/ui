import type {
  ModelCapabilityProfile,
  ModelTransport,
  StructuredOutputMode,
} from './types.js'

const PROBE_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const MODES: readonly StructuredOutputMode[] = [
  'json-schema',
  'tools',
  'json-mode',
  'prompt-json',
]

export async function probeCapabilities(
  transport: ModelTransport,
): Promise<ModelCapabilityProfile> {
  for (const structuredOutput of MODES) {
    const response = await transport.send({
      structuredOutput,
      image: { mediaType: 'image/png', base64: PROBE_IMAGE_BASE64 },
    })
    if (response.status >= 200 && response.status < 300) {
      return { vision: true, structuredOutput }
    }
  }
  throw new Error('Model does not support vision with any structured output mode')
}
