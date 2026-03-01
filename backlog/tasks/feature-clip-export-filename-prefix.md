### Add Customizable Filename Prefix for Exported Clips
- **Project:** golf-clip
- **Status:** in progress
- **Dispatched:** 2026-02-26-golf-clip-clip-export-filename-prefix
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Currently exported clips are saved with a generic or auto-generated filename. Users processing multiple rounds have no way to tag clips by hole number, club, date, or location before downloading. Adding a short text input in the export flow for a filename prefix (e.g. "hole7-driver") would make the downloaded files immediately identifiable without manual renaming. The prefix can be prepended to the existing generated filename and persisted in sessionStorage for the duration of the session.
- **Added:** 2026-02-26
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] A text input labeled "Clip name prefix" (or similar) appears in the export UI before the Export button
- [ ] The entered prefix is prepended to the downloaded filename (e.g. "hole7-driver_shot_1.mp4")
- [ ] Input is optional — empty prefix results in the existing filename behavior unchanged
- [ ] Prefix value is stored in sessionStorage and restored when returning to the export panel in the same session
- [ ] Input only allows alphanumeric characters, hyphens, and underscores (invalid characters stripped or blocked)

#### Next steps
1. Read `apps/browser/src/components/ClipReview.tsx` and `ExportOptionsPanel.tsx` to find where the filename is constructed and the download is triggered
2. Add a controlled text input for the filename prefix in the export UI with character sanitization (replace invalid chars with -)
3. Wire the prefix value into the filename construction at the download trigger
4. Persist prefix in sessionStorage on change; restore it on mount
5. Add a unit test asserting the filename is correctly prefixed and that invalid characters are sanitized
