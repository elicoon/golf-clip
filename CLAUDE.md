# CLAUDE.md - GolfClip

## Project Overview

AI-powered golf clip detection and export tool. Analyzes video to detect golf shots using audio transient detection and visual ball tracking, then exports trimmed clips.

## Tech Stack

- **Backend**: FastAPI + Python 3.11+
- **Audio Processing**: librosa, ffmpeg-python
- **Video Processing**: OpenCV, ffmpeg
- **Database**: SQLite with aiosqlite (async)
- **Testing**: pytest with async support

## Project Structure

```
golf-clip/
├── src/
│   ├── backend/
│   │   ├── api/              # FastAPI routes and endpoints
│   │   │   ├── routes.py     # All API endpoints
│   │   │   └── schemas.py    # Pydantic request/response models
│   │   ├── core/             # Database, config, settings
│   │   │   ├── database.py   # SQLite setup and migrations
│   │   │   └── config.py     # App settings
│   │   ├── detection/        # Shot detection algorithms
│   │   │   ├── audio.py      # Audio transient detection
│   │   │   ├── visual.py     # YOLO ball tracking
│   │   │   ├── origin.py     # Ball origin detection (shaft + clubhead)
│   │   │   ├── tracker.py    # Constraint-based ball tracking
│   │   │   ├── early_tracker.py  # Early ball motion detection (first 200ms)
│   │   │   ├── color_family.py   # Color family classification for ball detection
│   │   │   ├── search_expansion.py # Expanding search for ball candidates
│   │   │   └── pipeline.py   # Combined detection pipeline
│   │   ├── models/           # Database CRUD operations
│   │   │   ├── job.py        # Job, Shot, Feedback operations
│   │   │   └── trajectory.py # Trajectory CRUD for shot tracers
│   │   ├── processing/       # Video processing utilities
│   │   │   └── tracer.py     # Shot tracer rendering (OpenCV)
│   │   └── tests/            # Integration tests
│   │       ├── conftest.py   # Pytest fixtures
│   │       ├── test_audio_detection.py
│   │       ├── test_database.py
│   │       ├── test_download.py
│   │       ├── test_feedback.py
│   │       └── test_integration.py
│   └── frontend/
│       └── src/
│           ├── App.tsx           # Main app with view routing
│           ├── components/
│           │   ├── VideoDropzone.tsx     # File input
│           │   ├── ProcessingView.tsx    # Progress tracking
│           │   ├── ClipReview.tsx        # Shot review + export + autoplay
│           │   ├── ExportComplete.tsx    # Feedback collection
│           │   ├── Scrubber.tsx          # Timeline controls
│           │   ├── TrajectoryEditor.tsx  # Shot tracer canvas overlay
│           │   └── PointStatusTracker.tsx # Four-step marking progress UI
│           └── stores/
│               └── appStore.ts   # Zustand state management
└── PRD.md
```

## Development Commands

```bash
# Run backend server (from src directory)
cd golf-clip/src
uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload

# Run frontend (from frontend directory)
cd golf-clip/src/frontend
npm install
npm run dev

# Run tests
cd golf-clip/src/backend
pytest tests/ -v

# Run specific test file
pytest tests/test_integration.py -v

# Skip slow tests
pytest tests/ -v -m "not slow"
```

## Running in Browser (Dev Mode)

When running the frontend in a browser (not Tauri), file system access is restricted:

1. **File Upload**: Videos are uploaded to the backend via `POST /api/upload`, which saves them to a temp directory and returns the server path
2. **Video Playback**: The `GET /api/video` endpoint streams video files to the browser with Range request support for seeking
3. **File Selection**: Click "Select File" to upload, or use the hidden "Enter path manually (dev mode)" option for local paths

## Setup (macOS)

```bash
# Install Python 3.11 and ffmpeg
brew install python@3.11 ffmpeg

# Create virtual environment
cd golf-clip
/opt/homebrew/bin/python3.11 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"
```

## Environment Variables

