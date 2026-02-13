# GolfClip

AI-powered golf shot detection and clip export tool. Analyzes video to detect golf shots via audio transients and visual ball tracking, then exports trimmed clips with optional shot tracer overlay.

## Active Development Scope

**ACTIVE** (reference and modify):
- `apps/browser/` - Production web app (Vercel) - **THIS IS THE MAIN CODEBASE**

**PAUSED** (do not reference or modify):
- `packages/frontend/` - Tauri desktop frontend (on hold)
- `packages/detection/` - Shared detection package (unused, desktop has own copy)
- `packages/api-schemas/` - Shared schemas (unused)
- `apps/desktop/` - Desktop backend (on hold)
- `apps/webapp/` - Cloud webapp (on hold)

When working on features or bugs, look in `apps/browser/` first. The paused directories contain stale code that may not reflect current functionality.

When working on bugs, look in `docs/bugs/` first.

---

**Stack**: React + TypeScript + Vite | FFmpeg.js + Essentia.js (client-side processing)

## Deployments

| App | URL | Notes |
|-----|-----|-------|
| Browser App (PROD) | https://browser-seven-sigma.vercel.app | Main production deployment |
| API (PROD) | https://golfclip-api.fly.dev | Backend API on Fly.io |

## Commands

| Task | Command |
|------|---------|
| **Browser app dev** | `cd apps/browser && npm run dev` |
| **Browser app tests** | `cd apps/browser && npm run test` |
| Backend server | `cd apps/desktop && uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload` |
| Backend tests | `cd apps/desktop && pytest backend/tests/ -v` |
| Skip slow tests | `cd apps/desktop && pytest backend/tests/ -v -m "not slow"` |
| Desktop frontend dev | `cd packages/frontend && npm run dev` |
| Setup (macOS) | `brew install python@3.11 ffmpeg && python3.11 -m venv .venv && pip install -e ".[dev]"` |

## Architecture

**`apps/browser/` and `packages/frontend/` are SEPARATE codebases** - not shared imports. Production is `apps/browser/`. When fixing frontend bugs, apply fixes there.

## Key Files

| File | Purpose |
|------|---------|
| `apps/browser/src/components/ClipReview.tsx` | **Production** shot review UI |
| `apps/browser/src/components/Scrubber.tsx` | **Production** timeline scrubber |
| `apps/desktop/backend/main.py` | FastAPI app entrypoint |
| `apps/desktop/backend/api/routes.py` | All API endpoints |
| `packages/detection/src/golfclip_detection/audio.py` | Audio transient detection |

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

- **Multi-video vs legacy segments**: The app supports both single-video (legacy) and multi-video upload flows. Always access segments via `activeVideo?.segments ?? legacySegments` pattern. The legacy `segments` array may be empty when using multi-video upload. See `bug-clipreview-legacy-segments.md`.

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
