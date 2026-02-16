# Export Pipeline UAT Test Checklist

**Component:** Export with Tracer Overlay
**Primary Files:** `video-frame-pipeline.ts`, `ClipReview.tsx`
**Related Bug:** `docs/bugs/bug-export-tracer-pipeline-hang.md`
**Last Updated:** 2026-02-02

---

## Overview

This document provides manual test scenarios for validating the export pipeline functionality. Use this checklist when:
- Deploying changes to the export pipeline
- Validating bug fixes for export hang issues
- Testing on new hardware/browsers
- Regression testing after FFmpeg WASM updates

---

## Test Environment Requirements

### Hardware Recommendations
- **Minimum:** 8GB RAM, dual-core CPU
- **Recommended for 4K testing:** 16GB RAM, quad-core CPU
- **Browser DevTools open:** To monitor memory usage during export

### Test Videos Required

| Video Type | Resolution | Duration | Codec | Approx Size | Purpose |
|------------|------------|----------|-------|-------------|---------|
| Small H.264 | 1080p | 5-10s | H.264/AVC | <10MB | Baseline happy path |
| Medium H.264 | 1080p | 15-20s | H.264/AVC | 20-50MB | Normal use case |
| Large H.264 | 1080p | 30s+ | H.264/AVC | 50-100MB | Large blob handling |
| 4K 30fps | 3840x2160 | 10-15s | H.264/AVC | 50-150MB | 4K decode stress |
| 4K 60fps | 3840x2160 | 15-30s | H.264/AVC | 100-300MB | **Primary bug case** |
| HEVC/H.265 | Any | Any | HEVC | Any | Codec rejection test |
| Very Long | 1080p | 60s+ | H.264/AVC | 100MB+ | Frame limit test |

---

## Test Scenarios

### 1. Happy Path - Small Video Export

**Preconditions:**
- Video uploaded: 1080p H.264, 5-10 seconds
- At least one shot detected and marked with landing point
- Trajectory generated successfully

**Steps:**
1. [ ] Click "Export 1 Clip" button
2. [ ] Observe export modal appears
3. [ ] Verify progress phases display:
   - [ ] "Preparing" phase shows (indeterminate or percentage)
   - [ ] "Extracting" phase shows with progress
   - [ ] "Compositing" phase shows with frame count
   - [ ] "Encoding" phase shows with progress
4. [ ] Wait for export to complete

**Expected Results:**
- [ ] Export completes within 30 seconds
- [ ] Success icon appears
- [ ] Download triggers automatically (or Done button appears)
- [ ] Modal auto-closes after 1.5 seconds
- [ ] No console errors related to FFmpeg

**Success Criteria:**
- Total time < 30 seconds
- Progress never stuck at 0%, 99%, or any value for > 5 seconds
- Memory usage stays under 500MB

---

### 2. Large Blob Export (>50MB)

**Preconditions:**
- Video uploaded: 1080p H.264, 20-30 seconds, >50MB
- Shot marked with landing point and trajectory

**Steps:**
1. [ ] Open browser DevTools > Performance or Memory tab
2. [ ] Click "Export" button
3. [ ] Monitor progress phases
4. [ ] Note any console warnings about large blobs

**Expected Results:**
- [ ] Console shows: "Large blob detected (XXX MB). This may take a while..."
- [ ] "Preparing" phase takes longer (expected for large files)
- [ ] Export eventually completes (may take 1-2 minutes)
- [ ] Memory usage peaks but doesn't cause crash

**Success Criteria:**
- Export completes without hanging
- Memory usage stays under 1.5GB
- If timeout occurs, error message is clear

---

### 3. 4K 60fps Video Export (Primary Bug Scenario)

**Preconditions:**
- Video uploaded: 4K (3840x2160) 60fps H.264, 15-30 seconds
- This is the exact scenario that caused the original hang bug

