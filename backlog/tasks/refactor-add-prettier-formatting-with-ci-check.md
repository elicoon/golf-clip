### Add Prettier Auto-Formatting with CI Format Check
- **Project:** golf-clip
- **Status:** not started
- **Priority:** low
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** ESLint is now enforced in CI for logic/pattern rules, but no code formatter exists. Prettier standardizes whitespace, quotes, semicolons, and line length across the codebase. Adding a CI format-check prevents style drift without requiring developers to think about formatting. Combined with ESLint, this completes the code quality toolchain.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] `prettier` installed as a devDependency in `apps/browser`
- [ ] `.prettierrc` config file exists with project-specific settings (singleQuote, trailingComma, printWidth)
- [ ] `npm run format` script runs Prettier write mode on `src/`
- [ ] `npm run format:check` script runs Prettier check mode (exits non-zero on unformatted files)
- [ ] CI workflow includes `npm run format:check` step before lint
- [ ] All existing source files are formatted (one-time bulk format commit)

#### Next steps
1. Install `prettier` as a devDependency in `apps/browser`
2. Create `.prettierrc` with settings matching current code style (inspect existing files for quote style, semicolons, etc.)
3. Add `format` and `format:check` scripts to `apps/browser/package.json`
4. Run `npm run format` to bulk-format all source files
5. Add `npm run format:check` step to `.github/workflows/test.yml` before the lint step
6. Commit formatted files separately from config changes for clean git history
