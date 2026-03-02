### Show post-export download summary with shot count and file details
- **Project:** golf-clip
- **Status:** not started
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** After all clips are exported, users see an "export-complete" inline view in App.tsx. Currently unclear if this view shows which files were downloaded, how many shots were exported, or total clip duration. A clear summary (e.g., "3 clips exported: shot_1.mp4 10s, shot_2.mp4 8s, shot_3.mp4 12s — 30s total") reassures users their export completed successfully and reduces "did it work?" uncertainty. Particularly useful when exporting 10+ shots from a long round video.
- **Added:** 2026-03-01
- **Updated:** 2026-03-01

#### Acceptance Criteria
- [ ] Export-complete view shows count of clips exported (e.g., "3 clips downloaded")
- [ ] Each exported clip is listed with its shot number and clip duration in seconds
- [ ] Total combined duration of all exported clips is shown
- [ ] "Export Another Video" / "Start Over" action is available from this screen

#### Next steps
1. Read App.tsx export-complete view section to see what data is currently displayed
2. Check what segment metadata is available in the Zustand store at export time (clip duration, shot numbers, approved status)
3. Add a summary list component below the existing export-complete UI using available segment data
