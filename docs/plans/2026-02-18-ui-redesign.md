# UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the GolfClip review UI with 6 changes: remove confirm dialog, remove header, add upload walkthrough illustrations, add strike indicators on scrubber, two-column trajectory settings, and reposition approve/reject buttons.

**Architecture:** All changes are in `apps/browser/`. Changes 1-2 remove code, changes 3-6 add/modify UI. Changes are ordered to minimize conflicts — removals first, then layout changes, then new features.

**Tech Stack:** React 18 + TypeScript + CSS custom properties (no CSS-in-JS)

---

### Task 1: Remove skip shot confirmation dialog

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Remove ConfirmDialog import and all related state/logic**

In `ClipReview.tsx`, remove:

1. Line 7 — Remove the ConfirmDialog import:
```tsx
// DELETE: import { ConfirmDialog } from './ConfirmDialog'
```

2. Line 116 — Remove `showRejectConfirm` state:
```tsx
// DELETE: const [showRejectConfirm, setShowRejectConfirm] = useState(false)
```

3. Line 291 — Remove from reset effect:
```tsx
// DELETE: setShowRejectConfirm(false)
```

4. Lines 682-685 — Remove `handleRejectWithConfirm` wrapper:
```tsx
// DELETE: const handleRejectWithConfirm = useCallback(() => {
//   setShowRejectConfirm(true)
// }, [])
```

5. Line 690 — Change `setHandlers` to use `handleReject` directly (note: this will be removed entirely in Task 3, but for now):
```tsx
// Change from: setHandlers(handleApprove, handleRejectWithConfirm)
// Change to:   setHandlers(handleApprove, handleReject)
```

6. Lines 854-858 — Change Escape handler to reject directly:
```tsx
// Change from:
//   case 'Escape':
//     e.preventDefault()
//     if (!showRejectConfirm) {
//       setShowRejectConfirm(true)
//     }
//     break
// Change to:
case 'Escape':
  e.preventDefault()
  handleReject()
  break
```

7. Line 907 — Remove `showRejectConfirm` from keyboard effect deps.

8. Line 1046 — Change button onClick to use handleReject directly:
```tsx
// Change from: onClick={() => setShowRejectConfirm(true)}
// Change to:   onClick={handleReject}
```

9. Lines 1374-1386 — Remove the entire ConfirmDialog render block:
```tsx
// DELETE entire block:
// {showRejectConfirm && (
//   <ConfirmDialog ... />
// )}
```

**Step 2: Verify**

Run: `cd apps/browser && npx tsc --noEmit`
Expected: No type errors

Run: `cd apps/browser && npm run test -- --run`
Expected: All tests pass (some ConfirmDialog-specific tests may need updates)

**Step 3: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "Remove skip shot confirmation dialog — reject immediately"
```

---

### Task 2: Remove header and distribute content

**Files:**
- Modify: `apps/browser/src/App.tsx`
- Modify: `apps/browser/src/styles/global.css`

**Step 1: Modify App.tsx — remove header, add title to upload screen**

Replace the current App.tsx return block. The header is removed entirely. "GolfClip" title becomes part of the upload view. "New Video" button only shows on export-complete. VideoQueue stays imported but moves to inline usage in review (handled by ClipReview in Task 3).

```tsx
return (
  <div className="app">
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
        <>
          <h1 className="app-title">GolfClip</h1>
          <div className="about-box">
            <p>
              GolfClip is a vibe-coded golf video editing platform to address two pain points:
            </p>
            <ol>
              <li>Editing long videos into short, relevant clips (centered around club impact) is tedious and time consuming.</li>
              <li>Adding animated tracers to golf clips is challenging and time consuming.</li>
            </ol>
            <p className="about-box-disclaimer">
              GolfClip is not intended as a production app. It is an experiment to test whether Claude Code can build technically complicated, compute intensive, domain specific software. No code was manually written for GolfClip.
            </p>
          </div>
          <VideoDropzone />
        </>
      )}

      {view === 'review' && (
        <ClipReview onComplete={handleReviewComplete} />
      )}

      {view === 'export' && (
        <div className="export-complete">
          <div className="review-complete-icon">OK</div>
          <h2>Review Complete!</h2>
          <p className="export-message">
            {approvedCount} {approvedCount === 1 ? 'shot' : 'shots'} approved
          </p>
          <button onClick={handleReset} className="btn-primary btn-large">
            Process Another Video
          </button>
        </div>
      )}
    </main>
  </div>
)
```

Remove the `ReviewActions` import and `VideoQueue` import from App.tsx (VideoQueue will be imported by ClipReview if needed later).

**Step 2: Add CSS for the standalone title**

In `global.css`, add after the `.app` rule (~line 62):

```css
.app-title {
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
  color: var(--color-text);
  margin: var(--spacing-xl) 0 var(--spacing-md);
  letter-spacing: -0.02em;
}
```

**Step 3: Verify**

Run: `cd apps/browser && npx tsc --noEmit`
Run: `cd apps/browser && npm run dev` — visually verify header is gone, title shows on upload screen

**Step 4: Commit**

```bash
git add apps/browser/src/App.tsx apps/browser/src/styles/global.css
git commit -m "Remove app header, show GolfClip title on upload screen only"
```

---

### Task 3: Remove ReviewActions component and reviewActionsStore bridge

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`
- Delete: `apps/browser/src/components/ReviewActions.tsx`
- Delete: `apps/browser/src/stores/reviewActionsStore.ts`
- Modify: `apps/browser/src/styles/global.css`

