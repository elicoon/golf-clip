# GolfClip

AI-powered golf clip detection and export tool. Automatically finds golf shots in your videos using audio analysis, lets you add professional shot tracers, and exports polished clips ready for YouTube.

## Features

- **Automatic Shot Detection** - Uses audio transient analysis to find ball strikes (the satisfying "thwack" sound)
- **Shot Tracer Overlays** - Add professional-looking ball flight tracers like you see on Good Good or PGA broadcasts
- **Smart Clip Boundaries** - Automatically sets clip start/end with configurable padding
- **Confidence Scoring** - Flags uncertain detections for manual review
- **Batch Export** - Export multiple clips at once with or without tracers

## Quick Start

### Prerequisites

- macOS (Apple Silicon or Intel) or Windows
- Python 3.11+
- Node.js 18+
- FFmpeg

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/golf-clip.git
cd golf-clip

# Set up Python environment
python3.11 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Install frontend dependencies
cd src/frontend
npm install
```

### Running the App

You need to run both the backend and frontend servers:

**Terminal 1 - Backend:**
```bash
cd golf-clip
source .venv/bin/activate
cd src
uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload
```

**Terminal 2 - Frontend:**
```bash
cd golf-clip/src/frontend
npm run dev
```

Then open http://localhost:5173 in your browser.

---

## User Interface Walkthrough

### Step 1: Select Video

When you open the app, you'll see the video selection screen:

1. **Click "Select File"** to upload a video from your computer
2. The video is uploaded to the backend for processing
3. Alternatively, use "Enter path manually (dev mode)" if you have a local file path

**Supported formats:** MP4, MOV, and other common video formats

### Step 2: Processing

After selecting a video, the app automatically:

1. **Extracts audio** from the video
2. **Analyzes audio** for ball strike sounds (transient detection)
3. **Deduplicates** nearby detections (keeps strongest in 25s windows)
4. **Detects ball origin** using computer vision (shaft + clubhead analysis)

A progress bar shows the current step. Processing typically takes 30-60 seconds for a 2-minute video.

### Step 3: Review Shots

For each detected shot, you'll see:

- **Video player** showing the shot clip
- **Timeline scrubber** with adjustable start/end handles
- **Confidence badge** (green/yellow/red based on detection confidence)

#### Adding a Shot Tracer (3-Step Process)

1. **Step 1: Mark Target**
   - Click on the video where you were **aiming**
   - A crosshair marker appears at that location

2. **Step 2: Mark Landing**
   - Click where the ball **actually landed**
   - A downward arrow marker appears

3. **Step 3: Configure Trajectory**
   - **Starting line:** Left / Center / Right (initial ball direction)
   - **Shot shape:** Hook / Draw / Straight / Fade / Slice
   - **Shot height:** Low / Medium / High
   - **Flight time:** Adjust with slider (1-6 seconds)
   - Click **"Generate"** to create the trajectory

The tracer appears as a **red glowing line** that animates as the video plays, following realistic golf ball physics.

#### Playback Controls

| Control | Action |
|---------|--------|
| `Space` | Play/Pause |
| `←` / `→` | Step one frame |
| `Shift + ←` / `→` | Jump 1 second |
| `[` / `]` | Set clip start/end to current time |
| `Enter` | Accept shot and go to next |
| `Esc` | Skip shot (mark as false positive) |

#### Review Actions

- **Skip Shot** - Mark as false positive, don't export
- **Next →** - Accept the shot and move to the next one (requires trajectory to be set)
- **Start Over** - Clear target/landing markers and re-mark

### Step 4: Export

After reviewing all shots:

1. A modal shows export progress
2. Clips are saved to `[video_name]_clips/` folder
3. If "Render Shot Tracers" is checked, tracers are burned into the video

---

## End-to-End User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER FLOW                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SELECT VIDEO                                                 │
│     └─> Upload or enter path                                    │
│                                                                  │
│  2. PROCESSING (automatic)                                      │
│     ├─> Extract audio                                           │
│     ├─> Detect ball strikes                                     │
│     ├─> Deduplicate detections                                  │
│     └─> Detect ball origin (computer vision)                    │
│                                                                  │
│  3. REVIEW EACH SHOT                                            │
│     ├─> Adjust clip boundaries (drag handles or use [ ] keys)   │
│     ├─> Mark target point (where you aimed)                     │
│     ├─> Mark landing point (where ball went)                    │
│     ├─> Configure trajectory (shape, height, flight time)       │
│     ├─> Generate tracer                                         │
│     ├─> Preview animation (play video)                          │
│     └─> Accept (Next →) or Skip                                 │
│                                                                  │
│  4. EXPORT                                                       │
│     ├─> Clips exported to output folder                         │
│     └─> Optional: tracers burned into video                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Configuration

All settings can be configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GOLFCLIP_AUDIO_SENSITIVITY` | `0.5` | Detection sensitivity (0-1). Try 0.7-0.9 if getting 0 shots |
| `GOLFCLIP_CONFIDENCE_THRESHOLD` | `0.70` | Clips below this require manual review |
| `GOLFCLIP_CLIP_PADDING_BEFORE` | `2.0` | Seconds before ball strike |
| `GOLFCLIP_CLIP_PADDING_AFTER` | `2.0` | Seconds after ball lands |

