import { test, expect } from './fixtures'

test.describe('Mobile Dropzone Interaction', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto()
  })

  test('dropzone has correct ARIA role and label on mobile', async ({ page }) => {
    const dropzone = page.locator('.dropzone')
    await expect(dropzone).toBeVisible()
    await expect(dropzone).toHaveAttribute('role', 'button')
    await expect(dropzone).toHaveAttribute('aria-label', 'Drop zone for video files')
  })

  test('dropzone is focusable via tabindex on mobile', async ({ page }) => {
    const dropzone = page.locator('.dropzone')
    await expect(dropzone).toHaveAttribute('tabindex', '0')
  })

  test('dropzone meets WCAG 2.2 touch target minimum (24x24px)', async ({ page }) => {
    const dropzone = page.locator('.dropzone')
    const box = await dropzone.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(24)
    expect(box!.height).toBeGreaterThanOrEqual(24)
  })

  test('Select File button meets WCAG 2.2 touch target minimum (24x24px)', async ({ page }) => {
    const btn = page.locator('.dropzone .btn-primary')
    const box = await btn.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(24)
    expect(box!.height).toBeGreaterThanOrEqual(24)
  })

  test('file input accepts correct video formats on mobile', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await expect(fileInput).toHaveAttribute('accept', '.mp4,.mov,.m4v,video/mp4,video/quicktime,video/x-m4v')
    await expect(fileInput).toHaveAttribute('multiple')
  })
})
