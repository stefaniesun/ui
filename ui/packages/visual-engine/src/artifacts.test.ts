import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { writeRegionArtifacts } from './artifacts.js'

const directories: string[] = []
afterEach(async () => Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true }))))

describe('writeRegionArtifacts', () => {
  it('writes region JSON, paired crops, and the heatmap', async () => {
    const directory = path.join(os.tmpdir(), `visual-artifacts-${crypto.randomUUID()}`)
    directories.push(directory)
    const png = await sharp({ create: {
      width: 2, height: 2, channels: 4, background: '#ffffff',
    } }).png().toBuffer()
    const score = {
      total: 1,
      regions: [{
        regionId: 'header',
        geometry: { meanAbsoluteErrorPx: 0, score: 1 },
        visual: { pixelDiffRatio: 0, score: 1 },
        color: { meanDeltaE: 0, score: 1 },
        content: { ocrMatch: null, score: null },
        total: 1,
        severeDefects: [],
      }],
    }
    await writeRegionArtifacts(directory, score, new Map([
      ['header', { reference: png, actual: png }],
    ]), png)
    await expect(access(path.join(directory, 'header.reference.png'))).resolves.toBeUndefined()
    await expect(access(path.join(directory, 'header.actual.png'))).resolves.toBeUndefined()
    await expect(access(path.join(directory, 'heatmap.png'))).resolves.toBeUndefined()
    expect(JSON.parse(await readFile(path.join(directory, 'regions.json'), 'utf8'))).toEqual(score)
  })
})
