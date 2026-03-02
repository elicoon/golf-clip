### Process multiple queued videos in parallel
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** When multiple videos are uploaded, they are processed sequentially (one FFmpeg WASM instance at a time). The Zustand store already models state as Map<VideoId, VideoState> to support parallel processing (architecture comment in processingStore.ts says "independent parallel processing"). For golfers uploading a full 18-hole round (18+ videos), sequential processing means the last video doesn't start until all previous ones finish. Allowing 2–3 videos to process in parallel (FFmpeg WASM can be instantiated multiple times) would significantly reduce total wait time. Needs careful concurrency management to avoid OOM with large videos.
- **Added:** 2026-03-01
- **Updated:** 2026-03-01

#### Acceptance Criteria
- [ ] At least 2 uploaded videos begin FFmpeg audio extraction concurrently (verified via VideoQueue progress bars advancing simultaneously)
- [ ] Completed videos transition to review state independently without waiting for other videos to finish
- [ ] No OOM/crash observed when processing 3 simultaneous 1080p videos on a standard laptop
- [ ] Sequential fallback is available if concurrency limit is exceeded (queue at max N parallel)

#### Next steps
1. Read VideoDropzone.tsx and processingStore.ts to trace the current sequential processing trigger flow
2. Identify the FFmpeg WASM init and audio extraction calls — determine if multiple instances can run simultaneously
3. Implement a concurrency pool (max 2–3 parallel) that kicks off the next video when a slot opens
