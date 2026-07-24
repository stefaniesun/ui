import { describe, expect, it } from 'vitest'
import { probeCapabilities } from './probe.js'
import type { ModelImage, ModelTransport, TransportRequest } from './types.js'

const referenceImage: ModelImage = {
  mediaType: 'image/png',
  base64: 'probe-image',
  width: 396,
  height: 842,
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
      return status < 300
        ? { ok: true, status, output: '{"ok":true}' }
        : { ok: false, status, kind: 'http', message: 'unsupported' }
    },
  }
}

describe('probeCapabilities', () => {
  it('falls back from json schema to tool calls and records the mode', async () => {
    const transport = createFakeTransport({ 'json-schema': 400, tools: 200 })
    const profile = await probeCapabilities(transport, referenceImage)
    expect(profile).toEqual({
      vision: true,
      structuredOutput: 'tools',
      maxVerifiedImage: { width: 396, height: 842 },
    })
    expect(transport.calls.map(call => call.structuredOutput)).toEqual(['json-schema', 'tools'])
    expect(transport.calls[0]?.images[0]).toEqual(referenceImage)
  })

  it('rejects HTTP success without valid structured content', async () => {
    const transport = createFakeTransport({ 'json-schema': 200 })
    transport.send = async request => {
      transport.calls.push(request)
      return { ok: true, status: 200, output: 'not-json' }
    }
    await expect(probeCapabilities(transport, referenceImage)).rejects.toThrow(/396x842/i)
  })

  it('fails when the reference image is unsupported in every mode', async () => {
    const transport = createFakeTransport({})
    await expect(probeCapabilities(transport, referenceImage)).rejects.toThrow(/tiling/i)
  })
})
