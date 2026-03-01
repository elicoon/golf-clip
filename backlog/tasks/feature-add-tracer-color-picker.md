### Add Tracer Color Picker to Export Options Panel
- **Project:** golf-clip
- **Status:** not started
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The tracer color is currently hardcoded to red (#FF0000) in both ClipReview.tsx and the export pipeline. FEATURES.md lists "Multiple Tracer Styles — different colors, effects" as a planned future enhancement. A color picker in ExportOptionsPanel (or the review toolbar) would let users match their brand/channel style. The tracer-renderer.ts `drawTracerLine()` already accepts a `color` parameter, so the rendering layer is ready — only the UI and state wiring is needed. Preset swatches (red, white, yellow, blue) with an "Other" option for custom hex input would cover most use cases without a full color picker library.
- **Added:** 2026-02-28
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] Export options panel shows at least 4 color swatches (red, white, yellow, blue) for tracer color selection
- [ ] Selected color is passed to the export pipeline and reflected in the exported clip
- [ ] Selected color is also applied to the tracer preview in the ClipReview canvas overlay
- [ ] Default color is red (#FF0000) matching current behavior
- [ ] Color selection persists within the session (does not reset between clips)

#### Next steps
1. Read `apps/browser/src/components/ExportOptionsPanel.tsx` and `ClipReview.tsx` to trace how export options flow into the pipeline
2. Add `tracerColor` state to `processingStore.ts` (or as local ClipReview state) defaulting to `#FF0000`
3. Add color swatch row to `ExportOptionsPanel.tsx` with 4 preset colors + optional hex input
4. Wire selected color through to `drawTracerLine()` call in both review canvas and export pass in `video-frame-pipeline-v4.ts`
5. Test by exporting a clip with non-red tracer and verifying output file has correct color
