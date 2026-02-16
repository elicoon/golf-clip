# Plan: Add "Adjust Impact Time" Feature

## Summary
Add the ability for users to adjust the impact/strike time when the auto-detected timing is incorrect. This ensures the tracer animation starts at the exact moment of ball impact.

## Context
- `strikeTime` is auto-detected from audio transients and stored on each segment
- When generating trajectories, `strikeOffset = strikeTime - startTime` determines when animation begins
- Each trajectory point has `timestamp = strikeOffset + (fraction * flightTime)`
- TrajectoryEditor compares `video.currentTime` to point timestamps to calculate animation progress

## Design Decisions
1. **Location**: Add to TracerConfigPanel alongside existing origin/landing/apex controls (after Origin Point row, line ~213)
2. **Interaction**: "Set to Playhead" button - user pauses at correct frame, clicks button
3. **When visible**: Only during "reviewing" step (after landing is marked)
4. **Persistence**: Update `segment.strikeTime` directly, set `hasUnsavedChanges=true` to trigger re-generation
5. **Time format**: Reuse `formatTime()` from Scrubber.tsx (format: `M:SS.cc`)

## Implementation Steps

### Step 1: Add State in ClipReview.tsx
**File**: [ClipReview.tsx](../../apps/browser/src/components/ClipReview.tsx)

Add state to track if impact time was manually adjusted:
```typescript
const [impactTimeAdjusted, setImpactTimeAdjusted] = useState(false)
```

Reset when shot changes (in existing shot-change useEffect).

### Step 2: Add Handler in ClipReview.tsx
Add handler that:
1. Reads current `videoRef.current.currentTime`
2. Converts to global time: `currentShot.startTime + currentTime`
3. Validates within clip boundaries
4. Calls `updateSegment(currentShot.id, { strikeTime: globalTime })`
5. Sets `impactTimeAdjusted` and `hasUnsavedChanges` to true

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

### Step 3: Update TracerConfigPanel Props
**File**: [TracerConfigPanel.tsx](../../apps/browser/src/components/TracerConfigPanel.tsx)

Add new props to interface:
```typescript
interface TracerConfigPanelProps {
  // ... existing props
  onSetImpactTime?: () => void
  impactTime?: number           // Relative to segment start, for display
  impactTimeAdjusted?: boolean
}
```

### Step 4: Add Impact Time UI in TracerConfigPanel
Add new config row after Origin Point (line ~213), matching existing pattern:

```typescript
// Add import at top
import { formatTime } from './Scrubber'

// Add after Origin Point row (line ~213)
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

Also export `formatTime` from Scrubber.tsx (currently a private function).

### Step 5: Pass Props from ClipReview
In ClipReview.tsx where TracerConfigPanel is rendered:
```typescript
<TracerConfigPanel
  // ... existing props
  onSetImpactTime={handleSetImpactTime}
  impactTime={currentShot ? currentShot.strikeTime - currentShot.startTime : 0}
  impactTimeAdjusted={impactTimeAdjusted}
/>
```

### Step 6: Add CSS Styles
**File**: [App.css](../../apps/browser/src/App.css) or TracerConfigPanel's styles

```css
.time-value {
  font-family: monospace;
  min-width: 4rem;
}

