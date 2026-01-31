# Browser App Feature Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full shot review and editing capabilities to the browser app, matching the desktop app's ClipReview workflow.

**Architecture:** The browser app currently displays detected shots in a simple grid. We'll add a ClipReview component with shot navigation, a timeline scrubber, trajectory rendering, configuration panel, export, and keyboard shortcuts. All processing stays client-side (no API calls) using the existing Zustand store.

**Tech Stack:** React 18, TypeScript, Zustand, Vite, Canvas API for trajectory rendering

---

## Task 1: Extend ProcessingStore for ClipReview State

**Files:**
- Modify: `apps/browser/src/stores/processingStore.ts`

**Step 1: Write the type definitions**

Add to `processingStore.ts` after the existing interfaces:

```typescript
export interface TrajectoryPoint {
  timestamp: number
  x: number
  y: number
  confidence: number
  interpolated: boolean
}

export interface TrajectoryData {
  shot_id: string
  points: TrajectoryPoint[]
  confidence: number
  apex_point?: TrajectoryPoint
  frame_width: number
  frame_height: number
}

export interface TracerConfig {
  height: 'low' | 'medium' | 'high'
  shape: 'hook' | 'draw' | 'straight' | 'fade' | 'slice'
  startingLine: 'left' | 'center' | 'right'
  flightTime: number
}
```

**Step 2: Add segment confidence and trim fields to VideoSegment**

Update the `VideoSegment` interface:

```typescript
export interface VideoSegment {
  id: string
  strikeTime: number
  startTime: number
  endTime: number
  blob: Blob
  objectUrl: string
  confidence: number        // Add: detection confidence (0-1)
  clipStart: number         // Add: trimmed start time
  clipEnd: number           // Add: trimmed end time
  approved: boolean         // Add: user approved this shot
  landingPoint?: { x: number; y: number }  // Add: marked landing point
  trajectory?: TrajectoryData              // Add: generated trajectory
}
```

**Step 3: Add store actions for ClipReview**

Add to the store interface and implementation:

```typescript
// Add to ProcessingState interface:
updateSegment: (id: string, updates: Partial<VideoSegment>) => void
approveSegment: (id: string) => void
rejectSegment: (id: string) => void

// Add to create<ProcessingState>:
updateSegment: (id, updates) => set((state) => ({
  segments: state.segments.map(seg =>
    seg.id === id ? { ...seg, ...updates } : seg
  )
})),
approveSegment: (id) => set((state) => ({
  segments: state.segments.map(seg =>
    seg.id === id ? { ...seg, confidence: 1.0, approved: true } : seg
  )
})),
rejectSegment: (id) => set((state) => ({
  segments: state.segments.map(seg =>
    seg.id === id ? { ...seg, confidence: 0, approved: false } : seg
  )
})),
```

**Step 4: Update addSegment to include new fields**

Ensure segments are created with defaults:

```typescript
addSegment: (segment) => set((state) => ({
  segments: [...state.segments, {
    ...segment,
    confidence: segment.confidence ?? 0.5,
    clipStart: segment.clipStart ?? segment.startTime,
    clipEnd: segment.clipEnd ?? segment.endTime,
    approved: false,
  }]
})),
```

**Step 5: Verify the build**

Run: `cd apps/browser && npm run build`
Expected: Build succeeds with no TypeScript errors

**Step 6: Commit**

```bash
git add apps/browser/src/stores/processingStore.ts
git commit -m "feat(browser): extend store with ClipReview state management"
```

---

## Task 2: Create ClipReview Component Shell

**Files:**
- Create: `apps/browser/src/components/ClipReview.tsx`
- Modify: `apps/browser/src/App.tsx`

**Step 1: Create ClipReview component with shot navigation**

Create `apps/browser/src/components/ClipReview.tsx`:

