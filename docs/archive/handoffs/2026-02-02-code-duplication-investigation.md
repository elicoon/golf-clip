# Code Duplication Investigation Handoff

**Date:** 2026-02-02
**Priority:** High - blocking bug fixes from reaching production

---

## Problem

During E2E testing, discovered that bug fixes are being applied to the wrong location due to code duplication:

- `packages/frontend/src/components/` - Contains React components (Scrubber.tsx, ClipReview.tsx, etc.)
- `apps/browser/src/components/` - Contains **duplicate copies** of the same components

**Production uses `apps/browser`**, but fixes were applied to `packages/frontend`.

### Evidence

```bash
# Bug #5 fix (clip boundary extension) was applied here:
packages/frontend/src/components/Scrubber.tsx  # Has videoDuration prop, 30s extension

# But production uses this file which was NOT updated:
apps/browser/src/components/Scrubber.tsx  # Still has 5s windowPadding, no videoDuration
```

The files are not imports - they are completely separate implementations:
- `apps/browser/src/components/Scrubber.tsx` - 300+ lines, standalone
- `packages/frontend/src/components/Scrubber.tsx` - 300+ lines, standalone (with fix)

---

## Questions to Answer

1. **Why does this duplication exist?**
   - Was `apps/browser` meant to import from `packages/frontend`?
   - Or are they intentionally separate (browser vs desktop differences)?

2. **What's the intended architecture?**
   - Check `apps/browser/package.json` - does it depend on `packages/frontend`?
   - Check git history - when did the split happen?

3. **Which components are duplicated?**
   - Scrubber.tsx ✓ confirmed
   - ClipReview.tsx - likely
   - Others?

4. **What's the right fix?**
   - Option A: Make `apps/browser` import from `packages/frontend`
   - Option B: Keep separate and sync manually (bad)
   - Option C: Different architecture needed?

---

## Investigation Steps

1. **Check package dependencies:**
   ```bash
   cat apps/browser/package.json | grep -A5 dependencies
   cat packages/frontend/package.json
   ```

2. **Compare component files:**
   ```bash
   diff apps/browser/src/components/Scrubber.tsx packages/frontend/src/components/Scrubber.tsx
   diff apps/browser/src/components/ClipReview.tsx packages/frontend/src/components/ClipReview.tsx
   ```

3. **Check git history for when split occurred:**
   ```bash
   git log --oneline --all -- apps/browser/src/components/Scrubber.tsx | tail -5
   git log --oneline --all -- packages/frontend/src/components/Scrubber.tsx | tail -5
   ```

4. **Check if any imports exist:**
   ```bash
   grep -r "from.*packages/frontend" apps/browser/
   grep -r "@golfclip/frontend" apps/browser/
   ```

---

## Context

### Current Architecture (from CLAUDE.md)

```
golf-clip/
├── packages/
│   ├── frontend/           # Shared React app (Vite + TypeScript)
│   │   └── src/components/ # Components here
│   ├── detection/          # Shared ML/detection
│   └── api-schemas/        # Shared Pydantic schemas
├── apps/
│   ├── desktop/            # Desktop app (Tauri)
│   ├── browser/            # Browser app - PRODUCTION
│   │   └── src/components/ # DUPLICATE components here
│   └── webapp/             # Cloud webapp
```

### Deployments
- **Production URL:** https://browser-seven-sigma.vercel.app
- **Deploys from:** `apps/browser/`

---

## Immediate Impact

These bugs were "fixed" but the fixes aren't in production:

| Bug | Fix Location | Production Location | Status |
|-----|--------------|---------------------|--------|
| #5 Clip boundaries | `packages/frontend/Scrubber.tsx` | `apps/browser/Scrubber.tsx` | ❌ NOT FIXED |
| #4 Timeout cleanup | `apps/browser/ClipReview.tsx` | `apps/browser/ClipReview.tsx` | ✅ Fixed |
| #2 Frame extraction | `apps/browser/` | `apps/browser/` | ✅ Fixed |
| #1 Sequential upload | `apps/browser/` | `apps/browser/` | ✅ Fixed |

---

## Deliverables

1. **Root cause analysis** - Why does duplication exist?
2. **Architecture recommendation** - How should it be structured?
3. **Fix plan** - Either consolidate or document the split
4. **Apply Bug #5 fix** - To correct location (`apps/browser/`)

---

## Files to Examine

- `apps/browser/package.json`
- `packages/frontend/package.json`
- `apps/browser/src/components/Scrubber.tsx`
- `packages/frontend/src/components/Scrubber.tsx`
- `apps/browser/src/components/ClipReview.tsx`
- `packages/frontend/src/components/ClipReview.tsx`
- `apps/browser/vite.config.ts`
- Any monorepo config (turbo.json, nx.json, lerna.json)
