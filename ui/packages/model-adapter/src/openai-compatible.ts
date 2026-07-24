import type { z } from 'zod'
import { parseStructuredOutput, StructuredOutputError } from './structured-output.js'
import type {
  ModelTransport,
  StructuredOutputMode,
  TransportRequest,
  TransportResponse,
} from './types.js'

export interface OpenAICompatibleOptions {
  baseUrl: string
  apiKey?: string
  model: string
  fetch?: typeof globalThis.fetch
  trustedHosts?: string[]
  timeoutMs?: number
}

function assertTrustedEndpoint(baseUrl: string, trustedHosts: readonly string[]): URL {
  const url = new URL(baseUrl)
  const trusted = new Set(['127.0.0.1', 'localhost', '::1', ...trustedHosts])
  if (!['http:', 'https:'].includes(url.protocol) || !trusted.has(url.hostname)) {
    throw new Error(`Model endpoint is not trusted: ${url.origin}`)
  }
  return url
}

function responseFormat(mode: StructuredOutputMode): Record<string, unknown> | undefined {
  if (mode === 'json-schema') {
    return { type: 'json_schema', json_schema: { name: 'probe', strict: true, schema: { type: 'object' } } }
  }
  if (mode === 'json-mode') return { type: 'json_object' }
  return undefined
}

function tools(mode: StructuredOutputMode): Record<string, unknown>[] | undefined {
  if (mode !== 'tools') return undefined
  return [{
    type: 'function',
    function: {
      name: 'return_result',
      parameters: { type: 'object', additionalProperties: true },
    },
  }]
}

export class OpenAICompatibleTransport implements ModelTransport {
  private readonly endpoint: URL
  private readonly fetch: typeof globalThis.fetch
  private readonly apiKey?: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(options: OpenAICompatibleOptions) {
    this.endpoint = assertTrustedEndpoint(options.baseUrl, options.trustedHosts ?? [])
    this.fetch = options.fetch ?? globalThis.fetch
    this.apiKey = options.apiKey
    this.model = options.model
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    const endpoint = new URL('chat/completions', `${this.endpoint.toString().replace(/\/?$/, '/')}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Return {"ok":true} using the requested structure.' },
              { type: 'image_url', image_url: { url: `data:${request.image.mediaType};base64,${request.image.base64}` } },
            ],
          }],
          response_format: responseFormat(request.structuredOutput),
          tools: tools(request.structuredOutput),
        }),
        signal: request.signal ?? controller.signal,
      })
      if (!response.ok) return { status: response.status, body: { error: 'model request failed' } }
      return { status: response.status, body: await response.json() }
    } catch (error) {
      return {
        status: 0,
        body: { error: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network error' },
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export interface StructuredRequestOptions {
  businessRetries?: number
}

export async function requestStructuredOutput<T>(
  request: () => Promise<string>,
  schema: z.ZodType<T>,
  options: StructuredRequestOptions = {},
): Promise<T> {
  const attempts = (options.businessRetries ?? 2) + 1
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return parseStructuredOutput(await request(), schema)
    } catch (error) {
      lastError = error
    }
  }
  throw new StructuredOutputError(`Structured output failed after ${attempts} attempts`, lastError)
}
