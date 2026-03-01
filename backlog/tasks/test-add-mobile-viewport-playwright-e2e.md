### Add Mobile Viewport Playwright E2E Tests
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-26
- **Blockers:** none
- **Notes:** All current Playwright E2E specs run at desktop viewport only. Golf app users commonly access on mobile devices (reviewing shots on the course). No mobile viewport CI coverage means regressions on small screens go undetected. Addresses the stale `gc-mobile-viewport-e2e` dispatch. Target devices: iPhone 12 (390×844) and Pixel 5 (393×851). Tests should cover: video dropzone is tappable, walkthrough steps render correctly at narrow width, zoom/pan controls are accessible, and export button is reachable without horizontal scroll.
- **Added:** 2026-02-26
- **Updated:** 2026-02-27

#### Acceptance Criteria
- [x] New spec file `apps/browser/e2e/mobile.spec.ts` runs at 390×844 viewport
- [x] Tests cover: dropzone visible and interactable, walkthrough steps render, no horizontal overflow on main views
- [x] Mobile tests run as a separate project in `playwright.config.ts` (device: 'iPhone 12')
- [x] All mobile specs pass in CI (added to `.github/workflows/test.yml` E2E job)

#### Next steps
1. Add `{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } }` project to `playwright.config.ts`
2. Create `apps/browser/e2e/mobile.spec.ts` with viewport-specific assertions (dropzone visible, no x-overflow, touch-target sizes ≥ 44px)
3. Confirm mobile project runs in CI E2E job and passes against test server
