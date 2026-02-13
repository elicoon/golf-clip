# Handoff: Export Pipeline Architecture Rewrite

**Date:** 2026-02-02
**From Session:** Export hang debugging and E2E testing
**Priority:** P1 - Core feature broken for 4K videos

---

## Executive Summary

The current export pipeline hangs indefinitely on 4K videos (195MB+). After extensive debugging, we discovered the root cause is architectural: the frame-by-frame extraction approach is fundamentally incompatible with large files in FFmpeg WASM.

**Solution:** Replace frame extraction with FFmpeg's native `drawline` filter to composite the tracer in a single pass.

---

## Problem Statement

### Symptoms
- Export hangs at "90% extracting" for 4K videos
- Works fine for small videos (<50MB)
- User sees progress stuck indefinitely
- No error message, no timeout (or timeout takes 2+ minutes)

### Root Cause Analysis

The current pipeline does this:
```
1. Load entire video into WASM memory (195MB)
2. FFmpeg decodes ALL frames at 4K resolution
3. Extract each frame as PNG (418 frames for 14 seconds)
4. JavaScript draws tracer on each PNG
5. Re-encode all frames back to video
```

**Why it hangs:** FFmpeg WASM runs in a single thread and must decode the entire 4K video before outputting frames. For a 195MB file, this takes 2+ minutes just for decoding - and that's before any compositing.

### Console Evidence

From live debugging session with Chrome DevTools:
```
[Pipeline] Preparing video data (194.9MB)...
[Pipeline] Large blob detected (194.9MB) - forcing 1080p downscale to prevent memory exhaustion
[Pipeline] Phase 1: Extracting frames
[Pipeline] Starting frame extraction (timeout: 120s)...
[Export] Progress: extracting 10
[Export] Progress: extracting 20
...
[Export] Progress: extracting 90
[Export] Progress: extracting 90  (repeats indefinitely)
```

The "90%" is fake - it's a fallback progress interval that caps at 90%. FFmpeg isn't reporting real progress.

---

## Previous Fix Attempts (All Failed for 4K)

### Attempt 1: Remove isHevcCodec check
- **Commit:** ff3a06d
- **Result:** Fixed a different hang (pre-extraction), but 4K still hangs

### Attempt 2: Add extraction timeout
- **Commit:** 2a71e8c
- **Result:** Timeout triggers after 2 min, but that's too slow for UX

### Attempt 3: Frame count limiting + downscale
- **Commit:** dfc08dd
- **Result:** Helps with memory, but decode is still slow

### Attempt 4: Batched compositing + GC breathing room
- **Commit:** 37e41c8 (current)
- **Result:** Fixes compositing phase, but extraction still hangs

**Conclusion:** No amount of optimization will fix the fundamental architecture problem.

---

## Proposed Solution: FFmpeg Filter-Based Tracer

### New Architecture

Instead of extracting frames:
```
video → FFmpeg with drawline filter → output with tracer (single pass)
```

FFmpeg can draw directly on frames during encoding using the `drawline` filter:

```bash
ffmpeg -i input.mp4 -vf "
  drawline=x1=100:y1=800:x2=200:y2=600:color=red:thickness=4:enable='between(t,0,0.5)',
  drawline=x1=200:y1=600:x2=300:y2=400:color=red:thickness=4:enable='between(t,0.5,1.0)'
" output.mp4
```

### Why This Works

1. **Single pass** - Video is decoded and encoded once, not extracted to frames
2. **Native speed** - FFmpeg handles everything internally, no JS overhead
3. **Memory efficient** - Only one frame in memory at a time
4. **Time expressions** - `enable='between(t,T1,T2)'` controls when each segment appears

### Animated "Growing" Effect

For the tracer to grow as the ball flies, use time-based interpolation:

```bash
# Line grows from point A to point B between t=0 and t=1
drawline=x1=100:y1=800:x2='lerp(100,300,(t-0)/1)':y2='lerp(800,400,(t-0)/1)':color=red:thickness=4:enable='between(t,0,1)'
```

Or chain multiple segments that appear sequentially:
```bash
# Segment 1: appears at t=0, stays visible
drawline=x1=100:y1=800:x2=200:y2=600:color=red:enable='gte(t,0)',
# Segment 2: appears at t=0.5, stays visible
drawline=x1=200:y1=600:x2=300:y2=400:color=red:enable='gte(t,0.5)'
```