**Steps:**
1. [ ] Upload 4K 60fps video
2. [ ] Process and detect shots
3. [ ] Mark landing point for a shot
4. [ ] Generate trajectory
5. [ ] Open DevTools Console (for FFmpeg logs)
6. [ ] Click "Export" button
7. [ ] Monitor progress closely

**Expected Results:**
- [ ] Console shows FPS reduction warning: "Reducing fps from 60 to 24..."
- [ ] Console shows downscaling warning for clips >18s
- [ ] Progress reaches 100% (not stuck at ~90%)
- [ ] Export completes OR times out with clear error after 2 minutes

**Success Criteria:**
- **PASS if:** Export completes successfully with downscaled output
- **PASS if:** Export times out after 2 minutes with clear error message
- **FAIL if:** Export hangs indefinitely (no timeout triggered)
- **FAIL if:** Browser tab crashes or becomes unresponsive

**Bug Regression Check:**
- [ ] Progress does NOT stall at 90% during "extracting" phase
- [ ] If stuck, timeout triggers after 120 seconds

---

### 4. Very Long Clip Export (>18 seconds)

**Preconditions:**
- Video uploaded: 1080p, 30+ seconds
- User adjusts clip boundaries to 25+ seconds

**Steps:**
1. [ ] Adjust clip start/end to create 25+ second clip
2. [ ] Mark landing and generate trajectory
3. [ ] Click "Export" button
4. [ ] Check console for downscale filter

**Expected Results:**
- [ ] Console shows: "Long clip (XXs) - downscaling to 1080p and using 24fps"
- [ ] FFmpeg exec args include `scale=1920:1080:force_original_aspect_ratio=decrease`
- [ ] Export completes (slower due to more frames)

**Success Criteria:**
- Output video is 1080p (even if source was higher)
- Output video is 24fps (not 60fps)
- Export completes without memory exhaustion

---

### 5. HEVC Video Rejection

**Preconditions:**
- Video uploaded: HEVC/H.265 codec (common on newer iPhones)

**Steps:**
1. [ ] Upload HEVC video
2. [ ] Process and mark shots
3. [ ] Attempt export

**Expected Results:**
- [ ] Export fails with clear error
- [ ] Error message mentions "HEVC" or "transcode"
- [ ] Transcode modal may appear offering H.264 conversion

**Success Criteria:**
- User understands why export failed
- User has path forward (transcode or use different video)

---

### 6. Export Cancellation During Progress

**Preconditions:**
- Video uploaded, shot marked, trajectory generated

**Steps:**
1. [ ] Click "Export" button
2. [ ] While progress is showing (any phase), click "Cancel"
3. [ ] Verify modal closes
4. [ ] Click "Export" again
5. [ ] Let it complete

**Expected Results:**
- [ ] Cancel closes modal immediately
- [ ] No error messages
- [ ] Subsequent export works normally

**Success Criteria:**
- FFmpeg process is properly aborted (no orphan processes)
- Memory is freed after cancel
- Re-export works correctly

---

### 7. Memory Exhaustion Recovery

**Preconditions:**
- Use a very large 4K video or artificially constrain browser memory
- Or use multiple large exports in sequence

**Steps:**
1. [ ] Export a large 4K video
2. [ ] Before it completes, try starting another export (if possible)
3. [ ] Or: Export several clips in sequence without page refresh

**Expected Results:**
- [ ] If memory exhaustion occurs, error is caught
- [ ] Error message is shown (not a crash)
- [ ] User can close modal and retry

**Success Criteria:**
- No browser crash
- No white screen of death
- User gets actionable error message

---

### 8. Progress Bar Accuracy

**Preconditions:**
- Any exportable video

**Steps:**
1. [ ] Start export
2. [ ] Watch progress bar movement

**Expected Results:**
- [ ] Progress bar never jumps backwards
- [ ] Progress bar never sticks at 99% for more than 2 seconds
- [ ] Progress bar reaches 100% before success icon appears
- [ ] Each phase (preparing, extracting, compositing, encoding) shows some progress