Example:
```bash
export GOLFCLIP_AUDIO_SENSITIVITY=0.8
```

---

## Troubleshooting

### No shots detected

1. Check if audio is audible in the source video
2. Try increasing sensitivity: `export GOLFCLIP_AUDIO_SENSITIVITY=0.8`
3. Check backend logs for diagnostic messages

### Tracer not appearing

1. Ensure "Show Tracer" checkbox is enabled
2. Verify trajectory was generated (click "Generate" after marking points)
3. Play the video - tracer animates with playback

### Video won't load

1. Ensure backend is running on port 8420
2. Check browser console for CORS errors
3. Try refreshing the page

---

## Tech Stack

- **Backend:** FastAPI + Python 3.11
- **Frontend:** React + TypeScript + Vite
- **Audio Processing:** librosa, ffmpeg-python
- **Video Processing:** OpenCV, ffmpeg
- **Database:** SQLite (async with aiosqlite)
- **State Management:** Zustand

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           FRONTEND                               │
│                      React + TypeScript                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ VideoDropzone│  │ProcessingView│  │     ClipReview       │   │
│  │  (upload)    │  │  (progress)  │  │  ┌────────────────┐  │   │
│  └──────────────┘  └──────────────┘  │  │TrajectoryEditor│  │   │
│                                       │  │ (canvas overlay)│  │   │
│                                       │  └────────────────┘  │   │
│                                       └──────────────────────┘   │
│                           │                                      │
│                    ┌──────┴──────┐                               │
│                    │Zustand Store│                               │
│                    └──────┬──────┘                               │
└───────────────────────────┼─────────────────────────────────────┘
                            │ HTTP REST + SSE (Server-Sent Events)
┌───────────────────────────┼─────────────────────────────────────┐
│                      BACKEND (FastAPI)                           │
│                           │                                      │
│  ┌────────────────────────┴───────────────────────────────────┐ │
│  │                      API Routes                             │ │
│  │  POST /upload    POST /process    GET /shots                │ │
│  │  GET /trajectory (SSE)            POST /export              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────┐  ┌───────────────┐  ┌────────────────────┐    │
│  │   Audio     │  │    Origin     │  │    Trajectory      │    │
│  │  Detection  │  │   Detection   │  │    Generation      │    │
│  │  ─────────  │  │  ───────────  │  │  ───────────────   │    │
│  │  librosa    │  │  YOLO + LSD   │  │  Physics model +   │    │
│  │  transient  │  │  + color      │  │  Bezier curves     │    │
│  │  analysis   │  │  analysis     │  │                    │    │
│  └─────────────┘  └───────────────┘  └────────────────────┘    │
│                           │                                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                   SQLite Database                            │ │
│  │   ┌──────┐  ┌───────┐  ┌──────────────┐  ┌─────────────┐   │ │
│  │   │ jobs │  │ shots │  │ trajectories │  │  feedback   │   │ │
│  │   └──────┘  └───────┘  └──────────────┘  └─────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL TOOLS                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐                     │
│  │  FFmpeg  │  │  OpenCV  │  │   YOLO    │                     │
│  │  (video) │  │ (frames) │  │ (person)  │                     │
│  └──────────┘  └──────────┘  └───────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Upload**: Video file → Backend → Stored locally
2. **Process**: Audio extraction → Transient detection → Ball origin detection
3. **Review**: User marks target/landing → Physics trajectory generated
4. **Export**: Clips trimmed via FFmpeg → Optional tracer overlay via OpenCV

---

## Project Structure

```
golf-clip/
├── src/
│   ├── backend/
│   │   ├── api/              # FastAPI routes
│   │   ├── core/             # Database, config
│   │   ├── detection/        # Shot detection algorithms
│   │   ├── models/           # Database operations
│   │   ├── processing/       # Video/tracer rendering
│   │   └── tests/            # Integration tests
│   └── frontend/
│       └── src/
│           ├── components/   # React components
│           └── stores/       # Zustand state
├── docs/                     # Documentation
├── CLAUDE.md                 # AI assistant context
├── PRD.md                    # Product requirements
└── README.md                 # This file
```

---

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Technical reference for AI assistants and developers
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Guide for contributors
- [docs/FEATURES.md](./docs/FEATURES.md) - Detailed feature documentation
- [docs/PRODUCT-WALKTHROUGH.md](./docs/PRODUCT-WALKTHROUGH.md) - Step-by-step UI guide with annotated diagrams
- [PRD.md](./PRD.md) - Product requirements document

---

## License

Private - All rights reserved