```typescript
import { useState, useRef, useEffect, useCallback } from 'react'
import { useProcessingStore, VideoSegment } from '../stores/processingStore'

interface ClipReviewProps {
  onComplete: () => void
}

export function ClipReview({ onComplete }: ClipReviewProps) {
  const { segments, updateSegment, approveSegment, rejectSegment } = useProcessingStore()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Filter to shots needing review (confidence < 0.7)
  const shotsNeedingReview = segments.filter(s => s.confidence < 0.7)
  const currentShot = shotsNeedingReview[currentIndex]
  const totalShots = shotsNeedingReview.length

  // Seek to clip start when shot changes
  useEffect(() => {
    if (videoRef.current && currentShot) {
      videoRef.current.currentTime = currentShot.clipStart
    }
  }, [currentShot?.id])

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  const handleNext = () => {
    if (currentIndex < totalShots - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handleApprove = () => {
    if (!currentShot) return
    approveSegment(currentShot.id)

    if (currentIndex >= shotsNeedingReview.length - 1) {
      onComplete()
    } else {
      // Stay at same index - approved shot will filter out
      setCurrentIndex(Math.min(currentIndex, shotsNeedingReview.length - 2))
    }
  }

  const handleReject = () => {
    if (!currentShot) return
    rejectSegment(currentShot.id)

    if (currentIndex >= shotsNeedingReview.length - 1) {
      onComplete()
    } else {
      setCurrentIndex(Math.min(currentIndex, shotsNeedingReview.length - 2))
    }
  }

  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

  if (!currentShot) {
    return (
      <div className="clip-review-empty">
        <p>All shots have been reviewed!</p>
        <button onClick={onComplete} className="btn-primary">
          Continue to Export
        </button>
      </div>
    )
  }

  return (
    <div className="clip-review">
      <div className="clip-review-header">
        <h2>Review Shots</h2>
        <span className="shot-counter">{currentIndex + 1} of {totalShots}</span>
      </div>

      <div className="clip-review-navigation">
        <button
          onClick={handlePrevious}
          disabled={currentIndex === 0}
          className="btn-nav"
        >
          ← Previous
        </button>
        <button
          onClick={handleNext}
          disabled={currentIndex >= totalShots - 1}
          className="btn-nav"
        >
          Next →
        </button>
      </div>

      <div className="video-container">
        <video
          ref={videoRef}
          src={currentShot.objectUrl}
          className="review-video"
          onClick={togglePlayPause}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      </div>

      <div className="clip-review-actions">
        <button onClick={handleReject} className="btn-reject">
          No Golf Shot
        </button>
        <button onClick={handleApprove} className="btn-approve">
          Approve Shot
        </button>
      </div>

      <div className="clip-info">
        <span>Confidence: {(currentShot.confidence * 100).toFixed(0)}%</span>
        <span>Duration: {(currentShot.clipEnd - currentShot.clipStart).toFixed(1)}s</span>
      </div>
    </div>
  )
}
```

**Step 2: Add ClipReview CSS**

Add to `apps/browser/src/App.css`:

```css
/* ClipReview Component */
.clip-review {
  max-width: 900px;
  margin: 0 auto;
  padding: 1rem;
}

.clip-review-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.clip-review-header h2 {
  color: #4ade80;
  margin: 0;
}

.shot-counter {
  color: #888;
  font-size: 0.9rem;
}

.clip-review-navigation {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.btn-nav {
  padding: 0.5rem 1rem;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-nav:hover:not(:disabled) {
  background: #3a3a3a;
}

.btn-nav:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.video-container {
  position: relative;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 1rem;
}

.review-video {
  width: 100%;
  display: block;
  cursor: pointer;
}

.clip-review-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.btn-reject {
  padding: 0.75rem 1.5rem;
  background: #4a1515;
  border: 1px solid #6a2525;
  border-radius: 6px;
  color: #ff6b6b;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-reject:hover {
  background: #5a2020;
}

.btn-approve {
  padding: 0.75rem 1.5rem;
  background: #154a15;
  border: 1px solid #256a25;
  border-radius: 6px;
  color: #4ade80;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-approve:hover {
  background: #205a20;
}

.clip-info {
  display: flex;
  justify-content: center;
  gap: 2rem;
  color: #888;
  font-size: 0.85rem;
}

.clip-review-empty {
  text-align: center;
  padding: 3rem;
}
```

**Step 3: Integrate ClipReview into App.tsx**

Update `apps/browser/src/App.tsx`:

