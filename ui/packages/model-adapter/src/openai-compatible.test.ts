import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { OpenAICompatibleTransport, requestStructuredOutput } from './openai-compatible.js'

const schema = z.object({ ok: z.literal(true) }).strict()

describe('OpenAICompatibleTransport', () => {
  it('rejects untrusted remote endpoints by default', () => {
    expect(() => new OpenAICompatibleTransport({
      baseUrl: 'https://example.com/v1',
      model: 'vision',
      fetch: vi.fn(),
    })).toThrow(/trusted/i)
  })

  it('redacts secrets and image data from errors', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('server leaked sk-secret and base64data', {
      status: 500,
    }))
    const transport = new OpenAICompatibleTransport({
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiKey: 'sk-secret',
      model: 'vision',
      fetch,
    })
    await expect(transport.send({
      structuredOutput: 'json-mode',
      image: { mediaType: 'image/png', base64: 'base64data' },
    })).resolves.toMatchObject({ status: 500 })
    expect(JSON.stringify((await transport.send({
      structuredOutput: 'json-mode',
      image: { mediaType: 'image/png', base64: 'base64data' },
    })).body)).not.toMatch(/sk-secret|base64data/)
  })
})

describe('requestStructuredOutput', () => {
  it('retries invalid output and never returns partial data', async () => {
    const responses = ['broken', '{"ok":true}']
    const result = await requestStructuredOutput(async () => responses.shift()!, schema, {
      businessRetries: 2,
    })
    expect(result).toEqual({ ok: true })
  })
})
