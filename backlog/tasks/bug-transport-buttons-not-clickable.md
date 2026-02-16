# Bug: Transport Buttons Not Clickable (Only Play Works)

**Date:** 2026-02-15
**Status:** FIXED
**Severity:** High
**Component:** Browser ClipReview UI

## Symptoms

In the clip review screen, only the Play/Pause (▶/⏸) transport button works. The other four buttons do nothing when clicked:
- ⏮ Skip to clip start — no effect
- ⏪ Step back 1 frame — no effect
- ⏩ Step forward 1 frame — no effect
- ⏭ Skip to clip end — no effect

## Reproduction Steps

1. Open the app (either localhost:5173 or Vercel production)
2. Upload a golf video
3. Wait for shot detection to complete
4. Enter clip review screen
5. Click any transport button other than Play — nothing happens
6. Click Play — video plays/pauses correctly

## Expected Behavior

All five transport buttons should control video playback:
- ⏮ seeks to clip start time
- ⏪ steps back one frame (1/60s)
- ▶/⏸ plays/pauses (this one works)
- ⏩ steps forward one frame (1/60s)
- ⏭ seeks to clip end time

## Actual Behavior

Only ▶/⏸ responds to clicks. The other four buttons appear clickable (cursor changes) but produce no visible effect.

## Investigation Notes

### Relevant Code

All buttons are in `apps/browser/src/components/ClipReview.tsx` (lines ~954-990), inside the `video-transport-controls` div.

Button handlers:
- `skipToStart` (line 624): requires `videoRef.current` AND `currentShot`
- `stepFrameBackward` (line 619): requires only `videoRef.current`
- `togglePlayPause` (line 604): requires only `videoRef.current` — THIS ONE WORKS
- `stepFrameForward` (line 614): requires only `videoRef.current`
- `skipToEnd` (line 630): requires `videoRef.current` AND `currentShot`

### Hypotheses

1. **Canvas overlay intercepting clicks** — The TrajectoryEditor uses `position: absolute` canvas overlay inside `.video-container`. The video-container has `position: relative` and `overflow: hidden`, which should contain it. But the canvas may still intercept pointer events.

2. **Frame step too small to see** — 1/60s is one frame. The change may be imperceptible, making it seem like nothing happened. But skip-to-start/end should show obvious jumps.

3. **`currentShot` is null** — If `shotsNeedingReview` is empty or `currentIndex` is wrong, `currentShot` would be undefined and `skipToStart`/`skipToEnd` would silently return. But if `currentShot` were null, the entire review UI wouldn't render.

4. **CSS/layout issue** — The buttons have no dedicated CSS rules (`btn-transport` class has no styles in global.css). They rely on default browser button styling. Possible that another element overlaps them.

## Environment

- Tested on: Vercel production (https://browser-seven-sigma.vercel.app) and localhost
- Browser: Chrome on Windows
- Reported by: User (Eli) during UX testing

## Files to Investigate

- `apps/browser/src/components/ClipReview.tsx` — button handlers and JSX
- `apps/browser/src/components/TrajectoryEditor.tsx` — canvas overlay positioning
- `apps/browser/src/styles/global.css` — video-container and potential overlay styles
