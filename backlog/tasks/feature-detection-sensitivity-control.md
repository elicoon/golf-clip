### Add detection sensitivity preset control to VideoDropzone UI
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** audio-detector.ts has a `DetectionConfig.sensitivity` field (line 51: `sensitivity: number // 0-1, higher = more detections`) with default 0.5. This parameter adjusts the detection threshold (line 152: `threshold = 0.1 - cfg.sensitivity * 0.08`). However, streaming-processor.ts calls `detectStrikes(audioData, SAMPLE_RATE)` without passing any config — sensitivity is always 0.5. Users with quiet videos (filmed outdoors in wind, from a distance) get 0 detections and have no recourse. Adding a Low/Medium/High sensitivity preset to the VideoDropzone UI, threaded through to `detectStrikes`, gives users a retry path without reloading the page.
- **Added:** 2026-03-02
- **Updated:** 2026-03-02

#### Acceptance Criteria
- [ ] VideoDropzone renders a sensitivity toggle with at least 3 presets: Low (0.3), Medium (0.5), High (0.8)
- [ ] Sensitivity value is passed through `processVideoFile()` in streaming-processor.ts and forwarded to each `detectStrikes()` call
- [ ] Re-uploading the same file with a different sensitivity produces a different shot count when shots are near the threshold
- [ ] Default selection is "Medium" — existing behavior unchanged when not changed by user
- [ ] Sensitivity control is shown before/during upload, not after processing completes

#### Next steps
1. Add `sensitivity?: number` to `ProcessVideoFileOptions` in streaming-processor.ts and thread it into each `detectStrikes(audioData, SAMPLE_RATE, { sensitivity })` call
2. Add sensitivity state (default 0.5) to VideoDropzone component; render a 3-option radio/toggle above the dropzone
3. Pass the selected sensitivity to `processFileInBackground()` → `processVideoFile()`
