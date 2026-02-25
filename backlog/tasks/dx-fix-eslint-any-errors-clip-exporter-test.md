### Fix 6 ESLint `no-explicit-any` Errors in clip-exporter.test.ts
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** `apps/browser/src/lib/clip-exporter.test.ts` has 6 `@typescript-eslint/no-explicit-any` errors on lines 24, 56, 79, 102, 126, 152. All are `mockFfmpeg as any` casts. These block clean lint runs and will cause pre-commit hook failures when staging changes to this file. Fix by creating a typed mock interface or using `as unknown as FfmpegClient` pattern.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] `npx eslint apps/browser/src/lib/clip-exporter.test.ts` exits with 0 errors
- [ ] All existing clip-exporter tests still pass (`npx vitest run clip-exporter`)

#### Next steps
1. Read `clip-exporter.ts` to identify the expected type for the ffmpeg parameter
2. Create a typed mock object (or use `as unknown as <Type>`) to replace all 6 `as any` casts
3. Run eslint and vitest to confirm zero errors and all tests pass
