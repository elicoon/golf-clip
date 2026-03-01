### Add Axe-Core Accessibility E2E Spec to Playwright Suite
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** PR #28 manually fixed WCAG AA violations (color contrast, heading hierarchy), but there is no automated regression gate. A plan exists at docs/plans/2026-02-24-accessibility-checks.md with full implementation steps. Install `@axe-core/playwright`, create `e2e/accessibility.spec.ts`, assert zero critical/serious violations on landing page. This prevents future PRs from silently reintroducing accessibility issues. The Lighthouse CI job catches score regressions but not specific WCAG violations.
- **Added:** 2026-02-28
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] `@axe-core/playwright` installed as dev dependency in `apps/browser`
- [ ] `e2e/accessibility.spec.ts` created that navigates to landing page and runs `AxeBuilder.analyze()`
- [ ] Test asserts zero critical or serious violations
- [ ] Spec is included in the CI Playwright job and passes in GitHub Actions
- [ ] Any suppressed rules are documented with `disableRules()` and a comment explaining why

#### Next steps
1. Read `docs/plans/2026-02-24-accessibility-checks.md` for the full 9-task implementation plan
2. Run `cd apps/browser && npm install --save-dev @axe-core/playwright`
3. Create `apps/browser/e2e/accessibility.spec.ts` following the fixtures pattern in `e2e/fixtures.ts`
4. Run `npx playwright test accessibility` locally to verify zero violations
5. Confirm CI job passes with new spec included
