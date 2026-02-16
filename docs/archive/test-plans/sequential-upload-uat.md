# Sequential Upload Bug - User Acceptance Testing (UAT)

> **Bug:** When multiple videos are uploaded, UI waits for ALL uploads to complete before showing the processing view. The first video should trigger processing immediately.

**Issue ID:** Sequential Upload Blocks Processing
**Severity:** Medium - UX degradation for multi-video workflows
**Components:** `VideoDropzone.tsx`, `App.tsx`, `appStore.ts`

---

## Bug Summary

### Root Cause

1. **VideoDropzone.tsx (line 288-300):** `handleFiles` uses a sequential `for` loop with `await`, uploading files one at a time. `isLoading` is set `true` at line 278 and only cleared at line 302 AFTER the loop completes.

2. **App.tsx (lines 98-101):** `handleVideoUploaded` correctly fires per-file and uses `isFirst && !isProcessing` guard to start processing. However, the view doesn't transition because VideoDropzone's internal state hasn't changed.

3. **Visual symptom:** User selects 3 files, sees upload progress bar for all 3 sequentially, then finally sees ProcessingView. Expected: ProcessingView appears after first upload.

### Code Locations

| File | Lines | Issue |
|------|-------|-------|
| `packages/frontend/src/components/VideoDropzone.tsx` | 278, 288-300, 302 | Sequential upload loop, isLoading management |
| `packages/frontend/src/App.tsx` | 86-102 | handleVideoUploaded callback timing |
| `packages/frontend/src/stores/appStore.ts` | 118-127 | addVideoToQueue returns isFirst flag |

---

## Pre-Test Setup

### Environment Requirements

- [ ] Frontend dev server running (`cd packages/frontend && npm run dev`)
- [ ] Backend server running (`cd apps/desktop && uvicorn backend.main:app --port 8420`)
- [ ] Browser DevTools open (Network tab)
- [ ] 3 test video files ready (different sizes recommended)

### Test Video Suggestions

| Video | Size | Purpose |
|-------|------|---------|
| small_test.mp4 | ~5MB | Fast upload, first to complete |
| medium_test.mp4 | ~20MB | Medium upload time |
| large_test.mp4 | ~50MB | Slowest upload |

### Browser DevTools Setup

1. Open DevTools (`F12`)
2. Go to Network tab
3. Enable "Preserve log"
4. Throttle network to "Slow 3G" to make timing more visible (optional)

---

## Test Scenarios

### Scenario 1: Multi-File Upload Timing

**Objective:** Verify that processing starts after first upload completes, not after all uploads complete.

#### Steps

1. [ ] Open app at `http://localhost:5173`
2. [ ] Verify "home" view with VideoDropzone is displayed
3. [ ] Click "Select Files" button
4. [ ] Select 3 video files simultaneously (Ctrl+click or Shift+click)
5. [ ] **OBSERVE AND TIME THE FOLLOWING:**

| Event | Expected Time | Actual Time | Pass/Fail |
|-------|---------------|-------------|-----------|
| First file upload completes | T+X seconds | | |
| ProcessingView appears | T+X+0.1 seconds (immediately after first) | | |
| Second file upload completes | T+Y seconds (while processing) | | |
| Third file upload completes | T+Z seconds (while processing) | | |

#### Expected Behavior (After Fix)

```
T=0:    User selects 3 files
T=3s:   small_test.mp4 upload completes
T=3.1s: View transitions to ProcessingView  <-- KEY ASSERTION
T=3.1s: Processing starts for small_test.mp4
T=8s:   medium_test.mp4 upload completes (in background)
T=15s:  large_test.mp4 upload completes (in background)
```

#### Current Buggy Behavior (Before Fix)

```
T=0:    User selects 3 files
T=3s:   small_test.mp4 upload completes (but UI still shows upload progress)
T=8s:   medium_test.mp4 upload completes (UI still shows upload progress)
T=15s:  large_test.mp4 upload completes
T=15s:  View transitions to ProcessingView  <-- BUG: 12 seconds late!
T=15s:  Processing starts for small_test.mp4
```

#### Verification

- [ ] **PASS:** ProcessingView appears within 1 second of first upload completing
- [ ] **FAIL:** ProcessingView appears only after ALL uploads complete

---

### Scenario 2: Queue Display During Upload

**Objective:** Verify queue status is visible and accurate during uploads.

#### Steps

1. [ ] Repeat steps 1-4 from Scenario 1
2. [ ] While files are uploading, observe the upload progress UI

#### Expected Behavior

- [ ] Individual file progress shown (e.g., "video1.mp4: 100%", "video2.mp4: 45%")
- [ ] Total progress accurately reflects completion ("1/3 complete")
- [ ] Queue indicator visible in header (if view transitions)

#### Verification

- [ ] Files show individual progress percentages
- [ ] Completed files show "Done" status
- [ ] Queue count is accurate

---

### Scenario 3: First File Failure

**Objective:** Verify that if the first file fails to upload, processing starts for the second successful file.

#### Steps

1. [ ] Modify test setup: use an invalid video file as the first file
2. [ ] Select: `invalid.txt`, `valid1.mp4`, `valid2.mp4`
3. [ ] Observe behavior

#### Expected Behavior

- [ ] First file shows error status
- [ ] Second file upload succeeds
- [ ] Processing starts for second file
- [ ] Third file added to queue

#### Verification

- [ ] **PASS:** Processing starts for first successful upload
- [ ] **FAIL:** Processing blocked by failed upload

---

### Scenario 4: View Transition Doesn't Lose Uploads

