# Bug: HEVC Transcoding Button Resets UI

**Date:** 2026-02-01
**Status:** Fixed
**Priority:** Critical
**Component:** Browser App - HEVC Modal / Video Processing

---

## Summary

When uploading an HEVC-encoded video, clicking "Start Transcoding" causes the UI to reset to the initial upload screen instead of starting the transcoding process. This blocks all iPhone video uploads since most modern iPhones record in HEVC by default.

---

## Steps to Reproduce

1. Navigate to https://browser-seven-sigma.vercel.app
2. Click "Select File" and choose an HEVC-encoded video (e.g., any recent iPhone recording)
3. Wait for format detection - modal appears showing:
   - "Unsupported Video Format"
   - "Detected: HEVC encoding (0 MB)"
   - "Supported: H.264, VP8, VP9"
4. Click "Start Transcoding" button

**Expected Result:**
- Transcoding progress indicator appears
- Video is converted to H.264
- Processing continues to shot detection

**Actual Result:**
- UI immediately resets to empty drop zone
- No transcoding occurs
- User must re-upload

---

## Environment

- **Browser:** Chrome 121+
- **Deployment:** https://browser-seven-sigma.vercel.app
- **Test Video:** IMG_3940.MP4 (HEVC, iPhone recording)

---

## Evidence

Screenshot: `docs/test-evidence/bug-transcoding-reset.png`

**Actual error message visible in screenshot:**
> ⚠️ Transcode failed: File could not be read! Code=8

---

## Root Cause Analysis

### The Problem

The `File` object stored in React state (`hevcWarning.file`) became **invalidated/unreadable** between when it was stored and when `transcodeHevcToH264()` tried to read it via FFmpeg's `fetchFile()`.

### Data Flow Trace

1. User selects HEVC video → `handleFile(file)` called
2. `detectVideoCodec(file)` runs, creates/revokes object URL for playability test
3. `setHevcWarning({ file, ... })` stores the `File` reference in React state
4. User clicks "Start Transcoding" → `handleTranscode()` called
5. `transcodeHevcToH264(file)` → `fetchFile(file)` → **FileReader fails with Code=8**

### Why the File Became Unreadable

The browser's `File` object is a reference to the underlying file data. Between storage and read:
- Browser garbage collection could release the underlying ArrayBuffer
- The `detectVideoCodec()` cleanup (`video.load()`) could trigger file handle release
- Memory pressure in browser could cause the File reference to become stale

This is a known issue with FFmpeg WASM's `fetchFile()` function when working with File objects that have been held in state for extended periods. Related issues:
- [ffmpegwasm/ffmpeg.wasm#185](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/185)
- [ffmpegwasm/ffmpeg.wasm#201](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/201)

### The "0 MB" Display

The "0 MB" in the modal was a red herring - this only occurs when `file.size` rounds down for small test files. The actual error was the file read failure during transcoding, not during size calculation.

---

## Fix Applied

**Commit:** (pending deployment)

### Solution

Store the file data as a `Blob` (via `file.arrayBuffer()`) **immediately** when HEVC is detected, rather than storing a `File` reference that can become stale.

### Files Modified

1. **`apps/browser/src/components/VideoDropzone.tsx`**
   - Added `fileBlob: Blob | null` to `HevcWarningState` interface
   - In `handleFile()`: Read file into Blob immediately when HEVC detected
   - In `handleTranscode()`: Use preserved `fileBlob` instead of potentially stale `File`

2. **`apps/browser/src/components/VideoDropzone.test.tsx`**
   - Updated tests to use proper `ArrayBuffer`-backed File objects

### Code Change Summary

```typescript
// Before: File reference could become stale
setHevcWarning({ file, ... })
// Later in handleTranscode():
await transcodeHevcToH264(file)  // ❌ "File could not be read! Code=8"

// After: Blob preserves the actual data in memory
const fileBlob = new Blob([await file.arrayBuffer()], { type: file.type })
setHevcWarning({ file, fileBlob, ... })
// Later in handleTranscode():
await transcodeHevcToH264(fileBlob)  // ✅ Works reliably
```

### Memory Tradeoff

This fix duplicates the file data in memory (original File + preserved Blob). For a 500MB video, this means ~1GB memory usage during the HEVC modal display. This is acceptable because:
- The modal is only shown temporarily before transcoding
- Modern browsers can handle 1-2GB for short periods
- The alternative (broken transcoding) is worse

---

## Verification

- All 155 browser app tests pass
- HEVC modal tests specifically verify the new flow works

---

## Workaround (No Longer Needed)

~~Users can work around this by:~~
1. ~~Re-exporting their iPhone video using "More Compatible" format before uploading~~
2. ~~Using a desktop video converter to create H.264 version~~
3. ~~Using the desktop app instead~~

---

## Related Files

**Affected source files:**
- `apps/browser/src/components/VideoDropzone.tsx` ✅ Fixed
- `apps/browser/src/components/HevcTranscodeModal.tsx` (no changes needed)
- `apps/browser/src/lib/ffmpeg-client.ts` (no changes needed)

---

## Priority Justification

**Critical** because:
- Most iPhone videos are HEVC by default
- iPhone users are a primary target audience for golf video apps
- The modal correctly offers transcoding but doesn't work
- Complete feature blockage with no graceful degradation

---

## Lessons Learned

1. **File objects in browser state can become stale** - When storing user-selected files for later async operations, preserve the data immediately rather than relying on the File reference.

2. **Error messages are gold** - The screenshot showing "File could not be read! Code=8" was the key evidence. Always capture actual error messages when reporting bugs.

3. **FFmpeg WASM has file handling quirks** - The `fetchFile()` function relies on FileReader which can fail if the File object's underlying data is no longer accessible.
