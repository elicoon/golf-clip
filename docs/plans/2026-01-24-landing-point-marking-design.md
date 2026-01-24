# Landing Point Marking for Shot Tracer

**Date:** 2026-01-24
**Status:** Design Complete

## Overview

This feature replaces the current accept/reject flow with a combined **mark landing + confirm** step. Users see each shot's impact frame, click to mark where the ball lands, and immediately see a tracer preview. Skipping a shot marks it as a false positive.

## User Flow

```
1. Video uploaded & processed
2. For each detected shot (one at a time):
   a. Show video at impact frame with full playback controls
   b. User clicks on video to mark landing point (confirms TP)
      - OR clicks "Skip Shot" (marks as FP)
   c. Progress bar shows trajectory generation status via SSE
   d. Tracer preview plays automatically once generated
   e. User can adjust landing point, clip start/end times, or replay
   f. Click "Next" to proceed to next shot
3. Export clips with tracers rendered
```

## UI Layout (Enhanced ClipReview)

The screen keeps all existing functionality (video playback, scrubber, clip boundaries) but adds landing point marking:

```
┌─────────────────────────────────────────────────────────────┐
│  Review Shot #1                                    1 of 3   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │              VIDEO PLAYER                           │   │
│  │         (with tracer overlay)                       │   │
│  │                                                     │   │
│  │     [Landing point marker if set: ✕]               │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Scrubber ──────────────────────────────────────────┐   │
│  │  [====|=================|====]                      │   │
│  │  Start                  End                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  [⏪] [◀] [▶ Play] [▶] [⏩]     ☑ Show Tracer             │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  📍 Click on video to mark landing point             │  │
│  │     Landing: (0.65, 0.82) ✓                [Clear]   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  OR (during generation):                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Generating tracer... 45%                             │  │
│  │  [████████████░░░░░░░░░░░░░░]                        │  │
│  │  Detecting early ball positions...                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  [ Skip Shot ]                      [ Next → ]              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key changes from current UI:**
- "Accept/Reject" buttons → "Skip Shot" / "Next" buttons
- New landing point indicator section showing coordinates
- Click-to-mark interaction on the video player
- Landing marker (✕) rendered on video overlay
- Progress bar during trajectory generation
- "Next" button disabled until landing point is marked

## Data Model Changes

### Database

Add columns to `shots` table:

```sql
ALTER TABLE shots ADD COLUMN landing_x REAL;
ALTER TABLE shots ADD COLUMN landing_y REAL;
```

### Schemas

Update `DetectedShot` in `schemas.py`:

```python
class DetectedShot(BaseModel):
    # ... existing fields ...
    landing_x: Optional[float] = Field(None, ge=0, le=1, description="User-marked landing X (normalized)")
    landing_y: Optional[float] = Field(None, ge=0, le=1, description="User-marked landing Y (normalized)")
```

## API Changes

### New SSE Endpoint

```
GET /api/trajectory/{job_id}/{shot_id}/generate?landing_x=0.65&landing_y=0.82
```

Returns SSE stream with events:

```
event: progress
data: {"step": "extracting_template", "progress": 10, "message": "Extracting ball template..."}

event: progress
data: {"step": "detecting_early", "progress": 35, "message": "Detecting early ball positions..."}

event: progress
data: {"step": "generating_physics", "progress": 65, "message": "Generating physics trajectory..."}

event: progress
data: {"step": "smoothing", "progress": 90, "message": "Smoothing trajectory..."}

event: complete
data: {"trajectory": {...}, "progress": 100}

event: error
data: {"error": "Failed to detect ball origin", "progress": 0}
```

**Progress stages:**
- 0-10%: Saving landing point
- 10-20%: Extracting ball template
- 20-50%: Detecting early ball positions
- 50-80%: Generating physics trajectory
- 80-100%: Smoothing and finalizing

## Trajectory Physics with Landing Point

### Hybrid Approach

The trajectory generation uses three pieces of information:

1. **Origin point**: Detected via shaft + clubhead analysis (already working)
2. **Early flight shape**: First 6-10 frames of motion detection give launch angle and lateral direction
3. **Landing point**: User-marked endpoint (new)

### Curve Generation

Fit a parabola that:
- Starts at origin
- Matches early detection angles (for mid-flight shape)
- Ends exactly at landing point

**Physics math:**
```
Given:
  - Origin: (x₀, y₀) at t=0
  - Landing: (x₁, y₁) at t=T (flight duration)
  - Launch angle θ from early detections

Solve for:
  - Apex height (derived from parabola that hits both endpoints)
  - Lateral drift rate (x₁ - x₀) / T
  - Gravity constant g = 2 * apex_height / apex_time²

The parabola is overconstrained (good!) so we:
  1. Use landing point as hard constraint
  2. Use early detections to determine apex_time ratio (earlier apex = higher launch)
  3. Derive apex height from the geometry
