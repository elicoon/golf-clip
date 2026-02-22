### Fix Playwright E2E Test Fixture Imports to Resolve test.describe() Conflict
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** 4 of 5 Playwright E2E test suites fail because `e2e/fixtures.ts` exports a custom `test` object using `test.extend()`, but when Vitest auto-imports run, `test.describe()` resolves to Vitest's version instead of Playwright's. The tracer-renderer, zoom-pan, layout-redesign, and export-controls specs all import from fixtures and hit this conflict. The tests are syntactically correct and well-designed — they just can't execute. This blocks any E2E CI pipeline.
- **Added:** 2026-02-22
- **Updated:** 2026-02-22

#### Acceptance Criteria
- [ ] All 5 Playwright E2E test suites execute without import errors (`npx playwright test` exits cleanly)
- [ ] At least the tracer-renderer spec passes all its test cases against the dev server
- [ ] Vitest unit tests continue to pass (`npm run test` — 405+ tests pass)
- [ ] No Vitest config changes break existing test files

#### Next steps
1. Read `apps/browser/e2e/fixtures.ts` and `apps/browser/playwright.config.ts` to understand current fixture setup
2. Check `apps/browser/vite.config.ts` and `vitest.config.ts` for test file inclusion patterns — ensure E2E files are excluded from Vitest
3. Verify Playwright tests use `import { test } from '../e2e/fixtures'` correctly and that the fixture extends `@playwright/test`
4. If Vitest is scanning E2E files, add `exclude: ['e2e/**']` to the Vitest config test section
5. Run `npx playwright test` and `npm run test` to confirm both runners work independently
