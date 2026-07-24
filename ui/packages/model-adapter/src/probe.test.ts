import { describe, expect, it } from 'vitest'
import { probeCapabilities } from './probe.js'
import type { ModelTransport, TransportRequest } from './types.js'

function createFakeTransport(
  statuses: Partial<Record<string, number>>,
): ModelTransport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = []
  return {
    calls,
    async send(request) {
      calls.push(request)
      const status = statuses[request.structuredOutput] ?? 400
      return {
        status,
        body: status < 300 ? { choices: [{ message: { content: '{"ok":true}' } }] } : {},
      }
    },
  }
}

describe('probeCapabilities', () => {
  it('falls back from json schema to tool calls and records the mode', async () => {
    const transport = createFakeTransport({ 'json-schema': 400, tools: 200 })
    const profile = await probeCapabilities(transport)
    expect(profile.structuredOutput).toBe('tools')
    expect(profile.vision).toBe(true)
    expect(transport.calls.map(call => call.structuredOutput)).toEqual(['json-schema', 'tools'])
  })

  it('returns prompt JSON as the final supported mode', async () => {
    const transport = createFakeTransport({ 'prompt-json': 200 })
    expect((await probeCapabilities(transport)).structuredOutput).toBe('prompt-json')
  })

  it('fails when image input is unsupported in every mode', async () => {
    const transport = createFakeTransport({})
    await expect(probeCapabilities(transport)).rejects.toThrow(/vision.*structured output/i)
  })
})
