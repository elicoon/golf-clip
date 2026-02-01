# GolfClip

AI-powered golf shot detection and clip export tool. Analyzes video to detect golf shots via audio transients and visual ball tracking, then exports trimmed clips with optional shot tracer overlay.

**Stack**: FastAPI + Python 3.11 | React + TypeScript + Vite | SQLite | OpenCV + FFmpeg | YOLO

## Commands

| Task | Command |
|------|---------|
| Backend server | `cd apps/desktop && uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload` |
| Frontend dev | `cd packages/frontend && npm run dev` |
| Run all tests | `cd apps/desktop && pytest backend/tests/ -v` |
| Skip slow tests | `cd apps/desktop && pytest backend/tests/ -v -m "not slow"` |
| Single test file | `cd apps/desktop && pytest backend/tests/test_integration.py -v` |
| Setup (macOS) | `brew install python@3.11 ffmpeg && python3.11 -m venv .venv && pip install -e ".[dev]"` |

## Architecture

```
golf-clip/
├── packages/
│   ├── frontend/           # Shared React app (Vite + TypeScript)
│   │   └── src/
│   │       ├── App.tsx, config.ts, stores/appStore.ts
│   │       └── components/  # VideoDropzone, ClipReview, TrajectoryEditor, etc.
│   ├── detection/          # Shared ML/detection (golfclip-detection)
│   │   └── src/golfclip_detection/  # audio.py, visual.py, origin.py, tracker.py
│   └── api-schemas/        # Shared Pydantic schemas
├── apps/
│   ├── desktop/            # Desktop app (golfclip-desktop)
│   │   └── backend/
│   │       ├── api/routes.py        # All API endpoints
│   │       ├── core/                # database.py, config.py, video.py
│   │       ├── detection/           # Audio + visual detection modules
│   │       ├── models/              # CRUD: job.py, trajectory.py
│   │       ├── processing/          # tracer.py, clips.py, curves.py
│   │       └── tests/               # 30+ test files
│   └── webapp/             # Cloud webapp (PostgreSQL + R2)
├── scripts/                # Dev scripts
└── docs/                   # Extended documentation
```

## Key Files

| File | Purpose |
|------|---------|
| `apps/desktop/backend/main.py` | FastAPI app entrypoint |
| `apps/desktop/backend/api/routes.py` | All API endpoints |
| `apps/desktop/backend/core/database.py` | SQLite setup + migrations |
| `packages/frontend/src/App.tsx` | Main React app with view routing |
| `packages/frontend/src/stores/appStore.ts` | Zustand state management |
| `packages/frontend/src/components/ClipReview.tsx` | Shot review + export + tracer |
| `packages/detection/src/golfclip_detection/audio.py` | Audio transient detection |
| `packages/detection/src/golfclip_detection/origin.py` | Ball origin detection (shaft + clubhead) |
| `apps/desktop/backend/processing/tracer.py` | Shot tracer rendering (OpenCV) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GOLFCLIP_HOST` | `127.0.0.1` | Server host |
| `GOLFCLIP_PORT` | `8420` | Server port |
| `GOLFCLIP_DEBUG` | `true` | Enable debug mode |
| `GOLFCLIP_CONFIDENCE_THRESHOLD` | `0.70` | Clips below this require review |
| `GOLFCLIP_CLIP_PADDING_BEFORE` | `2.0` | Seconds before ball strike |
| `GOLFCLIP_CLIP_PADDING_AFTER` | `2.0` | Seconds after ball lands |
| `GOLFCLIP_AUDIO_SENSITIVITY` | `0.5` | Detection sensitivity (0-1, try 0.7-0.9 for quiet audio) |
| `GOLFCLIP_FFMPEG_THREADS` | `0` | FFmpeg threads (0 = auto) |
| `GOLFCLIP_FFMPEG_TIMEOUT` | `600` | FFmpeg timeout in seconds |

## Gotchas

- **Windows FFmpeg**: Installed via winget but NOT in PATH. Location: `~/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin/`. The `conftest.py` auto-detects and adds to PATH for tests.

- **Database isolation in tests**: Use `unittest.mock.patch` on `DB_PATH` before importing app:
  ```python
  with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
      from backend.main import app
  ```

- **Browser vs Tauri file access**: In browser dev mode, videos are uploaded via `POST /api/upload` (returns server path). Video playback uses `GET /api/video` with Range request support for seeking.

- **Async in sync tests**: Use `asyncio.new_event_loop()` for async DB calls in synchronous test code.

- **0 shots detected**: Check logs for diagnostics. Try increasing sensitivity: `GOLFCLIP_AUDIO_SENSITIVITY=0.8`

- **Dynamic module access**: When patching before import, use proxy classes to access module-level state dynamically.

## Core API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/upload` | Upload video file |
| `POST /api/process` | Start detection job |
| `GET /api/status/{job_id}` | Job status |
| `GET /api/progress/{job_id}` | SSE progress stream |
| `GET /api/shots/{job_id}` | Get detected shots |
| `POST /api/export` | Export approved clips |
| `GET /api/video?path=...` | Stream video (supports Range) |
| `GET /api/trajectory/{job_id}/{shot_id}/generate` | SSE trajectory generation |

See @docs/API.md for complete endpoint reference.

## Documentation

- **@docs/FEATURES.md** - Feature documentation (shot tracer, ML feedback systems)
- **@docs/ARCHITECTURE.md** - Technical design (detection pipeline, constraint tracking)
- **@docs/API.md** - Complete API endpoint reference
- **@docs/PRODUCT-WALKTHROUGH.md** - User flow walkthrough

## Database

SQLite at `~/.golfclip/golfclip.db` (schema v7). Tables: `jobs`, `shots`, `shot_feedback`, `shot_trajectories`, `tracer_feedback`, `origin_feedback`.

## ML Config

Parameters stored in `~/.golfclip/ml_config.json`. Analysis commands:
```bash
python -m backend.ml.feedback_stats          # View stats
python -m backend.ml.analyze analyze --stage 1  # Threshold tuning (min 10 samples)
```
