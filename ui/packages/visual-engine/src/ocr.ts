import { spawn } from 'node:child_process'
import type { OcrProvider } from './score.js'

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

export class LocalOcrCommandProvider implements OcrProvider {
  constructor(private readonly options: LocalOcrCommandOptions) {}

  async analyzeReference(reference: Buffer): Promise<unknown> {
    return this.run({ operation: 'analyze-reference', reference: reference.toString('base64') })
  }

  async compare(input: Parameters<OcrProvider['compare']>[0]): Promise<number> {
    const result = await this.run({
      operation: 'compare',
      reference: input.reference.toString('base64'),
      actual: input.actual.toString('base64'),
      referenceBaseline: input.referenceBaseline,
      referenceBounds: input.referenceBounds,
      actualBounds: input.actualBounds,
      mask: Buffer.from(input.mask).toString('base64'),
    }) as { match?: unknown }
    if (typeof result.match !== 'number') {
      throw new OcrUnavailableError('Local OCR command did not return a numeric match')
    }
    return result.match
  }

  private run(payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      })
      const stdout: Buffer[] = []
      let settled = false
      function settle(callback: () => void): void {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback()
      }
      const timer = setTimeout(() => {
        child.kill()
        settle(() => reject(new OcrUnavailableError('Local OCR command timed out')))
      }, this.options.timeoutMs ?? 30_000)
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.on('error', error => settle(() => reject(
        new OcrUnavailableError(`Local OCR command unavailable: ${error.message}`),
      )))
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
