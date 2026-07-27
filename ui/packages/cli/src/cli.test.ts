import { describe, expect, it } from 'vitest'
import type { Manifest } from '@ui-rebuild/contracts'
import { assertMvpManifestSupport } from './commands/run.js'
import { createCli } from './program.js'
import { parseTrustedOrigins, selectTextExtractor } from './runtime.js'

const manifest = {
  version: '1.0.0',
  projectId: 'demo',
  pageId: 'profile',
  device: { width: 390, height: 844, pixelRatio: 1 },
  states: [{ id: 'default', screenshot: 'reference.png', screenshotType: 'viewport', scale: 1 }],
} satisfies Manifest

describe('CLI', () => {
  it('exposes the complete workflow', () => {
    const names = createCli().commands.map(command => command.name())
    expect(names).toEqual(['doctor', 'init', 'analyze', 'run', 'review'])
  })
  it('rejects multiple states in the MVP', () => {
    expect(() => assertMvpManifestSupport({
      ...manifest,
      states: [...manifest.states, { id: 'modal', screenshot: 'modal.png', screenshotType: 'viewport', scale: 1 }],
    })).toThrow(/one state/i)
  })
  it('parses exact trusted HTTPS origins', () => {
    expect(parseTrustedOrigins(' https://api.example.com,https://model.example.com:8443 ')).toEqual([
      'https://api.example.com',
      'https://model.example.com:8443',
    ])
  })
  it.each(['http://api.example.com', 'https://api.example.com/path', 'not-a-url'])(
    'rejects unsafe trusted origin %s', value => {
      expect(() => parseTrustedOrigins(value)).toThrow()
    },
  )
  it('uses command extraction only when explicitly configured', () => {
    const modelEnv = { UI_REBUILD_MODEL_BASE_URL: 'http://127.0.0.1:8000/v1', UI_REBUILD_MODEL: 'gpt-test' }
    expect(selectTextExtractor(modelEnv).identity.provider).toBe('model')
    expect(selectTextExtractor({ ...modelEnv, UI_REBUILD_OCR_COMMAND: 'ocr' }).identity.provider).toBe('command')
  })
  it('rejects full-page rendering in the MVP', () => {
    expect(() => assertMvpManifestSupport({
      ...manifest,
      states: [{ id: 'default', screenshot: 'reference.png', screenshotType: 'fullpage', scale: 1 }],
    })).toThrow(/fullPage/i)
  })
})
