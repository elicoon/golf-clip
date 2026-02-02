# Bug: Trajectory/Marker Lines Render Outside Video Area

**Status:** Fixed
**Priority:** P2
**Component:** TrajectoryEditor.tsx, trajectory-generator.ts
**Date:** 2026-01-31

## Description

On the clip review page, trajectory or marker lines are rendering in the bottom-right corner of the screen, outside the video player area.

## Root Cause

Trajectory generator can produce apex coordinates outside 0-1 range, and `toCanvas()` doesn't clamp.

## Resolution

Fixed with defense-in-depth approach:
1. Clamped `apex_point` coordinates in `trajectory-generator.ts` to 0-1 range
2. Added `clampedToCanvas()` helper in `TrajectoryEditor.tsx`
3. Updated all marker rendering (landing, apex, origin) to use clamped coordinates
4. Updated trajectory curve drawing (`drawSmoothCurve`) to use clamped coordinates
5. Added `overflow: hidden` CSS as safety net

## Verification

All 15 bounds tests now pass.

## Commits

- bea29db fix(trajectory): clamp apex_point coordinates to 0-1 range
- 3f21ee1 feat(trajectory-editor): add clampedToCanvas helper for bounds safety
- 7f43785 fix(trajectory-editor): use clamped coordinates for marker rendering
- d69f1ac fix(trajectory-editor): clamp trajectory apex marker coordinates
- e7ba760 fix(trajectory-editor): clamp all trajectory curve coordinates
- 27d6c91 fix(trajectory-editor): add overflow:hidden as rendering safety net

## Files Changed

- `apps/browser/src/lib/trajectory-generator.ts`
- `apps/browser/src/components/TrajectoryEditor.tsx`
- `apps/browser/src/styles/global.css`
