# Raise Unit Test Coverage Thresholds to 60% Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Write unit tests for uncovered `lib/` modules to raise all coverage thresholds (statements, functions, lines) to at least 60%, then update CI-enforced thresholds in `vite.config.ts`.

**Architecture:** Add test files for 0%-coverage modules (`gpu-detection`, `clip-exporter`, `feedback-service`) and expand existing tests for low-coverage modules (`audio-detector`, `video-frame-pipeline-v4`). Focus on testing pure logic and mockable I/O boundaries. No production code changes.

**Tech Stack:** Vitest, `@vitest/coverage-v8`, TypeScript, vi.mock for browser API mocking

**Total Tasks: 12** (9 implementation + 3 verification)

---

### Baseline Coverage (measured 2026-02-24)

| Metric | Current | Target |
|--------|---------|--------|
| Statements | 52.28% | ≥60% |
| Branches | 65.92% | ≥60% (already met) |
| Functions | 45% | ≥60% |
| Lines | 52.28% | ≥60% |

**Modules at 0% coverage (no tests):**
- `gpu-detection.ts` — 0% stmts, 0% funcs (2 exported functions)
- `clip-exporter.ts` — 0% stmts, 0% funcs (2 exported functions + 1 private)
- `feedback-service.ts` — 0% stmts, 0% funcs (2 exported functions)
- `supabase-client.ts` — 0% stmts, 0% funcs (2 exported functions, 20 lines)

**Modules with low coverage:**
- `audio-detector.ts` — 35.84% stmts, 33.33% funcs
- `video-frame-pipeline-v4.ts` — 11.44% stmts, 33.33% funcs

---

### Task 1: Test `getExportOptions` in gpu-detection.ts

**Files:**
- Create: `apps/browser/src/lib/gpu-detection.test.ts`
- Source: `apps/browser/src/lib/gpu-detection.ts:111-144`

This is a pure function — no mocking needed. Highest ROI test.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { getExportOptions, GpuCapabilities } from './gpu-detection'

