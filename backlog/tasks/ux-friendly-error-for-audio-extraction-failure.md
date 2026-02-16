### Show Descriptive Error When Audio Extraction Fails
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** User testing (UT v1, issue #1) found that uploading a video without an audio track produces a cryptic "FFmpeg failed with exit code 1" error. Users need a human-readable message explaining that the video has no audio track, which is required for shot detection. This is a browser-side FFmpeg.js error that surfaces in the processing pipeline.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] When audio extraction fails (no audio track or corrupt audio), the error message displayed to the user says something like "This video has no audio track. GolfClip needs audio to detect golf shots." instead of a raw FFmpeg error code
- [ ] The error is shown in the existing error UI area (the `app-error` div in App.tsx) with a "Try Again" button
- [ ] Processing status is set to 'error' so the UI transitions correctly
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. In the audio extraction step of the processing pipeline (likely in `streaming-processor.ts` or `audio-detector.ts`), catch FFmpeg errors and check for audio-stream-related failures
2. Map the FFmpeg exit code or error message to a user-friendly string
3. Propagate the friendly error message through the processing store's `error` state
