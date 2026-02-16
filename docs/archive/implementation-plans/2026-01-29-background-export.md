# Background Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to continue reviewing clips while exports happen in the background, rather than blocking on export completion.

**Architecture:** Decouple shot acceptance from export waiting. Queue exports as shots are accepted, track export jobs in Zustand store, show non-blocking progress indicator, and only show completion screen when all reviews AND exports are done.

**Tech Stack:** React, TypeScript, Zustand state management

---

## Problem Analysis

**Current Flow (Blocking):**
1. User reviews shots one by one in `ClipReview.tsx`
2. When user clicks "Next" (accept) on the LAST shot needing review, `handleAccept()` calls `exportClips()` with `await`
3. `exportClips()` shows a modal and polls for completion
4. User cannot do anything while export is in progress

**Root Cause:**
The export is triggered synchronously when the last shot is accepted, and the UI blocks on the export modal.

**Key Insight:**
The backend already supports async exports - `POST /api/export` returns immediately with an `export_job_id`. The frontend just needs to stop blocking on poll completion.

---

## Implementation Tasks

### Task 1: Add Export Job Types to Zustand Store

**Files:**
- Modify: `packages/frontend/src/stores/appStore.ts`

**Step 1: Add ExportJob interface**

```typescript
// Add after TrajectoryPoint interface (around line 36)
interface ExportJob {
  exportJobId: string
  shotId: number
  status: 'pending' | 'exporting' | 'complete' | 'error'
  progress: number
  outputPath?: string
  error?: string
}
```

**Step 2: Add export state to AppState interface**

```typescript
// Add to AppState interface (around line 57-81)
interface AppState {
  // ... existing properties ...

  // Export job tracking
  pendingExports: ExportJob[]

  // Export actions
  addExportJob: (job: ExportJob) => void
  updateExportJob: (exportJobId: string, updates: Partial<ExportJob>) => void
  removeExportJob: (exportJobId: string) => void
  getActiveExports: () => ExportJob[]
  getAllCompletedPaths: () => string[]
  clearExports: () => void
}
```

**Step 3: Add implementation**

```typescript
// Add to useAppStore create function (around line 83)
pendingExports: [],

addExportJob: (job) => set((state) => ({
  pendingExports: [...state.pendingExports, job],
})),

updateExportJob: (exportJobId, updates) => set((state) => ({
  pendingExports: state.pendingExports.map((job) =>
    job.exportJobId === exportJobId ? { ...job, ...updates } : job
  ),
})),

removeExportJob: (exportJobId) => set((state) => ({
  pendingExports: state.pendingExports.filter((job) => job.exportJobId !== exportJobId),
})),

getActiveExports: () => {
  const state = get()
  return state.pendingExports.filter((job) => job.status !== 'complete' && job.status !== 'error')
},

getAllCompletedPaths: () => {
  const state = get()
  return state.pendingExports
    .filter((job) => job.status === 'complete' && job.outputPath)
    .map((job) => job.outputPath!)
},

clearExports: () => set({ pendingExports: [] }),
```

**Step 4: Verify store actions work**

Run: TypeScript compiles, manual test with console.log
Expected: Can add, update, remove export jobs

---

### Task 2: Create ExportProgressIndicator Component

**Files:**
- Create: `packages/frontend/src/components/ExportProgressIndicator.tsx`

**Step 1: Create component skeleton**

