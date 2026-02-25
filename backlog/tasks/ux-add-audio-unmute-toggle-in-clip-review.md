### Add Audio Mute/Unmute Toggle Button to Clip Review
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Video playback is auto-muted to satisfy browser autoplay policies. There is a TODO at `ClipReview.audio.test.tsx:113` noting "Add unmute button to UI." Users currently have no way to hear the audio of their golf clips during review, which matters for verifying shot detection accuracy (the audio transient is the detection signal). A simple mute/unmute toggle near the playback controls would solve this.
- **Added:** 2026-02-22
- **Updated:** 2026-02-22

#### Acceptance Criteria
- [ ] Mute/unmute toggle button visible in clip review playback controls area
- [ ] Clicking toggle unmutes video audio; clicking again re-mutes
- [ ] Video starts muted by default (preserving autoplay compatibility)
- [ ] Button visually indicates current mute state (speaker icon with/without strikethrough or similar)
- [ ] Unit test verifies toggle changes video element muted property

#### Next steps
1. Read `apps/browser/src/components/ClipReview.tsx` to find the playback controls section and video element ref
2. Add a muted state to component (or Zustand store if state needs to persist across clips)
3. Add a button with speaker icon (SVG inline or from existing icon set) next to existing playback controls
4. Wire button onClick to toggle `videoRef.current.muted`
5. Add test case in ClipReview test file verifying muted toggle behavior
