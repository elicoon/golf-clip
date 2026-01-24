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
│           │   ├── VideoDropzone.tsx   # File input
│           │   ├── ProcessingView.tsx  # Progress tracking
│           │   ├── ClipReview.tsx      # Shot review + export
│           │   ├── ExportComplete.tsx  # Feedback collection
│           │   ├── Scrubber.tsx        # Timeline controls
│           │   └── TrajectoryEditor.tsx # Shot tracer canvas overlay
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
-- Schema v3 (current)
jobs (id, video_path, output_dir, status, progress, ...)
shots (id, job_id FK, shot_number, strike_time, confidence, ...)
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

## Shot Tracer Feature (Phase 2)

The shot tracer overlays ball flight trajectory on video clips during review and export.

### How It Works

1. **Detection**: During `detect_shots()`, the pipeline captures ball positions via YOLO tracking
2. **Storage**: Trajectory points are stored in `shot_trajectories` table with normalized coordinates (0-1)
3. **Preview**: `TrajectoryEditor.tsx` renders trajectory on a canvas overlay synced to video playback
4. **Edit**: Users can drag trajectory points to correct detection errors
5. **Export**: Optionally render tracer overlay onto exported clips using OpenCV

### Frontend Components

**TrajectoryEditor.tsx** - Canvas overlay on video player:
- Progressive animation (line grows as video plays)
- Control points: green (detected) vs gray (interpolated)
- Hover highlight (yellow ring) and drag-to-edit
- Touch/pointer event support for mobile
- Safari fallback for canvas blur filter

**ClipReview.tsx** additions:
- "Show Tracer" checkbox to toggle trajectory visibility
- "Render Shot Tracers" checkbox for export
- Loading spinner while trajectory fetches

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

## Constraint-Based Ball Tracking (WIP)

YOLO-based ball detection fails for golf balls in flight because:
- Golf balls are small (~1% of frame width)
- Fast movement (150+ mph) causes motion blur
- YOLO's "sports ball" class is trained on larger balls (soccer, basketball)

### New Tracking Modules

**detection/origin.py** - `BallOriginDetector`:
- Multi-method ball origin detection before impact
- Pipeline: YOLO person → golfer feet → shaft detection (Hough lines) → clubhead offset
- Reliably finds ball position even when YOLO can't detect the ball directly

**detection/tracker.py** - `ConstrainedBallTracker`:
- Frame differencing instead of YOLO for motion detection
- Searches in vertical band above origin (ball rises nearly vertically in behind-ball camera view)
- Scores candidates by: brightness (white ball), position (above origin), centering, consistency
- Filters to keep only high-confidence points from first 200ms

### Current State

The tracker successfully detects 6 consistent points in the first ~100ms after impact:
- X spread: ~33px (nearly vertical motion)
- Y range: 101-118px above origin
- Average confidence: 0.78

**Problem**: Only captures the first 100ms of flight. Need to extend tracking for full trajectory to render a smooth shot tracer like popular YouTube golf videos.

### Next Steps for Shot Tracer

1. **Extend tracking duration**: Currently filtering to first 200ms. Need to track for 2-4 seconds (full flight).

2. **Handle ball getting smaller**: As ball flies away from camera, it gets smaller and dimmer. Need adaptive thresholds:
   - Reduce `MIN_BRIGHTNESS` over time
   - Reduce `MIN_CONTOUR_AREA` for distant ball
   - Widen search region as ball could drift more

3. **Trajectory interpolation**: When ball is undetected for several frames, interpolate using parabolic physics model:
   - Use early detections to estimate launch angle and velocity
   - Fit parabola to fill gaps
   - Mark interpolated points with lower confidence

4. **Apex detection**: Find the highest point (lowest y) in trajectory - this is where ball starts descending.

5. **Landing detection**: Use audio (thud) or visual (ball stops moving) to detect landing point.

6. **Smooth rendering**:
   - Current TrajectoryEditor.tsx draws raw points
   - Need Bezier curve smoothing for professional-looking tracer
   - Add trail fade effect (older points more transparent)
   - Glow effect around the line

### Design Document

See `docs/plans/2026-01-24-constraint-based-ball-tracking.md` for full design.

### Test Video

Test video location: `/Users/ecoon/Desktop/golf-clip test videos/IMG_0991.mov`
- 4K @ 60fps, 119 seconds
- 3 detected shots at 18.25s, 60.28s, 111.46s
