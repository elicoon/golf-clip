# GolfClip Features Documentation

This document provides detailed explanations of how each feature in GolfClip works.

---

## Table of Contents

1. [Audio Shot Detection](#audio-shot-detection)
2. [Ball Origin Detection](#ball-origin-detection)
3. [Shot Tracer System](#shot-tracer-system)
4. [Trajectory Animation](#trajectory-animation)
5. [Clip Review Interface](#clip-review-interface)
6. [Export System](#export-system)

---

## Audio Shot Detection

### Overview

GolfClip detects golf shots by analyzing the audio track of your video. When a golf club strikes a ball, it creates a distinctive transient sound - a sharp, loud "thwack" that stands out from background noise.

### How It Works

1. **Audio Extraction**: FFmpeg extracts the audio track from your video file
2. **Bandpass Filtering**: Filters audio to 1000-8000 Hz (where ball strike sounds are most prominent)
3. **Transient Detection**: Identifies sudden spikes in audio energy
4. **Feature Analysis**: Each potential strike is scored on multiple features:

| Feature | Weight | What It Measures |
|---------|--------|------------------|
| Peak height | 20% | How loud the transient is compared to background |
| Spectral flatness | 10% | Whether sound is noise-like (strikes are ~0.3) |
| Spectral centroid | 15% | Frequency brightness (strikes are 2500-4500 Hz) |
| Peak prominence | 15% | How much the peak stands out |
| Rise time | 10% | Attack speed (strikes have fast <10ms attack) |
| Decay ratio | 20% | How quickly sound fades (strikes decay fast) |
| Zero-crossing rate | 10% | Helps filter out swoosh sounds |

5. **Deduplication**: Groups detections within 25-second windows, keeping only the highest-confidence detection per group
6. **Confidence Scoring**: Final confidence = weighted combination of all features

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

## Ball Origin Detection

### Overview

To draw accurate shot tracers, the system needs to know where the ball was at the moment of impact. This is done using computer vision to detect the golf club and estimate ball position.

### How It Works

The detection uses a two-step approach:

**Step 1: Shaft Line Detection**
1. YOLO detects the golfer's body (bounding box)
2. Line Segment Detector (LSD) + Hough Transform finds straight lines
3. Geometric filtering keeps only lines that:
   - Have one end near the golfer's hands (grip)
   - Have other end near the golfer's feet (clubhead)
   - Are diagonal (15-60 degrees from horizontal)
   - Point from upper-left to lower-right (for right-handed golfer)
4. Color analysis confirms the line is a dark shaft (not grass)

**Step 2: Clubhead Detection**
1. Search region around the detected shaft hosel position
2. Color masks identify:
   - Bright, low-saturation areas (metallic driver crown)
   - Very dark areas (matte black clubhead)
3. Contour analysis finds clubhead-sized shapes
4. Centroid of the detected region = ball position

### Why This Approach?

- Golf balls are too small to detect reliably with YOLO
- At address position, the ball sits directly in front of the clubhead
- By finding the clubhead center, we accurately locate the ball

### Accuracy

Tested results show shaft detection scores of 0.92-0.96, with ball position accurately placed at the clubhead center.

---

## Shot Tracer System

### Overview

The shot tracer creates a visual arc showing the ball's flight path. Unlike systems that track the actual ball frame-by-frame (which fails for small, fast-moving golf balls), GolfClip uses a physics-based approach.

### Key Insight

**The tracer doesn't need to follow the actual ball.** What matters is:
1. **Start point**: Ball origin at impact (detected via clubhead)
2. **End point**: Where ball lands (user-marked)
3. **Trajectory shape**: Believable parabolic arc
4. **Aesthetics**: Smooth, professional-looking animation

### Three-Step Marking Flow

**Step 1: Mark Target**
- User clicks where they were aiming
- Creates a crosshair marker on the video
- Used for future analytics (aim vs. result)

**Step 2: Mark Landing**
- User clicks where the ball actually landed
- Creates a downward arrow marker
- Defines the trajectory endpoint

**Step 3: Configure & Generate**
- **Starting line**: Left / Center / Right - initial ball direction
- **Shot shape**: Hook / Draw / Straight / Fade / Slice - curve type
- **Shot height**: Low / Medium / High - apex height
- **Flight time**: 1-6 seconds - how long the ball is in the air
- Click "Generate" to create the trajectory

### Trajectory Generation

When you click Generate:
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
- **Style**: Multi-layer glow effect
  - Outer glow: 8px wide, 40% opacity
  - Inner glow: 5px wide, 60% opacity
  - Core line: 3px wide, 100% opacity
- **Animation**: Progressive drawing effect (line grows as video plays)

---

## Trajectory Animation

### Overview

The tracer animation is carefully tuned to match real golf ball physics, making it look natural and professional.

### Physics-Based Timing

Research on actual golf ball flight shows:
- Ball launches at ~160 mph, lands at ~70 mph
- Ball covers most distance early (when moving fast)
- Descent is nearly constant speed (drag limits acceleration)

### Animation Model

| Time Range | Distance Covered | Easing | Reason |
|------------|------------------|--------|--------|
| 0-25% | 0-45% | easeOutQuart | Ball at peak velocity (160+ mph) |
| 25-50% | 45-55% | easeInOutQuad | Decelerating as it approaches apex |
| 50-100% | 55-100% | ~Linear | Terminal velocity limits falling speed |

### Implementation

```typescript
// Stage 1: Explosive start
if (t <= 0.25) {
  return 0.45 * easeOutQuart(t / 0.25)
}

// Stage 2: Approaching apex
if (t <= 0.50) {
  return 0.45 + 0.10 * easeInOutQuad((t - 0.25) / 0.25)
}

// Stage 3: Near-linear descent
const linearPart = ((t - 0.50) / 0.50) * 0.9
const easePart = easeOut((t - 0.50) / 0.50) * 0.1
return 0.55 + 0.45 * (linearPart + easePart)
```

### Technical Details

- **Frame rate**: 60fps using `requestAnimationFrame`
- **Rendering**: HTML5 Canvas with `devicePixelRatio` scaling
- **Curves**: Quadratic Bezier splines for smooth lines
- **Hold**: Trajectory stays visible 1.5 seconds after animation completes

---

## Clip Review Interface

### Overview

The review interface lets you verify detected shots, adjust clip boundaries, and add shot tracers before export.

### Components

**Video Player**
- Streams video from backend via Range requests (supports seeking)
- Canvas overlay for trajectory rendering
- Click-to-mark functionality for target/landing points
- Zoom controls (1x-4x) for precise marker placement
- Pan support when zoomed in

**Timeline Scrubber**
- Draggable start/end handles
- Visual representation of clip boundaries
- Current position indicator

**Playback Controls**
- Play/Pause toggle
- Frame step (forward/backward)
- 1-second jump buttons
- Keyboard shortcuts for efficiency

**Trajectory Configuration**
- Button groups for starting line, shot shape, shot height
- Slider for flight time
- Generate and Start Over buttons

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play/Pause |
| ← | Previous frame |
| → | Next frame |
| Shift+← | Back 1 second |
| Shift+→ | Forward 1 second |
| [ | Set start to current time |
| ] | Set end to current time |
| + / - | Zoom in/out |
| 0 | Reset zoom |
| Enter | Accept shot |
| Esc | No golf shot (skip) |

### State Management

Uses Zustand for state:
- `shots`: Array of detected shots with boundaries and confidence
- `currentShotIndex`: Which shot is being reviewed
- `trajectory`: Current trajectory data for rendering

---

## Export System

### Overview

After reviewing shots, accepted clips are exported as individual video files.

### Export Process

1. **Start Export**: Frontend sends list of approved clips to backend
2. **Job Creation**: Backend creates export job with unique ID
3. **Processing**: For each clip:
   - FFmpeg extracts the clip segment
   - If tracer rendering enabled, OpenCV burns tracer onto frames
   - Clip saved to output directory
4. **Progress Updates**: Frontend polls for status updates
5. **Completion**: Modal shows results with output location

### Output Structure

```
[video_name]_clips/
├── shot_1.mp4
├── shot_2.mp4
└── shot_3.mp4
```

### Tracer Rendering

When "Render Shot Tracers" is enabled:
1. Each frame is read by OpenCV
2. Trajectory is drawn onto frame at current timestamp
3. Includes glow effect and proper timing
4. Frame is encoded back into output video

### Export Options

```json
{
  "render_tracer": true,
  "tracer_style": {
    "color": "#FF0000",
    "glow_enabled": true,
    "line_width": 3
  }
}
```

---

## API Reference

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/upload` | POST | Upload video file |
| `/api/process` | POST | Start processing job |
| `/api/status/{job_id}` | GET | Get job status |
| `/api/shots/{job_id}` | GET | Get detected shots |
| `/api/export` | POST | Start export job |
| `/api/trajectory/{job_id}/{shot_id}/generate` | GET (SSE) | Generate trajectory |

### Trajectory Generation SSE Events

```
event: progress
data: {"progress": 50, "message": "Generating physics trajectory"}

event: warning
data: {"message": "Shaft detection failed, using fallback"}

event: complete
data: {"trajectory": {...}}

event: error
data: {"error": "Failed to generate trajectory"}
```

---

## Database Schema

```sql
-- Jobs table
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    video_path TEXT,
    output_dir TEXT,
    status TEXT,
    progress REAL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Shots table
CREATE TABLE shots (
    id INTEGER PRIMARY KEY,
    job_id TEXT REFERENCES jobs(id),
    shot_number INTEGER,
    strike_time REAL,
    confidence REAL,
    clip_start REAL,
    clip_end REAL,
    landing_x REAL,
    landing_y REAL
);

-- Trajectories table
CREATE TABLE shot_trajectories (
    id INTEGER PRIMARY KEY,
    job_id TEXT,
    shot_id INTEGER,
    points TEXT,  -- JSON array
    apex_point TEXT,  -- JSON object
    confidence REAL,
    is_manual_override BOOLEAN
);
```

---

## Future Enhancements

- **ML Feedback Loop**: Use TP/FP feedback to improve detection
- **Automatic Landing Detection**: Computer vision to find ball landing
- **Multiple Tracer Styles**: Different colors, effects, animations
- **Hole Overlays**: Display hole number, yardage, shot count
- **Cloud Processing**: Offload heavy processing to cloud
