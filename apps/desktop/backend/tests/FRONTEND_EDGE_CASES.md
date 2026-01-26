# Frontend Edge Cases for Manual Testing

These are edge cases and potential bugs in the frontend React components that should be manually tested since they cannot be covered by pytest.

## Feature A: Animation Smoothing (TrajectoryEditor.tsx)

### Test Cases

1. **Empty trajectory points array**
   - Set `trajectory.points = []`
   - Expected: Should not crash, no tracer drawn
   - Potential bug: May try to access `points[0]` causing undefined error

2. **Single trajectory point**
   - Set `trajectory.points` to have only 1 point
   - Expected: Should handle gracefully (no line to draw)
   - Potential bug: `drawSmoothCurve` expects >= 2 points

3. **Trajectory with NaN coordinates**
   - Set some point coordinates to NaN
   - Expected: Should skip or handle invalid points
   - Potential bug: Canvas drawing may fail silently or show artifacts

4. **Very fast video playback**
   - Play video at 2x speed or seek rapidly
   - Expected: Animation should remain smooth
   - Potential bug: May skip frames or stutter

5. **Video loop during trajectory animation**
   - Let video loop while trajectory is still animating
   - Expected: Trajectory should reset cleanly
   - Potential bug: `completionTimestamp` tracking may not reset properly

6. **Window resize during animation**
   - Resize browser window while trajectory is animating
   - Expected: Canvas should resize and trajectory should re-render correctly
   - Potential bug: Canvas coordinates may become misaligned

7. **High DPI displays**
   - Test on a retina/high-DPI display
   - Expected: Trajectory should be crisp, not blurry
   - Code handles this with devicePixelRatio but worth verifying

---

## Feature B: Auto-Loop with Pause (ClipReview.tsx)

### Critical Bug Risks

1. **Invalid clip boundaries (clip_end <= clip_start)**
   - Set `currentShot.clip_start = 5.0` and `currentShot.clip_end = 2.0`
   - Expected: Should handle gracefully, maybe show error
   - Potential bug: Video may get stuck in infinite loop or crash
   - **CODE LOCATION**: Lines 156-177 - no validation before comparing

2. **clip_end exceeds video duration**
   - Set `clip_end` to a time beyond the video's actual duration
   - Expected: Should clamp to video duration or handle gracefully
   - Potential bug: Video may pause unexpectedly or auto-loop may never trigger

3. **Disable auto-loop during the 750ms pause**
   - Toggle off "Auto Loop" checkbox while in the pause between loops
   - Expected: Should cancel the pending timeout
   - Bug risk: Code clears timeout on toggle (line 1080-1083) but race condition possible

4. **Video fails to load / load error**
   - Use invalid video path or corrupt video
   - Expected: Should show error message, auto-loop should not activate
   - Bug risk: `videoRef.current` may be null when trying to play

5. **Rapid shot navigation**
   - Quickly press ArrowUp/ArrowDown to switch shots
   - Expected: Each shot change should reset auto-loop state cleanly
   - Bug risk: Timeout from previous shot may fire on new shot

6. **Browser autoplay policy blocks play()**
   - Some browsers block autoplay until user interaction
   - Expected: Should fail silently (code has `.catch(() => {})`)
   - Verify: User should be able to manually start playback

7. **Video currentTime is NaN**
   - If video hasn't loaded, `currentTime` may be NaN
   - Expected: Comparison with `clip_end` should handle this
   - Potential bug: `NaN >= number` is false, so may not trigger loop correctly

### Test Steps for Auto-Loop

```
1. Load a video with multiple detected shots
2. Enable "Auto Loop" checkbox
3. Let video play through entire clip
4. Verify: Video pauses at clip_end
5. Verify: After 750ms, video seeks to clip_start and plays
6. Verify: Loop repeats correctly
7. Toggle "Auto Loop" off during pause
8. Verify: Loop does not restart
9. Navigate to different shot
10. Verify: Previous shot's timeout doesn't interfere
```

