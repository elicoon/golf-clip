import { test as base, Page, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

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

  /** Upload a video file to the dropzone. Uses the real test video by default. */
  async uploadVideo(videoPath = TEST_VIDEO_PATH) {
    if (!fs.existsSync(videoPath)) {
      throw new Error(
        `Test video not found at ${videoPath}. ` +
        `Place a video file at test-videos/IMG_0991.mov or provide a custom path.`
      )
    }

    // Use Playwright's file chooser API
    const fileChooserPromise = this.page.waitForEvent('filechooser')
    await this.page.locator('.dropzone .btn-primary').click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(videoPath)
  }

  /** Wait for video processing to complete and review screen to appear */
  async waitForReviewScreen(timeout = 120_000) {
    // Processing can take a while for large videos
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
      el => getComputedStyle(el).transform
    )
    // transform is like "matrix(2, 0, 0, 2, 0, 0)" — extract scale
    if (transform === 'none') return 1
    const match = transform.match(/matrix\(([^,]+)/)
    return match ? parseFloat(match[1]) : 1
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
