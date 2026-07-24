import type { ZodIssue, z } from 'zod'
import type { StructuredOutputMode, TransportErrorKind } from './types.js'

export class StructuredOutputError extends Error {
  readonly schemaPaths: string[]
  readonly mode?: StructuredOutputMode
  readonly status?: number | null
  readonly kind: 'format' | TransportErrorKind
  readonly attempts: number
  readonly rawOutput?: string

  constructor(message: string, options: {
    issues?: ZodIssue[]
    mode?: StructuredOutputMode
    status?: number | null
    kind?: 'format' | TransportErrorKind
    attempts?: number
    rawOutput?: string
  } = {}) {
    super(message)
    this.name = 'StructuredOutputError'
    this.schemaPaths = options.issues?.map(issue => issue.path.join('.') || '<root>') ?? []
    this.mode = options.mode
    this.status = options.status
    this.kind = options.kind ?? 'format'
    this.attempts = options.attempts ?? 1
    this.rawOutput = options.rawOutput
  }
}

function stripFence(value: string): string {
  const trimmed = value.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  return match?.[1] ?? trimmed
}

export function parseStructuredOutput<T>(
  value: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(value))
  } catch {
    throw new StructuredOutputError('Model returned invalid JSON', { rawOutput: value })
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const details = result.error.issues.map(issue => (
      `${issue.path.join('.') || '<root>'}: ${issue.message}`
    )).join('; ')
    throw new StructuredOutputError(`Model output does not match schema: ${details}`, {
      issues: result.error.issues,
      rawOutput: value,
    })
  }
  return result.data
}
