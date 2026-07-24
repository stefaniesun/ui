import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PageScore } from './score.js'

export async function writeRegionArtifacts(
  outputDirectory: string,
  score: PageScore,
  crops: ReadonlyMap<string, { reference: Buffer; actual: Buffer }>,
  heatmap?: Buffer,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(path.join(outputDirectory, 'regions.json'), `${JSON.stringify(score, null, 2)}\n`)
  if (heatmap) await writeFile(path.join(outputDirectory, 'heatmap.png'), heatmap)
  for (const [regionId, images] of crops) {
    await writeFile(path.join(outputDirectory, `${regionId}.reference.png`), images.reference)
    await writeFile(path.join(outputDirectory, `${regionId}.actual.png`), images.actual)
  }
}
