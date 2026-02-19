### Replace console.log with Structured Logging in Browser App
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** 45 console.log/error/warn statements across 7 files (streaming-processor, ffmpeg-client, feedback-service, audio-detector, video-frame-pipeline-v4, TrajectoryEditor.bounds.test, ClipReview). Production apps should use structured logging (timestamp, level, context) for debugging. Create logger module with dev/prod modes: verbose in dev, silent in prod unless debug flag enabled.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] src/lib/logger.ts created with log levels (debug, info, warn, error) and context fields
- [ ] Logger respects import.meta.env.PROD mode (silent in production by default)
- [ ] All 45 console statements replaced with logger calls
- [ ] Logger includes timestamp, level, message, and optional context object
- [ ] Test coverage for logger (dev/prod mode, log levels, context formatting)

#### Next steps
1. Create src/lib/logger.ts with createLogger() factory and log level methods
2. Replace console.log in streaming-processor.ts (1 occurrence)
3. Replace console statements in ffmpeg-client.ts (7 occurrences)
4. Replace console statements in feedback-service.ts (4 occurrences)
5. Replace console statements in audio-detector.ts (1 occurrence)
6. Replace console statements in video-frame-pipeline-v4.ts (13 occurrences)
7. Replace console statements in TrajectoryEditor.bounds.test.tsx (13 occurrences - keep for test debugging)
8. Replace console statements in ClipReview.tsx (6 occurrences)
9. Add unit tests for logger
