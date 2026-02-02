# Test Reports

This directory tracks test-feature runs over time to monitor quality trends.

## Report Index

| Date | Time | Target | Pass Rate | Critical Bugs | Report |
|------|------|--------|-----------|---------------|--------|
| 2026-02-01 | 13:00 | Browser App (Vercel) | 93% (13/14) | 1 | [2026-02-01-1300-browser-e2e.md](2026-02-01-1300-browser-e2e.md) |

## Quality Trends

```
Pass Rate Over Time
────────────────────────────────────────────────────
2026-02-01 13:00  ████████████████████████████████░░░ 93%  Browser E2E
────────────────────────────────────────────────────
Target: 100%      ██████████████████████████████████████
```

## Bug Tracking

| Bug ID | Date | Time | Severity | Status | Description |
|--------|------|------|----------|--------|-------------|
| B-2026-02-01-001 | 2026-02-01 | 13:00 | Critical | Open | HEVC transcoding resets UI |

---

## How to Add a New Report

1. Run `/dev-org:test-feature` on your target
2. Report ID format: `TR-{YYYY-MM-DD}-{HHMM}-{target-slug}`
3. Create report file: `{YYYY-MM-DD}-{HHMM}-{target-slug}.md`
4. Update this README:
   - Add row to Report Index table
   - Update Quality Trends chart
   - Add any new bugs to Bug Tracking table
5. Create bug reports in `docs/bugs/` for any failures

## Report Template

See the test-feature skill (`/dev-org:test-feature`) for the full report template.
