# Documentation Cleanup Handoff

**Date:** 2026-02-01
**Purpose:** Comprehensive cleanup of project documentation to clarify which app each doc applies to and organize stale files.

---

## Context

GolfClip has three apps but documentation doesn't clarify which app it describes:
- `apps/browser/` - Client-side web app (ACTIVE DEVELOPMENT)
- `apps/desktop/` - Full-featured local app (feature-complete)
- `apps/webapp/` - Cloud backend API (infrastructure only)

Core docs (ARCHITECTURE.md, FEATURES.md, etc.) describe desktop without saying so. This causes confusion.

---

## Task 1: Rewrite ARCHITECTURE.md as Comprehensive Cross-App Document

**Goal:** Transform ARCHITECTURE.md from desktop-only to a unified doc showing all three apps.

**Current state:** Only describes FastAPI + SQLite desktop architecture.

**Required structure:**
1. **System Overview** - Show all three apps and how they relate
2. **Shared Components** - packages/frontend, packages/detection, packages/api-schemas
3. **Browser App Architecture** - React + Vite + FFmpeg.wasm + Essentia.js + Zustand
4. **Desktop App Architecture** - Tauri + FastAPI + SQLite + YOLO + OpenCV
5. **Webapp Architecture** - FastAPI + PostgreSQL + R2 (infrastructure only)
6. **Detection Pipeline Comparison** - How audio/visual detection differs per app
7. **Data Flow Diagrams** - Per-app data flows
8. **Technology Stack** - Unified table showing tech per app

**Key files to reference:**
- `apps/browser/src/` - Browser architecture
- `apps/desktop/backend/` - Desktop architecture
- `apps/webapp/backend/` - Webapp architecture
- `packages/` - Shared code
- `docs/browser-desktop-feature-gap-analysis.md` - Feature comparison

---

## Task 2: Update FEATURES.md with App Labels

**Goal:** Add clear labels showing which features are desktop-only vs browser vs shared.

**Current state:** Describes desktop features (librosa, YOLO, SQLite, OpenCV tracer) without clarification.

