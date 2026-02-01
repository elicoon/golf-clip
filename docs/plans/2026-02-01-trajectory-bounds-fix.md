# Trajectory Bounds Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix trajectory/marker lines rendering outside the video player area by clamping all coordinates to the 0-1 normalized range.

**Architecture:** Defense-in-depth approach - clamp coordinates at multiple layers:
1. Generator layer: Clamp apex_point in trajectory-generator.ts
2. Render layer: Clamp all marker coordinates in TrajectoryEditor.tsx before canvas conversion
3. Visual containment: Add CSS overflow:hidden as a safety net

**Tech Stack:** TypeScript, React, Canvas 2D API, Vitest

---

## Root Cause Analysis

The bug occurs because:
1. `trajectory-generator.ts` line 81: `apex.y = Math.min(origin.y, landingPoint.y) - heightMultiplier` can produce negative values
2. `trajectory-generator.ts` lines 120-125: `apex_point` in returned data uses unclamped coordinates
3. `TrajectoryEditor.tsx` lines 256-259: `toCanvas()` doesn't validate input range
4. Marker props (landingPoint, apexPoint, originPoint) are rendered without bounds checking

---

### Task 1: Clamp apex_point in trajectory generator

**Files:**
- Modify: `apps/browser/src/lib/trajectory-generator.ts:116-128`

**Step 1: Locate the return statement**

The apex_point is returned at lines 120-125 without clamping:
```typescript
apex_point: {
  ...points[Math.floor(NUM_TRAJECTORY_POINTS / 2)],
  x: apex.x,
  y: apex.y,
},
```

**Step 2: Apply clamping to apex_point coordinates**

Replace lines 116-128 with:
```typescript
return {
  shot_id: 'generated',
  points,
  confidence: 1.0,
  apex_point: {
    ...points[Math.floor(NUM_TRAJECTORY_POINTS / 2)],
    x: Math.max(0, Math.min(1, apex.x)),
    y: Math.max(0, Math.min(1, apex.y)),
  },
  frame_width: 1920,
  frame_height: 1080,
}
```

**Step 3: Run existing tests to verify no regression**

Run: `cd /c/Users/Eli/projects/golf-clip/apps/browser && npm run test -- --run`
Expected: All existing tests pass (bug tests still fail - we fix renderer next)

**Step 4: Commit**

```bash
git add apps/browser/src/lib/trajectory-generator.ts
git commit -m "fix(trajectory): clamp apex_point coordinates to 0-1 range"
```

---

### Task 2: Add coordinate clamping helper to TrajectoryEditor

**Files:**
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx:256-259`

**Step 1: Create clampedToCanvas helper**

Inside the useEffect (after the existing toCanvas at line 256), add a clamped version:
```typescript
// Helper to convert normalized coords (0-1) to canvas coords
// Uses video content bounds to account for object-fit: contain letterboxing
const bounds = videoContentBounds || { offsetX: 0, offsetY: 0, width: canvasSize.width, height: canvasSize.height }
const toCanvas = (x: number, y: number) => ({
  x: bounds.offsetX + x * bounds.width,
  y: bounds.offsetY + y * bounds.height,
})

// Clamped version that ensures coordinates stay within video bounds
const clampedToCanvas = (x: number, y: number) => {
  const clampedX = Math.max(0, Math.min(1, x))
  const clampedY = Math.max(0, Math.min(1, y))
  return toCanvas(clampedX, clampedY)
}
```

**Step 2: Commit**

```bash
git add apps/browser/src/components/TrajectoryEditor.tsx
git commit -m "feat(trajectory-editor): add clampedToCanvas helper for bounds safety"
```

---

### Task 3: Use clamped coordinates for marker rendering

**Files:**
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx:294-377`

**Step 1: Update landing marker to use clampedToCanvas**

At line 295, change:
```typescript
const markerPos = toCanvas(landingPoint.x, landingPoint.y)
```
To:
```typescript
const markerPos = clampedToCanvas(landingPoint.x, landingPoint.y)
```

**Step 2: Update apex marker to use clampedToCanvas**

At line 327, change:
```typescript
const apexPos = toCanvas(apexPoint.x, apexPoint.y)
```
To:
```typescript
const apexPos = clampedToCanvas(apexPoint.x, apexPoint.y)
```

**Step 3: Update origin marker to use clampedToCanvas**

At line 353, change:
```typescript
const originPos = toCanvas(originPoint.x, originPoint.y)
```
To:
```typescript
const originPos = clampedToCanvas(originPoint.x, originPoint.y)
```

**Step 4: Commit**

