import type { PatchPlan, VisualIR } from '@ui-rebuild/contracts'

export type StructuredOutputMode = 'json-schema' | 'tools' | 'json-mode' | 'prompt-json'

export interface TransportRequest {
  structuredOutput: StructuredOutputMode
  image: { mediaType: 'image/png'; base64: string }
  signal?: AbortSignal
}

export interface TransportResponse {
  status: number
  body: unknown
}

export interface ModelTransport {
  calls?: TransportRequest[]
  send(request: TransportRequest): Promise<TransportResponse>
}

export interface ModelCapabilityProfile {
  vision: true
  structuredOutput: StructuredOutputMode
}

export interface AnalyzeScreensInput { screenshots: string[]; prompt: string }
export interface DiagnoseDiffInput { reportPath: string; heatmapPaths: string[] }
export interface ReviewResultInput { reportPath: string }
export interface ModelReview { summary: string; unresolved: string[] }

export interface ModelAdapter {
  probe(): Promise<ModelCapabilityProfile>
  analyzeScreens(input: AnalyzeScreensInput): Promise<VisualIR>
  diagnoseDiff(input: DiagnoseDiffInput): Promise<PatchPlan>
  reviewResult(input: ReviewResultInput): Promise<ModelReview>
}
