import { spawn } from 'node:child_process'
import type { OcrProvider } from './score.js'

export interface LocalOcrCommandOptions {
  command: string
  args?: string[]
  timeoutMs?: number
}

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcrUnavailableError'
  }
}

export class LocalOcrCommandProvider implements OcrProvider {
  constructor(private readonly options: LocalOcrCommandOptions) {}

  async compare(input: Parameters<OcrProvider['compare']>[0]): Promise<number> {
    const payload = JSON.stringify({
      reference: input.reference.toString('base64'),
      actual: input.actual.toString('base64'),
      referenceBounds: input.referenceBounds,
      actualBounds: input.actualBounds,
      mask: Buffer.from(input.mask).toString('base64'),
    })
    return new Promise((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      })
      const stdout: Buffer[] = []
      const timer = setTimeout(() => {
        child.kill()
        reject(new OcrUnavailableError('Local OCR command timed out'))
      }, this.options.timeoutMs ?? 30_000)
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.on('error', error => {
        clearTimeout(timer)
        reject(new OcrUnavailableError(`Local OCR command unavailable: ${error.message}`))
      })
      child.on('close', code => {
        clearTimeout(timer)
        if (code !== 0) {
          reject(new OcrUnavailableError(`Local OCR command exited with code ${code}`))
          return
        }
        try {
          const result = JSON.parse(Buffer.concat(stdout).toString('utf8')) as { match: number }
          resolve(result.match)
        } catch {
          reject(new OcrUnavailableError('Local OCR command returned invalid JSON'))
        }
      })
      child.stdin.end(payload)
    })
  }
}
