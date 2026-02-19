# UI Redesign: 6 Changes

**Date:** 2026-02-18
**Status:** Approved

## Changes

### 1. Remove skip shot confirmation dialog
- Remove `ConfirmDialog` usage from ClipReview
- "No Golf Shot" button and Escape key immediately reject (no confirmation step)
- `showRejectConfirm` state and `handleRejectWithConfirm` wrapper removed

### 2. Remove header, distribute content into views
- Delete `<header>` from App.tsx
- "GolfClip" title: upload screen only (above about box)
- VideoQueue: rendered inline in review UI (above shot counter)
- "New Video" button: review-complete and export-complete screens only
- ReviewActions component and reviewActionsStore bridge become unused — remove

### 3. Upload screen walkthrough illustrations (left column)
- Two-column layout on upload screen
- Left column: 3 numbered CSS/SVG illustration cards
  1. "Upload Video" — upload icon + drag-drop graphic
  2. "Mark Tracers & Confirm" — video frame with trajectory line
  3. "Export Clips" — download icon with MP4 badge
- Right column: existing about box + VideoDropzone
- Mobile: illustrations collapse to horizontal strip above dropzone

### 4. Strike indicator below timeline scrubber
- Below scrubber track, above time labels
- Orange circle: initial auto-detected strike time (original `strikeTime`)
- Green circle: current impact time (after user adjustment)
- 8-10px diameter, subtle drop shadow
- When not adjusted, show only green circle
- New prop `originalStrikeTime` passed to Scrubber

### 5. Two-column trajectory settings
- CSS grid 2 columns in TracerConfigPanel config-body
- Left: Shot Height, Shot Shape, Flight Time
- Right: Origin Point, Impact Time, Landing Point, Apex Point
- Generate button: full-width spanning both columns
- Style options: remain full-width below

### 6. Move approve/reject buttons between config and video
New ClipReview layout (top to bottom):
1. Review header (shot counter text)
2. TracerConfigPanel (two-column)
3. Approve/Reject buttons
4. Instruction banner
5. Video player + canvas overlay
6. Transport controls
7. Scrubber (with strike indicators)
8. Playback options (mute, auto-loop, show tracer)
9. Confidence info + keyboard hints

ReviewActions component removed (buttons live inline in ClipReview only).
