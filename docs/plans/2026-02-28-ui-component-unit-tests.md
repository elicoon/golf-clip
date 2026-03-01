# Plan: UI Component Unit Tests

**Date:** 2026-02-28
**Branch:** test/axe-core-accessibility-spec (add commits here)
**Dispatch:** /home/eli/dev-org/docs/handler-dispatches/2026-02-28-golf-clip-ui-component-unit-tests.md

## Components to Test

| Component | Key Dependencies | Test Focus |
|-----------|-----------------|------------|
| ExportOptionsPanel | `detectGpuCapabilities`, `getExportOptions` (async) | auto-select recommended option, resolution change, export button |
| TracerConfigPanel | none (pure props) | height/shape button callbacks, flight-time slider |
| ConfirmDialog | none (pure props) | confirm/cancel button callbacks, Escape key |
| VideoQueue | `useProcessingStore` Zustand hook | status labels, empty state |
| WalkthroughSteps | none (no props, static) | step labels present in DOM |

## Mocking Strategy

- **ExportOptionsPanel**: `vi.mock('../lib/gpu-detection', ...)` — mock both `detectGpuCapabilities` and `getExportOptions`
- **VideoQueue**: `vi.mock('../stores/processingStore', ...)` — mock `useProcessingStore` to return controlled video list
- **TracerConfigPanel**: no mocks needed; renders with controlled props
- **ConfirmDialog**: no mocks needed; renders with controlled props
- **WalkthroughSteps**: no mocks needed; zero props

## Test File Locations

All in `apps/browser/src/components/`:
- `ExportOptionsPanel.test.tsx`
- `TracerConfigPanel.test.tsx`
- `ConfirmDialog.test.tsx`
- `VideoQueue.test.tsx`
- `WalkthroughSteps.test.tsx`

## Pattern Reference

From `ClipReview.test.tsx`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
expect.extend(matchers)
```

## Tasks

1. [x] Read all component files (done)
2. [ ] Write ExportOptionsPanel.test.tsx — mock GPU detection, test async init, resolution select, export button
3. [ ] Write TracerConfigPanel.test.tsx — render with controlled props, click height/shape buttons, change slider
4. [ ] Write ConfirmDialog.test.tsx — click confirm, click cancel, verify only correct callback fires
5. [ ] Write VideoQueue.test.tsx — mock processingStore, verify status labels for each status type
6. [ ] Write WalkthroughSteps.test.tsx — verify three step labels present
7. [ ] Run `cd apps/browser && npx vitest run` — fix any failures
8. [ ] Run `/code-review` — address issues
9. [ ] Create PR

---

## Verification (Mandatory)

### Task 8: Code Review

**Invoke:** `/claude-code-skills:code-review`

Review all implementation work.

**Expected:** All issues addressed before proceeding.

### Task 9: Feature Testing

Run `cd apps/browser && npx vitest run` — all 5 new test files listed, 0 failures.

### Task 10: Final Commit

```bash
git status
git log --oneline -5
```
