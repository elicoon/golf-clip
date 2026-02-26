### Add Mobile Viewport Playwright E2E Specs
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** All 4 existing Playwright E2E specs run on a desktop viewport (1280x720). The Lighthouse audit was performed on a Moto G Power mobile emulation, and the app is deployed for mobile users at golfclip.elicoon.com. No mobile viewport tests exist, meaning responsive layout regressions, touch target sizing issues, and mobile-specific CSS breakpoint bugs go undetected. Playwright supports device emulation natively via `devices['Pixel 5']` or custom viewport configs.
- **Added:** 2026-02-25
- **Updated:** 2026-02-25

#### Acceptance Criteria
- [ ] `playwright.config.ts` includes a `mobile` project using a mobile device profile (e.g., Pixel 5 or iPhone 13)
- [ ] At least 2 mobile-specific E2E specs exist: landing page layout and video dropzone interaction
- [ ] Mobile specs verify touch target sizes meet WCAG 2.2 minimum (24x24 CSS pixels)
- [ ] `npm run test:e2e` runs both desktop and mobile specs
- [ ] CI workflow runs mobile specs alongside existing desktop specs

#### Next steps
1. Read `apps/browser/playwright.config.ts` to understand the current project configuration and device setup
2. Add a `mobile` project to `playwright.config.ts` using `devices['Pixel 5']` with appropriate viewport and user agent
3. Create `apps/browser/src/__tests__/mobile-landing.spec.ts` with specs for landing page responsive layout, dropzone visibility, and walkthrough step readability
4. Create `apps/browser/src/__tests__/mobile-dropzone.spec.ts` with specs for file upload interaction and touch target sizing
5. Run `npm run test:e2e` locally and verify both desktop and mobile specs pass
