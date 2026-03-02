### Add beforeunload warning when user navigates away with unsaved clips in review
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** GolfClip is fully client-side with no persistence — all processed clips live only in browser memory. If a user accidentally closes the tab, refreshes, or navigates away while in the 'review' view, all their processed clips and review progress are lost permanently. There is currently no `beforeunload` or `visibilitychange` guard. The fix is a standard `window.addEventListener('beforeunload', handler)` that fires only when there are pending/approved segments (i.e., `view === 'review'` and `segments.length > 0`). This matches the behavior of Google Docs, Figma, and other stateful web apps. The warning should be cleared once the user resets or completes export.
- **Added:** 2026-03-02
- **Updated:** 2026-03-02

#### Acceptance Criteria
- [ ] Navigating away (tab close, page refresh, back button) while in review view with 1+ segments triggers a browser confirmation dialog
- [ ] The warning is NOT shown on the upload or export-complete views
- [ ] The warning is NOT shown if segments array is empty
- [ ] After clicking "Process Another Video" (handleReset), the warning listener is removed
- [ ] Unit test mocks `window.addEventListener` and verifies the beforeunload handler is added when entering review state and removed on reset

#### Next steps
1. In App.tsx, add a `useEffect` that registers `window.addEventListener('beforeunload', preventUnload)` when `view === 'review' && segments.length > 0`, and removes it on cleanup or when view changes away from 'review'
2. The handler function should call `e.preventDefault()` and set `e.returnValue = ''` (cross-browser pattern)
3. Test manually: upload a video, enter review, refresh — confirm the browser shows "Changes you made may not be saved"; confirm no dialog on upload screen