```typescript
import { useState } from 'react'
import { VideoDropzone } from './components/VideoDropzone'
import { ClipReview } from './components/ClipReview'
import { useProcessingStore } from './stores/processingStore'

type AppView = 'upload' | 'review' | 'export'

export default function App() {
  const { status, segments, error, reset } = useProcessingStore()
  const [view, setView] = useState<AppView>('upload')

  const handleProcessingComplete = () => {
    if (segments.length > 0) {
      setView('review')
    }
  }

  const handleReviewComplete = () => {
    setView('export')
  }

  const handleReset = () => {
    reset()
    setView('upload')
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>GolfClip</h1>
        <div className="header-actions">
          {view !== 'upload' && (
            <button onClick={handleReset} className="btn-secondary">
              New Video
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="app-error">
            <h3>Error</h3>
            <p>{error}</p>
            <button onClick={handleReset} className="btn-secondary">
              Try Again
            </button>
          </div>
        )}

        {view === 'upload' && !error && (
          <VideoDropzone onComplete={handleProcessingComplete} />
        )}

        {view === 'review' && (
          <ClipReview onComplete={handleReviewComplete} />
        )}

        {view === 'export' && (
          <div className="export-complete">
            <h2>Review Complete!</h2>
            <p>
              {segments.filter(s => s.approved).length} shots approved
            </p>
            <button onClick={handleReset} className="btn-primary">
              Process Another Video
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
```

**Step 4: Verify the build**

Run: `cd apps/browser && npm run build`
Expected: Build succeeds

**Step 5: Manual verification**

Run: `cd apps/browser && npm run dev`
Expected: App loads, upload a video, see ClipReview after detection

**Step 6: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx apps/browser/src/App.tsx apps/browser/src/App.css
git commit -m "feat(browser): add ClipReview component with shot navigation"
```

---

## Task 3: Add Scrubber Component

**Files:**
- Create: `apps/browser/src/components/Scrubber.tsx`
- Modify: `apps/browser/src/components/ClipReview.tsx`
- Modify: `apps/browser/src/App.css`

**Step 1: Copy Scrubber component**

Copy from `packages/frontend/src/components/Scrubber.tsx` to `apps/browser/src/components/Scrubber.tsx`.

The component is self-contained and needs no API adaptations.

**Step 2: Copy Scrubber CSS**

Add the scrubber styles from `packages/frontend/src/App.css` to `apps/browser/src/App.css`. Search for `.scrubber` classes:

```css
/* Scrubber Component */
.scrubber-container {
  padding: 1rem;
  background: #1a1a1a;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.scrubber {
  position: relative;
  height: 40px;
  cursor: pointer;
  user-select: none;
}

.scrubber-track {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 8px;
  background: #333;
  border-radius: 4px;
  transform: translateY(-50%);
}

.scrubber-region-outside {
  position: absolute;
  top: 50%;
  height: 8px;
  background: rgba(0, 0, 0, 0.5);
  transform: translateY(-50%);
  border-radius: 4px;
}

.scrubber-selection {
  position: absolute;
  top: 50%;
  height: 8px;
  background: #4ade80;
  transform: translateY(-50%);
  border-radius: 4px;
  opacity: 0.6;
}

.scrubber-selection-active {
  opacity: 0.8;
}

.scrubber-handle {
  position: absolute;
  top: 50%;
  width: 16px;
  height: 32px;
  background: #4ade80;
  border-radius: 4px;
  transform: translate(-50%, -50%);
  cursor: ew-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.scrubber-handle-start {
  background: #4ade80;
}

.scrubber-handle-end {
  background: #f87171;
}

.scrubber-handle-active {
  box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.3);
}

.handle-grip {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.handle-grip span {
  width: 8px;
  height: 2px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 1px;
}

.scrubber-playhead {
  position: absolute;
  top: 50%;
  width: 4px;
  height: 24px;
  background: #fff;
  border-radius: 2px;
  transform: translate(-50%, -50%);
  cursor: ew-resize;
  z-index: 3;
}

.scrubber-playhead-active {
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
}

.scrubber-hover-preview {
  position: absolute;
  bottom: 100%;
  transform: translateX(-50%);
  padding-bottom: 8px;
  pointer-events: none;
}

.scrubber-hover-time {
  background: #333;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  white-space: nowrap;
}

.scrubber-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: #888;
}

.scrubber-label-current {
  color: #fff;
}

.scrubber-label-icon {
  margin-right: 4px;
}

.scrubber-clip-info {
  text-align: center;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: #666;
}

