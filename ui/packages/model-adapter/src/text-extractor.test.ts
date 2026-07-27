import {
  TEXT_EXTRACTION_PROMPT_VERSION,
  type TextItem,
} from '@ui-rebuild/contracts'
import { describe, expect, it } from 'vitest'
import { OpenAICompatibleModelAdapter } from './adapter.js'
import { ModelTextExtractor } from './text-extractor.js'
import type { ModelTransport, TransportRequest, TransportResponse } from './types.js'

const item: TextItem = {
  text: 'Total',
  bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
  fontSize: null,
  color: '#ffffff',
  confidence: 0.9,
}

function transportFor(finalResponse: TransportResponse): ModelTransport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = []
  let visionProbeCount = 0
  return {
    calls,
    async send(request) {
      calls.push(request)
      if (request.schemaName === 'vision_probe') {
        visionProbeCount += 1
        return {
          ok: true,
          status: 200,
          output: JSON.stringify({ color: visionProbeCount === 1 ? 'red' : 'blue' }),
        }
      }
      if (request.schemaName === 'image_size_probe') {
        return {
          ok: true,
          status: 200,
          output: JSON.stringify({ width: request.images[0]!.width, height: request.images[0]!.height }),
        }
      }
      return finalResponse
    },
  }
}

function extractorFor(transport: ModelTransport) {
  return new ModelTextExtractor({
    adapter: new OpenAICompatibleModelAdapter(transport),
    model: 'gpt-test',
  })
}

describe('ModelTextExtractor', () => {
  it('extracts validated text from one normalized region image', async () => {
    const transport = transportFor({
      ok: true,
      status: 200,
      output: JSON.stringify({ items: [item] }),
    })
    const extractor = extractorFor(transport)

    await expect(extractor.extract({
      regionId: 'summary',
      image: Buffer.from('png'),
      width: 30,
      height: 20,
    })).resolves.toEqual([item])

    const request = transport.calls.at(-1)!
    expect(request.schemaName).toBe('text_items')
    expect(request.images).toHaveLength(1)
    expect(request.images[0]).toEqual({
      mediaType: 'image/png', base64: Buffer.from('png').toString('base64'), width: 30, height: 20,
    })
    expect(request.prompt).toContain('summary')
    expect(request.prompt).toContain(TEXT_EXTRACTION_PROMPT_VERSION)
    expect(request.prompt).toContain('visibly present')
    expect(request.prompt).toContain('Do not infer')
    expect(request.prompt).toContain('normalized to this cropped image')
    expect(request.prompt).toContain('punctuation')
    expect(request.prompt).toContain('currency symbols')
    expect(request.prompt).toContain('numeric formatting')
    expect(request.prompt).toContain('null')
    expect(request.prompt).toContain('confidence in [0, 1]')
    expect(extractor.identity).toEqual({
      provider: 'model', model: 'gpt-test', schemaVersion: '1.0.0', promptVersion: '1.0.0',
    })
  })

  it.each([
    { ...item, fontSize: undefined },
    { ...item, color: undefined },
    { ...item, confidence: 1.1 },
    { ...item, bounds: { x: 0.9, y: 0, width: 0.2, height: 1 } },
    { ...item, bounds: { x: 0, y: 0, width: -0.2, height: 1 } },
  ])('rejects invalid structured text %#', async invalidItem => {
    const transport = transportFor({
      ok: true,
      status: 200,
      output: JSON.stringify({ items: [invalidItem] }),
    })
    await expect(extractorFor(transport).extract({
      regionId: 'summary', image: Buffer.from('png'), width: 30, height: 20,
    })).rejects.toMatchObject({ kind: 'format' })
  })

  it('rejects non-JSON structured output', async () => {
    const transport = transportFor({ ok: true, status: 200, output: 'not-json' })
    await expect(extractorFor(transport).extract({
      regionId: 'summary', image: Buffer.from('png'), width: 30, height: 20,
    })).rejects.toMatchObject({ kind: 'format' })
  })

  it.each(['protocol', 'timeout'] as const)('preserves %s transport errors without leaking secrets', async kind => {
    const secret = 'api-key-secret'
    const transport = transportFor({
      ok: false,
      status: null,
      kind,
      message: `${kind} request failed; Authorization: Bearer ${secret}`,
    })
    let failure: unknown
    try {
      await extractorFor(transport).extract({
        regionId: 'summary', image: Buffer.from('png'), width: 30, height: 20,
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ kind })
    expect(String(failure)).not.toContain(secret)
    expect(JSON.stringify(failure)).not.toContain('authorization')
  })
})
