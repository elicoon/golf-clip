### Add Tracer Shot Presets for Common Club Types
- **Project:** golf-clip
- **Status:** not started
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Currently users configure tracer height, shape (draw/fade/slice), and flight time manually from scratch on every clip. Adding 4 presets (Driver, Iron, Wedge, Chip) that auto-fill typical values for those shot types would reduce the per-clip setup time significantly. Presets would be defined as static config in TracerConfigPanel and simply call the existing onConfigChange props — no new state management needed.
- **Added:** 2026-02-26
- **Updated:** 2026-02-26

#### Acceptance Criteria
- [ ] TracerConfigPanel displays 4 preset buttons: "Driver", "Iron", "Wedge", "Chip"
- [ ] Clicking a preset applies appropriate height, shape, and flight time values to the tracer config
- [ ] Preset values are defined as a static constant (not hardcoded inline), making them easy to adjust
- [ ] Active preset button is visually highlighted; button highlight clears when user manually adjusts any slider
- [ ] Existing manual slider controls still work unchanged after a preset is applied

#### Next steps
1. Read `apps/browser/src/components/TracerConfigPanel.tsx` to understand the current config shape and props
2. Define a `SHOT_PRESETS` constant with 4 entries (Driver, Iron, Wedge, Chip) mapping to TracerConfig values
3. Add preset buttons above the existing sliders in TracerConfigPanel; on click, call `onConfigChange` with preset values
4. Add visual active state to the selected preset; clear on any manual slider change
5. Add a unit test asserting each preset button applies the correct config values
