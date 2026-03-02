### Add tracer color picker UI to TracerConfigPanel
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The TracerStyle type, DEFAULT_TRACER_STYLE, and onStyleChange callback are fully implemented (types/tracer.ts, ClipReview.tsx:427, TracerConfigPanel.tsx:11), but TracerConfigPanel destructures onStyleChange as _onStyleChange (unused). No UI is exposed for users to change tracer color. The default is red (#FF4444). Adding a simple color swatch row (e.g., red, white, yellow, blue, green presets) in TracerConfigPanel would let users match tracer color to their YouTube channel style. The infrastructure is already wired — just the UI component is missing.
- **Added:** 2026-03-01
- **Updated:** 2026-03-01

#### Acceptance Criteria
- [ ] TracerConfigPanel shows at least 4 color presets (e.g., red, white, yellow, blue)
- [ ] Selecting a color updates the tracer overlay in the review canvas immediately
- [ ] Selected color is reflected in the exported video clip
- [ ] onStyleChange callback is called with updated TracerStyle (replaces _onStyleChange no-op)

#### Next steps
1. Read TracerConfigPanel.tsx to understand the current panel layout and where to insert the color row
2. Add a color swatch row above or below the existing controls, calling onStyleChange with the chosen color
3. Update corresponding glow color to match (glowColor should be a lighter tint of the chosen color)
