# UAT: Video Zoom and Pan Controls

## Overview

Verify that keyboard-driven zoom (1x-4x in 0.5x steps) and mouse-drag panning work correctly in the clip review video player, enabling precise marker placement on high-resolution video. Success criteria: all acceptance criteria from the dispatch pass, existing tests remain green, and marking functionality works at every zoom level.

## Test Data Requirements

| Data | Description | Setup | Teardown |
|------|-------------|-------|----------|
| Mock video segments | Two segments with `confidence: 0.5` triggering review | Created in-memory via mock processingStore | Cleanup via `afterEach` |
| Canvas mock | Canvas 2D context capturing draw coordinates | jsdom mock in test setup | N/A |
| Video element mock | Simulates `getBoundingClientRect()` with known dimensions | jsdom mock with 800x450 container | N/A |
| Real video (manual) | Any golf video processed through the app | Upload via UI | N/A |

## Test Cases

### Category: Happy Path

| ID | Criteria | Detailed Steps | Expected Result | Complexity |
|----|----------|----------------|-----------------|------------|
| HP-1 | Zoom in with + key | 1. Render ClipReview with mock segments 2. Press `=` key once 3. Check zoom indicator | Zoom indicator shows "1.5x zoom" text, video-container has `zoomed` class | [quick] |
| HP-2 | Zoom out with - key | 1. Press `=` twice to reach 2.0x 2. Press `-` once | Zoom indicator shows "1.5x zoom" | [quick] |
| HP-3 | Reset zoom with 0 key | 1. Press `=` three times to reach 2.5x 2. Press `0` | No zoom indicator visible, video-container loses `zoomed` class | [quick] |
| HP-4 | Zoom resets on shot navigation | 1. Zoom to 2x 2. Press ArrowDown to go to next shot | Zoom resets to 1x, no zoom indicator visible | [quick] |
| HP-5 | CSS transform applied at zoom levels | 1. Zoom to 2x 2. Inspect `.video-zoom-content` element | `transform` style contains `scale(2)` | [quick] |
| HP-6 | Drag to pan when zoomed | 1. Zoom to 2x 2. Pointer down on video container 3. Move pointer 50px right 4. Pointer up | Pan offset updates, video-container gets `panning` class during drag | [moderate] |

### Category: Error Handling

| ID | Criteria | Detailed Steps | Expected Result | Complexity |
|----|----------|----------------|-----------------|------------|
| ERR-1 | Zoom shortcuts ignored in input fields | 1. Focus a text input element 2. Press `=` key | Zoom does not change (stays 1x) | [quick] |
| ERR-2 | Pan does not activate at 1x zoom | 1. At 1x zoom 2. Pointer down + drag on video container | No panning occurs, cursor remains default | [quick] |

### Category: Edge Cases

| ID | Criteria | Detailed Steps | Expected Result | Complexity |
|----|----------|----------------|-----------------|------------|
| EDGE-1 | Zoom clamps at 4x maximum | 1. Press `=` key 8 times (would reach 5x if unclamped) | Zoom indicator shows "4.0x zoom", never exceeds 4x | [quick] |
| EDGE-2 | Zoom clamps at 1x minimum | 1. At 1x zoom 2. Press `-` key 3 times | No zoom indicator, zoom stays at 1x, no negative zoom | [quick] |
| EDGE-3 | Pan does not activate during marking mode | 1. Zoom to 2x 2. In `marking_landing` step 3. Pointer down + drag | No panning occurs, landing cursor still active for placement | [moderate] |
| EDGE-4 | Pan does not activate during apex/origin marking | 1. Zoom to 2x 2. Activate apex marking mode 3. Drag | No panning, apex cursor still active | [moderate] |
| EDGE-5 | Pan offset resets when zoom returns to 1x | 1. Zoom to 2x 2. Pan to offset 3. Press `-` twice to reach 1x | Pan offset resets to {x: 0, y: 0} | [quick] |

### Category: Boundary Conditions

| ID | Criteria | Detailed Steps | Expected Result | Complexity |
|----|----------|----------------|-----------------|------------|
| BOUND-1 | Pan clamped to prevent showing empty space | 1. Zoom to 2x 2. Drag far to the right (1000px) | Pan offset is clamped so video edges remain visible within container | [moderate] |
| BOUND-2 | Pan clamped in both axes | 1. Zoom to 4x 2. Drag to extreme corner (up-left) | Both X and Y pan offsets are clamped, no empty black space visible | [moderate] |

### Category: Integration Points

| ID | Criteria | Detailed Steps | Expected Result | Complexity |
|----|----------|----------------|-----------------|------------|
| INT-1 | Landing marker placement works at 2x zoom | 1. Zoom to 2x 2. Pan to center 3. Click on video to mark landing | Landing point coordinates are correct (normalized 0-1), marker appears at click position | [thorough] |
| INT-2 | TrajectoryEditor canvas stays in sync with zoom | 1. Zoom to 2x 2. Verify canvas overlay scales with video | Canvas and video are both inside the transformed wrapper, visually aligned | [moderate] |
| INT-3 | Existing keyboard shortcuts still work when zoomed | 1. Zoom to 2x 2. Press Space to play/pause 3. Press arrow keys for frame step | All existing shortcuts work normally alongside zoom shortcuts | [moderate] |
| INT-4 | Existing test suite passes | 1. Run `cd apps/browser && npx vitest run` | All tests pass (existing + new zoom tests) | [quick] |

### Category: Performance

| ID | Criteria | Detailed Steps | Expected Result | Complexity |
|----|----------|----------------|-----------------|------------|
| PERF-1 | Zoom transition is smooth | 1. Press `=` to zoom in 2. Observe transition | CSS transition animates smoothly (0.15s ease-out), no jank | [quick] |
| PERF-2 | Pan is responsive during drag | 1. Zoom to 2x 2. Drag continuously | Pan follows mouse without noticeable lag, transition disabled during drag | [quick] |

### Category: Manual Verification (Subjective)

| ID | Criteria | What to Evaluate | Complexity |
|----|----------|------------------|------------|
| MAN-1 | Zoom indicator is readable and unobtrusive | Check that "X.Xx zoom" text is clearly visible but doesn't obstruct the video | [quick] |
| MAN-2 | Cursor changes feel natural | Verify grab cursor when zoomed, grabbing while dragging, normal during marking | [quick] |
| MAN-3 | Precise marker placement improved at 4x zoom | Upload a 4K video, zoom to 4x, place landing marker — is it easier to be precise? | [thorough] |
