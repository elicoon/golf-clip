# Handoff: Dev-Org Skills Path Fix - Testing Phase

## Mission

Run the test suite to verify dev-org skills write artifacts to the correct locations (project vs dev-org).

## Context

- **Project:** golf-clip (testing dev-org skills from here)
- **Skills location:** `~/.claude/plugins/cache/dev-org-local/dev-org/1.0.0/`
- **Previous session:** Edited 5 skill files, disabled `disable-model-invocation` for 3 commands

## What's Done

### Skill File Edits (5 files)
| Skill | Change |
|-------|--------|
| `eod/SKILL.md` | Added "dev-org repo root" statement (personal layer) |
| `add/SKILL.md` | Changed to "current project root" (project-aware) |
| `user-test/SKILL.md` | Changed output to `docs/bugs/` (project-aware) |
| `write-plan/SKILL.md` | Added project-relative statement |
| `uat/SKILL.md` | Added project-relative statement |

### Command File Edits (3 files)
Set `disable-model-invocation: false` in:
- `commands/add.md`
- `commands/review.md`
- `commands/write-plan.md`

## Your Job

Run these tests from `c:\Users\Eli\projects\golf-clip`:

### Test 1.1: `/dev-org:add` (Project-Aware)
```
/dev-org:add TEST-CLEANUP: Test task from golf-clip
```
**Expected:** Task created in golf-clip's backlog (not dev-org)
**Verify:** `dir docs\tasks\*test*` or `dir backlog\tasks\*test*`

### Test 2.2: `/dev-org:review` (Personal Layer)
```
/dev-org:review
```
Capture a test learning: "TEST-CLEANUP: Learned about path handling"
**Expected:** Entry in dev-org/reference/ (not golf-clip)
**Verify:** Check `c:\Users\Eli\projects\dev-org\reference\lessons\` or `memories\`

### Test 1.4: `/dev-org:write-plan` (Project-Aware)
```
/dev-org:write-plan
```
Create a minimal test plan named "TEST-CLEANUP-feature"
**Expected:** Plan in golf-clip's `docs/implementation-plans/`
**Verify:** `dir docs\implementation-plans\*test-cleanup*`

## Test Results Template

Update [docs/test-reports/2026-02-01-dev-org-path-fix-tests.md](docs/test-reports/2026-02-01-dev-org-path-fix-tests.md) with results.

## Cleanup After Tests

```bash
# Golf-clip
del docs\tasks\*test-cleanup* 2>nul
del backlog\tasks\*test-cleanup* 2>nul
del docs\implementation-plans\*test-cleanup* 2>nul

# Dev-org (manual - remove TEST-CLEANUP entries)
```

## Success Criteria

- `/dev-org:add` → golf-clip's backlog ✓
- `/dev-org:review` → dev-org's reference layer ✓
- `/dev-org:write-plan` → golf-clip's docs/implementation-plans/ ✓
