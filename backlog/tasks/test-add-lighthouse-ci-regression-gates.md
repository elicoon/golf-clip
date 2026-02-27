### Add Lighthouse CI Regression Gates for Performance and Accessibility
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-26
- **Blockers:** none
- **Notes:** A Lighthouse audit baseline was established on 2026-02-24: Performance 99, Accessibility 94, Best Practices 100, SEO 90 (see docs/research/lighthouse-audit-baseline.md). Without CI gates, future PRs can silently regress these scores. `@lhci/cli` (Lighthouse CI) can run audits on a built preview and fail the build if scores drop below thresholds. This directly addresses the stale `gc-lighthouse-ci-gates` dispatch. Configure conservative thresholds initially (perf ≥ 90, a11y ≥ 90, SEO ≥ 85) to catch regressions without being brittle.
- **Added:** 2026-02-26
- **Updated:** 2026-02-27

#### Acceptance Criteria
- [x] `.lighthouserc.js` (or `.lighthouserc.json`) config committed to repo root with score thresholds
- [x] `lhci autorun` step added to `.github/workflows/test.yml` that builds app and runs Lighthouse
- [x] CI fails on a PR that introduces a performance or accessibility regression below threshold
- [x] CI passes on current master build with baseline scores

#### Next steps
1. Install `@lhci/cli` as a devDependency in `apps/browser/package.json`
2. Create `.lighthouserc.js` with `url: 'http://localhost:4173'`, assert thresholds perf≥90, a11y≥90, SEO≥85, BP≥95
3. Add `lighthouse` job to `.github/workflows/test.yml` that runs `npm run build && npm run preview` then `lhci autorun`
