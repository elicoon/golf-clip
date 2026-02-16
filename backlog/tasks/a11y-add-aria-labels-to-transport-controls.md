### Add aria-labels and title Attributes to Video Transport Controls
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The video transport buttons in ClipReview.tsx (⏮ ⏪ ▶ ⏩ ⏭) use emoji/icon text but lack `aria-label` and `title` attributes. Screen readers cannot identify button purpose. The confidence badge also doesn't announce its value. Keyboard shortcut hints are visual-only. This is a WCAG 2.1 compliance gap identified during code review.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] All transport control buttons have `aria-label` attributes describing their function (e.g., "Skip to start", "Step back one frame", "Play", "Step forward one frame", "Skip to end")
- [ ] All transport control buttons have `title` attributes matching the aria-labels (for mouse hover tooltips)
- [ ] The confidence badge has an `aria-label` that includes the confidence percentage and level (e.g., "92% confidence, high")
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. In `ClipReview.tsx`, locate the transport control buttons (around lines 1049-1084) and add `aria-label` and `title` to each
2. Add `aria-label` to the confidence badge element (around line 1126)
3. Run the test suite to confirm no regressions