describe('getExportOptions', () => {
  it('recommends browser export when hardware acceleration is enabled', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: true,
      webglAvailable: true,
      renderer: 'ANGLE (NVIDIA GeForce GTX 1080)',
      vendor: 'Google Inc. (NVIDIA)',
      isSoftwareRenderer: false,
      estimatedDecodeCapability: 'hardware',
    }

    const options = getExportOptions(capabilities)

    const browserOption = options.find((o) => o.id === 'browser-accelerated')
    expect(browserOption).toBeDefined()
    expect(browserOption!.available).toBe(true)
    expect(browserOption!.recommended).toBe(true)
    expect(browserOption!.unavailableReason).toBeUndefined()
  })

  it('disables browser export when hardware acceleration is off', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: false,
      webglAvailable: false,
      renderer: null,
      vendor: null,
      isSoftwareRenderer: false,
      estimatedDecodeCapability: 'software',
    }

    const options = getExportOptions(capabilities)

    const browserOption = options.find((o) => o.id === 'browser-accelerated')
    expect(browserOption!.available).toBe(false)
    expect(browserOption!.recommended).toBe(false)
    expect(browserOption!.unavailableReason).toBeDefined()
  })

  it('recommends offline export when hardware acceleration is off', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: false,
      webglAvailable: true,
      renderer: 'SwiftShader',
      vendor: 'Google Inc.',
      isSoftwareRenderer: true,
      estimatedDecodeCapability: 'software',
    }

    const options = getExportOptions(capabilities)

    const offlineOption = options.find((o) => o.id === 'offline-export')
    expect(offlineOption!.available).toBe(true)
    expect(offlineOption!.recommended).toBe(true)
  })

  it('marks cloud processing as unavailable', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: true,
      webglAvailable: true,
      renderer: null,
      vendor: null,
      isSoftwareRenderer: false,
      estimatedDecodeCapability: 'hardware',
    }

    const options = getExportOptions(capabilities)

    const cloudOption = options.find((o) => o.id === 'cloud-processing')
    expect(cloudOption!.available).toBe(false)
    expect(cloudOption!.unavailableReason).toBe('Coming soon')
  })

  it('always returns exactly 3 export options', () => {
    const capabilities: GpuCapabilities = {
      hardwareAccelerationEnabled: true,
      webglAvailable: true,
      renderer: null,
      vendor: null,
      isSoftwareRenderer: false,
      estimatedDecodeCapability: 'hardware',
    }

    const options = getExportOptions(capabilities)
    expect(options).toHaveLength(3)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd apps/browser && npx vitest run src/lib/gpu-detection.test.ts`
Expected: FAIL — file doesn't exist yet, so it won't run. After creating, should PASS since this is testing existing code.

**Step 3: Create the test file with the code above**

This tests the pure `getExportOptions` function. The `detectGpuCapabilities` function depends on `document.createElement('canvas')` — we'll test it in Task 2.

**Step 4: Run test to verify it passes**

Run: `cd apps/browser && npx vitest run src/lib/gpu-detection.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add apps/browser/src/lib/gpu-detection.test.ts
git commit -m "test: add unit tests for getExportOptions in gpu-detection"
```

---

### Task 2: Test `detectGpuCapabilities` in gpu-detection.ts

**Files:**
- Modify: `apps/browser/src/lib/gpu-detection.test.ts`
- Source: `apps/browser/src/lib/gpu-detection.ts:26-95`

This function uses `document.createElement('canvas')` and WebGL context. We need to mock these browser APIs. Vitest runs in jsdom by default which provides `document` but not real WebGL.

**Step 1: Write the failing test — add to existing test file**

```typescript
describe('detectGpuCapabilities', () => {
  it('detects software renderer when renderer string contains swiftshader', async () => {
    // Mock canvas and WebGL context
    const mockGl = {
      getExtension: vi.fn((name: string) => {
        if (name === 'WEBGL_debug_renderer_info') {
          return {
            UNMASKED_RENDERER_WEBGL: 0x9246,
            UNMASKED_VENDOR_WEBGL: 0x9245,
          }
        }
        if (name === 'WEBGL_lose_context') {
          return { loseContext: vi.fn() }
        }
        return null
      }),
      getParameter: vi.fn((param: number) => {
        if (param === 0x9246) return 'Google SwiftShader'
        if (param === 0x9245) return 'Google Inc.'
        return null
      }),
    }

    const mockCanvas = {
      getContext: vi.fn(() => mockGl),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement)

    // Need to also make the instanceof check pass
    // In jsdom, WebGLRenderingContext may not exist
    const originalWebGL = globalThis.WebGLRenderingContext
    globalThis.WebGLRenderingContext = class {} as any
    Object.setPrototypeOf(mockGl, globalThis.WebGLRenderingContext.prototype)

    const { detectGpuCapabilities } = await import('./gpu-detection')
    const result = await detectGpuCapabilities()

    expect(result.webglAvailable).toBe(true)
    expect(result.renderer).toBe('Google SwiftShader')
    expect(result.isSoftwareRenderer).toBe(true)
    expect(result.hardwareAccelerationEnabled).toBe(false)
    expect(result.estimatedDecodeCapability).toBe('software')

    // Restore
    globalThis.WebGLRenderingContext = originalWebGL
    vi.restoreAllMocks()
  })

  it('returns defaults when WebGL is not available', async () => {
    const mockCanvas = {
      getContext: vi.fn(() => null),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement)

    // Re-import to get fresh module
    vi.resetModules()
    const { detectGpuCapabilities } = await import('./gpu-detection')
    const result = await detectGpuCapabilities()

    expect(result.webglAvailable).toBe(false)
    expect(result.hardwareAccelerationEnabled).toBe(false)
    expect(result.estimatedDecodeCapability).toBe('software')

    vi.restoreAllMocks()
  })
})
```

**Step 2: Run to verify tests pass**

Run: `cd apps/browser && npx vitest run src/lib/gpu-detection.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/browser/src/lib/gpu-detection.test.ts
git commit -m "test: add detectGpuCapabilities tests with WebGL mocks"
```

---

### Task 3: Test `buildTrajectoryFilter` via `exportClipWithTracer` in clip-exporter.ts

**Files:**
- Create: `apps/browser/src/lib/clip-exporter.test.ts`
- Source: `apps/browser/src/lib/clip-exporter.ts`

`buildTrajectoryFilter` is private, but we can test it through `exportClipWithTracer` by mocking FFmpeg. We also test `exportWithCanvasCompositing` which simply throws.

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { exportClipWithTracer, exportWithCanvasCompositing } from './clip-exporter'

describe('exportClipWithTracer', () => {
  it('calls FFmpeg with correct arguments including trajectory filter', async () => {
    const mockExec = vi.fn().mockResolvedValue(0)
    const mockWriteFile = vi.fn().mockResolvedValue(undefined)
    const mockReadFile = vi.fn().mockResolvedValue(new Uint8Array([0, 0, 0, 1]))
    const mockDeleteFile = vi.fn().mockResolvedValue(undefined)

    const mockFfmpeg = {
      writeFile: mockWriteFile,
      exec: mockExec,
      readFile: mockReadFile,
      deleteFile: mockDeleteFile,
    }

    // Mock fetchFile
    vi.mock('@ffmpeg/util', () => ({
      fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }))

    const result = await exportClipWithTracer(mockFfmpeg as any, {
      videoBlob: new Blob(['test'], { type: 'video/mp4' }),
      trajectory: [
        { x: 0.1, y: 0.2, timestamp: 0 },
        { x: 0.5, y: 0.5, timestamp: 1 },
        { x: 0.9, y: 0.8, timestamp: 2 },
      ],
      startTime: 5,
      endTime: 15,
      videoWidth: 1920,
      videoHeight: 1080,
    })

    // Verify FFmpeg was called correctly
    expect(mockWriteFile).toHaveBeenCalledWith('input.mp4', expect.any(Uint8Array))
    expect(mockExec).toHaveBeenCalledWith(
      expect.arrayContaining(['-i', 'input.mp4', '-ss', '5', '-t', '10']),
    )
    // Result should be a Blob
    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('video/mp4')

    // Cleanup files should be called
    expect(mockDeleteFile).toHaveBeenCalledWith('input.mp4')
    expect(mockDeleteFile).toHaveBeenCalledWith('output.mp4')
  })

  it('generates null filter for trajectory with fewer than 2 points', async () => {
    const mockExec = vi.fn().mockResolvedValue(0)
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: mockExec,
      readFile: vi.fn().mockResolvedValue(new Uint8Array([0])),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }

    await exportClipWithTracer(mockFfmpeg as any, {
      videoBlob: new Blob(['test'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 5,
      videoWidth: 1920,
      videoHeight: 1080,
    })

    // With < 2 points, filter should be 'null'
    const execArgs = mockExec.mock.calls[0][0]
    const vfIndex = execArgs.indexOf('-vf')
    expect(execArgs[vfIndex + 1]).toBe('null')
  })

  it('throws when FFmpeg exits with non-zero code', async () => {
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(1),
      readFile: vi.fn(),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }

    await expect(
      exportClipWithTracer(mockFfmpeg as any, {
        videoBlob: new Blob(['test'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.2, timestamp: 0 },
          { x: 0.5, y: 0.5, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 5,
        videoWidth: 1920,
        videoHeight: 1080,
      }),
    ).rejects.toThrow('FFmpeg export failed with exit code 1')
  })

  it('throws when FFmpeg output is not Uint8Array', async () => {
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(0),
      readFile: vi.fn().mockResolvedValue('string-data'),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }

    await expect(
      exportClipWithTracer(mockFfmpeg as any, {
        videoBlob: new Blob(['test'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.2, timestamp: 0 },
          { x: 0.5, y: 0.5, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 5,
        videoWidth: 1920,
        videoHeight: 1080,
      }),
    ).rejects.toThrow('Unexpected FFmpeg output format')
  })

  it('cleans up files even on error', async () => {
    const mockDeleteFile = vi.fn().mockResolvedValue(undefined)
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(1),
      readFile: vi.fn(),
      deleteFile: mockDeleteFile,
    }

    await expect(
      exportClipWithTracer(mockFfmpeg as any, {
        videoBlob: new Blob(['test'], { type: 'video/mp4' }),
        trajectory: [
          { x: 0.1, y: 0.2, timestamp: 0 },
          { x: 0.5, y: 0.5, timestamp: 1 },
        ],
        startTime: 0,
        endTime: 5,
        videoWidth: 1920,
        videoHeight: 1080,
      }),
    ).rejects.toThrow()

    // Cleanup should still happen
    expect(mockDeleteFile).toHaveBeenCalledWith('input.mp4')
    expect(mockDeleteFile).toHaveBeenCalledWith('output.mp4')
  })

  it('uses default tracer color and width', async () => {
    const mockExec = vi.fn().mockResolvedValue(0)
    const mockFfmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: mockExec,
      readFile: vi.fn().mockResolvedValue(new Uint8Array([0])),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    }

    await exportClipWithTracer(mockFfmpeg as any, {
      videoBlob: new Blob(['test'], { type: 'video/mp4' }),
      trajectory: [
        { x: 0.1, y: 0.2, timestamp: 0 },
        { x: 0.5, y: 0.5, timestamp: 1 },
      ],
      startTime: 0,
      endTime: 5,
      videoWidth: 1920,
      videoHeight: 1080,
      // No tracerColor or tracerWidth provided — defaults should be used
    })

    const execArgs = mockExec.mock.calls[0][0]
    const vfIndex = execArgs.indexOf('-vf')
    const filter = execArgs[vfIndex + 1]
    // Default color is yellow, default width is 3
    expect(filter).toContain('color=yellow')
    expect(filter).toContain('w=3')
    expect(filter).toContain('h=3')
  })
})

describe('exportWithCanvasCompositing', () => {
  it('throws not implemented error', async () => {
    const blob = new Blob(['test'], { type: 'video/mp4' })
    const canvas = document.createElement('canvas')

    await expect(exportWithCanvasCompositing(blob, canvas, 0, 5)).rejects.toThrow(
      'Canvas compositing not yet implemented',
    )
  })
})
```

**Step 2: Run test**

Run: `cd apps/browser && npx vitest run src/lib/clip-exporter.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/browser/src/lib/clip-exporter.test.ts
git commit -m "test: add unit tests for clip-exporter with mock FFmpeg"
```

---

### Task 4: Test feedback-service.ts

**Files:**
- Create: `apps/browser/src/lib/feedback-service.test.ts`
- Source: `apps/browser/src/lib/feedback-service.ts`

Mock `supabase-client` to test both `submitShotFeedback` and `submitTracerFeedback`.

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase-client before importing feedback-service
const mockInsert = vi.fn()
const mockFrom = vi.fn(() => ({ insert: mockInsert }))

vi.mock('./supabase-client', () => ({
  getSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

import { submitShotFeedback, submitTracerFeedback } from './feedback-service'
import { getSupabaseClient } from './supabase-client'

describe('submitShotFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: mockInsert })
  })

  it('submits shot feedback to Supabase', async () => {
    const result = await submitShotFeedback({
      shotIndex: 0,
      feedbackType: 'TRUE_POSITIVE',
      confidence: 0.9,
    })

    expect(result.success).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('shot_feedback')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        shot_index: 0,
        feedback_type: 'TRUE_POSITIVE',
        confidence: 0.9,
      }),
    )
  })

  it('returns error when insert fails', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'Connection error' } })

    const result = await submitShotFeedback({
      shotIndex: 0,
      feedbackType: 'FALSE_POSITIVE',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns success when Supabase is not configured', async () => {
    vi.mocked(getSupabaseClient).mockReturnValueOnce(null)

    const result = await submitShotFeedback({
      shotIndex: 0,
      feedbackType: 'TRUE_POSITIVE',
    })

    expect(result.success).toBe(true)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('submitTracerFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: mockInsert })
  })

  it('submits tracer feedback with auto and final params', async () => {
    const result = await submitTracerFeedback({
      shotIndex: 1,
      feedbackType: 'CONFIGURED',
      autoParams: {
        originX: 0.3,
        originY: 0.8,
        landingX: 0.7,
        landingY: 0.2,
      },
      finalParams: {
        originX: 0.35,
        originY: 0.75,
        landingX: 0.65,
        landingY: 0.25,
      },
    })

    expect(result.success).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('tracer_feedback')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        shot_index: 1,
        feedback_type: 'CONFIGURED',
        auto_origin_x: 0.3,
        final_origin_x: 0.35,
      }),
    )
  })

  it('returns error when insert fails', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'DB error' } })

    const result = await submitTracerFeedback({
      shotIndex: 0,
      feedbackType: 'SKIP',
      finalParams: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns success when Supabase is not configured', async () => {
    vi.mocked(getSupabaseClient).mockReturnValueOnce(null)

    const result = await submitTracerFeedback({
      shotIndex: 0,
      feedbackType: 'AUTO_ACCEPTED',
      finalParams: { originX: 0.5 },
    })

    expect(result.success).toBe(true)
  })
})
```

**Step 2: Run test**

Run: `cd apps/browser && npx vitest run src/lib/feedback-service.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/browser/src/lib/feedback-service.test.ts
git commit -m "test: add unit tests for feedback-service with mock Supabase"
```

---

### Task 5: Test `ExportTimeoutError` and abort handling in video-frame-pipeline-v4.ts

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline-v4.test.ts`
- Source: `apps/browser/src/lib/video-frame-pipeline-v4.ts:38-43, 65-70, 76-99`