**Step 1: Remove reviewActionsStore usage from ClipReview**

In `ClipReview.tsx`, remove:

1. The import:
```tsx
// DELETE: import { useReviewActionsStore } from '../stores/reviewActionsStore'
```

2. The store hook call and all three registration effects (~lines 688-700):
```tsx
// DELETE all of this:
// const { setHandlers, setCanApprove, setProgress, clearHandlers } = useReviewActionsStore()
// useEffect(() => {
//   setHandlers(handleApprove, handleReject)
//   return () => clearHandlers()
// }, [handleApprove, handleReject, setHandlers, clearHandlers])
//
// useEffect(() => {
//   setCanApprove(reviewStep === 'reviewing')
// }, [reviewStep, setCanApprove])
//
// useEffect(() => {
//   setProgress(currentIndex, totalShots)
// }, [currentIndex, totalShots, setProgress])
```

**Step 2: Delete ReviewActions.tsx and reviewActionsStore.ts**

```bash
rm apps/browser/src/components/ReviewActions.tsx
rm apps/browser/src/stores/reviewActionsStore.ts
```

**Step 3: Remove header-specific CSS rules from global.css**

Remove all `.app-header` rules (lines 64-137 approximately):
- `.app-header { ... }`
- `.app-header .video-queue { ... }`
- `.app-header .video-queue-title { ... }`
- `.app-header .video-queue-list { ... }`
- `.app-header .queue-item { ... }`
- `.app-header .review-header-info { ... }`
- `.app-header .review-title { ... }`
- `.app-header .review-progress { ... }`
- `.app-header .review-actions { ... }`
- `.app-header .review-actions .btn-no-shot, .app-header .review-actions .btn-primary { ... }`
- `.app-header h1 { ... }`
- And the corresponding mobile breakpoint rules for `.app-header`

**Step 4: Verify**

Run: `cd apps/browser && npx tsc --noEmit`
Run: `cd apps/browser && npm run test -- --run`

**Step 5: Commit**

```bash
git add -A
git commit -m "Remove ReviewActions component and reviewActionsStore bridge"
```

---

### Task 4: Reorder ClipReview layout — move buttons between config and video

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Reorder the JSX in ClipReview's main return**

The new order (within `<div className="clip-review">`):

