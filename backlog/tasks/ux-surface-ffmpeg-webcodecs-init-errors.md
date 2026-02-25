### Surface FFmpeg and WebCodecs Initialization Failures to User
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** FFmpeg WASM initialization and WebCodecs API setup both use try/catch with silent failures throughout the codebase. When FFmpeg fails to load (WASM fetch failure, CORS issues, memory limits) or WebCodecs isn't available (Firefox, older browsers), the user sees no feedback — operations just silently fail or hang. The app should detect these failures at startup/first-use and show a clear message explaining what happened and what the user can do (e.g., "Your browser doesn't support video export — try Chrome or Edge").
- **Added:** 2026-02-22
- **Actual completion:** 2026-02-22
- **Updated:** 2026-02-23

#### Acceptance Criteria
- [x] FFmpeg WASM load failure displays user-visible error message (not just console.error)
- [x] WebCodecs unavailability (e.g., Firefox) shows clear message before user attempts export
- [x] Error messages include actionable guidance (browser recommendation or retry option)
- [x] Existing error flows (export timeout, codec detection) still work as before
- [x] Unit test verifies error state is set when FFmpeg initialization throws

#### Next steps
1. Read `apps/browser/src/lib/ffmpeg-client.ts` to find FFmpeg initialization and identify all silent catch blocks
2. Read `apps/browser/src/lib/gpu-detection.ts` and `video-frame-pipeline-v4.ts` to find WebCodecs capability checks
3. Add an `initError` state to the processing store (or use existing error state patterns)
4. In FFmpeg client, catch init failures and set the error state with a descriptive message
5. In the upload or review view, check for init errors and render an inline banner/alert
6. Add test for FFmpeg init failure path
