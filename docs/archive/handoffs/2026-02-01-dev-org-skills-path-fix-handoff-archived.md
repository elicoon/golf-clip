# Handoff: Fix Dev-Org Skills Path Context

## Mission

Fix dev-org skills so they write artifacts to the correct locations when invoked from non-dev-org projects (like golf-clip). Currently, skills have ambiguous path behavior - some should write to dev-org (personal layer), others should write to the current project.

## Context

- **Project:** dev-org skills (Claude Code plugin)
- **Skills location:** `~/.claude/plugins/cache/dev-org-local/dev-org/1.0.0/skills/`
- **Problem discovered:** When testing golf-clip, bugs were being saved to the wrong location
- **This session:** Analyzed all 14 skills, classified them, and created comprehensive test plan

## What We Learned

### Skill Classification (Key Discovery)

**Personal Layer Skills (Always write to dev-org regardless of cwd):**
- `retro` - lessons, backlog tasks, postmortems
- `review` - memories, lessons, preferences
- `eod` - lessons, memories, preferences + `~/.claude/CLAUDE.md`
- `handoff` - handoff documents

**Project-Aware Skills (Write to current project):**
- `add` - task files go to current project's backlog
- `user-test` - bug reports go to current project's `docs/bugs/`
- `write-plan` - plans go to current project's `docs/plans/`
- `uat` - UAT docs go to current project's `docs/plans/`

### Skills Already Correct
- `retro` (line 340), `handoff` (line 268), `review` (line 382) already have explicit "dev-org repo root" statements

### Skills Needing Updates
| Skill | Line | Change Needed |
|-------|------|---------------|
| `eod` | After 193 | Add "dev-org repo root" statement |
| `add` | After 261 | Clarify "current project root" behavior |
| `user-test` | After 495 | Change output from `{BACKLOG_PATH}/bug-*.md` to `docs/bugs/` |
| `write-plan` | After 148 | Add "current project's `docs/plans/`" statement |
| `uat` | After 220 | Add "current project's `docs/plans/`" statement |

## Current State

- **Done:**
  - Analyzed all 14 dev-org skills
  - Classified each as "personal layer" vs "project-aware"
  - Identified 5 skills needing explicit path statements
  - Created comprehensive test plan with 14 test cases across 4 suites

- **In Progress:** None

- **Not Started:**
  - Edit the 5 skill files to add explicit path statements
  - Run verification tests
  - Optional: Create `.dev-org.yaml` in golf-clip

- **Blocked:** None

## Codebase Context

**Skill files to modify:**
```
~/.claude/plugins/cache/dev-org-local/dev-org/1.0.0/skills/
├── eod/SKILL.md          # Add dev-org-only statement
├── add/SKILL.md          # Update path documentation
├── user-test/SKILL.md    # Change bug output path
├── write-plan/SKILL.md   # Add project-relative statement
└── uat/SKILL.md          # Add project-relative statement
```

**Test locations:**
- Golf-clip: `c:\Users\Eli\projects\golf-clip`
- Dev-org: `c:\Users\Eli\projects\dev-org`

## Recommended Next Action

1. Edit the 5 skill files with the explicit path statements documented in the plan
2. Run the test suite to verify correct behavior

## Open Questions

None - all decisions made:
1. `/dev-org:add` → Project-relative
2. `/dev-org:user-test` → Project's `docs/bugs/`
3. Personal layer → Always dev-org
4. `/dev-org:retro` tasks → Always dev-org

## Full Implementation Plan

The complete plan with all test cases is in the original plan file:
`c:\Users\Eli\.claude\plans\graceful-weaving-candle.md`

This includes:
- Detailed skill classification tables
- Exact line numbers for each edit
- 14 comprehensive test cases across 4 test suites
- Cleanup procedures
- Test results summary template