```tsx
<div className="clip-review">
  {/* 1. Review header with shot counter */}
  <div className="review-header">
    <span className="review-title">Review Shots</span>
    <span className="review-progress">{currentIndex + 1} of {totalShots}</span>
  </div>

  {/* Non-blocking feedback error banner */}
  {feedbackError && (
    <div className="feedback-error" role="alert">
      <span>{feedbackError}</span>
      <button className="error-dismiss" onClick={() => setFeedbackError(null)} aria-label="Dismiss">✕</button>
    </div>
  )}

  {/* 2. TracerConfigPanel (when in reviewing step) */}
  {reviewStep === 'reviewing' && (
    <TracerConfigPanel
      config={tracerConfig}
      onChange={handleConfigChange}
      style={tracerStyle}
      onStyleChange={handleStyleChange}
      onGenerate={handleGenerate}
      onMarkApex={handleMarkApex}
      onMarkOrigin={handleMarkOrigin}
      onMarkLanding={handleMarkLanding}
      hasChanges={hasUnsavedChanges}
      apexMarked={!!apexPoint}
      originMarked={!!originPoint}
      landingMarked={!!landingPoint}
      isMarkingLanding={isMarkingLanding}
      isGenerating={isGenerating}
      isCollapsed={!showConfigPanel}
      onToggleCollapse={() => setShowConfigPanel(!showConfigPanel)}
      onSetImpactTime={handleSetImpactTime}
      impactTime={currentShot ? currentShot.strikeTime - currentShot.startTime : 0}
      impactTimeAdjusted={impactTimeAdjusted}
    />
  )}

  {/* 3. Review action buttons */}
  <div className="review-actions">
    <button onClick={handleReject} className="btn-no-shot">
      ✕ No Golf Shot
    </button>
    <button
      onClick={handleApprove}
      className="btn-primary btn-large"
      disabled={reviewStep !== 'reviewing'}
    >
      ✓ Approve Shot
    </button>
  </div>

  {/* 4. Instruction banner */}
  <div className="marking-instruction">
    {reviewStep === 'marking_landing' && (
      <>
        <span className="step-badge">Step 1</span>
        <span className="instruction-text">Click where the ball landed</span>
      </>
    )}
    {reviewStep === 'reviewing' && (
      <>
        <span className="step-badge complete">Ready</span>
        <span className="instruction-text">Review the trajectory, then approve or reject</span>
      </>
    )}
  </div>

  {/* 5. Video player */}
  <div
    ref={videoContainerRef}
    className={`video-container${zoomLevel > 1 ? ' zoomed' : ''}${isPanning ? ' panning' : ''}`}
    onPointerDown={handlePanStart}
    onPointerMove={handlePanMove}
    onPointerUp={handlePanEnd}
    onPointerLeave={handlePanEnd}
  >
    {/* ... video + TrajectoryEditor unchanged ... */}
  </div>

  {zoomLevel > 1 && (
    <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-secondary)', margin: '2px 0' }}>
      {zoomLevel.toFixed(1)}x zoom — drag to pan, press 0 to reset
    </div>
  )}

  {/* 6. Transport controls */}
  <div className="video-transport-controls" style={{ display: 'flex', justifyContent: 'center', gap: '4px', margin: '8px 0' }}>
    {/* ... buttons unchanged ... */}
  </div>

  {/* 7. Scrubber */}
  <Scrubber
    videoRef={videoRef}
    startTime={currentShot.clipStart - currentShot.startTime}
    endTime={currentShot.clipEnd - currentShot.startTime}
    videoDuration={currentShot.endTime - currentShot.startTime}
    onTimeUpdate={(newStart, newEnd) => {
      handleTrimUpdate(newStart + currentShot.startTime, newEnd + currentShot.startTime)
    }}
  />

  {/* 8. Playback options */}
  <div className="tracer-controls">
    {/* ... mute, auto-loop, show tracer unchanged ... */}
  </div>

  {/* 9. Confidence info */}
  <div className="confidence-info">
    {/* ... unchanged ... */}
  </div>

  {/* 10. Keyboard hints */}
  <div className="keyboard-hints">
    {/* ... unchanged ... */}
  </div>

  {/* Export Modal — unchanged */}
  {/* No more ConfirmDialog */}
</div>
```

The key change is: TracerConfigPanel moves ABOVE the review-actions buttons, which move ABOVE the marking-instruction.

**Step 2: Verify**

Run: `cd apps/browser && npx tsc --noEmit`
Run: `cd apps/browser && npm run dev` — visually confirm new layout order

