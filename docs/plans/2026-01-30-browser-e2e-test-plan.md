# GolfClip Browser E2E Test Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Comprehensive E2E acceptance testing for the browser app to verify feature parity with desktop and ensure all major functionality works correctly.

**Architecture:** Manual E2E tests executed via Playwright browser automation, with documented expected results for each test case. Tests cover the complete user flow from video upload through shot detection, review, tracer configuration, and export.

**Tech Stack:** Playwright MCP browser automation, Vercel deployment at https://browser-seven-sigma.vercel.app

---

## Feature Parity Matrix

### Current Browser vs Desktop Status

| Feature | Desktop | Browser | Status |
|---------|---------|---------|--------|
| **Video Upload** | Drag/drop, file picker | Drag/drop, file picker | Implemented |
| **Large File Handling** | Up to 100GB | Segment extraction | Implemented |
| **Audio Detection** | librosa (MFCC, spectral, decay) | Essentia.js onset detection | Partial - different algorithm |
| **Visual Ball Detection** | YOLO + Kalman filter | Not implemented | GAP |
| **Combined Confidence** | Audio + visual weighted | Audio only | GAP |
| **Clip Extraction** | FFmpeg | FFmpeg.wasm | Implemented |
| **Shot Review UI** | Full (scrub, boundaries, zoom) | Basic (display only) | GAP |
| **Tracer Configuration** | 3-step (target, landing, config) | TrajectoryEditor component | Partial |
| **Tracer Rendering** | Bezier physics, animation | Canvas overlay | Implemented |
| **Clip Export** | FFmpeg with tracer burn-in | FFmpeg.wasm | Partial |
| **Per-shot tracer toggle** | render_tracer flag | Not exposed | GAP |
| **Keyboard Shortcuts** | Full set | None | GAP |
| **Feedback Collection** | TP/FP, tracer stats | None | GAP |
| **Batch Processing** | Multiple jobs | Single video | GAP |

### Known Feature Gaps (Not Testable in Browser)

1. **Visual ball detection** - Desktop uses YOLO model, browser has no equivalent
2. **Combined confidence scoring** - Browser only uses audio confidence
3. **Review UI features** - No clip boundary adjustment, no zoom, no frame stepping
4. **Keyboard shortcuts** - Not implemented
5. **Feedback collection** - No mechanism to record true/false positives
6. **Batch processing** - Browser only supports one video at a time

---

## Test Environment Setup

### Prerequisites
- Chrome browser available
- Vercel deployment at https://browser-seven-sigma.vercel.app
- Test videos available in `c:/Users/Eli/projects/golf-clip/video files/`

### Test Video Inventory

| Video | Size | Format | Expected Shots | Notes |
|-------|------|--------|----------------|-------|
| IMG_3940.MP4 | 19MB | MP4 | 2 shots | Primary test video (63%, 73% confidence) |
| IMG_3941.MP4 | 31MB | MP4 | TBD | Secondary test |
| IMG_3942.MP4 | 60MB | MP4 | TBD | Larger file test |
| IMG_3943.MP4 | 82MB | MP4 | TBD | Even larger file |
| IMG_3940.MOV | 303MB | MOV | Same as MP4 | Format compatibility test |

---

## Task 1: Core Upload Flow

**Files:**
- Test: Vercel deployment at https://browser-seven-sigma.vercel.app
- Evidence: Screenshot saved to `docs/test-evidence/`

### Test 1.1: Basic Video Upload

**Step 1: Navigate to app**
```
URL: https://browser-seven-sigma.vercel.app
Expected: See "GolfClip" header, drop zone with "Drop your golf video here" text
```

**Step 2: Upload test video via file picker**
```
Action: Click "Select File" button
File: IMG_3940.MP4 (19MB)
Expected:
  - File picker opens
  - After selection, progress indicator appears
  - Progress shows "Analyzing audio chunk X/Y..."
```

**Step 3: Verify processing completes**
```
Expected:
  - Progress reaches 100%
  - Status changes to "ready"
  - Results show "Found 2 shots"
```

