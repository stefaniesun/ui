import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseStructuredOutput, StructuredOutputError } from './structured-output.js'

const schema = z.object({ name: z.string(), confidence: z.number().min(0).max(1) }).strict()

describe('parseStructuredOutput', () => {
  it('extracts direct, fenced, and explanatory JSON output', () => {
    expect(parseStructuredOutput('{"name":"header","confidence":0.9}', schema).name)
      .toBe('header')
    expect(parseStructuredOutput('```json\n{"name":"header","confidence":0.9}\n```', schema).name)
      .toBe('header')
    expect(parseStructuredOutput(
      'Here is the result: {"name":"header","confidence":0.9} done.',
      schema,
    ).name).toBe('header')
  })

  it('rejects invalid JSON and schema mismatches without partial values', () => {
    expect(() => parseStructuredOutput('{broken', schema)).toThrow(StructuredOutputError)
    expect(() => parseStructuredOutput('{"name":"header","confidence":2}', schema))
      .toThrow(/confidence/i)
  })
})
