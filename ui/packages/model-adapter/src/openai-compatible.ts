import type { z, ZodType } from 'zod'
import type {
  ModelTransport,
  StructuredOutputMode,
  TransportRequest,
  TransportResponse,
} from './types.js'
import { parseStructuredOutput, StructuredOutputError } from './structured-output.js'

export interface OpenAICompatibleOptions {
  baseUrl: string
  apiKey?: string
  model: string
  fetch?: typeof globalThis.fetch
  trustedRemoteOrigins?: string[]
  timeoutMs?: number
}

function endpointUrl(baseUrl: string, trustedRemoteOrigins: readonly string[]): URL {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Model endpoint must use HTTP(S)')
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  const trusted = trustedRemoteOrigins.some(origin => new URL(origin).origin === url.origin)
  if (!local && !trusted) throw new Error(`Model endpoint is not trusted: ${url.origin}`)
  return new URL('chat/completions', `${url.toString().replace(/\/?$/, '/')}`)
}

function structureFields(request: TransportRequest): Record<string, unknown> {
  if (request.structuredOutput === 'json-schema') {
    return {
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema },
      },
    }
  }
  if (request.structuredOutput === 'tools') {
    return {
      tools: [{
        type: 'function',
        function: {
          name: 'return_result',
          description: 'Return the requested structured result.',
          strict: true,
          parameters: request.jsonSchema,
        },
      }],
      tool_choice: { type: 'function', function: { name: 'return_result' } },
    }
  }
  if (request.structuredOutput === 'json-mode') {
    return { response_format: { type: 'json_object' } }
  }
  return {}
}

function extractOutput(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const choices = Reflect.get(body, 'choices')
  if (!Array.isArray(choices) || typeof choices[0] !== 'object' || choices[0] === null) return null
  const message = Reflect.get(choices[0], 'message')
  if (typeof message !== 'object' || message === null) return null
  const toolCalls = Reflect.get(message, 'tool_calls')
  if (Array.isArray(toolCalls) && typeof toolCalls[0] === 'object' && toolCalls[0] !== null) {
    const fn = Reflect.get(toolCalls[0], 'function')
    if (typeof fn === 'object' && fn !== null) {
      const args = Reflect.get(fn, 'arguments')
      if (typeof args === 'string') return args
    }
  }
  const content = Reflect.get(message, 'content')
  return typeof content === 'string' ? content : null
}

export class OpenAICompatibleTransport implements ModelTransport {
  private readonly endpoint: URL
  private readonly fetchImplementation: typeof globalThis.fetch
  private readonly apiKey?: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(options: OpenAICompatibleOptions) {
    this.endpoint = endpointUrl(options.baseUrl, options.trustedRemoteOrigins ?? [])
    this.fetchImplementation = options.fetch ?? globalThis.fetch
    this.apiKey = options.apiKey
    this.model = options.model
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    if (request.signal?.aborted) {
      return { ok: false, status: null, kind: 'cancelled', message: 'request cancelled' }
    }
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort(request.signal?.reason)
    request.signal?.addEventListener('abort', onExternalAbort, { once: true })
    const timeout = setTimeout(() => controller.abort('timeout'), this.timeoutMs)
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: request.prompt },
              ...request.images.map(image => ({
                type: 'image_url',
                image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
              })),
            ],
          }],
          ...structureFields(request),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        return { ok: false, status: response.status, kind: 'http', message: 'model request failed' }
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return { ok: false, status: response.status, kind: 'protocol', message: 'invalid JSON response' }
      }
      const output = extractOutput(body)
      if (output === null) {
        return { ok: false, status: response.status, kind: 'protocol', message: 'missing model output' }
      }
      return { ok: true, status: response.status, output }
    } catch {
      const cancelled = request.signal?.aborted === true
      const timedOut = controller.signal.reason === 'timeout'
      return {
        ok: false,
        status: null,
        kind: cancelled ? 'cancelled' : timedOut ? 'timeout' : 'network',
        message: cancelled ? 'request cancelled' : timedOut ? 'request timed out' : 'network error',
      }
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

export interface StructuredRequestOptions {
  businessRetries?: number
  repair?: (error: StructuredOutputError, attempt: number) => Promise<void>
  mode?: StructuredOutputMode
  status?: number | null
}

export async function requestStructuredOutput<T>(
  request: () => Promise<string>,
  schema: ZodType<T, z.ZodTypeDef, unknown>,
  options: StructuredRequestOptions = {},
): Promise<T> {
  const attempts = (options.businessRetries ?? 2) + 1
  let lastError: StructuredOutputError | null = null
  let repairUsed = false
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return parseStructuredOutput(await request(), schema)
    } catch (error) {
      lastError = error instanceof StructuredOutputError
        ? error
        : new StructuredOutputError('Structured request failed')
      if (!repairUsed && options.repair) {
        repairUsed = true
        await options.repair(lastError, attempt)
      }
    }
  }
  throw new StructuredOutputError(`Structured output failed after ${attempts} attempts`, {
    mode: options.mode,
    status: options.status,
    issues: lastError?.schemaPaths.map(path => ({ code: 'custom', path: [path], message: '' })),
  })
}
