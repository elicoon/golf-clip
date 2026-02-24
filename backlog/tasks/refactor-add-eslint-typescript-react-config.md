### Add ESLint with TypeScript and React Hooks Plugins
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** No JavaScript/TypeScript linter exists — TypeScript strict mode is the only static analysis. ESLint catches issues TypeScript misses: unused imports, React hooks dependency arrays, exhaustive-deps violations, accessibility attributes, and code patterns. Adding ESLint now prevents accumulating lint debt as the codebase grows.
- **Added:** 2026-02-23
- **Updated:** 2026-02-23

#### Acceptance Criteria
- [ ] ESLint config exists at `apps/browser/.eslintrc.cjs` (or `eslint.config.js`) with `@typescript-eslint/eslint-plugin` and `eslint-plugin-react-hooks` enabled
- [ ] `npm run lint` script works in browser workspace and exits 0 with no errors
- [ ] CI workflow runs lint step (add to `.github/workflows/test.yml`)
- [ ] Any auto-fixable violations are fixed; remaining violations documented with inline `eslint-disable` comments and justification

#### Next steps
1. Install `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-plugin-react-hooks` as devDependencies in `apps/browser`
2. Create ESLint config extending `plugin:@typescript-eslint/recommended` and `plugin:react-hooks/recommended`
3. Run `npx eslint src/ --ext .ts,.tsx` and fix or suppress all violations
4. Add `"lint": "eslint src/ --ext .ts,.tsx"` to `apps/browser/package.json` scripts
5. Add lint step to CI workflow after build