The existing tests cover module structure but don't exercise `ExportTimeoutError` or the abort logic. These are easily testable without browser APIs.

**Step 1: Add tests to existing file**

```typescript
describe('ExportTimeoutError', () => {
  it('should be an instance of Error', async () => {
    const { ExportTimeoutError } = await import('./video-frame-pipeline-v4')
    const error = new ExportTimeoutError('test timeout')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ExportTimeoutError')
    expect(error.message).toBe('test timeout')
  })

  it('should have correct prototype chain', async () => {
    const { ExportTimeoutError } = await import('./video-frame-pipeline-v4')
    const error = new ExportTimeoutError('test')

    expect(error instanceof ExportTimeoutError).toBe(true)
    expect(error instanceof Error).toBe(true)
  })
})

describe('VideoFramePipelineV4 - Abort Handling', () => {
  it('should throw AbortError when signal is already aborted', async () => {
    const { VideoFramePipelineV4 } = await import('./video-frame-pipeline-v4')
    const pipeline = new VideoFramePipelineV4()

    const controller = new AbortController()
    controller.abort()

    await expect(
      pipeline.exportWithTracer({
        videoBlob: new Blob(['test'], { type: 'video/mp4' }),
        trajectory: [],
        startTime: 0,
        endTime: 1,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow('Export cancelled')
  })

  it('should throw when requestVideoFrameCallback is not supported and signal not aborted', async () => {
    const { VideoFramePipelineV4 } = await import('./video-frame-pipeline-v4')
    const pipeline = new VideoFramePipelineV4()

    await expect(
      pipeline.exportWithTracer({
        videoBlob: new Blob(['test'], { type: 'video/mp4' }),
        trajectory: [],
        startTime: 0,
        endTime: 1,
      }),
    ).rejects.toThrow('requestVideoFrameCallback is not supported')
  })
})
```