**Step 4: Verify shot cards display**
```
Expected for Shot 1:
  - "Shot 1" label
  - "0.0s" timestamp
  - "63% confidence" badge
  - Video player with controls

Expected for Shot 2:
  - "Shot 2" label
  - "30.0s" timestamp
  - "73% confidence" badge
  - Video player with controls
```

**Acceptance Criteria:**
- [ ] App loads without errors
- [ ] File upload works via button
- [ ] Processing progress shows correctly
- [ ] 2 shots detected
- [ ] Shot 1: 63% confidence at 0.0s
- [ ] Shot 2: 73% confidence at ~30.0s
- [ ] Both video segments playable

---

## Task 2: Video Playback Verification

**Step 1: Play Shot 1 video segment**
```
Action: Click play on Shot 1 video
Expected:
  - Video plays from segment start
  - Audio audible (should hear golf swing sound)
  - Video shows golf swing
```

**Step 2: Play Shot 2 video segment**
```
Action: Click play on Shot 2 video
Expected:
  - Video plays from segment start
  - Audio audible
  - Video shows different golf swing
```

**Step 3: Verify video controls work**
```
Actions:
  - Pause video
  - Seek via timeline
  - Adjust volume (if available)
Expected: All controls responsive
```

**Acceptance Criteria:**
- [ ] Shot 1 video segment plays correctly
- [ ] Shot 2 video segment plays correctly
- [ ] Audio is present in both clips
- [ ] Video controls (play/pause/seek) work

---

## Task 3: Different Video Formats

### Test 3.1: MP4 Format (Already tested in Task 1)

### Test 3.2: MOV Format

**Step 1: Reset app**
```
Action: Click "New Video" button
Expected: App returns to upload screen
```

**Step 2: Upload MOV file**
```
File: IMG_3940.MOV (303MB - larger file)
Expected:
  - Upload begins
  - Segment extraction handles large file
  - Processing completes (may take longer)
```

**Step 3: Verify same results as MP4**
```
Expected:
  - Same 2 shots detected
  - Similar confidence values (~63%, ~73%)
  - Video playback works
```

**Acceptance Criteria:**
- [ ] MOV format accepted
- [ ] Large file (303MB) processes successfully
- [ ] Shot detection results match MP4 version
- [ ] Video segments playable

---

## Task 4: Multiple Shots Detection

### Test 4.1: Video with More Shots

**Step 1: Upload larger test video**
```
File: IMG_3942.MP4 or IMG_3943.MP4
Expected: Processing begins
```

**Step 2: Verify multiple shots detected**
```
Expected:
  - More than 2 shots detected (exact count TBD)
  - Each shot has confidence badge
  - All video segments playable
```

**Acceptance Criteria:**
- [ ] Multiple shots (>2) detected
- [ ] All shots have confidence scores
- [ ] All video segments extractable and playable

---

## Task 5: Edge Cases

### Test 5.1: No Shots in Video

**Step 1: Create or find video with no golf swings**
```
If available: Upload video with no golf sounds
Expected:
  - Processing completes
  - "No golf shots detected" message shown
  - "Try Another Video" button available
```

**Acceptance Criteria:**
- [ ] App handles zero shots gracefully
- [ ] Clear message displayed
- [ ] User can try another video

### Test 5.2: Very Short Video

**Step 1: Upload short video (< 5 seconds)**
```
Expected:
  - Processing completes quickly
  - Correct shot count (0-1)
  - No crashes or errors
```

**Acceptance Criteria:**
- [ ] Short videos process correctly
- [ ] No infinite loops or crashes

### Test 5.3: Rapid Re-upload

**Step 1: Upload video, then immediately click "New Video" and upload another**
```
Expected:
  - Previous state clears
  - New video processes correctly
  - No memory leaks (check browser memory)
```

**Acceptance Criteria:**
- [ ] State resets correctly between uploads
- [ ] No accumulated errors in console

