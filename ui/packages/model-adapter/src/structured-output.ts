import type { ZodIssue, z } from 'zod'

export class StructuredOutputError extends Error {
  readonly schemaPaths: string[]
  readonly mode?: string
  readonly status?: number | null

  constructor(
    message: string,
    options: { issues?: ZodIssue[]; mode?: string; status?: number | null } = {},
  ) {
    super(message)
    this.name = 'StructuredOutputError'
    this.schemaPaths = options.issues?.map(issue => issue.path.join('.') || '<root>') ?? []
    this.mode = options.mode
    this.status = options.status
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
    throw new StructuredOutputError('Model returned invalid JSON')
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const details = result.error.issues.map(issue => (
      `${issue.path.join('.') || '<root>'}: ${issue.message}`
    )).join('; ')
    throw new StructuredOutputError(`Model output does not match schema: ${details}`, {
      issues: result.error.issues,
    })
  }
  return result.data
}