```typescript
import { useEffect, useRef } from 'react'
import { useAppStore } from '../stores/appStore'
import { config } from '../config'

const API_BASE = config.apiBaseUrl

export function ExportProgressIndicator() {
  const { pendingExports, updateExportJob, getActiveExports } = useAppStore()
  const pollIntervalRef = useRef<number | null>(null)

  const activeExports = getActiveExports()
  const completedCount = pendingExports.filter(j => j.status === 'complete').length
  const errorCount = pendingExports.filter(j => j.status === 'error').length
  const totalCount = pendingExports.length

  // Don't render if no exports
  if (pendingExports.length === 0) {
    return null
  }

  // Poll for export status
  useEffect(() => {
    if (activeExports.length === 0) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
      return
    }

    const pollStatus = async () => {
      for (const job of activeExports) {
        try {
          const response = await fetch(`${API_BASE}/api/export/${job.exportJobId}/status`)
          if (response.ok) {
            const status = await response.json()
            updateExportJob(job.exportJobId, {
              status: status.status,
              progress: status.progress,
              outputPath: status.exported?.[0],
              error: status.errors?.[0]?.error,
            })
          }
        } catch (error) {
          console.error('Failed to poll export status:', error)
        }
      }
    }

    // Initial poll
    pollStatus()

    // Poll every 500ms
    pollIntervalRef.current = window.setInterval(pollStatus, 500)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [activeExports.length, updateExportJob])

  return (
    <div className="export-progress-indicator">
      <div className="export-progress-header">
        {activeExports.length > 0 ? (
          <>
            <span className="spinner-small" />
            Exporting {completedCount + 1} of {totalCount}...
          </>
        ) : (
          <>
            {errorCount > 0 ? '⚠' : '✓'} {completedCount} clips exported
            {errorCount > 0 && ` (${errorCount} failed)`}
          </>
        )}
      </div>
      {activeExports.length > 0 && (
        <div className="export-mini-progress">
          <div
            className="export-mini-progress-fill"
            style={{ width: `${(completedCount / totalCount) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
```

**Step 2: Add CSS styles**

Add to `packages/frontend/src/App.css` or equivalent:

```css
.export-progress-indicator {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px 16px;
  min-width: 200px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
}

.export-progress-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.export-mini-progress {
  margin-top: 8px;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.export-mini-progress-fill {
  height: 100%;
  background: var(--accent-color);
  transition: width 0.3s ease;
}

.spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
```

---

### Task 3: Refactor ClipReview Accept Flow

**Files:**
- Modify: `packages/frontend/src/components/ClipReview.tsx`

**Step 1: Add store import for export tracking**

```typescript
// Update imports at top of file
import { useAppStore } from '../stores/appStore'

// Update destructuring (around line 51)
const { shots, updateShot, addExportJob, updateExportJob } = useAppStore()
```

**Step 2: Create queueShotExport function**

```typescript
// Add around line 390, before handleAccept
const queueShotExport = async (shotId: number, clipStart: number, clipEnd: number) => {
  try {
    const outputDir = videoPath.replace(/\.[^.]+$/, '_clips')

    // Start export job (single clip)
    const response = await fetch(`${API_BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        clips: [{
          shot_id: shotId,
          start_time: clipStart,
          end_time: clipEnd,
          approved: true,
        }],
        output_dir: outputDir,
        filename_pattern: 'shot_{shot_id}',
        render_tracer: exportWithTracer,
        tracer_style: exportWithTracer ? { color: '#FFFFFF', glow_enabled: true } : undefined,
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to start export')
    }

    const { export_job_id } = await response.json()

    // Add to export queue (fire-and-forget - don't await completion)
    addExportJob({
      exportJobId: export_job_id,
      shotId,
      status: 'pending',
      progress: 0,
    })

    return export_job_id
  } catch (error) {
    console.error('Failed to queue export:', error)
    // Don't block review flow on export errors
    return null
  }
}
```

**Step 3: Modify handleAccept to queue instead of block**

```typescript
// Modify handleAccept (around line 436-495)
const handleAccept = async () => {
  if (!currentShot || loadingState === 'loading') return

  setLoadingState('loading')
  setErrorMessage(null)

  // Submit true positive feedback (fire-and-forget)
  submitTruePositiveFeedback()

  // Submit tracer feedback for ML training (fire-and-forget)
  if (trajectory && landingPoint) {
    if (hasConfiguredTracer) {
      submitTracerFeedback('tracer_configured', tracerConfig)
    } else {
      submitTracerFeedback('tracer_auto_accepted', null)
    }
  }

  try {
    // Mark as approved (confidence = 1.0)
    updateShot(currentShot.id, { confidence: 1.0 })

    // Send update to server
    const response = await fetch(`${API_BASE}/api/shots/${jobId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          shot_id: currentShot.id,
          start_time: currentShot.clip_start,
          end_time: currentShot.clip_end,
          approved: true,
        },
      ]),
    })

    if (!response.ok) {
      throw new Error('Failed to save shot')
    }

    // Queue export for this shot (non-blocking)
    queueShotExport(currentShot.id, currentShot.clip_start, currentShot.clip_end)

    setLoadingState('idle')

    // Check if this was the last shot needing review
    if (shotsNeedingReview.length === 1) {
      // All shots reviewed - go to complete view
      // Don't wait for exports - they'll continue in background
      onComplete([])  // Pass empty array, ExportComplete will get paths from store
    } else {
      // More shots to review - advance
      setCurrentShotIndex(0)
    }
  } catch (error) {
    setLoadingState('error')
    setErrorMessage(error instanceof Error ? error.message : 'Failed to save shot')
  }
}
```

**Step 4: Remove the blocking exportClips function**

The `exportClips()` function (lines 536-597) and related modal code can be removed since exports now happen per-shot in the background.

---

### Task 4: Update App.tsx for Global Export Tracking

**Files:**
- Modify: `packages/frontend/src/App.tsx`

**Step 1: Import ExportProgressIndicator**

```typescript
// Add import at top
import { ExportProgressIndicator } from './components/ExportProgressIndicator'
```

**Step 2: Add to App layout**

```typescript
// Add at end of return, before closing </div>
<ExportProgressIndicator />
```

**Step 3: Update handleReviewComplete**

```typescript
// Modify handleReviewComplete (around line 132-135)
const handleReviewComplete = useCallback((clips: string[]) => {
  // clips array may be empty - ExportComplete will read from store
  setExportedClips(prev => [...prev, ...clips])
  setView('complete')
}, [])
```

**Step 4: Update handleReset to clear exports**

```typescript
// Modify handleReset (around line 151-158)
const handleReset = useCallback(() => {
  setCurrentJob(null)
  setShots([])
  setError(null)
  setExportedClips([])
  clearQueue()
  clearExports()  // NEW: Clear export tracking
  setView('home')
}, [setCurrentJob, setShots, clearQueue, clearExports])
```

---

### Task 5: Update ExportComplete to Handle In-Progress Exports

**Files:**
- Modify: `packages/frontend/src/components/ExportComplete.tsx`

**Step 1: Add store import**

```typescript
import { useAppStore } from '../stores/appStore'
```

**Step 2: Read export state from store**

```typescript
// At top of component
const { pendingExports, getActiveExports, getAllCompletedPaths } = useAppStore()
const activeExports = getActiveExports()
const completedPaths = getAllCompletedPaths()
const hasActiveExports = activeExports.length > 0
```

**Step 3: Show progress for in-flight exports**

```typescript
// In render, show appropriate state
{hasActiveExports ? (
  <div className="export-finishing">
    <span className="spinner" />
    <p>Finishing {activeExports.length} export{activeExports.length > 1 ? 's' : ''}...</p>
  </div>
) : (
  <div className="export-success">
    <p>{completedPaths.length} clips exported successfully</p>
  </div>
)}
```

---

### Task 6: Final Testing and Commit

**Step 1: Manual testing checklist**

- [ ] Process video with 3+ detected shots
- [ ] Accept first shot - export starts in background, can immediately review next
- [ ] Accept second shot - second export queues, can continue reviewing
- [ ] Accept last shot - transitions to complete view without waiting
- [ ] ExportProgressIndicator shows progress in bottom-right corner
- [ ] ExportComplete shows "finishing exports" if any still in progress
- [ ] Reset button clears all export state

**Step 2: Test edge cases**

- [ ] Export fails for one shot - doesn't block other exports
- [ ] User clicks reset mid-export - exports cancelled/cleared
- [ ] Rapid accept clicks - exports queue correctly

**Step 3: Commit changes**

```bash
git add packages/frontend/src/stores/appStore.ts
git add packages/frontend/src/components/ClipReview.tsx
git add packages/frontend/src/components/ExportProgressIndicator.tsx
git add packages/frontend/src/components/ExportComplete.tsx
git add packages/frontend/src/App.tsx
git commit -m "feat: exports happen in background while reviewing continues