**Success Criteria:**
- Smooth progress (no >10% jumps except at phase transitions)
- Final 100% always shown
- No phase stuck for >10 seconds without movement

---

### 9. Multi-Clip Export

**Preconditions:**
- Video with 3+ detected shots
- All shots marked with landing points and trajectories

**Steps:**
1. [ ] Approve all 3+ shots
2. [ ] Click "Export 3 Clips" button
3. [ ] Monitor progress showing "Clip 1 of 3", etc.

**Expected Results:**
- [ ] Progress shows current clip number
- [ ] Each clip exports sequentially
- [ ] All clips download (or single zip downloads)
- [ ] Success state shows after all clips complete

**Success Criteria:**
- All clips export successfully
- If one fails, error shows which clip
- Total time is reasonable (not 10x single clip)

---

### 10. Export Without Tracer

**Preconditions:**
- Video with shot marked
- "Render Shot Tracers" checkbox unchecked (if available)

**Steps:**
1. [ ] Uncheck tracer rendering option
2. [ ] Click "Export"
3. [ ] Verify export

**Expected Results:**
- [ ] Export still works
- [ ] Export may be faster (no compositing phase)
- [ ] Output video has no tracer overlay

**Success Criteria:**
- Export completes
- Output video plays correctly
- No tracer visible in output

---

## Test Results Log

| Date | Tester | Scenario | Browser | OS | Result | Notes |
|------|--------|----------|---------|-----|--------|-------|
| | | | | | | |
| | | | | | | |

---

## Common Failure Modes

### Export Hangs at 0%
**Symptoms:** Modal shows "Exporting" but progress never starts
**Likely Cause:** `fetchFile(blob)` hanging on large blob
**Debug:** Check console for "Preparing video data" log
**Workaround:** Try smaller clip or different video

### Export Hangs at ~90%
**Symptoms:** Progress reaches ~90% during "extracting" then stalls
**Likely Cause:** FFmpeg WASM struggling with 4K decode
**Debug:** Check console for FFmpeg logs, look for decode errors
**Expected:** Should timeout after 2 minutes

### Export Stuck at 99%
**Symptoms:** Progress shows 99% but never completes
**Likely Cause:** Progress callback not reporting 100% explicitly
**Fix Applied:** Pipeline now explicitly reports 100% after exec completes

### Browser Tab Crashes
**Symptoms:** Tab becomes unresponsive or crashes
**Likely Cause:** Memory exhaustion (>2GB WASM limit)
**Debug:** Check DevTools Memory tab for heap size
**Mitigation:** Frame limits and downscaling should prevent this

---

## Automated Test Coverage

The following automated tests cover export scenarios:

### `video-frame-pipeline.test.ts`
- [x] Frame count calculation
- [x] Large blob warning (>100MB)
- [x] FPS reduction for long clips
- [x] Downscale filter for clips >18s
- [x] Frame extraction timeout (2 minutes)
- [x] Memory cleanup after export
- [x] Progress phase reporting
- [x] Exit code handling
- [x] FFmpeg log capture on failure

### `ClipReview.export.test.tsx`
- [x] Export modal visibility
- [x] Export modal auto-close
- [x] Error state display
- [x] Cancel button functionality
- [x] Multi-clip export progress
- [x] 4K video scenarios
- [x] Memory limit handling
- [x] HEVC rejection
- [x] Progress phase visibility

Run tests with:
```bash
cd apps/browser && npm run test
```

---

## Escalation Path

If UAT fails:
1. **Document:** Video file specs, browser, exact failure point
2. **Logs:** Export console logs (FFmpeg output)
3. **Memory:** DevTools memory snapshot at failure
4. **Bug doc:** Update `docs/bugs/bug-export-tracer-pipeline-hang.md`
5. **Escalate:** Tag session handoff for next developer
