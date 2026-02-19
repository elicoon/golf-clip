# Test Checklist: Video Zoom and Pan Controls

Source: [video-zoom-pan-controls-uat.md](./2026-02-16-video-zoom-pan-controls-uat.md)

## Automatable (Claude executes)

### Happy Path
- [x] HP-1: Zoom in with + key shows "1.5x zoom" indicator ✓ 2026-02-17 (test: "zooms in with = key and shows zoom indicator", "zooms in with + key")
- [x] HP-2: Zoom out with - key decreases zoom level ✓ 2026-02-17 (test: "zooms out with - key")
- [x] HP-3: Reset zoom with 0 key removes indicator ✓ 2026-02-17 (test: "resets zoom with 0 key")
- [x] HP-4: Zoom resets when navigating to next shot ✓ 2026-02-17 (test: "resets zoom when navigating to next shot", shot change useEffect at line 307)
- [x] HP-5: CSS transform applied to video-zoom-content at zoom levels ✓ 2026-02-17 (test: "applies scale transform to video-zoom-content when zoomed", line 1124-1126)
- [x] HP-6: Drag to pan updates offset when zoomed ✓ 2026-02-17 (code: handlePanStart/Move/End at lines 759-789, pointer events on container at lines 1116-1119)

### Error Handling
- [x] ERR-1: Zoom shortcuts ignored when typing in input fields ✓ 2026-02-17 (test: "does not zoom when typing in input fields", guard at line 804)
- [x] ERR-2: Pan does not activate at 1x zoom ✓ 2026-02-17 (code: `if (zoomLevel <= 1) return` at line 760)

### Edge Cases
- [x] EDGE-1: Zoom clamps at 4x maximum ✓ 2026-02-17 (test: "clamps zoom at 4x maximum", `Math.min(4, prev + 0.5)` at line 887)
- [x] EDGE-2: Zoom clamps at 1x minimum ✓ 2026-02-17 (test: "clamps zoom at 1x minimum and hides indicator", `Math.max(1, prev - 0.5)` at line 892)
- [x] EDGE-3: Pan does not activate during landing marking mode ✓ 2026-02-17 (code: `reviewStep === 'marking_landing'` guard at line 761)
- [x] EDGE-4: Pan does not activate during apex/origin marking ✓ 2026-02-17 (code: `isMarkingApex || isMarkingOrigin || isMarkingLanding` guard at line 761)
- [x] EDGE-5: Pan offset resets when zoom returns to 1x ✓ 2026-02-17 (code: `if (next === 1) setPanOffset({ x: 0, y: 0 })` at line 893, and `case '0'` at line 899-900)

### Boundary Conditions
- [x] BOUND-1: Pan clamped to prevent showing empty space ✓ 2026-02-17 (code: maxPanX/Y formula at lines 778-779, Math.max/min clamp at lines 781-784)
- [x] BOUND-2: Pan clamped in both axes at 4x zoom ✓ 2026-02-17 (code: same clamp applies to both axes, plus reclamp useEffect at lines 310-320)

### Integration Points
- [x] INT-1: Landing marker placement works at 2x zoom ✓ 2026-02-17 (code: TrajectoryEditor.handleClick computes fresh bounds from getBoundingClientRect at click time, lines 555-583)
- [x] INT-2: TrajectoryEditor canvas stays in sync with zoom ✓ 2026-02-17 (code: both <video> and <TrajectoryEditor> inside .video-zoom-content wrapper, lines 1145-1170)
- [x] INT-3: Existing keyboard shortcuts work when zoomed ✓ 2026-02-17 (code: zoom cases added to same switch block, no guard changes to existing shortcuts)
- [x] INT-4: Existing test suite passes (all tests green) ✓ 2026-02-17 (evidence: 394 passed, 0 failed, 24 test files)

### Performance
- [x] PERF-1: Zoom transition is smooth (CSS 0.15s ease-out) ✓ 2026-02-17 (CSS: `.video-zoom-content { transition: transform 0.15s ease-out; }` at global.css:905)
- [x] PERF-2: Pan is responsive during drag (no transition) ✓ 2026-02-17 (CSS: `.video-container.panning .video-zoom-content { transition: none; }` at global.css:908-909)

## Manual (Human verifies)

- [ ] MAN-1: Zoom indicator is readable and unobtrusive
- [ ] MAN-2: Cursor changes feel natural (grab/grabbing)
- [ ] MAN-3: Precise marker placement improved at 4x zoom on high-res video