**Required changes:**
1. Add header explaining the three apps
2. For each feature section, add a badge: `[Desktop Only]`, `[Browser Only]`, `[All Apps]`
3. Add a "Browser App Features" section covering:
   - Essentia.js audio detection (3 features vs librosa's 7)
   - Client-side FFmpeg.wasm processing
   - Canvas-based tracer rendering
   - Supabase feedback collection

**Feature status by app:**

| Feature | Browser | Desktop | Webapp |
|---------|---------|---------|--------|
| Audio detection | Essentia.js | librosa | librosa |
| Visual detection | None | YOLO | YOLO |
| Ball tracking | None | 4 methods | 4 methods |
| Origin detection | None | Shaft+clubhead | Shaft+clubhead |
| Tracer rendering | Canvas | OpenCV | OpenCV |
| Tracer export | None | FFmpeg burn-in | FFmpeg burn-in |
| Feedback | Supabase | SQLite | PostgreSQL |
| Persistence | Memory | SQLite | PostgreSQL |

---

## Task 3: Update PRODUCT-WALKTHROUGH.md with App Context

**Goal:** Clarify this describes the desktop workflow, or create browser version.

**Current state:** ASCII art walkthrough of desktop UI flow.

**Options (pick one):**
1. Add header: "This walkthrough describes the Desktop app"
2. Create separate `BROWSER-WALKTHROUGH.md` for browser flow

**Browser flow differences:**
- No "dev mode" path entry
- Processing shows "Analyzing audio chunk X/Y" (browser-specific)
- No keyboard shortcuts in browser
- No tracer burn-in export (download segments only)
- No clip boundary adjustment (display only)

---

## Task 4: Move Stale Files to Archive

**Files to move to `docs/archive/`:**

| File | Reason |
|------|--------|
| `docs/handoff-2026-01-29-session.md` | Old session handoff |
| `docs/performance-test-results-2026-01-25.md` | Historical test results |
| `docs/multi-video-upload-scope.md` | Feature NOT implemented (see below) |

**Multi-video upload status:** NOT IMPLEMENTED in browser. The scope doc exists but no code was written. VideoDropzone accepts single file only, processingStore has no queue model. Move to archive with note.

---

## Task 5: Update feedback-schema.md

**Current state:** Describes Supabase schema for browser app only.

**Finding:** Feedback is NOT shared - two completely different implementations:
- Browser: Supabase PostgreSQL (anonymous, session-based)
- Desktop: SQLite (job-based, with ML features)

**Required changes:**
1. Rename to `docs/browser-feedback-schema.md` OR
2. Add header clarifying "Browser App Feedback Schema (Supabase)"
3. Add note that desktop uses different schema in SQLite

---

## Task 6: Create Implementation Plans Index

**Goal:** Create `docs/implementation-plans/README.md` with status of all plans.

**Plan statuses (verified):**

| Plan | App | Status | Notes |
|------|-----|--------|-------|
| 2026-01-24-constraint-based-ball-tracking | Desktop | COMPLETED | Ball tracking implemented |
| 2026-01-24-landing-point-implementation | Desktop | COMPLETED | Landing points work |
| 2026-01-24-landing-point-marking-design | Desktop | COMPLETED | Design doc, implemented |
| 2026-01-24-precise-ball-tracking-plan | Desktop | COMPLETED | Tracker exists |
| 2026-01-24-shot-tracer-physics-plan | Desktop | COMPLETED | Tracer physics work |
| 2026-01-24-trajectory-configuration | Desktop | COMPLETED | Config panel exists |
| 2026-01-24-trajectory-configuration-design | Desktop | COMPLETED | Design doc |
| 2026-01-25-early-ball-detection-and-ui-improvements | Desktop | COMPLETED | Early detection exists |
| 2026-01-25-early-ball-detection-implementation | Desktop | COMPLETED | Implemented |
| 2026-01-25-feedback-driven-ml-improvement-design | Desktop | COMPLETED | ML pipeline exists |
| 2026-01-25-feedback-ml-implementation | Desktop | COMPLETED | Feedback tables exist |
| 2026-01-25-free-tier-cloud-migration | Webapp | PARTIAL | Infrastructure exists, not production |
| 2026-01-25-monorepo-restructure | All | COMPLETED | Monorepo done |
| 2026-01-25-tracer-feedback-system | Desktop | COMPLETED | Tracer feedback table exists |
| 2026-01-26-direct-r2-uploads | Webapp | COMPLETED | R2 upload code exists |
| 2026-01-26-origin-feedback-ml | Desktop | COMPLETED | Origin feedback table exists |
| 2026-01-29-background-export | Browser | NOT STARTED | Export still blocks UI |
| 2026-01-29-fix-tracer-animation | Browser | COMPLETED | Animation works |
| 2026-01-29-parallel-upload-processing | Browser | NOT STARTED | Still sequential |
| 2026-01-30-browser-feature-parity | Browser | IN PROGRESS | ClipReview done, gaps remain |
| 2026-01-31-hevc-modal-refactor | Browser | COMPLETED | Modal refactored |
| 2026-02-01-trajectory-bounds-fix | Browser | COMPLETED | Clamping implemented |

---

## Task 7: Update Bugs Folder

**Bug status (verified):**

| Bug File | Status | Action |
|----------|--------|--------|
| 2026-01-29-review-flow-bugs.md | PARTIAL | Bug 2 (tracer animation) FIXED, Bugs 1 & 3 OPEN |
| 2026-02-01-hevc-transcoding-reset.md | FIXED | Move to archive or mark resolved |

**Update 2026-01-29-review-flow-bugs.md:**
- Mark Bug 2 (tracer not animating) as FIXED
- Keep Bug 1 (sequential upload blocks processing) as OPEN
- Keep Bug 3 (export blocks review) as OPEN

---

## Task 8: Create Browser-Specific Docs

**New docs to create:**

1. **`docs/BROWSER-ARCHITECTURE.md`** - Browser-specific architecture:
   - Component diagram (App → Views → Components)
   - State management (Zustand processingStore)
   - Processing pipeline (FFmpeg.wasm + Essentia.js)
   - Key files and their purposes

2. **`docs/BROWSER-FEATURES.md`** - Browser-specific features:
   - Audio detection (Essentia.js onset detection)
   - Video processing (FFmpeg.wasm streaming)
   - Tracer rendering (Canvas API)
   - Feedback collection (Supabase)
   - Limitations vs desktop

---

## Execution Order

1. **Task 6** - Create implementation plans index (quick reference for other tasks)
2. **Task 4** - Move stale files to archive (cleanup)
3. **Task 7** - Update bugs folder (cleanup)
4. **Task 5** - Update feedback-schema.md (clarify scope)
5. **Task 1** - Rewrite ARCHITECTURE.md (major doc)
6. **Task 2** - Update FEATURES.md (major doc)
7. **Task 3** - Update PRODUCT-WALKTHROUGH.md (minor doc)
8. **Task 8** - Create browser-specific docs (new docs)

---

## Verification Checklist

After completion:
- [ ] CLAUDE.md links to correct docs
- [ ] Each major doc has app context (which app it describes)
- [ ] Implementation plans have status index
- [ ] Stale files moved to archive
- [ ] Bugs have current status
- [ ] Browser app has dedicated architecture/features docs
