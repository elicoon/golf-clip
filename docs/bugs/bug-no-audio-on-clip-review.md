# Bug: No Audio on Clip Review Page

**Status:** Fixed
**Priority:** P2
**Component:** ClipReview.tsx
**Date:** 2026-01-31

## Description

Video plays but no audio is heard on the clip review page.

## Root Cause

The `<video>` element in ClipReview.tsx had a hardcoded `muted` attribute for autoplay policy compliance, but no mechanism to unmute.

## Resolution

- Video starts unmuted (`useState(false)`)
- On autoplay, tries to play with audio first
- If browser blocks unmuted autoplay, falls back to muted and retries
- Added toggle button ("Sound On" / "Unmute") in tracer-controls

## Verification

- All 153 tests pass
- Build succeeds
- Manual UAT confirmed audio works (2026-02-01)

## Files Changed

- `apps/browser/src/components/ClipReview.tsx`
