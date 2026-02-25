import { test, expect } from './fixtures'
import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility', () => {
  test('landing page has no critical or serious violations', async ({ app, page }) => {
    await app.goto()

    const results = await new AxeBuilder({ page }).analyze()

    // Log all violations for visibility
    if (results.violations.length > 0) {
      console.log('\n=== Axe Accessibility Violations ===\n')
      for (const violation of results.violations) {
        const impact = violation.impact ?? 'unknown'
        const nodes = violation.nodes
          .map((n) => `    - ${n.html}\n      Fix: ${n.failureSummary}`)
          .join('\n')
        console.log(`[${impact.toUpperCase()}] ${violation.id}: ${violation.description}`)
        console.log(`  WCAG: ${violation.tags.filter((t) => t.startsWith('wcag')).join(', ')}`)
        console.log(`  Help: ${violation.helpUrl}`)
        console.log(`  Elements:\n${nodes}\n`)
      }
    }

    // Filter critical and serious violations
    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    )

    expect(
      criticalOrSerious,
      `Found ${criticalOrSerious.length} critical/serious accessibility violations:\n` +
        criticalOrSerious.map((v) => `  - [${v.impact}] ${v.id}: ${v.description}`).join('\n'),
    ).toHaveLength(0)
  })
})