.scrubber-disabled {
  opacity: 0.5;
  pointer-events: none;
}
```

**Step 3: Integrate Scrubber into ClipReview**

Update `ClipReview.tsx` to include the Scrubber:

```typescript
import { Scrubber } from './Scrubber'

// Inside ClipReview component, add:
const handleTimeUpdate = useCallback((newStart: number, newEnd: number) => {
  if (currentShot) {
    updateSegment(currentShot.id, {
      clipStart: newStart,
      clipEnd: newEnd,
    })
  }
}, [currentShot, updateSegment])

// In the JSX, add after video-container:
{currentShot && (
  <Scrubber
    videoRef={videoRef}
    startTime={currentShot.clipStart}
    endTime={currentShot.clipEnd}
    onTimeUpdate={handleTimeUpdate}
  />
)}
```

**Step 4: Verify the build**

Run: `cd apps/browser && npm run build`
Expected: Build succeeds

**Step 5: Manual verification**

Run: `cd apps/browser && npm run dev`
Expected: Scrubber appears below video, handles drag to adjust trim

**Step 6: Commit**

```bash
git add apps/browser/src/components/Scrubber.tsx apps/browser/src/components/ClipReview.tsx apps/browser/src/App.css
git commit -m "feat(browser): add Scrubber component for clip trimming"
```

---

## Task 4: Wire Up Trajectory Rendering

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx` (already exists, needs props wired)

**Step 1: Add trajectory generation utility**

Create a mock trajectory generator in `ClipReview.tsx`:

```typescript
import { TrajectoryData, TrajectoryPoint, TracerConfig } from '../stores/processingStore'

function generateTrajectory(
  landingPoint: { x: number; y: number },
  config: TracerConfig,
  originPoint?: { x: number; y: number },
  apexPoint?: { x: number; y: number }
): TrajectoryData {
  const origin = originPoint || { x: 0.5, y: 0.85 }

  // Calculate apex based on config
  const heightMultiplier = config.height === 'low' ? 0.15 : config.height === 'medium' ? 0.25 : 0.35
  const defaultApex = {
    x: (origin.x + landingPoint.x) / 2,
    y: Math.min(origin.y, landingPoint.y) - heightMultiplier
  }
  const apex = apexPoint || defaultApex

  // Apply shape curve
  const shapeCurve = {
    hook: -0.15,
    draw: -0.08,
    straight: 0,
    fade: 0.08,
    slice: 0.15
  }[config.shape]

  // Generate points along quadratic bezier
  const numPoints = 30
  const points: TrajectoryPoint[] = []

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints
    const timestamp = t * config.flightTime

    // Quadratic bezier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
    const mt = 1 - t
    const x = mt * mt * origin.x + 2 * mt * t * (apex.x + shapeCurve * t) + t * t * landingPoint.x
    const y = mt * mt * origin.y + 2 * mt * t * apex.y + t * t * landingPoint.y

    points.push({
      timestamp,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      confidence: 1.0,
      interpolated: false
    })
  }

  return {
    shot_id: 'mock',
    points,
    confidence: 1.0,
    apex_point: {
      ...points[Math.floor(numPoints / 2)],
      x: apex.x,
      y: apex.y
    },
    frame_width: 1920,
    frame_height: 1080
  }
}
```

**Step 2: Add trajectory state to ClipReview**

Add to ClipReview component:

```typescript
const [showTracer, setShowTracer] = useState(true)
const [currentTime, setCurrentTime] = useState(0)
const [landingPoint, setLandingPoint] = useState<{ x: number; y: number } | null>(null)
const [apexPoint, setApexPoint] = useState<{ x: number; y: number } | null>(null)
const [originPoint, setOriginPoint] = useState<{ x: number; y: number } | null>(null)
const [reviewStep, setReviewStep] = useState<'marking_landing' | 'generating' | 'reviewing'>('marking_landing')
const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null)
const [tracerConfig, setTracerConfig] = useState<TracerConfig>({
  height: 'medium',
  shape: 'straight',
  startingLine: 'center',
  flightTime: 3.0
})

// Track video time
useEffect(() => {
  const video = videoRef.current
  if (!video) return

  const handleTimeUpdate = () => setCurrentTime(video.currentTime)
  video.addEventListener('timeupdate', handleTimeUpdate)
  return () => video.removeEventListener('timeupdate', handleTimeUpdate)
}, [])

// Reset marking state when shot changes
useEffect(() => {
  setLandingPoint(null)
  setApexPoint(null)
  setOriginPoint(null)
  setReviewStep('marking_landing')
  setTrajectory(null)
}, [currentShot?.id])

const handleCanvasClick = useCallback((x: number, y: number) => {
  if (reviewStep === 'marking_landing') {
    setLandingPoint({ x, y })
    const traj = generateTrajectory({ x, y }, tracerConfig)
    setTrajectory(traj)
    setReviewStep('reviewing')
    updateSegment(currentShot!.id, { landingPoint: { x, y }, trajectory: traj })
  }
}, [reviewStep, tracerConfig, currentShot, updateSegment])
```

