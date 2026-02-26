### Add FFmpeg WASM Initialization Progress Indicator
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** FFmpeg WASM (`@ffmpeg/ffmpeg`) can take 2–5+ seconds to load and initialize on first use, especially on slower connections. Currently there is no visible feedback during this phase — the UI appears unresponsive until initialization completes. This creates a confusing UX where users may think the app has frozen. The `ffmpeg-client.ts` module handles initialization; it should emit progress events (FFmpeg's `log` and `progress` callbacks can provide load progress) that are surfaced to the user via a loading indicator on the upload screen. Should show "Loading audio engine… X%" or a spinner with status text, then disappear once ready.
- **Added:** 2026-02-26
- **Updated:** 2026-02-26

#### Acceptance Criteria
- [ ] A loading indicator (spinner + status text) is visible on the upload screen while FFmpeg WASM initializes
- [ ] Indicator shows "Loading audio engine…" with either a % progress or indeterminate spinner
- [ ] Indicator disappears and upload dropzone becomes interactive once FFmpeg is ready
- [ ] If init fails, the error state from `ux-surface-ffmpeg-webcodecs-init-errors` is shown (no regression)
- [ ] Unit test covers the loading state rendering in `VideoDropzone` or parent component

#### Next steps
1. Add `initProgress` state to `processingStore.ts` (e.g. `ffmpegInitStatus: 'idle' | 'loading' | 'ready' | 'error'`)
2. Wire FFmpeg `on('log', ...)` or fetch progress in `ffmpeg-client.ts` to dispatch store updates
3. Render `<LoadingSpinner label="Loading audio engine…" />` in `VideoDropzone.tsx` when status is 'loading'
