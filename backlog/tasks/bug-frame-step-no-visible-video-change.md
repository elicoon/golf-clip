### Bug: Frame step buttons don't produce visible video frame changes
- **Project:** golf-clip
- **Status:** done
- **Priority:** high
- **Type:** bug-fix
- **Scope:** medium
- **Dispatch effort:** 1 hr
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Related to bug-transport-buttons-not-clickable (partially fixed — buttons now pause, but frame step still doesn't visibly change the video frame). Tracer animation updates correctly but the underlying video frame stays the same. The issue is likely that `currentTime += 1/60` doesn't reliably seek to the next decoded video frame in HTML5 video. May need to use `requestVideoFrameCallback` or `video.seekToNextFrame()` (if available) instead of raw currentTime arithmetic.
- **Added:** 2026-02-15
- **Updated:** 2026-02-16
- **Actual completion:** 2026-02-16

#### Acceptance Criteria
- [x] Clicking ⏩ 10 times in a row produces 10 distinct visible video frames
- [x] Clicking ⏪ 10 times in a row produces 10 distinct visible video frames (reversing)
- [x] Tracer animation position updates correctly with each frame step
- [x] Works on production (Vercel) not just localhost

#### Fix Applied
- Root cause: Video is 30fps but step was hardcoded 1/60s — every other click landed on same frame
- Fix: Detect FPS via requestVideoFrameCallback, snap to frame boundaries, update React state on seek
- Commit: 5a3efcc