```bash
git add apps/browser/src/components/TrajectoryEditor.tsx
git commit -m "fix(trajectory-editor): use clamped coordinates for marker rendering"
```

---

### Task 4: Use clamped coordinates for trajectory apex marker

**Files:**
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx:491-501`

**Step 1: Update trajectory apex_point rendering**

At line 492, change:
```typescript
const apex = toCanvas(trajectory.apex_point.x, trajectory.apex_point.y)
```
To:
```typescript
const apex = clampedToCanvas(trajectory.apex_point.x, trajectory.apex_point.y)
```

**Step 2: Commit**

```bash
git add apps/browser/src/components/TrajectoryEditor.tsx
git commit -m "fix(trajectory-editor): clamp trajectory apex marker coordinates"
```

---

### Task 5: Clamp trajectory point coordinates in drawSmoothCurve

**Files:**
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx:262-285`

**Step 1: Update drawSmoothCurve to use clampedToCanvas**

The trajectory points from the generator are already clamped, but for defense-in-depth, update the drawing function. Change all `toCanvas` calls to `clampedToCanvas` in drawSmoothCurve:

At line 265:
```typescript
const first = clampedToCanvas(points[0].x, points[0].y)
```

At line 269:
```typescript
const second = clampedToCanvas(points[1].x, points[1].y)
```

At line 275:
```typescript
const current = clampedToCanvas(points[i].x, points[i].y)
```

At line 276:
```typescript
const next = clampedToCanvas(points[i + 1].x, points[i + 1].y)
```

At line 282:
```typescript
const last = clampedToCanvas(points[points.length - 1].x, points[points.length - 1].y)
```

At line 283:
```typescript
const secondLast = clampedToCanvas(points[points.length - 2].x, points[points.length - 2].y)
```

**Step 2: Commit**

```bash
git add apps/browser/src/components/TrajectoryEditor.tsx
git commit -m "fix(trajectory-editor): clamp all trajectory curve coordinates"
```

---

### Task 6: Run bug tests to verify fix

**Files:**
- Test: `apps/browser/src/components/TrajectoryEditor.bounds.test.tsx`

**Step 1: Run the bounds tests**

Run: `cd /c/Users/Eli/projects/golf-clip/apps/browser && npm run test -- --run src/components/TrajectoryEditor.bounds.test.tsx`

Expected: All 15 tests pass, including:
- "BUG TEST: should clamp apex marker coordinates to video bounds"
- "BUG TEST: should clamp origin marker at edge of frame"
- "BUG TEST: should handle extreme trajectory shape producing out-of-bounds control points"

**Step 2: Run full test suite**

Run: `cd /c/Users/Eli/projects/golf-clip/apps/browser && npm run test -- --run`
Expected: All tests pass

**Step 3: Commit test verification (no code changes)**

No commit needed - this is verification only.

---

### Task 7: Add CSS overflow containment as safety net

**Files:**
- Modify: `apps/browser/src/components/TrajectoryEditor.tsx:598-611`

**Step 1: Add overflow:hidden to canvas style**

In the canvas style object (starting at line 598), add overflow:hidden:
```typescript
style={{
  position: 'absolute',
  top: 0,
  left: 0,
  width: canvasSize.width || '100%',
  height: canvasSize.height || '100%',
  pointerEvents: disabled ? 'none' : 'auto',
  cursor: getCursor(),
  touchAction: 'none',
  zIndex: 10,
  filter: 'none',
  mixBlendMode: 'normal' as const,
  overflow: 'hidden',  // Safety net for any out-of-bounds rendering
}}
```

**Step 2: Commit**

```bash
git add apps/browser/src/components/TrajectoryEditor.tsx
git commit -m "fix(trajectory-editor): add overflow:hidden as rendering safety net"
```

---

### Task 8: Update bug task status

**Files:**
- Modify: `C:\Users\Eli\projects\dev-org\backlog\tasks\bug-trajectory-lines-render-outside-video.md`

**Step 1: Update status to completed**

Change status from "not started" to "done" and add resolution notes.

**Step 2: Commit to dev-org repo**

```bash
cd /c/Users/Eli/projects/dev-org
git add backlog/tasks/bug-trajectory-lines-render-outside-video.md
git commit -m "Mark trajectory bounds bug as resolved"
```

---

## Verification Checklist

Before marking complete:
- [ ] All 15 TrajectoryEditor.bounds.test.tsx tests pass
- [ ] Full test suite passes
- [ ] Manual test: Load a video, generate trajectory with "high" height setting, verify line stays within video
- [ ] Manual test: Place origin marker near top of frame, verify it doesn't escape bounds
