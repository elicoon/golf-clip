### Add Draggable Control Points to Trajectory Tracer Overlay
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** TrajectoryEditor.tsx (line 373) has a TODO noting that tracer point dragging is disabled to allow marker placement. Currently users place origin/apex/landing markers via clicks, but once placed, the points cannot be repositioned by dragging. Adding drag support would let users fine-tune tracer overlays without re-placing markers from scratch. The pointer handler stubs already exist (`handlePointerDown`, `handlePointerMove`, `handlePointerUp`) but are no-ops. Implementation needs to distinguish between "place new marker" clicks and "drag existing marker" interactions — likely via a mode toggle or proximity detection (click near existing point = drag, click elsewhere = place).
- **Added:** 2026-02-22
- **Updated:** 2026-02-22

#### Acceptance Criteria
- [ ] User can drag an existing tracer control point (origin, apex, or landing) to reposition it
- [ ] Dragging updates the trajectory curve in real-time as the point moves
- [ ] Clicking in empty space still places a new marker (existing behavior preserved)
- [ ] Drag interaction works correctly with video zoom/pan transforms
- [ ] Unit test verifies drag repositions a control point and updates trajectory state

#### Next steps
1. Read `TrajectoryEditor.tsx` to understand the current pointer handler stubs and canvas coordinate system
2. Implement proximity detection in `handlePointerDown` — if pointer is within N pixels of an existing control point, enter drag mode instead of placing a new marker
3. In `handlePointerMove`, update the dragged point's position (converting screen coords to video coords using existing transform logic)
4. In `handlePointerUp`, commit the new position to state via `onTrajectoryUpdate`
5. Add test that simulates pointerdown near a control point, pointermove, and pointerup, then verifies the point moved
