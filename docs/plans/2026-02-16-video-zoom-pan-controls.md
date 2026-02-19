# Video Zoom and Pan Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add keyboard-driven zoom (1x-4x) and mouse-drag panning to the clip review video player for precise marker placement on high-resolution video.

**Architecture:** CSS `transform: scale() translate()` applied to a wrapper div around the `<video>` and `<TrajectoryEditor>` canvas. Zoom/pan state lives in ClipReview and is passed to TrajectoryEditor for coordinate conversion adjustments. Drag-to-pan uses pointer events on the video container when zoomed >1x and not in a marking mode.

**Tech Stack:** React 18, TypeScript, CSS transforms, Vitest + Testing Library

**Total Tasks:** 9 (6 implementation + 3 verification)

---

### Task 1: Add zoom/pan state and keyboard shortcuts to ClipReview

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx:63-65` (state declarations)
- Modify: `apps/browser/src/components/ClipReview.tsx:274-294` (shot change reset effect)
- Modify: `apps/browser/src/components/ClipReview.tsx:722-811` (keyboard handler)

**Step 1: Add state variables after line 65**

In ClipReview.tsx, after `const videoRef = useRef<HTMLVideoElement>(null)` (line 65), add:

```typescript
// Zoom and pan state
const [zoomLevel, setZoomLevel] = useState(1)
const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
const [isPanning, setIsPanning] = useState(false)
const panStartRef = useRef({ x: 0, y: 0 })
```

**Step 2: Reset zoom/pan when shot changes**

In the `useEffect` that resets marking state when shot changes (line 274, depends on `currentShot?.id`), add after `setImpactTimeAdjusted(false)`:

```typescript
setZoomLevel(1)
setPanOffset({ x: 0, y: 0 })
```

**Step 3: Add keyboard shortcuts to the existing keydown handler**

In the `handleKeyDown` switch statement (line 730), add cases before the closing `}`:

```typescript
case '=':
case '+':
  e.preventDefault()
  setZoomLevel(prev => Math.min(4, prev + 0.5))
  break
case '-':
  e.preventDefault()
  setZoomLevel(prev => {
    const next = Math.max(1, prev - 0.5)
    if (next === 1) setPanOffset({ x: 0, y: 0 })
    return next
  })
  break
case '0':
  e.preventDefault()
  setZoomLevel(1)
  setPanOffset({ x: 0, y: 0 })
  break
```

**Step 4: Run existing tests to confirm no regressions**

Run: `cd apps/browser && npx vitest run`
Expected: All existing tests pass.

**Step 5: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat: add zoom/pan state and keyboard shortcuts (+/-/0)"
```

---

### Task 2: Wrap video + canvas in zoom transform div

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx:1001-1045` (video-container JSX)

**Step 1: Add zoom content wrapper inside video-container**

Replace the `<div className="video-container">` block (lines 1001-1045) with a version that adds a `video-zoom-content` wrapper div around the video element and TrajectoryEditor. The wrapper gets the CSS transform:

```tsx
<div
  className={`video-container${zoomLevel > 1 ? ' zoomed' : ''}${isPanning ? ' panning' : ''}`}
  onPointerDown={handlePanStart}
  onPointerMove={handlePanMove}
  onPointerUp={handlePanEnd}
  onPointerLeave={handlePanEnd}
>
  <div
    className="video-zoom-content"
    style={{
      transform: zoomLevel > 1
        ? `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`
        : undefined,
    }}
  >
    {videoError ? (
      /* ... existing video error overlay unchanged ... */
    ) : (
      <video ... />  /* existing video element unchanged */
    )}
    <TrajectoryEditor
      ...existing props...
      zoomLevel={zoomLevel}
      panOffset={panOffset}
    />
  </div>
</div>
```

Key details:
- `overflow: hidden` is already on `.video-container` in CSS
- `.video-zoom-content` already has `transition: transform 0.15s ease-out` in CSS
- `.video-container.panning .video-zoom-content` already disables transition in CSS
- The `zoomed` and `panning` CSS classes already exist and set cursor styles

**Step 2: Remove video onClick for play/pause when panning**

The existing `onClick={togglePlayPause}` on the `<video>` element should remain — the pan handler will use `e.preventDefault()` and track movement to distinguish clicks from drags.

**Step 3: Run tests**

Run: `cd apps/browser && npx vitest run`
Expected: Existing tests pass (TypeScript error expected for `zoomLevel`/`panOffset` props on TrajectoryEditor — that's Task 4).

**Step 4: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat: wrap video in zoom transform div with CSS classes"
```

---

