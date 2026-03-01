import { test, expect } from './fixtures'

test.describe('Mobile Landing Page', () => {
  test.beforeEach(async ({ app }) => {
    await app.goto()
  })

  test('app title is visible on mobile', async ({ page }) => {
    const title = page.locator('.app-title')
    await expect(title).toBeVisible()
    await expect(title).toContainText('GolfClip')
  })

  test('page content does not overflow viewport width', async ({ page }) => {
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(hasOverflow).toBe(false)
  })

  test('video dropzone is visible on mobile', async ({ page }) => {
    await expect(page.locator('.dropzone')).toBeVisible()
  })

  test('all 3 walkthrough steps are visible on mobile', async ({ page }) => {
    const steps = page.locator('.walkthrough-step')
    await expect(steps).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await expect(steps.nth(i).locator('.walkthrough-number')).toBeVisible()
      await expect(steps.nth(i).locator('.walkthrough-illustration')).toBeVisible()
    }
  })
})
