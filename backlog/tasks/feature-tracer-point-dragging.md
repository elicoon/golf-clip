### Add Interactive Tracer Point Dragging in TrajectoryEditor
- **Project:** golf-clip
- **Status:** in progress
- **Dispatched:** 2026-02-27-golf-clip-tracer-point-dragging
- **Priority:** low
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** There is an in-code TODO in `apps/browser/src/components/TrajectoryEditor.tsx:373`: "Add tracer point dragging to backlog as optional feature". Currently the trajectory path is fully determined by the physics model (ball origin + landing position + height/shape sliders). Allowing users to drag intermediate control points on the rendered trajectory would give fine-grained control over the tracer path for shots with unusual ball flight. The trajectory is already generated as a quadratic Bezier — adding a draggable control point at the apex would be the natural first implementation.
- **Added:** 2026-02-26
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] The trajectory apex point is rendered as a draggable handle on the TrajectoryEditor canvas
- [ ] Dragging the apex handle updates the Bezier control point and re-renders the tracer in real time
- [ ] The drag interaction works alongside existing ball origin click-to-place (no conflict)
- [ ] Dragging the apex modifies the same trajectory state consumed by the tracer renderer and export pipeline (WYSIWYG)
- [ ] A reset button or double-click restores the apex to its physics-model default position

#### Next steps
1. Read `apps/browser/src/components/TrajectoryEditor.tsx` and `apps/browser/src/lib/trajectory-generator.ts` to understand the Bezier control point structure
2. Identify where the apex control point coordinate is calculated and expose it as mutable state
3. Add a draggable SVG circle at the apex position in TrajectoryEditor; wire mousedown/mousemove/mouseup to update the control point
4. Propagate the modified control point through the existing trajectory state to the tracer renderer
5. Add a unit test for the apex drag interaction using fireEvent