### Task 3: Implement drag-to-pan handlers

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx` (add handler functions before the return statement)

**Step 1: Add pan event handlers**

Add these callbacks after the existing `skipToEnd` callback (around line 711), before `handleTrimUpdate`:

```typescript
// Pan handlers for zoomed video
const handlePanStart = useCallback((e: React.PointerEvent) => {
  // Only pan when zoomed in and not in a marking mode
  if (zoomLevel <= 1) return
  if (reviewStep === 'marking_landing' || isMarkingApex || isMarkingOrigin || isMarkingLanding) return

  setIsPanning(true)
  panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}, [zoomLevel, panOffset, reviewStep, isMarkingApex, isMarkingOrigin, isMarkingLanding])

const handlePanMove = useCallback((e: React.PointerEvent) => {
  if (!isPanning) return

  const rawX = e.clientX - panStartRef.current.x
  const rawY = e.clientY - panStartRef.current.y

  // Clamp pan so video edges stay visible
  // At zoom Z, maximum pan is (Z-1)/(2*Z) of the container dimension
  // But since transform uses translate AFTER scale, max offset = (Z-1)*containerSize/(2*Z*Z)
  // Simplified: max pan in px = (containerSize * (zoomLevel - 1)) / (2 * zoomLevel)
  const container = (e.currentTarget as HTMLElement)
  const maxPanX = (container.clientWidth * (zoomLevel - 1)) / (2 * zoomLevel)
  const maxPanY = (container.clientHeight * (zoomLevel - 1)) / (2 * zoomLevel)

  setPanOffset({
    x: Math.max(-maxPanX, Math.min(maxPanX, rawX)),
    y: Math.max(-maxPanY, Math.min(maxPanY, rawY)),
  })
}, [isPanning, zoomLevel])

const handlePanEnd = useCallback(() => {
  setIsPanning(false)
}, [])
```

**Step 2: Clamp existing pan when zoom decreases**

Update the `-` key handler to also clamp pan when zoom decreases:

```typescript
case '-':
  e.preventDefault()
  setZoomLevel(prev => {
    const next = Math.max(1, prev - 0.5)
    if (next === 1) {
      setPanOffset({ x: 0, y: 0 })
    } else {
      // Re-clamp pan offset for new zoom level
      // We can't easily get container dimensions here, so we'll just keep pan
      // and let the next render clamp via a useEffect (or accept minor overshoot)
    }
    return next
  })
  break
```

**Step 3: Run tests**

Run: `cd apps/browser && npx vitest run`
Expected: All existing tests pass.

**Step 4: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat: implement drag-to-pan when video is zoomed"
```

---

### Task 4: Update TrajectoryEditor coordinate conversion for zoom/pan

**Files:**
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx:10-31` (props interface)
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx:547-570` (click handler)
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx:66-81` (destructure new props)

**Step 1: Add zoomLevel and panOffset to props interface**

In `TrajectoryEditorProps` (line 10), add:

```typescript
zoomLevel?: number
panOffset?: { x: number; y: number }
```

**Step 2: Destructure new props with defaults**

In the component function (line 66), add to destructured props:

```typescript
zoomLevel = 1,
panOffset = { x: 0, y: 0 },
```

**Step 3: Update the click coordinate conversion**

In `handleClick` (line 547), the click coordinates from `e.clientX/clientY` are relative to the screen. The `canvas.getBoundingClientRect()` already accounts for CSS transforms (scale/translate), so `clickX` and `clickY` relative to the canvas rect are already correct in screen space. However, the canvas rect dimensions are scaled by the zoom, so the internal coordinate math needs adjustment.

Actually — `getBoundingClientRect()` returns the element's size AFTER CSS transforms. So if the canvas is 800px wide and zoomed 2x, `rect.width` will be 1600px. But the `videoContentBounds` are calculated from the video's `getBoundingClientRect()` too, which is also transformed. So the normalized coordinate calculation `(clickX - bounds.offsetX) / bounds.width` should still work correctly because everything is in the same (screen) coordinate space.

**Key insight:** Because both the canvas click position AND the video content bounds are derived from `getBoundingClientRect()` which includes CSS transforms, the existing normalization math should work without changes. The CSS transform scales everything uniformly.

Let's verify this is actually the case by checking the `updateSize` function in the ResizeObserver. The `videoContentBounds` are calculated from `video.getBoundingClientRect()` which WILL be affected by zoom. The canvas size is set from the same rect. So when zoomed 2x:
- `rect.width` = 1600 (800 * 2)
- `bounds.width` = proportional (also 2x)
- Click at screen position maps correctly because both numerator and denominator scale equally.

However, there's a subtlety: `videoContentBounds` are recalculated in the ResizeObserver, and `getBoundingClientRect()` on the video inside a scaled container will return the scaled dimensions. The canvas is positioned `absolute` inside the same scaled container, so its `getBoundingClientRect()` will also return scaled dimensions. The click math should work.

**Step 4: Test manually that coordinate conversion works**

Add `zoomLevel` and `panOffset` to TrajectoryEditor props in ClipReview.tsx (done in Task 2 already). The props are accepted but may not need to modify conversion math — CSS transform handles it.

If testing reveals issues, the fix would be to divide click coordinates by zoomLevel and subtract panOffset. But the getBoundingClientRect approach should handle this automatically.

**Step 5: Run tests**

Run: `cd apps/browser && npx vitest run`
Expected: All tests pass including TrajectoryEditor.bounds.test.tsx.

**Step 6: Commit**

```bash
git add apps/browser/src/components/TrajectoryEditor.tsx apps/browser/src/components/ClipReview.tsx
git commit -m "feat: pass zoom/pan state to TrajectoryEditor"
```

---

### Task 5: Add zoom indicator to keyboard hints

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx:1142-1150` (keyboard-hints div)

