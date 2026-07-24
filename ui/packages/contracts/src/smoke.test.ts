import { describe, expect, it } from 'vitest'
import { CONTRACT_VERSION } from './index.js'

describe('contracts package', () => {
  it('exposes a stable schema version', () => {
    expect(CONTRACT_VERSION).toBe('1.0.0')
  })
})