```

This produces a trajectory that:
- Looks natural (follows physics)
- Matches observed early ball movement
- Ends exactly where the user marked

## Frontend Component Changes

### ClipReview.tsx

**New state:**
```typescript
const [landingPoint, setLandingPoint] = useState<{x: number, y: number} | null>(null)
const [trajectoryProgress, setTrajectoryProgress] = useState<number | null>(null)
const [trajectoryMessage, setTrajectoryMessage] = useState<string>('')
```

**Click handler on video container:**
```typescript
const handleVideoClick = (e: React.MouseEvent) => {
  // Convert click coords to normalized 0-1
  const rect = videoRef.current.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height

  setLandingPoint({ x, y })
  generateTrajectorySSE(x, y)
}
```

**SSE connection function:**
```typescript
const generateTrajectorySSE = (landingX: number, landingY: number) => {
  setTrajectoryProgress(0)
  const url = `http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot.id}/generate?landing_x=${landingX}&landing_y=${landingY}`
  const eventSource = new EventSource(url)

  eventSource.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data)
    setTrajectoryProgress(data.progress)
    setTrajectoryMessage(data.message)
  })

  eventSource.addEventListener('complete', (e) => {
    const data = JSON.parse(e.data)
    setTrajectory(data.trajectory)
    setTrajectoryProgress(null)
    eventSource.close()
  })

  eventSource.addEventListener('error', (e) => {
    // Handle error
    setTrajectoryProgress(null)
    eventSource.close()
  })
}
```

**Button logic:**
- "Next" button disabled when `landingPoint === null`
- "Skip Shot" works same as current "Reject"

### TrajectoryEditor.tsx

Add landing marker rendering:
- Render an ✕ marker at the landing point coordinates
- Style: white with subtle glow, similar to tracer aesthetic

## Backend Changes

### 1. Database Migration

In `database.py`, add migration for schema version 4:

```python
if current_version < 4:
    await db.execute("ALTER TABLE shots ADD COLUMN landing_x REAL")
    await db.execute("ALTER TABLE shots ADD COLUMN landing_y REAL")
    await db.execute("PRAGMA user_version = 4")
```

### 2. New Model Function

In `models/job.py`:

```python
async def update_shot_landing(job_id: str, shot_id: int, landing_x: float, landing_y: float) -> bool:
    """Save user-marked landing point for a shot."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE shots SET landing_x = ?, landing_y = ? WHERE job_id = ? AND id = ?",
        (landing_x, landing_y, job_id, shot_id),
    )
    await db.commit()
    return cursor.rowcount > 0
```

### 3. New SSE Endpoint

In `routes.py`:

```python
@router.get("/trajectory/{job_id}/{shot_id}/generate")
async def generate_trajectory_sse(
    job_id: str,
    shot_id: int,
    landing_x: float = Query(..., ge=0, le=1),
    landing_y: float = Query(..., ge=0, le=1),
):
    async def event_generator():
        try:
            # Save landing point
            yield sse_event("progress", {"step": "saving", "progress": 5, "message": "Saving landing point..."})
            await update_shot_landing(job_id, shot_id, landing_x, landing_y)

            # Generate trajectory with progress callbacks
            async for progress in generate_trajectory_with_landing(job_id, shot_id, landing_x, landing_y):
                yield sse_event("progress", progress)

            # Return final trajectory
            trajectory = await get_trajectory(job_id, shot_id)
            yield sse_event("complete", {"trajectory": trajectory, "progress": 100})
        except Exception as e:
            yield sse_event("error", {"error": str(e), "progress": 0})

    return EventSourceResponse(event_generator())
```

### 4. Updated Tracker Method

In `tracker.py`:

```python
def track_with_landing_point(
    self,
    video_path: Path,
    origin: OriginDetection,
    strike_time: float,
    landing_point: Tuple[float, float],  # User-provided endpoint (normalized)
    frame_width: int,
    frame_height: int,
    progress_callback: Callable[[int, str], None] = None,
) -> Optional[dict]:
    """Generate trajectory constrained to hit landing point.

    Args:
        video_path: Path to video file
        origin: Detected ball origin
        strike_time: When ball was struck
        landing_point: User-marked landing (x, y) in normalized coords
        frame_width: Video width
        frame_height: Video height
        progress_callback: Called with (percent, message) during generation

    Returns:
        Trajectory dict with points constrained to hit landing point
    """
```

## Error Handling

1. **User clicks outside reasonable landing area:**
   - Allow any click within frame bounds
   - Physics will handle it (might produce unusual trajectory)

2. **Trajectory generation fails:**
   - Show error message: "Could not generate tracer. Try marking a different landing point."
   - Keep landing marker visible so user can adjust
   - "Clear" button to reset and try again

3. **User changes landing point mid-generation:**
   - Cancel current SSE connection
   - Start new generation with updated coordinates

4. **No early ball detections found:**
   - Fall back to default launch parameters (18° launch, straight)
   - Still constrain to hit landing point
   - Trajectory confidence will be lower

5. **Landing point very close to origin:**
   - Valid for chip shots / short pitches
   - Physics will produce a low, short arc

## Summary

| Component | Changes |
|-----------|---------|
| **UI** | Click-to-mark landing on video, progress bar during generation, ✕ marker overlay |
| **Flow** | "Mark landing + Next" replaces "Accept", "Skip" replaces "Reject" |
| **API** | New SSE endpoint `GET /api/trajectory/{job_id}/{shot_id}/generate` |
| **Database** | Add `landing_x`, `landing_y` columns to `shots` table (schema v4) |
| **Tracker** | New `track_with_landing_point()` method constraining physics to endpoint |
| **Physics** | Hybrid: early detections for shape, landing point as fixed endpoint |