- Add export job tracking to Zustand store
- Create ExportProgressIndicator component for non-blocking progress
- Refactor ClipReview to queue exports per-shot (fire-and-forget)
- Update ExportComplete to show in-progress export status
- Remove blocking export modal from ClipReview

Fixes: Export blocks next clip review bug"
```

---

## Summary of File Changes

| File | Lines Changed | Description |
|------|---------------|-------------|
| `packages/frontend/src/stores/appStore.ts` | ~40 | Add export job tracking state and actions |
| `packages/frontend/src/components/ClipReview.tsx` | ~50 | Refactor accept to queue exports, remove blocking |
| `packages/frontend/src/components/ExportProgressIndicator.tsx` | ~100 | New component for global export progress |
| `packages/frontend/src/components/ExportComplete.tsx` | ~20 | Handle pending exports, show progress |
| `packages/frontend/src/App.tsx` | ~10 | Add ExportProgressIndicator, clear exports on reset |

---

## Testing Strategy

1. **Store Unit Tests**: Export queue CRUD operations
2. **Component Tests**: ExportProgressIndicator renders correctly
3. **Integration Tests**: Full review flow without blocking
4. **Manual QA**: Verify UX feels smooth, no blocking perceived

**Commands**:
```bash
# Frontend dev server
cd /Users/ecoon/golf-clip/packages/frontend && npm run dev

# Backend server
cd /Users/ecoon/golf-clip/apps/desktop && uvicorn backend.main:app --port 8420
```