**Step 3: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "Reorder ClipReview layout — config then buttons then instruction then video"
```

---

### Task 5: Two-column trajectory settings

**Files:**
- Modify: `apps/browser/src/components/TracerConfigPanel.tsx`
- Modify: `apps/browser/src/styles/global.css`

**Step 1: Restructure TracerConfigPanel body into two columns**

In `TracerConfigPanel.tsx`, wrap the config rows in a two-column grid. Replace the `<div className="config-body">` contents with:

```tsx
<div className="config-body">
  <div className="config-grid">
    {/* Left column: trajectory shape controls */}
    <div className="config-column">
      {/* Shot Height */}
      <div className="config-row">
        <label>Shot Height</label>
        <div className="button-group">
          {heightOptions.map((opt) => (
            <button key={opt.value} type="button" className={`btn-option ${config.height === opt.value ? 'active' : ''}`} onClick={() => handleHeightChange(opt.value)} disabled={isGenerating}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Shot Shape */}
      <div className="config-row">
        <label>Shot Shape</label>
        <div className="button-group">
          {shapeOptions.map((opt) => (
            <button key={opt.value} type="button" className={`btn-option ${config.shape === opt.value ? 'active' : ''}`} onClick={() => handleShapeChange(opt.value)} disabled={isGenerating}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Flight Time */}
      <div className="config-row">
        <label>Flight Time</label>
        <div className="slider-group">
          <input type="range" min={1} max={10} step={0.1} value={config.flightTime} onChange={handleFlightTimeChange} disabled={isGenerating} className="flight-time-slider" />
          <span className="flight-time-value">{config.flightTime.toFixed(1)}s</span>
        </div>
      </div>
    </div>

    {/* Right column: point markers */}
    <div className="config-column">
      {/* Origin Point */}
      <div className="config-row">
        <label>Origin Point</label>
        <button type="button" className={`btn-option btn-origin ${originMarked ? 'marked' : ''}`} onClick={onMarkOrigin} disabled={isGenerating} title={originMarked ? 'Click to re-mark where ball starts' : 'Click to mark where ball starts on video'}>
          {originMarked ? 'Re-mark Origin' : 'Mark on Video'}
        </button>
        <span className="optional-hint">(if auto wrong)</span>
      </div>

      {/* Impact Time */}
      {onSetImpactTime && (
        <div className="config-row">
          <label>Impact Time</label>
          <button type="button" className={`btn-option btn-impact ${impactTimeAdjusted ? 'marked' : ''}`} onClick={onSetImpactTime} disabled={isGenerating} title={`Current: ${formatTime(impactTime ?? 0)} - Click to set to current video position`}>
            {impactTimeAdjusted ? `Adjusted: ${formatTime(impactTime ?? 0)}` : 'Set to Playhead'}
          </button>
          <span className="optional-hint">(if auto wrong)</span>
        </div>
      )}

      {/* Landing Point */}
      {onMarkLanding && (
        <div className="config-row">
          <label>Landing Point</label>
          <button type="button" className={`btn-option btn-landing ${landingMarked ? 'marked' : ''}`} onClick={onMarkLanding} disabled={isGenerating || isMarkingLanding} title={landingMarked ? 'Click to re-mark where ball landed' : 'Click to mark where ball landed on video'}>
            {isMarkingLanding ? 'Click on video...' : landingMarked ? 'Re-mark Landing' : 'Mark on Video'}
          </button>
        </div>
      )}

      {/* Apex Point */}
      <div className="config-row">
        <label>Apex Point</label>
        <button type="button" className={`btn-option btn-apex ${apexMarked ? 'marked' : ''}`} onClick={onMarkApex} disabled={isGenerating} title={apexMarked ? 'Click to re-mark apex point' : 'Click to mark apex point on video'}>
          {apexMarked ? 'Re-mark Apex' : 'Mark on Video'}
        </button>
        <span className="optional-hint">(optional)</span>
      </div>
    </div>
  </div>

  {/* Style options toggle - full width below grid */}
  <div className="config-row">
    <button type="button" className="btn-link" onClick={() => setShowStyleOptions(!showStyleOptions)} style={{ marginLeft: 0 }}>
      {showStyleOptions ? 'Hide Style Options' : 'Show Style Options'}
    </button>
  </div>

  {/* ... style options unchanged ... */}

  {/* Generate Button - full width */}
  <div className="config-actions">
    {hasChanges && (
      <p className="config-hint">Click Generate to see updated tracer</p>
    )}
    <button type="button" className="btn-primary btn-generate" onClick={onGenerate} disabled={isGenerating}>
      {isGenerating ? (<><span className="spinner" />Generating...</>) : ('Generate')}
    </button>
  </div>
</div>
```

**Step 2: Add CSS grid styles**

In `global.css`, modify the `.config-body` rule and add new rules:

```css
.config-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-md) var(--spacing-lg);
}

.config-column {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

/* Make config-row stack vertically within columns to save space */
.config-grid .config-row {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-xs);
}

@media (max-width: 600px) {
  .config-grid {
    grid-template-columns: 1fr;
  }
}
```

**Step 3: Verify**

Run: `cd apps/browser && npx tsc --noEmit`
Run: `cd apps/browser && npm run dev` — verify two-column layout renders correctly

**Step 4: Commit**

```bash
git add apps/browser/src/components/TracerConfigPanel.tsx apps/browser/src/styles/global.css
git commit -m "Two-column layout for trajectory settings panel"
```

---

### Task 6: Strike indicator on timeline scrubber

**Files:**
- Modify: `apps/browser/src/components/Scrubber.tsx`
- Modify: `apps/browser/src/components/ClipReview.tsx`
- Modify: `apps/browser/src/styles/global.css`

**Step 1: Add `originalStrikeTime` and `strikeTime` props to Scrubber**

In `Scrubber.tsx`, update the interface and component:

```tsx
interface ScrubberProps {
  videoRef: RefObject<HTMLVideoElement>
  startTime: number
  endTime: number
  onTimeUpdate: (start: number, end: number) => void
  disabled?: boolean
  videoDuration?: number
  // Strike time indicators
  originalStrikeTime?: number  // Initial auto-detected strike time (orange)
  strikeTime?: number          // Current (possibly adjusted) strike time (green)
}
```

Add to destructuring:
```tsx
export function Scrubber({
  videoRef, startTime, endTime, onTimeUpdate, disabled = false, videoDuration,
  originalStrikeTime, strikeTime,
}: ScrubberProps) {
```

**Step 2: Render strike indicators below the scrubber track**

After the `{/* Playhead */}` div and before the closing `</div>` of the scrubber, add:

```tsx
{/* Strike time indicators */}
{strikeTime !== undefined && (
  <div className="scrubber-strike-indicators">
    {/* Original detection (orange) - only show if different from current */}
    {originalStrikeTime !== undefined && Math.abs(originalStrikeTime - strikeTime) > 0.05 && (
      <div
        className="strike-indicator strike-indicator-original"
        style={{ left: `${timeToPosition(originalStrikeTime)}%` }}
        title={`Original detection: ${formatTime(originalStrikeTime)}`}
      />
    )}
    {/* Current impact time (green) */}
    <div
      className="strike-indicator strike-indicator-current"
      style={{ left: `${timeToPosition(strikeTime)}%` }}
      title={`Impact time: ${formatTime(strikeTime)}`}
    />
  </div>
)}
```

Place this inside the `.scrubber` div, after the playhead but before the closing tag.

**Step 3: Pass strike times from ClipReview**

In `ClipReview.tsx`, update the `<Scrubber>` call to include strike times:

```tsx
<Scrubber
  videoRef={videoRef}
  startTime={currentShot.clipStart - currentShot.startTime}
  endTime={currentShot.clipEnd - currentShot.startTime}
  videoDuration={currentShot.endTime - currentShot.startTime}
  originalStrikeTime={currentShot.strikeTime - currentShot.startTime}
  strikeTime={currentShot.strikeTime - currentShot.startTime}
  onTimeUpdate={(newStart, newEnd) => {
    handleTrimUpdate(newStart + currentShot.startTime, newEnd + currentShot.startTime)
  }}
/>
```

Note: `originalStrikeTime` and `strikeTime` will be the same until the user adjusts impact time. To track the original, we need to store it. In ClipReview, add a ref to capture the original strike time when the shot first loads:

```tsx
const originalStrikeTimeRef = useRef<number>(0)
```

In the reset effect (where `currentShot?.id` changes):
```tsx
// Store original strike time for comparison
if (currentShot) {
  originalStrikeTimeRef.current = currentShot.strikeTime
}
```

Then pass to Scrubber:
```tsx
originalStrikeTime={originalStrikeTimeRef.current - currentShot.startTime}
strikeTime={currentShot.strikeTime - currentShot.startTime}
```

**Step 4: Add CSS for strike indicators**

In `global.css`, after the `.scrubber-clip-info` rules:

```css
/* Strike time indicators */
.scrubber-strike-indicators {
  position: absolute;
  bottom: -6px;
  left: 0;
  right: 0;
  height: 12px;
  pointer-events: none;
}

.strike-indicator {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transform: translateX(-50%);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
  cursor: help;
}

.strike-indicator-original {
  background-color: var(--color-warning);
  opacity: 0.8;
  z-index: 1;
}

.strike-indicator-current {
  background-color: var(--color-primary);
  z-index: 2;
}
```

Also need to make `.scrubber` position relative so the absolute indicator positions correctly. Check if it already is — if not, add `position: relative;` to `.scrubber`.

**Step 5: Verify**

Run: `cd apps/browser && npx tsc --noEmit`
Run: `cd apps/browser && npm run dev` — load a video, verify green dot appears at strike time on scrubber

**Step 6: Commit**

```bash
git add apps/browser/src/components/Scrubber.tsx apps/browser/src/components/ClipReview.tsx apps/browser/src/styles/global.css
git commit -m "Add strike time indicators below timeline scrubber"
```

---

### Task 7: Upload screen walkthrough illustrations

**Files:**
- Create: `apps/browser/src/components/WalkthroughSteps.tsx`
- Modify: `apps/browser/src/App.tsx`
- Modify: `apps/browser/src/styles/global.css`

**Step 1: Create WalkthroughSteps component**

Create `apps/browser/src/components/WalkthroughSteps.tsx`:

```tsx
export function WalkthroughSteps() {
  return (
    <div className="walkthrough-steps">
      <div className="walkthrough-step">
        <div className="walkthrough-number">1</div>
        <div className="walkthrough-illustration walkthrough-upload">
          <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="15" width="100" height="55" rx="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.4" />
            <path d="M60 30 L60 55" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M50 40 L60 30 L70 40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="42" y="58" width="36" height="8" rx="4" fill="currentColor" opacity="0.2" />
          </svg>
        </div>
        <h3>Upload Video</h3>
        <p>Drop your golf video or select a file</p>
      </div>

      <div className="walkthrough-step">
        <div className="walkthrough-number">2</div>
        <div className="walkthrough-illustration walkthrough-tracer">
          <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Video frame */}
            <rect x="10" y="10" width="100" height="60" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
            {/* Golfer silhouette */}
            <circle cx="30" cy="45" r="4" fill="currentColor" opacity="0.3" />
            <path d="M30 49 L30 62" stroke="currentColor" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
            {/* Trajectory arc */}
            <path d="M32 55 Q60 15 90 50" stroke="#4ade80" strokeWidth="2" fill="none" strokeLinecap="round" />
            {/* Landing dot */}
            <circle cx="90" cy="50" r="3" fill="#4ade80" />
          </svg>
        </div>
        <h3>Mark Tracers</h3>
        <p>Click landing points and review shot tracers</p>
      </div>

      <div className="walkthrough-step">
        <div className="walkthrough-number">3</div>
        <div className="walkthrough-illustration walkthrough-export">
          <svg viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* File icon */}
            <path d="M40 15 L75 15 L85 25 L85 65 L40 65 Z" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
            <path d="M75 15 L75 25 L85 25" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
            {/* MP4 text */}
            <text x="62" y="48" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="600" opacity="0.5">.MP4</text>
            {/* Download arrow */}
            <path d="M62 55 L62 72" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" />
            <path d="M55 66 L62 72 L69 66" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3>Export Clips</h3>
        <p>Download clips with tracers burned in</p>
      </div>
    </div>
  )
}
```

**Step 2: Add to App.tsx upload view**

Update the upload view to use a two-column layout:

```tsx
{view === 'upload' && !error && (
  <>
    <h1 className="app-title">GolfClip</h1>
    <div className="upload-layout">
      <WalkthroughSteps />
      <div className="upload-content">
        <div className="about-box">
          <p>
            GolfClip is a vibe-coded golf video editing platform to address two pain points:
          </p>
          <ol>
            <li>Editing long videos into short, relevant clips (centered around club impact) is tedious and time consuming.</li>
            <li>Adding animated tracers to golf clips is challenging and time consuming.</li>
          </ol>
          <p className="about-box-disclaimer">
            GolfClip is not intended as a production app. It is an experiment to test whether Claude Code can build technically complicated, compute intensive, domain specific software. No code was manually written for GolfClip.
          </p>
        </div>
        <VideoDropzone />
      </div>
    </div>
  </>
)}
```

Import: `import { WalkthroughSteps } from './components/WalkthroughSteps'`

**Step 3: Add CSS**

```css
/* Upload screen layout */
.upload-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: var(--spacing-xl);
  max-width: 1000px;
  margin: 0 auto;
  padding: 0 var(--spacing-lg);
  align-items: start;
}