---

## Task 6: Error Handling

### Test 6.1: Invalid File Type

**Step 1: Attempt to upload non-video file**
```
File: .jpg, .pdf, or .txt file
Expected:
  - Error message displayed
  - App remains functional
```

**Acceptance Criteria:**
- [ ] Invalid files rejected
- [ ] Clear error message

### Test 6.2: Network Interruption

**Step 1: Start upload, then disable network**
```
Action: Use DevTools to throttle to offline
Expected:
  - Error handling activates
  - User can retry
```

**Acceptance Criteria:**
- [ ] Network errors handled gracefully

---

## Task 7: Browser Compatibility

### Test 7.1: Chrome (Primary)
- Already tested in Tasks 1-6

### Test 7.2: Firefox
```
Expected: All features work identically
```

### Test 7.3: Safari
```
Expected: Core features work (may have canvas/filter limitations)
```

### Test 7.4: Edge
```
Expected: All features work (Chromium-based)
```

**Acceptance Criteria:**
- [ ] Chrome: Full functionality
- [ ] Firefox: Full functionality
- [ ] Safari: Core functionality (note any limitations)
- [ ] Edge: Full functionality

---

## Task 8: Performance Testing

### Test 8.1: Memory Usage

**Step 1: Process 3 videos sequentially**
```
Action:
  1. Upload video 1, let complete
  2. Click "New Video", upload video 2
  3. Click "New Video", upload video 3

Measurement: Check browser memory in Task Manager
Expected: Memory doesn't grow unboundedly
```

**Acceptance Criteria:**
- [ ] Memory usage stable after multiple videos
- [ ] No memory leaks visible

### Test 8.2: Large File Performance

**Step 1: Upload largest available video**
```
File: IMG_3943.MP4 (82MB) or IMG_3946.MP4 (105MB)
Expected:
  - Segment extraction handles efficiently
  - Processing completes without timeout
  - Browser remains responsive
```

**Acceptance Criteria:**
- [ ] Large files (100MB+) process successfully
- [ ] No browser freezes
- [ ] Reasonable processing time (<2 minutes)

---

## Test Results Template

Use this template to record test results:

```markdown
## Test Run: YYYY-MM-DD HH:MM

### Environment
- Browser: Chrome/Firefox/Safari/Edge version X.X
- OS: Windows/macOS/Linux
- Deployment: https://browser-seven-sigma.vercel.app
- Commit: [hash]

### Results

| Task | Test | Pass/Fail | Notes |
|------|------|-----------|-------|
| 1 | Basic Upload | | |
| 2 | Video Playback | | |
| 3.2 | MOV Format | | |
| 4.1 | Multiple Shots | | |
| 5.1 | No Shots | | |
| 5.2 | Short Video | | |
| 5.3 | Rapid Re-upload | | |
| 6.1 | Invalid File | | |
| 6.2 | Network Error | | |
| 7.1-4 | Browser Compat | | |
| 8.1 | Memory | | |
| 8.2 | Large File | | |

### Issues Found
1. [Issue description]
2. [Issue description]

### Screenshots
- [Link to screenshot folder]
```

---

## Execution Notes

### Quick Smoke Test (5 minutes)
For rapid verification, run only:
- Task 1 (Basic Upload)
- Task 2 (Video Playback)

### Full Regression (30-45 minutes)
Run all tasks sequentially.

### Before Production Deploy
Run full regression plus:
- All browser compatibility tests
- Performance tests with largest files

---

## Future Test Additions

As features are added, add tests for:

1. **Tracer Configuration Flow**
   - Mark target point
   - Mark landing point
   - Configure trajectory settings
   - Generate tracer
   - Preview animation

2. **Clip Export**
   - Export without tracer
   - Export with tracer burned in
   - Download verification

3. **Review UI (when implemented)**
   - Clip boundary adjustment
   - Zoom controls
   - Keyboard shortcuts

4. **Batch Processing (when implemented)**
   - Multiple video upload
   - Job queue management