---

## Implementation Guide

### Step 1: Create Filter Generator Function

Create `apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts`:

```typescript
import { TrajectoryPoint } from './canvas-compositor'

interface FilterOptions {
  color?: string        // hex color, default '#ff0000'
  thickness?: number    // line width, default 4
  opacity?: number      // 0-1, default 0.8
  glowLayers?: number   // number of glow layers, default 2
}

/**
 * Convert trajectory points to FFmpeg drawline filter string
 *
 * @param trajectory - Array of trajectory points with normalized coords (0-1)
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @param clipStart - Start time of clip in seconds
 * @param options - Style options
 * @returns FFmpeg filter string
 */
export function trajectoryToFFmpegFilter(
  trajectory: TrajectoryPoint[],
  width: number,
  height: number,
  clipStart: number,
  options: FilterOptions = {}
): string {
  const {
    color = 'red',
    thickness = 4,
    opacity = 0.8,
    glowLayers = 2
  } = options

  if (trajectory.length < 2) {
    return ''  // No filter needed
  }

  const filters: string[] = []

  // Sort by timestamp
  const sorted = [...trajectory].sort((a, b) => a.timestamp - b.timestamp)

  // Generate drawline for each segment
  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i]
    const p2 = sorted[i + 1]

    // Convert normalized coords to pixels
    const x1 = Math.round(p1.x * width)
    const y1 = Math.round(p1.y * height)
    const x2 = Math.round(p2.x * width)
    const y2 = Math.round(p2.y * height)

    // Time relative to clip start
    const t1 = p1.timestamp - clipStart
    const t2 = p2.timestamp - clipStart

    // Add glow layers (thicker, more transparent)
    for (let g = glowLayers; g >= 0; g--) {
      const layerThickness = thickness + g * 2
      const layerOpacity = g === 0 ? opacity : opacity * 0.3

      // Line appears at t1 and stays visible
      filters.push(
        `drawline=x1=${x1}:y1=${y1}:x2=${x2}:y2=${y2}:` +
        `color=${color}@${layerOpacity}:thickness=${layerThickness}:` +
        `enable='gte(t,${t1.toFixed(3)})'`
      )
    }
  }

  return filters.join(',')
}
```

### Step 2: Update Export Pipeline

Modify `apps/browser/src/lib/video-frame-pipeline.ts`:

```typescript
import { trajectoryToFFmpegFilter } from './trajectory-to-ffmpeg-filter'

// In exportWithTracer method, replace the frame extraction loop with:

async exportWithTracer(config: ExportConfig): Promise<Blob> {
  const {
    videoBlob,
    trajectory,
    startTime,
    endTime,
    quality = 'preview',
    tracerStyle,
    onProgress,
  } = config

  const duration = endTime - startTime
  const inputName = 'input.mp4'
  const outputName = 'output.mp4'

  // Phase 1: Prepare video data
  onProgress?.({ phase: 'preparing', progress: -1 })
  const videoData = await fetchFile(videoBlob)
  await this.ffmpeg.writeFile(inputName, videoData)
  onProgress?.({ phase: 'preparing', progress: 100 })

  // Phase 2: Get video dimensions
  // Run ffprobe or extract single frame to get dimensions
  const dimensions = await this.getVideoDimensions(inputName)

  // Phase 3: Generate filter string from trajectory
  onProgress?.({ phase: 'compositing', progress: 0 })
  const tracerFilter = trajectoryToFFmpegFilter(
    trajectory,
    dimensions.width,
    dimensions.height,
    startTime,
    {
      color: tracerStyle.color || 'red',
      thickness: tracerStyle.lineWidth || 4,
      opacity: 0.8,
      glowLayers: tracerStyle.glowEnabled ? 2 : 0
    }
  )

  // Phase 4: Single-pass encode with tracer overlay
  onProgress?.({ phase: 'encoding', progress: 0 })

  const { crf, preset } = QUALITY_SETTINGS[quality]

  // Build video filter - trim + tracer
  const vfFilter = tracerFilter || 'null'  // 'null' is passthrough filter

  // Set up progress listener
  this.ffmpeg.on('progress', ({ progress }) => {
    onProgress?.({ phase: 'encoding', progress: Math.round(progress * 100) })
  })

  const exitCode = await this.ffmpeg.exec([
    '-ss', startTime.toString(),
    '-i', inputName,
    '-t', duration.toString(),
    '-vf', vfFilter,
    '-c:v', 'libx264',
    '-crf', crf.toString(),
    '-preset', preset,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-y',
    outputName,
  ])

  if (exitCode !== 0) {
    throw new Error(`FFmpeg encoding failed with exit code ${exitCode}`)
  }

  onProgress?.({ phase: 'complete', progress: 100 })

  const result = await this.ffmpeg.readFile(outputName)

  // Cleanup
  await this.ffmpeg.deleteFile(inputName)
  await this.ffmpeg.deleteFile(outputName)

  return new Blob([new Uint8Array(result as Uint8Array)], { type: 'video/mp4' })
}

private async getVideoDimensions(inputName: string): Promise<{width: number, height: number}> {
  // Option 1: Extract single frame and check dimensions
  await this.ffmpeg.exec([
    '-i', inputName,
    '-vframes', '1',
    '-f', 'image2',
    'probe.png'
  ])

  const frameData = await this.ffmpeg.readFile('probe.png')
  const blob = new Blob([new Uint8Array(frameData as Uint8Array)], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const dims = { width: bitmap.width, height: bitmap.height }
  bitmap.close()

  await this.ffmpeg.deleteFile('probe.png')
  return dims
}
```

