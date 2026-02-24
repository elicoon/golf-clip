### Configure Vitest Code Coverage with Minimum Thresholds
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** 25 unit test files exist but no coverage reporting is configured. Adding coverage metrics prevents silent regression — new code can pass tests while reducing overall coverage. Setting a baseline threshold now (based on current coverage) creates a ratchet that only moves up.
- **Added:** 2026-02-23
- **Updated:** 2026-02-23

#### Acceptance Criteria
- [ ] `@vitest/coverage-v8` installed as devDependency in `apps/browser`
- [ ] `vite.config.ts` includes coverage config with `provider: 'v8'` and threshold settings (lines, branches, functions)
- [ ] `npm run test:coverage` script exists and produces a coverage report
- [ ] CI workflow includes coverage reporting step that fails if thresholds are not met
- [ ] Thresholds are set to current baseline (measure first, then set — no arbitrary numbers)

#### Next steps
1. Install `@vitest/coverage-v8` in `apps/browser`
2. Run `npx vitest --coverage` to measure current baseline coverage
3. Add coverage config to `vite.config.ts` with thresholds set at or slightly below current baseline
4. Add `"test:coverage": "vitest run --coverage"` script to `apps/browser/package.json`
5. Update CI workflow to run `npm run test:coverage` instead of `npm test`
