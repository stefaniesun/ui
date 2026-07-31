import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { modelAdapter, writeGenerated } from './runtime.js'

const original = { ...process.env }
const temporaryDirectories: string[] = []

afterEach(async () => {
  process.env = { ...original }
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('writeGenerated', () => {
  it('does not partially update the app when any generated path is unsafe', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ui-rebuild-write-'))
    temporaryDirectories.push(root)
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'page.vue'), 'stable')

    await expect(writeGenerated(root, {
      'src/page.vue': 'candidate',
      '../escape.vue': 'unsafe',
    })).rejects.toThrow(/escapes app/i)

    await expect(readFile(path.join(root, 'src', 'page.vue'), 'utf8')).resolves.toBe('stable')
  })
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
