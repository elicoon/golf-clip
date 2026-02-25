### Add Lighthouse CI Performance and Accessibility Gates to GitHub Actions
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Lighthouse baseline (2026-02-25) established scores of Perf 99, A11y 94, BP 100, SEO 90 on golfclip.elicoon.com. Recent work fixed 3 WCAG violations and raised accessibility from 84→94. Without CI enforcement, these scores will silently regress as features are added. Lighthouse CI (`@lhci/cli`) can run budget assertions against a Vite preview build in GitHub Actions, failing PRs that drop below configured thresholds. This protects the quality investment made in the past week.
- **Added:** 2026-02-25
- **Updated:** 2026-02-25

#### Acceptance Criteria
- [ ] GitHub Actions workflow includes a `lighthouse` job that runs after the `build` step
- [ ] Lighthouse CI runs against `npx vite preview` with budget assertions for: Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 95, SEO ≥ 85
- [ ] CI fails with a clear message when any score drops below the configured threshold
- [ ] Lighthouse HTML report is uploaded as a GitHub Actions artifact on every run
- [ ] Lighthouse job completes in under 3 minutes

#### Next steps
1. Read `.github/workflows/test.yml` and `apps/browser/vite.config.ts` to understand the existing CI pipeline and build setup
2. Install `@lhci/cli` as a dev dependency and create `lighthouserc.js` with budget assertions matching the documented baseline scores
3. Add a `lighthouse` job to `test.yml` that builds the app, starts a preview server, and runs `lhci autorun`
4. Add `actions/upload-artifact` step for the Lighthouse HTML report
5. Run the workflow on a test branch and verify budget assertions pass against current scores
