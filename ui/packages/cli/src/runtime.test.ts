import { afterEach, describe, expect, it } from 'vitest'
import { modelAdapter } from './runtime.js'

const original = { ...process.env }

afterEach(() => {
  process.env = { ...original }
})

describe('modelAdapter', () => {
  it('passes explicitly trusted remote origins to the model transport', () => {
    process.env.UI_REBUILD_MODEL_BASE_URL = 'https://api.example.com/v1'
    process.env.UI_REBUILD_MODEL = 'vision'
    process.env.UI_REBUILD_MODEL_TRUSTED_ORIGINS = 'https://api.example.com'

    expect(() => modelAdapter()).not.toThrow()
  })

  it('still rejects an untrusted remote model endpoint', () => {
    process.env.UI_REBUILD_MODEL_BASE_URL = 'https://api.example.com/v1'
    process.env.UI_REBUILD_MODEL = 'vision'
    delete process.env.UI_REBUILD_MODEL_TRUSTED_ORIGINS

    expect(() => modelAdapter()).toThrow(/trusted/i)
  })
})