All settings can be configured via environment variables with the `GOLFCLIP_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `GOLFCLIP_HOST` | `127.0.0.1` | Server host |
| `GOLFCLIP_PORT` | `8420` | Server port |
| `GOLFCLIP_DEBUG` | `true` | Enable debug mode |
| `GOLFCLIP_CONFIDENCE_THRESHOLD` | `0.70` | Clips below this require review |
| `GOLFCLIP_CLIP_PADDING_BEFORE` | `2.0` | Seconds before ball strike |
| `GOLFCLIP_CLIP_PADDING_AFTER` | `2.0` | Seconds after ball lands |
| `GOLFCLIP_AUDIO_SENSITIVITY` | `0.5` | Detection sensitivity (0-1, try 0.7-0.9 if getting 0 shots) |
| `GOLFCLIP_FFMPEG_THREADS` | `0` | FFmpeg threads (0 = auto-detect) |
| `GOLFCLIP_FFMPEG_TIMEOUT` | `600` | FFmpeg timeout in seconds |

## Windows/FFmpeg Notes

- **ffmpeg via winget**: Installed but NOT in PATH by default
- Location: `~/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin/`
- `conftest.py` automatically detects and adds ffmpeg to PATH for tests
- If ffmpeg tests skip, verify winget installation or add ffmpeg bin to system PATH

## Testing Patterns

### Database Isolation
Tests use isolated SQLite databases via `unittest.mock.patch`:
```python
with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
    from backend.main import app
    # App uses test database
```

### Async in Sync Tests
Use `asyncio.new_event_loop()` for async DB calls in synchronous test code:
```python
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)
try:
    loop.run_until_complete(async_db_function())
finally:
    loop.close()
```

### Dynamic Module Access
When patching before import, use proxy classes for module-level state:
```python
class JobCacheProxy:
    def __getitem__(self, key):
        from backend.api.routes import _job_cache
        return _job_cache[key]
```

## API Endpoints

### Processing & Export
- `POST /api/upload` - Upload video file (returns server path for processing)
- `POST /api/process` - Start video processing/detection job
- `GET /api/status/{job_id}` - Get job status
- `GET /api/progress/{job_id}` - SSE progress stream
- `GET /api/shots/{job_id}` - Get detected shots for a job
- `POST /api/shots/{job_id}/update` - Update shot boundaries after review
- `POST /api/export` - Export approved clips
- `GET /api/export/{export_job_id}/status` - Get export job status
- `GET /api/jobs` - List all jobs
- `DELETE /api/jobs/{job_id}` - Delete a job
- `GET /api/video-info?path=...` - Get video metadata
- `GET /api/video?path=...&download=true` - Stream video file (supports Range requests for seeking, add `download=true` to trigger browser download)

### Feedback Collection (for ML improvement)
- `POST /api/feedback/{job_id}` - Submit TP/FP feedback on detected shots
- `GET /api/feedback/{job_id}` - Get feedback for a specific job
- `GET /api/feedback/export` - Export all feedback data for analysis
- `GET /api/feedback/stats` - Get aggregate precision statistics

### Trajectory / Shot Tracer (Phase 2)
- `GET /api/trajectory/{job_id}/{shot_id}` - Get trajectory data for a shot (normalized 0-1 coords)
- `PUT /api/trajectory/{job_id}/{shot_id}` - Update trajectory after manual edits
- `GET /api/trajectories/{job_id}` - Get all trajectories for a job
- `GET /api/trajectory/{job_id}/{shot_id}/generate?landing_x=&landing_y=` - SSE endpoint for trajectory generation with user-marked landing point (streams progress, warning, complete, error events)

## Detection Pipeline

1. **Audio Detection**: Analyze audio for transient peaks (golf strike sounds)
2. **Deduplication**: Filter nearby detections to keep strongest in each 25s window
3. **Visual Detection**: Track ball movement using YOLO + optical flow
4. **Trajectory Capture**: Store ball flight path for tracer rendering (Phase 2)
5. **Confidence Scoring**: Combine audio/visual signals with confidence thresholds
6. **Review**: User reviews and adjusts detected shots (with optional tracer preview)
7. **Export**: Trim and export selected clips with optional tracer overlay

## Audio Detection Features

The audio detector (`detection/audio.py`) uses multiple features to identify golf ball strikes:

| Feature | Weight | Description |
|---------|--------|-------------|
| Peak height | 20% | Transient amplitude relative to local mean |
| Spectral flatness | 10% | Noise-like vs tonal (strikes are moderate ~0.3) |
| Spectral centroid | 15% | Frequency "brightness" (strikes ~2500-4500 Hz) |
| Peak prominence | 15% | How much peak stands out from background |
| Rise time | 10% | Attack speed (strikes have fast attack <10ms) |
| Decay ratio | 20% | How quickly sound decays (strikes decay fast) |
| Zero-crossing rate | 10% | Helps filter swoosh sounds (practice swings) |

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

### Troubleshooting: 0 Shots Detected

If the detector finds 0 shots, check the logs for diagnostic messages:
- `Audio appears very quiet (peak < 0.01)` - Source audio may be too quiet
- `No peaks met threshold` - Try increasing sensitivity:
  ```bash
  export GOLFCLIP_AUDIO_SENSITIVITY=0.8
  ```
- Typical sensitivity values: 0.5 (default), 0.7-0.9 for quiet audio

## Database Schema

SQLite database at `~/.golfclip/golfclip.db` with schema versioning:

```sql
-- Schema v4 (current)
jobs (id, video_path, output_dir, status, progress, ...)
shots (id, job_id FK, shot_number, strike_time, confidence, landing_x, landing_y, ...)
shot_feedback (id, job_id FK, shot_id, feedback_type, notes, confidence_snapshot, ...)
shot_trajectories (id, job_id FK, shot_id, points JSON, apex_point JSON, confidence, ...)
```

## Feedback Collection System

The feedback system collects TP/FP labels from users to improve detection accuracy:

### Flow
1. User exports clips → `ExportComplete.tsx` shows feedback UI
2. User marks each clip as Good (TP) or Bad (FP) with optional notes
3. Feedback is submitted to `POST /api/feedback/{job_id}`
4. Detection features are snapshotted at feedback time for ML training

### Data Export
```bash
# Export all feedback for analysis
curl http://localhost:8420/api/feedback/export

