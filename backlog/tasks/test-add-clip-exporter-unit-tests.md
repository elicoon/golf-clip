### Add unit tests for clip-exporter.ts export orchestration
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** clip-exporter.ts orchestrates the full export pipeline (video-frame-pipeline-v4 → mp4-muxer → download) but has zero test coverage. This is the most critical user-facing code path. Other lib modules like ffmpeg-client.ts and tracer-renderer.ts already have thorough tests — clip-exporter is the gap.
- **Added:** 2026-02-22
- **Updated:** 2026-02-22

#### Acceptance Criteria
- [x] `apps/browser/src/lib/clip-exporter.test.ts` exists with at least 6 test cases
- [ ] Tests cover: successful single-clip export, export cancellation/abort, timeout handling, error propagation from pipeline failures, progress callback invocation, cleanup on failure
- [x] All new tests pass with `npm test`
- [ ] Tests mock WebCodecs and mp4-muxer APIs (no real video encoding in tests)

#### Next steps
1. Read clip-exporter.ts to map all public functions and error paths
2. Create clip-exporter.test.ts with mocks for VideoEncoder, mp4-muxer, and canvas APIs
3. Write tests for happy path, cancellation, timeout, pipeline error, progress tracking, and cleanup
4. Run `npm test` and verify all pass
