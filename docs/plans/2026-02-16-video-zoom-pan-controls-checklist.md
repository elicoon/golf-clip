# Test Checklist: Video Zoom and Pan Controls

Source: [video-zoom-pan-controls-uat.md](./2026-02-16-video-zoom-pan-controls-uat.md)

## Automatable (Claude executes)

### Happy Path
- [ ] HP-1: Zoom in with + key shows "1.5x zoom" indicator
- [ ] HP-2: Zoom out with - key decreases zoom level
- [ ] HP-3: Reset zoom with 0 key removes indicator
- [ ] HP-4: Zoom resets when navigating to next shot
- [ ] HP-5: CSS transform applied to video-zoom-content at zoom levels
- [ ] HP-6: Drag to pan updates offset when zoomed

### Error Handling
- [ ] ERR-1: Zoom shortcuts ignored when typing in input fields
- [ ] ERR-2: Pan does not activate at 1x zoom

### Edge Cases
- [ ] EDGE-1: Zoom clamps at 4x maximum
- [ ] EDGE-2: Zoom clamps at 1x minimum
- [ ] EDGE-3: Pan does not activate during landing marking mode
- [ ] EDGE-4: Pan does not activate during apex/origin marking
- [ ] EDGE-5: Pan offset resets when zoom returns to 1x

### Boundary Conditions
- [ ] BOUND-1: Pan clamped to prevent showing empty space
- [ ] BOUND-2: Pan clamped in both axes at 4x zoom

### Integration Points
- [ ] INT-1: Landing marker placement works at 2x zoom
- [ ] INT-2: TrajectoryEditor canvas stays in sync with zoom
- [ ] INT-3: Existing keyboard shortcuts work when zoomed
- [ ] INT-4: Existing test suite passes (all tests green)

### Performance
- [ ] PERF-1: Zoom transition is smooth (CSS 0.15s ease-out)
- [ ] PERF-2: Pan is responsive during drag (no transition)

## Manual (Human verifies)

- [ ] MAN-1: Zoom indicator is readable and unobtrusive
- [ ] MAN-2: Cursor changes feel natural (grab/grabbing)
- [ ] MAN-3: Precise marker placement improved at 4x zoom on high-res video
