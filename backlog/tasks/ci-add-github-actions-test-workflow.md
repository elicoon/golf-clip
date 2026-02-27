### Add GitHub Actions workflow to run unit tests on pull requests
- **Project:** golf-clip
- **Status:** done
- **Priority:** high
- **Type:** test-coverage
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** No CI/CD pipeline exists — 26 unit test files only run locally. PRs (e.g., #23) get merged without automated test verification. A basic workflow running `npm test` on PR and push to master would catch regressions before merge.
- **Added:** 2026-02-22
- **Updated:** 2026-02-27

#### Acceptance Criteria
- [ ] `.github/workflows/test.yml` exists and runs `npm test` on pull_request and push-to-master events
- [ ] Workflow installs dependencies with `npm ci` and runs `npm run build` before tests
- [ ] PR #23 (or a test PR) shows a green/red check from the workflow
- [ ] Workflow completes in under 3 minutes for the current test suite

#### Next steps
1. Create `.github/workflows/test.yml` with Node 20 matrix, `npm ci`, `npm run build`, `npm test`
2. Push to a branch, open a test PR, and verify the check appears and passes
3. Optionally add a badge to README.md
