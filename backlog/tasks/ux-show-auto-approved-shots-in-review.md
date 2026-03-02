### Show count of auto-approved shots before review and allow optional inspection
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** ClipReview shows only `shotsNeedingReview` — segments with confidence < 0.7 and pending approval (ClipReview.tsx lines 153–155). High-confidence shots (≥ 0.7) are auto-approved and silently exported without ever being shown to the user. For a typical round with 18 shots, perhaps 12 are auto-approved and 6 are manually reviewed — but the user never sees the 12 auto-approved shots and cannot catch false positives among them. A minimal fix: (1) show the auto-approved count at the top of ClipReview ("12 shots auto-approved at high confidence — [Review anyway]"), and (2) after the manual review queue is exhausted, offer an "Also review auto-approved shots" secondary queue. This gives users visibility without forcing them to review every shot.
- **Added:** 2026-03-02
- **Updated:** 2026-03-02

#### Acceptance Criteria
- [ ] ClipReview header shows "N shots auto-approved" count alongside the manual review queue count
- [ ] After exhausting the low-confidence review queue, a prompt appears: "N additional shots were auto-approved. Review them? [Yes] [Skip to export]"
- [ ] Selecting "Yes" enters a secondary review queue of auto-approved shots where users can un-approve (reject) any
- [ ] Selecting "Skip to export" (or if no auto-approved shots exist) proceeds directly to the export screen
- [ ] Auto-approved count of 0 does not show the secondary prompt

#### Next steps
1. Read ClipReview.tsx lines 150–170 to understand the `shotsNeedingReview` filter and `onComplete` flow
2. Add `const autoApprovedShots = segments.filter(s => s.approved === 'approved')` and display the count in the review header
3. At the review complete state (when `shotsNeedingReview` is empty), show a secondary prompt with the auto-approved count and a toggle to enter an optional second pass queue