.adjusted-badge {
  color: var(--color-success, #4caf50);
  margin-left: 0.25rem;
}

.btn-adjusted {
  border-color: var(--color-success, #4caf50);
}
```

### Step 7: Add Keyboard Shortcut (Enhancement)
Add `i` key to set impact time:
```typescript
case 'i':
case 'I':
  e.preventDefault()
  if (reviewStep === 'reviewing') {
    handleSetImpactTime()
  }
  break
```

## Files to Modify
1. [apps/browser/src/components/ClipReview.tsx](../../apps/browser/src/components/ClipReview.tsx) - State, handler, pass props
2. [apps/browser/src/components/TracerConfigPanel.tsx](../../apps/browser/src/components/TracerConfigPanel.tsx) - Add UI row, import formatTime
3. [apps/browser/src/components/Scrubber.tsx](../../apps/browser/src/components/Scrubber.tsx) - Export formatTime function
4. CSS (if needed) - `.btn-impact.marked` style

---

## Testing & Verification Plan

### Pre-Implementation: Automated Tests
Run existing tests to establish baseline:
```bash
cd apps/browser && npm run test
```

### Unit Tests to Add
**File**: `apps/browser/src/components/ClipReview.test.tsx` (or new file)

1. **Test: Impact time handler updates segment**
   - Mock updateSegment
   - Call handleSetImpactTime with video at 5.0s
   - Assert updateSegment called with correct strikeTime

2. **Test: Impact time bounded by clip boundaries**
   - Set clipStart=3.0, clipEnd=10.0
   - Call handler with currentTime=2.0 (before clip)
   - Assert updateSegment NOT called
   - Call handler with currentTime=12.0 (after clip)
   - Assert updateSegment NOT called

3. **Test: Impact time resets on shot change**
   - Set impactTimeAdjusted=true
   - Change currentShotIndex
   - Assert impactTimeAdjusted reset to false

### Integration Tests
**File**: `apps/browser/src/components/ClipReview.export.test.tsx` (or add to existing)

1. **Test: Trajectory uses updated strikeTime**
   - Generate trajectory with auto strikeTime
   - Update strikeTime via handler
   - Regenerate trajectory
   - Assert first trajectory point timestamp matches new strikeTime

---

## UAT Checklist

### Setup
- [ ] Start dev server: `cd apps/browser && npm run dev`
- [ ] Open browser to http://localhost:5173
- [ ] Have test video ready with multiple shots

### Test Case 1: Basic Impact Time Adjustment
**Precondition**: Video uploaded, shot detected, in review mode

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 1.1 | Mark landing point on video | Trajectory generated, tracer visible | |
| 1.2 | Observe TracerConfigPanel | "Impact Time" row visible with "Set to Playhead" button | |
| 1.3 | Play video, pause at different frame | Video paused at new time | |
| 1.4 | Click "Set to Playhead" | Button text changes to "Adjusted: X:XX.XX" | |
| 1.5 | Observe "Generate" button | Shows hint "Click Generate to see updated tracer" | |
| 1.6 | Click "Generate" | Spinner shown, trajectory regenerates | |
| 1.7 | Play video from clip start | Tracer animation starts at NEW impact time, not original | |

### Test Case 2: Boundary Validation
**Precondition**: In review mode with trajectory generated

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 2.1 | Note clip boundaries (shown in Scrubber) | e.g., 3.0s - 10.0s | |
| 2.2 | Seek video to BEFORE clip start (e.g., 1.0s) | Video at 1.0s | |
| 2.3 | Click "Set to Playhead" | Nothing happens (silent reject) | |
| 2.4 | Verify button text | Still shows "Set to Playhead" (not adjusted) | |
| 2.5 | Seek video to AFTER clip end (e.g., 15.0s) | Video at 15.0s | |
| 2.6 | Click "Set to Playhead" | Nothing happens (silent reject) | |

### Test Case 3: State Reset on Shot Change
**Precondition**: Multi-shot video, first shot reviewed with adjusted impact time

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 3.1 | On shot 1, adjust impact time | Button shows "Adjusted: X:XX.XX" | |
| 3.2 | Click "Next" to move to shot 2 | Navigated to shot 2 | |
| 3.3 | Observe TracerConfigPanel | Button shows "Set to Playhead" (reset) | |
| 3.4 | Navigate back to shot 1 | Back on shot 1 | |
| 3.5 | Observe button | Shows "Set to Playhead" (adjustment not persisted across navigation) | |

### Test Case 4: Multiple Adjustments
**Precondition**: In review mode with trajectory generated

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 4.1 | Adjust impact time to 5.0s | Button shows "Adjusted: 0:05.00" | |
| 4.2 | Generate trajectory | Tracer starts at 5.0s | |
| 4.3 | Adjust impact time again to 6.5s | Button shows "Adjusted: 0:06.50" | |
| 4.4 | Generate trajectory again | Tracer now starts at 6.5s | |

### Test Case 5: Keyboard Shortcut (if implemented)
**Precondition**: In review mode

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 5.1 | Pause video at desired frame | Video paused | |
| 5.2 | Press `i` key | Impact time adjusted, button updates | |
| 5.3 | Press `i` again at different frame | Impact time updated to new position | |

### Test Case 6: Visual Verification of Animation Timing
**Precondition**: Video with clear ball strike visible

| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 6.1 | Mark landing, generate trajectory | Tracer appears | |
| 6.2 | Play video, watch tracer start | Note if tracer starts at actual ball strike | |
| 6.3 | If tracer starts too early: pause at correct strike frame | Video paused at strike | |
| 6.4 | Click "Set to Playhead" then "Generate" | Trajectory regenerated | |
| 6.5 | Play video again | Tracer now starts exactly when ball is struck | |
| 6.6 | If tracer starts too late: same process | Tracer timing corrected | |

### Test Case 7: Edge Cases
| Step | Action | Expected Result | Pass/Fail |
|------|--------|-----------------|-----------|
| 7.1 | Set impact time to exactly clip start | Accepted, button updates | |
| 7.2 | Set impact time to exactly clip end | Accepted, button updates | |
| 7.3 | Very short clip (< 1s duration) | Impact time adjustment still works | |
| 7.4 | Very long clip (> 30s) | Impact time adjustment still works | |

---

## Post-Implementation Verification

### Regression Check
- [ ] Run full test suite: `cd apps/browser && npm run test`
- [ ] All existing tests pass
- [ ] New tests pass

### Manual Smoke Test
- [ ] Complete flow: Upload → Process → Review → Adjust impact time → Export
- [ ] Exported clip plays correctly
- [ ] No console errors during entire flow

### Cross-Browser (if time permits)
- [ ] Chrome: All UAT tests pass
- [ ] Firefox: Basic flow works
- [ ] Safari: Basic flow works (check canvas rendering)
