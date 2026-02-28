### Add Export Retry Button After Timeout Error
- **Project:** golf-clip
- **Status:** in progress
- **Dispatched:** 2026-02-21-golf-clip-export-retry-timeout
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Timeout handling was added in recent commit (1cb6a81) but error modal only shows "Close" button. Users must dismiss error and re-export manually. Add "Retry" button to timeout error modal to resume export immediately. Improves UX by reducing clicks and friction when timeouts occur.
- **Added:** 2026-02-16
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] Export timeout error modal shows two buttons: "Retry" and "Close"
- [ ] "Retry" button re-triggers export with same configuration (resolution, tracer settings)
- [ ] Export state is reset before retry (progress, phase, error cleared)
- [ ] Non-timeout errors still show only "Close" button (retry may not make sense)
- [ ] Test verifies retry button triggers new export after timeout

#### Next steps
1. Update export error modal in ClipReview.tsx to conditionally show "Retry" button when isTimeoutError is true
2. Add handleRetryExport function that resets export state and calls handleExport again
3. Wire "Retry" button click to handleRetryExport
4. Add unit test that simulates timeout error and verifies retry button appears and works