**Step 3: Add TrajectoryEditor to ClipReview JSX**

Import and render:

```typescript
import { TrajectoryEditor } from './TrajectoryEditor'

// In JSX, wrap video with container:
<div className="video-container">
  <video ref={videoRef} ... />
  <TrajectoryEditor
    videoRef={videoRef}
    trajectory={trajectory}
    currentTime={currentTime}
    showTracer={showTracer}
    landingPoint={landingPoint}
    apexPoint={apexPoint}
    originPoint={originPoint}
    onCanvasClick={handleCanvasClick}
    markingStep={reviewStep}
  />
</div>

{/* Add toggle button */}
<div className="tracer-controls">
  <label>
    <input
      type="checkbox"
      checked={showTracer}
      onChange={(e) => setShowTracer(e.target.checked)}
    />
    Show Tracer
  </label>
</div>
```

**Step 4: Add instruction banner based on step**

```typescript
<div className="instruction-banner">
  {reviewStep === 'marking_landing' && (
    <p>Click where the ball landed</p>
  )}
  {reviewStep === 'reviewing' && (
    <p>Review the trajectory. Adjust if needed, then approve or reject.</p>
  )}
</div>
```

**Step 5: Verify the build**

Run: `cd apps/browser && npm run build`
Expected: Build succeeds

**Step 6: Manual verification**

Run: `cd apps/browser && npm run dev`
Expected: Can click to mark landing, trajectory animates

**Step 7: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat(browser): wire up TrajectoryEditor with click-to-mark landing"
```

---

## Task 5: Add TracerConfigPanel

**Files:**
- Copy: `packages/frontend/src/components/TracerConfigPanel.tsx` → `apps/browser/src/components/TracerConfigPanel.tsx`
- Modify: `apps/browser/src/components/ClipReview.tsx`
- Modify: `apps/browser/src/App.css`

**Step 1: Copy TracerConfigPanel component**

Copy from desktop to browser. Remove API-related feedback props:

```typescript
// Simplified interface for browser:
interface TracerConfigPanelProps {
  config: TracerConfig
  onChange: (config: TracerConfig) => void
  onGenerate: () => void
  onMarkApex: () => void
  onMarkOrigin: () => void
  hasChanges: boolean
  apexMarked: boolean
  originMarked: boolean
  isGenerating: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
}
```

**Step 2: Copy TracerConfigPanel CSS**

Add to `App.css`:

```css
/* TracerConfigPanel */
.tracer-config-panel {
  background: #1a1a1a;
  border-radius: 8px;
  margin-bottom: 1rem;
  overflow: hidden;
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  background: #222;
  user-select: none;
}

.config-header:hover {
  background: #2a2a2a;
}

.config-header-title {
  font-weight: 500;
}

.config-header-icon {
  color: #888;
}

.config-body {
  padding: 1rem;
}

.config-row {
  margin-bottom: 1rem;
}

.config-row label {
  display: block;
  margin-bottom: 0.5rem;
  color: #888;
  font-size: 0.85rem;
}

