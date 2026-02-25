### Configure Dependabot for Automated npm Dependency Updates
- **Project:** golf-clip
- **Status:** not started
- **Priority:** low
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** No automated dependency management exists. The project depends on actively maintained packages that release security patches and breaking changes: @ffmpeg/ffmpeg 0.12.10, essentia.js 0.1.3, React 18.2.0, Vite 5.0.12, Playwright 1.58.2, mp4-muxer 5.2.2. Without Dependabot, stale dependencies accumulate silently. The existing CI pipeline (lint, build, test, E2E) will validate each Dependabot PR automatically, making this low-risk. Grouped updates keep the PR volume manageable.
- **Added:** 2026-02-25
- **Updated:** 2026-02-25

#### Acceptance Criteria
- [ ] `.github/dependabot.yml` exists with npm ecosystem configuration targeting `apps/browser`
- [ ] Dependabot is configured for weekly update cadence with grouped minor/patch updates
- [ ] Security updates are configured for daily cadence (separate from version updates)
- [ ] At least one Dependabot PR is created by GitHub within 7 days of merging to master

#### Next steps
1. Read `.github/workflows/test.yml` to confirm CI runs on pull requests (Dependabot PRs need automated validation)
2. Create `.github/dependabot.yml` with npm ecosystem config, `apps/browser` directory, weekly schedule, and grouped updates for minor/patch versions
3. Verify the config is valid by pushing to a branch and checking the GitHub Dependabot settings page
4. Confirm first Dependabot PR triggers the CI workflow and tests pass