# Get precision stats
curl http://localhost:8420/api/feedback/stats
```

### Future ML Improvements (Backlog)
1. **Threshold Tuning**: Analyze FP rate by confidence → optimize threshold
2. **Weight Optimization**: Train logistic regression on detection features
3. **Pattern Analysis**: Categorize FP reasons from notes
4. **Active Learning**: Prioritize uncertain detections for review

### Feature Backlog
1. **Multi-video upload**: Allow users to upload multiple videos at once
2. **Parallel processing**: Process uploaded videos in parallel instead of sequentially

## ML Improvement Pipeline

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

## Shot Tracer Feature (Phase 2)

The shot tracer overlays ball flight trajectory on video clips during review and export.

### How It Works

1. **Detection**: During `detect_shots()`, the pipeline detects ball origin via shaft + clubhead analysis
2. **Landing Point Marking**: User clicks on video to mark where ball lands, triggering SSE trajectory generation
3. **Physics Trajectory**: System generates parabolic arc constrained to hit origin and user-marked landing point
4. **Preview**: `TrajectoryEditor.tsx` renders trajectory on a canvas overlay synced to video playback
5. **Edit**: Users can drag trajectory points or re-mark landing point to adjust
6. **Export**: Optionally render tracer overlay onto exported clips using OpenCV

### Landing Point Workflow

The review flow uses click-to-mark for precise trajectory endpoints:
- User sees shot at impact frame with video playback controls
- Click on video marks landing point (confirms as true positive)
- SSE streams progress: `extracting_template` → `detecting_early` → `generating_physics` → `smoothing`
- Detection warnings (shaft failed, early detection failed) shown to user
- "No golf shot" marks as false positive, "Next →" requires trajectory generated

### Video Zoom Controls

The review interface supports zooming for precise marker placement:
- **Zoom in/out**: +/- buttons or keyboard shortcuts
- **Pan**: Click and drag when zoomed in (cursor changes to grab)
- **Reset**: Click reset button or press 0 to return to 1x
- Zoom range: 1x to 4x in 0.5x increments
- All marking functionality works at any zoom level

### Frontend Components

**TrajectoryEditor.tsx** - Canvas overlay on video player:
- Progressive animation (line grows as video plays)
- Control points: green (detected) vs gray (interpolated)
- Custom SVG cursors for marker placement (crosshair, arrow, diamond icons)
- Touch/pointer event support for mobile
- Safari fallback for canvas blur filter

**ClipReview.tsx** additions:
- Four-step click-to-mark flow: target → landing → apex → configure
- SSE progress bar during trajectory generation
- Detection warnings display for troubleshooting
- "Show Tracer" checkbox to toggle trajectory visibility
- "Render Shot Tracers" checkbox for export
- "No golf shot" (red) / "Next →" buttons for shot review
- Markers rendered via TrajectoryEditor: target (⊕), landing (↓), apex (◆)
- Custom SVG cursors matching marker icons during placement
- Autoplay: video seeks to clip start and plays after trajectory generation completes
- Video zoom (1x-4x) with pan support when zoomed in

**PointStatusTracker.tsx** - Visual step progress indicator:
- Shows all 4 steps with completion status (pending/done)
- Current step highlighted, clickable to navigate between steps
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

## Constraint-Based Ball Tracking

YOLO-based ball detection fails for golf balls in flight because:
- Golf balls are small (~1% of frame width)
- Fast movement (150+ mph) causes motion blur
- YOLO's "sports ball" class is trained on larger balls (soccer, basketball)

### New Tracking Modules

**detection/origin.py** - `BallOriginDetector`:
- Multi-method ball origin detection before impact
- Primary method: Shaft line detection + clubhead region detection
- Fallback: Clubhead-only detection (bright metallic areas)
- NO percentage-based estimates from golfer dimensions

**Ball Origin Detection Architecture** (implemented):

The key insight is that ball position requires TWO separate detections:
- **X coordinate**: Center of the clubhead (where ball sits in front of face)
- **Y coordinate**: Center of the hosel/clubhead (ground level where ball sits)

**Step 1: Shaft Line Detection**
1. Detect golfer via YOLO person detection
2. Find club shaft using LSD + Hough line detection with geometric constraints:
   - One end (grip) terminates between y-min and y-max of golfer bbox (hands area)
   - Other end (hosel) terminates near y-max of golfer bbox (feet/ground level)
   - Shaft goes from upper-left to lower-right (grip above and left of clubhead)
   - Line is diagonal, 15-60° from horizontal
   - Hosel is at maximum x-value of the line (for RH golfer)
3. Color analysis to distinguish shaft (dark) from grass (bright green)
4. If shaft score < 0.75, fall back to clubhead-only detection

**Step 2: Clubhead Center Detection**
1. Search small region around detected hosel position (80px right, ±40px vertical)
2. Detect clubhead via color masks:
   - Bright + low saturation = metallic/white crown (driver)
   - Very dark = matte black clubhead
3. Find largest contour matching clubhead size/aspect ratio
4. Use centroid of detected region as clubhead center

**Step 3: Combine for Ball Position**
- `ball_x = clubhead_center_x` (center of clubhead face)
- `ball_y = clubhead_center_y` (represents hosel midpoint / ground level)

This approach works because at address position, the ball sits directly in front of the clubhead face at ground level.

**detection/tracker.py** - `ConstrainedBallTracker`:
- Generates physics-based parabolic trajectories from origin point
- Uses calibrated parameters: 3s flight, 0.5 apex height, slight draw
- Frame differencing for early motion detection (first 200ms)
- Scores candidates by: brightness, position, centering, consistency

### Current State

**Ball origin detection is working well.** The shaft + clubhead detection successfully finds the ball position at address. Tested on 3 shots with accurate results:

| Shot | Strike Time | Ball Origin | Method | Shaft Score |
|------|-------------|-------------|--------|-------------|
| 1 | 18.25s | (1579, 1814) | shaft+clubhead | 0.96 |
| 2 | 60.28s | (2100, 1835) | shaft+clubhead | 0.96 |
| 3 | 111.46s | (1524, 1822) | shaft+clubhead | 0.92 |

The tracer now starts from the correct ball position (clubhead center) instead of incorrect estimates.

### Key Insight: Accuracy vs. Aesthetics

**We've been too focused on frame-by-frame accuracy.** The goal is NOT to track the exact ball position in every frame. What matters is:

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

### Completed Shot Tracer Features

1. ✅ **Detect ball origin accurately** - Shaft + clubhead detection working
2. ✅ **Generate smooth parabolic curve** - Physics model in `track_full_trajectory()`
3. ✅ **Detect trajectory characteristics** - `_extract_launch_params()` analyzes first 200ms
4. ✅ **Four-step marking UI** - Target → Landing → Apex (optional) → Configure
5. ✅ **Professional rendering**:
   - Smooth quadratic Bezier curves
   - RED tracer line with multi-layer glow effect
   - Physics-based animation timing (research-backed)
   - Apex marker at highest point (gold diamond ◆)
   - Progressive "drawing" effect during playback
   - 60fps animation using requestAnimationFrame
6. ✅ **Early ball detection** - Motion tracking in first 200ms post-impact:
   - `early_tracker.py` - Constraint-based ball tracking
   - `color_family.py` - Color family classification (white, yellow, orange, etc.)
   - `search_expansion.py` - Expanding search patterns for candidate detection
7. ✅ **PointStatusTracker component** - Visual progress indicator for marking steps
8. ✅ **Autoplay after generation** - Video auto-plays with tracer after trajectory completes

### Four-Step Marking Flow

The review UI uses a guided four-step process with visual status tracking (`PointStatusTracker.tsx`):

1. **Step 1: Mark Target** - User clicks where they were aiming (⊕ crosshair marker)
2. **Step 2: Mark Landing** - User clicks where ball actually landed (↓ arrow marker)
3. **Step 3: Mark Apex** - User clicks highest point of ball flight (◆ gold diamond marker, optional - can skip)
4. **Step 4: Configure & Generate** - Select trajectory settings:
   - Starting line: Left / Center / Right
   - Shot shape: Hook / Draw / Straight / Fade / Slice
   - Shot height: Low / Medium / High
   - Flight time: 1.0s - 6.0s slider
   - Click "Generate" to create trajectory

**Autoplay**: After trajectory generation completes, the video automatically seeks to clip start and plays the shot with tracer overlay.

### Trajectory Animation Physics

The tracer animation timing is based on real golf ball physics:

| Flight Phase | % of Time | % of Distance | Reason |
|--------------|-----------|---------------|--------|
| Initial burst | 0-25% | 0-45% | Ball at peak velocity (160+ mph) |
| Approaching apex | 25-50% | 45-55% | Decelerating due to drag + gravity |
| Descent | 50-100% | 55-100% | Nearly linear (terminal velocity ~72 mph limits acceleration) |

Implementation uses:
- `easeOutQuart` for explosive start
- `easeInOutQuad` for smooth apex transition
- 90% linear + 10% ease-out for natural descent

### Design Document

See `docs/plans/2026-01-24-constraint-based-ball-tracking.md` for full design.

## Background Agent Best Practices

When using parallel background agents for development work:

### When to Use Background Agents
- **Good for:** Parallel exploration, independent research tasks, fire-and-forget operations
- **Bad for:** Work that must continue after completion, sequential dependencies

### Continuation-Critical Work
If work MUST continue after agents finish, prefer **foreground sequential execution**:
```
# Instead of 3 background agents:
Agent 1 (foreground) → Agent 2 (foreground) → Agent 3 (foreground) → Continue
```
This ensures immediate continuation without polling overhead.

### If Using Background Agents, Always Poll
```
1. Launch background agents
2. Immediately set up polling (every 5 min):
   - Check TaskOutput for each agent
   - If all complete → proceed with next steps
   - If not → wait and check again
3. Never assume you'll be "notified"
```

### Communicate Expectations
Before async work, tell the user:
- What's running in background
- Expected completion time
- What happens when complete (and how you'll ensure it)
- What to expect if they return early

### Continuation Checklist
Before launching background agents:
- [ ] What runs in background?
- [ ] What's my continuation trigger?
- [ ] How will I know when to continue?
- [ ] What if the trigger never fires?

**Key lesson:** Background agents provide parallelism, not automatic continuation. Without active polling, completion goes unnoticed.
