# Golf-Clip Browser App - Handoff for Next Steps

## Context

A browser-only golf clip processor was just implemented in `apps/browser/`. PR #3 is open: https://github.com/elicoon/golf-clip/pull/3

The implementation is complete with 21 passing tests, but needs manual E2E testing and a few polish items before merge.

## Current State

- **Branch:** `feat/browser-app` (15 commits ahead of master)
- **Tests:** 21 unit tests passing
- **Build:** Succeeds with one expected warning (Essentia WASM chunk is 2.5MB)

## Immediate Next Steps

### 1. Manual E2E Testing (Priority)

Start the dev server and test with a real golf video:

```bash
cd c:/Users/Eli/projects/golf-clip/apps/browser
npm run dev
```

Then in browser (http://localhost:5173):
- [ ] Drop a golf video file
- [ ] Verify FFmpeg loads (progress shows "Loading FFmpeg...")
- [ ] Verify audio analysis runs (progress shows chunk analysis)
- [ ] Verify strikes are detected (results page shows shots)
- [ ] Verify video segments play correctly
- [ ] Test "Process Another Video" button

### 2. Code Review Suggestions to Address

From final review - optional but recommended:

1. **Suppress chunk size warning** - Add to `vite.config.ts`:
   ```typescript
   build: {
     chunkSizeWarningLimit: 3000, // Expected due to WASM
   }
   ```

2. **Fix potential index mismatch** in `App.tsx` - The segments/strikes arrays are assumed to be synchronized. Consider storing strike data in the segment object or using `strikeTime` to find the matching strike.

3. **Add cancellation support** - `processVideoFile()` has no abort mechanism for long videos. Consider adding `AbortSignal` parameter.

### 3. Vercel Deployment Test

Deploy to Vercel and verify:
- [ ] CORS headers work (SharedArrayBuffer enabled)
- [ ] FFmpeg.wasm loads from CDN
- [ ] Full processing pipeline works in production

## Architecture Reference

```
apps/browser/
├── src/
│   ├── lib/
│   │   ├── ffmpeg-client.ts      # FFmpeg.wasm wrapper
│   │   ├── audio-detector.ts     # Essentia.js strike detection
│   │   ├── segment-extractor.ts  # Memory-efficient video slicing
│   │   ├── streaming-processor.ts # Pipeline orchestration
│   │   └── clip-exporter.ts      # Export with tracer overlay
│   ├── components/
│   │   ├── VideoDropzone.tsx     # Drag/drop UI
│   │   └── TrajectoryEditor.tsx  # Canvas trajectory overlay
│   ├── stores/
│   │   └── processingStore.ts    # Zustand state
│   └── App.tsx                   # Main app component
├── vite.config.ts                # Vite + CORS headers
├── vercel.json                   # Deployment config
└── package.json                  # Dependencies
```

## Key Technical Details

- **Memory bounded:** Processes audio in 30-second chunks, uses `File.slice()` for segments
- **CORS required:** SharedArrayBuffer needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
- **Strike detection:** Bandpass filter (1000-8000 Hz), SuperFlux onset detection, confidence scoring based on spectral centroid/flatness/RMS

## Starter Prompt

```
I'm continuing work on the golf-clip browser app. PR #3 is open.

Please:
1. Checkout the feat/browser-app branch
2. Run the dev server (npm run dev in apps/browser)
3. Help me manually test the E2E flow with a golf video
4. Address any issues found during testing

The implementation is complete but needs validation before merge.
```
