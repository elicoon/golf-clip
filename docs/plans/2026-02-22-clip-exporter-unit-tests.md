# Clip Exporter Unit Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add unit tests for `clip-exporter.ts` covering the full export orchestration pipeline with mocked FFmpeg APIs.

**Architecture:** Mock `@ffmpeg/ffmpeg` and `@ffmpeg/util` using `vi.doMock` + `vi.resetModules()` pattern (same as `ffmpeg-client.test.ts`). Each test gets a fresh module import with tailored mock behavior. Tests cover both exported functions plus the internal `buildTrajectoryFilter` logic via its effects on FFmpeg calls.

**Tech Stack:** Vitest, vi.doMock, vi.fn, dynamic imports

**Total Tasks:** 7 (4 implementation + 3 verification)

---

### Task 1: Create test file with mock setup and happy-path test for `exportClipWithTracer`

**Files:**
- Create: `apps/browser/src/lib/clip-exporter.test.ts`

**Step 1: Write the test file with shared helpers and first two tests**

The `exportClipWithTracer` function:
1. Writes input video via `ffmpeg.writeFile`
2. Runs `ffmpeg.exec` with `-vf` filter built from trajectory
3. Reads output via `ffmpeg.readFile`
4. Returns a `Blob` with `video/mp4` type
5. Cleans up files in `finally` block

We don't mock at the module level — the function takes `ffmpeg` as a direct parameter, so we pass mock objects directly.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @ffmpeg/util since clip-exporter imports fetchFile from it
vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}))

describe('exportClipWithTracer', () => {
  function createMockFFmpeg(overrides: Record<string, unknown> = {}) {
    return {
      writeFile: vi.fn().mockResolvedValue(undefined),
      exec: vi.fn().mockResolvedValue(0),
      readFile: vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30])),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
  }

  const baseOptions = {
    videoBlob: new Blob(['test-video'], { type: 'video/mp4' }),
    trajectory: [
      { x: 0.1, y: 0.2, timestamp: 0 },
      { x: 0.5, y: 0.6, timestamp: 0.5 },
      { x: 0.9, y: 0.8, timestamp: 1.0 },
    ],
    startTime: 2,
    endTime: 5,
    videoWidth: 1920,
    videoHeight: 1080,
  }

  it('returns a video/mp4 Blob on successful export', async () => {
    const { exportClipWithTracer } = await import('./clip-exporter')
    const ffmpeg = createMockFFmpeg()

    const result = await exportClipWithTracer(ffmpeg as any, baseOptions)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('video/mp4')
  })

  it('calls ffmpeg.exec with correct time range and trajectory filter', async () => {
    const { exportClipWithTracer } = await import('./clip-exporter')
    const ffmpeg = createMockFFmpeg()

    await exportClipWithTracer(ffmpeg as any, baseOptions)

    expect(ffmpeg.writeFile).toHaveBeenCalledWith('input.mp4', expect.any(Uint8Array))
    expect(ffmpeg.exec).toHaveBeenCalledWith(
      expect.arrayContaining(['-ss', '2', '-t', '3'])
    )
    // Should include -vf with drawbox commands from trajectory
    const execArgs = ffmpeg.exec.mock.calls[0][0] as string[]
    const vfIndex = execArgs.indexOf('-vf')
    expect(vfIndex).toBeGreaterThan(-1)
    expect(execArgs[vfIndex + 1]).toContain('drawbox')
  })
})
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run apps/browser/src/lib/clip-exporter.test.ts --reporter=verbose`
Expected: 2 tests PASS

**Step 3: Commit**

```bash
git add apps/browser/src/lib/clip-exporter.test.ts
git commit -m "test: add clip-exporter happy-path tests for exportClipWithTracer"
```

---

### Task 2: Add error handling and cleanup tests

**Files:**
- Modify: `apps/browser/src/lib/clip-exporter.test.ts`

**Step 1: Add tests for FFmpeg failure and cleanup behavior**

Append these tests inside the existing `describe('exportClipWithTracer')` block:

```typescript
  it('throws when ffmpeg.exec returns non-zero exit code', async () => {
    const { exportClipWithTracer } = await import('./clip-exporter')
    const ffmpeg = createMockFFmpeg({ exec: vi.fn().mockResolvedValue(1) })

    await expect(exportClipWithTracer(ffmpeg as any, baseOptions))
      .rejects.toThrow('FFmpeg export failed with exit code 1')
  })

  it('throws when readFile returns non-Uint8Array', async () => {
    const { exportClipWithTracer } = await import('./clip-exporter')
    const ffmpeg = createMockFFmpeg({
      readFile: vi.fn().mockResolvedValue('string-instead-of-bytes'),
    })

    await expect(exportClipWithTracer(ffmpeg as any, baseOptions))
      .rejects.toThrow('Unexpected FFmpeg output format')
  })

  it('cleans up input and output files even when exec fails', async () => {
    const { exportClipWithTracer } = await import('./clip-exporter')
    const ffmpeg = createMockFFmpeg({ exec: vi.fn().mockRejectedValue(new Error('crash')) })

    await expect(exportClipWithTracer(ffmpeg as any, baseOptions)).rejects.toThrow('crash')

    expect(ffmpeg.deleteFile).toHaveBeenCalledWith('input.mp4')
    expect(ffmpeg.deleteFile).toHaveBeenCalledWith('output.mp4')
  })
