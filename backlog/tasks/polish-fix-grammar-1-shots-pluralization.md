### Fix "1 shots" Grammar Error — Pluralization Throughout UI
- **Project:** golf-clip
- **Status:** done
- **Priority:** low
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** User testing flagged "1 shots detected" and similar grammar errors appearing in multiple places (header, processing view, review screen). Simple pluralization fix — use "1 shot" vs "N shots" conditionally. Appears unpolished to users.
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [ ] All instances of shot count display use correct pluralization ("1 shot" not "1 shots")
- [ ] Fix covers at minimum: processing completion message, review header counter, and export summary
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. Grep `apps/browser/src/` for string patterns like `shots` preceded by a count variable (e.g., template literals with `${count} shots`)
2. Replace with a helper like `${count} ${count === 1 ? 'shot' : 'shots'}` or extract a `pluralize(count, 'shot')` utility
3. Verify all instances are fixed by searching for remaining hardcoded "shots" strings with numeric prefixes
