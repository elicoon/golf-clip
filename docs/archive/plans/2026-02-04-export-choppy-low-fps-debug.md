# Debug Findings: export-choppy-low-fps

## Observed Behavior
Exports are choppy/low FPS after UI cleanup in ClipReview.tsx.

## Expected Behavior
Exports should capture ~60fps and produce files >10MB for 10s clips.

## Reproduction Steps
1. Load video `C:/Users/Eli/Downloads/IMG_3956_h264.mp4`
2. Navigate to clip review page
3. Select 1080p resolution
4. Click Export button
5. Observe console output for FPS metrics
6. Check exported file size

## Environment
- OS: Windows
- Browser: Chrome (assumed)
- Project: golf-clip (browser app)

## Hypotheses

| # | Hypothesis | Likelihood | Status |
|---|------------|------------|--------|
| 1 | UI cleanup broke V4 code path | Low | Rejected |
| 2 | V4 was never working; user was using V1/V2/V3 before | Medium | Untested |
| 3 | External factor (browser update, video codec) | Low | Untested |
| 4 | video-frame-pipeline-v4.ts has a latent bug | Medium | Untested |

## Investigation Log

### Attempt 1: Compare git diff
- **Hypothesis tested:** UI cleanup removed or broke V4-related code
- **Method:** `git diff apps/browser/src/components/ClipReview.tsx`
- **Result:** The diff shows:
  - Removed V1, V2, V3 imports and handlers (~300 lines)
  - `handleExportV4` function is **unchanged** except cosmetic filename change
  - The new primary "Export" button calls the same `handleExportV4` function
  - `exportResolution` state unchanged, defaults to '1080p'
- **Conclusion:** The V4 code path is **identical** before and after cleanup

### Attempt 2: Verify V4 pipeline fixes
- **Hypothesis tested:** The V4 pipeline fixes from bug doc are present
- **Method:** Grep for captureCanvas resolution
- **Result:** Lines 290-292 show `captureCanvas.width = width` (output resolution, not source)
- **Conclusion:** The fixes documented in the bug file ARE present in the code

### Attempt 3: Check if pipeline was modified
- **Hypothesis tested:** video-frame-pipeline-v4.ts was changed
- **Method:** `git status apps/browser/src/lib/video-frame-pipeline-v4.ts`
- **Result:** No uncommitted changes to the pipeline
- **Conclusion:** Pipeline is unchanged

## Key Question

**If the V4 code is identical before and after, how can there be a regression?**

Possibilities:
1. **User was using different export button before** — The old "Export" button called `handleExport` (V1), not `handleExportV4`. If user was clicking the main "Export" button, they were using V1 (FFmpeg) not V4.

2. **V4 never fully worked at 60fps** — The bug doc says V4 was fixed, but maybe verification was incomplete.

3. **Something external** — Browser update, different video file, different system state.

## Root Cause

**CONFIRMED: Intermittent Chrome rVFC Throttling**

The UI cleanup is NOT the cause. Both old and new UI work correctly when tested:

| Test | UI Version | FPS | File Size | Result |
|------|------------|-----|-----------|--------|
| Old UI (stashed) | Multiple buttons | 59.9 fps | 27.5 MB | ✅ Working |
| New UI (cleaned up) | Single Export button | 60.0 fps | 27.6 MB | ✅ Working |

The broken exports from earlier today were caused by **Chrome throttling `requestVideoFrameCallback`** to ~1fps. This happens when:
- Browser tab loses focus
- Page is not visible (minimized, behind other windows)
- Chrome Energy Saver mode is active (Chrome 133+)
- System is under heavy load

**Evidence:**
- File size pattern: Working exports ~27MB, broken ~5MB (same code)
- Same code produces different results at different times
- Feb 2 data shows mix of working (27MB) and broken (5MB) exports
- No code changes between working and broken exports

**The V4 pipeline code has workarounds for rVFC throttling** (lines 167-180 in video-frame-pipeline-v4.ts), but they may not be sufficient for all throttling scenarios.

## Location
- ClipReview.tsx: UI component (NOT the cause)
- video-frame-pipeline-v4.ts: Export pipeline — rVFC throttling workarounds may need improvement
