# Lighthouse CI Gates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Lighthouse CI job to GitHub Actions that fails PRs when performance, accessibility, best practices, or SEO scores drop below configured thresholds.

**Architecture:** Install `@lhci/cli` in the browser app workspace, configure it via `lighthouserc.js` with score assertions, and add a `lighthouse` job to the existing GitHub Actions workflow. The job runs after `test` (which builds the app), starts `vite preview` in the background, runs `lhci autorun`, and uploads the HTML report as an artifact.

**Tech Stack:** `@lhci/cli`, GitHub Actions, `vite preview` (port 4173), YAML

---

### Task 1: Install @lhci/cli dev dependency

**Files:**
- Modify: `apps/browser/package.json`
- Modify: `package-lock.json` (auto-updated)

**Step 1: Install the package**

```bash
npm install -D @lhci/cli -w apps/browser
```

**Step 2: Verify it's in package.json**

```bash
grep lhci apps/browser/package.json
```

Expected: `"@lhci/cli": "^0.x.x"` in `devDependencies`.

**Step 3: Commit**

```bash
git add apps/browser/package.json package-lock.json
git commit -m "chore: add @lhci/cli dev dependency"
```

---

### Task 2: Create lighthouserc.js config

**Files:**
- Create: `apps/browser/lighthouserc.js`

**Step 1: Create the config file**

```js
// apps/browser/lighthouserc.js
export default {
  ci: {
    collect: {
      url: ['http://localhost:4173'],
      numberOfRuns: 1,
      settings: {
        // Required for apps using SharedArrayBuffer (COEP/COOP headers)
        chromeFlags: '--no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.85 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
}
```

**Step 2: Verify the file was created**

```bash
cat apps/browser/lighthouserc.js
```

**Step 3: Commit**

```bash
git add apps/browser/lighthouserc.js
git commit -m "chore: add Lighthouse CI config with score thresholds"
```

---

### Task 3: Add lighthouse job to GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/test.yml`

**Step 1: Add the lighthouse job**

Append this job to `.github/workflows/test.yml` after the `e2e` job:

```yaml
  lighthouse:
    runs-on: ubuntu-latest
    needs: test
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - run: npm run build

      - name: Start vite preview in background
        run: npx vite preview &
        working-directory: apps/browser

      - name: Wait for preview server
        run: npx wait-on http://localhost:4173 --timeout 30000

      - name: Run Lighthouse CI
        run: npx lhci autorun --config=lighthouserc.js
        working-directory: apps/browser

      - name: Upload Lighthouse report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: lighthouse-report
          path: apps/browser/.lighthouseci/
          retention-days: 14
```

**Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

**Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "feat: add Lighthouse CI job to GitHub Actions workflow"
```

---

### Task 4: Local verification (smoke test)

This step verifies the config is sane before pushing. Run in the project root.

**Step 1: Build the app**

```bash
npm run build -w apps/browser
```

**Step 2: Start vite preview in one terminal**

```bash
npx vite preview --host
```

Expected: `Local: http://localhost:4173/`

**Step 3: In a second terminal, run lhci autorun**

```bash
cd apps/browser && npx lhci autorun --config=lighthouserc.js
```

Expected output includes scores >= thresholds and no assertion errors.

**Step 4: Inspect generated report**

```bash
ls apps/browser/.lighthouseci/
```

Expected: HTML report file present.

**Step 5: Add .lighthouseci/ to .gitignore**

```bash
echo '.lighthouseci/' >> .gitignore
git add .gitignore
git commit -m "chore: ignore local .lighthouseci/ output"
```

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 5: Code Review

**Invoke:** `/claude-code-skills:code-review`

Review all implementation work for:
- Conventional commits (feat/fix/docs/chore prefixes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Documentation updated where needed

**Expected:** All issues addressed before proceeding.

### Task 6: Feature Testing

**Invoke:** `/claude-code-skills:test-feature Lighthouse CI gates`

Test the complete user experience:
- `lighthouserc.js` assertions correctly configured
- Workflow YAML is valid and all steps are correct
- `needs: test` dependency is set on the lighthouse job
- Artifact upload is unconditional (`if: always()`)

**Expected:** All tests pass with evidence (actual output shown).

### Task 7: Final Commit

After verification passes:

```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
