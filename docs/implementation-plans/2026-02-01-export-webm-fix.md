# Export WebM Format Bug Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the export filename mismatch where clips without trajectory are downloaded as `.webm` but actual content is MP4.

**Architecture:** Minimal fix targeting two specific lines in ClipReview.tsx - the download filename (line 418) and the format hint text (lines 803-806). The fix changes hardcoded `.webm` to `.mp4` since the segment blobs are already MP4 format from FFmpeg extraction.

**Tech Stack:** React, TypeScript, Vitest

---

## Context

### Bug Summary

When exporting clips **without trajectory**, the code downloads them as `.webm` but the actual blob content is `video/mp4`. This causes:
1. Mislabeled files that may confuse users
2. Some players may fail to open due to extension/content mismatch
3. The format hint in the UI is misleading

### Root Cause

- **Line 418**: `a.download = `shot_${i + 1}.webm`` - hardcodes `.webm` regardless of blob type
- **Lines 803-806**: Format hint says "Clips without tracer: .webm" which is inaccurate

### Why Segments Are MP4

The `streaming-processor.ts` extracts segments using FFmpeg with `-c copy` which preserves the original container format. Since most input videos are MP4, the segments are MP4 blobs. The blob type is correctly set to `video/mp4`.

---

## Tasks

### Task 1: Verify Existing Tests Fail (Pre-Fix Baseline)

**Files:**
- Test: `apps/browser/src/components/ClipReview.test.tsx`

**Step 1: Run the export format tests to confirm they fail**

Run: `cd c:\Users\Eli\projects\golf-clip\apps\browser && npm test -- --run ClipReview.test.tsx`

Expected output: Tests in "Export Format Bug - Filename/MIME Type Mismatch" describe block should FAIL:
- `should use .mp4 extension for video/mp4 blob - FAILS with current code`
- `should match download extension to blob MIME type - FAILS with current code`
- `format hint text should accurately describe export behavior - FAILS with current code`

Note: These tests were specifically designed to fail with the broken code and pass after the fix.

---

### Task 2: Fix Download Filename Extension

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx:418`

**Step 1: Change the download filename from `.webm` to `.mp4`**

In `ClipReview.tsx`, locate line 418 and change:

```typescript
// FROM (line 418):
a.download = `shot_${i + 1}.webm`

// TO:
a.download = `shot_${i + 1}.mp4`
```

**Step 2: Also update the comment on line 415**

```typescript
// FROM (line 415):
// No trajectory - download raw segment as WebM

// TO:
// No trajectory - download raw segment as MP4
```

---

### Task 3: Update Format Hint Text

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx:803-804`

**Step 1: Change the format hint to accurately describe export behavior**

In `ClipReview.tsx`, locate lines 803-804 and change:

```typescript
// FROM (lines 803-804):
<p className="export-format-hint" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
  Clips with tracer: .mp4 | Clips without tracer: .webm

// TO:
<p className="export-format-hint" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
  All clips export as .mp4
```

---

### Task 4: Run Tests to Verify Fix

**Files:**
- Test: `apps/browser/src/components/ClipReview.test.tsx`

**Step 1: Run the export format tests to confirm they now pass**

Run: `cd c:\Users\Eli\projects\golf-clip\apps\browser && npm test -- --run ClipReview.test.tsx`

Expected output:
- The "Export Format Bug" tests that were previously failing should now PASS
- All other tests should continue to PASS

**Step 2: Verify specific test assertions**

The following test expectations should now pass:
- `expect(extension).toBe(correctExtension)` - extension should be `.mp4` for MP4 blob
- `expect(hintText).not.toContain('without tracer: .webm')` - hint no longer mentions webm
- `expect(hasAccurateHint).toBe(true)` - hint is accurate

---

### Task 5: Run Full Test Suite

**Files:**
- All test files in `apps/browser/`

**Step 1: Run all browser app tests**

Run: `cd c:\Users\Eli\projects\golf-clip\apps\browser && npm test -- --run`

Expected output: All tests pass

---

### Task 6: Type Check

**Files:**
- All TypeScript files in `apps/browser/`

**Step 1: Run TypeScript type check**

Run: `cd c:\Users\Eli\projects\golf-clip\apps\browser && npm run typecheck`

Expected output: No type errors

---

### Task 7: Commit Changes

**Step 1: Stage the modified files**

```bash
git add apps/browser/src/components/ClipReview.tsx
```

**Step 2: Commit with descriptive message**

```bash
git commit -m "fix(export): use .mp4 extension for clips without trajectory

The export was downloading clips as .webm but the actual content was MP4.
Changed line 418 to use .mp4 extension and updated format hint to be accurate.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After completing all tasks, verify:

- [ ] Export button downloads files with `.mp4` extension
- [ ] Format hint says "All clips export as .mp4"
- [ ] All tests pass
- [ ] No type errors
- [ ] Changes committed

## Files Changed Summary

| File | Changes |
|------|---------|
| `apps/browser/src/components/ClipReview.tsx` | Line 415: comment update, Line 418: `.webm` -> `.mp4`, Lines 803-804: format hint text |

## Alternative Considered

A more sophisticated fix could inspect `segment.blob.type` to dynamically determine the extension:

```typescript
const ext = segment.blob.type === 'video/webm' ? 'webm' : 'mp4'
a.download = `shot_${i + 1}.${ext}`
```

This was rejected for this fix because:
1. Current FFmpeg processing always produces MP4 containers
2. The simpler fix is sufficient and easier to verify
3. If WebM output is needed in the future, it can be added as a separate feature

---

## Test Evidence Location

After manual testing, save evidence to: `docs/test-evidence/2026-02-01-export-webm-fix/`
