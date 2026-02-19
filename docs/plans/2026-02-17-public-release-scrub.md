# Golf-Clip Public Release Scrub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scrub the golf-clip monorepo of internal artifacts and paused apps, then flip the GitHub repo to public as a portfolio/reference project.

**Architecture:** Create a `public-release` branch from `main`, surgically remove internal tooling and paused apps, review the full diff, then merge to `main` and flip public. A `pre-public-archive` tag preserves the full private state permanently.

**Tech Stack:** git, GitHub CLI (`gh`)

---

## Pre-Flight: Verify Starting State

Before anything, confirm you're working from `main` (not a feature branch).

```bash
cd /home/eli/projects/golf-clip
git status
git branch --show-current
```

Expected: clean working tree, on `main`. If on a feature branch, switch first:
```bash
git checkout main
git pull
```

---

### Task 1: Create Safety Tag

**Files:** none (git metadata only)

**Step 1: Create the archive tag**

```bash
git tag pre-public-archive
```

**Step 2: Verify tag exists**

```bash
git tag | grep pre-public-archive
```
Expected: `pre-public-archive`

**Step 3: Push tag to remote**

```bash
git push origin pre-public-archive
```
Expected: `* [new tag] pre-public-archive -> pre-public-archive`

---

### Task 2: Create the public-release Branch

**Step 1: Create and switch to branch**

```bash
git checkout -b public-release
```

**Step 2: Verify you're on the right branch**

```bash
git branch --show-current
```
Expected: `public-release`

---

### Task 3: Remove Paused Apps

