import type { PatchPlan, VisualIR } from '@ui-rebuild/contracts'

export type StructuredOutputMode = 'json-schema' | 'tools' | 'json-mode' | 'prompt-json'
export type TransportErrorKind = 'http' | 'timeout' | 'cancelled' | 'network' | 'protocol'

export interface ModelImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  base64: string
  width: number
  height: number
}

export interface TransportRequest {
  structuredOutput: StructuredOutputMode
  prompt: string
  images: ModelImage[]
  schemaName: string
  jsonSchema: Record<string, unknown>
  signal?: AbortSignal
}

export type TransportResponse =
  | { ok: true; status: number; output: string }
  | { ok: false; status: number | null; kind: TransportErrorKind; message: string }

export interface ModelTransport {
  calls?: TransportRequest[]
  send(request: TransportRequest): Promise<TransportResponse>
}

export interface ModelCapabilityProfile {
  vision: true
  structuredOutput: StructuredOutputMode
  maxVerifiedImage: { width: number; height: number }
}

export interface AnalyzeScreensInput {
  screenshots: ModelImage[]
  prompt: string
  signal?: AbortSignal
}
export interface DiagnoseDiffInput { images: ModelImage[]; prompt: string; signal?: AbortSignal }
export interface ReviewResultInput { images: ModelImage[]; prompt: string; signal?: AbortSignal }
export interface ModelReview { summary: string; unresolved: string[] }

export interface ModelAdapter {
  probe(referenceImage: ModelImage, signal?: AbortSignal): Promise<ModelCapabilityProfile>
  analyzeScreens(input: AnalyzeScreensInput): Promise<VisualIR>
  diagnoseDiff(input: DiagnoseDiffInput): Promise<PatchPlan>
  reviewResult(input: ReviewResultInput): Promise<ModelReview>
}
