import { describe, expect, it } from 'vitest'
import type { Manifest } from '@ui-rebuild/contracts'
import { assertMvpManifestSupport } from './commands/run.js'
import { createCli } from './program.js'

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
  it('rejects full-page rendering in the MVP', () => {
    expect(() => assertMvpManifestSupport({
      ...manifest,
      states: [{ id: 'default', screenshot: 'reference.png', screenshotType: 'fullpage', scale: 1 }],
    })).toThrow(/fullPage/i)
  })
})