**Step 1: Remove apps/webapp/**

```bash
git rm -r apps/webapp/
```

**Step 2: Remove packages/**

```bash
git rm -r packages/
```

**Step 3: Verify removals staged**

```bash
git status | head -30
```
Expected: many `deleted:` entries for `apps/webapp/` and `packages/`

**Step 4: Commit**

```bash
git commit -m "chore: remove paused webapp and packages from public tree"
```

---

### Task 4: Remove Internal Tooling Files

**Step 1: Remove .claude/ directory**

```bash
git rm -r .claude/
```

**Step 2: Remove root CLAUDE.md**

```bash
git rm CLAUDE.md
```

**Step 3: Remove backlog directories**

```bash
git rm -r backlog/
```

Check if apps/browser/backlog/ exists and remove if so:
```bash
ls apps/browser/backlog/ 2>/dev/null && git rm -r apps/browser/backlog/ || echo "not present"
```

**Step 4: Remove internal planning files**

```bash
git rm PARALLEL_TASKS.md phase_2_plan.md
```

If either doesn't exist, skip it (no error needed).

**Step 5: Verify staged**

```bash
git status | grep "deleted:"
```

**Step 6: Commit**

```bash
git commit -m "chore: remove internal tooling (.claude, CLAUDE.md, backlog, planning files)"
```

---

### Task 5: Remove Internal Docs

**Step 1: Remove docs/archive/**

```bash
git rm -r docs/archive/
```

**Step 2: Remove docs/plans/**

```bash
git rm -r docs/plans/
```

**Step 3: Verify staged**

```bash
git status | grep "deleted:"
```

**Step 4: Commit**

```bash
git commit -m "chore: remove internal docs (archive, plans)"
```

---

### Task 6: Check for Remaining Artifacts

Scan for anything else that looks internal before reviewing.

**Step 1: Check scripts/ directory**

```bash
ls -la scripts/ 2>/dev/null || echo "empty or missing"
```

If scripts/ contains only internal/dev scripts with no public value, remove:
```bash
git rm -r scripts/
git commit -m "chore: remove internal scripts"
```
If scripts/ is empty or not tracked, skip.

**Step 2: Check src/ directory**

```bash
ls -la src/ 2>/dev/null || echo "empty or missing"
```

If it's legacy backend code superseded by `apps/desktop/`, remove:
```bash
git rm -r src/
git commit -m "chore: remove legacy src directory"
```

**Step 3: Check tests/ directory at root**

```bash
ls -la tests/ 2>/dev/null || echo "empty or missing"
```

If tests/ references removed code (desktop backend, webapp), remove:
```bash
git rm -r tests/
git commit -m "chore: remove root-level tests for removed code"
```

**Step 4: Check for any remaining .md planning files at root**

```bash
ls *.md
```

Expected to remain: `README.md`, `CONTRIBUTING.md`, `PRD.md`, `LICENSE`
If `PARALLEL_TASKS.md`, `phase_2_plan.md`, or other internal docs still show up, remove them.

---

### Task 7: Scan for Sensitive Content in Committed Files

**Step 1: Search for common secret patterns in tracked files**

```bash
git grep -i "api_key\|secret\|password\|token\|private_key" -- "*.ts" "*.tsx" "*.py" "*.json" "*.yaml" "*.yml" | grep -v "node_modules" | grep -v ".git"
```

Review any hits. False positives (e.g., variable names like `api_key` in API docs) are fine. Real secrets are not.

**Step 2: Search for hardcoded URLs that might be personal**

```bash
git grep -i "supabase\.co\|fly\.dev\|vercel\.app" -- "*.ts" "*.tsx" "*.py" "*.md"
```

Review hits:
- Supabase URL in docs/code: acceptable (it's a publishable anon key setup)
- Production URLs like `browser-seven-sigma.vercel.app`: check if you want this public

**Step 3: Verify no .env files are tracked**

```bash
git ls-files | grep "\.env"
```

Expected: no output. If any `.env` files appear, remove them immediately:
```bash
git rm <file>
git commit -m "chore: remove accidentally tracked env file"
```

---

### Task 8: Review the Full Diff

This is the critical review step before merging.

**Step 1: See what's different from main**

```bash
git diff main...public-release --stat
```

Review the file counts — you should see mostly `deleted` files, nothing unexpected modified.

**Step 2: Browse the diff for any surprises**

```bash
git diff main...public-release -- "*.md"
```

Check that README.md, CONTRIBUTING.md, PRD.md, ARCHITECTURE.md, etc. look clean and public-facing.

**Step 3: Verify what remains in the tree**

```bash
git ls-files | grep -v "^apps/browser\|^apps/desktop\|^docs/\|^README\|^LICENSE\|^CONTRIBUTING\|^PRD\|^package\|^pyproject\|^vercel\|^\.gitignore\|^\.vercelignore\|^\.dockerignore"
```

Review any unexpected files that show up.

---

### Task 9: Update ARCHITECTURE.md if Needed

The `docs/ARCHITECTURE.md` mentions `apps/webapp/` and `packages/` as "PAUSED" in the monorepo structure section. Since these are being removed from the tree, the architecture doc should reflect the public scope.

**Step 1: Check the monorepo structure section**

Open `docs/ARCHITECTURE.md` and find the "Monorepo Structure" section (around line 50-80).

**Step 2: Update to reflect current public structure**

Remove references to `apps/webapp/`, `packages/frontend/`, `packages/detection/`, `packages/api-schemas/` from the directory tree, or add a note that those are not included in this release.

**Step 3: Commit if changed**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: update architecture to reflect public repo scope"
```

---

### Task 10: Merge to Main and Go Public

Only proceed after Task 8 review is clean.

**Step 1: Switch to main**

```bash
git checkout main
```

**Step 2: Merge public-release**

```bash
git merge public-release --no-ff -m "chore: scrub repo for public release"
```

**Step 3: Verify the state of main looks right**

```bash
git log --oneline -5
ls -la
ls apps/
```

Expected: `apps/browser/` and `apps/desktop/` only. No `webapp/` or `packages/`.

**Step 4: Push main**

```bash
git push origin main
```

**Step 5: Flip repo to public on GitHub**

```bash
gh repo edit elicoon/golf-clip --visibility public
```

When prompted to confirm: type `y`.

**Step 6: Verify it's public**

```bash
gh repo view elicoon/golf-clip --json visibility -q '.visibility'
```

Expected: `PUBLIC`

**Step 7: View the public repo**

```bash
gh repo view elicoon/golf-clip --web
```

Check the README renders well, the file tree looks clean, and no internal artifacts are visible.

---

## Done Criteria

- [ ] `pre-public-archive` tag exists on remote
- [ ] `apps/webapp/` not in main tree
- [ ] `packages/` not in main tree
- [ ] `.claude/`, `CLAUDE.md`, `backlog/` not in main tree
- [ ] `docs/archive/` and `docs/plans/` not in main tree
- [ ] No committed `.env` files
- [ ] No hardcoded secrets in tracked files
- [ ] GitHub repo visibility is PUBLIC
- [ ] README renders correctly on the public repo page