### Step 3: Handle Edge Cases

1. **Empty trajectory** - If no trajectory, just trim the video without filter
2. **Very long trajectories** - FFmpeg has filter string length limits; may need to batch
3. **Markers (apex, landing)** - Can add `drawtext` or `drawbox` filters for markers

### Step 4: Update Tests

Update `apps/browser/src/lib/video-frame-pipeline.test.ts`:
- Add tests for `trajectoryToFFmpegFilter()`
- Update integration tests to verify new pipeline
- Remove tests for frame extraction (no longer used)

---

## Trajectory Data Format Reference

### TrajectoryPoint Interface
```typescript
interface TrajectoryPoint {
  timestamp: number   // Absolute time in video (seconds)
  x: number          // Normalized X coord (0 = left, 1 = right)
  y: number          // Normalized Y coord (0 = top, 1 = bottom)
  confidence?: number
  interpolated?: boolean
}
```

### Example Trajectory
```json
[
  {"timestamp": 2.5, "x": 0.45, "y": 0.85},   // Ball at origin
  {"timestamp": 2.6, "x": 0.48, "y": 0.75},   // Rising
  {"timestamp": 2.8, "x": 0.55, "y": 0.55},   // Mid-flight
  {"timestamp": 3.2, "x": 0.65, "y": 0.25},   // Near apex
  {"timestamp": 3.5, "x": 0.70, "y": 0.20},   // Apex
  {"timestamp": 4.0, "x": 0.78, "y": 0.45},   // Descending
  {"timestamp": 4.5, "x": 0.85, "y": 0.70}    // Landing
]
```

---

## Tracer Style Requirements

The tracer should match the current canvas implementation in `canvas-compositor.ts`:

