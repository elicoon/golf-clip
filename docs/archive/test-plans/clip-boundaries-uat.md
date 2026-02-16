# Clip Boundaries Extension - User Acceptance Test Plan

> **Purpose:** Verify that users can extend clip boundaries beyond the initial auto-detection window.

**Related Bug:** `docs/bugs/clip-boundary-extension.md`

**Affected Components:**
- `packages/frontend/src/components/Scrubber.tsx` (lines 29-39, 100-106)
- `packages/frontend/src/components/ClipReview.tsx`

---

## Bug Summary

The Scrubber component artificially limits the extension range of clip boundaries:

1. **Window Padding Limitation:** The visible scrubber window is locked to `startTime +/- 5 seconds`, preventing users from seeing or reaching times outside this range.

2. **Handle Position Mapping:** When dragging handles, the position is converted to time using `positionToTime()` which maps 0-100% to the visible window range, not the full video range.

3. **Visual Discouragement:** Areas outside the clip bounds appear dimmed (`.scrubber-region-outside`), implying they are invalid even though extension should be allowed.

**Expected Behavior:**
- Users should be able to extend clip start back to time 0
- Users should be able to extend clip end to video duration
- The window should expand or provide access to the full video timeline

---

## Pre-Test Setup

### Environment Requirements
- Desktop app running (`uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload`)
- Frontend dev server running (`cd packages/frontend && npm run dev`)
- Test video file (minimum 2 minutes long) with golf shots

### Test Video Specifications
| Property | Requirement |
|----------|-------------|
| Duration | >= 120 seconds (2 minutes) |
| Format | MP4 or MOV |
| Content | At least 1 detectable golf shot |
| Shot Position | Shot should occur between 20-100 seconds into video |

### Browser
- Chrome (primary)
- Zoom level: 100%
- DevTools open for console monitoring

---

## Test Cases

### TC-1: Extend Start Boundary Beyond 5 Seconds

**Objective:** Verify the start handle can be dragged more than 5 seconds before the auto-detected clip start.

**Preconditions:**
- Video processed with at least one detected shot
- Shot has clip_start at approximately 30-60 seconds
- Currently viewing the shot in ClipReview

**Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Note the initial clip start time shown in the time display | Time is visible (e.g., "Start: 30.00s") |
| 2 | Locate the left (start) handle on the scrubber | Yellow/gold vertical bar on left side of selected region |
| 3 | Click and drag the start handle to the left | Handle should move smoothly |
| 4 | Continue dragging until handle reaches leftmost position | Handle reaches edge of scrubber |
| 5 | Release the mouse button | New start time is set |
| 6 | Check the "Start:" time in the time display | **BUG:** Start only reaches ~5s before original. **EXPECTED:** Start should reach 0s or expand window |
| 7 | Try to drag further left | **BUG:** Cannot extend further. **EXPECTED:** Window should expand or allow access to earlier times |

**Pass Criteria:**
- [ ] Start handle can be dragged to time 0 (or within 1 second of 0)
- [ ] Time display shows the extended start time
- [ ] Clip duration updates correctly

**Current Behavior (Bug):**
- Start handle stops at `originalStart - 5 seconds`
- Window does not expand to show earlier times
- User cannot access times beyond the 5-second padding

---

### TC-2: Extend End Boundary Beyond 5 Seconds

**Objective:** Verify the end handle can be dragged more than 5 seconds after the auto-detected clip end.

**Preconditions:**
- Video processed with at least one detected shot
- Shot has clip_end well before video end (at least 30 seconds before)
- Currently viewing the shot in ClipReview

**Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Note the initial clip end time and video duration | End time visible, video duration known |
| 2 | Locate the right (end) handle on the scrubber | Yellow/gold vertical bar on right side of selected region |
| 3 | Click and drag the end handle to the right | Handle should move smoothly |
| 4 | Continue dragging until handle reaches rightmost position | Handle reaches edge of scrubber |
| 5 | Release the mouse button | New end time is set |
| 6 | Check the "End:" time in the time display | **BUG:** End only reaches ~5s after original. **EXPECTED:** End should reach video duration |
| 7 | Try to drag further right | **BUG:** Cannot extend further. **EXPECTED:** Window should expand or allow access to later times |

