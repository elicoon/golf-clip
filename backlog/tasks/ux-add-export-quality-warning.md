### Surface Export Quality Warning When Clip Is Suspiciously Small
- **Project:** golf-clip
- **Status:** not started
- **Priority:** low
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** FEATURES.md documents that "export files under 10MB typically indicate quality issues" such as low framerate (should be ~60fps for 60fps source), missing video content (just tracer on black), or excessive compression. Currently users have no way to know their export silently failed quality-wise — they only discover it after downloading and playing the file. The exported Blob is available in memory after the pipeline completes, so a size check before triggering the download is straightforward. A non-blocking inline warning banner (not a modal) is sufficient — the user can still download if they choose.
- **Added:** 2026-02-28
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] After export completes, the exported Blob size is checked before download is triggered
- [ ] If Blob size < 10MB, a visible warning banner appears in the clip review UI explaining possible quality issue
- [ ] Warning includes a brief explanation ("Low file size may indicate encoding issues — check framerate and video content")
- [ ] User can still download the file despite the warning (warning is non-blocking)
- [ ] Warning does not appear for clips where small size is expected (e.g., clips genuinely shorter than 2 seconds)
- [ ] Unit test verifies warning state is set when mock export returns a Blob under 10MB

#### Next steps
1. Read `ClipReview.tsx` export flow to find where the exported Blob is handed off for download
2. Add `exportQualityWarning: string | null` state to track the warning message
3. After export pipeline returns, check `blob.size < 10_000_000 && clipDurationSeconds > 2` and set warning state
4. Render warning banner below the export button when `exportQualityWarning` is set
5. Add test in `ClipReview.export.test.tsx` that mocks the pipeline to return a small Blob and verifies warning renders
