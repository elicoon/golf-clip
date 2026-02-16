# Bug: Browser App Fails to Detect Golf Shots

**Status:** Fixed
**Priority:** P1
**Component:** Audio Detection (audio-detector.ts)
**Date:** 2026-01-30

## Description

Uploaded a video to the browser app but no shots were detected. The test video has a very audible golf shot that should have been detected by Essentia.js audio analysis.

## Current Behavior (Before Fix)

- Upload video with clear golf shot audio
- No shots detected
- Console shows onset detection running but returning empty results

## Expected Behavior

At least one shot detected with reasonable confidence.

## Root Cause

**Essentia.js SuperFluxExtractor requires 44100Hz sample rate**

The browser app was extracting audio at 22050Hz (for memory efficiency), but Essentia.js's SuperFluxExtractor algorithm silently fails and returns an empty onset vector when given audio at a non-standard sample rate.

This was not documented in the Essentia.js API but is mentioned in the underlying Essentia C++ library documentation.

## Resolution

1. **ffmpeg-client.ts**: Changed audio extraction from `-ar 22050` to `-ar 44100`
2. **streaming-processor.ts**: Updated `SAMPLE_RATE` constant from 22050 to 44100
3. **audio-detector.ts**: Added warning if sample rate is not 44100Hz, added error handling

## Verification

After fix, processing test video IMG_3940:
- Chunk 1 (0-30s): 1 onset detected
- Chunk 2 (30-45s): 1 onset detected
- Total: 2 shots found with confidence 63% and 73%

## Files Changed

- `apps/browser/src/lib/ffmpeg-client.ts`
- `apps/browser/src/lib/streaming-processor.ts`
- `apps/browser/src/lib/audio-detector.ts`
