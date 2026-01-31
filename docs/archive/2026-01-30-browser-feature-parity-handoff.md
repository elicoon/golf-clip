# Browser Feature Parity Implementation - Handoff

**Created:** 2026-01-30
**Status:** Tasks 1-3 complete, Tasks 4-8 remaining
**Working Directory:** `c:\Users\Eli\projects\golf-clip`

## Overview

Implementing browser app feature parity with the desktop app's ClipReview workflow. Following the detailed plan at `docs/plans/2026-01-30-browser-feature-parity.md`.

**Project:** golf-clip
**Target:** apps/browser - React/TypeScript/Zustand/Vite browser app

## Progress Summary

### Completed Tasks (1-3) ✅

**Task 1: Extend ProcessingStore for ClipReview State**
- Added `TrajectoryPoint`, `TrajectoryData`, `TracerConfig` interfaces
- Extended `VideoSegment` with: confidence, clipStart, clipEnd, approved, landingPoint, trajectory
- Added store actions: `updateSegment`, `approveSegment`, `rejectSegment`
- Fixed streaming-processor.ts to work with new types
- **Commit:** `8635835`

**Task 2: Create ClipReview Component Shell**
- Created `apps/browser/src/components/ClipReview.tsx`
  - Shot navigation (previous/next)
  - Video playback with play/pause
  - Approve/reject actions
  - Confidence badge display
  - Keyboard hints UI
- Updated `apps/browser/src/App.tsx` with view-based routing (upload → review → export)
- **Commit:** `3ac3298`

**Task 3: Add Scrubber Component**
- Created `apps/browser/src/components/Scrubber.tsx` (copied from packages/frontend)
- Integrated into ClipReview with `onTimeUpdate` handler
- Full drag-to-trim functionality with handles, playhead, hover preview
- **Commit:** `479cbd1`

### Remaining Tasks (4-8)

| Task | Description | Status |
|------|-------------|--------|
| 4 | Wire Up Trajectory Rendering | Pending |
| 5 | Add TracerConfigPanel | Pending |
| 6 | Add Keyboard Shortcuts | Pending |
| 7 | Add Export Functionality | Pending |
| 8 | Final Integration & Polish | Pending |

## How to Continue

### Starter Prompt

```
Working Directory: c:\Users\Eli\projects\golf-clip

## Context
I'm continuing the browser app feature parity implementation. Tasks 1-3 are complete.
I need to implement Tasks 4-8 following the plan.

## Instructions
1. Read the full implementation plan: `docs/plans/2026-01-30-browser-feature-parity.md`
2. Use the executing-plans skill to continue from Task 4:
   /superpowers:executing-plans docs/plans/2026-01-30-browser-feature-parity.md

The plan has detailed step-by-step instructions for each remaining task.

## What's Already Done
- processingStore.ts extended with TrajectoryData, TracerConfig, new actions
- ClipReview.tsx created with shot navigation, playback, approve/reject
- Scrubber.tsx created and integrated for clip trimming
- App.tsx has view routing: upload → review → export

## What's Next (Task 4)
- Add trajectory generation utility to ClipReview
- Wire up existing TrajectoryEditor.tsx (already exists, just needs props)
- Add trajectory state management
- Add instruction banners for marking flow

## Key Files Modified
- apps/browser/src/stores/processingStore.ts
- apps/browser/src/components/ClipReview.tsx
- apps/browser/src/components/Scrubber.tsx
- apps/browser/src/App.tsx

## Build Verification
After each task: cd apps/browser && npm run build
```

## Key Implementation Notes

### TrajectoryEditor Already Exists
The TrajectoryEditor component is at `apps/browser/src/components/TrajectoryEditor.tsx` (550 lines). Task 4 is about wiring it up, not creating it.

### CSS Already in Place
All needed CSS styles are already in `apps/browser/src/styles/global.css`. The plan's CSS snippets are for reference but most classes already exist.

### Architecture
- All processing is client-side (no API calls)
- Uses Zustand store (`processingStore.ts`)
- Trajectories use mock bezier curve generation (not real ball tracking)
- Video segments have `objectUrl` for playback

## Build Status

Last verified build (after Task 3):
```
vite v5.4.21 building for production...
✓ 65 modules transformed
✓ built in 1.21s
```

## Git Status

Branch: master

Recent commits:
```
479cbd1 feat(browser): add Scrubber component for clip trimming
3ac3298 feat(browser): add ClipReview component with shot navigation
8635835 feat(browser): extend store with ClipReview state management
```

## File Structure

```
apps/browser/src/
├── App.tsx                          # View routing ✓ modified
├── stores/
│   └── processingStore.ts           # Zustand store ✓ modified
├── components/
│   ├── ClipReview.tsx              # Review component ✓ created
│   ├── Scrubber.tsx                # Timeline scrubber ✓ created
│   ├── TrajectoryEditor.tsx        # EXISTS - needs wiring (Task 4)
│   └── VideoDropzone.tsx           # Upload component
└── styles/
    └── global.css                   # Has all needed CSS
```

## Remaining Work Summary

**Task 4: Trajectory Rendering**
- Add `generateTrajectory()` utility function
- Add state: showTracer, currentTime, landingPoint, apexPoint, originPoint, reviewStep, trajectory, tracerConfig
- Wire TrajectoryEditor into video-container
- Add instruction banners

**Task 5: TracerConfigPanel**
- Copy from packages/frontend, simplify interface
- Integrate with config state and handlers

**Task 6: Keyboard Shortcuts**
- Add useEffect keyboard handler
- Shortcuts: Space, arrows, Enter, Esc, [ ], etc.
- Use refs to avoid stale closures

**Task 7: Export Functionality**
- Export state and modal
- Download approved clips via blob URLs
- Progress indicator

**Task 8: Final Polish**
- Auto-loop for clip playback
- Auto-loop toggle
- Full verification checklist
