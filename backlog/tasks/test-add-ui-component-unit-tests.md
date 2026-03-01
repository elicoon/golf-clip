### Add Unit Tests for Untested UI Components
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Six UI components have no test coverage: ConfirmDialog, ExportOptionsPanel, HevcTranscodeModal, TracerConfigPanel, VideoQueue, WalkthroughSteps. ExportOptionsPanel is particularly high-value — it handles GPU capability detection and export method selection, which is user-facing logic that could break silently. TracerConfigPanel handles shot shape/height/flight-time inputs used in trajectory generation. VideoQueue renders multi-video upload progress. Adding focused render + interaction tests brings them into coverage reporting and catches regressions during refactors.
- **Added:** 2026-02-28
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] `ExportOptionsPanel.test.tsx` renders without crashing and tests resolution selection and export button click
- [ ] `TracerConfigPanel.test.tsx` verifies shape/height/flight-time controls call their callbacks with correct values
- [ ] `VideoQueue.test.tsx` renders queued videos with correct status labels
- [ ] `ConfirmDialog.test.tsx` verifies confirm/cancel callbacks fire correctly
- [ ] `WalkthroughSteps.test.tsx` renders expected step labels
- [ ] All 5 new test files pass in `vitest` and are counted in coverage report

#### Next steps
1. Read each component file to understand props and internal logic before writing tests
2. Start with `ExportOptionsPanel.test.tsx` — mock `detectGpuCapabilities` from `gpu-detection.ts` and verify recommended option is auto-selected
3. Write `TracerConfigPanel.test.tsx` — render with mock callbacks, click each button group option, verify correct value passed to `onConfigChange`
4. Write remaining 3 component tests (ConfirmDialog, VideoQueue, WalkthroughSteps) as straightforward render + prop tests
5. Run `cd apps/browser && npx vitest run --coverage` and verify new files appear in coverage output
