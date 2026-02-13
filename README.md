# GolfClip

AI-powered golf shot detection and clip export. Drop in a round video, get back trimmed clips with professional shot tracer overlays — all processed client-side in the browser.

GolfClip analyzes video audio to detect ball strikes via transient analysis, identifies the ball origin using computer vision (YOLO + shaft/clubhead detection), generates physics-based flight trajectories, and exports polished clips with animated tracer overlays using the WebCodecs API.

## Features

- **Automatic shot detection** — Audio transient analysis finds ball strikes by scoring peak height, spectral flatness, rise time, decay ratio, and more
- **Ball origin detection** — Computer vision pipeline using YOLO person detection, line segment detection, and clubhead color analysis to locate the ball at impact
- **Shot tracer overlay** — Physics-based parabolic trajectories with configurable height, shape (draw/fade/slice), and flight time, rendered as animated glow lines
- **Client-side export** — Two-pass WebCodecs pipeline: real-time frame capture via `requestVideoFrameCallback`, then encoding with tracer compositing via `mp4-muxer`
- **Confidence scoring** — Multi-feature weighted scoring flags uncertain detections for review
- **ML feedback loop** — Collects true positive/false positive labels, tracer correction deltas, and origin accuracy data for iterative model improvement

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | TypeScript, React 18, Vite, Zustand |
| Audio Processing | FFmpeg WASM (`@ffmpeg/ffmpeg`), Essentia.js |
| Video Export | WebCodecs API, `requestVideoFrameCallback`, `mp4-muxer` |
| Trajectory | Physics model + quadratic Bezier smoothing |
| Backend API | Python, FastAPI |
| Detection | librosa, OpenCV, YOLO (ultralytics) |
| Database | SQLite (async via aiosqlite) |
| Hosting | Vercel (frontend), Fly.io (API) |

## How It Works

```
Video → FFmpeg audio extraction → Bandpass filter (1-8kHz) → Transient detection
     → Feature scoring (7 weighted features) → Deduplication (25s windows)
     → YOLO person detection → Shaft line + clubhead detection → Ball origin
     → User marks landing → Physics trajectory generation → Bezier smoothing
     → WebCodecs export with tracer compositing → MP4 clip
```

## Architecture

```
apps/
├── browser/          # Production web app (React + TypeScript + Vite)
│   └── src/
│       ├── components/   # ClipReview, TrajectoryEditor, Scrubber, VideoDropzone
│       ├── lib/          # audio-detector, ffmpeg-client, video-frame-pipeline, trajectory-generator
│       └── stores/       # Zustand state management
└── desktop/          # Desktop backend (Python + FastAPI)
    ├── api/              # REST + SSE endpoints
    ├── detection/        # Audio transient + ball origin detection
    ├── processing/       # Video processing + tracer rendering
    └── models/           # Database CRUD operations
```

## Development

```bash
# Frontend (browser app)
cd apps/browser
npm install
npm run dev          # → http://localhost:5173

# Backend API
cd apps/desktop
pip install -e ".[dev]"
uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload

# Tests (373 passing)
cd apps/browser && npm run test
```

## Status

Active development. 373 tests passing across 22 test suites.

## License

MIT
