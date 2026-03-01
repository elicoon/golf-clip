# UAT: HEVC Browser Testing Checklist

## Scope

Manual verification that `detectVideoCodec()` correctly identifies HEVC vs. H.264 across browsers and environments, and that `HevcTranscodeModal` appears (or is skipped) accordingly.

`detectVideoCodec()` uses the browser's native video element — not FFmpeg — so behavior varies by browser's built-in codec support and hardware acceleration settings.

## Test Files Required

| File | Purpose |
|------|---------|
| Small HEVC `.mov` or `.mp4` (<50MB) | Quick modal trigger tests |
| Large HEVC `.mov` or `.mp4` (500MB+) | Progress bar, memory, and time estimate tests |
| H.264 `.mp4` | Confirm modal does NOT appear |
| Corrupted/truncated video file | Verify error handling path |

## Browser Matrix

| Browser | OS | HW Acceleration | Expected HEVC Behavior |
|---------|----|-----------------|------------------------|
| Chrome (latest) | Windows | Enabled | HEVC plays natively — **modal skipped** |
| Chrome (latest) | Windows | Disabled (`chrome://flags/#disable-accelerated-video-decode`) | HEVC rejected — **modal appears** |
| Chrome (latest) | macOS | Enabled | HEVC plays natively — **modal skipped** |
| Firefox (latest) | Windows | N/A | No HEVC support — **modal always appears** |
| Firefox (latest) | macOS | N/A | No HEVC support — **modal always appears** |
| Safari (latest) | macOS | N/A | Native HEVC support — **modal skipped** |
| Edge (latest) | Windows | Enabled | Chromium-based, HW dependent — **modal skipped** |
| Edge (latest) | Windows | Disabled | HEVC rejected — **modal appears** |

## Environment Matrix

| Environment | URL / Command | Notes |
|-------------|---------------|-------|
| Dev build | `npm run dev` (localhost:5173) | No CDN caching |
| Production build | `npm run build && npm run preview` | Tests optimized bundle |
| Deployed (Vercel) | Production Vercel URL | Tests CDN + real network |

---

## Edge Case Test Steps

### TC-01: HEVC detection triggers modal in Firefox

**Precondition:** Firefox (any version), any OS
**Steps:**
1. Open app in Firefox
2. Drop a small HEVC `.mov` or `.mp4` file onto the dropzone
3. Observe whether HevcTranscodeModal appears

**Expected:** Modal appears with transcoding options. `detectVideoCodec()` returns `isHevc: true`.
**Pass/Fail:** ___  **Notes:** ___

---

### TC-02: HEVC detection skips modal in Chrome with hardware acceleration

**Precondition:** Chrome on Windows or macOS, hardware acceleration enabled
**Steps:**
1. Confirm `chrome://settings/system` → "Use hardware acceleration when available" is ON
2. Open app in Chrome
3. Drop a small HEVC `.mov` or `.mp4` onto the dropzone
4. Observe whether HevcTranscodeModal appears

**Expected:** Modal does NOT appear. Video proceeds directly to shot detection. `detectVideoCodec()` returns `isHevc: false`.
**Pass/Fail:** ___  **Notes:** ___

---

### TC-03: Progress bar updates correctly during transcoding

**Precondition:** Browser where modal appears (e.g., Firefox), large HEVC file (500MB+)
**Steps:**
1. Drop a large HEVC file onto the dropzone in Firefox
2. When HevcTranscodeModal appears, click "Transcode Video"
3. Observe the progress bar during transcoding

**Expected:** Progress bar increments smoothly (no frozen states). Time estimate displayed. UI remains responsive.
**Pass/Fail:** ___  **Notes:** ___

---

### TC-04: Cancel button resets to modal (not dropzone)

**Precondition:** Browser where modal appears, any HEVC file
**Steps:**
1. Drop HEVC file — HevcTranscodeModal appears
2. Click "Transcode Video" to begin transcoding
3. While transcoding is in progress, click "Cancel"

**Expected:** UI returns to HevcTranscodeModal (showing transcoding options), NOT back to the dropzone. The user can restart transcoding.
**Pass/Fail:** ___  **Notes:** ___

---

### TC-05: "Upload Different Video" closes modal and returns to dropzone

**Precondition:** Browser where modal appears, any HEVC file
**Steps:**
1. Drop HEVC file — HevcTranscodeModal appears
2. Click "Upload Different Video"

**Expected:** Modal closes and the dropzone is shown again. No error displayed.
**Pass/Fail:** ___  **Notes:** ___

---

### TC-06: Time estimates display correctly for various file sizes

**Precondition:** Browser where modal appears (e.g., Firefox)
**Steps:**
1. Drop a small HEVC file (<50MB) — note the estimated time shown
2. Drop a large HEVC file (500MB+) — note the estimated time shown

**Expected:** Small file shows a shorter estimate than large file. Estimates update as transcoding progresses (don't stay frozen at initial value).
**Pass/Fail:** ___  **Notes:** ___

---

### TC-07: Transcoding completes and proceeds to shot detection

**Precondition:** Browser where modal appears, small HEVC file (<50MB) for speed
**Steps:**
1. Drop HEVC file — modal appears
2. Click "Transcode Video"
3. Wait for transcoding to complete

**Expected:** After completion, app transitions to the shot detection / clip review view. No error screen shown.
**Pass/Fail:** ___  **Notes:** ___

---

### TC-08: Error handling for failed transcodes

**Precondition:** Browser where modal appears
**Steps:**
1. Drop a corrupted or truncated video file onto the dropzone
2. If modal appears, click "Transcode Video"
3. If modal does not appear, the file is processed directly — observe error handling

**Expected:** If transcoding fails (FFmpeg error), an error message is displayed. App does not hang or show a blank screen. User can try again or upload a different file.
**Pass/Fail:** ___  **Notes:** ___

---

### TC-09: Memory usage during large file transcoding

**Precondition:** Browser where modal appears, large HEVC file (500MB+)
**Steps:**
1. Open browser DevTools → Memory tab (or Task Manager)
2. Drop a large HEVC file — modal appears
3. Click "Transcode Video"
4. Monitor memory usage throughout transcoding

**Expected:** Memory usage stays reasonable (<2GB browser tab RAM). No out-of-memory crash or tab kill. Memory is released after transcoding completes.
**Pass/Fail:** ___  **Notes:** ___

---

## Results Table

| Test Case | Chrome Win (HW on) | Chrome Win (HW off) | Firefox Win | Safari Mac | Edge Win |
|-----------|-------------------|---------------------|-------------|------------|----------|
| TC-01: HEVC triggers modal in Firefox | N/A | N/A | ___ | N/A | N/A |
| TC-02: Chrome HW accel skips modal | ___ | N/A | N/A | N/A | ___ |
| TC-03: Progress bar | N/A | ___ | ___ | N/A | ___ |
| TC-04: Cancel → modal | N/A | ___ | ___ | N/A | ___ |
| TC-05: Upload different | ___ | ___ | ___ | ___ | ___ |
| TC-06: Time estimates | N/A | ___ | ___ | N/A | ___ |
| TC-07: Transcode → shot detection | N/A | ___ | ___ | N/A | ___ |
| TC-08: Corrupted file error | ___ | ___ | ___ | ___ | ___ |
| TC-09: Memory (large file) | N/A | ___ | ___ | N/A | ___ |

**Legend:** ✅ Pass | ❌ Fail | ⚠️ Partial | N/A Not applicable

---

## Environment Sign-off

| Environment | Tester | Date | Pass/Fail |
|-------------|--------|------|-----------|
| Dev build | | | |
| Production build | | | |
| Vercel deployed | | | |