**Objective:** Verify that pending uploads are not lost when view transitions.

#### Steps

1. [ ] Open DevTools Network tab
2. [ ] Select 3 video files
3. [ ] Wait for first file to complete and view to transition (if fix is applied)
4. [ ] Check Network tab for remaining upload requests

#### Expected Behavior (One of these, depending on fix approach)

**Option A - Background Uploads Continue:**
- [ ] Upload XHR requests continue in Network tab
- [ ] Files are added to queue as they complete
- [ ] No "aborted" requests

**Option B - Uploads Pause and Resume:**
- [ ] Remaining uploads are tracked in queue with "pending" status
- [ ] Uploads resume after current video finishes processing

#### Verification

- [ ] No upload data is lost
- [ ] All 3 videos eventually process

---

### Scenario 5: Queue Indicator Accuracy

**Objective:** Verify the header queue indicator shows correct counts.

#### Steps

1. [ ] Upload 3 files, let first trigger processing
2. [ ] Observe header area during processing

#### Expected Display

```
Video 1 of 3 (+2 queued)
```

or

```
Processing video 1 of 3
```

#### Verification

- [ ] Queue count is visible
- [ ] Count is accurate (total videos, completed count)
- [ ] Count updates as videos complete

---

### Scenario 6: Rapid File Selection

**Objective:** Verify no race conditions when selecting files quickly.

#### Steps

1. [ ] Click "Select Files"
2. [ ] Select 2 files
3. [ ] Immediately click "Select Files" again
4. [ ] Select 2 more files

#### Expected Behavior

- [ ] All 4 files are queued
- [ ] No duplicate entries
- [ ] No JavaScript errors in console

#### Verification

- [ ] Total queue size = 4
- [ ] No console errors
- [ ] All files process eventually

---

## Console Log Verification

Open browser DevTools Console and look for:

### Expected Logs (After Fix)

```
[VideoDropzone] Upload complete: video1.mp4
[App] handleVideoUploaded called, isFirst=true
[App] Starting processing for video1.mp4
[VideoDropzone] Upload complete: video2.mp4
[App] handleVideoUploaded called, isFirst=false (already processing)
[VideoDropzone] Upload complete: video3.mp4
[App] handleVideoUploaded called, isFirst=false (already processing)
```

### Buggy Logs (Before Fix)

```
[VideoDropzone] Upload complete: video1.mp4
[VideoDropzone] Upload complete: video2.mp4
[VideoDropzone] Upload complete: video3.mp4
[VideoDropzone] All uploads finished, isLoading=false
[App] handleVideoUploaded called, isFirst=true
[App] Starting processing for video1.mp4
```

---

## Network Tab Verification

### Expected Upload Pattern (After Fix - Parallel or Streaming)

```
video1.mp4  |████████████████|  (completes)
video2.mp4  |████████░░░░░░░░|  (continues in background)
video3.mp4  |████░░░░░░░░░░░░|  (continues in background)
```

### Buggy Upload Pattern (Before Fix - Sequential Blocking)

```
video1.mp4  |████████████████|  (completes, UI waits)
video2.mp4                     |████████████████|  (waits for video1)
video3.mp4                                        |████████████████|
                                                                    ^ View transitions here
```

---

## Pass/Fail Criteria

### Critical (Must Pass)

- [ ] Processing view appears within 1 second of first upload completing
- [ ] No upload data is lost when view transitions
- [ ] Queue accurately tracks all uploaded videos

### Important (Should Pass)

- [ ] Individual file progress is displayed
- [ ] Failed uploads don't block successful ones
- [ ] Queue indicator shows correct counts

### Nice to Have

- [ ] Uploads continue in background after view transition
- [ ] User can see background upload progress from ProcessingView

---

## Recording Test Results

### Test Run Template

```markdown
## Test Run: YYYY-MM-DD HH:MM

### Environment
- Browser: Chrome/Firefox version X
- Frontend: localhost:5173
- Backend: localhost:8420
- Network: Normal / Throttled

### Test Videos
- video1.mp4: XX MB
- video2.mp4: XX MB
- video3.mp4: XX MB

### Results

| Scenario | Pass/Fail | Notes |
|----------|-----------|-------|
| 1. Timing | | |
| 2. Queue Display | | |
| 3. First File Failure | | |
| 4. View Transition | | |
| 5. Queue Indicator | | |
| 6. Rapid Selection | | |

### Issues Found
1. [Description]

### Screenshots/Recordings
- [Link to evidence]
```

---

## Automated Test Coverage

The following unit and integration tests cover this bug:

| Test File | Test Name | What It Verifies |
|-----------|-----------|------------------|
| `VideoDropzone.test.tsx` | `should call onVideoUploaded immediately when each individual upload completes` | Per-file callback timing |
| `VideoDropzone.test.tsx` | `should not block UI until all uploads complete` | isLoading state management |
| `App.integration.test.tsx` | `should start processing first video before all uploads complete` | Primary bug scenario |
| `App.integration.test.tsx` | `should transition to processing view when first video upload completes` | View state transitions |
| `App.integration.test.tsx` | `should not lose pending uploads when view transitions to processing` | Data integrity |

Run tests with:
```bash
cd packages/frontend
npm test
```

---

## Related Documentation

- **Bug Report:** [Link to issue tracker]
- **Fix PR:** [Link to pull request]
- **Architecture:** `docs/ARCHITECTURE.md` - Section 5 (Frontend Component Architecture)
- **API:** `docs/API.md` - Upload endpoints
