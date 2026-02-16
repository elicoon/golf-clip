# Export FFmpeg Filter POC Design

**Date:** 2026-02-02
**Status:** Approved
**Related:** [Export Architecture Rewrite Handoff](../session-handoffs/2026-02-02-export-architecture-rewrite.md)

---

## Problem

The current export pipeline hangs indefinitely on 4K videos (195MB+). Root cause: frame-by-frame extraction is fundamentally incompatible with large files in FFmpeg WASM.

## Solution

Replace frame extraction with FFmpeg's native `drawline` filter to composite the tracer in a single pass.

---

## POC Scope

### In Scope
- Prove `drawline` filter works in FFmpeg WASM
- Export a 4K video clip with tracer overlay in <30 seconds
- Tracer line appears and animates (grows progressively)

### Out of Scope
- Glow effects (layered lines)
- Apex/landing markers
- Configurable colors or line widths
- Unit tests
- Full UI integration (temporary "Export v2" button only)

### Fail-Fast Behavior
If `drawline` filter doesn't work in FFmpeg WASM, POC fails and we document findings.

---

## Success Criteria

1. Export a 14-second clip from a 4K video (494MB test file) in **<30 seconds**
2. Tracer line appears in the output video
3. Tracer animates (grows progressively as video plays)

---

## Architecture

### New Files

```
apps/browser/src/lib/
├── trajectory-to-ffmpeg-filter.ts   # Convert trajectory → FFmpeg filter string
└── video-frame-pipeline-v2.ts       # New single-pass export pipeline
```

### UI Change (Temporary)

Add "Export v2 (POC)" button in `ClipReview.tsx` to test new pipeline side-by-side with existing.

### Data Flow

```
User clicks "Export v2 (POC)"
    │
    ▼
trajectory-to-ffmpeg-filter.ts
    │  • Takes TrajectoryPoint[] + video dimensions
    │  • Returns FFmpeg drawline filter string
    ▼
video-frame-pipeline-v2.ts
    │  • Writes video to FFmpeg WASM
    │  • Gets video dimensions (single frame probe)
    │  • Runs single FFmpeg command: trim + drawline filter + encode
    │  • Returns output Blob
    ▼
Browser downloads exported clip
```

### Key Difference from Current Pipeline

| Current | New (POC) |
|---------|-----------|
| Extract 400+ frames | Single FFmpeg pass |
| JS composites each frame | Filter applied during encode |
| 2+ minutes for 4K (hangs) | Target: <30 seconds |

---

## Implementation Details

### trajectory-to-ffmpeg-filter.ts

```typescript
import { TrajectoryPoint } from './canvas-compositor'

/**
 * Convert trajectory points to FFmpeg drawline filter string
 */
export function trajectoryToFFmpegFilter(
  trajectory: TrajectoryPoint[],
  width: number,
  height: number,
  clipStart: number
): string {
  if (trajectory.length < 2) return ''

  const sorted = [...trajectory].sort((a, b) => a.timestamp - b.timestamp)
  const filters: string[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i]
    const p2 = sorted[i + 1]

    // Convert normalized coords (0-1) to pixels
    const x1 = Math.round(p1.x * width)
    const y1 = Math.round(p1.y * height)
    const x2 = Math.round(p2.x * width)
    const y2 = Math.round(p2.y * height)

    // Time relative to clip start
    const t = p1.timestamp - clipStart

    // Line appears at t and stays visible
    filters.push(
      `drawline=x1=${x1}:y1=${y1}:x2=${x2}:y2=${y2}:color=red:thickness=4:enable='gte(t,${t.toFixed(3)})'`
    )
  }

  return filters.join(',')
}
```

### video-frame-pipeline-v2.ts

```typescript
export class VideoFramePipelineV2 {
  private ffmpeg: FFmpeg

  constructor(ffmpeg: FFmpeg) {
    this.ffmpeg = ffmpeg
  }

  async exportWithTracer(config: ExportConfig): Promise<Blob> {
    const { videoBlob, trajectory, startTime, endTime, onProgress } = config
    const duration = endTime - startTime

    // Phase 1: Write video to FFmpeg filesystem
    onProgress?.({ phase: 'preparing', progress: -1 })
    const videoData = await fetchFile(videoBlob)
    await this.ffmpeg.writeFile('input.mp4', videoData)

    // Phase 2: Get video dimensions (probe single frame)
    const dimensions = await this.getVideoDimensions('input.mp4')

    // Phase 3: Generate filter string
    onProgress?.({ phase: 'compositing', progress: 0 })
    const tracerFilter = trajectoryToFFmpegFilter(
      trajectory,
      dimensions.width,
      dimensions.height,
      startTime
    )

    // Phase 4: Single-pass encode with tracer
    onProgress?.({ phase: 'encoding', progress: 0 })

    this.ffmpeg.on('progress', ({ progress }) => {
      onProgress?.({ phase: 'encoding', progress: Math.round(progress * 100) })
    })

    const vfFilter = tracerFilter || 'null'

    await this.ffmpeg.exec([
      '-ss', startTime.toString(),
      '-i', 'input.mp4',
      '-t', duration.toString(),
      '-vf', vfFilter,
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y',
      'output.mp4',
    ])

    onProgress?.({ phase: 'complete', progress: 100 })

    const result = await this.ffmpeg.readFile('output.mp4')

    // Cleanup
    await this.ffmpeg.deleteFile('input.mp4')
    await this.ffmpeg.deleteFile('output.mp4')

    return new Blob([new Uint8Array(result as Uint8Array)], { type: 'video/mp4' })
  }

  private async getVideoDimensions(inputName: string): Promise<{width: number, height: number}> {
    await this.ffmpeg.exec(['-i', inputName, '-vframes', '1', '-f', 'image2', 'probe.png'])
    const frameData = await this.ffmpeg.readFile('probe.png')
    const blob = new Blob([new Uint8Array(frameData as Uint8Array)], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob)
    const dims = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    await this.ffmpeg.deleteFile('probe.png')
    return dims
  }
}
```

---

## Risk Mitigation

| Risk | Detection | Response |
|------|-----------|----------|
| `drawline` not available in FFmpeg WASM | Non-zero exit code or "No such filter" error | POC fails, document findings |
| Filter string too long | FFmpeg error about filter complexity | Sample every Nth point |
| Time expressions don't work | Tracer doesn't animate | Test with single static line first |

---

## Testing Approach

1. **Verify basic functionality:** Single hardcoded drawline (no time expression)
2. **Add timing:** Multiple segments with `enable='gte(t,T)'`
3. **Real data:** Test with actual trajectory from UI using 4K test video

**Test video:** `~/Downloads/IMG_3956_h264.mp4` (494MB, 3840x2160, 69s, H.264)

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts` | **NEW** |
| `apps/browser/src/lib/video-frame-pipeline-v2.ts` | **NEW** |
| `apps/browser/src/components/ClipReview.tsx` | Add temporary "Export v2 (POC)" button |

---

## Next Steps

1. Create feature branch: `poc/ffmpeg-filter-export`
2. Implement `trajectory-to-ffmpeg-filter.ts`
3. Implement `video-frame-pipeline-v2.ts`
4. Add temporary UI button
5. Test with 4K video
6. Document results
