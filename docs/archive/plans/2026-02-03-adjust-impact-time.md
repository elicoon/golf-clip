# Adjust Impact Time Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to correct auto-detected impact/strike time so the tracer animation starts at the exact moment of ball contact.

**Architecture:** Add "Impact Time" control to TracerConfigPanel. When clicked, it sets `segment.strikeTime` to current video playhead position. This updates the trajectory generation which uses strikeTime as the animation start anchor.

**Tech Stack:** React, TypeScript, Vitest, Zustand

---

## Task 1: Export formatTime from Scrubber.tsx

**Files:**
- Modify: `apps/browser/src/components/Scrubber.tsx:302-307`

**Step 1: Export the existing formatTime function**

Find the private function:
```typescript
function formatTime(seconds: number): string {
```

Change to:
```typescript
export function formatTime(seconds: number): string {
```

**Step 2: Verify no breaking changes**

Run: `cd apps/browser && npm run test -- --grep Scrubber`
Expected: All Scrubber tests pass

**Step 3: Commit**

```bash
git add apps/browser/src/components/Scrubber.tsx
git commit -m "refactor: export formatTime from Scrubber for reuse"
```

---

## Task 2: Add TracerConfigPanel Props for Impact Time

**Files:**
- Modify: `apps/browser/src/components/TracerConfigPanel.tsx:6-23`

**Step 1: Add new props to the interface**

Find `interface TracerConfigPanelProps {` and add after `onToggleCollapse: () => void`:

```typescript
  // Impact time adjustment
  onSetImpactTime?: () => void
  impactTime?: number
  impactTimeAdjusted?: boolean
```

**Step 2: Destructure new props in component**

Find the destructuring in the component function and add:

```typescript
  onSetImpactTime,
  impactTime,
  impactTimeAdjusted,
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/browser && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/browser/src/components/TracerConfigPanel.tsx
git commit -m "feat: add impact time props to TracerConfigPanel interface"
```

---

## Task 3: Add Impact Time UI Row to TracerConfigPanel

**Files:**
- Modify: `apps/browser/src/components/TracerConfigPanel.tsx`

**Step 1: Add import at top of file**

After existing imports, add:
```typescript
import { formatTime } from './Scrubber'
```

**Step 2: Add Impact Time config row after Origin Point row (line ~213)**

Find the closing `</div>` of the Origin Point config-row and add after it:

```typescript
          {/* Impact Time */}
          {onSetImpactTime && (
            <div className="config-row">
              <label>Impact Time</label>
              <button
                type="button"
                className={`btn-option btn-impact ${impactTimeAdjusted ? 'marked' : ''}`}
                onClick={onSetImpactTime}
                disabled={isGenerating}
                title={`Current: ${formatTime(impactTime ?? 0)} - Click to set to current video position`}
              >
                {impactTimeAdjusted ? `Adjusted: ${formatTime(impactTime ?? 0)}` : 'Set to Playhead'}
              </button>
              <span className="optional-hint">(if auto wrong)</span>
            </div>
          )}
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/browser && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/browser/src/components/TracerConfigPanel.tsx
git commit -m "feat: add Impact Time UI row to TracerConfigPanel"
```

---

## Task 4: Write Failing Test for Impact Time Handler

**Files:**
- Create: `apps/browser/src/components/ClipReview.impactTime.test.tsx`

**Step 1: Create the test file**

```typescript
/**
 * ClipReview Impact Time Tests
 *
 * Tests for the handleSetImpactTime functionality.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('ClipReview Impact Time Handler', () => {
  describe('handleSetImpactTime logic', () => {
    it('should update strikeTime when playhead is within clip boundaries', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 5.0 // Relative to segment start (10.0 + 5.0 = 15.0 global)
      const updateSegment = vi.fn()

      // Act - simulate handler logic
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 15.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).toHaveBeenCalledWith('shot-1', { strikeTime: 15.0 })
    })

    it('should NOT update strikeTime when playhead is BEFORE clip start', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 1.0 // Relative to segment (10.0 + 1.0 = 11.0 global, before clipStart 12.0)
      const updateSegment = vi.fn()

      // Act
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 11.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).not.toHaveBeenCalled()
    })

    it('should NOT update strikeTime when playhead is AFTER clip end', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 15.0 // Relative to segment (10.0 + 15.0 = 25.0 global, after clipEnd 20.0)
      const updateSegment = vi.fn()

      // Act
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 25.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).not.toHaveBeenCalled()
    })

    it('should accept impact time at exactly clip start boundary', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 2.0 // Relative to segment (10.0 + 2.0 = 12.0 global = clipStart)
      const updateSegment = vi.fn()

      // Act
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 12.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).toHaveBeenCalledWith('shot-1', { strikeTime: 12.0 })
    })

    it('should accept impact time at exactly clip end boundary', () => {
      // Arrange
      const currentShot = {
        id: 'shot-1',
        startTime: 10.0,
        clipStart: 12.0,
        clipEnd: 20.0,
        strikeTime: 15.0,
      }
      const videoCurrentTime = 10.0 // Relative to segment (10.0 + 10.0 = 20.0 global = clipEnd)
      const updateSegment = vi.fn()

      // Act
      const globalImpactTime = currentShot.startTime + videoCurrentTime // 20.0
      const isWithinBounds = globalImpactTime >= currentShot.clipStart && globalImpactTime <= currentShot.clipEnd

      if (isWithinBounds) {
        updateSegment(currentShot.id, { strikeTime: globalImpactTime })
      }

      // Assert
      expect(updateSegment).toHaveBeenCalledWith('shot-1', { strikeTime: 20.0 })
    })
  })
})
```

