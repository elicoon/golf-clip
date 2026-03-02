### Add Keyboard Shortcuts Help Modal
- **Project:** golf-clip
- **Status:** in progress
- **Dispatched:** 2026-02-21-golf-clip-keyboard-shortcuts-modal
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** App has 15 powerful keyboard shortcuts (Space, arrows, [/], I, Enter, Esc, +/-/0 for zoom) but no in-app discovery. Users must read PRODUCT-WALKTHROUGH.md. Add "?" key to show modal with shortcut reference table. Improves UX for power users and discoverability for new users.
- **Added:** 2026-02-16
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] Press "?" or "h" key shows keyboard shortcuts modal
- [ ] Modal displays shortcuts grouped by category (Playback, Navigation, Editing, Zoom)
- [ ] Modal shows shortcut key + description in clean table format
- [ ] Press "?" again or Esc closes modal
- [ ] Modal does not trigger when typing in input fields
- [ ] Test verifies modal shows on "?" keypress and hides on Esc

#### Next steps
1. Create src/components/KeyboardShortcutsModal.tsx with categorized shortcut table
2. Add state and handler in ClipReview.tsx for showing/hiding modal
3. Add "?" keypress handler to keyboard event listener
4. Style modal with semi-transparent backdrop and centered card
5. Add unit test for modal show/hide behavior