.button-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn-option {
  padding: 0.5rem 1rem;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-option:hover:not(:disabled) {
  background: #3a3a3a;
}

.btn-option.active {
  background: #4ade80;
  color: #000;
  border-color: #4ade80;
}

.btn-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.slider-group {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.flight-time-slider {
  flex: 1;
  accent-color: #4ade80;
}

.flight-time-value {
  min-width: 3rem;
  text-align: right;
}

.config-actions {
  margin-top: 1.5rem;
  text-align: center;
}

.config-hint {
  color: #888;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.btn-generate {
  padding: 0.75rem 2rem;
}
```

**Step 3: Integrate into ClipReview**

Add state and handlers:

```typescript
const [showConfigPanel, setShowConfigPanel] = useState(false)
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
const [isMarkingApex, setIsMarkingApex] = useState(false)
const [isMarkingOrigin, setIsMarkingOrigin] = useState(false)

const handleConfigChange = (config: TracerConfig) => {
  setTracerConfig(config)
  setHasUnsavedChanges(true)
}

const handleGenerate = () => {
  if (!landingPoint) return
  const traj = generateTrajectory(landingPoint, tracerConfig, originPoint || undefined, apexPoint || undefined)
  setTrajectory(traj)
  setHasUnsavedChanges(false)
  if (currentShot) {
    updateSegment(currentShot.id, { trajectory: traj })
  }
}

const handleMarkApex = () => {
  setIsMarkingApex(true)
  setIsMarkingOrigin(false)
}

const handleMarkOrigin = () => {
  setIsMarkingOrigin(true)
  setIsMarkingApex(false)
}

// Update handleCanvasClick to handle apex/origin marking:
const handleCanvasClick = useCallback((x: number, y: number) => {
  if (isMarkingApex) {
    setApexPoint({ x, y })
    setIsMarkingApex(false)
    setHasUnsavedChanges(true)
  } else if (isMarkingOrigin) {
    setOriginPoint({ x, y })
    setIsMarkingOrigin(false)
    setHasUnsavedChanges(true)
  } else if (reviewStep === 'marking_landing') {
    setLandingPoint({ x, y })
    const traj = generateTrajectory({ x, y }, tracerConfig)
    setTrajectory(traj)
    setReviewStep('reviewing')
    if (currentShot) {
      updateSegment(currentShot.id, { landingPoint: { x, y }, trajectory: traj })
    }
  }
}, [reviewStep, tracerConfig, isMarkingApex, isMarkingOrigin, currentShot, updateSegment])
```

Add to JSX:

```typescript
{reviewStep === 'reviewing' && (
  <TracerConfigPanel
    config={tracerConfig}
    onChange={handleConfigChange}
    onGenerate={handleGenerate}
    onMarkApex={handleMarkApex}
    onMarkOrigin={handleMarkOrigin}
    hasChanges={hasUnsavedChanges}
    apexMarked={!!apexPoint}
    originMarked={!!originPoint}
    isGenerating={false}
    isCollapsed={!showConfigPanel}
    onToggleCollapse={() => setShowConfigPanel(!showConfigPanel)}
  />
)}
```

**Step 4: Verify the build**

Run: `cd apps/browser && npm run build`
Expected: Build succeeds

**Step 5: Manual verification**

Run: `cd apps/browser && npm run dev`
Expected: Config panel expands, options work, Generate updates trajectory

**Step 6: Commit**

```bash
git add apps/browser/src/components/TracerConfigPanel.tsx apps/browser/src/components/ClipReview.tsx apps/browser/src/App.css
git commit -m "feat(browser): add TracerConfigPanel for trajectory configuration"
```

---

## Task 6: Add Keyboard Shortcuts

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`
- Modify: `apps/browser/src/App.css`

**Step 1: Add keyboard handler**

Add to ClipReview:

```typescript
// Handler refs to avoid stale closures
const handleApproveRef = useRef<() => void>(() => {})
const handleRejectRef = useRef<() => void>(() => {})

// Keep refs updated
useEffect(() => {
  handleApproveRef.current = handleApprove
  handleRejectRef.current = handleReject
})

// Keyboard shortcuts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Ignore if typing in input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }

    switch (e.key) {
      case ' ':
        e.preventDefault()
        togglePlayPause()
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (e.shiftKey) {
          // Jump 1 second back
          if (videoRef.current) videoRef.current.currentTime -= 1
        } else {
          // Step one frame back (1/60 sec)
          if (videoRef.current) videoRef.current.currentTime -= 1/60
        }
        break
      case 'ArrowRight':
        e.preventDefault()
        if (e.shiftKey) {
          if (videoRef.current) videoRef.current.currentTime += 1
        } else {
          if (videoRef.current) videoRef.current.currentTime += 1/60
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        handlePrevious()
        break
      case 'ArrowDown':
        e.preventDefault()
        handleNext()
        break
      case 'Enter':
        e.preventDefault()
        if (reviewStep === 'reviewing' && trajectory) {
          handleApproveRef.current()
        }
        break
      case 'Escape':
      case 'Backspace':
        e.preventDefault()
        handleRejectRef.current()
        break
      case '[':
        if (videoRef.current && currentShot) {
          const newStart = Math.max(0, videoRef.current.currentTime)
          if (newStart < currentShot.clipEnd - 0.5) {
            handleTrimUpdate(newStart, currentShot.clipEnd)
          }
        }
        break
      case ']':
        if (videoRef.current && currentShot) {
          const newEnd = videoRef.current.currentTime
          if (newEnd > currentShot.clipStart + 0.5) {
            handleTrimUpdate(currentShot.clipStart, newEnd)
          }
        }
        break
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [currentIndex, totalShots, reviewStep, trajectory, currentShot])
```

**Step 2: Add keyboard hints UI**

Add to ClipReview JSX:

```typescript
<div className="keyboard-hints">
  <span><kbd>Space</kbd> Play/Pause</span>
  <span><kbd>←</kbd><kbd>→</kbd> Frame step</span>
  <span><kbd>Shift+←</kbd><kbd>→</kbd> 1 sec</span>
  <span><kbd>↑</kbd><kbd>↓</kbd> Prev/Next shot</span>
  <span><kbd>[</kbd><kbd>]</kbd> Set in/out</span>
  <span><kbd>Enter</kbd> Approve</span>
  <span><kbd>Esc</kbd> Reject</span>
</div>
```

**Step 3: Add CSS for hints**

```css
.keyboard-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: center;
  padding: 0.75rem;
  background: #1a1a1a;
  border-radius: 8px;
  font-size: 0.75rem;
  color: #666;
}

.keyboard-hints span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.keyboard-hints kbd {
  background: #333;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.7rem;
  color: #aaa;
  border: 1px solid #444;
}
```

**Step 4: Verify the build**

Run: `cd apps/browser && npm run build`
Expected: Build succeeds

**Step 5: Manual verification**

Run: `cd apps/browser && npm run dev`
Test each shortcut:
- Space toggles play/pause
- Arrow keys step frames
- Up/Down navigate shots
- Enter approves
- Escape rejects

**Step 6: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx apps/browser/src/App.css
git commit -m "feat(browser): add keyboard shortcuts for clip review"
```

---

## Task 7: Add Export Functionality

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`
- Modify: `apps/browser/src/App.css`

**Step 1: Add export state**

```typescript
const [showExportModal, setShowExportModal] = useState(false)
const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 })
const [exportComplete, setExportComplete] = useState(false)
```

**Step 2: Add export function**

```typescript
const handleExport = async () => {
  const approved = segments.filter(s => s.approved)
  if (approved.length === 0) {
    onComplete()
    return
  }

  setShowExportModal(true)
  setExportProgress({ current: 0, total: approved.length })

  // Download each approved clip
  for (let i = 0; i < approved.length; i++) {
    const segment = approved[i]
    setExportProgress({ current: i + 1, total: approved.length })

    // Create download link
    const a = document.createElement('a')
    a.href = segment.objectUrl
    a.download = `shot_${i + 1}.webm`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Small delay between downloads
    await new Promise(r => setTimeout(r, 500))
  }

  setExportComplete(true)
}
```

**Step 3: Update onComplete handler**

```typescript
const handleReviewComplete = () => {
  handleExport()
}

// Update handleApprove:
if (currentIndex >= shotsNeedingReview.length - 1) {
  handleExport()  // Changed from onComplete()
}
```

**Step 4: Add export modal**

```typescript
{showExportModal && (
  <div className="export-modal-overlay">
    <div className="export-modal">
      {!exportComplete ? (
        <>
          <h3>Exporting Clips</h3>
          <p>Downloading {exportProgress.current} of {exportProgress.total}...</p>
          <div className="export-progress-bar">
            <div
              className="export-progress-fill"
              style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <h3>Export Complete!</h3>
          <p>{exportProgress.total} clips downloaded</p>
          <button onClick={() => { setShowExportModal(false); onComplete() }} className="btn-primary">
            Done
          </button>
        </>
      )}
    </div>
  </div>
)}
```

**Step 5: Add CSS**

```css
.export-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.export-modal {
  background: #1a1a1a;
  padding: 2rem;
  border-radius: 12px;
  text-align: center;
  min-width: 300px;
}

.export-modal h3 {
  color: #4ade80;
  margin-bottom: 1rem;
}

.export-progress-bar {
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
  margin-top: 1rem;
}

.export-progress-fill {
  height: 100%;
  background: #4ade80;
  transition: width 0.3s ease;
}
```

**Step 6: Verify the build**

Run: `cd apps/browser && npm run build`
Expected: Build succeeds

**Step 7: Manual verification**

Run: `cd apps/browser && npm run dev`
Expected: After reviewing all shots, export modal appears and clips download

**Step 8: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx apps/browser/src/App.css
git commit -m "feat(browser): add export functionality with progress modal"
```

---

## Task 8: Final Integration & Polish

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`
- Modify: `apps/browser/src/App.css`

**Step 1: Add auto-loop for clip playback**

```typescript
const [autoLoopEnabled, setAutoLoopEnabled] = useState(true)
const loopTimeoutRef = useRef<number | null>(null)

// In timeupdate handler:
useEffect(() => {
  const video = videoRef.current
  if (!video || !currentShot) return

  const handleTimeUpdate = () => {
    setCurrentTime(video.currentTime)

    // Auto-loop: pause at clip end, wait 750ms, restart
    if (video.currentTime >= currentShot.clipEnd && !video.paused && autoLoopEnabled) {
      video.pause()
      setIsPlaying(false)

      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current)
      loopTimeoutRef.current = window.setTimeout(() => {
        if (videoRef.current && autoLoopEnabled) {
          videoRef.current.currentTime = currentShot.clipStart
          videoRef.current.play().catch(() => {})
          setIsPlaying(true)
        }
      }, 750)
    }
  }

  video.addEventListener('timeupdate', handleTimeUpdate)
  return () => {
    video.removeEventListener('timeupdate', handleTimeUpdate)
    if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current)
  }
}, [currentShot, autoLoopEnabled])
```

**Step 2: Add auto-loop toggle**

```typescript
<label className="auto-loop-toggle">
  <input
    type="checkbox"
    checked={autoLoopEnabled}
    onChange={(e) => setAutoLoopEnabled(e.target.checked)}
  />
  Auto-loop clip
</label>
```

**Step 3: Add instruction banner styling**

```css
.instruction-banner {
  background: linear-gradient(90deg, #4ade8020, transparent);
  border-left: 3px solid #4ade80;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  border-radius: 0 6px 6px 0;
}

.instruction-banner p {
  margin: 0;
  color: #4ade80;
}
```

**Step 4: Run full build**

Run: `cd apps/browser && npm run build`
Expected: Build succeeds with no errors

**Step 5: Full manual verification checklist**

Run: `cd apps/browser && npm run dev`

Verify:
- [ ] Upload video → processing → review screen
- [ ] Shot navigation (← → buttons, ↑↓ keys)
- [ ] Video plays with click, Space toggles
- [ ] Scrubber: drag handles to trim
- [ ] Click to mark landing point
- [ ] Trajectory animates over video
- [ ] Config panel: adjust height/shape/line/time
- [ ] Generate button updates trajectory
- [ ] Mark apex/origin buttons work
- [ ] Approve/Reject buttons work
- [ ] Keyboard shortcuts all work
- [ ] Export downloads approved clips
- [ ] Auto-loop cycles clip playback

**Step 6: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx apps/browser/src/App.css
git commit -m "feat(browser): complete ClipReview with auto-loop and polish"
```

---

## Verification Summary

After completing all tasks, run the full verification:

```bash
cd apps/browser
npm run build        # Should pass
npm run dev          # Manual testing
```

Test video: Use a file from `video files/` folder in the golf-clip project.

All features should match the desktop app:
1. Shot detection → review workflow
2. Scrubber for trimming
3. Trajectory marking and rendering
4. Configuration panel
5. Keyboard shortcuts
6. Export with progress

---

## Notes

- The browser app uses client-side processing (no API)
- Trajectories are generated with a mock bezier curve algorithm
- Export is download-based (no server-side rendering)
- TrajectoryEditor already exists and just needs wiring
- CSS is duplicated from desktop; consider extracting shared styles later
