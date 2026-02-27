import { test as base, Page, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path to test video — large file, not in git
const TEST_VIDEO_PATH = path.resolve(__dirname, '../../../test-videos/IMG_0991.mov')

/**
 * Custom fixture that provides helpers for golf-clip E2E tests.
 *
 * Usage:
 *   import { test, expect } from './fixtures'
 *   test('my test', async ({ app }) => { ... })
 */
export const test = base.extend<{
  app: AppFixture
}>({
  app: async ({ page }, use) => {
    const app = new AppFixture(page)
    await use(app)
  },
})

export { expect }

export class AppFixture {
  constructor(public readonly page: Page) {}

  /** Navigate to the app's upload screen */
  async goto() {
    await this.page.goto('/')
    // Wait for the upload screen to be ready
    await this.page.waitForSelector('.dropzone', { timeout: 10_000 })
  }

  /** Upload a video file to the dropzone. Uses the real test video by default.
   *  Bypasses Playwright's setFiles() (which base64-encodes 764MB over CDP) by
   *  symlinking the video into Vite's public dir so the browser can fetch it directly. */
  async uploadVideo(videoPath = TEST_VIDEO_PATH) {
    if (!fs.existsSync(videoPath)) {
      throw new Error(
        `Test video not found at ${videoPath}. ` +
        `Place a video file at test-videos/IMG_0991.mov or provide a custom path.`
      )
    }

    const fileName = path.basename(videoPath)
    const mimeType = videoPath.endsWith('.mp4') ? 'video/mp4' : 'video/quicktime'

    // Ensure test video is accessible via Vite's public dir
    const publicDir = path.resolve(__dirname, '../public')
    const symlinkPath = path.join(publicDir, '_test-video.mov')
    if (!fs.existsSync(symlinkPath)) {
      fs.symlinkSync(videoPath, symlinkPath)
    }

    // Fetch the video in-browser and use the test helper to process it directly
    // (React's onChange doesn't fire from programmatic events on file inputs)
    await this.page.evaluate(async ({ fileName, mimeType }) => {
      console.log('[e2e] Starting fetch of test video...')
      const res = await fetch('/_test-video.mov')
      if (!res.ok) throw new Error(`Failed to fetch test video: ${res.status}`)
      console.log('[e2e] Fetch complete, creating blob...')
      const blob = await res.blob()
      console.log(`[e2e] Blob created: ${blob.size} bytes, calling __testProcessFile...`)
      const file = new File([blob], fileName, { type: mimeType })

      // Use the dev-mode test helper exposed by VideoDropzone
      const testHelper = (window as unknown as { __testProcessFile?: (file: File, videoId: string) => Promise<void> }).__testProcessFile
      if (!testHelper) throw new Error('Test helper __testProcessFile not found. Is the app running in dev mode?')

      const videoId = `test-${Date.now()}`
      // Actually await the processing and catch errors
      try {
        await testHelper(file, videoId)
        console.log('[e2e] Processing completed successfully')
        // Log store state for debugging
        const store = (window as unknown as { __processingStore?: { getState: () => { status: string; segments: unknown[]; videos: Map<string, { status: string; segments: unknown[]; error: string | null }> } } }).__processingStore
        if (store) {
          const state = store.getState()
          const videosArr = Array.from(state.videos.values())
          console.log('[e2e] Store state:', JSON.stringify({
            status: state.status,
            segmentCount: state.segments.length,
            videoCount: state.videos.size,
            videos: videosArr.map(v => ({ status: v.status, segments: v.segments.length, error: v.error }))
          }))
        }
      } catch (err) {
        console.error('[e2e] Processing failed:', err)
        throw err
      }
    }, { fileName, mimeType })
  }

  /** Wait for video processing to complete and review screen to appear */
  async waitForReviewScreen(timeout = 90_000) {
    await this.page.waitForSelector('.clip-review', { timeout })
  }

  /** Upload video and wait until the review screen loads */
  async uploadAndWaitForReview(videoPath?: string, timeout?: number) {
    await this.uploadVideo(videoPath)
    await this.waitForReviewScreen(timeout)
  }

  /** Get the current review instruction text */
  async getInstructionText() {
    return this.page.locator('.instruction-text').textContent()
  }

  /** Get the step badge text (e.g., "Step 1", "Ready") */
  async getStepBadge() {
    return this.page.locator('.step-badge').textContent()
  }

  /** Click on the video canvas at a relative position (0-1 normalized) */
  async clickOnVideo(relX: number, relY: number) {
    const video = this.page.locator('.review-video')
    const box = await video.boundingBox()
    if (!box) throw new Error('Video element not visible')
    await this.page.mouse.click(
      box.x + box.width * relX,
      box.y + box.height * relY
    )
  }

  /** Click the approve button */
  async approveShot() {
    await this.page.locator('.review-actions .btn-primary').click()
  }

  /** Click the reject button */
  async rejectShot() {
    await this.page.locator('.btn-no-shot').click()
  }

  /** Press a keyboard key */
  async pressKey(key: string) {
    await this.page.keyboard.press(key)
  }

  /** Get the current zoom transform scale value */
  async getZoomScale(): Promise<number> {
    const transform = await this.page.locator('.video-zoom-content').evaluate(
      // Read inline style first — avoids reading mid-CSS-transition computed values
      el => (el as HTMLElement).style.transform || getComputedStyle(el).transform
    )
    if (!transform || transform === 'none') return 1
    // Inline style: "scale(1.5) translate(0px, 0px)" or "scale(1.5)"
    const scaleMatch = transform.match(/scale\(([^)]+)\)/)
    if (scaleMatch) return parseFloat(scaleMatch[1])
    // Computed style fallback: "matrix(2, 0, 0, 2, 0, 0)"
    const matrixMatch = transform.match(/matrix\(([^,]+)/)
    return matrixMatch ? parseFloat(matrixMatch[1]) : 1
  }

  /** Click video to mark landing point and wait for review state */
  async markLandingAndWaitForReview() {
    await this.clickOnVideo(0.7, 0.6)
    await this.page.waitForSelector('.step-badge.complete', { timeout: 10_000 })
  }

  /** Check if an element is visible */
  async isVisible(selector: string) {
    return this.page.locator(selector).isVisible()
  }

  /** Get the export modal */
  get exportModal() {
    return this.page.locator('.export-modal')
  }

  /** Click the export button on the complete screen */
  async startExport() {
    await this.page.locator('.btn-large').click()
  }

  /** Cancel an in-progress export */
  async cancelExport() {
    await this.page.locator('.export-modal .btn-secondary').click()
  }

  /** Wait for export to complete */
  async waitForExportComplete(timeout = 120_000) {
    await this.page.locator('.export-success-icon').waitFor({ timeout })
  }
}
