import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { OpenAICompatibleTransport, requestStructuredOutput } from './openai-compatible.js'
import { StructuredOutputError } from './structured-output.js'
import type { TransportRequest } from './types.js'

const schema = z.object({ ok: z.literal(true) }).strict()
const request: TransportRequest = {
  structuredOutput: 'json-mode',
  prompt: 'return JSON',
  images: [{ mediaType: 'image/png', base64: 'base64data', width: 1, height: 1 }],
  schemaName: 'test',
  jsonSchema: { type: 'object' },
}

describe('OpenAICompatibleTransport', () => {
  it('rejects remote endpoints unless their origin is explicitly trusted', () => {
    expect(() => new OpenAICompatibleTransport({
      baseUrl: 'https://example.com/v1',
      model: 'vision',
      fetch: vi.fn(),
    })).toThrow(/trusted/i)
    expect(() => new OpenAICompatibleTransport({
      baseUrl: 'https://example.com/v1',
      trustedRemoteOrigins: ['https://example.com'],
      model: 'vision',
      fetch: vi.fn(),
    })).not.toThrow()
  })

  it('extracts message content and tool arguments', async () => {
    const contentTransport = new OpenAICompatibleTransport({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'vision',
      fetch: vi.fn().mockResolvedValue(Response.json({
        choices: [{ message: { content: '{"ok":true}' } }],
      })),
    })
    await expect(contentTransport.send(request)).resolves.toMatchObject({
      ok: true,
      output: '{"ok":true}',
    })

    const toolTransport = new OpenAICompatibleTransport({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'vision',
      fetch: vi.fn().mockResolvedValue(Response.json({
        choices: [{ message: { tool_calls: [{
          function: { name: 'return_result', arguments: '{"ok":true}' },
        }] } }],
      })),
    })
    await expect(toolTransport.send({ ...request, structuredOutput: 'tools' })).resolves
      .toMatchObject({ ok: true, output: '{"ok":true}' })

    const extraToolTransport = new OpenAICompatibleTransport({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'vision',
      fetch: vi.fn().mockResolvedValue(Response.json({
        choices: [{ message: { tool_calls: [
          { function: { name: 'return_result', arguments: '{"ok":true}' } },
          { function: { name: 'other', arguments: '{}' } },
        ] } }],
      })),
    })
    await expect(extraToolTransport.send({ ...request, structuredOutput: 'tools' })).resolves
      .toMatchObject({ ok: false, kind: 'protocol' })
  })

  it('returns redacted protocol errors and distinguishes cancellation', async () => {
    const transport = new OpenAICompatibleTransport({
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiKey: 'sk-secret',
      model: 'vision',
      fetch: vi.fn().mockResolvedValue(new Response('sk-secret base64data', { status: 500 })),
    })
    const failure = await transport.send(request)
    expect(failure).toMatchObject({ ok: false, status: 500, kind: 'http' })
    expect(JSON.stringify(failure)).not.toMatch(/sk-secret|base64data/)

    const controller = new AbortController()
    controller.abort()
    await expect(transport.send({ ...request, signal: controller.signal })).resolves
      .toMatchObject({ ok: false, kind: 'cancelled' })
  })
})

describe('requestStructuredOutput', () => {
  it('retries transient transport failures but not cancellation or fatal client errors', async () => {
    const transient = new StructuredOutputError('temporary', {
      kind: 'http', status: 429, mode: 'json-mode',
    })
    const request = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ output: '{"ok":true}', status: 200 })
    await expect(requestStructuredOutput(request, schema, {
      businessRetries: 2,
      mode: 'json-mode',
    })).resolves.toEqual({ ok: true })
    expect(request).toHaveBeenCalledTimes(2)

    for (const fatal of [
      new StructuredOutputError('cancelled', { kind: 'cancelled', mode: 'json-mode' }),
      new StructuredOutputError('unauthorized', { kind: 'http', status: 401, mode: 'json-mode' }),
    ]) {
      const fatalRequest = vi.fn().mockRejectedValue(fatal)
      await expect(requestStructuredOutput(fatalRequest, schema, {
        businessRetries: 2,
        mode: 'json-mode',
      })).rejects.toBe(fatal)
      expect(fatalRequest).toHaveBeenCalledTimes(1)
    }
  })

  it('uses at most two business retries and one repair request carrying invalid output', async () => {
    const responses = ['broken', '{"ok":false}', '{"ok":true}']
    const repair = vi.fn()
    const result = await requestStructuredOutput(async () => ({
      output: responses.shift()!,
      status: 200,
    }), schema, {
      businessRetries: 2,
      repair: async (invalidOutput, error) => {
        repair(invalidOutput, error)
        return { output: responses.shift()!, status: 200 }
      },
      mode: 'json-mode',
    })
    expect(result).toEqual({ ok: true })
    expect(repair).toHaveBeenCalledTimes(1)
    expect(repair).toHaveBeenCalledWith('broken', expect.any(StructuredOutputError))
  })
})
