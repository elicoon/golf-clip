# Integration Test Mock Exit Code Fix

**Date:** 2026-02-01
**File:** `apps/browser/src/lib/video-frame-pipeline.integration.test.ts`

## Problem

The code using FFmpeg's `exec()` function checks the exit code to detect failures:

```typescript
const exitCode = await ffmpeg.exec([...args])
if (exitCode !== 0) {
  throw new Error(`FFmpeg failed with exit code ${exitCode}`)
}
```

The mock FFmpeg's `exec()` function in the integration tests didn't return a value for all code paths. When the real code checked `exitCode !== 0`, it evaluated `undefined !== 0` as `true`, causing tests to fail.

## Root Cause

In `createMockFFmpeg()`, the `exec` function:
- Threw an error when `failOnExec` was true (correct behavior)
- Populated frame files when `image2` was in the args
- **Did not return any value at the end** (bug)

```typescript
exec: vi.fn(async (args: string[]) => {
  if (options.failOnExec) {
    throw new Error('FFmpeg exec failed')
  }
  // ... frame extraction logic ...
  // Missing: return 0
}),
```

## Fix Applied

Added `return 0` at the end of the `exec` function to return a success exit code for all code paths:

```typescript
exec: vi.fn(async (args: string[]) => {
  if (options.failOnExec) {
    throw new Error('FFmpeg exec failed')
  }
  // ... frame extraction logic ...
  // Return exit code 0 (success) for all code paths
  return 0
}),
```

## Branches

| Branch | Status | Notes |
|--------|--------|-------|
| `fix/clip-boundary-extension-v2` | Fixed | Applied fix |
| `fix/sequential-upload-processing` | Already fixed | Had the fix already |
| `master` | Needs fix | Same issue exists |

## Verification

All 15 integration tests pass after the fix:

```
 ✓ src/lib/video-frame-pipeline.integration.test.ts (15 tests) 206ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
```

## Related Files

Files that use exit code checking:
- `apps/browser/src/lib/clip-exporter.ts` (line 61)
- `apps/browser/src/lib/ffmpeg-client.ts` (lines 62, 296, 364)
