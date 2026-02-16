# Export FFmpeg Filter POC Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace frame-by-frame extraction with FFmpeg's native `drawline` filter to export 4K videos in <30 seconds.

**Architecture:** Single-pass FFmpeg encode with trajectory converted to drawline filter string. New files isolated from existing pipeline. Temporary UI button for side-by-side comparison.

**Tech Stack:** FFmpeg WASM (@ffmpeg/ffmpeg), TypeScript, React

---

## Task 1: Create trajectory-to-ffmpeg-filter.ts

**Files:**
- Create: `apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts`

**Step 1: Create the filter generator function**

```typescript
// apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts
import { TrajectoryPoint } from './canvas-compositor'

/**
 * Convert trajectory points to FFmpeg drawline filter string.
 *
 * Each segment appears at its start timestamp and stays visible,
 * creating a "growing" tracer effect as the video plays.
 *
 * @param trajectory - Array of trajectory points with normalized coords (0-1)
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @param clipStart - Start time of clip in seconds (for relative timing)
 * @returns FFmpeg filter string, or empty string if trajectory too short
 */
export function trajectoryToFFmpegFilter(
  trajectory: TrajectoryPoint[],
  width: number,
  height: number,
  clipStart: number
): string {
  if (trajectory.length < 2) {
    return ''
  }

  // Sort by timestamp to ensure correct order
  const sorted = [...trajectory].sort((a, b) => a.timestamp - b.timestamp)
  const filters: string[] = []

  // Generate a drawline filter for each segment between adjacent points
  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i]
    const p2 = sorted[i + 1]

    // Convert normalized coords (0-1) to pixel coordinates
    const x1 = Math.round(p1.x * width)
    const y1 = Math.round(p1.y * height)
    const x2 = Math.round(p2.x * width)
    const y2 = Math.round(p2.y * height)

    // Time relative to clip start (FFmpeg filter time starts at 0)
    const t = p1.timestamp - clipStart

    // Use gte(t,T) so line appears at time T and stays visible
    // Color: red, Thickness: 4 (hardcoded for POC)
    filters.push(
      `drawline=x1=${x1}:y1=${y1}:x2=${x2}:y2=${y2}:color=red:thickness=4:enable='gte(t\\,${t.toFixed(3)})'`
    )
  }

  return filters.join(',')
}
```

**Step 2: Verify file created**

Run: `ls -la apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts`
Expected: File exists with correct content

**Step 3: Commit**

```bash
git add apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts
git commit -m "feat(export): add trajectory to FFmpeg filter converter

Converts trajectory points to FFmpeg drawline filter string for
single-pass tracer rendering. Part of POC to fix 4K export hang.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create video-frame-pipeline-v2.ts

**Files:**
- Create: `apps/browser/src/lib/video-frame-pipeline-v2.ts`

**Step 1: Create the new pipeline class**

```typescript
// apps/browser/src/lib/video-frame-pipeline-v2.ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { TrajectoryPoint } from './canvas-compositor'
import { TracerStyle } from '../types/tracer'
import { trajectoryToFFmpegFilter } from './trajectory-to-ffmpeg-filter'

export interface ExportProgressV2 {
  phase: 'preparing' | 'probing' | 'encoding' | 'complete'
  progress: number  // 0-100, or -1 for indeterminate
}

export interface ExportConfigV2 {
  videoBlob: Blob
  trajectory: TrajectoryPoint[]
  startTime: number
  endTime: number
  quality?: 'draft' | 'preview' | 'final'
  tracerStyle?: TracerStyle  // Not used in POC, kept for interface compat
  onProgress?: (progress: ExportProgressV2) => void
}

const QUALITY_SETTINGS = {
  draft: { crf: 28, preset: 'ultrafast' },
  preview: { crf: 23, preset: 'fast' },
  final: { crf: 18, preset: 'medium' },
}

/**
 * V2 Export Pipeline using FFmpeg drawline filter instead of frame extraction.
 *
 * This approach is a POC to fix the 4K export hang issue. Instead of:
 * 1. Extract all frames as PNG
 * 2. Composite tracer on each frame in JS
 * 3. Re-encode frames to video
 *
 * We now do:
 * 1. Generate FFmpeg drawline filter from trajectory
 * 2. Single FFmpeg pass: trim + filter + encode
 *
 * This should reduce 4K export from "hangs indefinitely" to <30 seconds.
 */
export class VideoFramePipelineV2 {
  private ffmpeg: FFmpeg

  constructor(ffmpeg: FFmpeg) {
    this.ffmpeg = ffmpeg
  }

