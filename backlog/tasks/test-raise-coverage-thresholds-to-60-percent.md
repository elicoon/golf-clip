### Write Unit Tests for Uncovered lib/ Modules to Raise Thresholds to 60%
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** test-coverage
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Current CI-enforced thresholds are 51% statements, 65% branches, 44% functions, 51% lines. The functions threshold at 44% indicates several modules have exported functions with no test coverage. Raising thresholds to 60% across the board (targeting functions especially) tightens the quality ratchet and reduces risk of shipping untested code paths. Focus on `lib/` modules which contain the core processing logic.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] Statement coverage threshold raised to at least 60% (from 51%)
- [ ] Function coverage threshold raised to at least 60% (from 44%)
- [ ] Line coverage threshold raised to at least 60% (from 51%)
- [ ] All new tests pass in CI (`npm run test:coverage` exits 0)
- [ ] No test files use `vi.fn()` stubs where real implementations can be tested
- [ ] Coverage gains come from testing actual business logic, not trivial getters/setters

#### Next steps
1. Run `npm run test:coverage` locally and identify the 3-5 `lib/` modules with lowest function coverage
2. Write unit tests for the highest-value uncovered functions (prioritize audio-detector, trajectory-generator, tracer-renderer)
3. After each module's tests pass, re-run coverage to measure improvement
4. Update thresholds in `vite.config.ts` to new floor values (at least 60% for statements, functions, lines)
5. Verify CI passes with the raised thresholds on a test branch
