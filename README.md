# GolfClip

A Mac desktop application that automatically transforms raw iPhone golf recordings into polished, YouTube-ready video clips.

## Features

- **Auto Shot Detection** - Identifies golf shots using combined audio and visual analysis
- **Smart Clip Cutting** - Automatically cuts clips to start 2s before impact and end 2s after landing
- **Confidence Scoring** - Flags uncertain clips for manual review
- **iPhone-style Review UI** - Intuitive scrubber interface for adjusting clip boundaries
- **Shot Tracers** (Phase 2) - Adds professional ball flight tracers
- **Hole Overlays** (Phase 3) - Displays hole number, yardage, and shot count

## Requirements

- macOS with Apple Silicon (M1/M2/M3) or Intel
- Python 3.11+
- Node.js 18+
- FFmpeg

## Quick Start

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/golf-clip.git
cd golf-clip

# Set up Python environment
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Install frontend dependencies
cd src/frontend
npm install

# Run the development server
npm run tauri dev
```

## Architecture

```
┌─────────────────────────────────────────┐
│           GolfClip Desktop App          │
├─────────────────────────────────────────┤
│  Frontend (React + Tauri)               │
│  Backend (Python + FastAPI)             │
│  ML (PyTorch + YOLO)                    │
│  Video (FFmpeg)                         │
└─────────────────────────────────────────┘
```

## Development

See [PRD.md](./PRD.md) for detailed product requirements and technical specifications.

## License

Private - All rights reserved
