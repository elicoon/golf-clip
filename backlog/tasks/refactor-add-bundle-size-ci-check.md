### Add Bundle Size CI Check to Prevent JS Bundle Growth Regressions
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-26
- **Blockers:** none
- **Notes:** The app loads FFmpeg WASM, Essentia.js, YOLO model weights, and React — a large dependency surface. Without a bundle size budget, future PRs can quietly add heavy transitive dependencies that degrade load time. `size-limit` (by Evil Martians) integrates with GitHub Actions to measure and enforce JS bundle limits on every PR, posting a comment with size changes. This complements the Lighthouse CI gate by catching bundle bloat before it affects runtime performance. Baseline should be measured from current build and thresholds set with ~20% headroom.
- **Added:** 2026-02-26
- **Updated:** 2026-02-27

#### Acceptance Criteria
- [x] `size-limit` installed as devDependency in `apps/browser/package.json`
- [x] `.size-limit.json` config committed with at least one entry measuring the main JS bundle
- [x] `size-limit` step added to `.github/workflows/test.yml` that fails if bundle exceeds threshold
- [x] PR comment showing size delta posted by size-limit action on each PR (or stdout report in CI log)
- [x] Current baseline measured and threshold set with 20% headroom documented in config

#### Next steps
1. Run `npm run build` in `apps/browser`, measure `dist/assets/*.js` total gzipped size
2. Install `@size-limit/preset-app` and `size-limit` devDependencies
3. Create `.size-limit.json` with `path: "dist/assets/*.js"` and `limit` set to current size + 20%
4. Add `size-limit` job to `.github/workflows/test.yml` (build → `npx size-limit`)