**Pass Criteria:**
- [ ] End handle can be dragged to video duration (or within 1 second)
- [ ] Time display shows the extended end time
- [ ] Clip duration updates correctly

**Current Behavior (Bug):**
- End handle stops at `originalEnd + 5 seconds`
- Window does not expand to show later times
- User cannot access times beyond the 5-second padding

---

### TC-3: Extended Boundaries Persist After Export

**Objective:** Verify that extended clip boundaries are correctly used during export.

**Preconditions:**
- Shot with extended boundaries from TC-1 or TC-2
- Extended start is significantly different from original (>5 seconds)
- Extended end is significantly different from original (>5 seconds)

**Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Note the extended start and end times | e.g., Start: 10.00s, End: 50.00s |
| 2 | Complete the shot review (mark landing, accept tracer) | Review completes |
| 3 | Click "Next" to accept the shot | Shot is marked as approved |
| 4 | If last shot, export begins automatically | Export modal appears |
| 5 | Wait for export to complete | "Export Complete!" message |
| 6 | Open the exported clip file | Video player opens |
| 7 | Check the exported clip duration | Duration matches extended boundaries |

**Pass Criteria:**
- [ ] Exported clip starts at the extended start time
- [ ] Exported clip ends at the extended end time
- [ ] Clip duration matches `extendedEnd - extendedStart`

---

### TC-4: Visual Indicators for Extension Zones

**Objective:** Verify visual feedback indicates where boundaries can be extended.

**Preconditions:**
- In ClipReview view with a detected shot
- Window shows clip boundaries

**Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Observe the scrubber track | Track shows selected region (highlighted) |
| 2 | Observe areas outside the selected region | **BUG:** Dimmed/grayed out. **EXPECTED:** Should indicate they are accessible |
| 3 | Hover over start handle | Cursor changes to resize cursor |
| 4 | Note any visual indication of drag limits | **BUG:** No indication. **EXPECTED:** Should show full drag range is 0 to duration |

**Pass Criteria:**
- [ ] Visual design indicates full extension range is available
- [ ] Areas outside current clip are clearly accessible (not "forbidden")
- [ ] Handles provide appropriate cursor feedback

---

### TC-5: Keyboard Shortcuts for Boundary Extension

**Objective:** Verify keyboard shortcuts `[` and `]` respect extended boundaries.

**Preconditions:**
- In ClipReview view
- Video playback working

**Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Play video and seek to a time well before clip start | e.g., 10 seconds into a 120s video |
| 2 | Press `[` key to set clip start | Start should update to current playback time |
| 3 | Seek to a time well after clip end | e.g., 100 seconds |
| 4 | Press `]` key to set clip end | End should update to current playback time |
| 5 | Verify the scrubber shows the new boundaries | Both boundaries reflect keyboard-set times |

**Pass Criteria:**
- [ ] `[` sets start to current playback time regardless of window
- [ ] `]` sets end to current playback time regardless of window
- [ ] Scrubber updates to show new boundaries

**Note:** This tests the keyboard shortcut path which may bypass the scrubber window limitation.

---

### TC-6: Boundary Extension After Multiple Shots

**Objective:** Verify boundary extension works consistently across multiple shots.

**Preconditions:**
- Video with 3+ detected shots
- All shots have default clip boundaries

**Steps:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | On Shot 1, extend start boundary by 10+ seconds | Extension succeeds |
| 2 | On Shot 1, extend end boundary by 10+ seconds | Extension succeeds |
| 3 | Accept Shot 1 and move to Shot 2 | Shot 2 displayed |
| 4 | Repeat extensions on Shot 2 | Extensions succeed |
| 5 | Navigate back to Shot 1 (if possible) | Shot 1 displayed |
| 6 | Verify Shot 1's extended boundaries are preserved | Boundaries match what was set |

**Pass Criteria:**
- [ ] Extensions work on all shots
- [ ] Extended boundaries persist when navigating between shots
- [ ] No interference between shots' boundaries

---

## Edge Cases

### EC-1: Clip at Video Start

