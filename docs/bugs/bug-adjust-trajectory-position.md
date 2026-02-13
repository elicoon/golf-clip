# Bug: Adjust Trajectory Section Below Video

## Status: RESOLVED

## Problem
The "Adjust Trajectory" section (TracerConfigPanel) was positioned below the video player, requiring users to scroll down to access trajectory configuration options.

## Expected Behavior
The "Adjust Trajectory" section should appear above the video player for easier access while reviewing shots.

## Root Cause
The TracerConfigPanel component was rendered after the video container and tracer controls in the ClipReview component layout.

## Fix Applied
Moved the TracerConfigPanel rendering from below the video/tracer-controls to just above the video container, after the instruction banner.

**File:** `apps/browser/src/components/ClipReview.tsx`

**Change:** Relocated the TracerConfigPanel JSX block from line ~1118 (after tracer-controls) to line ~1044 (before video-container).

New layout order:
1. Review header
2. Video transport controls
3. Scrubber
4. Review action buttons
5. Instruction banner
6. **TracerConfigPanel (Adjust Trajectory)** ← moved here
7. Video container
8. Tracer controls (Sound/Auto-loop/Show Tracer)
9. Confidence info
10. Keyboard hints

## Verification
- Deployed to production: https://browser-seven-sigma.vercel.app
- Adjust Trajectory section now appears above the video player

## Date Resolved
2026-02-02