---

## Feature C: Multi-Video Upload (VideoDropzone.tsx)

### Edge Cases

1. **Select same file multiple times**
   - Click "Select Files" and choose the same video twice
   - Expected: Should handle gracefully (upload both or dedupe)
   - Note: This is allowed - each gets unique UUID prefix

2. **Cancel upload mid-progress**
   - Start uploading multiple files, close browser or navigate away
   - Expected: Should clean up partial uploads on server
   - Bug risk: Orphaned files in temp directory

3. **Mix of tiny and huge files**
   - Upload one 1KB file and one 10GB file
   - Expected: Small file completes quickly, large file shows progress
   - Bug risk: Progress calculation may be skewed

4. **Network disconnect during upload**
   - Simulate network failure during upload
   - Expected: XHR onerror handler should fire, show error message
   - Verify error state is shown correctly

5. **Server returns error for one file in batch**
   - If one file fails validation on server but others succeed
   - Expected: Should continue uploading remaining files
   - Verify: Both `uploaded` and `errors` arrays populated correctly

6. **Drag and drop multiple files**
   - Drag 5 files at once onto dropzone
   - Expected: All files should be queued and uploaded sequentially
   - Bug risk: May only capture first file

7. **File with no extension**
   - Try to upload a file named just "video" (no extension)
   - Expected: Should be rejected with clear error message
   - **CODE CHECK**: Line 183 - `Path(filename).suffix.lower()` returns empty string

8. **File upload state cleanup**
   - After uploads complete, `uploadStates` is cleared after 2000ms (line 192-194)
   - Expected: UI should reset cleanly
   - Bug risk: If user starts new upload during cleanup, state may conflict

### Tauri-Specific Edge Cases

1. **Tauri file dialog returns null**
   - User cancels file dialog
   - Expected: No files selected, no action taken
   - Code handles this at line 273-287

2. **Mixed Tauri and browser behavior**
   - If Tauri dialog import fails, falls back to file input
   - Expected: Should work seamlessly
   - Verify both paths work correctly

---

## Reproducible Bug Scenarios to Test

### Scenario 1: Auto-Loop Race Condition
```javascript
// In ClipReview.tsx, potential race condition:
// 1. Video reaches clip_end, schedules timeout for 750ms
// 2. User disables auto-loop at 600ms
// 3. At 750ms, timeout fires but checks autoLoopEnabled
// Expected: Timeout check at line 168 should prevent restart
// Risk: State update may not have propagated
```

### Scenario 2: Trajectory Animation Memory Leak
```javascript
// In TrajectoryEditor.tsx, the requestAnimationFrame loop:
// 1. useEffect sets up animation loop (line 446)
// 2. Cleanup returns cancelAnimationFrame (line 450)
// Risk: If dependencies change rapidly, multiple loops may run
// Test: Rapidly toggle showTracer on/off and check for memory growth
```

### Scenario 3: Canvas Size Mismatch
```javascript
// In TrajectoryEditor.tsx, canvas sizing:
// 1. Canvas size set from video.getBoundingClientRect() (line 73)
// 2. Canvas internal resolution multiplied by devicePixelRatio (lines 77-78)
// Risk: If video changes size after initial setup, canvas may be wrong size
// Test: Resize video container and verify trajectory still aligns
```

---

## Browser Compatibility Notes

- **Safari**: Check canvas filter support (line 29-36 has detection code)
- **Mobile Safari**: Touch events for canvas interaction
- **Firefox**: Check requestAnimationFrame timing precision
- **Chrome**: DevTools Performance tab for animation frame drops

---

## Recommended Manual Test Procedure

1. Open application in browser
2. Open DevTools Console and Network tabs
3. Upload a test video
4. Verify upload progress shows correctly
5. Let detection complete
6. In review screen, verify auto-loop behavior
7. Resize window during playback
8. Mark points and generate trajectory
9. Watch trajectory animation for smoothness
10. Check console for any errors or warnings
