### Fix 3 WCAG Violations: Color Contrast, Heading Order, and Dropzone Accessible Name
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-25
- **Blockers:** none
- **Notes:** Completed in commit 79263f6 — resolved all 3 WCAG violations (color contrast, heading order, dropzone accessible name). Lighthouse accessibility audit (2026-02-25, score 94) identified 3 remaining WCAG violations after the initial contrast fix in bc2828c. (1) Four text elements use #666666 on dark backgrounds (#0f0f0f and #1a1a1a) producing contrast ratios of 3.03–3.33:1, below the 4.5:1 AA requirement — walkthrough step descriptions and about box disclaimer. (2) Heading hierarchy skips from H1 to H3 in the walkthrough section with no intervening H2, breaking the document outline for screen readers. (3) Dropzone has aria-label="Drop zone for video files" but visible text says "Drop your golf video here...", causing a name mismatch for voice control users. Fixing all three would bring the accessibility score from 94 to ~100.
- **Added:** 2026-02-24
- **Updated:** 2026-02-25

#### Acceptance Criteria
- [ ] All text elements meet WCAG AA contrast ratio (4.5:1 minimum) — change #666666 to #999999 or #8a8a8a on dark backgrounds
- [ ] Heading hierarchy follows sequential order (no H1→H3 skip) in walkthrough section
- [ ] Dropzone aria-label matches or is removed in favor of visible text as accessible name
- [ ] Lighthouse accessibility score >= 98 on mobile emulation
- [ ] Existing axe-core E2E accessibility test passes

#### Next steps
1. Search for `#666666` or `color: #666` in CSS/component files to find all low-contrast text
2. Update the color to `#999999` (6.32:1 ratio on #0f0f0f) and verify visually
3. Find the walkthrough section component, change `<h3>` tags to `<h2>` (or add a section `<h2>`)
4. Find the VideoDropzone component, remove the explicit `aria-label` or update it to match visible text
5. Run axe-core E2E test (`npm run test:e2e`) to confirm all violations resolved
