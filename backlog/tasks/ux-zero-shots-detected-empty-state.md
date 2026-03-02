### Show "no shots detected" empty state after processing completes with 0 results
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** When audio detection completes but finds 0 shots, App.tsx stays silently on the upload screen — the auto-transition to review only fires when `segments.length > 0` (App.tsx lines 31–38). Users with quiet videos get no feedback: no error, no message, no indication that processing ran at all. This is a first-run UX failure — new users will think the app is broken. Fix: detect the `status === 'ready' && segments.length === 0` condition in App.tsx and display an inline message with actionable guidance ("No shots detected. Make sure your video has audible club impact sounds.").
- **Added:** 2026-03-02
- **Updated:** 2026-03-02

#### Acceptance Criteria
- [ ] When processing completes with 0 segments, a "No shots detected" message appears on the upload screen (not a blank screen)
- [ ] The message includes a brief explanation ("No golf shot sounds were detected in your video")
- [ ] A "Try Another Video" or "Upload Again" button is shown to restart the flow
- [ ] The app does not auto-navigate away from upload when segments.length is 0
- [ ] Existing happy-path auto-transition to review (segments.length > 0) is unaffected

#### Next steps
1. Read App.tsx — find both useEffect hooks that auto-transition to 'review' (lines ~31–38) and understand the condition gap for segments.length === 0
2. Add a condition: when `status === 'ready' && segments.length === 0`, render an inline empty-state div inside the `view === 'upload'` block with the message and a "Try Again" button that calls `handleReset()`
3. Add a unit test asserting the empty state renders when store status is 'ready' with no segments
