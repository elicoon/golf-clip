### Fix 6 ESLint `no-explicit-any` Errors in clip-exporter.test.ts
- **Project:** golf-clip
- **Status:** done
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-24
- **Blockers:** none
- **Notes:** Fixed in commit 25146f5 — replaced `as any` with typed casts in clip-exporter tests.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] `npx eslint apps/browser/src/lib/clip-exporter.test.ts` exits with 0 errors
- [ ] All existing clip-exporter tests still pass (`npx vitest run clip-exporter`)

#### Next steps
1. Read `clip-exporter.ts` to identify the expected type for the ffmpeg parameter
2. Create a typed mock object (or use `as unknown as <Type>`) to replace all 6 `as any` casts
3. Run eslint and vitest to confirm zero errors and all tests pass
