### Add Confirmation Dialogs for Destructive Actions (Escape Key + "No Golf Shot" Button)
- **Project:** golf-clip
- **Status:** done
- **Priority:** high
- **Type:** bug-fix
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Both user testing sessions (UT v1 and v2) flagged this as critical. Pressing Escape or clicking "No Golf Shot" permanently rejects a shot with zero confirmation and no undo. One accidental keypress = lost work. UT v1 rated comfort 2/5 partly due to this. The fix requires adding a confirmation dialog before both destructive actions, and optionally an undo mechanism.
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [x] Pressing Escape during shot review shows a confirmation dialog ("Skip this shot?") before rejecting
- [x] Clicking "No Golf Shot" shows a confirmation dialog before marking as false positive
- [x] Both dialogs have "Cancel" (default/focused) and "Confirm" buttons
- [x] Accidental Escape press does NOT reject the shot (dialog must be confirmed)
- [x] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. Add a reusable `ConfirmDialog` component (or inline modal) that accepts a message and onConfirm/onCancel callbacks
2. In `ClipReview.tsx`, wrap the Escape key handler and "No Golf Shot" click handler to show the dialog instead of immediately rejecting
3. Add tests for both confirmation flows (Escape key and button click)
