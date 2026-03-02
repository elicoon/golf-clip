### Remove legacy single-video store fallback paths from App.tsx and ClipReview.tsx
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The app maintains two parallel code paths: the legacy single-video store (`status`, `segments`, `addStrike`, `addSegment` flat fields on ProcessingState) and the current multi-video Map (`videos: Map<VideoId, VideoState>`). App.tsx has dual useEffect hooks for both paths (lines 31–41). ClipReview.tsx wraps every store action in conditionals routing to either `legacySegments`/`legacyUpdateSegment` or `activeVideo.segments`/`updateVideoSegment` (lines 21–60, ~40 lines of adapter code). All active usage now goes through the multi-video path via VideoQueue. Removing the legacy fallback reduces code complexity, eliminates the risk of the two paths diverging, and makes future store changes easier. The single-video fields can be removed from ProcessingState once all consumers are confirmed to use multi-video.
- **Added:** 2026-03-02
- **Updated:** 2026-03-02

#### Acceptance Criteria
- [ ] ClipReview.tsx has no `legacy` prefixed variables or legacy branch conditionals
- [ ] App.tsx has one useEffect for auto-transition to review (multi-video path only)
- [ ] processingStore.ts legacy flat fields (`status`, `segments`, `addStrike`, `addSegment`, `approveSegment`, `rejectSegment`) are removed or clearly marked internal-only if still needed for backward compat
- [ ] All unit tests pass with the simplified store interface
- [ ] E2E tests (upload → review → export flow) pass end-to-end after removal

#### Next steps
1. Audit all consumers of legacy store fields: grep for `useProcessingStore` calls referencing `status`, `segments`, `addStrike`, `addSegment` outside of VideoDropzone/streaming-processor
2. Verify that all active code paths (VideoDropzone → VideoQueue → ClipReview) exclusively use the multi-video `videos` Map
3. Remove legacy wrapper functions from ClipReview.tsx; update App.tsx to single useEffect; remove legacy fields from processingStore.ts; run vitest + E2E to confirm