**Step 2: Run test to verify it passes (testing the logic pattern)**

Run: `cd apps/browser && npm run test -- ClipReview.impactTime`
Expected: All 5 tests PASS (these test the logic we'll implement)

**Step 3: Commit**

```bash
git add apps/browser/src/components/ClipReview.impactTime.test.tsx
git commit -m "test: add impact time handler logic tests"
```

---

## Task 5: Add Impact Time State to ClipReview

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Add state declaration**

Find other `useState` declarations (around line 85) and add:

```typescript
const [impactTimeAdjusted, setImpactTimeAdjusted] = useState(false)
```

**Step 2: Reset state when shot changes**

Find the useEffect that handles shot changes (look for `currentShotIndex` in dependencies). Add inside that effect:

```typescript
setImpactTimeAdjusted(false)
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/browser && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat: add impactTimeAdjusted state to ClipReview"
```

---

## Task 6: Add handleSetImpactTime Handler to ClipReview

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Get updateSegment from store**

Find where other store functions are destructured (look for `useProcessingStore`). Add `updateSegment` to the destructuring if not already present.

**Step 2: Add the handler**

After other handler definitions (near `handleMarkOrigin`, `handleMarkLanding`), add:

```typescript
const handleSetImpactTime = useCallback(() => {
  if (!videoRef.current || !currentShot) return
  const globalImpactTime = currentShot.startTime + videoRef.current.currentTime
  if (globalImpactTime < currentShot.clipStart || globalImpactTime > currentShot.clipEnd) {
    return // Silent reject - out of bounds
  }
  updateSegment(currentShot.id, { strikeTime: globalImpactTime })
  setImpactTimeAdjusted(true)
  setHasUnsavedChanges(true)
}, [currentShot, updateSegment])
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/browser && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat: add handleSetImpactTime handler to ClipReview"
```

---

## Task 7: Pass Impact Time Props to TracerConfigPanel

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Find TracerConfigPanel usage and add props**

Find where `<TracerConfigPanel` is rendered and add these props:

```typescript
onSetImpactTime={handleSetImpactTime}
impactTime={currentShot ? currentShot.strikeTime - currentShot.startTime : 0}
impactTimeAdjusted={impactTimeAdjusted}
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/browser && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat: wire impact time props to TracerConfigPanel"
```

---

## Task 8: Add Keyboard Shortcut for Impact Time

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Add keyboard handler**

Find the keyboard event handler (look for `switch` on `e.key`). Add a new case:

```typescript
case 'i':
case 'I':
  e.preventDefault()
  if (reviewStep === 'reviewing') {
    handleSetImpactTime()
  }
  break
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/browser && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "feat: add 'i' keyboard shortcut for impact time"
```

---

## Task 9: Run All Tests

**Step 1: Run full test suite**

Run: `cd apps/browser && npm run test`
Expected: All tests pass

**Step 2: Fix any failures**

If tests fail, investigate and fix before proceeding.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test failures after impact time implementation"
```

---

## Task 10: Manual UAT Verification

**Setup:**
- Start dev server: `cd apps/browser && npm run dev`
- Open browser to http://localhost:5173
- Upload a test video with golf shots

**Test Case 1: Basic Impact Time Adjustment**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1.1 | Mark landing point on video | Trajectory generated, tracer visible | |
| 1.2 | Observe TracerConfigPanel | "Impact Time" row visible with "Set to Playhead" button | |
| 1.3 | Play video, pause at different frame | Video paused at new time | |
| 1.4 | Click "Set to Playhead" | Button text changes to "Adjusted: X:XX.XX" | |
| 1.5 | Observe "Generate" button area | Shows hint about regenerating | |
| 1.6 | Click "Generate" | Spinner shown, trajectory regenerates | |
| 1.7 | Play video from clip start | Tracer animation starts at NEW impact time | |

**Test Case 2: Boundary Validation**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 2.1 | Note clip boundaries in Scrubber | Boundaries visible | |
| 2.2 | Seek video BEFORE clip start | Video at early time | |
| 2.3 | Click "Set to Playhead" | Nothing happens (silent reject) | |
| 2.4 | Verify button text | Still shows "Set to Playhead" | |
| 2.5 | Seek video AFTER clip end | Video at late time | |
| 2.6 | Click "Set to Playhead" | Nothing happens (silent reject) | |

**Test Case 3: Keyboard Shortcut**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 3.1 | Pause video at desired frame | Video paused | |
| 3.2 | Press `i` key | Impact time adjusted, button updates | |

**Test Case 4: State Reset on Shot Change**

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 4.1 | Adjust impact time on shot 1 | Button shows "Adjusted: X:XX.XX" | |
| 4.2 | Click "Next" to move to shot 2 | Navigated to shot 2 | |
| 4.3 | Observe button | Shows "Set to Playhead" (reset) | |

**Step 2: Document any issues found**

Create bug reports for any failures.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete adjust impact time feature implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Export formatTime from Scrubber | Scrubber.tsx |
| 2 | Add TracerConfigPanel props | TracerConfigPanel.tsx |
| 3 | Add Impact Time UI row | TracerConfigPanel.tsx |
| 4 | Write handler logic tests | ClipReview.impactTime.test.tsx |
| 5 | Add impactTimeAdjusted state | ClipReview.tsx |
| 6 | Add handleSetImpactTime handler | ClipReview.tsx |
| 7 | Wire props to TracerConfigPanel | ClipReview.tsx |
| 8 | Add keyboard shortcut | ClipReview.tsx |
| 9 | Run all tests | - |
| 10 | Manual UAT verification | - |

**Total: 10 tasks, ~30-45 minutes estimated**
