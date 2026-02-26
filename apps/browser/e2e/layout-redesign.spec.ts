import { test, expect } from './fixtures'

test.describe('Layout Redesign', () => {
  test('walkthrough steps visible on upload screen', async ({ app, page }) => {
    await app.goto()

    // 3 walkthrough steps should be visible
    const steps = page.locator('.walkthrough-step')
    await expect(steps).toHaveCount(3)

    // Each step should have a number and illustration
    for (let i = 0; i < 3; i++) {
      const step = steps.nth(i)
      await expect(step.locator('.walkthrough-number')).toBeVisible()
      await expect(step.locator('.walkthrough-illustration')).toBeVisible()
    }
  })

  test.describe('Review Screen Layout', () => {
    test.beforeEach(async ({ app }) => {
      await app.goto()
      await app.uploadAndWaitForReview()
      await app.markLandingAndWaitForReview()
    })

    test('trajectory config panel renders in review', async ({ page }) => {
      await expect(page.locator('.tracer-config-panel')).toBeVisible()
    })

    test('generate button is in shot shape column', async ({ page }) => {
      // Expand config panel if collapsed
      const configBody = page.locator('.config-body')
      if (!(await configBody.isVisible())) {
        await page.locator('.config-header').click()
        await configBody.waitFor({ state: 'visible' })
      }

      // The generate button should be inside the config grid's first column
      const configColumns = page.locator('.config-column')
      const firstColumn = configColumns.first()
      const generateBtn = firstColumn.locator('.btn-generate')
      await expect(generateBtn).toBeVisible()
    })

    test('approve/reject buttons are below scrubber', async ({ page }) => {
      // Scrubber and review actions should both be visible
      const scrubber = page.locator('.scrubber-container')
      const actions = page.locator('.review-actions')
      await expect(scrubber).toBeVisible()
      await expect(actions).toBeVisible()

      // Actions should be below the scrubber
      const scrubberBox = await scrubber.boundingBox()
      const actionsBox = await actions.boundingBox()
      expect(scrubberBox).toBeTruthy()
      expect(actionsBox).toBeTruthy()
      expect(actionsBox!.y).toBeGreaterThan(scrubberBox!.y + scrubberBox!.height - 5)
    })

    test('instruction banner shows above trajectory settings', async ({ page }) => {
      const instruction = page.locator('.marking-instruction')
      const configPanel = page.locator('.tracer-config-panel')
      await expect(instruction).toBeVisible()
      await expect(configPanel).toBeVisible()

      const instructionBox = await instruction.boundingBox()
      const configBox = await configPanel.boundingBox()
      expect(instructionBox).toBeTruthy()
      expect(configBox).toBeTruthy()
      expect(instructionBox!.y).toBeLessThan(configBox!.y)
    })

    test('transport controls render below video', async ({ page }) => {
      const transportControls = page.locator('.video-transport-controls')
      await expect(transportControls).toBeVisible()

      // Verify all transport buttons are present
      await expect(page.locator('[aria-label="Skip to clip start"]')).toBeVisible()
      await expect(page.locator('[aria-label="Step back one frame"]')).toBeVisible()
      await expect(page.locator('[aria-label="Play"]')).toBeVisible()
      await expect(page.locator('[aria-label="Step forward one frame"]')).toBeVisible()
      await expect(page.locator('[aria-label="Skip to clip end"]')).toBeVisible()

      // Transport controls should be below the video container
      const videoContainer = page.locator('.video-container')
      const videoBox = await videoContainer.boundingBox()
      const transportBox = await transportControls.boundingBox()
      expect(videoBox).toBeTruthy()
      expect(transportBox).toBeTruthy()
      expect(transportBox!.y).toBeGreaterThan(videoBox!.y)
    })
  })
})
