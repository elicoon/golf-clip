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
│   │   │   └── job.py        # Job, Shot, Feedback operations
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
│           │   └── Scrubber.tsx        # Timeline controls
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

## Detection Pipeline

1. **Audio Detection**: Analyze audio for transient peaks (golf strike sounds)
2. **Deduplication**: Filter nearby detections to keep strongest in each 25s window
3. **Visual Detection**: Track ball movement using YOLO + optical flow
4. **Confidence Scoring**: Combine audio/visual signals with confidence thresholds
5. **Review**: User reviews and adjusts detected shots
6. **Export**: Trim and export selected clips with customizable pre/post padding

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
-- Schema v2 (current)
jobs (id, video_path, output_dir, status, progress, ...)
shots (id, job_id FK, shot_number, strike_time, confidence, ...)
shot_feedback (id, job_id FK, shot_id, feedback_type, notes, confidence_snapshot, ...)
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