1. **Color:** Red (#ff0000) by default, configurable
2. **Glow effect:** Multiple layered lines with decreasing opacity
   - Outer: thickness + 4px, 30% opacity
   - Middle: thickness + 2px, 30% opacity
   - Core: base thickness, 80% opacity
3. **Animation:** Line grows progressively as video plays
4. **Markers:**
   - Apex marker: Gold diamond at highest point
   - Landing marker: Arrow pointing down at landing point

### Marker Implementation (Optional Enhancement)

```bash
# Apex marker - gold circle
drawbox=x=X-5:y=Y-5:w=10:h=10:color=gold:t=fill:enable='gte(t,APEX_TIME)'

# Landing marker - could use drawtext with arrow character
drawtext=text='↓':x=X:y=Y:fontsize=24:fontcolor=white:enable='gte(t,LAND_TIME)'
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `apps/browser/src/lib/video-frame-pipeline.ts` | Replace frame extraction with filter-based approach |
| `apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts` | **NEW** - Filter generator function |
| `apps/browser/src/lib/video-frame-pipeline.test.ts` | Update tests for new architecture |
| `apps/browser/src/lib/canvas-compositor.ts` | Keep for preview, reference for style |

---

## Testing Checklist

### Unit Tests
- [ ] `trajectoryToFFmpegFilter()` generates valid filter string
- [ ] Empty trajectory returns empty string
- [ ] Coordinates correctly converted from normalized to pixels
- [ ] Time expressions correctly calculated relative to clip start
- [ ] Glow layers generated correctly

### Integration Tests
- [ ] Export completes for small video (<10MB)
- [ ] Export completes for medium video (50MB)
- [ ] Export completes for large 4K video (195MB) **in <30 seconds**
- [ ] Tracer appears in output video
- [ ] Tracer animates correctly (grows over time)
- [ ] Audio preserved in output

### Manual E2E Tests
- [ ] Upload 4K iPhone video
- [ ] Mark landing point
- [ ] Generate trajectory
- [ ] Export with tracer
- [ ] Verify export completes quickly
- [ ] Download and play output video
- [ ] Verify tracer looks correct

---

## FFmpeg Filter Reference

### drawline syntax
```
drawline=x1=X1:y1=Y1:x2=X2:y2=Y2:color=COLOR[@OPACITY]:thickness=N:enable='EXPR'
```

### Time expressions
- `t` - Current time in seconds
- `between(t,T1,T2)` - True if T1 <= t <= T2
- `gte(t,T)` - True if t >= T (line stays visible after appearing)
- `lte(t,T)` - True if t <= T

### Color formats
- Named: `red`, `blue`, `green`, `white`, `gold`
- Hex: `0xff0000` (note: not `#ff0000`)
- With opacity: `red@0.8`, `0xff0000@0.5`

### Chaining filters
```
filter1,filter2,filter3
```

---

## Potential Issues & Mitigations

### Issue 1: Filter string length limit
FFmpeg may have limits on filter complexity. For trajectories with many points:
- **Mitigation:** Simplify trajectory by sampling fewer points (every 3rd point)
- **Mitigation:** Use `geq` filter for mathematical curve instead of many lines

### Issue 2: Performance on very long clips
Long clips = many filter segments = slower processing
- **Mitigation:** Limit trajectory to key points only
- **Mitigation:** Add progress indicator based on FFmpeg progress events

### Issue 3: FFmpeg WASM filter support
Not all FFmpeg filters are available in WASM build
- **Mitigation:** Test `drawline` filter works in `@ffmpeg/ffmpeg`
- **Fallback:** If drawline unavailable, use `drawbox` with 1px height

### Issue 4: Glow effect limitations
True glow requires blur filter which may be slow
- **Mitigation:** Simulate glow with layered semi-transparent lines
- **Enhancement:** Add option for simple line without glow for faster export

---

## Success Criteria

1. **Performance:** 4K 14-second video exports in <30 seconds (currently hangs indefinitely)
2. **Quality:** Tracer looks similar to current canvas implementation
3. **Animation:** Tracer grows progressively as video plays
4. **Reliability:** No hangs, no crashes, proper error handling
5. **Tests:** All existing tests pass, new tests for filter generation

---

## Related Documentation

- [Bug doc](../bugs/bug-export-tracer-pipeline-hang.md) - Full investigation history
- [Debug session v2](../plans/2026-02-02-e2e-debug-session-v2.md) - All debug steps taken
- [UAT checklist](../uat/export-pipeline-uat.md) - Manual test scenarios
- [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html#drawline) - Official docs

---

## Quick Start Commands

```bash
# Run tests
cd apps/browser && npm run test

# Start dev server
cd apps/browser && npm run dev

# Build for production
cd apps/browser && npm run build

# Deploy to Vercel
vercel --prod --yes
```

---

## Contact

If blocked, check:
1. FFmpeg WASM docs: https://github.com/ffmpegwasm/ffmpeg.wasm
2. FFmpeg filter docs: https://ffmpeg.org/ffmpeg-filters.html
3. Previous session handoffs in `docs/session-handoffs/`
