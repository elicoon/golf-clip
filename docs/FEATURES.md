# GolfClip Features Documentation

This document provides detailed explanations of how each feature in GolfClip works.

> **App coverage:** Sections are labeled **[Browser App]** or **[Desktop Backend]** to indicate which implementation they describe.
> - **Browser App** (`apps/browser/`): The active production app — fully client-side, runs in any modern browser, deployed on Vercel.
> - **Desktop Backend** (`apps/desktop/`): A paused Python FastAPI server with YOLO-based detection. Included as a reference for the server-side approach.

---

## Table of Contents

1. [Audio Shot Detection](#audio-shot-detection)
2. [Ball Origin Detection](#ball-origin-detection)
3. [Shot Tracer System](#shot-tracer-system)
4. [Trajectory Animation](#trajectory-animation)
5. [Clip Review Interface](#clip-review-interface)
6. [Export System](#export-system)
7. [Feedback Systems](#feedback-systems)
8. [ML Improvement Pipeline](#ml-improvement-pipeline)

---

## Audio Shot Detection [Browser App + Desktop Backend]

### Overview

GolfClip detects golf shots by analyzing the audio track of your video. When a golf club strikes a ball, it creates a distinctive transient sound - a sharp, loud "thwack" that stands out from background noise.

### How It Works

1. **Audio Extraction**: FFmpeg extracts the audio track from your video file
2. **Bandpass Filtering**: Filters audio to 1000-8000 Hz (where ball strike sounds are most prominent)
3. **Transient Detection**: Identifies sudden spikes in audio energy
4. **Feature Analysis**: Each potential strike is scored on multiple features
5. **Deduplication**: Groups detections within 25-second windows, keeping only the highest-confidence detection per group
6. **Confidence Scoring**: Final confidence = weighted combination of all features

### Feature Weights

| Feature | Weight | What It Measures |
|---------|--------|------------------|
| Peak height | 20% | How loud the transient is compared to background |
| Spectral flatness | 10% | Whether sound is noise-like (strikes are ~0.3) |
| Spectral centroid | 15% | Frequency brightness (strikes are 2500-4500 Hz) |
| Peak prominence | 15% | How much the peak stands out |
| Rise time | 10% | Attack speed (strikes have fast <10ms attack) |
| Decay ratio | 20% | How quickly sound fades (strikes decay fast) |
| Zero-crossing rate | 10% | Helps filter out swoosh sounds (practice swings) |

### Key Parameters

```python
# In detection/audio.py - DetectionConfig
min_strike_interval: float = 25.0  # Min seconds between shots (range: 15-60s typical)
frequency_low: int = 1000          # Bandpass filter low (Hz)
frequency_high: int = 8000         # Bandpass filter high (Hz)
target_centroid_hz: float = 3500.0 # Expected centroid for ball impact
sensitivity: float = 0.5           # Detection sensitivity (0-1)
```

### Deduplication

The pipeline includes a deduplication step (`deduplicate_strikes()`) that groups detections within a configurable time window and keeps only the highest-confidence detection per group. This filters out:
- Practice swings before/after real shots
- Echo/reverberation from strikes
- Club waggle sounds

### Configuration

```bash
# Increase sensitivity for quiet videos (0-1)
export GOLFCLIP_AUDIO_SENSITIVITY=0.8

# Minimum seconds between detected shots
# Default: 25s (typical time between golf shots)
export GOLFCLIP_MIN_STRIKE_INTERVAL=25
```

### Troubleshooting

**0 shots detected:**
- Check if video has audible audio
- Try sensitivity 0.7-0.9
- Look at backend logs for "Audio appears very quiet" messages

**False positives (non-shots detected):**
- Common causes: club drops, cart sounds, other sharp noises
- Solution: Mark as "No golf shot" during review

---

## Ball Origin Detection [Desktop Backend]

### Overview

To draw accurate shot tracers, the system needs to know where the ball was at the moment of impact. This is done using computer vision to detect the golf club and estimate ball position.

### Why Not Track the Ball Directly?

YOLO-based ball detection fails for golf balls in flight because:
- Golf balls are small (~1% of frame width)
- Fast movement (150+ mph) causes motion blur
- YOLO's "sports ball" class is trained on larger balls (soccer, basketball)

### Two-Step Detection Approach

**Step 1: Shaft Line Detection**

1. YOLO detects the golfer's body (bounding box)
2. Line Segment Detector (LSD) + Hough Transform finds straight lines
3. Geometric filtering keeps only lines that:
   - Have one end near the golfer's hands (grip)
   - Have other end near the golfer's feet (clubhead)
   - Are diagonal (15-60 degrees from horizontal)
   - Point from upper-left to lower-right (for right-handed golfer)
4. Color analysis confirms the line is a dark shaft (not grass)
5. If shaft score < 0.75, fall back to clubhead-only detection

**Step 2: Clubhead Detection**

1. Search small region around detected hosel position (80px right, +/-40px vertical)
2. Color masks identify:
   - Bright, low-saturation areas (metallic driver crown)
   - Very dark areas (matte black clubhead)
3. Contour analysis finds clubhead-sized shapes
4. Centroid of the detected region = clubhead center

**Step 3: Combine for Ball Position**

- `ball_x = clubhead_center_x` (center of clubhead face)
- `ball_y = clubhead_center_y` (represents hosel midpoint / ground level)

This approach works because at address position, the ball sits directly in front of the clubhead face at ground level.

### Detection Module

The detection logic lives in `detection/origin.py` - `BallOriginDetector`:
- Multi-method ball origin detection before impact
- Primary method: Shaft line detection + clubhead region detection
- Fallback: Clubhead-only detection (bright metallic areas)
- NO percentage-based estimates from golfer dimensions

### Accuracy

Tested results show shaft detection scores of 0.92-0.96, with ball position accurately placed at the clubhead center.

| Shot | Strike Time | Ball Origin | Method | Shaft Score |
|------|-------------|-------------|--------|-------------|
| 1 | 18.25s | (1579, 1814) | shaft+clubhead | 0.96 |
| 2 | 60.28s | (2100, 1835) | shaft+clubhead | 0.96 |
| 3 | 111.46s | (1524, 1822) | shaft+clubhead | 0.92 |

---

## Shot Tracer System [Browser App]

### Overview

The shot tracer overlays ball flight trajectory on video clips during review and export. Unlike systems that track the actual ball frame-by-frame (which fails for small, fast-moving golf balls), GolfClip uses a physics-based approach.

### Key Insight: Accuracy vs. Aesthetics

The goal is NOT to track the exact ball position in every frame. What matters is:

1. **Start point accurate**: Ball origin at impact (we have this working)
2. **End point accurate**: Where ball lands or exits frame
3. **Trajectory characteristics correct**:
   - Height: high / medium / low
   - Start direction: left / center / right
   - Curve: draw (right-to-left) / straight / fade (left-to-right)
4. **Tracer LOOKS GOOD**: Should match the aesthetic of professional YouTube golf channels like Good Good, Grant Horvat, or Bryan Bros

The tracer doesn't need to follow the actual ball pixel-by-pixel. It needs to:
- Start at the right place
- End at the right place
- Follow a believable parabolic arc with the right general shape
- Look smooth and professional with nice glow/fade effects

### Review Flow (Direct Click)

The review flow uses direct click-to-mark for streamlined interaction:

1. **Step 1: Mark Landing** - User clicks directly on video where ball landed (no confirmation step)
   - Clicking implicitly confirms this is a golf shot
   - Creates a downward arrow marker (arrow icon)
   - "No golf shot" button available to mark as false positive
2. **Auto-Generate** - System generates trajectory using origin + landing + early detection
   - SSE streams progress: `extracting_template` -> `detecting_early` -> `generating_physics` -> `smoothing`
   - Detection warnings (shaft failed, early detection failed) shown to user for troubleshooting
3. **Step 2: Review Tracer** - "Does this look right?"
   - **Accept**: Tracer looks good, move to next shot
   - **Configure & Regenerate**: Adjust parameters:
     - Starting line: Left / Center / Right
     - Shot shape: Hook / Draw / Straight / Fade / Slice
     - Shot height: Low / Medium / High
     - Flight time: 1.0s - 10.0s slider

**Autoplay**: After trajectory generation completes, the video automatically seeks to clip start and plays the shot with tracer overlay.

### Trajectory Generation

When you mark landing:
1. Backend receives origin point (from clubhead detection) and landing point (user-marked)
2. Physics model generates a parabolic arc between the two points
3. Arc is modified based on:
   - Shot shape (adds horizontal curve)
   - Shot height (adjusts apex)
   - Starting line (initial direction offset)
4. Points are interpolated for smooth animation
5. Data is stored in database and returned to frontend

### Tracer Appearance

- **Color**: Red (#ff0000)
- **Style**: 3-layer bezier glow effect (shared renderer in `tracer-renderer.ts`)
  - Outer glow: wide, low opacity with bezier-smoothed path
  - Mid glow: medium width, medium opacity
  - Core line: thin, full opacity
- **Animation**: Progressive drawing effect (line grows as video plays) with physics-based easing (easeOutCubic/linear blend)
- **Rendering**: Identical between review (TrajectoryEditor.tsx) and export (video-frame-pipeline-v4.ts) via shared `drawTracerLine()` function
- **Markers**:
  - Apex marker at highest point (gold diamond)
  - Landing marker at end point (arrow icon)

### Frontend Components

**TrajectoryEditor.tsx** - Canvas overlay on video player:
- Uses shared `drawTracerLine()` from `tracer-renderer.ts` for consistent rendering
- Progressive animation (line grows as video plays)
- Custom SVG cursors for marker placement (crosshair, arrow, diamond icons)
- Touch/pointer event support for mobile
- Safari fallback for canvas blur filter

**ClipReview.tsx** additions:
- Direct click review flow: mark landing -> auto-generate -> review (no confirmation step)
- SSE progress bar during trajectory generation
- Detection warnings display for troubleshooting
- "Show Tracer" checkbox to toggle trajectory visibility
- "No Golf Shot" (red) / "Approve Shot" buttons for shot review
- "Accept" / "Configure" buttons for tracer review
- Markers rendered via TrajectoryEditor: landing (arrow), apex (diamond)
- Custom SVG cursors matching marker icons during placement
- Autoplay: video seeks to clip start and plays after trajectory generation completes
- FPS-aware frame stepping via `requestVideoFrameCallback`

**PointStatusTracker.tsx** - Visual step progress indicator:
- Shows 2 main steps: "Mark Landing" and "Review Tracer"
- Current step highlighted with completion status
- Compact horizontal layout fits in review UI

### Backend Modules

**models/trajectory.py** - CRUD operations:
```python
create_trajectory(job_id, shot_id, trajectory_points, ...)
get_trajectory(job_id, shot_id) -> dict | None
get_trajectories_for_job(job_id) -> list[dict]
update_trajectory(job_id, shot_id, trajectory_points, is_manual_override=True)
```

**processing/tracer.py** - OpenCV renderer:
```python
TracerRenderer.render_tracer_on_frame(frame, trajectory_points, current_time, ...)
TracerExporter.export_with_tracer(output_path, start_time, end_time, trajectory_points, ...)
```

### Trajectory Data Format

```json
{
  "shot_id": 1,
  "points": [
    {"timestamp": 0.0, "x": 0.5, "y": 0.8, "confidence": 0.95, "interpolated": false},
    {"timestamp": 0.1, "x": 0.52, "y": 0.7, "confidence": 0.90, "interpolated": false}
  ],
  "apex_point": {"timestamp": 0.5, "x": 0.6, "y": 0.2},
  "confidence": 0.85,
  "frame_width": 1920,
  "frame_height": 1080,
  "is_manual_override": false
}
```

### Tracer Style Options

When exporting with tracer, you can customize appearance:
- `color`: Hex color for tracer line (default: white)
- `line_width`: Line thickness in pixels
- `glow_enabled`: Add glow effect around line
- `show_apex_marker`: Circle at highest point
- `show_landing_marker`: X marker at landing point

### Early Ball Detection

Motion tracking in first 200ms post-impact:
- `early_tracker.py` - Constraint-based ball tracking
- `color_family.py` - Color family classification (white, yellow, orange, etc.)
- `search_expansion.py` - Expanding search patterns for candidate detection

### Tracking Modules

**detection/tracker.py** - `ConstrainedBallTracker`:
- Generates physics-based parabolic trajectories from origin point
- Uses calibrated parameters: 3s flight, 0.5 apex height, slight draw
- Frame differencing for early motion detection (first 200ms)
- Scores candidates by: brightness, position, centering, consistency

---

## Trajectory Animation [Browser App]

### Overview

The tracer animation draws a progressive trajectory line as the video plays, using quadratic Bezier curves for smooth ball flight paths.

### Trajectory Generation (`trajectory-generator.ts`)

Trajectories are generated as quadratic Bezier curves:

- **P0** = origin (ball position at impact, default bottom-center)
- **P2** = landing (user-marked position)
- **Apex** = midpoint raised by height multiplier (low: 0.15, medium: 0.25, high: 0.35)
- **P1 (control point)** = calculated so curve passes through apex at t=0.5: `P1 = 2*apex - 0.5*(P0 + P2)`

Shot shape adds lateral curve offset to the control point (hook: -0.15 through slice: +0.15).

### Animation Timing (`TrajectoryEditor.tsx`)

The animation maps video playback time to trajectory progress using a monotonic easing blend:

```typescript
// easeOutCubic: fast start, slowing down
const easeOut = 1 - Math.pow(1 - t, 3)
const linear = t
// Blend from 70% easeOut (early) toward 30% easeOut (late)
const easeWeight = 0.7 - 0.4 * t
const progress = easeOut * easeWeight + linear * (1 - easeWeight)
```

This creates a natural ball flight feel: fast off the clubface, decelerating toward landing.

### Design Note: Original 3-Stage Easing Model

An earlier design proposed a more sophisticated 3-stage easing model based on real golf ball physics research (160mph launch, 72mph terminal velocity), with separate `easeOutQuart`, `easeInOutQuad`, and linear+ease stages. The current implementation simplified this to the single easeOutCubic/linear blend above, which produces a similar visual effect with less complexity.

### Technical Details

- **Frame rate**: 60fps using `requestAnimationFrame`
- **Trajectory points**: 60 points per second of flight time (e.g., 180 points for 3s flight)
- **Interpolation**: Leading edge is interpolated between trajectory points for perfectly smooth animation
- **Rendering**: HTML5 Canvas with `devicePixelRatio` scaling
- **Curves**: Quadratic Bezier splines for smooth lines
- **Hold**: Trajectory stays visible 1.5 seconds after animation completes

### V4 Export Tracer Rendering

For exported videos, the tracer is composited during the encoding pass using the same shared renderer (`tracer-renderer.ts`) as the review UI:
1. For each video frame, calculate `currentTime` relative to trajectory start
2. Call `drawTracerLine()` with current time, trajectory points, and canvas context
3. The shared renderer handles physics-based easing, path-length interpolation, and 3-layer bezier glow

**Audio sync:** The export pipeline returns `actualStartTime` (actual first frame time after HTML5 keyframe seek snap) so audio muxing via FFmpeg aligns precisely with the captured video.

**Important:** The video element must be positioned in the viewport (not off-screen) during capture, or Chrome will throttle `requestVideoFrameCallback` to ~1fps.

---

## Clip Review Interface [Browser App]

### Overview

The review interface lets you verify detected shots, adjust clip boundaries, and add shot tracers before export.

### Components

**Video Player**
- Client-side video playback (no backend streaming required)
- Canvas overlay for trajectory rendering
- Click-to-mark functionality for landing points

**Timeline Scrubber**
- Draggable start/end handles
- Visual representation of clip boundaries
- Current position indicator

**Playback Controls**
- Play/Pause toggle
- Frame step (forward/backward)
- 1-second jump buttons
- Keyboard shortcuts for efficiency

**Trajectory Configuration** (when configuring)
- Button groups for starting line, shot shape, shot height
- Slider for flight time
- Generate and Start Over buttons

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/Pause |
| Left Arrow | Previous frame (FPS-aware) |
| Right Arrow | Next frame (FPS-aware) |
| Shift+Left Arrow | Back 1 second |
| Shift+Right Arrow | Forward 1 second |
| Up Arrow | Previous shot |
| Down Arrow | Next shot |
| [ | Set start to current time |
| ] | Set end to current time |
| I | Set impact time to current position |
| Enter | Accept shot |
| Esc | No golf shot (skip) |

### State Management

Uses Zustand for state (`stores/processingStore.ts`):
- `videos`: Map of video states with segments, trajectories, and approval status
- `activeVideoId`: Which video is currently being reviewed
- `segments`: Legacy single-video segments array

### Frame Stepping

Frame step buttons (⏩/⏪) and arrow keys use FPS-aware stepping:
- Video FPS is auto-detected via `requestVideoFrameCallback` on first frame load
- Steps snap to frame boundaries: `Math.floor(currentTime / frameDuration + epsilon) + 1`
- Falls back to 30fps if detection fails
- Each click produces a distinct visible video frame

---

## Export System [Browser App]

### Overview

After reviewing shots, accepted clips are exported as individual video files with optional tracer overlay. The browser app uses WebCodecs API with real-time video frame capture for hardware-accelerated client-side export.

### Export Pipeline

The export pipeline uses `requestVideoFrameCallback` for real-time frame capture at approximately 0.85x realtime speed, preserving the source video's framerate.

### Pipeline Architecture

The export uses a two-pass approach for reliable capture:

**Pass 1: Real-Time Capture**
1. Seek to clip start time
2. Play video at 1x speed
3. `requestVideoFrameCallback()` fires on each decoded frame
4. Draw video to canvas at output resolution (e.g., 1080p)
5. Create `ImageBitmap` from canvas, store with timestamp
6. Stop when reaching clip end time

**Pass 2: Encoding**
1. For each captured `ImageBitmap`:
   - Draw to output canvas
   - Composite tracer overlay
   - Create `VideoFrame`, encode with `VideoEncoder`
2. Finalize MP4 with `mp4-muxer`

```
┌─────────────────────────────────────────────────────────────────────┐
│                       TWO-PASS PIPELINE                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PASS 1: CAPTURE (~10s for 10s clip)                                │
│  video.play() → requestVideoFrameCallback → drawImage → ImageBitmap │
│                                                                      │
│  PASS 2: ENCODE (~2s for 10s clip)                                  │
│  ImageBitmap → canvas + tracer → VideoFrame → VideoEncoder → MP4    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Resolution Options

Export resolution can be selected from dropdown:
- **Original**: Source resolution (may be 4K)
- **1080p (faster)**: Downscale to max 1080p height
- **720p (fastest)**: Downscale to max 720p height

Downscaling happens during capture, making export faster for high-res sources.

### Output Structure

```
Downloads/
├── shot_1.mp4
├── shot_2.mp4
└── shot_3.mp4
```

### Quality Validation

Export files under 10MB typically indicate quality issues:
- Low framerate (should be ~60fps for 60fps source)
- Missing video content (just tracer on black)
- Excessive compression

### Export Options

```json
{
  "resolution": "1080p",
  "render_tracer": true,
  "tracer_style": {
    "color": "#FF0000",
    "glow_enabled": true,
    "line_width": 3
  }
}
```

### Browser Compatibility

Export requires `requestVideoFrameCallback` support:
- Chrome 83+
- Edge 83+
- Safari 15.4+
- Firefox: Not currently supported

### Key Files

| File | Purpose |
|------|---------|
| `video-frame-pipeline-v4.ts` | Real-time capture pipeline (returns `actualStartTime` for audio sync) |
| `tracer-renderer.ts` | Shared tracer drawing used by both review and export |
| `ffmpeg-client.ts` | FFmpeg WASM operations including audio muxing into exported clips |
| `ClipReview.tsx` | Export UI and controls |

---

## Feedback Systems [Desktop Backend]

GolfClip includes three feedback collection systems for ML improvement.

### Shot Feedback (TP/FP Classification)

Collects true positive/false positive labels from users to improve detection accuracy.

**Flow:**
1. User exports clips -> `ExportComplete.tsx` shows feedback UI
2. User marks each clip as Good (TP) or Bad (FP) with optional notes
3. Feedback is submitted to `POST /api/feedback/{job_id}`
4. Detection features are snapshotted at feedback time for ML training

**Data Export:**
```bash
# Export all feedback for analysis
curl http://localhost:8420/api/feedback/export

# Get precision stats
curl http://localhost:8420/api/feedback/stats
```

### Tracer Feedback

Collects user corrections to auto-generated trajectories for ML improvement.

**Feedback Types:**

| Type | When | Data Captured |
|------|------|---------------|
| `tracer_auto_accepted` | User accepts auto-generated tracer | auto_params |
| `tracer_configured` | User adjusts config then accepts | auto_params, final_params, delta |
| `tracer_reluctant_accept` | User accepts despite issues | auto_params, final_params |
| `tracer_skip` | User skips shot entirely | auto_params, final_params |
| `tracer_rejected` | User accepts shot without tracer | auto_params, final_params |

**ML Training Data (The Delta):**

The key training signal is the **delta** between auto-generated and user-configured params:

```json
{
  "origin": {"x": 0.45, "y": 0.85},
  "landing": {"x": 0.72, "y": 0.65},
  "auto_params": {"height": "medium", "shape": "straight", "flight_time": 3.0},
  "final_params": {"height": "high", "shape": "draw", "flight_time": 4.5},
  "delta": {
    "height": {"from": "medium", "to": "high", "change": "+1"},
    "flight_time": {"from": 3.0, "to": 4.5, "change": 1.5}
  }
}
```

### Origin Feedback

Collects user corrections to auto-detected ball origins for ML improvement.

**How It Works:**
1. When generating a trajectory, the system always runs auto-detection first
2. If the user manually marks an origin point (via "Mark on Video"), feedback is captured
3. The system records both auto-detected and manual origins with error metrics

**Database Schema:**
```sql
origin_feedback (
  id, job_id, shot_id, video_path, strike_time,
  frame_width, frame_height,
  -- Auto-detection results
  auto_origin_x, auto_origin_y, auto_confidence, auto_method, shaft_score, clubhead_detected,
  -- User correction
  manual_origin_x, manual_origin_y,
  -- Error metrics (computed)
  error_dx, error_dy, error_distance,
  created_at, environment
)
```

**Stats Response Example:**
```json
{
  "total_feedback": 42,
  "correction_rate": 0.38,
  "mean_error_distance": 0.045,
  "by_method": {
    "shaft+clubhead": 35,
    "clubhead_only": 5,
    "fallback": 2
  }
}
```

---

## ML Improvement Pipeline [Desktop Backend]

The feedback collected during review trains ML models to reduce false positives.

### CLI Commands

```bash
# View feedback stats and available stages
python -m backend.ml.feedback_stats
python -m backend.ml.feedback_stats --trend  # Show weekly FP rate trend

# Run analysis (dry run by default)
python -m backend.ml.analyze analyze --stage 1  # Threshold tuning
python -m backend.ml.analyze analyze --stage 2  # Weight optimization
python -m backend.ml.analyze analyze --stage 3  # Confidence recalibration

# Apply changes
python -m backend.ml.analyze analyze --stage 1 --apply

# Rollback to previous config
python -m backend.ml.analyze rollback
```

### Stage Requirements

| Stage | Min Samples | What It Does |
|-------|-------------|--------------|
| 1 | 10 | Finds optimal confidence threshold |
| 2 | 50 | Learns feature weights via logistic regression |
| 3 | 200 | Calibrates confidence scores via isotonic regression |

### Config File

ML parameters are stored in `~/.golfclip/ml_config.json`:

```json
{
  "version": 1,
  "confidence_threshold": 0.76,
  "feature_weights": {"height": 0.20, "decay": 0.25, ...},
  "calibration_model": {"0.70": 0.65, ...},
  "update_history": [...]
}
```

### Future ML Improvements

**Shot Detection:**
1. **Threshold Tuning**: Analyze FP rate by confidence -> optimize threshold
2. **Weight Optimization**: Train logistic regression on detection features
3. **Pattern Analysis**: Categorize FP reasons from notes
4. **Active Learning**: Prioritize uncertain detections for review

**Tracer Generation:**
1. **Stage 1: Bias correction** - Learn global adjustments (e.g., "always increase height by 1 level")
2. **Stage 2: Position-based prediction** - Learn from origin/landing positions
3. **Stage 3: Per-user calibration** - Personalize defaults per user

**Origin Detection:**
1. **Stage 1: Calibration offset** - Learn systematic bias per camera angle
2. **Stage 2: Detection method selection** - Learn when to use shaft vs clubhead-only
3. **Stage 3: Confidence recalibration** - Improve confidence scoring based on actual errors

---

## Database Schema

SQLite database at `~/.golfclip/golfclip.db` with schema versioning:

```sql
-- Schema v7 (current)
jobs (id, video_path, output_dir, status, progress, ...)
shots (id, job_id FK, shot_number, strike_time, confidence, landing_x, landing_y, ...)
shot_feedback (id, job_id FK, shot_id, feedback_type, notes, confidence_snapshot, ...)
shot_trajectories (id, job_id FK, shot_id, points JSON, apex_point JSON, confidence, ...)
tracer_feedback (id, job_id FK, shot_id, feedback_type, auto_params JSON, final_params JSON, ...)
origin_feedback (id, job_id FK, shot_id, auto_origin vs manual_origin, error metrics, ...)
```

---

## Implemented Enhancements

- **Multi-video upload**: Upload multiple videos at once via drag-and-drop or file picker. Videos are queued and processed sequentially. `VideoQueue.tsx` shows queue status in the header.

## Future Enhancements

- **Parallel processing**: Process uploaded videos in parallel instead of sequentially
- **Automatic Landing Detection**: Computer vision to find ball landing
- **Multiple Tracer Styles**: Different colors, effects, animations
- **Hole Overlays**: Display hole number, yardage, shot count
- **Cloud Processing**: Offload heavy processing to cloud
- **Video Zoom Controls**: Zoom (1x-4x) with pan support for precise marker placement during review
