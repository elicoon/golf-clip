### Add axe-core Accessibility Checks to Playwright E2E Suite
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-24
- **Blockers:** none
- **Notes:** GolfClip is a public SaaS at golfclip.elicoon.com with no automated accessibility testing. Components use some aria attributes but there is no baseline audit. The Playwright E2E infrastructure is already in CI, so adding @axe-core/playwright requires minimal setup and gives immediate visibility into WCAG violations. This establishes an a11y quality gate that prevents regressions as new UI features ship.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] `@axe-core/playwright` is installed as a devDependency
- [ ] At least one E2E test runs axe accessibility scan on the landing page (VideoDropzone)
- [ ] Any critical or serious axe violations fail the E2E test
- [ ] Test output reports specific violations with element selectors and WCAG rule IDs
- [ ] Existing critical/serious violations are either fixed or explicitly documented with rationale

#### Next steps
1. Install `@axe-core/playwright` as a devDependency in `apps/browser/`
2. Create `apps/browser/e2e/accessibility.spec.ts` with a test that loads the app and runs `new AxeBuilder({ page }).analyze()`
3. Assert zero critical and serious violations; log moderate/minor as warnings
4. Run the test locally to get the initial violation report
5. Fix any critical/serious violations found (likely color contrast or missing labels)
6. Verify the test passes in CI alongside existing E2E tests
