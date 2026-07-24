import path from 'node:path'
import sharp from 'sharp'
import type { Browser } from 'playwright'
import type { H5CaptureOptions, H5CaptureResult } from './types.js'

export class H5Renderer {
  private browser: Browser | null = null

  async capture(options: H5CaptureOptions): Promise<H5CaptureResult> {
    this.validate(options)
    const browser = await this.getBrowser(options.browsersPath)
    const context = await browser.newContext({
      viewport: { width: options.viewport.width, height: options.viewport.height },
      deviceScaleFactor: options.viewport.deviceScaleFactor,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    try {
      const page = await context.newPage()
      const timeout = options.timeoutMs ?? 30_000
      await page.goto(options.url, { waitUntil: 'networkidle', timeout })
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
      await page.evaluate(async () => {
        await document.fonts.ready
        const images = [...document.images]
        await Promise.all(images.map(image => image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              image.addEventListener('load', () => resolve(), { once: true })
              image.addEventListener('error', () => reject(new Error(`Image failed: ${image.currentSrc || image.src}`)), { once: true })
            })))
        const broken = images.find(image => image.naturalWidth === 0)
        if (broken) throw new Error(`Image failed: ${broken.currentSrc || broken.src}`)
      })
      const regions = []
      for (const regionId of options.regionIds) {
        if (!/^[a-z][a-z0-9-]*$/u.test(regionId)) throw new Error(`Unsafe regionId: ${regionId}`)
        const locator = page.locator(`[data-region-id="${regionId}"]`)
        const count = await locator.count()
        if (count !== 1) throw new Error(`Expected one region ${regionId}, found ${count}`)
        const box = await locator.boundingBox()
        if (!box) throw new Error(`Region is not visible: ${regionId}`)
        regions.push({ regionId, bounds: { x: box.x, y: box.y, width: box.width, height: box.height } })
      }
      const png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' })
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      return { image: { data, png, width: info.width, height: info.height, defaultMasks: [] }, regions }
    } finally {
      await context.close()
    }
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = null
  }

  private async getBrowser(browsersPath?: string): Promise<Browser> {
    if (this.browser) return this.browser
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath ?? process.env.PLAYWRIGHT_BROWSERS_PATH
      ?? path.resolve(process.cwd(), '.cache/ms-playwright')
    const { chromium } = await import('playwright')
    this.browser = await chromium.launch({ headless: true })
    return this.browser
  }

  private validate(options: H5CaptureOptions): void {
    const { width, height, deviceScaleFactor } = options.viewport
    if (![width, height, deviceScaleFactor].every(Number.isFinite) || width <= 0 || height <= 0 || deviceScaleFactor <= 0) {
      throw new Error('Viewport dimensions and deviceScaleFactor must be positive')
    }
    if (new Set(options.regionIds).size !== options.regionIds.length) throw new Error('regionIds must be unique')
  }
}
