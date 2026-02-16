### Fix Header Layout Overflow on Mobile Viewports
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** User testing (UT v2) found that on narrow viewports (375px / mobile), header buttons stack and truncate. The "New Video" button becomes hidden or inaccessible. The header layout needs responsive CSS adjustments so controls remain accessible on small screens. The header contains: h1 "GolfClip", VideoQueue component, ReviewActions component, and "New Video" button.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] At 375px viewport width, all header elements are visible and tappable (no overflow/truncation)
- [ ] Header wraps gracefully — either stacks vertically or uses a compact layout on narrow screens
- [ ] "New Video" button remains accessible at all viewport widths
- [ ] Review action buttons (No Golf Shot / Next) remain usable on mobile
- [ ] No horizontal scrollbar appears at any standard mobile width (320px-428px)
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. In `global.css`, add a media query for `.app-header` at `max-width: 480px` that adjusts flex-wrap, font sizes, and button sizing
2. Consider collapsing or abbreviating labels on narrow screens (e.g., shorter button text)
3. Test at 375px (iPhone SE), 390px (iPhone 14), and 428px (iPhone 14 Pro Max) widths