  async exportWithTracer(config: ExportConfigV2): Promise<Blob> {
    const {
      videoBlob,
      trajectory,
      startTime,
      endTime,
      quality = 'preview',
      onProgress,
    } = config

    const duration = endTime - startTime
    const inputName = 'input.mp4'
    const outputName = 'output.mp4'
    const probeName = 'probe.png'

    console.log('[PipelineV2] Starting export', {
      blobSizeMB: (videoBlob.size / (1024 * 1024)).toFixed(1),
      duration: duration.toFixed(2),
      trajectoryPoints: trajectory.length,
    })

    const startMs = performance.now()

    // Phase 1: Write video to FFmpeg filesystem
    onProgress?.({ phase: 'preparing', progress: -1 })
    console.log('[PipelineV2] Phase 1: Writing video to FFmpeg...')

    const videoData = await fetchFile(videoBlob)
    await this.ffmpeg.writeFile(inputName, videoData)

    onProgress?.({ phase: 'preparing', progress: 100 })
    console.log('[PipelineV2] Video written to FFmpeg filesystem')

    // Phase 2: Probe video dimensions (extract single frame)
    onProgress?.({ phase: 'probing', progress: -1 })
    console.log('[PipelineV2] Phase 2: Probing video dimensions...')

    const dimensions = await this.getVideoDimensions(inputName, probeName)
    console.log('[PipelineV2] Video dimensions:', dimensions)

    onProgress?.({ phase: 'probing', progress: 100 })

    // Phase 3: Generate filter string and encode
    onProgress?.({ phase: 'encoding', progress: 0 })
    console.log('[PipelineV2] Phase 3: Encoding with tracer filter...')

    const tracerFilter = trajectoryToFFmpegFilter(
      trajectory,
      dimensions.width,
      dimensions.height,
      startTime
    )

    // If no trajectory, use 'null' filter (passthrough)
    const vfFilter = tracerFilter || 'null'
    console.log('[PipelineV2] Filter string length:', vfFilter.length, 'chars')

    const { crf, preset } = QUALITY_SETTINGS[quality]

    // Set up progress listener
    const progressHandler = ({ progress }: { progress: number }) => {
      const percent = Math.round(progress * 100)
      onProgress?.({ phase: 'encoding', progress: Math.min(percent, 99) })
    }
    this.ffmpeg.on('progress', progressHandler)

    try {
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
    } finally {
      this.ffmpeg.off('progress', progressHandler)
    }

    onProgress?.({ phase: 'encoding', progress: 100 })

    // Read result
    const result = await this.ffmpeg.readFile(outputName)

    onProgress?.({ phase: 'complete', progress: 100 })

    const elapsedMs = performance.now() - startMs
    console.log('[PipelineV2] Export complete in', (elapsedMs / 1000).toFixed(1), 'seconds')

    // Cleanup
    try { await this.ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
    try { await this.ffmpeg.deleteFile(outputName) } catch { /* ignore */ }

    return new Blob([new Uint8Array(result as Uint8Array)], { type: 'video/mp4' })
  }

  /**
   * Get video dimensions by extracting a single frame
   */
  private async getVideoDimensions(
    inputName: string,
    probeName: string
  ): Promise<{ width: number; height: number }> {
    // Extract single frame at start
    await this.ffmpeg.exec([
      '-i', inputName,
      '-vframes', '1',
      '-f', 'image2',
      probeName,
    ])

    const frameData = await this.ffmpeg.readFile(probeName)
    const blob = new Blob([new Uint8Array(frameData as Uint8Array)], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob)
    const dims = { width: bitmap.width, height: bitmap.height }
    bitmap.close()

    // Cleanup probe frame
    try { await this.ffmpeg.deleteFile(probeName) } catch { /* ignore */ }

    return dims
  }
}
```

**Step 2: Verify file created**

Run: `ls -la apps/browser/src/lib/video-frame-pipeline-v2.ts`
Expected: File exists

**Step 3: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline-v2.ts
git commit -m "feat(export): add V2 pipeline with FFmpeg filter approach

Single-pass FFmpeg encode with drawline filter instead of frame-by-frame
extraction. POC to fix 4K export hang - target <30s for 4K videos.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Export V2 button to ClipReview

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Add imports at top of file (around line 10-12)**

After the existing VideoFramePipeline import, add:

```typescript
import { VideoFramePipelineV2, ExportConfigV2 } from '../lib/video-frame-pipeline-v2'
```

**Step 2: Add export V2 handler function**

Add this new function after the existing `handleExport` function (around line 576):

```typescript
  // POC: Export using V2 pipeline with FFmpeg filter approach
  const handleExportV2 = useCallback(async () => {
    const store = useProcessingStore.getState()
    const activeVid = store.activeVideoId ? store.videos.get(store.activeVideoId) : undefined
    const currentSegments = activeVid?.segments ?? store.segments
    const approved = currentSegments.filter(s => s.approved === 'approved')

    if (approved.length === 0) {
      alert('No approved shots to export')
      return
    }

    setShowExportModal(true)
    setExportProgress({ current: 0, total: approved.length })
    setExportPhase({ phase: 'preparing', progress: 0 })
    setExportComplete(false)
    setExportError(null)
    exportCancelledRef.current = false

    try {
      console.log('[ExportV2] Loading FFmpeg...')
      await loadFFmpeg()
      const ffmpeg = getFFmpegInstance()
      const pipelineV2 = new VideoFramePipelineV2(ffmpeg)

      for (let i = 0; i < approved.length; i++) {
        if (exportCancelledRef.current) break

        const segment = approved[i]
        setExportProgress({ current: i + 1, total: approved.length })

        console.log('[ExportV2] Exporting segment', i + 1, 'of', approved.length)

        // Get trajectory points or empty array
        const trajectoryPoints = segment.trajectory?.points ?? []

        const configV2: ExportConfigV2 = {
          videoBlob: segment.blob,
          trajectory: trajectoryPoints,
          startTime: segment.clipStart - segment.startTime,
          endTime: segment.clipEnd - segment.startTime,
          quality: exportQuality,
          onProgress: (progress) => {
            setExportPhase({ phase: progress.phase, progress: progress.progress })
          },
        }

        const exportedBlob = await pipelineV2.exportWithTracer(configV2)

        // Download
        const url = URL.createObjectURL(exportedBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `shot_${i + 1}_v2.mp4`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        await new Promise(r => setTimeout(r, 500))
      }

      if (!exportCancelledRef.current) {
        setExportComplete(true)
        autoCloseTimerRef.current = window.setTimeout(() => {
          setShowExportModal(false)
          onComplete()
        }, 1500)
      }
    } catch (error) {
      console.error('[ExportV2] Export failed:', error)
      setExportError(error instanceof Error ? error.message : 'Export V2 failed')
    }
  }, [onComplete, exportQuality])
```

**Step 3: Add Export V2 button in the UI**

Find the existing export button (around line 947) and add the V2 button next to it:

```tsx
            <button onClick={handleExport} className="btn-primary btn-large">
              Export All ({segments.filter(s => s.approved === 'approved').length})
            </button>
            <button
              onClick={handleExportV2}
              className="btn-secondary btn-large"
              title="POC: Export using FFmpeg filter approach (faster for 4K)"
            >
              Export V2 (POC)
            </button>
```

**Step 4: Run type check**

Run: `cd apps/browser && npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat(export): add Export V2 button for POC testing

Adds temporary 'Export V2 (POC)' button to test FFmpeg filter approach
side-by-side with existing frame extraction pipeline.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Manual Testing with Small Video

**Files:**
- None (manual testing)

**Step 1: Start dev server**

Run: `cd apps/browser && npm run dev`
Expected: Dev server starts on localhost:5173 (or similar)

**Step 2: Test basic functionality**

1. Open browser to dev server URL
2. Upload a small test video (<50MB)
3. Let detection run, approve a shot with trajectory
4. Click "Export V2 (POC)" button
5. Check browser console for `[PipelineV2]` logs
6. Verify MP4 downloads

**Step 3: Verify tracer appears (if trajectory exists)**

1. Play the downloaded `shot_1_v2.mp4`
2. Check if red tracer line appears
3. Check if tracer animates (grows over time)

**Step 4: Document results**

If success: Continue to Task 5
If failure: Check console for errors, especially "No such filter: drawline"

---

## Task 5: Manual Testing with 4K Video

**Files:**
- None (manual testing)

**Step 1: Test with 4K video**

1. Open browser to dev server
2. Upload `~/Downloads/IMG_3956_h264.mp4` (494MB 4K video)
3. Let detection run, approve a shot with trajectory
4. Click "Export V2 (POC)" button
5. **Time the export** - should complete in <30 seconds

**Step 2: Compare with old pipeline**

1. Click regular "Export All" button with same shot
2. **Time the export** - expected to hang or take 2+ minutes

**Step 3: Document results**

Create a results summary:
- V2 export time: _____ seconds
- V1 export time: _____ seconds (or "hung")
- Tracer visible: Yes/No
- Tracer animates: Yes/No
- Any errors: _____

**Step 4: Commit results**

```bash
git add -A
git commit -m "docs: add POC test results

V2 pipeline tested with 4K video (494MB).
Results: [fill in actual results]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Handle drawline Filter Unavailable (If Needed)

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline-v2.ts` (if needed)

**Step 1: Check if drawline failed**

If Task 4 or 5 showed "No such filter: drawline" error:

**Step 2: Try alternative approach**

Option A: Use `drawbox` with height=1 to simulate lines:
```
drawbox=x=X1:y=Y1:w=1:h=DIST:color=red:t=fill:enable='gte(t,T)'
```

Option B: Document that POC failed and server-side export needed

**Step 3: Update code if alternative works**

If drawbox works, update the filter generator accordingly.

**Step 4: Commit**

```bash
git add -A
git commit -m "fix(export): use drawbox fallback for tracer lines

drawline filter not available in FFmpeg WASM, using drawbox with
1px height as alternative.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Success Criteria Checklist

- [ ] `trajectory-to-ffmpeg-filter.ts` created and compiles
- [ ] `video-frame-pipeline-v2.ts` created and compiles
- [ ] "Export V2 (POC)" button appears in UI
- [ ] Small video export works with V2 pipeline
- [ ] 4K video (494MB) exports in <30 seconds with V2
- [ ] Tracer line visible in exported video
- [ ] Tracer animates (grows as video plays)

---

## Rollback Plan

If POC fails completely:

```bash
git checkout master
git branch -D poc/ffmpeg-filter-export
```

The existing export pipeline remains unchanged on master.
