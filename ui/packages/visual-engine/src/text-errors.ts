import type { TextExtractionFailure } from '@ui-rebuild/contracts'

export class TextExtractionGateError extends Error {
  constructor(readonly failure: TextExtractionFailure, options?: ErrorOptions) {
    super(`${failure.regionId}: ${failure.message}`, options)
    this.name = 'TextExtractionGateError'
  }
}

export function extractionReason(error: unknown): TextExtractionFailure['reason'] {
  if (error instanceof TextExtractionGateError) return error.failure.reason
  if (error instanceof Error && /crop|bounds|canvas|dimension|image/iu.test(error.message)) return 'crop-failed'
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const kind = String(error.kind)
    if (kind === 'timeout') return 'timeout'
    if (kind === 'network') return 'network'
    if (kind === 'http') return 'http'
    if (kind === 'protocol') return 'protocol'
    if (kind === 'format') return 'schema-invalid'
  }
  return 'protocol'
}

export function textExtractionFailure(
  regionId: string,
  stage: TextExtractionFailure['stage'],
  reason: TextExtractionFailure['reason'],
  message: string,
  cause?: unknown,
): TextExtractionGateError {
  return new TextExtractionGateError({ code: 'text-extraction-failed', reason, regionId, stage, message }, { cause })
}