**Step 1: Add zoom hints and current zoom indicator**

After the existing keyboard hints div (line 1142), or within it, add the zoom shortcuts:

```tsx
<span><kbd>+</kbd><kbd>-</kbd> Zoom</span>
<span><kbd>0</kbd> Reset zoom</span>
```

Also add a zoom level indicator near the video container when zoomed >1x. Add this just before the video-transport-controls div (line 1048):

```tsx
{zoomLevel > 1 && (
  <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-secondary)', margin: '2px 0' }}>
    {zoomLevel.toFixed(1)}x zoom — drag to pan, press 0 to reset
  </div>
)}
```

**Step 2: Run tests**

Run: `cd apps/browser && npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat: add zoom keyboard hints and zoom level indicator"
```

---

### Task 6: Write tests for zoom/pan behavior

**Files:**
- Create: `apps/browser/src/components/ClipReview.zoom.test.tsx`

**Step 1: Write zoom state tests**

```typescript
/**
 * ClipReview Zoom and Pan Tests
 *
 * Tests for keyboard-driven zoom (1x-4x) and drag-to-pan controls.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { ClipReview } from './ClipReview'

expect.extend(matchers)

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback }
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

// Mock canvas context
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillRect: vi.fn(), clearRect: vi.fn(), setTransform: vi.fn(),
  drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  closePath: vi.fn(), stroke: vi.fn(), arc: vi.fn(),
  fill: vi.fn(), measureText: vi.fn().mockReturnValue({ width: 0 }),
  transform: vi.fn(), rect: vi.fn(), clip: vi.fn(),
  scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
  quadraticCurveTo: vi.fn(),
  canvas: { width: 800, height: 600 },
  fillText: vi.fn(), getImageData: vi.fn().mockReturnValue({ data: [] }),
  putImageData: vi.fn(), createImageData: vi.fn().mockReturnValue([]),
}) as unknown as typeof HTMLCanvasElement.prototype.getContext

// Mock stores
const mockSegments = [
  {
    id: 'shot-1',
    startTime: 0,
    endTime: 10,
    clipStart: 1,
    clipEnd: 8,
    strikeTime: 3,
    confidence: 0.5,
    approved: 'pending' as const,
    objectUrl: 'blob:test',
    blob: new Blob(),
  },
  {
    id: 'shot-2',
    startTime: 10,
    endTime: 20,
    clipStart: 11,
    clipEnd: 18,
    strikeTime: 13,
    confidence: 0.5,
    approved: 'pending' as const,
    objectUrl: 'blob:test2',
    blob: new Blob(),
  },
]

vi.mock('../stores/processingStore', () => ({
  useProcessingStore: vi.fn(() => ({
    segments: mockSegments,
    updateSegment: vi.fn(),
    approveSegment: vi.fn(),
    rejectSegment: vi.fn(),
    videos: new Map(),
    activeVideoId: null,
    updateVideoSegment: vi.fn(),
    approveVideoSegment: vi.fn(),
    rejectVideoSegment: vi.fn(),
  })),
}))

vi.mock('../stores/reviewActionsStore', () => ({
  useReviewActionsStore: vi.fn(() => ({
    setHandlers: vi.fn(),
    setCanApprove: vi.fn(),
    setProgress: vi.fn(),
    clearHandlers: vi.fn(),
  })),
}))

vi.mock('../lib/feedback-service', () => ({
  submitShotFeedback: vi.fn(),
  submitTracerFeedback: vi.fn(),
}))

vi.mock('../lib/video-frame-pipeline-v4', () => ({
  VideoFramePipelineV4: vi.fn(),
  isVideoFrameCallbackSupported: vi.fn(() => true),
}))

vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn(),
  muxAudioIntoClip: vi.fn(),
}))

vi.mock('../lib/trajectory-generator', () => ({
  generateTrajectory: vi.fn(() => ({
    points: [],
    apex_point: null,
    frame_width: 1920,
    frame_height: 1080,
  })),
}))

describe('ClipReview Zoom Controls', () => {
  afterEach(() => cleanup())

  it('zooms in with + key up to 4x max', () => {
    render(<ClipReview onComplete={vi.fn()} />)

    // Press + six times (1 -> 1.5 -> 2 -> 2.5 -> 3 -> 3.5 -> 4, capped at 4)
    for (let i = 0; i < 7; i++) {
      fireEvent.keyDown(window, { key: '=' })
    }

    // Should show zoom indicator at 4x max
    expect(screen.getByText(/4\.0x zoom/)).toBeInTheDocument()
  })

  it('zooms out with - key down to 1x min', () => {
    render(<ClipReview onComplete={vi.fn()} />)

    // Zoom in first
    fireEvent.keyDown(window, { key: '=' })
    fireEvent.keyDown(window, { key: '=' })
    expect(screen.getByText(/2\.0x zoom/)).toBeInTheDocument()

    // Zoom all the way out
    fireEvent.keyDown(window, { key: '-' })
    fireEvent.keyDown(window, { key: '-' })
    fireEvent.keyDown(window, { key: '-' })

    // No zoom indicator at 1x
    expect(screen.queryByText(/zoom/i)).not.toBeInTheDocument()
  })

  it('resets zoom with 0 key', () => {
    render(<ClipReview onComplete={vi.fn()} />)

    // Zoom in
    fireEvent.keyDown(window, { key: '=' })
    fireEvent.keyDown(window, { key: '=' })
    fireEvent.keyDown(window, { key: '=' })
    expect(screen.getByText(/2\.5x zoom/)).toBeInTheDocument()

    // Reset
    fireEvent.keyDown(window, { key: '0' })
    expect(screen.queryByText(/zoom/i)).not.toBeInTheDocument()
  })

  it('resets zoom when navigating to next shot', () => {
    render(<ClipReview onComplete={vi.fn()} />)

    // Zoom in
    fireEvent.keyDown(window, { key: '=' })
    fireEvent.keyDown(window, { key: '=' })
    expect(screen.getByText(/2\.0x zoom/)).toBeInTheDocument()

    // Navigate to next shot
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    // Zoom should reset
    expect(screen.queryByText(/zoom/i)).not.toBeInTheDocument()
  })

  it('shows grab cursor class when zoomed', () => {
    const { container } = render(<ClipReview onComplete={vi.fn()} />)

    // At 1x, no zoomed class
    const videoContainer = container.querySelector('.video-container')
    expect(videoContainer).not.toHaveClass('zoomed')

    // Zoom in
    fireEvent.keyDown(window, { key: '=' })
    expect(videoContainer).toHaveClass('zoomed')
  })

  it('shows zoom keyboard hints', () => {
    render(<ClipReview onComplete={vi.fn()} />)
    expect(screen.getByText(/Zoom/)).toBeInTheDocument()
  })
})
```

