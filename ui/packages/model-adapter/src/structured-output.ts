import type { z } from 'zod'

export class StructuredOutputError extends Error {
  readonly cause: unknown

  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'StructuredOutputError'
    this.cause = cause
  }
}

function stripFence(value: string): string {
  const trimmed = value.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  return match?.[1] ?? trimmed
}

export function parseStructuredOutput<T>(value: string, schema: z.ZodType<T>): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(value))
  } catch (error) {
    throw new StructuredOutputError('Model returned invalid JSON', error)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    const details = result.error.issues
      .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw new StructuredOutputError(`Model output does not match schema: ${details}`, result.error)
  }
  return result.data
}
