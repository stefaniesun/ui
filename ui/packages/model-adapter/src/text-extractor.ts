import {
  TEXT_EXTRACTION_PROMPT_VERSION,
  TEXT_EXTRACTION_SCHEMA_VERSION,
} from '@ui-rebuild/contracts'
import type { TextItem } from '@ui-rebuild/contracts'
import type { ModelAdapter } from './types.js'

export interface TextExtractorIdentity {
  provider: 'model' | 'command'
  model: string
  schemaVersion: string
  promptVersion: string
}

export interface TextExtractorInput {
  regionId: string
  image: Buffer
  width: number
  height: number
  signal?: AbortSignal
}

export interface TextExtractor {
  readonly identity: TextExtractorIdentity
  extract(input: TextExtractorInput): Promise<TextItem[]>
}

export class ModelTextExtractor implements TextExtractor {
  readonly identity: TextExtractorIdentity

  constructor(private readonly options: { adapter: ModelAdapter; model: string }) {
    this.identity = {
      provider: 'model',
      model: options.model,
      schemaVersion: TEXT_EXTRACTION_SCHEMA_VERSION,
      promptVersion: TEXT_EXTRACTION_PROMPT_VERSION,
    }
  }

  extract(input: TextExtractorInput): Promise<TextItem[]> {
    return this.options.adapter.extractText({
      regionId: input.regionId,
      image: {
        mediaType: 'image/png',
        base64: input.image.toString('base64'),
        width: input.width,
        height: input.height,
      },
      signal: input.signal,
    })
  }
}
