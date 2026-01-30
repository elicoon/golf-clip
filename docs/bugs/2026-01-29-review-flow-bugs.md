# Review Flow Bugs - 2026-01-29

## Bug 1: Sequential Upload Blocks Processing

**Status:** Open
**Priority:** High
**Component:** Frontend (VideoDropzone.tsx, appStore.ts)

### Description
Currently, when multiple videos are uploaded, the system waits for ALL videos to finish uploading before starting to process any of them. This is inefficient - processing should begin for each video as soon as its upload completes.

### Current Behavior
1. User selects 5 videos
2. All 5 videos upload sequentially
3. Only after all uploads complete does processing begin

### Expected Behavior
1. User selects 5 videos
2. Video 1 upload completes → Processing for video 1 starts immediately
3. Video 2 upload completes → Processing for video 2 starts immediately (or queues)
4. And so on...

### Technical Notes
- Need to decouple upload completion from batch processing start
- May need to track per-video state (uploading, uploaded, processing, complete)
- Consider parallel upload + sequential processing, or parallel both

---

## Bug 2: Tracer Not Animating During Playback

**Status:** Open
**Priority:** High
**Component:** Frontend (TrajectoryEditor.tsx, ClipReview.tsx)

### Description
After configuring tracer parameters and generating the trajectory, the tracer displays as a static complete line instead of animating progressively as the video plays. The user reported seeing the full tracer drawn before the ball was even hit.

### Current Behavior
- Tracer shows complete trajectory immediately after generation
- No progressive "drawing" animation synced to video playback
- Static display regardless of video currentTime

### Expected Behavior
- Tracer should animate progressively as video plays
- Line should "draw" from origin toward landing as ball flies
- Animation timing should match the configured flight_time parameter
- Before strike time: no tracer visible
- During flight: tracer progressively draws
- After landing: full tracer visible

### Technical Notes
- TrajectoryEditor.tsx has animation logic but may not be triggering
- Check if video currentTime is being properly synced to canvas render
- Verify requestAnimationFrame loop is running during playback
- Check if trajectory timestamps are being compared to video time

---

## Bug 3: Export Blocks Next Clip Review

**Status:** Open
**Priority:** High
**Component:** Frontend (ClipReview.tsx, appStore.ts)

### Description
When user accepts a clip and it starts exporting, the UI blocks until export completes before allowing review of the next clip. Export should happen in background while user continues reviewing remaining clips.

### Current Behavior
1. User reviews shot 1, clicks "Accept"
2. Export starts for shot 1
3. UI blocks/waits for export to complete
4. Only then can user review shot 2

### Expected Behavior
1. User reviews shot 1, clicks "Accept"
2. Export queues/starts in background for shot 1
3. Immediately advance to shot 2 review
4. User can review all shots without waiting
5. Final "Export Complete" screen only shows after:
   - All shots have been reviewed
   - All background exports have completed

### Technical Notes
- Need to decouple "accept shot" from "wait for export"
- Track export jobs separately from review state
- Only transition to ExportComplete view when both conditions met:
  - currentShotIndex >= totalShots (all reviewed)
  - All export jobs completed
- Consider showing export progress indicator while reviewing

---

## Summary

| Bug | Component | Impact |
|-----|-----------|--------|
| 1 | Upload/Processing | Wasted time waiting for all uploads |
| 2 | Tracer Animation | Poor UX, tracer doesn't match video |
| 3 | Export/Review Flow | Blocked workflow, slow multi-clip review |
