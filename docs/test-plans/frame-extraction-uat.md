# Frame Extraction Bug - E2E User Acceptance Testing

> **Purpose:** Manual UAT checklist to verify the frame extraction bug fix works correctly with real HEVC videos.

**Bug Summary:**
- Export fails with HEVC videos because FFmpeg.wasm lacks HEVC decoder
- FFmpeg exit code was not checked after frame extraction
- Generic error message "Frame extraction produced no frames" hid the actual failure reason

**Files Affected:**
- `apps/browser/src/lib/video-frame-pipeline.ts` (lines 109-134)
- `apps/browser/src/lib/ffmpeg-client.ts`

**Related Tests:**
- `apps/browser/src/lib/video-frame-pipeline.test.ts` - Unit tests for exit code handling
- `apps/browser/src/lib/video-frame-pipeline.integration.test.ts` - Integration tests

---

## Test Environment

### Prerequisites
- [ ] Chrome browser (latest version)
- [ ] GolfClip browser app running locally or deployed
- [ ] HEVC test video available (iPhone MOV files are typically HEVC)
- [ ] H.264 test video available for comparison

### Test Video Inventory

| Video | Format | Codec | Size | Purpose |
|-------|--------|-------|------|---------|
| iPhone recording (.MOV) | MOV | HEVC/H.265 | Any | Primary HEVC test |
| Screen recording (.MP4) | MP4 | H.264 | Any | Control - should work |
| Transcoded video (.MP4) | MP4 | H.264 | Any | Recovery verification |

---

## Test Scenario 1: HEVC Detection at Upload Time

**Goal:** Verify HEVC videos are detected early and user sees transcode option.

### Steps

1. **Navigate to app**
   ```
   URL: http://localhost:5174 (or production URL)
   ```

2. **Upload HEVC video (iPhone MOV)**
   ```
   Action: Drag and drop or select iPhone MOV file
   Expected: App begins processing
   ```

3. **Verify HEVC detection**
   ```
   Expected outcomes (one of):
   a) During upload: "HEVC video detected" modal appears
   b) During playback test: Codec incompatibility detected

   Modal should offer:
   - "Transcode to H.264" option
   - Estimated time
   - Cancel option
   ```

### Acceptance Criteria
- [ ] HEVC detected before or during video preview
- [ ] User sees clear "transcode required" message (not generic error)
- [ ] Transcode option is prominently displayed
- [ ] Estimated transcode time shown

---

## Test Scenario 2: Export Failure with HEVC (Before Fix)

**Goal:** Document the buggy behavior for regression testing.

> **Note:** Run this BEFORE applying the fix to document current behavior.

### Steps

1. **Upload HEVC video that bypasses detection**
   ```
   Some HEVC videos may slip through codec detection
   (e.g., if browser can preview but FFmpeg.wasm can't decode)
   ```

2. **Proceed to shot review and attempt export**
   ```
   Action: Mark landing, configure tracer, click Export
   ```

3. **Observe error message**
   ```
   BUGGY behavior (current):
   - Generic error: "Frame extraction produced no frames. The video may be corrupted or in an unsupported format."
   - No mention of codec
   - No recovery option

   Screenshot: Save to docs/test-evidence/hevc-bug-before-fix.png
   ```

### Evidence to Capture
- [ ] Screenshot of generic error message
- [ ] Console log showing FFmpeg output (F12 > Console)
- [ ] Note any FFmpeg logs mentioning "hevc" or "h265"

---

## Test Scenario 3: Export Failure with HEVC (After Fix)

**Goal:** Verify the fix provides descriptive error and recovery path.

### Steps

1. **Upload HEVC video**
   ```
   Same video as Scenario 2
   ```

2. **Attempt export**
   ```
   Action: Mark landing, configure tracer, click Export
   ```

3. **Verify descriptive error**
   ```
   EXPECTED behavior (after fix):
   - Error mentions "exit code" or "FFmpeg failed"
   - Error includes codec information if available
   - Does NOT say "may be corrupted"

   Screenshot: Save to docs/test-evidence/hevc-error-after-fix.png
   ```

4. **Verify recovery option**
   ```
   Expected:
   - HevcExportError is thrown (check console)
   - Transcode modal appears automatically
   - User can transcode and retry export
   ```

### Acceptance Criteria
- [ ] Error message mentions FFmpeg exit code
- [ ] Error message does NOT say "may be corrupted"
- [ ] Console shows HevcExportError (not generic Error)
- [ ] Transcode modal appears as recovery option

---

## Test Scenario 4: Successful Export After Transcoding

**Goal:** Verify complete recovery flow works.

### Steps

1. **Start with HEVC video**
   ```
   Upload HEVC video, trigger export error
   ```

