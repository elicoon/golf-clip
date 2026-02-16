# Debug Findings: Transport Buttons Not Clickable

**Date:** 2026-02-15
**Bug:** transport-buttons-not-clickable
**Status:** Root cause identified

## Summary

All 5 transport button handlers fire correctly and produce the expected `video.currentTime` changes. The buttons are NOT broken — the effects are imperceptible to the user because the buttons don't pause playback first.

## Evidence

### Playwright Testing (localhost + Vercel production)

All tests performed with console.log instrumentation in handlers.

| Button | Handler Fires? | Time Changes? | Visible Effect? |
|--------|---------------|---------------|-----------------|
| ⏮ Skip to start | YES | YES (→ 0.00) | NO — auto-loop already near start |
| ⏪ Step back | YES | YES (-0.017s) | NO — 1/60s change overridden by playback |
| ▶/⏸ Play/Pause | YES | N/A | YES — video starts/stops |
| ⏩ Step forward | YES | YES (+0.017s) | NO — 1/60s change overridden by playback |
| ⏭ Skip to end | YES | YES (→ 5.00) | NO — auto-loop immediately restarts |

### Console Output (all handlers fire)

```
[DEBUG] togglePlayPause called, videoRef: true isPlaying: true
[DEBUG] stepFrameForward called, videoRef: true currentTime: 2.0
[DEBUG] stepFrameForward after: 2.016666
[DEBUG] skipToStart called, videoRef: true currentShot: true
[DEBUG] skipToStart seeking to: 0
[DEBUG] skipToEnd called, videoRef: true currentShot: true
[DEBUG] skipToEnd seeking to: 5
```

## Root Cause

**The transport buttons don't pause the video before executing their action.** This causes:

1. **Frame step during playback**: 1/60s advance is instantly overridden by continued playback (~16ms later the video has moved past the step anyway)
2. **Skip-to-start during auto-loop**: Video is already looping back to start, so seeking to start produces no visible change
3. **Skip-to-end during playback**: Auto-loop detects clipEnd reached within one timeupdate tick (~250ms), pauses, waits 750ms, restarts — indistinguishable from normal loop behavior

This is a UX bug, not a code bug. Every standard video editor (Premiere Pro, DaVinci Resolve, etc.) pauses playback when frame-stepping or skipping.

## Fix

All 4 non-play buttons should:
1. Pause the video (`videoRef.current.pause()`)
2. Update isPlaying state (`setIsPlaying(false)`)
3. Cancel any pending auto-loop timeout
4. Then execute the seek/step

The `togglePlayPause` handler should remain unchanged.

## Files to Modify

- `apps/browser/src/components/ClipReview.tsx` — lines 614-634 (stepFrameForward, stepFrameBackward, skipToStart, skipToEnd)
