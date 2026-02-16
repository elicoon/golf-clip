# Bug: ClipReview Has Redundant Navigation Buttons

**Status:** Fixed
**Priority:** P2
**Component:** ClipReview.tsx
**Date:** 2026-02-01

## Description

The ClipReview component has two sets of navigation controls that serve similar purposes, creating UI clutter and confusion.

## Current Behavior

Two sets of navigation:
1. `playback-controls` div with "Previous / Play / Next" buttons
2. `review-actions` div with "No Golf Shot / Approve Shot" buttons

The "No Golf Shot" and "Approve Shot" buttons already advance to the next shot after action, making "Previous/Next" navigation redundant. Additionally, the review action buttons are positioned too far down the page.

**Note (2026-02-01 verification):** Previous/Next buttons appear on first shot only, not on subsequent shots. Inconsistent behavior.

## Expected Behavior

- Only one set of navigation controls (the review action buttons)
- "No Golf Shot / Approve Shot" buttons should appear near the top of the page for immediate visibility

## Proposed Fix

In `apps/browser/src/components/ClipReview.tsx`:
1. Remove the `playback-controls` div containing "Previous / Play / Next" buttons
2. Move the `review-actions` div to near the top of the layout, after the shot counter/header

## Files

- `apps/browser/src/components/ClipReview.tsx`

## 2026-02-01 User Test Findings

- User reported: "the no-golf shot and approve shot are still showing below the video instead of above it"
- User reported: "Previous/Next buttons still showing" - these should have been removed
- Note: Testing was done on PRODUCTION (browser-seven-sigma.vercel.app) which does NOT have local fixes deployed
- Root cause of "incorrectly marked fixed": Local changes were never committed/deployed to production

## Why This Wasn't Caught

- Testing was done locally but fixes never deployed
- No automated E2E tests to verify button positioning
- No visual regression tests

## Resolution

The navigation button layout was restructured in commit 33e64c4. The "No Golf Shot" and "Next" buttons were moved above the video player for immediate visibility and accessibility. The redundant Previous/Next navigation was removed, simplifying the UI to only use the review action buttons which already advance to the next shot after action.

## Verification

Layout tests were created in `apps/browser/src/components/ClipReview.layout.test.tsx` to verify:
- Navigation buttons appear above the video element in the DOM
- Shot counter displays correctly
- Button visibility and accessibility
