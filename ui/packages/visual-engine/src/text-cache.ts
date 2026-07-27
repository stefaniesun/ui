import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { TextItemListSchema, TextItemSchema } from '@ui-rebuild/contracts'
import type { TextItem } from '@ui-rebuild/contracts'

export interface TextCacheKey {
  imageHash: string
  regionId: string
  provider: 'model' | 'command'
  model: string
  schemaVersion: string
  promptVersion: string
}

export interface TextExtractionCache {
  get(key: TextCacheKey): Promise<TextItem[] | null>
  set(key: TextCacheKey, items: readonly TextItem[]): Promise<void>
}

function validateKey(key: TextCacheKey): TextCacheKey {
  if (!/^[a-f0-9]{64}$/u.test(key.imageHash)) throw new Error('Invalid image hash')
  if (!key.regionId || !key.model || !key.schemaVersion || !key.promptVersion) {
    throw new Error('Text cache key fields must be non-empty')
  }
  if (key.provider !== 'model' && key.provider !== 'command') throw new Error('Invalid text provider')
  return { ...key }
}

function parseRecord(value: unknown): { key: TextCacheKey; items: TextItem[] } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'items,key') return null
  if (typeof record.key !== 'object' || record.key === null || Array.isArray(record.key)) return null
  const rawKey = record.key as Record<string, unknown>
  if (Object.keys(rawKey).sort().join(',') !== 'imageHash,model,promptVersion,provider,regionId,schemaVersion') return null
  try {
    const key = validateKey(rawKey as unknown as TextCacheKey)
    const items = TextItemListSchema.parse({ items: record.items }).items
    return { key, items }
  } catch {
    return null
  }
}

function canonicalKey(key: TextCacheKey): string {
  const valid = validateKey(key)
  return JSON.stringify({
    imageHash: valid.imageHash,
    regionId: valid.regionId,
    provider: valid.provider,
    model: valid.model,
    schemaVersion: valid.schemaVersion,
    promptVersion: valid.promptVersion,
  })
}

export function hashImage(image: Buffer): string {
  return createHash('sha256').update(image).digest('hex')
}

export function textCacheFileName(key: TextCacheKey): string {
  return `${createHash('sha256').update(canonicalKey(key)).digest('hex')}.json`
}

export class FileTextExtractionCache implements TextExtractionCache {
  constructor(private readonly root: string) {}

  async get(key: TextCacheKey): Promise<TextItem[] | null> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(path.join(this.root, textCacheFileName(key)), 'utf8'))
    } catch {
      return null
    }
    const record = parseRecord(parsed)
    if (record === null || canonicalKey(record.key) !== canonicalKey(key)) return null
    return record.items
  }

  async set(key: TextCacheKey, items: readonly TextItem[]): Promise<void> {
    const record = {
      key: validateKey(key),
      items: items.map(item => TextItemSchema.parse(item)),
    }
    await mkdir(this.root, { recursive: true })
    const target = path.join(this.root, textCacheFileName(key))
    const temporary = `${target}.tmp-${randomUUID()}`
    try {
      await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx' })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
  }
}
