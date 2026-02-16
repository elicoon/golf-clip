### Bug: Frame step buttons don't produce visible video frame changes
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** medium
- **Dispatch effort:** 1 hr
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Related to bug-transport-buttons-not-clickable (partially fixed — buttons now pause, but frame step still doesn't visibly change the video frame). Tracer animation updates correctly but the underlying video frame stays the same. The issue is likely that `currentTime += 1/60` doesn't reliably seek to the next decoded video frame in HTML5 video. May need to use `requestVideoFrameCallback` or `video.seekToNextFrame()` (if available) instead of raw currentTime arithmetic.
- **Added:** 2026-02-15
- **Updated:** 2026-02-15

#### Acceptance Criteria
- [ ] Clicking ⏩ 10 times in a row produces 10 distinct visible video frames
- [ ] Clicking ⏪ 10 times in a row produces 10 distinct visible video frames (reversing)
- [ ] Tracer animation position updates correctly with each frame step
- [ ] Works on production (Vercel) not just localhost

#### Next steps
1. Debug: instrument frame step to log actual currentTime before/after each click
2. Research HTML5 video frame-accurate seeking APIs
3. Test if the video actually has enough frames (check FPS of test video)
4. Implement fix using reliable frame stepping method
