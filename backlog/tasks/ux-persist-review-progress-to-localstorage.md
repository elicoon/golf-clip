### Persist Review Progress to localStorage to Survive Page Refresh
- **Project:** golf-clip
- **Status:** in progress
- **Dispatched:** 2026-02-21-golf-clip-persist-review-progress
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Users lose all review progress (approved shots, clip boundaries, tracer config) if they refresh the page or close the browser. No localStorage/sessionStorage usage found in codebase. Zustand store is ephemeral. Persist store state to localStorage with auto-save on state changes. Restore on mount. Helps users recover from accidental refreshes during long review sessions.
- **Added:** 2026-02-16
- **Updated:** 2026-02-28

#### Acceptance Criteria
- [ ] processingStore persists to localStorage on state changes (debounced 500ms to avoid thrashing)
- [ ] Store restores from localStorage on app mount if valid data exists
- [ ] Persisted state includes: videos, activeVideoId, segments, approval status, clip boundaries, trajectories
- [ ] Video files (Blob URLs) are NOT persisted (too large, expire anyway)
- [ ] Stale data (>24 hours old) is automatically cleared on mount
- [ ] Test verifies restore from localStorage works correctly
- [ ] Test verifies stale data is cleared

#### Next steps
1. Add localStorage persistence middleware to processingStore using Zustand persist middleware
2. Define persist config: whitelist fields (videos metadata, segments, trajectories), blacklist (videoUrl, rawFile)
3. Add timestamp to persisted state for staleness detection
4. Implement hydration logic on store mount
5. Add debounce to auto-save (prevent excessive localStorage writes during rapid state changes)
6. Add unit tests for persistence and hydration