**Step 2: Run the new tests**

Run: `cd apps/browser && npx vitest run src/components/ClipReview.zoom.test.tsx`
Expected: All tests pass.

**Step 3: Run full test suite**

Run: `cd apps/browser && npx vitest run`
Expected: All tests pass (existing + new).

**Step 4: Commit**

```bash
git add apps/browser/src/components/ClipReview.zoom.test.tsx
git commit -m "test: add zoom/pan keyboard and state tests"
```

---

## Verification (Mandatory)

> These tasks are required before considering the implementation complete.

### Task 7: Code Review

**Invoke:** `/code-review`

Review all implementation work for:
- Conventional commits (feat/fix/docs/chore prefixes)
- No obvious security issues (OWASP top 10)
- No over-engineering beyond requirements
- Documentation updated where needed

**Expected:** All issues addressed before proceeding.

### Task 8: Feature Testing

**Invoke:** `/test-feature video-zoom-pan-controls`

Test the complete user experience:
- Primary use cases work as expected
- Edge cases handled
- Error scenarios behave correctly
- Integration points function

**Expected:** All tests pass with evidence (actual output shown).

### Task 9: Final Commit

After verification passes:
```bash
git status  # Verify clean state
git log --oneline -5  # Review commits
```

Mark task as done only after this step completes successfully.
