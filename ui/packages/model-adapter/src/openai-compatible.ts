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

function schemaInstruction(request: TransportRequest): string {
  if (!['json-mode', 'prompt-json'].includes(request.structuredOutput)) return ''
  return `\nReturn only JSON matching this schema:\n${JSON.stringify(request.jsonSchema)}`
}

function structureFields(request: TransportRequest): Record<string, unknown> {
  if (request.structuredOutput === 'json-schema') {
    return { response_format: { type: 'json_schema', json_schema: {
      name: request.schemaName, strict: true, schema: request.jsonSchema,
    } } }
  }
  if (request.structuredOutput === 'tools') {
    return {
      tools: [{ type: 'function', function: {
        name: 'return_result', description: 'Return the requested result.',
        strict: true, parameters: request.jsonSchema,
      } }],
      tool_choice: { type: 'function', function: { name: 'return_result' } },
    }
  }
  return request.structuredOutput === 'json-mode'
    ? { response_format: { type: 'json_object' } }
    : {}
}

function extractOutput(body: unknown, mode: StructuredOutputMode): string | null {
  if (typeof body !== 'object' || body === null) return null
  const choices = Reflect.get(body, 'choices')
  if (!Array.isArray(choices) || choices.length !== 1
    || typeof choices[0] !== 'object' || choices[0] === null) return null
  const message = Reflect.get(choices[0], 'message')
  if (typeof message !== 'object' || message === null) return null
  if (mode === 'tools') {
    const toolCalls = Reflect.get(message, 'tool_calls')
    if (!Array.isArray(toolCalls) || toolCalls.length !== 1) return null
    const onlyCall = toolCalls[0]
    if (typeof onlyCall !== 'object' || onlyCall === null) return null
    const fn = Reflect.get(onlyCall, 'function')
    if (typeof fn !== 'object' || fn === null || Reflect.get(fn, 'name') !== 'return_result') {
      return null
    }
    const args = Reflect.get(fn, 'arguments')
    return typeof args === 'string' ? args : null
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
        method: 'POST', redirect: 'error',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: [
            { type: 'text', text: request.prompt + schemaInstruction(request) },
            ...request.images.map(image => ({ type: 'image_url', image_url: {
              url: `data:${image.mediaType};base64,${image.base64}`,
            } })),
          ] }],
          ...structureFields(request),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        return { ok: false, status: response.status, kind: 'http', message: 'model request failed' }
      }
      let body: unknown
      try { body = await response.json() } catch {
        return { ok: false, status: response.status, kind: 'protocol', message: 'invalid JSON response' }
      }
      const output = extractOutput(body, request.structuredOutput)
      return output === null
        ? { ok: false, status: response.status, kind: 'protocol', message: 'missing model output' }
        : { ok: true, status: response.status, output }
    } catch {
      const cancelled = request.signal?.aborted === true
      const timedOut = controller.signal.reason === 'timeout'
      return {
        ok: false, status: null,
        kind: cancelled ? 'cancelled' : timedOut ? 'timeout' : 'network',
        message: cancelled ? 'request cancelled' : timedOut ? 'request timed out' : 'network error',
      }
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener('abort', onExternalAbort)
    }
  }
}

export interface StructuredResponse {
  output: string
  status: number
}

export interface StructuredRequestOptions {
  businessRetries?: number
  repair?: (
    invalidOutput: string,
    error: StructuredOutputError,
  ) => Promise<StructuredResponse>
  mode: StructuredOutputMode
}

export async function requestStructuredOutput<T>(
  request: () => Promise<StructuredResponse>,
  schema: ZodType<T, z.ZodTypeDef, unknown>,
  options: StructuredRequestOptions,
): Promise<T> {
  const attempts = (options.businessRetries ?? 2) + 1
  let lastError: StructuredOutputError | null = null
  let lastStatus: number | null = null
  let totalAttempts = 0
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    totalAttempts += 1
    try {
      const response = await request()
      lastStatus = response.status
      return parseStructuredOutput(response.output, schema)
    } catch (error) {
      if (!(error instanceof StructuredOutputError)) throw error
      const httpStatus = error.status ?? null
      const retryableTransport = ['timeout', 'network'].includes(error.kind)
        || (error.kind === 'http' && httpStatus !== null
          && (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500))
      if (error.kind !== 'format') {
        if (retryableTransport && attempt + 1 < attempts) {
          lastError = error
          lastStatus = error.status ?? lastStatus
          continue
        }
        throw error
      }
      lastError = error
      if (attempt === 0 && options.repair && error.rawOutput !== undefined) {
        totalAttempts += 1
        try {
          const repaired = await options.repair(error.rawOutput, error)
          lastStatus = repaired.status
          return parseStructuredOutput(repaired.output, schema)
        } catch (repairError) {
          if (!(repairError instanceof StructuredOutputError) || repairError.kind !== 'format') {
            throw repairError
          }
          lastError = repairError
        }
      }
    }
  }
  throw new StructuredOutputError(`Structured output failed after ${totalAttempts} attempts`, {
    mode: options.mode,
    status: lastStatus,
    kind: lastError?.kind,
    issues: lastError?.schemaPaths.map(path => ({ code: 'custom', path: [path], message: '' })),
    attempts: totalAttempts,
  })
}
