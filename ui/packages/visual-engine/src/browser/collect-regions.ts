import type { Page } from 'playwright'
import type { CapturedRegion } from '../renderers/types.js'

export async function collectRegions(page: Page, regionIds: readonly string[]): Promise<CapturedRegion[]> {
  const regions: CapturedRegion[] = []
  for (const regionId of regionIds) {
    if (!/^[a-z][a-z0-9-]*$/u.test(regionId)) throw new Error(`Unsafe regionId: ${regionId}`)
    const locator = page.locator(`[data-region-id="${regionId}"]`)
    const count = await locator.count()
    if (count !== 1) throw new Error(`Expected one region ${regionId}, found ${count}`)
    const box = await locator.boundingBox()
    if (!box) throw new Error(`Region is not visible: ${regionId}`)
    regions.push({ regionId, bounds: { x: box.x, y: box.y, width: box.width, height: box.height } })
  }
  return regions
}
