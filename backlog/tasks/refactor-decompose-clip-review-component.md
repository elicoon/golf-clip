### Extract video player and export panel from ClipReview.tsx into sub-components
- **Project:** golf-clip
- **Status:** in progress
- **Dispatched:** 2026-02-22-golf-clip-decompose-clip-review
- **Priority:** medium
- **Type:** refactor
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** ClipReview.tsx is 1406 lines handling video playback, scrubbing, export controls, tracer configuration, trajectory editing, and keyboard shortcuts in a single file. Extracting focused sub-components would reduce merge conflicts, simplify testing, and make upcoming UX features (audio unmute toggle, draggable control points, keyboard shortcuts modal) easier to implement.
- **Added:** 2026-02-22
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] VideoPlayer sub-component extracted — handles video element, play/pause, seeking, zoom/pan (roughly lines related to video playback state and refs)
- [ ] ExportPanel sub-component extracted — handles export button, progress display, timeout/retry UI
- [ ] ClipReview.tsx reduced to under 900 lines while maintaining identical behavior
- [ ] All existing ClipReview tests pass without modification (or with minimal import path changes)
- [ ] No visual or behavioral regressions confirmed by running `npm test`

#### Next steps
1. Map ClipReview.tsx into logical sections: video playback, export, tracer config, navigation, keyboard shortcuts
2. Extract VideoPlayer component with video element management, play/pause, seeking, and zoom state
3. Extract ExportPanel component with export trigger, progress bar, timeout/retry UI
4. Update ClipReview.tsx to compose the new sub-components
5. Run full test suite and verify no regressions