.upload-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

/* Walkthrough steps */
.walkthrough-steps {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding-top: var(--spacing-md);
}

.walkthrough-step {
  text-align: center;
}

.walkthrough-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background-color: var(--color-primary);
  color: var(--color-bg);
  font-weight: 700;
  font-size: 0.85rem;
  margin-bottom: var(--spacing-sm);
}

.walkthrough-illustration {
  width: 100%;
  max-width: 180px;
  margin: 0 auto var(--spacing-sm);
  color: var(--color-text-secondary);
}

.walkthrough-illustration svg {
  width: 100%;
  height: auto;
}

.walkthrough-step h3 {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 4px;
}

.walkthrough-step p {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

@media (max-width: 700px) {
  .upload-layout {
    grid-template-columns: 1fr;
  }

  .walkthrough-steps {
    flex-direction: row;
    justify-content: center;
    gap: var(--spacing-md);
    padding-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--color-bg-tertiary);
    margin-bottom: var(--spacing-md);
  }

  .walkthrough-step {
    flex: 1;
    max-width: 160px;
  }

  .walkthrough-illustration {
    max-width: 100px;
  }
}
```

**Step 4: Verify**

Run: `cd apps/browser && npx tsc --noEmit`
Run: `cd apps/browser && npm run dev` — verify two-column layout with illustrations on left

**Step 5: Commit**

```bash
git add apps/browser/src/components/WalkthroughSteps.tsx apps/browser/src/App.tsx apps/browser/src/styles/global.css
git commit -m "Add walkthrough illustration steps to upload screen"
```

---

### Task 8: Final cleanup and test run

**Files:**
- Possibly modify: any files with leftover references

**Step 1: Full type check**

Run: `cd apps/browser && npx tsc --noEmit`
Fix any remaining type errors.

**Step 2: Run all tests**

Run: `cd apps/browser && npm run test -- --run`
Fix any failing tests (likely ConfirmDialog and ReviewActions test references).

**Step 3: Visual verification**

Run: `cd apps/browser && npm run dev`

Verify each change:
- [ ] Upload screen: title, walkthrough illustrations on left, dropzone on right
- [ ] Upload screen mobile: illustrations collapse to horizontal strip
- [ ] No header visible on any screen
- [ ] Review: config panel shows before buttons
- [ ] Review: config panel is two columns
- [ ] Review: buttons between config and video
- [ ] Review: instruction banner below buttons
- [ ] Review: scrubber has green strike indicator dot
- [ ] Review: "No Golf Shot" rejects immediately (no confirm dialog)
- [ ] Review: Escape key rejects immediately
- [ ] Export-complete: "Process Another Video" button present

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "Fix tests and cleanup after UI redesign"
```