**Scenario:** Shot detected at the very start of the video (clip_start < 5s)

**Test:**
1. Process a video where a shot is detected in first 5 seconds
2. Try to extend start boundary to 0
3. Verify behavior when window start would be negative

**Expected:** Window clamps to 0, full extension still possible

---

### EC-2: Clip at Video End

**Scenario:** Shot detected near the end of the video (clip_end > duration - 5s)

**Test:**
1. Process a video where a shot is detected in last 10 seconds
2. Try to extend end boundary to video duration
3. Verify behavior when window end exceeds duration

**Expected:** Window clamps to duration, full extension still possible

---

### EC-3: Very Short Video

**Scenario:** Video is shorter than the default padding (< 10 seconds)

**Test:**
1. Process a very short video (5-10 seconds)
2. Verify scrubber displays correctly
3. Attempt to extend boundaries

**Expected:** Boundaries clamp appropriately, no errors

---

### EC-4: Maximum Extension

**Scenario:** Extend a 5-second clip to cover the entire 120-second video

**Test:**
1. Start with clip: 55s - 60s (5 second clip)
2. Extend start to 0s
3. Extend end to 120s
4. Export the clip

**Expected:**
- Extension succeeds in both directions
- Export produces 120-second clip
- No performance issues

---

## Test Results Template

```markdown
## Test Run: YYYY-MM-DD

### Environment
- Browser: Chrome XXX
- OS: Windows 11
- Backend: localhost:8420
- Frontend: localhost:5173
- Test Video: [filename, duration]

### Results

| Test Case | Status | Notes |
|-----------|--------|-------|
| TC-1: Extend Start | FAIL/PASS | |
| TC-2: Extend End | FAIL/PASS | |
| TC-3: Export Persistence | FAIL/PASS | |
| TC-4: Visual Indicators | FAIL/PASS | |
| TC-5: Keyboard Shortcuts | FAIL/PASS | |
| TC-6: Multiple Shots | FAIL/PASS | |
| EC-1: Clip at Start | FAIL/PASS | |
| EC-2: Clip at End | FAIL/PASS | |
| EC-3: Short Video | FAIL/PASS | |
| EC-4: Max Extension | FAIL/PASS | |

### Actual vs Expected Behavior

**TC-1 (Extend Start):**
- Expected: Start extends to 0s
- Actual: Start limited to [X]s

**TC-2 (Extend End):**
- Expected: End extends to [duration]s
- Actual: End limited to [X]s

### Console Errors
[List any errors]

### Screenshots
[Link to evidence folder]
```

---

## Verification After Fix

After the bug is fixed, run all test cases and verify:

1. **TC-1 through TC-6:** All pass
2. **All edge cases:** Pass
3. **No regressions:**
   - Playhead still works correctly
   - Time labels update correctly
   - Minimum 0.5s clip duration still enforced
   - Export still works with normal (non-extended) boundaries
   - Scrubber performance is acceptable

### Regression Checklist

- [ ] Playhead dragging works within extended boundaries
- [ ] Clicking on track seeks correctly
- [ ] Time labels show correct times
- [ ] Clip duration display updates
- [ ] Extended boundaries round to reasonable precision
- [ ] No visual glitches when window expands
- [ ] Memory usage stable after repeated extensions

---

## Appendix: Code Locations

### Files to Review

| File | Lines | Issue |
|------|-------|-------|
| `Scrubber.tsx` | 29-39 | Window calculation limits to +/- 5s |
| `Scrubber.tsx` | 100-106 | Locked window during drag |
| `Scrubber.tsx` | 67-80 | timeToPosition/positionToTime mapping |
| `ClipReview.tsx` | 361-368 | handleTimeUpdate callback |

### Potential Fix Approaches

1. **Expand window dynamically:** When handle is dragged near edge, expand window
2. **Use full video range:** Change window to always be 0 to duration
3. **Progressive reveal:** Show more of timeline as user drags
4. **Zoom controls:** Add zoom out to see full timeline

### Related Tests

- Unit tests: `packages/frontend/src/components/__tests__/Scrubber.test.tsx`
- Integration tests: Same file, integration describe block
