### Rename codec-detector.test.ts to Match ffmpeg-client.ts Source Module
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** `apps/browser/src/lib/codec-detector.test.ts` tests the `detectVideoCodec` function, but no `codec-detector.ts` source file exists. The function actually lives in `ffmpeg-client.ts`. The test file works around this by mocking `ffmpeg-client` inline, which is confusing for developers and misrepresents the module structure. Rename to `ffmpeg-client-codec-detection.test.ts` (or merge into existing `ffmpeg-client.test.ts` if one exists).
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] No test file references a non-existent source module (`codec-detector.ts` no longer appears as a test filename)
- [ ] All codec detection tests still pass after rename/move

#### Next steps
1. Check if `ffmpeg-client.test.ts` already exists — if so, merge codec detection tests into it
2. If not, rename `codec-detector.test.ts` to `ffmpeg-client-codec-detection.test.ts`
3. Update any import paths and run full test suite to verify