2. **Accept transcode option**
   ```
   Action: Click "Transcode to H.264" in modal
   Expected:
   - Progress bar shows transcoding progress
   - Estimated time displayed
   - Cancel option available
   ```

3. **Wait for transcode completion**
   ```
   Expected:
   - Progress reaches 100%
   - Modal closes or shows "Complete"
   - Video is replaced with H.264 version
   ```

4. **Retry export**
   ```
   Action: Attempt export again with transcoded video
   Expected:
   - Frame extraction succeeds
   - Compositing phase proceeds
   - Export completes successfully
   - Downloaded file is valid MP4 with tracer
   ```

### Acceptance Criteria
- [ ] Transcode completes without error
- [ ] Export succeeds with transcoded video
- [ ] Downloaded clip is playable
- [ ] Tracer is visible in exported clip

---

## Test Scenario 5: H.264 Video (Control Test)

**Goal:** Verify H.264 videos still work correctly.

### Steps

1. **Upload H.264 video**
   ```
   File: Screen recording or known H.264 file
   ```

2. **Complete full flow**
   ```
   - Detection completes
   - Mark landing point
   - Configure tracer
   - Export
   ```

3. **Verify success**
   ```
   Expected:
   - No transcode prompts
   - Export completes
   - File downloads
   ```

### Acceptance Criteria
- [ ] No unnecessary transcode prompts for H.264
- [ ] Export works first time
- [ ] Performance is not degraded

---

## Test Scenario 6: Error Message Clarity

**Goal:** Verify error messages are actionable for users.

### Error Message Comparison

| Scenario | Before Fix | After Fix |
|----------|------------|-----------|
| HEVC decode failure | "Frame extraction produced no frames. The video may be corrupted or in an unsupported format." | "Frame extraction failed with exit code 1. Video codec may not be supported." |
| FFmpeg crash | Same generic message | "FFmpeg failed: [specific error]" |
| Timeout | Same generic message | "Frame extraction timed out after X seconds" |

### Acceptance Criteria
- [ ] Error messages mention specific failure (exit code, codec)
- [ ] Error messages do NOT blame user ("corrupted")
- [ ] Error messages suggest action (transcode option)

---

## Test Results Template

```markdown
## UAT Run: YYYY-MM-DD HH:MM

### Environment
- Browser: Chrome XX.X
- App Version: [commit hash or deployment]
- OS: Windows/macOS/Linux

### Test Videos Used
| Video | File | Codec | Size |
|-------|------|-------|------|
| HEVC Test | IMG_XXXX.MOV | HEVC | XXX MB |
| H.264 Control | test.mp4 | H.264 | XXX MB |

### Results

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. HEVC Detection | Pass/Fail | |
| 2. Buggy Error (baseline) | N/A | |
| 3. Descriptive Error | Pass/Fail | |
| 4. Transcode Recovery | Pass/Fail | |
| 5. H.264 Control | Pass/Fail | |
| 6. Error Message Clarity | Pass/Fail | |

### Screenshots Captured
- [ ] docs/test-evidence/hevc-detection-modal.png
- [ ] docs/test-evidence/hevc-error-after-fix.png
- [ ] docs/test-evidence/transcode-progress.png
- [ ] docs/test-evidence/export-success.png

### Issues Found
1. [Issue description]
2. [Issue description]

### Sign-off
- Tester: [Name]
- Date: [Date]
- Verdict: Pass / Fail / Blocked
```

---

## Regression Test Checklist

After the fix is applied, run these quick checks:

### Quick Smoke Test (5 min)
- [ ] Upload H.264 video - export works
- [ ] Upload HEVC video - shows transcode option (not generic error)

### Full Regression (15 min)
- [ ] All Scenario 1-6 pass
- [ ] Console shows no unexpected errors
- [ ] Memory usage stable after multiple exports

### Before Production Deploy
- [ ] Full regression on Chrome
- [ ] Quick smoke test on Firefox
- [ ] Quick smoke test on Safari (if available)

---

## Appendix: How to Identify Video Codec

### Using FFprobe (command line)
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 video.mov
```
Output: `hevc` or `h264`

### Using Browser DevTools
1. Open video in browser
2. Right-click video element
3. Look for codec info in media info panel

### Using VLC
1. Open video in VLC
2. Tools > Codec Information
3. Check "Codec" field under "Video"

---

## Related Documentation

- Bug Report: `docs/bugs/frame-extraction-hevc-failure.md`
- Unit Tests: `apps/browser/src/lib/video-frame-pipeline.test.ts`
- Integration Tests: `apps/browser/src/lib/video-frame-pipeline.integration.test.ts`
- Architecture: `docs/ARCHITECTURE.md` (Section 4: Trajectory Generation Pipeline)
