import { test, expect } from './fixtures'

test.describe('Zoom & Pan Controls', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto()
    await app.uploadAndWaitForReview()
  })

  test('keyboard zoom in (+) increases zoom level', async ({ app }) => {
    const initialScale = await app.getZoomScale()
    expect(initialScale).toBe(1)

    await app.pressKey('+')

    const zoomedScale = await app.getZoomScale()
    expect(zoomedScale).toBe(2)
  })

  test('keyboard zoom out (-) decreases zoom level', async ({ app }) => {
    // Zoom in first
    await app.pressKey('+')
    expect(await app.getZoomScale()).toBe(2)

    // Zoom out
    await app.pressKey('-')
    expect(await app.getZoomScale()).toBe(1)
  })

  test('keyboard reset (0) returns to 1x', async ({ app }) => {
    // Zoom to 4x (press + three times: 1→2→3→4)
    await app.pressKey('+')
    await app.pressKey('+')
    await app.pressKey('+')
    expect(await app.getZoomScale()).toBeGreaterThan(1)

    // Reset
    await app.pressKey('0')
    expect(await app.getZoomScale()).toBe(1)
  })

  test('drag-to-pan works when zoomed', async ({ app, page }) => {
    // Zoom in
    await app.pressKey('+')
    expect(await app.getZoomScale()).toBe(2)

    const videoContainer = page.locator('.video-container')
    const box = await videoContainer.boundingBox()
    if (!box) throw new Error('Video container not found')

    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    // Get initial transform
    const initialTransform = await page.locator('.video-zoom-content').evaluate(
      el => el.style.transform
    )

    // Drag from center to upper-left
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX - 100, centerY - 100, { steps: 10 })
    await page.mouse.up()

    // Transform should have changed (pan offset applied)
    const newTransform = await page.locator('.video-zoom-content').evaluate(
      el => el.style.transform
    )
    expect(newTransform).not.toBe(initialTransform)
  })

  test('zoom does not break tracer positioning', async ({ app, page }) => {
    // Mark landing point to generate trajectory
    await app.clickOnVideo(0.7, 0.6)

    // Wait for trajectory to be generated
    await page.waitForSelector('.step-badge.complete', { timeout: 10_000 })

    // Zoom in
    await app.pressKey('+')
    expect(await app.getZoomScale()).toBe(2)

    // Play the video to activate tracer
    await app.pressKey(' ')
    await page.waitForTimeout(1000)
    await app.pressKey(' ') // Pause

    // Verify the canvas/video container is still rendering
    // (No error overlays visible)
    const hasError = await page.locator('.video-error-overlay').isVisible()
    expect(hasError).toBe(false)

    // The trajectory editor canvas should still exist
    const canvasCount = await page.locator('.video-container canvas').count()
    expect(canvasCount).toBeGreaterThan(0)
  })
})
