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
      if (status >= 300) return { ok: false, status, kind: 'http', message: `HTTP ${status}` }
      return {
        ok: true, status,
        output: request.schemaName === 'vision_probe'
          ? '{"color":"blue"}'
          : `{"width":${request.images[0]!.width},"height":${request.images[0]!.height}}`,
      }
    },
  }
}

describe('probeCapabilities', () => {
  it('uses a non-leaking color challenge, falls back, then verifies exact dimensions', async () => {
    const transport = createFakeTransport({ 'json-schema': 400, tools: 200 })
    const profile = await probeCapabilities(transport, referenceImage, undefined, {
      challengeColor: 'blue',
    })
    expect(profile).toEqual({
      vision: true, structuredOutput: 'tools', maxVerifiedImage: { width: 396, height: 842 },
    })
    expect(transport.calls.map(call => call.structuredOutput)).toEqual(['json-schema', 'tools', 'tools'])
    expect(JSON.stringify(transport.calls[1]?.jsonSchema)).not.toContain('"const":"blue"')
    expect(transport.calls[1]?.images[0]).toMatchObject({ width: 256, height: 256 })
    expect(transport.calls[1]?.prompt).toContain('Return exactly one JSON object')
    expect(transport.calls[1]?.prompt).toContain('Do not infer the answer from this instruction')
    expect(transport.calls[2]?.images[0]).toEqual(referenceImage)
  })

  it('falls back to the real reference image when a gateway rejects synthetic probes', async () => {
    const calls: TransportRequest[] = []
    const transport: ModelTransport = {
      calls,
      async send(request) {
        calls.push(request)
        if (request.images[0] !== referenceImage) {
          return { ok: false, status: 400, kind: 'http', message: 'invalid image' }
        }
        return { ok: true, status: 200, output: '{"width":396,"height":842}' }
      },
    }
    await expect(probeCapabilities(transport, referenceImage, undefined, {
      challengeColor: 'blue',
    })).resolves.toMatchObject({ vision: true, structuredOutput: 'json-schema' })
    expect(calls.filter(call => call.images[0] === referenceImage)).toHaveLength(1)
  })

  it('falls back for mixed HTTP 400 and 422 synthetic image rejections', async () => {
    const calls: TransportRequest[] = []
    const transport: ModelTransport = {
      calls,
      async send(request) {
        calls.push(request)
        if (request.images[0] === referenceImage) {
          return { ok: true, status: 200, output: '{"width":396,"height":842}' }
        }
        const status = request.structuredOutput === 'json-schema' ? 400 : 422
        return { ok: false, status, kind: 'http', message: 'invalid image' }
      },
    }
    await expect(probeCapabilities(transport, referenceImage, undefined, {
      challengeColor: 'blue',
    })).resolves.toMatchObject({ vision: true, structuredOutput: 'json-schema' })
  })

  it('rejects a model whose answer does not match the image challenge', async () => {
    const transport = createFakeTransport({ 'json-schema': 200 })
    await expect(probeCapabilities(transport, referenceImage, undefined, {
      challengeColor: 'red',
    })).rejects.toThrow(/json-schema.*\{"color":"blue"\}/i)
  })

  it('rejects incorrect reported dimensions with actionable tiling guidance', async () => {
    const transport = createFakeTransport({ tools: 200 })
    transport.send = async request => {
      transport.calls.push(request)
      return request.schemaName === 'vision_probe'
        ? { ok: true, status: 200, output: '{"color":"blue"}' }
        : { ok: true, status: 200, output: '{"width":1,"height":1}' }
    }
    await expect(probeCapabilities(transport, referenceImage, undefined, {
      challengeColor: 'blue',
    })).rejects.toThrow(/tiling/i)
  })

  it('turns HTTP 413 during size verification into tiling guidance', async () => {
    const transport = createFakeTransport({ tools: 200 })
    transport.send = async request => {
      transport.calls.push(request)
      return request.schemaName === 'vision_probe'
        ? { ok: true, status: 200, output: '{"color":"blue"}' }
        : { ok: false, status: 413, kind: 'http', message: 'payload too large' }
    }
    await expect(probeCapabilities(transport, referenceImage, undefined, {
      challengeColor: 'blue',
    })).rejects.toThrow(/tiling/i)
  })

  it.each([401, 403, 404, 408, 429, 500])(
    'does not misreport HTTP %s as an unsupported structured mode',
    async status => {
      const transport = createFakeTransport({ 'json-schema': status })
      await expect(probeCapabilities(transport, referenceImage, undefined, {
        challengeColor: 'blue',
      })).rejects.toMatchObject({ kind: 'http', status })
      expect(transport.calls).toHaveLength(1)
    },
  )

  it('does not turn cancellation into unsupported modes', async () => {
    const transport = createFakeTransport({})
    transport.send = async () => ({
      ok: false, status: null, kind: 'cancelled', message: 'request cancelled',
    })
    await expect(probeCapabilities(transport, referenceImage)).rejects
      .toMatchObject({ kind: 'cancelled', attempts: 1 })
  })
})
