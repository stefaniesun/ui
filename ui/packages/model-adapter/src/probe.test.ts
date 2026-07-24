import { describe, expect, it } from 'vitest'
import { probeCapabilities } from './probe.js'
import type { ModelImage, ModelTransport, TransportRequest } from './types.js'

const referenceImage: ModelImage = {
  mediaType: 'image/png', base64: 'reference', width: 396, height: 842,
}

function createFakeTransport(
  statuses: Partial<Record<string, number>>,
): ModelTransport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = []
  return {
    calls,
    async send(request) {
      calls.push(request)
      const status = statuses[request.structuredOutput] ?? 400
      if (status >= 300) return { ok: false, status, kind: 'http', message: 'unsupported' }
      return {
        ok: true,
        status,
        output: request.schemaName === 'vision_probe'
          ? '{"color":"red"}'
          : '{"readable":true}',
      }
    },
  }
}

describe('probeCapabilities', () => {
  it('uses an image-grounded pixel probe, falls back, then verifies reference size', async () => {
    const transport = createFakeTransport({ 'json-schema': 400, tools: 200 })
    const profile = await probeCapabilities(transport, referenceImage)
    expect(profile).toEqual({
      vision: true, structuredOutput: 'tools', maxVerifiedImage: { width: 396, height: 842 },
    })
    expect(transport.calls.map(call => call.structuredOutput)).toEqual(['json-schema', 'tools', 'tools'])
    expect(transport.calls[1]?.images[0]).toMatchObject({ width: 1, height: 1 })
    expect(transport.calls[2]?.images[0]).toEqual(referenceImage)
  })

  it('rejects a model that ignores the image content', async () => {
    const transport = createFakeTransport({ 'json-schema': 200 })
    transport.send = async request => {
      transport.calls.push(request)
      return { ok: true, status: 200, output: '{"ok":true}' }
    }
    await expect(probeCapabilities(transport, referenceImage)).rejects
      .toThrow(/image-grounded/i)
  })

  it('does not turn cancellation or network errors into unsupported modes', async () => {
    const transport = createFakeTransport({})
    transport.send = async () => ({
      ok: false, status: null, kind: 'cancelled', message: 'request cancelled',
    })
    await expect(probeCapabilities(transport, referenceImage)).rejects
      .toMatchObject({ kind: 'cancelled', attempts: 1 })
  })
})
