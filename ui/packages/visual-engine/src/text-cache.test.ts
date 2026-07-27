import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TextItem } from '@ui-rebuild/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileTextExtractionCache,
  hashImage,
  textCacheFileName,
  type TextCacheKey,
} from './text-cache.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))))

const item: TextItem = {
  text: 'Total',
  bounds: { x: 0, y: 0, width: 0.5, height: 0.2 },
  fontSize: null,
  color: null,
  confidence: 0.9,
}

const key: TextCacheKey = {
  imageHash: 'a'.repeat(64),
  regionId: 'hero',
  provider: 'model',
  model: 'gpt-test',
  schemaVersion: '1.0.0',
  promptVersion: '1.0.0',
}

async function createCache() {
  const root = await mkdtemp(path.join(tmpdir(), 'text-cache-'))
  roots.push(root)
  return { root, cache: new FileTextExtractionCache(root) }
}

describe('FileTextExtractionCache', () => {
  it('returns items only for the exact versioned key', async () => {
    const { cache } = await createCache()
    await cache.set(key, [item])
    await expect(cache.get(key)).resolves.toEqual([item])

    for (const changed of [
      { ...key, imageHash: 'b'.repeat(64) },
      { ...key, regionId: 'footer' },
      { ...key, provider: 'command' as const },
      { ...key, model: 'other' },
      { ...key, schemaVersion: '2.0.0' },
      { ...key, promptVersion: '2.0.0' },
    ]) {
      await expect(cache.get(changed)).resolves.toBeNull()
    }
  })

  it('treats corrupt and metadata-mismatched entries as misses', async () => {
    const { root, cache } = await createCache()
    await mkdir(root, { recursive: true })
    const file = path.join(root, textCacheFileName(key))
    await writeFile(file, 'not-json')
    await expect(cache.get(key)).resolves.toBeNull()
    await writeFile(file, JSON.stringify({ key: { ...key, model: 'other' }, items: [item] }))
    await expect(cache.get(key)).resolves.toBeNull()
  })

  it('does not replace a valid entry with invalid items or leave temporary files', async () => {
    const { root, cache } = await createCache()
    await cache.set(key, [item])
    await expect(cache.set(key, [{ ...item, confidence: 2 }])).rejects.toThrow()
    await expect(cache.get(key)).resolves.toEqual([item])
    expect((await readdir(root)).filter(file => file.includes('.tmp-'))).toEqual([])
    expect(JSON.parse(await readFile(path.join(root, textCacheFileName(key)), 'utf8'))).toBeDefined()
  })

  it('hashes image bytes deterministically', () => {
    expect(hashImage(Buffer.from('same'))).toBe(hashImage(Buffer.from('same')))
    expect(hashImage(Buffer.from('same'))).not.toBe(hashImage(Buffer.from('different')))
    expect(hashImage(Buffer.from('same'))).toMatch(/^[a-f0-9]{64}$/u)
  })
})