**Step 2: Run test**

Run: `cd apps/browser && npx vitest run src/lib/video-frame-pipeline-v4.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline-v4.test.ts
git commit -m "test: add ExportTimeoutError and abort handling tests for v4 pipeline"
```

---

### Task 6: Expand audio-detector.ts test coverage

**Files:**
- Modify: `apps/browser/src/lib/audio-detector.test.ts`
- Source: `apps/browser/src/lib/audio-detector.ts:85-95, 54-59`

The existing tests only cover error cases and module structure. Add tests for `unloadEssentia` and `DEFAULT_CONFIG` validation.

**Step 1: Add tests**

```typescript
describe('unloadEssentia', () => {
  it('resets loaded state', async () => {
    const { unloadEssentia, isEssentiaLoaded } = await import('./audio-detector')

    // Initially not loaded
    expect(isEssentiaLoaded()).toBe(false)

    // Unload should be safe to call even when not loaded
    unloadEssentia()
    expect(isEssentiaLoaded()).toBe(false)
  })
})

describe('DEFAULT_CONFIG', () => {
  it('has frequency range for golf strike detection (1000-8000 Hz)', async () => {
    const { DEFAULT_CONFIG } = await import('./audio-detector')

    expect(DEFAULT_CONFIG.frequencyLow).toBe(1000)
    expect(DEFAULT_CONFIG.frequencyHigh).toBe(8000)
    expect(DEFAULT_CONFIG.frequencyHigh).toBeGreaterThan(DEFAULT_CONFIG.frequencyLow)
  })

  it('has sensitivity in 0-1 range', async () => {
    const { DEFAULT_CONFIG } = await import('./audio-detector')

    expect(DEFAULT_CONFIG.sensitivity).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_CONFIG.sensitivity).toBeLessThanOrEqual(1)
  })

  it('has minimum strike interval of 25 seconds', async () => {
    const { DEFAULT_CONFIG } = await import('./audio-detector')

    expect(DEFAULT_CONFIG.minStrikeInterval).toBe(25)
  })
})
```

