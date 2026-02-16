# Documentation Cleanup Execution Prompt

**Copy this prompt to a new Claude Code instance.**

---

## Instructions

Execute the documentation cleanup tasks defined in `docs/handoffs/2026-02-01-docs-cleanup-handoff.md`.

**Execution approach:** Use subagents (Task tool) for independent tasks. Run tasks in parallel where possible.

**Key context:**
- GolfClip has 3 apps: `apps/browser/` (active), `apps/desktop/` (complete), `apps/webapp/` (infrastructure)
- Current focus is browser app development
- Documentation doesn't clarify which app each doc describes - this is the problem we're fixing

---

## Phase 1: Quick Cleanup (Parallel Subagents)

Launch these 4 subagents in parallel:

### Subagent 1: Create Implementation Plans Index
```
Create docs/implementation-plans/README.md with a status table for all implementation plans.

Read the handoff doc at docs/handoffs/2026-02-01-docs-cleanup-handoff.md for the verified status of each plan.

Format: Markdown table with columns: Plan, App (Browser/Desktop/Webapp/All), Status (COMPLETED/IN_PROGRESS/NOT_STARTED/PARTIAL), Notes.

Group by status (completed first, then in-progress, then not-started).
```

### Subagent 2: Move Stale Files to Archive
```
Move these files to docs/archive/:
1. docs/handoff-2026-01-29-session.md
2. docs/performance-test-results-2026-01-25.md
3. docs/multi-video-upload-scope.md

For multi-video-upload-scope.md, add a note at the top: "ARCHIVED: Feature not implemented. See docs/handoffs/2026-02-01-docs-cleanup-handoff.md for details."

Use git mv to preserve history.
```

### Subagent 3: Update Bugs Folder
```
Update docs/bugs/2026-01-29-review-flow-bugs.md:
- Mark Bug 2 (tracer not animating) as FIXED with note: "Fixed in TrajectoryEditor.tsx - 60fps animation with physics-based easing"
- Keep Bug 1 (sequential upload) as OPEN
- Keep Bug 3 (export blocks review) as OPEN

Move docs/bugs/2026-02-01-hevc-transcoding-reset.md to docs/archive/ with note: "FIXED: File→Blob conversion in VideoDropzone.tsx prevents stale reference."
```

### Subagent 4: Update Feedback Schema
```
Rename docs/feedback-schema.md to docs/browser-feedback-schema.md.

Add header at the top:
"# Browser App Feedback Schema (Supabase)

> **Scope:** This schema is for the browser app only. The desktop app uses a different SQLite schema defined in `apps/desktop/backend/core/database.py`.

"

Use git mv to preserve history.
```

---

## Phase 2: Major Doc Updates (Sequential Subagents)

After Phase 1 completes, run these sequentially (each depends on understanding the prior):

### Subagent 5: Rewrite ARCHITECTURE.md
```
Rewrite docs/ARCHITECTURE.md as a comprehensive cross-app document.

Read the current file and the handoff doc for required structure.

Key sections:
1. System Overview - diagram showing all 3 apps
2. Shared Components - packages/frontend, packages/detection, packages/api-schemas
3. Browser App Architecture - detail the React + Vite + FFmpeg.wasm + Essentia.js stack
4. Desktop App Architecture - keep existing FastAPI + SQLite content, label it
5. Webapp Architecture - PostgreSQL + R2 infrastructure
6. Detection Pipeline Comparison - table showing audio/visual detection per app
7. Technology Stack - unified table

Reference docs/browser-desktop-feature-gap-analysis.md for feature comparisons.
Explore the actual code in apps/browser/src/, apps/desktop/backend/, apps/webapp/backend/.

This is a major rewrite - take time to make it comprehensive and accurate.
```

### Subagent 6: Update FEATURES.md
```
Update docs/FEATURES.md to add app context labels.

Add header explaining the three apps.

For each existing feature section, add a badge:
- [Desktop Only] - YOLO detection, OpenCV tracer, SQLite persistence, ML feedback
- [All Apps] - Audio detection (but note librosa vs Essentia.js difference)

Add new section "Browser App Features" covering:
- Essentia.js audio detection (onset detection, 3 features)
- FFmpeg.wasm client-side processing
- Canvas-based tracer rendering
- Supabase feedback collection
- Memory-only operation (no persistence)

Reference the feature gap analysis doc for accuracy.
```

### Subagent 7: Update PRODUCT-WALKTHROUGH.md
```
Update docs/PRODUCT-WALKTHROUGH.md to clarify it describes the desktop app.

Add header at top:
"# GolfClip Desktop App Walkthrough

> **Note:** This walkthrough describes the **Desktop app** (`apps/desktop/`). The browser app has a simpler flow - see [Browser E2E Test Plan](test-plans/browser-e2e.md) for browser-specific steps.

"

No other changes needed - the content is accurate for desktop.
```

---

## Phase 3: Create New Docs (Parallel Subagents)

### Subagent 8: Create BROWSER-ARCHITECTURE.md
```
Create docs/BROWSER-ARCHITECTURE.md documenting the browser app architecture.

Explore apps/browser/src/ to understand the structure.

Include:
1. Overview - client-side WASM app, no server
2. Directory Structure - src/components, src/lib, src/stores
3. Component Hierarchy - App → Views (VideoDropzone, ClipReview) → Components
4. State Management - Zustand processingStore, key state shape
5. Processing Pipeline - diagram showing: File → FFmpeg segment → Essentia detection → Results
6. Key Files - table with file paths and purposes
7. Limitations - what browser can't do vs desktop
8. Technology Stack - React 18, Vite, FFmpeg.wasm, Essentia.js, Zustand, Supabase

Make it detailed and useful for developers new to the codebase.
```

### Subagent 9: Create BROWSER-FEATURES.md
```
Create docs/BROWSER-FEATURES.md documenting browser-specific features.

Include:
1. Audio Detection - Essentia.js onset detection, how it differs from librosa
2. Video Processing - FFmpeg.wasm streaming, segment extraction, ~2GB limit
3. Shot Review - ClipReview component, what's implemented vs gaps
4. Tracer System - Canvas rendering, trajectory generation, animation
5. Export - segment download (no tracer burn-in)
6. Feedback Collection - Supabase integration, anonymous session-based
7. Feature Comparison - table vs desktop

Reference:
- docs/browser-desktop-feature-gap-analysis.md
- docs/implementation-plans/2026-01-30-browser-feature-parity.md
- apps/browser/src/components/ClipReview.tsx
- apps/browser/src/lib/audio-detector.ts
```

---

## Verification

After all subagents complete, verify:

1. Run `ls docs/*.md docs/*/*.md` to see new structure
2. Check that CLAUDE.md links still work (update if needed)
3. Confirm docs/implementation-plans/README.md exists
4. Confirm docs/archive/ has the moved files
5. Confirm browser-specific docs exist

Report completion with summary of changes made.
