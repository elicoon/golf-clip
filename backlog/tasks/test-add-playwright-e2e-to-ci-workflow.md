### Add Playwright E2E Smoke Tests to CI Workflow
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Actual completion:** 2026-02-24
- **Blockers:** none
- **Notes:** 4 Playwright E2E spec files exist and were recently fixed (import conflict resolved in commit 26b20f0), but CI only runs Vitest unit tests. E2E tests validate the full user flow (video upload, shot detection, export) and would catch integration regressions that unit tests miss. Playwright has first-class CI support with `npx playwright install --with-deps`.
- **Added:** 2026-02-23
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [x] CI workflow has a separate `e2e` job that runs after the `test` job passes
- [x] Playwright browsers are installed in CI via `npx playwright install --with-deps chromium`
- [x] E2E tests run against a production build (`npm run build` + `npx vite preview`)
- [x] E2E job uploads Playwright HTML report and trace artifacts on failure
- [x] All 4 existing E2E spec files execute and pass in CI

#### Next steps
1. Read `apps/browser/playwright.config.ts` to understand current E2E configuration (baseURL, webServer, browser settings)
2. Add `e2e` job to `.github/workflows/test.yml` that depends on the `test` job
3. Configure the job to install Chromium, build the app, start a preview server, and run `npm run test:e2e`
4. Add `actions/upload-artifact` step for Playwright report on failure
5. Run the workflow on a test branch to verify all specs pass