**Step 2: Run test**

Run: `cd apps/browser && npx vitest run src/lib/audio-detector.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/browser/src/lib/audio-detector.test.ts
git commit -m "test: expand audio-detector tests for unloadEssentia and DEFAULT_CONFIG"
```

---

### Task 7: Run coverage check and assess progress

**Step 1: Run full coverage**

Run: `cd apps/browser && npm run test:coverage`

Capture the per-metric numbers and compare against baseline.

**Step 2: Evaluate if 60% thresholds are met**

If not, identify remaining gaps and write additional tests in Task 8.

---

### Task 8: Write additional tests if needed to reach 60%

Based on Task 7 results, add tests for remaining gaps. Likely candidates:
- `supabase-client.ts` — test `isSupabaseConfigured` and `getSupabaseClient` (small file, easy coverage)
- More `audio-detector.ts` coverage if needed
- Additional `ffmpeg-client.ts` function coverage
- `streaming-processor.ts` — test processVideoFile with comprehensive mocks

**Step 1: Create supabase-client.test.ts**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('supabase-client', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('exports getSupabaseClient function', async () => {
    const { getSupabaseClient } = await import('./supabase-client')
    expect(typeof getSupabaseClient).toBe('function')
  })

  it('exports isSupabaseConfigured function', async () => {
    const { isSupabaseConfigured } = await import('./supabase-client')
    expect(typeof isSupabaseConfigured).toBe('function')
  })

  it('returns null client when env vars are not set', async () => {
    const { getSupabaseClient } = await import('./supabase-client')
    // In test environment, VITE_SUPABASE_URL is not set
    const client = getSupabaseClient()
    expect(client).toBeNull()
  })

  it('reports not configured when env vars are not set', async () => {
    const { isSupabaseConfigured } = await import('./supabase-client')
    expect(isSupabaseConfigured()).toBe(false)
  })
})
```

**Step 2: Re-run coverage after any additions**

Run: `cd apps/browser && npm run test:coverage`

---

### Task 9: Update coverage thresholds in vite.config.ts

**Files:**
- Modify: `apps/browser/vite.config.ts:12-17`

Once all metrics exceed 60%, update the thresholds to the new floor values.

**Step 1: Update thresholds**

Change from:
```typescript
thresholds: {
  statements: 51,
  branches: 65,
  functions: 44,
  lines: 51,
},
```

To (values will be set to actual achieved coverage, floored to nearest integer, minimum 60):
```typescript
thresholds: {
  statements: 60,
  branches: 65,
  functions: 60,
  lines: 60,
},
```

**Step 2: Verify**

Run: `cd apps/browser && npm run test:coverage`
Expected: All tests pass, all thresholds met.

**Step 3: Commit**

```bash
git add apps/browser/vite.config.ts
git commit -m "feat: raise coverage thresholds to 60% for statements, functions, and lines"
```

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 10: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- Conventional commits (feat/fix/docs/chore prefixes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Documentation updated where needed

**Expected:** All issues addressed before proceeding.

### Task 11: Feature Testing

**Invoke:** `/test-feature raise-coverage-60`

Test the complete implementation:
- All new tests pass individually
- `npm run test:coverage` exits 0 with all thresholds at 60%+
- No existing tests broken
- Coverage gains come from real logic testing, not trivial assertions

**Expected:** All tests pass with evidence (actual output shown).

### Task 12: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