```

**Step 2: Run tests to verify**

Run: `npx vitest run apps/browser/src/lib/clip-exporter.test.ts --reporter=verbose`
Expected: 5 tests PASS

**Step 3: Commit**

```bash
git add apps/browser/src/lib/clip-exporter.test.ts
git commit -m "test: add clip-exporter error handling and cleanup tests"
```

---

### Task 3: Add trajectory filter edge case and optional parameter tests

**Files:**
- Modify: `apps/browser/src/lib/clip-exporter.test.ts`

**Step 1: Add tests for trajectory edge cases and custom tracer options**

Append these tests inside the existing `describe('exportClipWithTracer')` block:

```typescript
  it('uses "null" filter when trajectory has fewer than 2 points', async () => {
    const { exportClipWithTracer } = await import('./clip-exporter')
    const ffmpeg = createMockFFmpeg()

    await exportClipWithTracer(ffmpeg as any, {
      ...baseOptions,
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
    })

    const execArgs = ffmpeg.exec.mock.calls[0][0] as string[]
    const vfIndex = execArgs.indexOf('-vf')
    expect(execArgs[vfIndex + 1]).toBe('null')
  })

  it('uses custom tracerColor and tracerWidth when provided', async () => {
    const { exportClipWithTracer } = await import('./clip-exporter')
    const ffmpeg = createMockFFmpeg()

    await exportClipWithTracer(ffmpeg as any, {
      ...baseOptions,
      tracerColor: 'red',
      tracerWidth: 5,
    })

    const execArgs = ffmpeg.exec.mock.calls[0][0] as string[]
    const vfIndex = execArgs.indexOf('-vf')
    const filter = execArgs[vfIndex + 1]
    expect(filter).toContain('color=red')
    expect(filter).toContain('w=5')
    expect(filter).toContain('h=5')
  })
```

**Step 2: Run tests to verify**

Run: `npx vitest run apps/browser/src/lib/clip-exporter.test.ts --reporter=verbose`
Expected: 7 tests PASS

**Step 3: Commit**

```bash
git add apps/browser/src/lib/clip-exporter.test.ts
git commit -m "test: add trajectory filter edge case and custom parameter tests"
```

---

### Task 4: Add `exportWithCanvasCompositing` placeholder test

**Files:**
- Modify: `apps/browser/src/lib/clip-exporter.test.ts`

**Step 1: Add describe block for the second exported function**

Append after the `exportClipWithTracer` describe block:

```typescript
describe('exportWithCanvasCompositing', () => {
  it('throws "not yet implemented" error', async () => {
    const { exportWithCanvasCompositing } = await import('./clip-exporter')
    const blob = new Blob(['test'], { type: 'video/mp4' })
    const canvas = document.createElement('canvas')

    await expect(exportWithCanvasCompositing(blob, canvas, 0, 5))
      .rejects.toThrow('Canvas compositing not yet implemented')
  })
})
```

**Step 2: Run full test suite to verify all 8 tests pass**

Run: `npx vitest run apps/browser/src/lib/clip-exporter.test.ts --reporter=verbose`
Expected: 8 tests PASS

**Step 3: Run full project test suite**

Run: `npx vitest run --reporter=verbose`
Expected: 422 + 8 = 430 tests pass (4 e2e files still expected to fail)

**Step 4: Commit**

```bash
git add apps/browser/src/lib/clip-exporter.test.ts
git commit -m "test: add exportWithCanvasCompositing placeholder test"
```

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 5: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- Conventional commits (feat/fix/docs/chore prefixes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Tests actually exercise the source code paths, not just mocks

**Expected:** All issues addressed before proceeding.

### Task 6: Feature Testing

Run full test suite and verify:
- All 8 new tests in `clip-exporter.test.ts` pass
- No regressions in existing 422 tests
- Tests actually fail when they should (remove a mock to verify)

Run: `npx vitest run apps/browser/src/lib/clip-exporter.test.ts --reporter=verbose`
Run: `npx vitest run --reporter=verbose`

**Expected:** All tests pass with evidence (actual output shown).

### Task 7: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
