import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  TEXT_EXTRACTION_PROMPT_VERSION,
  TEXT_EXTRACTION_SCHEMA_VERSION,
  TextItemListSchema,
} from '@ui-rebuild/contracts'
import type { TextItem } from '@ui-rebuild/contracts'
import type { RegionTextExtractor } from './reference.js'

export interface LocalOcrCommandOptions {
  command: string
  args?: string[]
  timeoutMs?: number
}

export const LOCAL_OCR_PRESETS = {
  paddleocr: { command: 'paddleocr' },
  rapidocr: { command: 'rapidocr_onnxruntime' },
} as const satisfies Record<string, LocalOcrCommandOptions>

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcrUnavailableError'
  }
}

export class LocalOcrCommandProvider implements RegionTextExtractor {
  readonly identity

  constructor(private readonly options: LocalOcrCommandOptions) {
    this.identity = {
      provider: 'command' as const,
      model: path.basename(options.command),
      schemaVersion: TEXT_EXTRACTION_SCHEMA_VERSION,
      promptVersion: TEXT_EXTRACTION_PROMPT_VERSION,
    }
  }

  extract(input: {
    regionId: string
    image: Buffer
    width: number
    height: number
    signal?: AbortSignal
  }): Promise<TextItem[]> {
    if (input.signal?.aborted) return Promise.reject(new OcrUnavailableError('Local OCR command cancelled'))
    return this.run({
      operation: 'extract-text',
      regionId: input.regionId,
      image: input.image.toString('base64'),
      width: input.width,
      height: input.height,
      schemaVersion: TEXT_EXTRACTION_SCHEMA_VERSION,
    }, input.signal).then(output => {
      const result = TextItemListSchema.safeParse(output)
      if (!result.success) throw new OcrUnavailableError('Local OCR command returned invalid text items')
      return result.data.items
    })
  }

  private run(payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      })
      const stdout: Buffer[] = []
      let settled = false
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        callback()
      }
      const abort = () => {
        child.kill()
        settle(() => reject(new OcrUnavailableError('Local OCR command cancelled')))
      }
      const timer = setTimeout(() => {
        child.kill()
        settle(() => reject(new OcrUnavailableError('Local OCR command timed out')))
      }, this.options.timeoutMs ?? 30_000)
      signal?.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.on('error', () => settle(() => reject(new OcrUnavailableError('Local OCR command unavailable'))))
      child.on('close', code => settle(() => {
        if (code !== 0) {
          reject(new OcrUnavailableError(`Local OCR command exited with code ${code}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')))
        } catch {
          reject(new OcrUnavailableError('Local OCR command returned invalid JSON'))
        }
      }))
      child.stdin.end(JSON.stringify(payload))
    })
  }
}
