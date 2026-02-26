### Code-Split Single JS Bundle Using React.lazy to Eliminate 91 KiB Unused JavaScript
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** refactor
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Lighthouse audit (2026-02-25) found 91.3 KiB of unused JS on the landing page — 72% of the 127.3 KiB single bundle. The entire app (video processing, shot detection, clip review, canvas rendering, export) ships in one chunk. Only the VideoDropzone landing page is needed initially. Code-splitting along page boundaries with React.lazy + Suspense would reduce initial JS to ~35 KiB, improving FCP/LCP on slow connections and eliminating Lighthouse's only performance flag. FFmpeg WASM already loads on demand, so this focuses on the React component tree.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] Landing page loads with < 50 KiB of JavaScript (excluding FFmpeg WASM)
- [ ] ClipReview, TrajectoryEditor, and ClipExporter components are lazy-loaded via React.lazy
- [ ] Suspense fallback shows a loading indicator during chunk fetch
- [ ] Lighthouse `unused-javascript` audit passes (no single-resource waste > 20 KiB)
- [ ] All existing E2E tests pass without modification
- [ ] Vite build output shows at least 3 separate chunks (landing, review, export)

#### Next steps
1. Read `apps/browser/src/App.tsx` (or main router) to identify the component tree and route boundaries
2. Wrap ClipReview, TrajectoryEditor, and export-related components with `React.lazy(() => import(...))`
3. Add `<Suspense fallback={<LoadingSpinner />}>` around lazy-loaded routes
4. Run `npx vite build` and verify chunk splitting in build output
5. Run Lighthouse on dev build to confirm unused-javascript reduction
6. Run full E2E suite to verify no regressions
