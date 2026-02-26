### Run Lighthouse Performance Audit on Production Site and Document Baseline
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** research
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-24
- **Blockers:** none
- **Notes:** Completed in commit 2abde3c — Lighthouse audit baseline documented for golfclip.elicoon.com.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] `docs/research/lighthouse-audit-baseline.md` exists with Performance, Accessibility, Best Practices, and SEO scores
- [ ] At least 3 actionable findings documented with specific metrics (e.g., LCP time, bundle size, unused JS bytes)

#### Next steps
1. Run `npx lighthouse https://golfclip.elicoon.com --output=json --output-path=lighthouse-report.json` (or use Playwright + Lighthouse CI)
2. Create `docs/research/` directory and write `lighthouse-audit-baseline.md` summarizing scores and top findings
3. Cross-reference findings with existing backlog items (PWA, OG tags) and note which items address which Lighthouse issues
