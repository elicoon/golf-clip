### Add Pre-commit Hooks with Husky and lint-staged
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** ESLint and Prettier are configured but only enforced in CI. A developer can commit unformatted or lint-failing code and only discover it when the PR pipeline fails. Adding husky + lint-staged enforces checks at commit time, catching issues immediately and reducing CI feedback loops. This is the natural completion of the code quality toolchain established in the recent ESLint/Prettier work.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] `npx husky` is installed and `.husky/pre-commit` hook exists
- [ ] lint-staged runs ESLint and Prettier on staged `.ts` and `.tsx` files
- [ ] Committing a file with a lint error is blocked by the pre-commit hook
- [ ] Committing a properly formatted file succeeds without intervention
- [ ] CI continues to run full lint/format checks as a safety net

#### Next steps
1. Install husky and lint-staged as devDependencies in the root package.json
2. Run `npx husky init` to create `.husky/` directory with pre-commit hook
3. Configure lint-staged in package.json to run `eslint --fix` and `prettier --write` on staged `*.ts` and `*.tsx` files
4. Wire the pre-commit hook to run `npx lint-staged`
5. Test by committing a file with intentional lint error — verify it's blocked
6. Test by committing a clean file — verify it passes
